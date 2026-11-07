import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarClock, LoaderCircle, Save } from 'lucide-react'
import { reviewApi, type CaseResult } from '@/features/classrooms/reviewApi'
import { CodeEditor } from '@/features/exam/CodeEditor'
import { useTheme } from '@/app/providers/ThemeProvider'
import { formatIST } from '@/shared/lib/datetime'
import { PageHeader } from '@/shared/components/page-header'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Textarea } from '@/shared/components/ui/textarea'
import { Badge } from '@/shared/components/ui/badge'
import { Card } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { ErrorState } from '@/shared/components/ui/error-state'
import { toast } from '@/shared/components/ui/toast'

/**
 * A student's captured output, made safe to print. The value can be missing,
 * blank, or the literal string `"undefined"` (what an unguarded `String(x)`
 * produces when the program produced nothing), and none of those should reach
 * the teacher as the word "undefined".
 */
export function formatOutput(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' || trimmed === 'undefined' ? '(no output)' : (value as string)
}

/** One case as the teacher reads it: PASS/FAIL, and content only for public cases. */
function CaseRow({ result }: { result: CaseResult }) {
  return (
    <li className="px-5 py-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-ink-strong">
          {result.name}
          {result.hidden ? (
            <span className="ml-2 text-xs font-normal text-ink-faint">Hidden case</span>
          ) : null}
        </p>
        <Badge variant={result.state === 'PASS' ? 'success' : 'danger'} dot>
          {result.state === 'PASS' ? 'Pass' : 'Fail'}
        </Badge>
      </div>
      {result.hidden ? (
        <p className="mt-2 text-sm text-ink">
          This case's input and expected output are withheld, so the content cannot leak from this
          page. Only the result is shown.
        </p>
      ) : (
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium text-ink-faint">Input</dt>
            <pre className="mt-1 overflow-x-auto rounded-md border border-line bg-canvas-sunken px-3 py-2 font-mono text-xs leading-relaxed text-ink">
              {result.input ?? '—'}
            </pre>
          </div>
          <div>
            <dt className="text-xs font-medium text-ink-faint">Expected</dt>
            <pre className="mt-1 overflow-x-auto rounded-md border border-line bg-canvas-sunken px-3 py-2 font-mono text-xs leading-relaxed text-ink">
              {result.expected ?? '—'}
            </pre>
          </div>
          <div>
              <dt className="text-xs font-medium text-ink-faint">Their output</dt>
            <pre className="mt-1 overflow-x-auto rounded-md border border-line bg-canvas-sunken px-3 py-2 font-mono text-xs leading-relaxed text-ink">
              {formatOutput(result.actual)}
            </pre>
          </div>
        </dl>
      )}
    </li>
  )
}

/**
 * Grading for a single student's submission: the code read-only, every case's
 * result, and the marks + comment a teacher can edit up until results release.
 * The code editor is deliberately not editable — a regraded answer would no
 * longer correspond to what was submitted.
 */
