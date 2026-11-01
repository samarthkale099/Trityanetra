import { http } from '@/shared/lib/httpClient'
import type { ExamLanguage } from '@/shared/types/classroom'

/**
 * Proctoring event reporting.
 *
 * HONEST LIMITATION, stated here because it belongs next to the code: everything
 * in `features/exam` that "detects" something is a *deterrent*, not a security
 * control. A student can disable JavaScript, use a second device, edit a file on
 * disk, or call the API directly. These signals are useful for a human reviewer
 * and worthless against anyone who is deliberately evading. Real enforcement
 * (authoritative timing, randomised question sets, per-question identity) has to
 * live on the server.
 *
 * The backend declares a `monitorFlags` collection but exposes no route for it,
 * so `POST /api/tests/:testId/monitor-events` is a contract the frontend expects
 * and does not yet receive. A 404/405 is therefore treated as "endpoint absent",
 * not as an error worth bothering the student about, and the event is queued
 * locally instead. The queue is flushed on the next successful send, so enabling
 * the endpoint later needs no frontend change.
 */

export const MONITOR_EVENT_TYPES = [
  'TAB_HIDDEN',
  'WINDOW_BLUR',
  'FULLSCREEN_EXIT',
  'PASTE_ATTEMPT',
  'DEVTOOLS_OPEN',
  'COPY_ATTEMPT',
  'EXAM_SUBMITTED',
] as const

export type MonitorEventType = (typeof MONITOR_EVENT_TYPES)[number]

export interface MonitorEvent {
  type: MonitorEventType
  /** ISO-8601, taken from the device clock. Treated as a hint, not a timestamp. */
  at: string
  language?: ExamLanguage
  /** Free-form, size-capped detail. Never contains the student's code. */
  meta?: Record<string, string | number | boolean>
}

export interface MonitorContext {
  testId: string
  language: ExamLanguage
}

const QUEUE_KEY = 'trityanetra.monitorQueue.v1'
const MAX_QUEUE = 200
const MAX_META_ENTRIES = 6

/** Caps a meta bag so a runaway detector cannot fill localStorage. */
function capMeta(meta: Record<string, string | number | boolean> | undefined) {
  if (!meta) return undefined
  const entries = Object.entries(meta).slice(0, MAX_META_ENTRIES).map(([key, value]) => [
    key.slice(0, 40),
    typeof value === 'string' ? value.slice(0, 120) : value,
  ])
  return Object.fromEntries(entries)
}

function readQueue(): MonitorEvent[] {
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is MonitorEvent =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as MonitorEvent).type === 'string' &&
        typeof (item as MonitorEvent).at === 'string',
    )
  } catch {
    // Private browsing, a full quota, or corrupted JSON. Never let telemetry
    // bookkeeping break an exam that is otherwise working.
    return []
  }
}

function writeQueue(events: MonitorEvent[]): void {
  try {
    if (events.length === 0) window.localStorage.removeItem(QUEUE_KEY)
    else window.localStorage.setItem(QUEUE_KEY, JSON.stringify(events.slice(-MAX_QUEUE)))
  } catch {
    /* Storage unavailable. The event is dropped rather than breaking the exam. */
  }
}

export function enqueueMonitorEvent(event: MonitorEvent): void {
  writeQueue([...readQueue(), event])
}

export function queuedMonitorEventCount(): number {
  return readQueue().length
}

/** Test-only hook. */
export function clearMonitorQueue(): void {
  writeQueue([])
}

/* --------------------------------------------------------------- backend */

/**
 * The backend records four advisory flag types
 * (`POST /api/monitor/:testId/flags { flagType, metadata }`). Client events map
 * onto them; events with no backend counterpart stay client-side only.
 */
export type BackendFlagType = 'TAB_SWITCH' | 'DEVTOOLS_OPEN' | 'PASTE_ATTEMPT' | 'FULLSCREEN_EXIT'

export function toBackendFlag(type: MonitorEventType): BackendFlagType | null {
  switch (type) {
    case 'TAB_HIDDEN':
    case 'WINDOW_BLUR':
      return 'TAB_SWITCH'
    case 'DEVTOOLS_OPEN':
      return 'DEVTOOLS_OPEN'
    case 'PASTE_ATTEMPT':
      return 'PASTE_ATTEMPT'
    case 'FULLSCREEN_EXIT':
      return 'FULLSCREEN_EXIT'
    default:
      // COPY_ATTEMPT and EXAM_SUBMITTED have no backend flag.
      return null
  }
}

/**
 * The backend allows one flag per 2 s per student+test (429 above that).
 * Sends are serialised through one chain and spaced 2.1 s apart, so a burst
 * (blur + tab hide + fullscreen exit, all at once) is delivered in full
 * rather than losing all but the first to the limiter.
 */
const SEND_SPACING_MS = 2_100
let sendChain: Promise<unknown> = Promise.resolve()
let lastSentAt = 0

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function sendFlag(context: MonitorContext, event: MonitorEvent): Promise<void> {
  const flagType = toBackendFlag(event.type)
  if (!flagType) return Promise.resolve()
  const run = sendChain.then(async () => {
    const gap = lastSentAt + SEND_SPACING_MS - Date.now()
    if (gap > 0) await wait(gap)
    lastSentAt = Date.now()
    await http.post<void>(`/api/monitor/${encodeURIComponent(context.testId)}/flags`, {
      body: {
        flagType,
        metadata: { ...(event.meta ?? {}), clientEvent: event.type, at: event.at, language: event.language ?? null },
      },
      // The server answering 401 must not sign the student out mid-exam.
      retryOnUnauthorized: false,
    })
  })
  // Keep the chain alive whatever this send does.
  sendChain = run.catch(() => undefined)
  return run
}

export interface ReportResult {
  delivered: boolean
  /** True when the send failed and the event was kept locally for a retry. */
  queued: boolean
}

/**
 * Reports one event. Never throws: proctoring telemetry failing must not disturb
 * the student mid-exam, and the caller has nothing useful to do with an error.
 */
export async function reportMonitorEvent(
  context: MonitorContext,
  type: MonitorEventType,
  meta?: MonitorEvent['meta'],
): Promise<ReportResult> {
  const event: MonitorEvent = {
    type,
    at: new Date().toISOString(),
    language: context.language,
    meta: capMeta(meta),
  }
  if (!toBackendFlag(type)) return { delivered: false, queued: false }

  try {
    await sendFlag(context, event)
    void flushMonitorQueue(context)
    return { delivered: true, queued: false }
  } catch {
    // Offline, rate-limited or a transient failure: keep it for a later retry,
    // without surfacing anything to the student.
    enqueueMonitorEvent(event)
    return { delivered: false, queued: true }
  }
}

/**
 * Retries queued events, one at a time and spaced for the rate limit. Called
 * after a successful send and on exam exit. Events that still fail stay queued.
 */
export async function flushMonitorQueue(context: MonitorContext): Promise<number> {
  const pending = readQueue()
  if (pending.length === 0) return 0
  writeQueue([])
  let delivered = 0
  const failed: MonitorEvent[] = []
  for (const event of pending) {
    try {
      await sendFlag(context, event)
      delivered++
    } catch {
      failed.push(event)
    }
  }
  if (failed.length) writeQueue([...failed, ...readQueue()])
  return delivered
}
