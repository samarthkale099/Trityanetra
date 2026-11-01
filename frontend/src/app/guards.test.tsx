import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { http as mswHttp, HttpResponse } from 'msw'
import { routes } from '@/app/router'
import { server } from '@/tests/msw/server'
import { API, makeProfile } from '@/tests/msw/handlers'
import { installFakeAuth, type FakeAccount } from '@/tests/fakeAuthDriver'
import { Providers } from '@/tests/renderWithProviders'
import { roleHomePath } from '@/shared/lib/roles'
import type { UserProfile, UserRole } from '@/shared/types'

const ACCOUNT: FakeAccount = {
  uid: 'u-1',
  email: 'riya@mit.ac.in',
  password: 'secret123',
  displayName: 'Riya Sharma',
}

/** The Firebase user shape the driver persists; no password is stored. */
const PERSISTED = { uid: ACCOUNT.uid, email: ACCOUNT.email, displayName: ACCOUNT.displayName }

/**
 * The backend decides the role; the client only ever displays it. Mocking the
 * session exchange is therefore what makes a role visible to the guards.
 */
function serveProfile(role: UserRole, collegeId: string | null = null): UserProfile {
  const user = makeProfile({ role, collegeId })
  server.use(mswHttp.post(API.session, () => HttpResponse.json({ user })))
  server.use(mswHttp.get(API.me, () => HttpResponse.json(user)))
  return user
}

/**
 * Budget for an assertion that waits on lazily imported route content.
 *
 * Testing Library's default `findBy` timeout is 1000ms, which is not enough the
 * first time a test mounts a code-split route: Vite has to transform the chunk
 * and everything it pulls in on demand, and AppShell drags in framer-motion. A
 * cold dashboard mount measured 2232ms here, so the default failed
 * intermittently while a warm mount finished in single-digit milliseconds.
 *
 * This only widens the wait for the route chunk to arrive. The assertion itself
 * is unchanged - the content still has to appear, and a route that never renders
 * still fails - so it is not a weaker test, just one that is no longer racing
 * the module transform. Later tests reuse the already-transformed module and are
 * unaffected.
 */
const LAZY_ROUTE_TIMEOUT = 5000

/** Signs the user in, as a page reload would. */
function restoreSession() {
  return installFakeAuth({ accounts: [ACCOUNT], persisted: PERSISTED })
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  )
  return router
}

describe('route guards', () => {
  beforeEach(() => {
    installFakeAuth({ accounts: [ACCOUNT] })
  })

  describe('anonymous visitors', () => {
    it.each([
      ['/', '/login'],
      ['/app', '/login'],
      ['/app/dashboard', '/login'],
      ['/app/classrooms', '/login'],
      ['/login', '/login'],
    ])('sends %s to %s', async (from, to) => {
      const router = renderAt(from)
      await waitFor(() => expect(router.state.location.pathname).toBe(to))
    })

    it('keeps the intended destination in a from parameter', async () => {
      const router = renderAt('/app/classrooms')
      await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
      expect(router.state.location.search).toContain('from=%2Fapp%2Fclassrooms')
    })

    it('does not put a from parameter on the bare root path', async () => {
      const router = renderAt('/')
      await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
      expect(router.state.location.search).toBe('')
    })

    it('shows the login form rather than looping', async () => {
      renderAt('/app/dashboard')
      expect(
        await screen.findByRole('button', { name: 'Sign in' }, { timeout: LAZY_ROUTE_TIMEOUT }),
      ).toBeInTheDocument()
    })
  })

  describe('signed-in students', () => {
    beforeEach(() => {
      serveProfile('STUDENT')
      restoreSession()
    })

    it('reaches the dashboard', async () => {
      const router = renderAt('/app/dashboard')
      await waitFor(() => expect(router.state.location.pathname).toBe('/app/dashboard'))
      expect(await screen.findByRole('heading', { level: 1 }, { timeout: LAZY_ROUTE_TIMEOUT })).toHaveTextContent(
        /good to see you/i,
      )
    })

    it('is redirected away from the teacher area', async () => {
      const router = renderAt('/app/classrooms')
      await waitFor(() => expect(router.state.location.pathname).toBe(roleHomePath('STUDENT')))
      expect(screen.queryByRole('heading', { name: 'Classrooms' })).not.toBeInTheDocument()
    })

    it('is bounced off the login and register pages', async () => {
      const router = renderAt('/register')
      await waitFor(() => expect(router.state.location.pathname).toBe(roleHomePath('STUDENT')))
    })

    it('resolves the bare app path to the dashboard', async () => {
      const router = renderAt('/app')
      await waitFor(() => expect(router.state.location.pathname).toBe('/app/dashboard'))
    })

    it('lands on the home surface from the root path', async () => {
      const router = renderAt('/')
      await waitFor(() => expect(router.state.location.pathname).toBe(roleHomePath('STUDENT')))
    })
  })

  describe('teachers and administrators', () => {
    it.each(['TEACHER', 'ADMIN'] as const)('%s can open the teacher area', async (role) => {
      serveProfile(role, 'c-1')
      restoreSession()
      const router = renderAt('/app/classrooms')

      await waitFor(() => expect(router.state.location.pathname).toBe('/app/classrooms'))
      expect(
        await screen.findByRole('heading', { name: 'Classrooms' }, { timeout: LAZY_ROUTE_TIMEOUT }),
      ).toBeInTheDocument()
    })
  })

  describe('unknown routes', () => {
    it('renders the not-found page', async () => {
      renderAt('/no-such-page')
      expect(await screen.findByText(/isn.t here/i, undefined, { timeout: LAZY_ROUTE_TIMEOUT })).toBeInTheDocument()
    })
  })

  describe('session restoration failures', () => {
    it('keeps a restored session usable when the backend is unreachable', async () => {
      server.use(mswHttp.post(API.session, () => HttpResponse.error()))
      restoreSession()
      const router = renderAt('/app/dashboard')

      // Falls back to the placeholder role rather than dumping the user at /login.
      await waitFor(() => expect(router.state.location.pathname).toBe('/app/dashboard'))
      expect(await screen.findByRole('heading', { level: 1 }, { timeout: LAZY_ROUTE_TIMEOUT })).toBeInTheDocument()
    })
  })
})
