import { describe, expect, it } from 'vitest'
import {
  deriveCollegeDomain,
  escapeHtml,
  isEmailDomainMatch,
  sanitizeCode,
  sanitizeDisplayName,
  sanitizeEmail,
  sanitizeForRender,
  sanitizeSearchTerm,
  sanitizeText,
  sanitizeUrl,
} from '@/shared/lib/sanitize'

describe('sanitizeText', () => {
  it('trims whitespace and collapses internal gaps', () => {
    expect(sanitizeText('  hello   world  ')).toBe('hello world')
  })

  it('strips control characters', () => {
    expect(sanitizeText('\u0000\u001Fabc\u007F')).toBe('abc')
  })

  it('respects the max length', () => {
    expect(sanitizeText('abcdefghij', 5)).toBe('abcde')
  })

  it('coerces null and undefined to an empty string', () => {
    expect(sanitizeText(null)).toBe('')
    expect(sanitizeText(undefined)).toBe('')
  })
})

describe('sanitizeEmail', () => {
  it('trims, lowercases, and strips control characters', () => {
    expect(sanitizeEmail('  alice@example.com  ')).toBe('alice@example.com')
    expect(sanitizeEmail('ADMIN@Org.COM')).toBe('admin@org.com')
  })
})

describe('sanitizeDisplayName', () => {
  it('caps to 80 characters', () => {
    expect(sanitizeDisplayName('A'.repeat(120))).toHaveLength(80)
  })
})

describe('escapeHtml', () => {
  it('neutralises every character that can break out of markup', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;&#x2F;script&gt;',
    )
  })

  it('escapes a single quote so it cannot terminate an attribute', () => {
    expect(escapeHtml("' onmouseover='x")).toBe('&#39; onmouseover=&#39;x')
  })

  it('escapes the backtick used by old IE-style attribute quoting', () => {
    expect(escapeHtml('`x`')).toBe('&#x60;x&#x60;')
  })
})

