const CONTROL_CHAR_RE = /\p{Cc}/gu
const MULTI_SPACE_RE = /\s+/g

/** HTML entities for every character that can break out of text or an attribute context. */
const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
  '`': '&#x60;',
}

/**
 * URL schemes safe to put in an `href`/`src`. Everything else (`javascript:`,
 * `data:`, `vbscript:`, `blob:`) is rejected — `data:` in particular lets an
 * attacker smuggle markup through an image or anchor.
 */
const SAFE_URL_RE = /^(?:https?:|mailto:|tel:|\/|\.{0,2}\/|#|\?)/i

/** Strip control characters, collapse whitespace, trim. */
export function sanitizeText(value: string | unknown, maxLength = 300): string {
  return String(value ?? '')
    .replace(CONTROL_CHAR_RE, ' ')
    .replace(MULTI_SPACE_RE, ' ')
    .trim()
    .slice(0, maxLength)
}

/** Trim, lowercase, strip control characters. Does not validate format. */
export function sanitizeEmail(value: string | unknown): string {
  return sanitizeText(value, 320).toLowerCase()
}

/** Same as `sanitizeText` but capped at 80 characters. */
export function sanitizeDisplayName(value: string | unknown): string {
  return sanitizeText(value, 80)
}

/**
 * Escapes text for safe interpolation into HTML.
 *
 * React escapes by default, so this is only for the rare case where a string
 * must go into a raw HTML sink (e.g. a `srcdoc` in an iframe). Never pass the
 * result to `dangerouslySetInnerHTML` without this function.
 */
export function escapeHtml(value: string | unknown): string {
  return String(value ?? '').replace(/[&<>"'/`]/g, (char) => HTML_ESCAPES[char] ?? char)
}

/**
 * The single sanitizer for any user-supplied string that will be rendered.
 * Escapes markup, removes control characters, and caps the length.
 */
export function sanitizeForRender(value: string | unknown, maxLength = 500): string {
  return escapeHtml(String(value ?? '').replace(CONTROL_CHAR_RE, ' ')).slice(0, maxLength)
}

/**
 * Returns a URL only when its scheme is allow-listed, otherwise an empty string.
 * Attribute values still go through `escapeHtml`/`sanitizeForRender` before use.
 */
export function sanitizeUrl(value: string | unknown): string {
  const raw = String(value ?? '')
    .replace(CONTROL_CHAR_RE, '')
    .replace(MULTI_SPACE_RE, '')
    .trim()
  if (raw.length === 0 || raw.length > 2048) return ''
  return SAFE_URL_RE.test(raw) ? raw : ''
}

/**
 * Prepares source code for display. Indentation and newlines are meaningful, so
 * only null bytes and other control characters (except tab/LF/CR) are removed.
 * Never used for execution — display only.
 */
export function sanitizeCode(value: string | unknown, maxLength = 100_000): string {
  return String(value ?? '')
    .replace(/\p{Cc}/gu, (char) => (char === '\t' || char === '\n' || char === '\r' ? char : ''))
    .slice(0, maxLength)
}

/**
 * Normalises a free-text search term: lowercased, whitespace-collapsed, and
 * stripped of characters that would let a caller inject a query operator.
 */
export function sanitizeSearchTerm(value: string | unknown, maxLength = 80): string {
  return String(value ?? '')
    .replace(CONTROL_CHAR_RE, ' ')
    .replace(/[^\p{L}\p{N}\s._@'-]/gu, ' ')
    .replace(MULTI_SPACE_RE, ' ')
    .trim()
    .toLowerCase()
    .slice(0, maxLength)
}

/**
 * The college domain of an address: everything after the last `@`, trimmed and
 * lowercased. The register form asks only for an address, so the domain sent
 * with the payload is derived here rather than typed twice and checked for
 * agreement — there is no second source of truth to drift.
 *
 * Returns an empty string when there is no `@`; callers treat that as invalid.
 */
export function deriveCollegeDomain(email: string | unknown): string {
  const value = sanitizeEmail(email)
  const at = value.lastIndexOf('@')
  if (at < 0) return ''
  return value.slice(at + 1).trim().toLowerCase().replace(/\.$/, '')
}

/** True when `candidate` is the same as, or a subdomain of, `domain` (case-insensitive). */
export function isEmailDomainMatch(email: string, domain: string): boolean {
  const at = email.lastIndexOf('@')
  if (at < 0) return false
  const emailDomain = email.slice(at + 1).toLowerCase().replace(/\.$/, '')
  const wanted = domain.trim().toLowerCase().replace(/^@/, '').replace(/\.$/, '')
  if (emailDomain.length === 0 || wanted.length === 0) return false
  // An exact match is required, or a genuine subdomain of the college domain.
  // `evil-<domain>` and `<domain>.attacker.com` must both fail.
  return emailDomain === wanted || emailDomain.endsWith(`.${wanted}`)
}
