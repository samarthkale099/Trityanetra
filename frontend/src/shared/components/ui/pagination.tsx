import { forwardRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/components/ui/button'

export type PageItem = number | 'gap'

function pageItems(current: number, total: number): PageItem[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }
  const items: PageItem[] = []
  items.push(1)
  if (current > 3) items.push('gap')
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  for (let i = start; i <= end; i += 1) items.push(i)
  if (current < total - 2) items.push('gap')
  items.push(total)
  return items
}

interface PaginationProps {
  current: number
  total: number
  onPageChange: (page: number) => void
  className?: string
  pageLabel?: (page: number) => string
}

function PaginationInner(
  { current, total, onPageChange, className, pageLabel }: PaginationProps,
  ref: React.Ref<HTMLElement>,
) {
  const items = pageItems(current, total)
  return (
    <nav
      ref={ref}
      aria-label="Pagination"
      className={cn('flex flex-wrap items-center gap-1', className)}
    >
      <Button
        variant="ghost"
        size="icon"
        type="button"
        aria-label="Previous page"
        disabled={current === 1}
        onClick={() => onPageChange(current - 1)}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      {items.map((item, index) =>
        item === 'gap' ? (
          <span key={`gap-${index}`} aria-hidden="true" className="px-1 text-ink-faint">
            …
          </span>
        ) : (
          <Button
            key={item}
            type="button"
            variant={item === current ? 'primary' : 'ghost'}
            size="icon"
            aria-current={item === current ? 'page' : undefined}
            aria-label={pageLabel ? pageLabel(item) : `Page ${item}`}
            onClick={() => onPageChange(item)}
          >
            {item}
          </Button>
        ),
      )}
      <Button
        variant="ghost"
        size="icon"
        type="button"
        aria-label="Next page"
        disabled={current === total}
        onClick={() => onPageChange(current + 1)}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </nav>
  )
}

export const Pagination = forwardRef(PaginationInner)

export { pageItems }