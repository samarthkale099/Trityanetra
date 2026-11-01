import type { ReactNode } from 'react'
import { Toaster } from '@/shared/components/ui/toast'

/**
 * Mounts the toast viewport once, above the router.
 *
 * Accessibility is handled by the underlying library: toasts render into an
 * `aria-live="polite"` region, are dismissible from the keyboard, and expose a
 * close button. The options below tune the visuals and keep the stack short so
 * a burst of errors cannot cover the page.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Toaster
        position="bottom-right"
        offset={16}
        closeButton
        visibleToasts={3}
        toastOptions={{ duration: 5000 }}
      />
    </>
  )
}
