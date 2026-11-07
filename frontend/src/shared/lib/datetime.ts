/**
 * One place for every date and time a person reads, and for converting the
 * teacher's window input.
 *
 * The product speaks Indian Standard Time. Asia/Kolkata is UTC+05:30 with no
 * daylight saving, so the offset is a constant and every conversion below is
 * exact arithmetic rather than a zone lookup that would depend on where the
 * computer is set.
 *
 * Stored and transported timestamps stay UTC ISO-8601 (`windowStart`,
 * `submittedAt`, ...); only the rendering, and what a teacher types into the
 * window fields, is IST. Nothing here touches the server clock or the
 * countdowns, which measure elapsed time and are already zone-free.
 */

/** IANA zone used for every user-facing time. */
export const IST_TIME_ZONE = 'Asia/Kolkata'

/** IST is UTC+05:30 all year: no daylight-saving rule ever applies. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

const IST_SUFFIX = 'IST'

const DATE_TIME = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: IST_TIME_ZONE,
})

const DATE_ONLY = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeZone: IST_TIME_ZONE,
})

const TIME_ONLY = new Intl.DateTimeFormat('en-IN', {
  timeStyle: 'short',
  timeZone: IST_TIME_ZONE,
})

type DateInput = string | number | Date

/** Epoch milliseconds for a value we can read, otherwise `null`. */
function toMs(value: DateInput): number | null {
  const ms =
    value instanceof Date
      ? value.getTime()
      : typeof value === 'number'
        ? value
        : Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

const pad = (value: number) => String(value).padStart(2, '0')

/**
 * `10 Oct 2026, 4:53 pm IST`. The `fallback` is returned verbatim when the
 * value cannot be read, so a caller can keep a sentence readable rather than
 * printing `Invalid Date`.
 */
export function formatIST(value: DateInput, fallback = 'Unavailable'): string {
  const ms = toMs(value)
  return ms === null ? fallback : `${DATE_TIME.format(ms)} ${IST_SUFFIX}`
}

/** `10 Oct 2026` - a calendar date has no clock, so it carries no zone suffix. */
export function formatISTDate(value: DateInput, fallback = 'Unavailable'): string {
  const ms = toMs(value)
  return ms === null ? fallback : DATE_ONLY.format(ms)
}

/** `4:53 pm IST` - a wall-clock time on its own. */
export function formatISTTime(value: DateInput, fallback = 'Unavailable'): string {
  const ms = toMs(value)
  return ms === null ? fallback : `${TIME_ONLY.format(ms)} ${IST_SUFFIX}`
}

/**
 * Epoch milliseconds for a `YYYY-MM-DDTHH:mm` (optionally `:ss`) wall-clock
 * string that means IST, or `null` when the shape is not a datetime-local value.
 *
 * The string carries no zone of its own, so the components are read and the
 * offset subtracted directly. `Date.parse` is deliberately not used: it would
 * read the same string in the computer's own zone and move the instant.
 */
export function parseIstInputMs(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match
  const utcMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    second ? Number(second) : 0,
  )
  // Date.UTC rolls an impossible date (31 Feb) into the next month instead of
  // failing, so compare the normalised components back and reject any that moved.
  const check = new Date(utcMs)
  const moved =
    check.getUTCFullYear() !== Number(year) ||
    check.getUTCMonth() !== Number(month) - 1 ||
    check.getUTCDate() !== Number(day) ||
    check.getUTCHours() !== Number(hour) ||
    check.getUTCMinutes() !== Number(minute)
  return moved ? null : utcMs - IST_OFFSET_MS
}

/** ISO-8601 UTC -> `YYYY-MM-DDTHH:mm` in IST, the shape `datetime-local` wants. */
export function utcIsoToIstInput(iso: string): string {
  const ms = toMs(iso)
  if (ms === null) return ''
  const shifted = new Date(ms + IST_OFFSET_MS)
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
}

/**
 * `YYYY-MM-DDTHH:mm` typed by a teacher in IST -> ISO-8601 UTC for the server.
 * An unparseable value is returned unchanged so the form still surfaces its own
 * "Enter a valid date and time" message.
 */
export function istInputToUtcIso(value: string): string {
  const ms = parseIstInputMs(value)
  return ms === null ? value : new Date(ms).toISOString()
}
