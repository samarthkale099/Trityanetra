import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { RouterProvider, createMemoryRouter, type RouteObject } from 'react-router-dom'
import { http as mswHttp, HttpResponse } from 'msw'

import { AppShell } from '@/pages/app/AppShell'
import { Protected } from '@/app/guards'
import { server } from '@/tests/msw/server'
import { API, makeProfile } from '@/tests/msw/handlers'
import { installFakeAuth, type FakeAccount } from '@/tests/fakeAuthDriver'
import { Providers } from '@/tests/renderWithProviders'
import type { UserRole } from '@/shared/types'

/**
 * What the signed-in shell offers each role.
 *
 * The nav used to render a row for the *other* role's destination ("Teacher
 * only" / "Student only") and a "Coming soon" row for Integrity, and it clipped
 * its labels ("Clas..."). Both were defects: a nav is a promise, so it may only
 * contain links the viewer can open and it must say their names in full.
 *
 * These tests replace the old locked-row suite. The locked rows no longer exist,
 * so the old assertions have nothing to describe; the behavior worth pinning now
 * is *what each role is offered* and *that no label truncates*.
 */

const ACCOUNT: FakeAccount = {
  uid: 'u-1',
  email: 'riya@mit.ac.in',
  password: 'secret123',
  displayName: 'Riya Sharma',
}

/** The Firebase user shape the driver persists; no password is stored. */
const PERSISTED = { uid: ACCOUNT.uid, email: ACCOUNT.email, displayName: ACCOUNT.displayName }

/**
 * Stand-in page body. The nav is what this suite reads, so the body of a route
 * is left empty -- but it has to be an element, not an omitted one, or React
 * Router warns about every matched leaf.
 */
function EmptyPage() {
  return null
}

/**
 * The shell under the real `Protected` gate, at the real app paths.
 *
 * Deliberately not the app's own `routes` table. Every page mounted there is
 * code-split, so asserting on the nav would first pay a multi-second module
 * transform for a page the nav never touches. Route matching, the auth gate and
 * the role are the three things the nav actually depends on, and all three stay
 * real here; the per-page guards are guards.test.tsx's subject, not this file's.
 */
const shellRoutes: RouteObject[] = [
  {
    path: '/app',
    element: (
      <Protected>
        <AppShell />
      </Protected>
    ),
    children: ['dashboard', 'student', 'classrooms'].map((path) => ({ path, element: <EmptyPage /> })),
  },
]

/**
 * Budget for an assertion waiting on the shell to mount. The first test in this
 * file pays for the module graph and, under parallel load, waits alongside the
 * other suites; 1000ms is not enough to cover that. (See guards.test.tsx for the
 * same reasoning about a cold lazy route.) The wait still fails if the shell
 * never renders -- it is a longer fuse, not a weaker assertion.
 */
const FIND_TIMEOUT = 5000

function serveRole(role: UserRole): void {
  const user = makeProfile({ role, collegeId: role === 'STUDENT' ? null : 'college-mit' })
  // Auth registered last: newest-handler-wins, so the role the session exchange
  // reports is the one the shell renders.
  server.use(mswHttp.get(API.me, () => HttpResponse.json({ user })))
  server.use(mswHttp.get(API.me, () => HttpResponse.json(user)))
  installFakeAuth({ accounts: [ACCOUNT], persisted: PERSISTED })
}

function renderAt(path: string) {
  const router = createMemoryRouter(shellRoutes, { initialEntries: [path] })
  render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  )
  return router
}

async function nav() {
  return screen.findByRole('navigation', { name: 'Primary' }, { timeout: FIND_TIMEOUT })
}

describe("the app shell's nav", () => {
  describe('a student', () => {
    it('is offered only the links a student can open, and no rail', async () => {
      serveRole('STUDENT')
      renderAt('/app/student')
      const primary = await nav()

      expect(within(primary).getByRole('link', { name: 'My tests' })).toBeInTheDocument()
      expect(within(primary).getByRole('link', { name: 'Account' })).toBeInTheDocument()
      expect(within(primary).queryByRole('link', { name: /Classrooms/ })).not.toBeInTheDocument()

      // A student has one destination, so the fixed rail is replaced by the top
      // bar: no complementary landmark on the page at all.
      expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    })

    it('never advertises a teacher-only, student-only or coming-soon row', async () => {
      serveRole('STUDENT')
      renderAt('/app/student')
      const primary = await nav()

      expect(within(primary).queryByText(/classrooms/i)).not.toBeInTheDocument()
      expect(within(primary).queryByText(/teacher only/i)).not.toBeInTheDocument()
      expect(within(primary).queryByText(/student only/i)).not.toBeInTheDocument()
      expect(within(primary).queryByText(/coming soon/i)).not.toBeInTheDocument()
      expect(within(primary).queryByText(/integrity/i)).not.toBeInTheDocument()
    })
  })

  describe.each([['TEACHER'], ['ADMIN']] as const)('a %s', (role) => {
    it('gets a rail with full labels and only its own links', async () => {
      serveRole(role)
      renderAt('/app/dashboard')

      // The shell renders optimistically on a placeholder STUDENT profile before
      // the session exchange answers, so the rail only appears once the server's
      // role arrives. Wait for the landmark rather than asserting on the flap.
      const rail = await screen.findByRole('complementary', undefined, { timeout: FIND_TIMEOUT })
      const primary = within(rail).getByRole('navigation', { name: 'Primary' })

      expect(within(primary).getByRole('link', { name: 'Classrooms' })).toBeInTheDocument()
      // For staff the dashboard route is their overview, labelled as such.
      expect(within(primary).getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
      expect(within(primary).queryByRole('link', { name: /My tests/ })).not.toBeInTheDocument()
    })

    it('renders its labels in full, with nothing clipped', async () => {
      serveRole(role)
      renderAt('/app/dashboard')

      const rail = await screen.findByRole('complementary', undefined, { timeout: FIND_TIMEOUT })
      const primary = within(rail).getByRole('navigation', { name: 'Primary' })

      const classrooms = within(primary).getByText('Classrooms')
      // The old rail ellipsised this. `truncate` is the class that did it, so its
      // absence -- plus the exact text -- is the contract.
      expect(classrooms).not.toHaveClass('truncate')
      expect(classrooms.textContent).toBe('Classrooms')

      expect(within(primary).queryByText(/teacher only/i)).not.toBeInTheDocument()
      expect(within(primary).queryByText(/student only/i)).not.toBeInTheDocument()
      expect(within(primary).queryByText(/coming soon/i)).not.toBeInTheDocument()
      expect(within(primary).queryByText(/integrity/i)).not.toBeInTheDocument()
    })
  })
})
