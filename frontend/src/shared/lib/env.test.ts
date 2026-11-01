import { describe, expect, it } from 'vitest'
import { API_BASE_URL, API_TIMEOUT_MS, apiUrl } from '@/shared/lib/env'

describe('env configuration', () => {
  it('defaults to a same-origin API so the dev proxy handles /api', () => {
    // VITE_API_BASE_URL is unset in the test environment.
    expect(API_BASE_URL).toBe('')
  })

  it('has a positive, finite request timeout', () => {
    expect(API_TIMEOUT_MS).toBeGreaterThan(0)
    expect(Number.isFinite(API_TIMEOUT_MS)).toBe(true)
  })

  it('builds a path unchanged when no base URL is configured', () => {
    expect(apiUrl('/api/auth/me')).toBe('/api/auth/me')
  })

  it('does not lose a slash when a path has no leading slash', () => {
    expect(apiUrl('api/auth/me')).toBe('/api/auth/me')
  })
})
