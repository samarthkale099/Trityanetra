import type { ReactElement, ReactNode } from 'react'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/shared/components/ui/tooltip'
import { AuthProvider } from '@/app/providers/AuthProvider'
import { ToastProvider } from '@/app/providers/ToastProvider'
import { ThemeProvider } from '@/app/providers/ThemeProvider'

/** A fresh client per render: a shared one leaks cached data between tests. */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })
}

export function Providers({ children, queryClient }: { children: ReactNode; queryClient?: QueryClient }) {
  const client = queryClient ?? makeQueryClient()
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <TooltipProvider>
          <AuthProvider>
            <ToastProvider>{children}</ToastProvider>
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

export interface ProviderRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  route?: string
  queryClient?: QueryClient
}

export function renderWithProviders(
  ui: ReactElement,
  { route = '/', queryClient, ...options }: ProviderRenderOptions = {},
): RenderResult & { queryClient: QueryClient } {
  const client = queryClient ?? makeQueryClient()
  const result = render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[route]}>
        <Providers queryClient={client}>{children}</Providers>
      </MemoryRouter>
    ),
    ...options,
  })
  return { ...result, queryClient: client }
}
