import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import { cn } from '@/shared/lib/cn'

function LabelInner(
  props: ComponentPropsWithoutRef<typeof LabelPrimitive.Root>,
  ref: React.Ref<HTMLLabelElement>,
) {
  const { className, ...rest } = props
  return (
    <LabelPrimitive.Root
      ref={ref}
      className={cn('text-sm font-medium text-ink-strong', className)}
      {...rest}
    />
  )
}

export const Label = forwardRef(LabelInner)