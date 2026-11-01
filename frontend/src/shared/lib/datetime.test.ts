import { describe, expect, it } from 'vitest'

import {
  formatIST,
  formatISTDate,
  formatISTTime,
  istInputToUtcIso,
  parseIstInputMs,
  utcIsoToIstInput,
} from './datetime'

/**
 * These cases pin the IST contract without ever reading the computer's clock or
 * zone: every value is a fixed UTC instant and the expected output is the IST
 * wall-clock for it. If the implementation leaned on `getHours()` or a
 * zone-less `Date.parse`, the assertions below would move with `process.env.TZ`
 * and fail on a machine that is not set to IST.
 */

/** ICU sometimes renders the am/pm space as a narrow no-break space; fold it. */
const norm = (value: string) => value.replace(/[\u202f\u00a0]/g, ' ')

describe('formatIST', () => {
  it('renders a UTC instant as Indian Standard Time with an IST label', () => {
    // 11:23 UTC is 16:53 IST, five and a half hours ahead.
    expect(norm(formatIST('2026-10-10T11:23:00.000Z'))).toBe('10 Oct 2026, 4:53 pm IST')
  })

  it('rolls to the next IST day across the 18:30 UTC midnight boundary', () => {
    expect(norm(formatIST('2026-10-10T18:30:00.000Z'))).toBe('11 Oct 2026, 12:00 am IST')
    // One minute earlier the IST calendar day is still the same.
    expect(norm(formatIST('2026-10-10T18:29:00.000Z'))).toBe('10 Oct 2026, 11:59 pm IST')
  })

  it('returns the fallback for an unreadable value', () => {
    expect(formatIST('not-a-date', 'Window unavailable')).toBe('Window unavailable')
    expect(formatIST('', 'Window unavailable')).toBe('Window unavailable')
  })

  it('treats midnight UTC as the small hours of the IST morning, not midnight', () => {
    expect(norm(formatISTTime('2026-10-10T00:00:00.000Z'))).toBe('5:30 am IST')
  })
})

describe('formatISTDate / formatISTTime', () => {
  it('splits the calendar date from the clock without a zone suffix on the date', () => {
    expect(formatISTDate('2026-10-10T18:30:00.000Z')).toBe('11 Oct 2026')
    expect(formatISTDate('2026-10-10T18:29:00.000Z')).toBe('10 Oct 2026')
    expect(norm(formatISTTime('2026-10-10T11:23:00.000Z'))).toBe('4:53 pm IST')
  })
})

describe('utcIsoToIstInput', () => {
  it('converts a UTC ISO instant to the IST wall clock a datetime-local expects', () => {
    expect(utcIsoToIstInput('2026-10-10T11:23:00.000Z')).toBe('2026-10-10T16:53')
  })

  it('moves to the next day exactly at 18:30 UTC', () => {
    expect(utcIsoToIstInput('2026-10-10T18:29:00.000Z')).toBe('2026-10-10T23:59')
    // 18:30 UTC is 00:00 IST on the following day.
    expect(utcIsoToIstInput('2026-10-10T18:30:00.000Z')).toBe('2026-10-11T00:00')
    expect(utcIsoToIstInput('2026-10-10T18:31:00.000Z')).toBe('2026-10-11T00:01')
  })

  it('crosses a year boundary with the same rule', () => {
    expect(utcIsoToIstInput('2026-12-31T18:30:00.000Z')).toBe('2027-01-01T00:00')
  })

  it('returns an empty string for an unreadable instant', () => {
    expect(utcIsoToIstInput('')).toBe('')
    expect(utcIsoToIstInput('whenever')).toBe('')
  })
})

describe('istInputToUtcIso', () => {
  it('reads a datetime-local value as IST and sends UTC', () => {
    expect(istInputToUtcIso('2026-10-10T16:53')).toBe('2026-10-10T11:23:00.000Z')
  })

  it('turns IST midnight back into the previous UTC day at 18:30', () => {
    // 00:00 IST on the 11th is 18:30 UTC on the 10th.
    expect(istInputToUtcIso('2026-10-11T00:00')).toBe('2026-10-10T18:30:00.000Z')
    expect(istInputToUtcIso('2026-10-10T23:59')).toBe('2026-10-10T18:29:00.000Z')
  })

  it('accepts an optional seconds component', () => {
    expect(istInputToUtcIso('2026-10-10T16:53:45')).toBe('2026-10-10T11:23:45.000Z')
  })

  it('round-trips an instant through the input shape', () => {
    for (const iso of ['2026-01-01T00:00:00.000Z', '2026-06-15T09:07:00.000Z', '2026-12-31T18:30:00.000Z']) {
      expect(istInputToUtcIso(utcIsoToIstInput(iso))).toBe(iso)
    }
  })

  it('passes an unparseable value through so the form can report it', () => {
    expect(istInputToUtcIso('not-a-date')).toBe('not-a-date')
    expect(istInputToUtcIso('')).toBe('')
  })
})

describe('parseIstInputMs', () => {
  it('rejects impossible calendar dates rather than rolling them over', () => {
    expect(parseIstInputMs('2026-02-30T10:00')).toBeNull()
    expect(parseIstInputMs('2026-13-01T10:00')).toBeNull()
  })

  it('rejects anything that is not the datetime-local shape', () => {
    expect(parseIstInputMs('2026-10-10')).toBeNull()
    expect(parseIstInputMs('10/10/2026 16:53')).toBeNull()
  })
})
