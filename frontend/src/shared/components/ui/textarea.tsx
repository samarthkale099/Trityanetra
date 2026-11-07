import { forwardRef, type ComponentPropsWithRef } from 'react'
import { cn } from '@/shared/lib/cn'
import { fieldClasses } from '@/shared/components/ui/input'

function TextareaInner(
  props: ComponentPropsWithRef<'textarea'>,
  ref: React.Ref<HTMLTextAreaElement>,
) {
  const { className, ...rest } = props
  return (
    <textarea
      ref={ref}
      className={cn(...fieldClasses, 'flex min-h-[80px] px-3 py-2 leading-relaxed', className)}
      {...rest}
    />
  )
}

export const Textarea = forwardRef(TextareaInner)