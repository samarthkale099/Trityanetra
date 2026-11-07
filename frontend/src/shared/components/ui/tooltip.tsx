import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/shared/lib/cn'

const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

function TooltipContentInner(
  props: ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>,
  ref: React.Ref<HTMLDivElement>,
) {
  const { className, sideOffset = 6, children, ...rest } = props
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          'pop-in z-50 overflow-hidden rounded-md border border-line bg-ink-strong px-2.5 py-1.5 text-xs font-medium text-canvas shadow-float',
          className,
        )}
        {...rest}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export const TooltipContent = forwardRef(TooltipContentInner)

export { TooltipProvider, Tooltip, TooltipTrigger }