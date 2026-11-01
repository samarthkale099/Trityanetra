import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/shared/lib/cn'

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close
const DialogTitle = DialogPrimitive.Title
const DialogDescription = DialogPrimitive.Description

interface DialogContentInnerProps extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  showCloseButton?: boolean
}

/**
 * Radix owns mounting: a closed dialog is absent from the DOM rather than
 * hidden, so it is never focusable, never announced, and never picked up by an
 * assistive-technology sweep of the page.
 *
 * The enter animation is CSS driven and keyed off `data-state`, which Radix sets
 * on mount. An earlier version used `forceMount` inside an `AnimatePresence`;
 * because `AnimatePresence` cannot track a `Portal` child, the panel stayed
 * mounted and visible after the dialog closed, and the exit transition never ran.
 */
function DialogContentInner(
  props: DialogContentInnerProps,
  ref: React.Ref<HTMLDivElement>,
) {
  const {
    className = '',
    children,
    showCloseButton = true,
    onOpenAutoFocus: _onOpenAutoFocus,
    onCloseAutoFocus: _onCloseAutoFocus,
    onEscapeKeyDown: _onEscapeKeyDown,
    onPointerDownOutside: _onPointerDownOutside,
    onInteractOutside: _onInteractOutside,
    forceMount: _forceMount,
    asChild: _asChild,
    ...rest
  } = props

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dialog-overlay fixed inset-0 z-50 bg-canvas-sunken/70 backdrop-blur-md" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'dialog-panel fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2',
          // Cap the height against the viewport and scroll inside, so a tall
          // dialog (the test preview) stays reachable on a 360px-wide phone
          // instead of running off the bottom of the screen.
          'max-h-[calc(100dvh-3rem)]',
          className,
        )}
        {...rest}
      >
        <div className="relative overflow-y-auto overscroll-contain rounded-xl border border-line bg-surface-raised p-6 shadow-overlay">
          {children}
          {showCloseButton ? (
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close dialog"
                className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-faint hover:text-ink-strong hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text"
              >
                <X className="h-4 w-4" />
              </button>
            </DialogPrimitive.Close>
          ) : null}
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export const DialogContent = forwardRef(DialogContentInner)

export { Dialog, DialogTrigger, DialogClose, DialogTitle, DialogDescription }