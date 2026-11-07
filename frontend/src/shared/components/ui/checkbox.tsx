import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check } from 'lucide-react'
import { cn } from '@/shared/lib/cn'

function CheckboxInner(
  props: ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>,
  ref: React.Ref<HTMLButtonElement>,
) {
  const { className, ...rest } = props
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        // rounded-sm rather than rounded: a checkbox that shares the field
        // radius reads as a shrunk input, not as a checkable thing.
        'peer h-4 w-4 shrink-0 rounded-sm border border-line-strong bg-surface text-on-brand',
        'transition-all duration-250 hover:border-brand-400 active:scale-90',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:border-transparent data-[state=checked]:bg-brand-gradient data-[state=checked]:shadow-glow-sm',
        className,
      )}
      {...rest}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        <Check className="h-3 w-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export const Checkbox = forwardRef(CheckboxInner)