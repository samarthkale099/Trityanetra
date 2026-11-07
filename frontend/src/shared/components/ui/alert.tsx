import { forwardRef, type ComponentPropsWithRef } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { cva, type VariantProps } from 'class-variance-authority'

const alertVariants = cva(
  'flex w-full items-start gap-3 rounded-md border px-4 py-3.5 text-sm',
  {
    variants: {
      variant: {
        // The `[&_svg]` selector tints the icon to match its variant while the
        // body copy stays in --ink-strong for AA contrast on every soft bg.
        info: 'border-info/25 bg-info-soft text-ink-strong [&_svg]:text-info',
        success: 'border-success/25 bg-success-soft text-ink-strong [&_svg]:text-success',
        warning: 'border-warning/30 bg-warning-soft text-ink-strong [&_svg]:text-warning',
        danger: 'border-danger/25 bg-danger-soft text-ink-strong [&_svg]:text-danger',
      },
    },
    defaultVariants: {
      variant: 'info',
    },
  },
)

interface AlertProps
  extends ComponentPropsWithRef<'div'>,
    VariantProps<typeof alertVariants> {
  title?: string
  icon?: LucideIcon
}

function AlertInner({ className, variant, title, icon: Icon, children, ...rest }: AlertProps, ref: React.Ref<HTMLDivElement>) {
  return (
    <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...rest}>
      {Icon ? (
        <span className="mt-px shrink-0" aria-hidden="true">
          <Icon className="h-4 w-4" />
        </span>
      ) : null}
      <div className="flex flex-col gap-1 min-w-0">
        {title ? <p className="text-sm font-semibold leading-tight">{title}</p> : null}
        <div className="text-sm leading-relaxed">{children}</div>
      </div>
    </div>
  )
}

export const Alert = forwardRef(AlertInner)