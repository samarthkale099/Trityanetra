import type { LucideIcon } from 'lucide-react'
import { FolderOpen } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button, type ButtonProps } from '@/shared/components/ui/button'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ButtonProps & { label: string }
  className?: string
}

export function EmptyState({
  icon: Icon = FolderOpen,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col items-center justify-center gap-4 px-6 py-16 text-center',
        className,
      )}
    >
      {/*
        A small line drawing rather than a bare icon: the icon sits on a black
        medallion inside two hairline orbits, with a gold star caught on the
        outer one. All strokes use `currentColor`/tokens so it holds in both
        schemes; the whole piece floats gently and the orbits turn very slowly.
      */}
      <div className="relative flex h-36 w-36 items-center justify-center" aria-hidden="true">
        <svg viewBox="0 0 144 144" className="absolute inset-0 h-full w-full text-line-strong">
          <circle cx="72" cy="72" r="70" fill="none" stroke="currentColor" strokeDasharray="2 6" />
          <g className="origin-center animate-[spin_60s_linear_infinite] motion-reduce:animate-none">
            <circle cx="72" cy="72" r="52" fill="none" stroke="currentColor" strokeOpacity="0.8" />
            <path
              d="M72 14 l2.2 5.3 5.3 2.2 -5.3 2.2 -2.2 5.3 -2.2 -5.3 -5.3 -2.2 5.3 -2.2z"
              transform="translate(0 6)"
              className="fill-brand-400"
            />
            <circle cx="124" cy="72" r="2" className="fill-brand-400/60" />
          </g>
        </svg>
        <div className="relative flex h-16 w-16 animate-float items-center justify-center rounded-2xl border border-[#d4af5a]/30 bg-[linear-gradient(160deg,#2e2a23,#0c0b09)] shadow-[0_12px_28px_-10px_rgb(0_0_0/0.5),inset_0_1px_0_rgb(255_248_230/0.08)]">
          <Icon className="h-6 w-6 text-[#e3c67f]" />
        </div>
      </div>
      <div className="flex max-w-sm flex-col gap-1.5">
        <h3 className="font-serif text-2xl font-medium text-ink-strong">{title}</h3>
        {description ? (
          <p className="text-sm leading-relaxed text-ink">{description}</p>
        ) : null}
      </div>
      {action ? (
        <Button variant={action.variant ?? 'primary'} size={action.size ?? 'md'} {...action}>
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}