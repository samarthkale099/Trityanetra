import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'

import { SubmissionListPage } from '@/pages/teacher/SubmissionList'
import { SubmissionDetailPage } from '@/pages/teacher/SubmissionDetail'
import { createMockBackend } from '@/tests/msw/classroomHandlers'
import { server } from '@/tests/msw/server'
import { configureHttpClient } from '@/shared/lib/httpClient'
import { TEACHER_UID } from '@/tests/msw/fixtures'
import { makeQueryClient } from '@/tests/renderWithProviders'
import { ThemeProvider } from '@/app/providers/ThemeProvider'

/**
 * The submissions list: a roster-backed review table with a search box and a
 * single destructive action (release). Students are in the page by way of the
 * mock's roster -- not because the backend stored a row for each.
 */

const REVIEW_TEST = 'test-review-1'
const ROOM = 'room-algorithms'
const LIST_PATH = `/app/classrooms/${ROOM}/tests/${REVIEW_TEST}/submissions`

vi.mock('@/features/exam/CodeEditor', () => ({
  CodeEditor: function MockCodeEditor({ value }: { value: string }) {
    return <pre data-testid="code-editor">{value}</pre>
  },
}))

function asUser(uid: string) {
  configureHttpClient({ getToken: () => `fake-id-token.${uid}.1` })
}

function renderReview() {
  const router = createMemoryRouter(
    [
      { path: '/app/classrooms/:classroomId/tests/:testId/submissions', element: <SubmissionListPage /> },
      {
        path: '/app/classrooms/:classroomId/tests/:testId/submissions/:submissionId',
        element: <SubmissionDetailPage />,
      },
    ],
    { initialEntries: [LIST_PATH] },
  )
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

describe('SubmissionListPage', () => {
  let backend: ReturnType<typeof createMockBackend>

  beforeEach(() => {
    backend = createMockBackend()
    server.use(...backend.handlers)
    asUser(TEACHER_UID)
  })

  afterEach(() => {
    configureHttpClient({ getToken: () => null })
  })

  it('lists every enrolled student with state, cases, and saved marks', async () => {
    renderReview()

    expect(await screen.findByText('Riya Sharma')).toBeInTheDocument()
    expect(screen.getByText('Kabir Mehta')).toBeInTheDocument()
    expect(screen.getByText('Aarav Iyer')).toBeInTheDocument()
    expect(screen.getByText('Meera Nair')).toBeInTheDocument()
    expect(screen.getByText('Dev Patel')).toBeInTheDocument()

    // Three submitted, one late, one who never submitted.
    expect(screen.getAllByRole('cell', { name: 'Submitted' })).toHaveLength(3)
    expect(screen.getByText('Late')).toBeInTheDocument()
    expect(screen.getByText('Not submitted')).toBeInTheDocument()

    // Seeded grades and case pass counts. Four students are yet ungraded.
    expect(screen.getByText('8/10')).toBeInTheDocument()
    expect(screen.getAllByText('Not graded')).toHaveLength(4)
    expect(screen.getByText('4/5')).toBeInTheDocument()

    // A not-submitted student still appears, with their email alongside.
    expect(screen.getByText('dev@mit.ac.in')).toBeInTheDocument()

    // The header explains release gating.
    expect(screen.getByText(/Marks stay hidden from students until you release them/)).toBeInTheDocument()
  })

  it('shows "No submission" instead of a Grade action for a student who never submitted', async () => {
    renderReview()

    // Dev Patel is the never-submitted row: no grading entry point...
    await screen.findByText('Dev Patel')
    expect(screen.queryByRole('link', { name: 'Grade Dev Patel' })).not.toBeInTheDocument()
    expect(screen.getByText('No submission')).toBeInTheDocument()

    // ...but the row keeps its roster columns and status.
    expect(screen.getByText('dev@mit.ac.in')).toBeInTheDocument()
    expect(screen.getByText('Not submitted')).toBeInTheDocument()

    // Students who did submit still get a Grade action.
    expect(screen.getByRole('link', { name: 'Grade Riya Sharma' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Grade Aarav Iyer' })).toBeInTheDocument()
  })

  it('filters the roster by name or email', async () => {
    const user = userEvent.setup()
    renderReview()

    await screen.findByText('Dev Patel')
    await user.type(screen.getByLabelText('Search submissions'), 'aarav')

    expect(screen.getByText('Aarav Iyer')).toBeInTheDocument()
    expect(screen.queryByText('Riya Sharma')).not.toBeInTheDocument()
    expect(screen.queryByText('Dev Patel')).not.toBeInTheDocument()
  })

  it('clears the search from the empty state', async () => {
    const user = userEvent.setup()
    renderReview()

    await screen.findByText('Dev Patel')
    await user.type(screen.getByLabelText('Search submissions'), 'nobody')
    expect(await screen.findByText('No student matches that search')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.queryByText('Dev Patel')).toBeInTheDocument()
  })

  it('opens a student in the grading page', async () => {
    const user = userEvent.setup()
    renderReview()

    const grade = await screen.findByRole('link', { name: 'Grade Riya Sharma' })
    await user.click(grade)

    expect(await screen.findByRole('heading', { name: 'Riya Sharma' })).toBeInTheDocument()
    expect(await screen.findByTestId('code-editor')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save grades' })).toBeInTheDocument()
  })

  it('releases the results from the confirm dialog', async () => {
    const user = userEvent.setup()
    renderReview()

    await screen.findByText('Dev Patel')
    await user.click(screen.getByRole('button', { name: 'Release results' }))
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByText(/Gradings are then locked, so you will not be able to change them/),
    ).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Release results' }))

    // The release lands in the mock store and the page swaps the action for a badge.
    await waitFor(() => expect(backend.store.releasedAt.has(REVIEW_TEST)).toBe(true))
    expect(await screen.findByText('Results released')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Release results' })).not.toBeInTheDocument()
  })
})