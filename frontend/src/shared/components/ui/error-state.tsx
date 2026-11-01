import type { LucideIcon } from 'lucide-react'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button, type ButtonProps } from '@/shared/components/ui/button'

interface ErrorStateProps {
  icon?: LucideIcon
  title?: string
  message?: string
  onRetry?: () => void
  retryLabel?: string
  /**
   * Extra button, for when the useful way out is not "try again" — e.g. a
   * closed exam offering a way back to its lobby. Same shape as `EmptyState`'s
   * action, so the two read the same at the call site. `onRetry` and `action` are
   * independent; pass whichever applies.
   */
  action?: ButtonProps & { label: string }
  className?: string
}

export function ErrorState({
  icon: Icon = AlertTriangle,
  title = 'Something went wrong',
  message = 'The request failed or the server is unavailable. Try again in a moment.',
  onRetry,
  retryLabel = 'Try again',
  action,
  className,
}: ErrorStateProps) {
  const retryProps: Partial<ButtonProps> = onRetry
    ? { onClick: onRetry }
    : {}
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-4 px-6 py-16 text-center',
        className,
      )}
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-danger/25 bg-danger-soft shadow-card">
        <Icon className="h-6 w-6 text-danger" aria-hidden="true" />
      </div>
      <div className="flex max-w-sm flex-col gap-1.5">
        <h3 className="font-serif text-2xl font-medium text-ink-strong">{title}</h3>
        <p className="text-sm text-ink">{message}</p>
      </div>
      {action ? (
        <Button variant={action.variant ?? 'primary'} size={action.size ?? 'md'} {...action}>
          {action.label}
        </Button>
      ) : onRetry ? (
        <Button variant="secondary" {...retryProps}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  )
}