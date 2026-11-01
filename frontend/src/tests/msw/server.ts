import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { authHandlers } from '@/tests/msw/handlers'

/**
 * Shared MSW server for the integration suite. Handlers are overridden per test
 * with `server.use(...)`; anything not overridden falls back to the real backend
 * contract so an unhandled request is a visible failure rather than a silent
 * network error.
 */
export const server = setupServer(...authHandlers())

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
