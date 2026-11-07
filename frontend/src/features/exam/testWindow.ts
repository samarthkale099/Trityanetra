import { formatIST } from '@/shared/lib/datetime'
import type { TestStatus } from '@/shared/types/classroom'

/**
 * Test-window arithmetic.
 *
 * A student can freely change their device clock, so the client never decides
 * whether a test is open from `Date.now()` alone. The backend returns
 * `serverTime` with the lobby payload; the client measures how far its own clock
 * disagrees with that and counts down against the corrected value. The server
 * still re-checks the window on submit, so this is presentation, not security.
 */

export interface ServerClock {
  /** Server time minus local time, in ms. Added to `Date.now()` to get server time. */
  offsetMs: number
  /** `serverTime` as sent, kept for display. */
  serverTime: string
  /** When the offset was measured, locally. */
  measuredAtMs: number
}

/**
 * Builds a clock from a `serverTime` field. `receivedAtMs` is the local time at
 * the moment the response landed; using the midpoint of the request would be
 * marginally better but the difference is a few milliseconds against windows
 * measured in minutes.
 */
export function createServerClock(serverTime: string, receivedAtMs: number): ServerClock {
  const serverMs = Date.parse(serverTime)
  const offsetMs = Number.isFinite(serverMs) ? serverMs - receivedAtMs : 0
  return { offsetMs, serverTime, measuredAtMs: receivedAtMs }
}

/** Server time, given the local clock and a measured offset. */
export function serverNow(clock: ServerClock, localNowMs: number = Date.now()): number {
  return localNowMs + clock.offsetMs
}

export interface TestWindow {
  windowStart: string
  windowEnd: string
  durationMinutes: number
}

/** Milliseconds until the window opens. Negative once it is open. */
export function msUntilOpen(window: TestWindow, nowMs: number): number {
  return Date.parse(window.windowStart) - nowMs
}

/** Milliseconds until the window closes. Negative once it is closed. */
export function msUntilClose(window: TestWindow, nowMs: number): number {
  return Date.parse(window.windowEnd) - nowMs
}

/**
 * Status from server time. Any unparseable boundary is treated as closed: a
 * malformed window must not present an open exam.
 */
export function testStatus(window: TestWindow, nowMs: number): TestStatus {
  const start = Date.parse(window.windowStart)
  const end = Date.parse(window.windowEnd)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'ENDED'
  if (nowMs < start) return 'UPCOMING'
  if (nowMs >= end) return 'ENDED'
  return 'LIVE'
}

/**
 * The moment a student's own time runs out: the earlier of the window closing
 * and their per-attempt allowance elapsing from the moment the exam opened.
 * Both matter, and taking the minimum is the only safe reading.
 */
export function effectiveDeadlineMs(window: TestWindow, openedAtMs: number): number {
  const end = Date.parse(window.windowEnd)
  const allowanceEnd = openedAtMs + window.durationMinutes * 60_000
  if (!Number.isFinite(end)) return allowanceEnd
  return Math.min(end, allowanceEnd)
}

/** True when the exam may be entered right now and the student has not submitted. */
export function canStartExam(
  window: TestWindow,
  nowMs: number,
  alreadySubmitted: boolean,
): boolean {
  return !alreadySubmitted && testStatus(window, nowMs) === 'LIVE'
}

const pad = (value: number) => String(Math.floor(Math.abs(value))).padStart(2, '0')

/**
 * `MM:SS` below an hour, `H:MM:SS` above. Negative input renders as `00:00`
 * rather than a negative clock, so a finished countdown cannot read "-01".
 */
export function formatCountdown(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00'
  const totalSeconds = Math.floor(ms / 1000)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`
  return `${pad(minutes)}:${pad(seconds)}`
}

/** Human phrasing for a countdown: "opens in 4 min", "closes in 1:02:11", "closed". */
export function describeCountdown(ms: number): string {
  if (!Number.isFinite(ms)) return 'unavailable'
  if (ms <= 0) return 'closed'
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `in ${totalSeconds} sec`
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 60) return `in ${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder === 0 ? `in ${hours} hr` : `in ${hours} hr ${remainder} min`
}

/**
 * Absolute window as a readable string. Times are shown in Indian Standard
 * Time, which is the one zone the product displays in everywhere; the formatting
 * itself lives in the shared `datetime` helper.
 */
export function formatWindow(window: TestWindow): string {
  const start = Date.parse(window.windowStart)
  const end = Date.parse(window.windowEnd)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Window unavailable'
  return `${formatIST(start)} - ${formatIST(end)}`
}
