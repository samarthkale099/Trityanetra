import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/shared/lib/cn'

/**
 * The one page header shape: breadcrumb, display title, supporting line, and a
 * right-hand action slot. A single implementation is what stops six pages from
 * drifting into six different header treatments.
 */
export interface Breadcrumb {
  label: string
  /** Omitted on the current page, which renders as plain text rather than a link. */
  to?: string
}

export interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  breadcrumbs?: readonly Breadcrumb[]
  actions?: ReactNode
  className?: string
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('mb-8 flex flex-wrap items-start justify-between gap-x-4 gap-y-3', className)}>
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav aria-label="Breadcrumb" className="mb-2.5">
            <ol className="flex flex-wrap items-center gap-1 text-sm text-ink-faint">
              {breadcrumbs.map((crumb, index) => (
                <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                  {index > 0 ? (
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : null}
                  {crumb.to ? (
                    <Link
                      to={crumb.to}
                      className="rounded-sm transition-colors duration-150 hover:text-brand-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text focus-visible:ring-offset-2"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span aria-current="page" className="font-medium text-ink">
                      {crumb.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        {/* The display size is set here rather than left to the h1 default so
            every page title lands on the same step of the type scale. */}
        <h1 className="font-serif text-4xl font-medium tracking-[-0.02em] text-ink-strong [font-variation-settings:'opsz'_96] sm:text-5xl">
          {title}
        </h1>
        {/* The one accent rule on every page: a short glowing gradient under the title. */}
        <div
          aria-hidden="true"
          className="mt-3 h-[3px] w-12 rounded-full bg-glow-gradient shadow-glow-sm"
        />
        {description ? (
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  )
}