describe('sanitizeForRender', () => {
  it('escapes markup and strips control characters in one step', () => {
    expect(sanitizeForRender('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    )
  })

  it('replaces a control character with a space rather than deleting it', () => {
    // Deleting would silently join two words ("ab" from "a<NUL>b"), so the
    // character is replaced, matching sanitizeText.
    expect(sanitizeForRender('a\u0000b')).toBe('a b')
  })

  it('caps the length', () => {
    expect(sanitizeForRender('a'.repeat(50), 10)).toHaveLength(10)
  })

  it('renders a script payload inert when assigned to innerHTML', () => {
    const host = document.createElement('div')
    host.innerHTML = sanitizeForRender('<img src=x onerror="alert(1)">')
    expect(host.querySelector('img')).toBeNull()
    expect(host.textContent).toBe('<img src=x onerror="alert(1)">')
  })
})

describe('sanitizeUrl', () => {
  it('allows ordinary web and app-relative URLs', () => {
    expect(sanitizeUrl('https://example.com/x?y=1')).toBe('https://example.com/x?y=1')
    expect(sanitizeUrl('http://example.com')).toBe('http://example.com')
    expect(sanitizeUrl('mailto:a@b.com')).toBe('mailto:a@b.com')
    expect(sanitizeUrl('/app/dashboard')).toBe('/app/dashboard')
    expect(sanitizeUrl('#section')).toBe('#section')
  })

  it('blocks script-bearing schemes', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBe('')
    expect(sanitizeUrl('JavaScript:alert(1)')).toBe('')
    expect(sanitizeUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe('')
    expect(sanitizeUrl('vbscript:msgbox(1)')).toBe('')
  })

  it('blocks a scheme hidden behind whitespace or control characters', () => {
    expect(sanitizeUrl('java\tscript:alert(1)')).toBe('')
    expect(sanitizeUrl('java\nscript:alert(1)')).toBe('')
    expect(sanitizeUrl('  javascript:alert(1)')).toBe('')
  })

  it('rejects an over-long URL', () => {
    expect(sanitizeUrl(`https://example.com/${'a'.repeat(3000)}`)).toBe('')
  })

  it('rejects empty and non-string input', () => {
    expect(sanitizeUrl('')).toBe('')
    expect(sanitizeUrl(null)).toBe('')
  })
})

describe('sanitizeCode', () => {
  it('keeps tabs and newlines, which carry meaning in source code', () => {
    expect(sanitizeCode('if (a) {\n\tb()\n}')).toBe('if (a) {\n\tb()\n}')
  })

  it('strips null bytes and other control characters', () => {
    expect(sanitizeCode('a\u0000b\u0007c')).toBe('abc')
  })

  it('caps the length', () => {
    expect(sanitizeCode('a'.repeat(20), 5)).toBe('aaaaa')
  })
})

describe('sanitizeSearchTerm', () => {
  it('lowercases and collapses whitespace', () => {
    expect(sanitizeSearchTerm('  Data   Structures  ')).toBe('data structures')
  })

  it('drops characters that would let a caller inject a query operator', () => {
    expect(sanitizeSearchTerm('name$where{')).toBe('name where')
    expect(sanitizeSearchTerm('*')).toBe('')
  })

  it('keeps letters, digits, and the punctuation used in real names', () => {
    expect(sanitizeSearchTerm("O'Brien-Smith_2")).toBe("o'brien-smith_2")
  })
})

describe('isEmailDomainMatch', () => {
  it('accepts an exact match', () => {
    expect(isEmailDomainMatch('riya@mit.ac.in', 'mit.ac.in')).toBe(true)
  })

  it('accepts a genuine subdomain', () => {
    expect(isEmailDomainMatch('riya@cse.mit.ac.in', 'mit.ac.in')).toBe(true)
  })

  it('is case-insensitive and tolerates a leading @ and trailing dot', () => {
    expect(isEmailDomainMatch('riya@MIT.ac.in', '@mit.ac.in')).toBe(true)
    expect(isEmailDomainMatch('riya@mit.ac.in.', 'mit.ac.in')).toBe(true)
  })

  it('rejects a different college', () => {
    expect(isEmailDomainMatch('riya@other.edu', 'mit.ac.in')).toBe(false)
  })

  it('rejects a lookalike that merely contains the domain', () => {
    // The classic bypass: `evil-mit.ac.in` must not satisfy a `mit.ac.in` rule.
    expect(isEmailDomainMatch('riya@evil-mit.ac.in', 'mit.ac.in')).toBe(false)
    // ...and a domain that merely starts with the college domain.
    expect(isEmailDomainMatch('riya@mit.ac.in.evil.com', 'mit.ac.in')).toBe(false)
  })

  it('rejects an address with no domain or no @', () => {
    expect(isEmailDomainMatch('riya', 'mit.ac.in')).toBe(false)
    expect(isEmailDomainMatch('riya@', 'mit.ac.in')).toBe(false)
    expect(isEmailDomainMatch('riya@mit.ac.in', '')).toBe(false)
  })
})

describe('deriveCollegeDomain', () => {
  it('takes everything after the last @', () => {
    expect(deriveCollegeDomain('riya@mit.ac.in')).toBe('mit.ac.in')
    expect(deriveCollegeDomain('riya.cse@cse.mit.ac.in')).toBe('cse.mit.ac.in')
  })

  it('trims and lowercases the address first', () => {
    expect(deriveCollegeDomain('  RIYA@MIT.AC.IN  ')).toBe('mit.ac.in')
    expect(deriveCollegeDomain('\tRiya.Sec@Mit.AC.In\n')).toBe('mit.ac.in')
  })

  it('drops a trailing root dot', () => {
    expect(deriveCollegeDomain('riya@mit.ac.in.')).toBe('mit.ac.in')
  })

  it('returns an empty string when there is no @ to split on', () => {
    expect(deriveCollegeDomain('riya')).toBe('')
    expect(deriveCollegeDomain('riya@')).toBe('')
    expect(deriveCollegeDomain(undefined)).toBe('')
    expect(deriveCollegeDomain(null)).toBe('')
  })
})
