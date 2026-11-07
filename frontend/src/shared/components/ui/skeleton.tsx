import { type ComponentPropsWithRef } from 'react'
import { cn } from '@/shared/lib/cn'

export function Skeleton({ className, ...rest }: ComponentPropsWithRef<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        // The travelling gradient in index.css rather than Tailwind's
        // `animate-pulse`: a whole block blinking in and out reads as "the
        // page is broken", a shimmer reads as "content is on its way".
        'skeleton-shimmer rounded-md bg-ink-faint/15',
        className,
      )}
      {...rest}
    />
  )
}