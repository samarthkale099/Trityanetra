import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { cn } from '@/shared/lib/cn'

function AvatarInner(
  props: ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>,
  ref: React.Ref<HTMLSpanElement>,
) {
  const { className, ...rest } = props
  return (
    <AvatarPrimitive.Root
      ref={ref}
      className={cn(
        'relative flex h-9 w-9 shrink-0 overflow-hidden rounded-full bg-glow-gradient p-[1.5px] shadow-glow-sm',
        className,
      )}
      {...rest}
    />
  )
}

export const Avatar = forwardRef(AvatarInner)

function AvatarImageInner(
  props: ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>,
  ref: React.Ref<HTMLImageElement>,
) {
  const { className, ...rest } = props
  return (
    <AvatarPrimitive.Image
      ref={ref}
      className={cn('aspect-square h-full w-full rounded-full object-cover', className)}
      {...rest}
    />
  )
}

export const AvatarImage = forwardRef(AvatarImageInner)

interface AvatarFallbackProps extends ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback> {
  name?: string
}

function AvatarFallbackInner(
  { className, name, ...rest }: AvatarFallbackProps,
  ref: React.Ref<HTMLSpanElement>,
) {
  const initials = name
    ? name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join('')
    : '?'
  return (
    <AvatarPrimitive.Fallback
      ref={ref}
      className={cn(
        'flex h-full w-full items-center justify-center rounded-full bg-surface text-xs font-semibold text-brand-text',
        className,
      )}
      {...rest}
    >
      {initials}
    </AvatarPrimitive.Fallback>
  )
}

export const AvatarFallback = forwardRef(AvatarFallbackInner)