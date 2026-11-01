export interface FirebaseIdTokenClaims {
  aud?: string
  exp?: number
  iat?: number
  iss?: string
  sub?: string
  email?: string
  email_verified?: boolean
  name?: string
  picture?: string
}

function base64UrlSegmentToJson(segment: string): Record<string, unknown> {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
}

/**
 * Decodes the payload of a Firebase ID token (a JWT) without verifying it.
 *
 * SECURITY: a client-side decode proves nothing — the signature is never
 * checked, so every value here is attacker-controlled if the token is. Only
 * the backend (`verifyIdToken`) can be trusted for identity, role, or college.
 * Use these helpers for display and refresh scheduling only.
 */
export function decodeIdTokenPayload(token: string): FirebaseIdTokenClaims {
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new Error('Malformed token.')
  }
  const payload = base64UrlSegmentToJson(parts[1])
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('Malformed token payload.')
  }
  return payload as FirebaseIdTokenClaims
}

/** Non-throwing variant of `decodeIdTokenPayload`; returns null instead of raising. */
export function tryDecodeIdTokenPayload(token: string | null | undefined): FirebaseIdTokenClaims | null {
  if (!token) return null
  try {
    return decodeIdTokenPayload(token)
  } catch {
    return null
  }
}

/** Expiration of the ID token in milliseconds.since epoch. 0 when absent. */
export function tokenExpirationMs(token: string): number {
  const { exp } = decodeIdTokenPayload(token)
  return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : 0
}

/** True when the token is missing, unparseable, or already expired. */
export function isTokenExpired(token: string | null | undefined): boolean {
  if (!token) return true
  try {
    const expiresAt = tokenExpirationMs(token)
    return expiresAt === 0 || expiresAt <= Date.now()
  } catch {
    return true
  }
}

/**
 * True when the token expires within `skewMs` (default 60s). Used to force a
 * proactive refresh before a request is sent, so a valid-but-about-to-expire
 * token is not the reason a call fails. A token with no `exp` counts as expiring.
 */
export function isTokenExpiringSoon(token: string | null | undefined, skewMs = 60_000): boolean {
  if (!token) return true
  const claims = tryDecodeIdTokenPayload(token)
  if (!claims) return true
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) return true
  return claims.exp * 1000 - skewMs <= Date.now()
}

/**
 * Returns a string safe to place in a log line: the first 6 characters plus a
 * length. Full tokens are credentials and must never be written to the console.
 */
export function redactToken(token: string | null | undefined): string {
  if (!token) return '<none>'
  return `<redacted:${token.length}>`
}
