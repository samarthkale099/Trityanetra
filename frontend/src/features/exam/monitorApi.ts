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

function isEndpointMissing(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status
  // 404/405: the route is not mounted. 501: explicitly not implemented.
  return status === 404 || status === 405 || status === 501
}

export interface ReportResult {
  delivered: boolean
  /** True when the endpoint is absent and the event was queued locally. */
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

  try {
    await http.post<void>(`/api/tests/${encodeURIComponent(context.testId)}/monitor-events`, {
      body: { event },
      // The server answering 401 must not sign the student out mid-exam.
      retryOnUnauthorized: false,
    })
    await flushMonitorQueue(context)
    return { delivered: true, queued: false }
  } catch (error) {
    if (!isEndpointMissing(error)) {
      // A transient failure: queue it, but do not surface anything to the user.
      enqueueMonitorEvent(event)
      return { delivered: false, queued: true }
    }
    enqueueMonitorEvent(event)
    return { delivered: false, queued: true }
  }
}

/**
 * Retries queued events. Called after a successful send, and on exam exit, so a
 * backend that gains the endpoint later drains the backlog without a deploy.
 */
export async function flushMonitorQueue(context: MonitorContext): Promise<number> {
  const pending = readQueue()
  if (pending.length === 0) return 0
  try {
    await http.post<void>(`/api/tests/${encodeURIComponent(context.testId)}/monitor-events`, {
      body: { events: pending },
      retryOnUnauthorized: false,
    })
    writeQueue([])
    return pending.length
  } catch {
    return 0
  }
}
