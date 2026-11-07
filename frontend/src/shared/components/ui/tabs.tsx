import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/shared/lib/cn'

const Tabs = TabsPrimitive.Root
const TabsList = TabsPrimitive.List
const TabsContent = TabsPrimitive.Content

function TabsTriggerInner(
  props: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>,
  ref: React.Ref<HTMLButtonElement>,
) {
  const { className, ...rest } = props
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap border-b-2 border-transparent px-3 pb-2.5 pt-1 text-sm font-medium text-ink transition-all duration-250 ease-out hover:text-ink-strong',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text focus-visible:ring-offset-2',
        // Underline tabs rather than filled pills: they sit flush against the
        // panel below them, so they read as section switching, not as buttons.
        // `shadow-card` is the single exception to the no-resting-shadow rule
        // -- it is what makes the active tab read as lifted off the strip.
        'data-[state=active]:border-brand-400 data-[state=active]:text-ink-strong data-[state=active]:[text-shadow:0_0_16px_rgb(var(--glow)/0.3)]',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...rest}
    />
  )
}

export const TabsTrigger = forwardRef(TabsTriggerInner)

export { Tabs, TabsList, TabsContent }