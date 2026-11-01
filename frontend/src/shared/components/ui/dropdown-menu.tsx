import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { cn } from '@/shared/lib/cn'

const DropdownMenu = Dropdown.Root
const DropdownMenuTrigger = Dropdown.Trigger
const DropdownMenuGroup = Dropdown.Group
const DropdownMenuSeparator = Dropdown.Separator
const DropdownMenuLabel = Dropdown.Label

function DropdownMenuContentInner(
  props: ComponentPropsWithoutRef<typeof Dropdown.Content>,
  ref: React.Ref<HTMLDivElement>,
) {
  const { className, children, ...rest } = props
  return (
    <Dropdown.Portal>
      <Dropdown.Content
        ref={ref}
        collisionPadding={8}
        className={cn(
          'pop-in z-50 min-w-[10rem] overflow-hidden rounded-lg border border-line bg-surface-raised p-1 shadow-float',
          className,
        )}
        {...rest}
      >
        {children}
      </Dropdown.Content>
    </Dropdown.Portal>
  )
}

export const DropdownMenuContent = forwardRef(DropdownMenuContentInner)

function DropdownMenuItemInner(
  props: ComponentPropsWithoutRef<typeof Dropdown.Item>,
  ref: React.Ref<HTMLDivElement>,
) {
  const { className, ...rest } = props
  return (
    <Dropdown.Item
      ref={ref}
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2.5 py-2 text-sm text-ink outline-none',
        'focus:bg-brand-soft focus:text-ink-strong',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...rest}
    />
  )
}

export const DropdownMenuItem = forwardRef(DropdownMenuItemInner)

function DropdownMenuCheckboxItemInner(
  props: ComponentPropsWithoutRef<typeof Dropdown.CheckboxItem>,
  ref: React.Ref<HTMLDivElement>,
) {
  const { className, ...rest } = props
  return (
    <Dropdown.CheckboxItem
      ref={ref}
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2.5 py-2 text-sm text-ink outline-none',
        'focus:bg-brand-soft focus:text-ink-strong',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...rest}
    />
  )
}

export const DropdownMenuCheckboxItem = forwardRef(DropdownMenuCheckboxItemInner)

function DropdownMenuItemIndicatorInner(
  props: ComponentPropsWithoutRef<typeof Dropdown.ItemIndicator>,
  ref: React.Ref<HTMLSpanElement>,
) {
  const { className, children, ...rest } = props
  return (
    <Dropdown.ItemIndicator ref={ref} className={className} {...rest}>
      {children}
    </Dropdown.ItemIndicator>
  )
}

export const DropdownMenuItemIndicator = forwardRef(DropdownMenuItemIndicatorInner)

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuGroup,
  DropdownMenuSeparator,
  DropdownMenuLabel,
}