import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { fieldClasses } from '@/shared/components/ui/input'

const Select = SelectPrimitive.Root
const SelectGroup = SelectPrimitive.Group
const SelectValue = SelectPrimitive.Value

function SelectTriggerInner(
  props: ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>,
  ref: React.Ref<HTMLButtonElement>,
) {
  const { className, children, ...rest } = props
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(
        // Shares `fieldClasses` with Input so a form row of mixed control types
        // has one field height, one border treatment and one focus ring.
        ...fieldClasses,
        'flex h-10 items-center justify-between gap-2 px-3 py-2',
        'data-[placeholder]:text-ink-faint',
        className,
      )}
      {...rest}
    >
      {children}
      <SelectPrimitive.Icon className="text-ink-faint">
        <ChevronDown className="h-4 w-4" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

export const SelectTrigger = forwardRef(SelectTriggerInner)

function SelectContentInner(
  props: ComponentPropsWithoutRef<typeof SelectPrimitive.Content>,
  ref: React.Ref<HTMLDivElement>,
) {
  const { className, children, ...rest } = props
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        position="popper"
        className={cn(
          'pop-in z-50 min-w-[8rem] overflow-hidden rounded-md border border-line bg-surface-raised shadow-float',
          'max-h-[var(--radix-select-content-available-height)]',
          className,
        )}
        {...rest}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

export const SelectContent = forwardRef(SelectContentInner)

function SelectItemInner(
  props: ComponentPropsWithoutRef<typeof SelectPrimitive.Item>,
  ref: React.Ref<HTMLDivElement>,
) {
  const { className, children, ...rest } = props
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        'relative flex w-full cursor-default select-none items-center rounded-sm py-2 pl-8 pr-2 text-sm text-ink transition-colors duration-150 focus:bg-brand-soft focus:text-ink-strong data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...rest}
    >
      <span className="absolute left-2 flex items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-4 w-4 text-brand-text" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

export const SelectItem = forwardRef(SelectItemInner)

export { Select, SelectGroup, SelectValue }