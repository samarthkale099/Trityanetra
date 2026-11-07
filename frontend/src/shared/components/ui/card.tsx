import { forwardRef, type ComponentPropsWithRef, type HTMLAttributes, type PointerEvent } from 'react'
import { cn } from '@/shared/lib/cn'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Off the page plane: for a card that is genuinely above its neighbours
   * (a modal's inner panel, the auth form). Off by default, because the design
   * system wants borders -- not shadows -- to define resting content.
   */
  elevated?: boolean
  /**
   * A card that is also a target (a clickable test row, a classroom tile).
   * Adds a hover state and keyboard focus ring. Only set this where the card is
   * genuinely interactive; a decorative card should never look clickable.
   */
  interactive?: boolean
}

/** Largest lean, in degrees. Enough to feel weight, never enough to spin. */
const MAX_TILT = 3

/*
 * Pointer tracking for the 3D tilt. It only writes four CSS variables; the
 * transform, glare and easing all live in `.tilt` / `.tilt-glare` (index.css),
 * which also switch the effect off for reduced-motion users. Touch input is
 * ignored -- a finger is not a light source.
 */
function trackTilt(event: PointerEvent<HTMLDivElement>) {
  if (event.pointerType !== 'mouse') return
  const el = event.currentTarget
  const rect = el.getBoundingClientRect()
  const x = (event.clientX - rect.left) / rect.width
  const y = (event.clientY - rect.top) / rect.height
  el.style.setProperty('--ry', `${((x - 0.5) * 2 * MAX_TILT).toFixed(2)}deg`)
  el.style.setProperty('--rx', `${((0.5 - y) * 2 * MAX_TILT).toFixed(2)}deg`)
  el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`)
  el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`)
}

function resetTilt(event: PointerEvent<HTMLDivElement>) {
  const el = event.currentTarget
  el.style.setProperty('--rx', '0deg')
  el.style.setProperty('--ry', '0deg')
}

function CardInner(
  { className, elevated = false, interactive = false, onPointerMove, onPointerLeave, ...rest }: CardProps,
  ref: React.Ref<HTMLDivElement>,
) {
  return (
    <div
      ref={ref}
      className={cn(
        // A solid surface with the shared top-edge sheen: no backdrop blur, so a
        // page of cards stays cheap to paint.
        'surface-sheen rounded-lg border border-line text-ink-strong shadow-card',
        elevated && 'shadow-lift',
        interactive && 'tilt tilt-glare glow-border glow-border-hover cursor-pointer hover:shadow-lift',
        className,
      )}
      onPointerMove={(event) => {
        if (interactive) trackTilt(event)
        onPointerMove?.(event)
      }}
      onPointerLeave={(event) => {
        if (interactive) resetTilt(event)
        onPointerLeave?.(event)
      }}
      {...rest}
    />
  )
}

export const Card = forwardRef(CardInner)

function CardHeaderInner(
  props: HTMLAttributes<HTMLDivElement>,
  ref: React.Ref<HTMLDivElement>,
) {
  const { className, ...rest } = props
  return (
    <div
      ref={ref}
      className={cn('flex flex-col gap-1.5 border-b border-line px-6 pb-5 pt-6', className)}
      {...rest}
    />
  )
}

export const CardHeader = forwardRef(CardHeaderInner)

function CardBodyInner(props: HTMLAttributes<HTMLDivElement>, ref: React.Ref<HTMLDivElement>) {
  const { className, ...rest } = props
  return <div ref={ref} className={cn('p-6', className)} {...rest} />
}

export const CardBody = forwardRef(CardBodyInner)

function CardFooterInner(props: HTMLAttributes<HTMLDivElement>, ref: React.Ref<HTMLDivElement>) {
  const { className, ...rest } = props
  return (
    <div
      ref={ref}
      className={cn('flex items-center gap-3 border-t border-line px-6 pb-5 pt-5', className)}
      {...rest}
    />
  )
}

export const CardFooter = forwardRef(CardFooterInner)

function CardTitleInner(props: HTMLAttributes<HTMLHeadingElement>, ref: React.Ref<HTMLHeadingElement>) {
  const { className, ...rest } = props
  return (
    <h3
      ref={ref}
      className={cn('text-lg font-semibold leading-snug', className)}
      {...rest}
    />
  )
}

export const CardTitle = forwardRef(CardTitleInner)

function CardDescriptionInner(
  props: ComponentPropsWithRef<'p'>,
  ref: React.Ref<HTMLParagraphElement>,
) {
  const { className, ...rest } = props
  return <p ref={ref} className={cn('text-sm leading-relaxed text-ink', className)} {...rest} />
}

export const CardDescription = forwardRef(CardDescriptionInner)