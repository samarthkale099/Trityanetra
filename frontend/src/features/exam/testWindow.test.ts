import { describe, expect, it } from 'vitest'

import {
  canStartExam,
  createServerClock,
  describeCountdown,
  effectiveDeadlineMs,
  formatCountdown,
  formatWindow,
  msUntilClose,
  msUntilOpen,
  serverNow,
  testStatus,
  type TestWindow,
} from './testWindow'

const WINDOW: TestWindow = {
  windowStart: '2026-03-01T10:00:00.000Z',
  windowEnd: '2026-03-01T12:00:00.000Z',
  durationMinutes: 45,
}

const AT = (iso: string) => Date.parse(iso)
const BEFORE = AT('2026-03-01T09:30:00.000Z')
const MIDDLE = AT('2026-03-01T11:00:00.000Z')
const AFTER = AT('2026-03-01T13:00:00.000Z')

describe('server clock', () => {
  it('measures the offset between the server and the device clock', () => {
    // Device clock is 10 minutes slow; the server is the authority.
    const clock = createServerClock('2026-03-01T10:00:00.000Z', AT('2026-03-01T09:50:00.000Z'))
    expect(clock.offsetMs).toBe(600_000)
    expect(serverNow(clock, AT('2026-03-01T11:00:00.000Z'))).toBe(AT('2026-03-01T11:10:00.000Z'))
  })

  it('falls back to a zero offset for an unparseable timestamp', () => {
    const clock = createServerClock('not-a-date', BEFORE)
    expect(clock.offsetMs).toBe(0)
    expect(serverNow(clock, MIDDLE)).toBe(MIDDLE)
  })
})

describe('testStatus', () => {
  it('is UPCOMING before the window opens', () => {
    expect(testStatus(WINDOW, BEFORE)).toBe('UPCOMING')
  })

  it('is LIVE inside the window, inclusive of the start', () => {
    expect(testStatus(WINDOW, AT('2026-03-01T10:00:00.000Z'))).toBe('LIVE')
    expect(testStatus(WINDOW, MIDDLE)).toBe('LIVE')
  })

  it('is ENDED at and after the close', () => {
    expect(testStatus(WINDOW, AT('2026-03-01T12:00:00.000Z'))).toBe('ENDED')
    expect(testStatus(WINDOW, AFTER)).toBe('ENDED')
  })

  it('treats a malformed window as closed rather than open', () => {
    expect(testStatus({ ...WINDOW, windowEnd: 'soon' }, MIDDLE)).toBe('ENDED')
    expect(testStatus({ ...WINDOW, windowStart: '' }, MIDDLE)).toBe('ENDED')
  })
})

describe('msUntilOpen / msUntilClose', () => {
  it('is negative once the boundary has passed', () => {
    expect(msUntilOpen(WINDOW, BEFORE)).toBe(30 * 60_000)
    expect(msUntilOpen(WINDOW, MIDDLE)).toBe(-60 * 60_000)
    expect(msUntilClose(WINDOW, MIDDLE)).toBe(60 * 60_000)
    expect(msUntilClose(WINDOW, AFTER)).toBe(-60 * 60_000)
  })
})

describe('effectiveDeadlineMs', () => {
  it('runs the allowance from when the attempt started, not from the window', () => {
    // Started an hour into a two-hour window with a 45 minute allowance: the
    // allowance is what ends it, at 11:45.
    const opened = AT('2026-03-01T11:00:00.000Z')
    expect(effectiveDeadlineMs(WINDOW, opened)).toBe(AT('2026-03-01T11:45:00.000Z'))
  })

  it('is capped by the window closing even with allowance left', () => {
    // Started a minute before close with a 45 minute allowance.
    const opened = AT('2026-03-01T11:59:00.000Z')
    expect(effectiveDeadlineMs(WINDOW, opened)).toBe(AT('2026-03-01T12:00:00.000Z'))
  })

  it('falls back to the allowance when the close time is unusable', () => {
    const opened = AT('2026-03-01T11:00:00.000Z')
    expect(effectiveDeadlineMs({ ...WINDOW, windowEnd: 'later' }, opened)).toBe(
      AT('2026-03-01T11:45:00.000Z'),
    )
  })
})

describe('canStartExam', () => {
  it('allows entry only while the window is live', () => {
    expect(canStartExam(WINDOW, BEFORE, false)).toBe(false)
    expect(canStartExam(WINDOW, MIDDLE, false)).toBe(true)
    expect(canStartExam(WINDOW, AFTER, false)).toBe(false)
  })

  it('refuses a student who has already submitted, even mid-window', () => {
    expect(canStartExam(WINDOW, MIDDLE, true)).toBe(false)
  })
})

describe('formatting', () => {
  it('renders MM:SS under an hour and H:MM:SS above', () => {
    expect(formatCountdown(9_000)).toBe('00:09')
    expect(formatCountdown(65_000)).toBe('01:05')
    expect(formatCountdown(3_725_000)).toBe('1:02:05')
  })

  it('never renders a negative countdown', () => {
    expect(formatCountdown(-5_000)).toBe('00:00')
    expect(formatCountdown(0)).toBe('00:00')
    expect(formatCountdown(Number.NaN)).toBe('00:00')
  })

  it('describes the wait in plain language', () => {
    expect(describeCountdown(-1)).toBe('closed')
    expect(describeCountdown(Number.POSITIVE_INFINITY)).toBe('unavailable')
    expect(describeCountdown(30_000)).toBe('in 30 sec')
    expect(describeCountdown(4 * 60_000)).toBe('in 4 min')
    expect(describeCountdown(60 * 60_000)).toBe('in 1 hr')
    expect(describeCountdown(90 * 60_000)).toBe('in 1 hr 30 min')
  })

  it('labels the window in IST and degrades gracefully', () => {
    // 10:00 UTC and 12:00 UTC are 3:30 pm and 5:30 pm IST.
    expect(formatWindow(WINDOW)).toBe('1 Mar 2026, 3:30 pm IST - 1 Mar 2026, 5:30 pm IST')
    expect(formatWindow(WINDOW)).toContain('IST')
    expect(formatWindow({ ...WINDOW, windowStart: 'nope' })).toBe('Window unavailable')
  })
})
