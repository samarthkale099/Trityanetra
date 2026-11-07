import { describe, expect, it } from 'vitest'
import { loginSchema, passwordResetSchema, registerSchema } from '@/features/auth/schemas'
import { deriveCollegeDomain } from '@/shared/lib/sanitize'

const valid = {
  displayName: 'Riya Sharma',
  email: 'riya@mit.ac.in',
  password: 'secret123',
}

describe('loginSchema', () => {
  it('accepts valid credentials', () => {
    expect(loginSchema.safeParse({ email: 'riya@mit.ac.in', password: 'secret123' }).success).toBe(true)
  })

  it('rejects a malformed email', () => {
    const result = loginSchema.safeParse({ email: 'not-an-email', password: 'secret123' })
    expect(result.success).toBe(false)
  })

  it('rejects an empty password', () => {
    const result = loginSchema.safeParse({ email: 'riya@mit.ac.in', password: '' })
    expect(result.success).toBe(false)
  })

  it('rejects an address with no dotted domain', () => {
    expect(loginSchema.safeParse({ email: 'riya@localhost', password: 'secret123' }).success).toBe(false)
    expect(loginSchema.safeParse({ email: 'riya@127.0.0.1', password: 'secret123' }).success).toBe(true)
  })

  it('normalises case and surrounding whitespace', () => {
    const result = loginSchema.safeParse({ email: '  RIYA@MIT.AC.IN  ', password: 'secret123' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.email).toBe('riya@mit.ac.in')
  })

  it('rejects an over-long email', () => {
    const result = loginSchema.safeParse({ email: `${'a'.repeat(320)}@mit.ac.in`, password: 'secret123' })
    expect(result.success).toBe(false)
  })
})

describe('registerSchema', () => {
  it('accepts a valid registration', () => {
    const result = registerSchema.safeParse({
      displayName: '  Riya   Sharma ',
      email: 'RIYA@mit.ac.in',
      password: 'secret123',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.displayName).toBe('Riya Sharma')
      expect(result.data.email).toBe('riya@mit.ac.in')
    }
  })

  /**
   * The domain is no longer an input, so nothing a client declares can
   * contradict the address: the schema has no key for it, and a stale one left
   * in an older payload is dropped rather than trusted.
   */
  it('carries no collegeDomain key of its own', () => {
    const result = registerSchema.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) expect('collegeDomain' in result.data).toBe(false)

    const stale = registerSchema.safeParse({ ...valid, collegeDomain: 'somewhere-else.example' })
    expect(stale.success).toBe(true)
    if (stale.success) expect('collegeDomain' in stale.data).toBe(false)
  })

  it('rejects a one-character name', () => {
    expect(registerSchema.safeParse({ ...valid, displayName: 'R' }).success).toBe(false)
  })

  it('rejects a short password', () => {
    expect(registerSchema.safeParse({ ...valid, password: 'short' }).success).toBe(false)
  })

  it('rejects an over-long password', () => {
    expect(registerSchema.safeParse({ ...valid, password: 'a'.repeat(129) }).success).toBe(false)
  })

  it('rejects an email whose domain has no dot', () => {
    expect(registerSchema.safeParse({ ...valid, email: 'riya@localhost' }).success).toBe(false)
  })

  it('rejects an email whose domain label starts or ends with a hyphen', () => {
    expect(registerSchema.safeParse({ ...valid, email: 'riya@-mit.ac.in' }).success).toBe(false)
    expect(registerSchema.safeParse({ ...valid, email: 'riya@mit-.ac.in' }).success).toBe(false)
  })

  describe('derived college email domain', () => {
    it('accepts a college address with no separately declared domain', () => {
      expect(registerSchema.safeParse(valid).success).toBe(true)
    })

    it('accepts an address on a subdomain of the college domain', () => {
      expect(registerSchema.safeParse({ ...valid, email: 'riya@cse.mit.ac.in' }).success).toBe(true)
    })

    it('derives the domain from the part after the @', () => {
      // What the payload carries: trimmed, lowercased, nothing else guessed.
      expect(deriveCollegeDomain(' RIYA@MIT.AC.IN ')).toBe('mit.ac.in')
      expect(deriveCollegeDomain('riya@cse.mit.ac.in')).toBe('cse.mit.ac.in')
      expect(deriveCollegeDomain('no-at-sign')).toBe('')
    })

    it('rejects an address that is not formatted as an email', () => {
      const result = registerSchema.safeParse({ ...valid, email: 'riya@not-an-email' })
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error.issues[0]?.message).toMatch(/formatted correctly/i)
    })

    it('shows a friendly error when the derived domain is not a college host', () => {
      const result = registerSchema.safeParse({ ...valid, email: 'riya@my_college.edu' })
      expect(result.success).toBe(false)
      if (!result.success) {
        const emailIssue = result.error.issues.find((issue) => issue.path[0] === 'email')
        expect(emailIssue?.message).toMatch(/don't recognise that email domain/i)
      }
    })
  })
})

describe('passwordResetSchema', () => {
  it('accepts a valid address and rejects a malformed one', () => {
    expect(passwordResetSchema.safeParse({ email: 'riya@mit.ac.in' }).success).toBe(true)
    expect(passwordResetSchema.safeParse({ email: 'nope' }).success).toBe(false)
  })
})
