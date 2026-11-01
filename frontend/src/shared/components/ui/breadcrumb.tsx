import { forwardRef, type ComponentPropsWithRef } from 'react'
import { ChevronRight } from 'lucide-react'

interface BreadcrumbProps extends ComponentPropsWithRef<'nav'> {
  items: BreadcrumbItem[]
}

export interface BreadcrumbItem {
  label: string
  href?: string
  onClick?: () => void
}

function BreadcrumbInner({ items, ...rest }: BreadcrumbProps, ref: React.Ref<HTMLElement>) {
  return (
    <nav ref={ref} aria-label="Breadcrumb" {...rest}>
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, index) => {
          const isLast = index === items.length - 1
          return (
            <li
              key={item.label}
              className="flex items-center gap-1.5"
            >
              {index > 0 ? (
                <ChevronRight
                  aria-hidden="true"
                  className="h-3.5 w-3.5 text-ink-faint"
                />
              ) : null}
              {isLast ? (
                <span aria-current="page" className="text-sm font-medium text-ink-strong">
                  {item.label}
                </span>
              ) : item.href ? (
                <a
                  href={item.href}
                  className="text-sm text-ink hover:text-brand-text hover:underline underline-offset-2"
                >
                  {item.label}
                </a>
              ) : (
                <button
                  type="button"
                  onClick={item.onClick}
                  className="text-sm text-ink hover:text-brand-text hover:underline underline-offset-2"
                >
                  {item.label}
                </button>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export const Breadcrumb = forwardRef(BreadcrumbInner)