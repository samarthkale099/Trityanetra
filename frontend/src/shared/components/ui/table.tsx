import { forwardRef, type ComponentPropsWithRef } from 'react'
import { cn } from '@/shared/lib/cn'

function TableInner(props: ComponentPropsWithRef<'table'>, ref: React.Ref<HTMLTableElement>) {
  const { className, ...rest } = props
  return (
    <div className="relative w-full overflow-x-auto">
      <table
        ref={ref}
        className={cn('w-full caption-bottom border-collapse text-sm', className)}
        {...rest}
      />
    </div>
  )
}

export const Table = forwardRef(TableInner)

function TableHeaderInner(props: ComponentPropsWithRef<'thead'>, ref: React.Ref<HTMLTableSectionElement>) {
  const { className, ...rest } = props
  return <thead ref={ref} className={cn('border-b border-line', className)} {...rest} />
}

export const TableHeader = forwardRef(TableHeaderInner)

function TableBodyInner(props: ComponentPropsWithRef<'tbody'>, ref: React.Ref<HTMLTableSectionElement>) {
  const { className, ...rest } = props
  return <tbody ref={ref} className={cn('divide-y divide-line', className)} {...rest} />
}

export const TableBody = forwardRef(TableBodyInner)

function TableRowInner(props: ComponentPropsWithRef<'tr'>, ref: React.Ref<HTMLTableRowElement>) {
  const { className, ...rest } = props
  return (
    <tr
      ref={ref}
      className={cn('transition-colors duration-250 hover:bg-brand-soft/60', className)}
      {...rest}
    />
  )
}

export const TableRow = forwardRef(TableRowInner)

function TableHeadInner(props: ComponentPropsWithRef<'th'>, ref: React.Ref<HTMLTableCellElement>) {
  const { className, ...rest } = props
  return (
    <th
      ref={ref}
      scope="col"
      className={cn(
        // `border-line-strong` rather than `line`: a header row separates two
        // sets of data, so it earns a slightly firmer rule than a body divider.
        'h-11 border-b border-line-strong px-4 text-left align-middle text-xs font-semibold uppercase tracking-wider text-ink-faint',
        className,
      )}
      {...rest}
    />
  )
}

export const TableHead = forwardRef(TableHeadInner)

function TableCellInner(props: ComponentPropsWithRef<'td'>, ref: React.Ref<HTMLTableCellElement>) {
  const { className, ...rest } = props
  return <td ref={ref} className={cn('px-4 py-3 align-middle', className)} {...rest} />
}

export const TableCell = forwardRef(TableCellInner)

function TableCaptionInner(
  props: ComponentPropsWithRef<'caption'>,
  ref: React.Ref<HTMLTableCaptionElement>,
) {
  const { className, ...rest } = props
  return <caption ref={ref} className={cn('mt-4 text-sm text-ink', className)} {...rest} />
}

export const TableCaption = forwardRef(TableCaptionInner)