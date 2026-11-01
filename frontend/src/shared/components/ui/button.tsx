import { forwardRef, type ComponentPropsWithoutRef, type Ref } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/shared/lib/cn'

/*
 * Every interactive state change runs on the same decelerate curve
 * (--ease-out), so the app feels like one surface rather than a pile of
 * components. Hover lifts by a pixel and blooms a glow; a press sinks back
 * (`active:scale`) so it visibly commits before the pointer leaves.
 */
const buttonVariants = cva(
  [
    'relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-250 ease-out active:scale-[0.97]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
    'disabled:pointer-events-none disabled:opacity-50',
  ].join(' '),
  {
    variants: {
      variant: {
        // Polished black in light mode, brushed gold in noir (see --gradient-brand).
        // `text-on-brand` flips with it, so contrast holds in both. On hover a
        // single highlight sweeps across the fill and a soft gold halo blooms.
        primary:
          'sheen-sweep bg-brand-gradient text-on-brand shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_2px_rgba(0,0,0,0.2)] hover:-translate-y-px hover:shadow-glow',
        secondary:
          'border border-line bg-surface text-ink-strong hover:-translate-y-px hover:border-brand-400/50 hover:bg-brand-soft hover:shadow-card active:bg-brand-100',
        outline:
          'border border-line bg-transparent text-ink hover:border-line-strong hover:bg-brand-soft active:bg-brand-100',
        ghost: 'bg-transparent text-ink hover:bg-brand-soft active:bg-brand-100',
        danger:
          'bg-danger text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] hover:-translate-y-px hover:bg-danger/90 hover:shadow-[0_8px_24px_-6px_rgb(220_38_38/0.5)] focus-visible:ring-danger dark:text-canvas',
        link: 'h-auto rounded-sm p-0 text-brand-text underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4',
        lg: 'h-12 rounded-lg px-7 text-md',
        icon: 'h-10 w-10 p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
)

export interface ButtonProps
  extends ComponentPropsWithoutRef<'button'>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

function ButtonInner(props: ButtonProps, ref: Ref<HTMLButtonElement>) {
  const { className, variant, size, asChild = false, ...rest } = props
  const Component = asChild ? Slot : 'button'
  return <Component ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...rest} />
}

export const Button = forwardRef(ButtonInner)
export { buttonVariants }