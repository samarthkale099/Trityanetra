import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '@/shared/lib/cn'

function SwitchInner(
  props: ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>,
  ref: React.Ref<HTMLButtonElement>,
) {
  const { className, ...rest } = props
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full',
        'border-2 border-transparent transition-all duration-250 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:bg-brand-gradient data-[state=checked]:shadow-glow-sm data-[state=unchecked]:bg-line-strong',
        className,
      )}
      {...rest}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          // The inset shadow is the knob's contact shadow: without it the white
          // circle floats on the track instead of sitting in it.
          'pointer-events-none block h-5 w-5 rounded-full bg-white shadow-sm',
          'transition-transform duration-400 ease-spring',
          'data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0',
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export const Switch = forwardRef(SwitchInner)