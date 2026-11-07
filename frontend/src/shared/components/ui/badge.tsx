import { forwardRef, type ComponentPropsWithRef } from 'react'
import { cn } from '@/shared/lib/cn'
import { cva, type VariantProps } from 'class-variance-authority'

/*
 * `whitespace-nowrap` matters here: status chips sit in table cells and flex
 * rows, and a wrapped "In progress" reads as two states. `leading-5` pins the
 * line box so a chip never changes height when it lands next to plain text.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium leading-5',
  {
    variants: {
      variant: {
        neutral: 'bg-ink-faint/10 text-ink',
        brand: 'bg-brand-soft text-brand-text ring-1 ring-inset ring-brand-300/40',
        accent: 'bg-warning-soft text-warning',
        success: 'bg-success-soft text-success',
        warning: 'bg-warning-soft text-warning',
        danger: 'bg-danger-soft text-danger',
        info: 'bg-info-soft text-info',
        outline: 'border border-line text-ink',
      },
    },
    defaultVariants: {
      variant: 'neutral',
    },
  },
)

interface BadgeProps
  extends ComponentPropsWithRef<'span'>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean
}

function BadgeInner({ className, variant, dot, children, ...rest }: BadgeProps, ref: React.Ref<HTMLSpanElement>) {
  return (
    <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...rest}>
      {dot ? (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-current opacity-70"
        />
      ) : null}
      {children}
    </span>
  )
}

export const Badge = forwardRef(BadgeInner)