export function SubmissionDetailPage() {
  const { classroomId, testId, submissionId } = useParams<{
    classroomId: string
    testId: string
    submissionId: string
  }>()
  const { theme } = useTheme()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['review', 'submission', testId, submissionId],
    enabled: Boolean(testId && submissionId),
    queryFn: ({ signal }) =>
      reviewApi.getSubmission(testId as string, submissionId as string, signal),
  })

  const detail = query.data ?? null

  const [marksValue, setMarksValue] = useState('')
  const [commentValue, setCommentValue] = useState('')
  const previousId = useRef<string | undefined>(undefined)

  // Populate the form from the fetched detail, but only when the submission
  // itself changes. A refetch after saving (same id) must not wipe an edit.
  useEffect(() => {
    if (!detail) return
    if (previousId.current === detail.id) return
    previousId.current = detail.id
    setMarksValue(detail.marks === null ? '' : String(detail.marks))
    setCommentValue(detail.comment)
  }, [detail])

  const maxMarks = detail?.maxMarks ?? 0
  const locked = detail?.resultsReleased ?? true
  const notSubmitted = detail?.state === 'NOT_SUBMITTED'

  const marksError =
    detail && marksValue.trim() !== ''
      ? (() => {
          const parsed = Number(marksValue)
          if (!Number.isInteger(parsed) || parsed < 0 || parsed > maxMarks) {
            return `Enter a whole number between 0 and ${maxMarks}.`
          }
          return null
        })()
      : null

  const save = useMutation({
    mutationFn: () => {
      if (!testId || !submissionId) throw new Error('This address is missing an id.')
      const marks = marksValue.trim() === '' ? null : Number(marksValue)
      return reviewApi.saveReview(testId, submissionId, { marks, comment: commentValue })
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['review', 'submission', saved.testId, saved.id] })
      // The list is cached for 30s; without this, going back shows the old marks.
      await queryClient.invalidateQueries({ queryKey: ['review', 'submissions', saved.testId] })
      toast.success('Grades saved', {
        description: `${saved.studentName}'s marks are saved, but students cannot see them until you release results.`,
      })
    },
    onError: (error: Error) => {
      toast.error('Could not save grades', { description: error.message })
    },
  })

  if (!testId || !submissionId) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <ErrorState
          title="No submission selected"
          message="This address is missing a submission id. Open a student from the submissions list."
        />
      </div>
    )
  }

  const listPath = `/app/classrooms/${encodeURIComponent(classroomId ?? '')}/tests/${encodeURIComponent(testId)}/submissions`

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        breadcrumbs={[
          { label: 'Classrooms', to: '/app/classrooms' },
          ...(classroomId
            ? [{ label: 'Classroom', to: `/app/classrooms/${encodeURIComponent(classroomId)}` }]
            : []),
          { label: 'Test' },
          { label: 'Submissions', to: listPath },
          { label: detail?.studentName ?? 'Submission' },
        ]}
        title={detail?.studentName ?? 'Submission'}
        description={
          detail
            ? `${detail.studentEmail} - ${detail.passedCases}/${detail.totalCases} cases passed`
            : undefined
        }
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link to={listPath}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to submissions
            </Link>
          </Button>
        }
      />

      {query.isPending ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading the submission">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : null}

      {query.isError ? (
        <ErrorState
          title="We couldn't load this submission"
          message={
            query.error instanceof Error
              ? query.error.message
              : 'The submission may have been removed, or the test belongs to another college.'
          }
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {detail ? (
        <div className="flex flex-col gap-6">
          <Card className="flex flex-wrap items-center gap-2 px-5 py-4">
            <Badge variant={detail.state === 'LATE' ? 'warning' : 'success'} dot>
              {detail.state === 'LATE' ? 'Submitted late' : detail.state === 'SUBMITTED' ? 'Submitted' : 'Not submitted'}
            </Badge>
            <p className="flex items-center gap-2 text-sm text-ink">
              <CalendarClock className="h-4 w-4 text-ink-faint" aria-hidden="true" />
              {detail.submittedAt ? formatIST(detail.submittedAt) : 'No submission recorded'}
            </p>
          </Card>

          {detail.state === 'NOT_SUBMITTED' ? (
            <Card className="px-5 py-4">
              <p className="text-sm text-ink">
                This student did not submit, so there is no code or case result to review. They are
                recorded as <span className="font-medium">Not submitted</span> on the list.
              </p>
            </Card>
          ) : (
            <>
              <section aria-labelledby="answer-heading">
                <h2 id="answer-heading" className="mb-2 text-lg font-semibold text-ink-strong">
                  Answer
                </h2>
                <div className="overflow-hidden rounded-lg border border-line bg-surface">
                  <CodeEditor
                    value={detail.code}
                    onChange={() => {
                      /* read-only: the editor must not accept edits to a submission */
                    }}
                    language={detail.language}
                    theme={theme}
                    readOnly
                    height="360px"
                  />
                </div>
              </section>

              <section aria-labelledby="cases-heading">
                <h2 id="cases-heading" className="mb-2 text-lg font-semibold text-ink-strong">
                  Test cases
                </h2>
                <Card className="divide-y divide-line">
                  <ol>
                    {detail.cases.map((result) => (
                      <CaseRow key={result.id} result={result} />
                    ))}
                  </ol>
                </Card>
              </section>
            </>
          )}

          <section aria-labelledby="grading-heading">
            <h2 id="grading-heading" className="mb-2 text-lg font-semibold text-ink-strong">
              Grading
            </h2>
            <Card className="px-5 py-4">
              {detail.resultsReleased ? (
                <div className="flex items-start gap-3 rounded-md border border-line bg-brand-soft p-4">
                  <div className="min-w-0">
                    <p className="font-medium text-ink-strong">Results are released</p>
                    <p className="mt-1 text-sm text-ink">
                      {detail.releasedAt
                        ? `Released on ${formatIST(detail.releasedAt)}. Gradings are locked, so the marks below are what the students can see.`
                        : 'Gradings are locked after release.'}
                    </p>
                  </div>
                </div>
              ) : null}

              <div className="mt-4 flex flex-col gap-4">
                <div className="max-w-[12rem]">
                  <label htmlFor="marks" className="mb-1.5 block text-sm font-medium text-ink-strong">
                    Marks out of {maxMarks}
                  </label>
                  <Input
                    id="marks"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={maxMarks}
                    step={1}
                    placeholder="—"
                    value={marksValue}
                    disabled={locked || notSubmitted}
                    aria-invalid={marksError ? 'true' : undefined}
                    aria-describedby={marksError ? 'marks-error' : undefined}
                    onChange={(event) => setMarksValue(event.target.value)}
                  />
                  {marksError ? (
                    <p id="marks-error" className="mt-1.5 text-sm text-danger">
                      {marksError}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor="comment" className="mb-1.5 block text-sm font-medium text-ink-strong">
                    Comment for the student
                  </label>
                  <Textarea
                    id="comment"
                    rows={4}
                    maxLength={2000}
                    placeholder="What worked, what to fix, and why they earned the marks they did."
                    value={commentValue}
                    disabled={locked || notSubmitted}
                    onChange={(event) => setCommentValue(event.target.value)}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-ink-faint">
                    Saved grades stay hidden from the student until you release results.
                  </p>
                  <Button
                    type="button"
                    onClick={() => save.mutate()}
                    disabled={locked || notSubmitted || save.isPending || marksError !== null}
                  >
                    {save.isPending ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Save className="h-4 w-4" aria-hidden="true" />
                    )}
                    {save.isPending ? 'Saving' : 'Save grades'}
                  </Button>
                </div>
              </div>
            </Card>
          </section>
        </div>
      ) : null}
    </div>
  )
}