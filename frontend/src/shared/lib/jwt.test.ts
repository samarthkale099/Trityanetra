import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  decodeIdTokenPayload,
  isTokenExpired,
  isTokenExpiringSoon,
  redactToken,
  tokenExpirationMs,
  tryDecodeIdTokenPayload,
} from '@/shared/lib/jwt'

function b64url(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function makeToken(payload: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  return `${header}.${body}.signature`
}

describe('jwt helpers', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('decodes the payload of a Firebase ID token', () => {
    const token = makeToken({ sub: 'u-1', email: 'a@example.com', exp: 9999999999 })
    const decoded = decodeIdTokenPayload(token)
    expect(decoded.sub).toBe('u-1')
    expect(decoded.email).toBe('a@example.com')
  })

  it('reads the expiry in milliseconds', () => {
    expect(tokenExpirationMs(makeToken({ exp: 1700000000 }))).toBe(1700000000 * 1000)
  })

  it('treats missing, malformed, and expired tokens as expired', () => {
    expect(isTokenExpired(null)).toBe(true)
    expect(isTokenExpired(undefined)).toBe(true)
    expect(isTokenExpired('garbage')).toBe(true)
    expect(isTokenExpired(makeToken({ exp: 1 }))).toBe(true)
    expect(isTokenExpired(makeToken({}))).toBe(true)
    expect(isTokenExpired(makeToken({ exp: Math.floor(Date.now() / 1000) + 3600 }))).toBe(false)
  })

  it('rejects a token whose payload is not an object', () => {
    // `alg: none` style forgery: the payload must not be an array or a scalar.
    const header = b64url(JSON.stringify({ alg: 'none' }))
    expect(() => decodeIdTokenPayload(`${header}.${b64url('"a-string"')}.sig`)).toThrow(/Malformed/)
    expect(() => decodeIdTokenPayload(`${header}.${b64url('[1,2,3]')}.sig`)).toThrow(/Malformed/)
  })

  it('rejects a token with the wrong number of segments', () => {
    expect(() => decodeIdTokenPayload('only.two')).toThrow(/Malformed token/)
  })

  it('returns null instead of throwing from the non-throwing variant', () => {
    expect(tryDecodeIdTokenPayload('garbage')).toBeNull()
    expect(tryDecodeIdTokenPayload(null)).toBeNull()
    expect(tryDecodeIdTokenPayload(makeToken({ sub: 'u-9' }))?.sub).toBe('u-9')
  })

  it('treats a token with no exp as expiring soon, so it is refreshed rather than trusted', () => {
    expect(isTokenExpiringSoon(makeToken({ sub: 'u-1' }))).toBe(true)
    expect(isTokenExpiringSoon('garbage')).toBe(true)
    expect(isTokenExpiringSoon(null)).toBe(true)
  })

  it('flags a token that is still valid but inside the refresh window', () => {
    const expiringSoon = Math.floor(Date.now() / 1000) + 30
    const comfortable = Math.floor(Date.now() / 1000) + 3600
    expect(isTokenExpiringSoon(makeToken({ exp: expiringSoon }))).toBe(true)
    expect(isTokenExpiringSoon(makeToken({ exp: comfortable }))).toBe(false)
  })

  it('honours a custom skew', () => {
    const exp = Math.floor(Date.now() / 1000) + 120
    expect(isTokenExpiringSoon(makeToken({ exp }), 30_000)).toBe(false)
    expect(isTokenExpiringSoon(makeToken({ exp }), 300_000)).toBe(true)
  })

  it('redacts a token so it can never reach a log verbatim', () => {
    const secret = 'eyJhbGciOiJIUzI1NiJ9.payload.signature'
    const redacted = redactToken(secret)
    expect(redacted).not.toContain(secret)
    expect(redacted).not.toContain('payload')
    expect(redactToken(null)).toBe('<none>')
  })

  it('ignores a non-numeric exp instead of producing NaN', () => {
    expect(tokenExpirationMs(makeToken({ exp: 'soon' }))).toBe(0)
    expect(tokenExpirationMs(makeToken({ exp: Number.POSITIVE_INFINITY }))).toBe(0)
  })
})
