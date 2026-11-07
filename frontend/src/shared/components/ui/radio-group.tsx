import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { cn } from '@/shared/lib/cn'

interface RadioInnerProps extends ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root> {
  className?: string
}

function RadioGroupInner(props: RadioInnerProps, ref: React.Ref<HTMLDivElement>) {
  const { className, ...rest } = props
  return (
    <RadioGroupPrimitive.Root ref={ref} className={cn('grid gap-2', className)} {...rest} />
  )
}

export const RadioGroup = forwardRef(RadioGroupInner)

function RadioItemInner(
  props: ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>,
  ref: React.Ref<HTMLButtonElement>,
) {
  const { className, ...rest } = props
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      className={cn(
        'aspect-square h-4 w-4 rounded-full border border-line-strong bg-surface text-brand-text',
        'transition-colors duration-150 hover:border-brand-400',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:border-brand',
        className,
      )}
      {...rest}
    >
      <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
        <div className="h-2 w-2 rounded-full bg-brand" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}

export const RadioGroupItem = forwardRef(RadioItemInner)