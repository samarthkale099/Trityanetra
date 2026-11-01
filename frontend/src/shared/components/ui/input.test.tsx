import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { Input, fieldClasses } from '@/shared/components/ui/input'

/*
 * The red border must mean "this field is in error" and nothing else.
 *
 * The invalid variant used to be `aria-[invalid]`, which Tailwind compiles to an
 * attribute *presence* selector (`[aria-invalid]`). A valid field still carries
 * `aria-invalid="false"`, so the selector matched on every field and painted it
 * with the danger border from first paint -- Login, Register and the student join
 * code all looked broken while empty and untouched.
 *
 * These two cases pin both halves of the contract: the class must require
 * `="true"`, and an untouched element must actually report `="false"`.
 */
describe('field chrome', () => {
  it('keys the error border on aria-invalid="true", never on the attribute merely being present', () => {
    const invalidTokens = fieldClasses.filter((token) => token.includes('invalid'))
    expect(invalidTokens).not.toHaveLength(0)
    for (const token of invalidTokens) {
      expect(token).toContain('aria-[invalid=true]')
      expect(token).not.toContain('aria-[invalid]:')
    }
  })

  it('gives an untouched input a neutral border and no error border', () => {
    render(<Input aria-invalid={false} />)
    const input = screen.getByRole('textbox')

    expect(input).toHaveAttribute('aria-invalid', 'false')
    expect(input).toHaveClass('border-line')
    expect(input).toHaveClass('hover:border-line-strong')
    expect(input).toHaveClass('focus-visible:border-brand-text')
  })
})
