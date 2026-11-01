import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'

import { StudentResultPage } from '@/pages/student/StudentResult'
import { createMockBackend, type MockBackend } from '@/tests/msw/classroomHandlers'
import { server } from '@/tests/msw/server'
import { configureHttpClient } from '@/shared/lib/httpClient'
import { STUDENT_UID, TEACHER_UID } from '@/tests/msw/fixtures'
import { makeQueryClient } from '@/tests/renderWithProviders'
import { ThemeProvider } from '@/app/providers/ThemeProvider'

/**
 * The student result page.
 *
 * The point of these tests is what the page does *not* show: a hidden case's
 * content never reaches the DOM, and marks stay hidden until they are released.
 * Those withholdings are the server's, so the page is really being checked for
 * presenting only what it was sent.
 */

const RELEASED_TEST = 'test-ended-1'
const UNRELEASED_TEST = 'test-review-1'
const DEV = 'u-student-5'

function asUser(uid: string) {
  configureHttpClient({ getToken: () => `fake-id-token.${uid}.1` })
}

function renderResult(testId: string) {
  const router = createMemoryRouter(
    [
      { path: '/app/student', element: <p>My tests list</p> },
      { path: '/app/tests/:testId/result', element: <StudentResultPage /> },
    ],
    { initialEntries: [`/app/tests/${testId}/result`] },
  )
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

describe('StudentResultPage', () => {
  let backend: MockBackend

  beforeEach(() => {
    backend = createMockBackend()
    server.use(...backend.handlers)
  })

  afterEach(() => {
    configureHttpClient({ getToken: () => null })
  })

  it('shows the case breakdown, the pass count, and the released marks', async () => {
    asUser(STUDENT_UID)
    renderResult(RELEASED_TEST)

    // The pass count is available to assistive tech, not only as a coloured bar.
    const bar = await screen.findByRole('progressbar', { name: 'Test cases passed' })
    expect(bar).toHaveAttribute('aria-valuenow', '1')
    expect(bar).toHaveAttribute('aria-valuemax', '2')

    // A visible case shows its content and its state.
    expect(screen.getByText('Test case 1')).toBeInTheDocument()
    expect(screen.getByText('Test case 2')).toBeInTheDocument()
    expect(screen.getByText('Passed')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()

    // Released marks and comment are shown.
    expect(screen.getByText('/ 10')).toBeInTheDocument()
    expect(
      screen.getByText('Good start. Watch the hidden edge case before the next one.'),
    ).toBeInTheDocument()
  })

  it('never renders a hidden case`s input or expected output', async () => {
    asUser(STUDENT_UID)
    renderResult(RELEASED_TEST)

    await screen.findByRole('progressbar', { name: 'Test cases passed' })

    // The hidden case says only that it is hidden; it offers no field content.
    expect(
      screen.getByText('This is a hidden test case. Only its result is shown.'),
    ).toBeInTheDocument()
    // Exactly one visible case here, so exactly one set of content fields.
    expect(screen.getAllByText('Input')).toHaveLength(1)
    expect(screen.getAllByText('Expected')).toHaveLength(1)
    // The hidden case's real expected value ('6') must not appear anywhere.
    expect(screen.queryByText('6')).not.toBeInTheDocument()
  })

  it('withholds the marks panel until the teacher releases results', async () => {
    asUser(STUDENT_UID)
    renderResult(UNRELEASED_TEST)

    expect(await screen.findByText('Your teacher has not released marks yet.')).toBeInTheDocument()
    expect(screen.queryByText('Not graded')).not.toBeInTheDocument()
    expect(screen.queryByText('/ 10')).not.toBeInTheDocument()

    // Five cases: three visible, two hidden. The hidden pair leaks nothing.
    expect(screen.getAllByText('Input')).toHaveLength(3)
    expect(screen.queryByText(/2,4,6,8/)).not.toBeInTheDocument()
  })

  it('reports not found for a student who did not submit', async () => {
    asUser(DEV)
    renderResult(UNRELEASED_TEST)

    expect(await screen.findByText("We couldn't find that result")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to my tests' })).toBeInTheDocument()
  })

  it('shows a load error rather than a result for someone who cannot read one', async () => {
    asUser(TEACHER_UID)
    renderResult(UNRELEASED_TEST)

    expect(await screen.findByText("We couldn't load your result")).toBeInTheDocument()
  })
})
