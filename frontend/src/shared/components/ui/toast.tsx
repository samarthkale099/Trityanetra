import { Toaster as SonnerToaster, toast } from 'sonner'
import type { ComponentProps } from 'react'

export function Toaster(props: ComponentProps<typeof SonnerToaster>) {
  return (
    <SonnerToaster
      className="toaster group"
      position="bottom-right"
      offset={16}
      toastOptions={{
        classNames: {
          toast:
            'group-[.toaster]:rounded-lg group-[.toaster]:border group-[.toaster]:border-line group-[.toaster]:bg-surface-raised group-[.toaster]:text-ink-strong group-[.toaster]:shadow-float',
          title: 'group-[.toaster]:text-sm group-[.toaster]:font-medium',
          description: 'group-[.toaster]:text-sm group-[.toaster]:text-ink',
          success: 'group-[.toaster]:border-l-4 group-[.toaster]:border-l-success',
          error: 'group-[.toaster]:border-l-4 group-[.toaster]:border-l-danger',
          warning: 'group-[.toaster]:border-l-4 group-[.toaster]:border-l-warning',
          info: 'group-[.toaster]:border-l-4 group-[.toaster]:border-l-info',
        },
      }}
      {...props}
    />
  )
}

export { toast }