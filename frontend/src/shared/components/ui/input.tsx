import { forwardRef, type ComponentPropsWithRef } from 'react'
import { cn } from '@/shared/lib/cn'

/*
 * Field chrome is shared by Input, Textarea, Select and PasswordInput. They each
 * repeat these classes rather than compose a wrapper because each renders a
 * different element with its own box model, and a shared component would have to
 * forward refs and props through an extra DOM node.
 *
 * `hover:border-line-strong` gives a resting field a visible affordance without
 * a shadow, and the focus ring is the one defined by --ring.
 *
 * The error border must be keyed on `aria-[invalid=true]`, never a bare
 * `aria-[invalid]`. Tailwind compiles the arbitrary form to an attribute
 * *presence* selector -- `[aria-invalid]` -- and React renders `aria-invalid`
 * as the string "false" on a valid field, so the attribute is present and a
 * presence selector paints every field red from first paint.
 */
export const fieldClasses = [
  'w-full rounded-md border border-line bg-surface/70 text-sm text-ink-strong',
  'placeholder:text-ink-faint',
  'transition-[border-color,box-shadow,background-color] duration-250 ease-out',
  'hover:border-line-strong',
  // A soft violet halo rather than a hard offset ring: the field glows awake.
  'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-400/25 focus-visible:bg-surface',
  'focus-visible:border-brand-text',
  'disabled:cursor-not-allowed disabled:opacity-50',
  'aria-[invalid=true]:border-danger hover:aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger',
]

function InputInner(props: ComponentPropsWithRef<'input'>, ref: React.Ref<HTMLInputElement>) {
  const { className, type = 'text', ...rest } = props
  return <input ref={ref} type={type} className={cn(...fieldClasses, 'h-10 px-3 py-2', className)} {...rest} />
}

export const Input = forwardRef(InputInner)