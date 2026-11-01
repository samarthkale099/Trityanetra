import { forwardRef, type ComponentPropsWithRef, type HTMLAttributes, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/components/ui/button'
import { LogOut } from 'lucide-react'

interface SidebarProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode
  footer?: ReactNode
}

function SidebarInner({ className, children, footer, ...rest }: SidebarProps, ref: React.Ref<HTMLElement>) {
  return (
    <aside
      ref={ref}
      /*
       * `sticky top-0 h-dvh`, not `h-full`.
       *
       * The shell is a flex row whose height is only a *minimum* (`min-h-dvh`),
       * so the parent's `height` stays `auto`. A percentage height has nothing
       * to resolve against there and the rail collapsed to the height of its own
       * content -- which is what left a band of white below it on any page taller
       * than the nav. One viewport tall, pinned, so it stays full height while
       * the page scrolls.
       *
       * A light `surface` rather than the ink panel: the rail is navigation, not
       * a brand moment, and on a light page the old deep-blue rail was the only
       * dark island on screen. The ink treatment stays where it belongs, on the
       * auth split.
       */
      className={cn(
        'glass sticky top-0 flex h-dvh w-60 shrink-0 flex-col border-r border-line',
        className,
      )}
      {...rest}
    >
      <div className="flex-1 overflow-y-auto py-4">{children}</div>
      {footer ? (
        <div className="border-t border-line px-4 py-3">{footer}</div>
      ) : null}
    </aside>
  )
}

export const Sidebar = forwardRef(SidebarInner)

interface SidebarItemProps {
  to: string
  icon: ReactNode
  label: string
  /** Called after a link is followed -- lets a mobile drawer close itself. */
  onNavigate?: () => void
}

export function SidebarItem({ to, icon, label, onNavigate }: SidebarItemProps) {
  const { pathname } = useLocation()
  const isActive = pathname === to || pathname.startsWith(`${to}/`)
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className={cn(
        'group relative mx-2 flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all duration-250 ease-out',
        isActive
          ? // A soft brand wash plus the gradient caret, rather than a solid
            // block, so the active signal glows instead of shouting.
            'bg-brand-soft text-brand-text shadow-[inset_0_0_0_1px_rgb(var(--glow)/0.16)]'
          : 'text-ink hover:translate-x-0.5 hover:bg-canvas-sunken/70 hover:text-ink-strong',
      )}
      aria-current={isActive ? 'page' : undefined}
    >
      {isActive ? (
        <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-glow-gradient shadow-glow-sm" />
      ) : null}
      <span className="shrink-0 transition-transform duration-250 ease-spring group-hover:scale-110">{icon}</span>
      {/*
        `whitespace-nowrap`, deliberately not `truncate`. A signpost that reads
        "Clas..." is not a signpost, and the old rail only needed to clip because
        a status chip shared the row. The rail is sized to fit its labels.
      */}
      <span className="whitespace-nowrap">{label}</span>
    </Link>
  )
}

interface SidebarLogoutButtonProps extends Omit<ComponentPropsWithRef<typeof Button>, 'variant' | 'size' | 'children'> {
  onLogout: () => void
  label?: string
}

function SidebarLogoutButtonInner(
  { onLogout, label = 'Sign out', ...rest }: SidebarLogoutButtonProps,
  ref: React.Ref<HTMLButtonElement>,
) {
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="sm"
      onClick={onLogout}
      className="w-full justify-start gap-3 text-ink hover:bg-canvas-sunken hover:text-ink-strong"
      {...rest}
    >
      <LogOut className="h-4 w-4 shrink-0" />
      <span className="whitespace-nowrap">{label}</span>
    </Button>
  )
}

export const SidebarLogoutButton = forwardRef(SidebarLogoutButtonInner)
