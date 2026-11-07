import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'

import { SubmissionDetailPage, formatOutput } from '@/pages/teacher/SubmissionDetail'
import { SubmissionListPage } from '@/pages/teacher/SubmissionList'
import { reviewApi } from '@/features/classrooms/reviewApi'
import { createMockBackend } from '@/tests/msw/classroomHandlers'
import { server } from '@/tests/msw/server'
import { configureHttpClient } from '@/shared/lib/httpClient'
import { TEACHER_UID } from '@/tests/msw/fixtures'
import { makeQueryClient } from '@/tests/renderWithProviders'
import { ThemeProvider } from '@/app/providers/ThemeProvider'

/**
 * The grading page: a read-only answer, the case results (public content and
 * hidden content withheld), and a marks + comment form that is disabled for
 * students who did not submit and locked entirely once results are released.
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

function renderDetail(submissionId: string) {
  const router = createMemoryRouter(
    [
      { path: '/app/classrooms/:classroomId/tests/:testId/submissions', element: <SubmissionListPage /> },
      {
        path: '/app/classrooms/:classroomId/tests/:testId/submissions/:submissionId',
        element: <SubmissionDetailPage />,
      },
    ],
    { initialEntries: [`${LIST_PATH}/${submissionId}`] },
  )
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

describe('SubmissionDetailPage', () => {
  let backend: ReturnType<typeof createMockBackend>

  beforeEach(() => {
    backend = createMockBackend()
    server.use(...backend.handlers)
    asUser(TEACHER_UID)
  })

  afterEach(() => {
    configureHttpClient({ getToken: () => null })
  })

  it('shows the code, every case result, and keeps hidden case content out', async () => {
    renderDetail(`sub-${REVIEW_TEST}-u-student-1`)

    // The default 1s finder timeout is too tight when the suite spawns a worker
    // per file; under load the request can take a couple of seconds.
    expect(
      await screen.findByRole('heading', { name: 'Riya Sharma' }, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(screen.getByText('Submitted')).toBeInTheDocument()

    const editor = screen.getByTestId('code-editor')
    expect(editor.textContent).toContain('indexOf')

    // Public cases show their input and expected output...
    expect(screen.getByText('Test case 1')).toBeInTheDocument()
    expect(screen.getAllByText(/\[1,2,3\]/)).not.toHaveLength(0)
    // ...and the PASS/FAIL verdicts (4 pass, 1 fail for Riya's submission).
    expect(screen.getAllByText('Pass')).toHaveLength(4)
    expect(screen.getByText('Fail')).toBeInTheDocument()

    // The failing public case captured no output, so the cell reads as a
    // placeholder rather than the stringified word "undefined".
    expect(screen.getByText('(no output)')).toBeInTheDocument()
    expect(screen.queryByText('undefined')).not.toBeInTheDocument()

    // A hidden case reports only its result; the content never renders.
    expect(screen.getAllByText('Hidden case')).toHaveLength(2)
    expect(
      screen.getAllByText(/This case's input and expected output are withheld/),
    ).toHaveLength(2)
    expect(screen.queryByText('[2,4,6,8]')).not.toBeInTheDocument()

    expect(screen.getByLabelText('Marks out of 10')).toBeEnabled()
  })

  it('labels a late submission as late', async () => {
    renderDetail(`sub-${REVIEW_TEST}-u-student-3`)
    expect(await screen.findByText('Submitted late')).toBeInTheDocument()
  })

  it('shows a neutral shell for a student who never submitted', async () => {
    renderDetail(`pending-${REVIEW_TEST}-u-student-5`)

    // The badge and the explanatory note both say "Not submitted".
    expect((await screen.findAllByText('Not submitted')).length).toBeGreaterThan(0)
    expect(screen.getByText(/This student did not submit/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Answer' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Test cases' })).not.toBeInTheDocument()

    expect(screen.getByLabelText('Marks out of 10')).toBeDisabled()
    expect(screen.getByLabelText('Comment for the student')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save grades' })).toBeDisabled()
  })

  it('validates marks before allowing a save, then saves', async () => {
    const user = userEvent.setup()
    renderDetail(`sub-${REVIEW_TEST}-u-student-1`)
    await screen.findByRole('heading', { name: 'Riya Sharma' })

    const marks = screen.getByLabelText('Marks out of 10')
    await user.type(marks, '12')
    expect(screen.getByText('Enter a whole number between 0 and 10.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save grades' })).toBeDisabled()

    await user.clear(marks)
    await user.type(marks, '4')
    await user.type(screen.getByLabelText('Comment for the student'), 'Short-circuit stops early.')

    await user.click(screen.getByRole('button', { name: 'Save grades' }))

    // The save lands in the mock backend, not just in React state.
    await waitFor(async () => {
      const list = await reviewApi.listSubmissions(REVIEW_TEST)
      const row = list.submissions.find((s) => s.studentUid === 'u-student-1')
      expect(row?.marks).toBe(4)
    })
  })

  it('locks the form once results are released', async () => {
    asUser(TEACHER_UID)
    await reviewApi.releaseResults(REVIEW_TEST)
    renderDetail(`sub-${REVIEW_TEST}-u-student-1`)

    expect(await screen.findByText('Results are released')).toBeInTheDocument()
    expect(screen.getByLabelText('Marks out of 10')).toBeDisabled()
    expect(screen.getByLabelText('Comment for the student')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save grades' })).toBeDisabled()
  })
})

describe('formatOutput', () => {
  it('turns a missing, blank, or stringified-undefined output into a readable placeholder', () => {
    expect(formatOutput(null)).toBe('(no output)')
    expect(formatOutput(undefined)).toBe('(no output)')
    expect(formatOutput('')).toBe('(no output)')
    expect(formatOutput('   ')).toBe('(no output)')
    expect(formatOutput('undefined')).toBe('(no output)')
  })

  it('leaves real output untouched, including values that look falsy', () => {
    expect(formatOutput('42')).toBe('42')
    expect(formatOutput('0')).toBe('0')
    expect(formatOutput('false')).toBe('false')
    expect(formatOutput('[1,2,3]')).toBe('[1,2,3]')
  })
})