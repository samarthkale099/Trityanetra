import { useId } from 'react'
import { cn } from '@/shared/lib/cn'

interface LogoMarkProps {
  size?: number
  className?: string
}

/**
 * The three-eyed mark: gold linework on a polished black tile, edged with a
 * gold hairline so it holds its shape on the noir canvas as well as on ivory.
 * The gradients are scoped by `useId` so several marks on one page never share
 * (or clobber) a definition.
 */
export function LogoMark({ size = 32, className }: LogoMarkProps) {
  const gradientId = `tn-mark-${useId().replace(/:/g, '')}`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="Trityanetra"
      className={cn('drop-shadow-[0_4px_10px_rgb(var(--glow)/0.3)]', className)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2e2a23" />
          <stop offset="0.45" stopColor="#15130f" />
          <stop offset="1" stopColor="#070606" />
        </linearGradient>
        <linearGradient id={`${gradientId}-gold`} x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f0dda6" />
          <stop offset="0.5" stopColor="#d4af5a" />
          <stop offset="1" stopColor="#a8822f" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${gradientId})`} />
      <rect x="0.5" y="0.5" width="31" height="31" rx="8.5" fill="none" stroke="#d4af5a" strokeOpacity="0.45" />
      <g fill="none" stroke={`url(#${gradientId}-gold)`} strokeWidth="1.8">
        <circle cx="16" cy="11" r="4.2" />
        <circle cx="10.4" cy="20.5" r="4.2" />
        <circle cx="21.6" cy="20.5" r="4.2" />
      </g>
      <circle cx="16" cy="11" r="1.6" fill="#f6e7bb" />
      <circle cx="10.4" cy="20.5" r="1.6" fill="#f6f2e8" opacity="0.85" />
      <circle cx="21.6" cy="20.5" r="1.6" fill="#f6f2e8" opacity="0.85" />
    </svg>
  )
}

interface LogoProps {
  size?: number
  withWordmark?: boolean
  className?: string
  wordmarkClassName?: string
  markClassName?: string
}

export function Logo({ size = 32, withWordmark = true, className, wordmarkClassName, markClassName }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark size={size} className={markClassName} />
      {withWordmark ? (
        <span className={cn('font-display text-lg font-semibold tracking-tight text-ink-strong', wordmarkClassName)}>
          Trityanetra
        </span>
      ) : null}
    </span>
  )
}
