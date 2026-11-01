import { forwardRef, useState, type ComponentPropsWithRef } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { fieldClasses } from '@/shared/components/ui/input'

export interface PasswordInputProps extends Omit<ComponentPropsWithRef<'input'>, 'type'> {
  /** Visible label for the toggle; announced as its accessible name. */
  toggleLabel?: string
  id?: string
}

/**
 * Password field with a show/hide toggle.
 *
 * The toggle is a real `<button type="button">` (not a click handler on the
 * icon) so it is reachable by keyboard and exposed to assistive tech with a
 * name and a pressed state.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { className, toggleLabel = 'Show password', id, ...rest },
  ref,
) {
  const [visible, setVisible] = useState(false)
  const controlId = id ?? rest.name

  return (
    <div className="relative">
      <input
        {...rest}
        id={controlId}
        ref={ref}
        type={visible ? 'text' : 'password'}
className={cn(...fieldClasses, 'h-10 px-3 py-2 pr-11', className)}
    />
    <button
      type="button"
      // Only meaningful when the control has an id to point back at.
      aria-controls={controlId}
      aria-label={visible ? 'Hide password' : toggleLabel}
      aria-pressed={visible}
      disabled={rest.disabled}
      onClick={() => setVisible((prev) => !prev)}
      className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-md text-ink-faint transition-colors duration-150 hover:text-ink-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text"
    >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  )
})
