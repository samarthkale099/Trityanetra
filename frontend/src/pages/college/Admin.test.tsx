import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { http as mswHttp, HttpResponse } from 'msw'
import { server } from '@/tests/msw/server'
import { makeQueryClient } from '@/tests/renderWithProviders'
import { CollegesPage } from './Colleges'
import { PeoplePage } from './People'

/** Who is signed in: a root admin (no college) unless a test says otherwise. */
const session = vi.hoisted(() => ({
  user: { uid: 'root-1', email: 'root@trityanetra.app', displayName: 'Root', role: 'ADMIN', collegeId: null as string | null },
}))

vi.mock('@/app/providers/AuthProvider', () => ({
  useAuth: () => ({ user: session.user, role: session.user.role, status: 'authenticated' }),
}))

interface FakeUser {
  uid: string
  email: string
  displayName: string
  role: 'STUDENT' | 'TEACHER' | 'ADMIN'
  collegeId: string | null
  emailVerified: boolean
}

function fakeAdminBackend() {
  const colleges = [{ id: 'mit', name: 'MIT', code: 'MIT', emailDomain: 'mit.ac.in' }]
  const users: FakeUser[] = [
    { uid: 'u-riya', email: 'riya@mit.ac.in', displayName: 'Riya', role: 'STUDENT', collegeId: 'mit', emailVerified: true },
    { uid: 'u-aditya', email: 'aditya@mit.ac.in', displayName: 'Aditya', role: 'STUDENT', collegeId: 'mit', emailVerified: false },
  ]
  const assigned: unknown[] = []
  server.use(
    mswHttp.get('/api/colleges', () => HttpResponse.json({ data: colleges })),
    mswHttp.post('/api/colleges', async ({ request }) => {
      const body = (await request.json()) as { name: string; code: string; emailDomain?: string }
      const college = { id: 'new-college', name: body.name, code: body.code, emailDomain: body.emailDomain ?? '' }
      colleges.push(college)
      return HttpResponse.json({ data: college }, { status: 201 })
    }),
    mswHttp.get('/api/users', ({ request }) => {
      const url = new URL(request.url)
      const email = url.searchParams.get('email')
      const role = url.searchParams.get('role')
      return HttpResponse.json({
        data: users.filter((u) => (!email || u.email === email.toLowerCase()) && (!role || u.role === role)),
      })
    }),
    mswHttp.post('/api/auth/assign-role', async ({ request }) => {
      const body = (await request.json()) as { targetUid: string; role: FakeUser['role']; collegeId: string | null }
      assigned.push(body)
      const user = users.find((u) => u.uid === body.targetUid)
      if (user) Object.assign(user, { role: body.role, collegeId: body.collegeId })
      return HttpResponse.json({ message: 'Role assigned successfully' })
    }),
  )
  return { colleges, users, assigned }
}

function renderPage(page: React.ReactElement) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter>{page}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CollegesPage', () => {
  beforeEach(() => {
    session.user = { ...session.user, uid: 'root-1', collegeId: null }
  })

  it('lists colleges with their email domain and ID', async () => {
    fakeAdminBackend()
    renderPage(<CollegesPage />)
    expect(await screen.findByText('@mit.ac.in')).toBeVisible()
    expect(screen.getAllByText('MIT').length).toBeGreaterThan(0)
    expect(screen.getByText('mit')).toBeVisible()
  })

  it('lets a root admin add a college', async () => {
    const backend = fakeAdminBackend()
    const user = userEvent.setup()
    renderPage(<CollegesPage />)

    await user.click(await screen.findByRole('button', { name: 'Add college' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('College name'), 'Vellore Institute')
    await user.type(within(dialog).getByLabelText('Short code'), 'VIT')
    await user.type(within(dialog).getByLabelText('Email domain (optional)'), 'vit.ac.in')
    await user.click(within(dialog).getByRole('button', { name: 'Add college' }))

    await waitFor(() => expect(backend.colleges).toHaveLength(2))
    expect(backend.colleges[1]).toMatchObject({ name: 'Vellore Institute', code: 'VIT', emailDomain: 'vit.ac.in' })
    expect(await screen.findByText('Vellore Institute')).toBeVisible()
  })

  it('hides "Add college" from a college admin, who can only manage their own college', async () => {
    session.user = { ...session.user, uid: 'adm-mit', collegeId: 'mit' }
    fakeAdminBackend()
    renderPage(<CollegesPage />)
    await screen.findByText('@mit.ac.in')
    expect(screen.queryByRole('button', { name: 'Add college' })).toBeNull()
  })
})

describe('PeoplePage', () => {
  beforeEach(() => {
    session.user = { ...session.user, uid: 'root-1', collegeId: null }
  })

  it('lists people with their role and flags unverified emails', async () => {
    fakeAdminBackend()
    renderPage(<PeoplePage />)
    expect(await screen.findByText('riya@mit.ac.in')).toBeVisible()
    expect(screen.getByText('aditya@mit.ac.in')).toBeVisible()
    expect(screen.getByText('Email not verified')).toBeVisible()
  })

  it('finds someone by email and makes them a teacher', async () => {
    const backend = fakeAdminBackend()
    const user = userEvent.setup()
    renderPage(<PeoplePage />)

    await user.type(screen.getByLabelText('Find by email'), 'Aditya@mit.ac.in')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(screen.queryByText('riya@mit.ac.in')).toBeNull())

    await user.click(screen.getByRole('button', { name: 'Change role for Aditya' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('combobox', { name: 'Role' }))
    await user.click(await screen.findByRole('option', { name: 'Teacher' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save role' }))

    await waitFor(() => expect(backend.assigned).toEqual([{ targetUid: 'u-aditya', role: 'TEACHER', collegeId: 'mit' }]))
  })

  it("does not let an admin change their own role", async () => {
    session.user = { ...session.user, uid: 'u-riya', collegeId: 'mit' }
    fakeAdminBackend()
    renderPage(<PeoplePage />)
    expect(await screen.findByRole('button', { name: 'Change role for Riya' })).toBeDisabled()
  })
})
