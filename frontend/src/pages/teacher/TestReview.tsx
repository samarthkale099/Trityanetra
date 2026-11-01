import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { CalendarClock, FileQuestion, ListChecks, LoaderCircle } from 'lucide-react'
import { examApi } from '@/features/exam/examApi'
import { formatWindow, testStatus } from '@/features/exam/testWindow'
import { PageHeader } from '@/shared/components/page-header'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card } from '@/shared/components/ui/card'
import { ErrorState } from '@/shared/components/ui/error-state'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { TestStatusBadge } from '@/pages/teacher/TestStatusBadge'
import { LANGUAGE_LABELS, type TestStatus } from '@/shared/types/classroom'

const STATUS_PHRASE: Record<TestStatus, string> = {
  UPCOMING: 'has not opened yet',
  LIVE: 'is open now',
  ENDED: 'has closed',
}

/**
 * Read-only authoring view of one test.
 *
 * A teacher previews a test rather than sitting it, so this deliberately shares
 * nothing with the exam route: no timer, no fullscreen guard, no proctoring, and
 * no submit path. Grading and per-student results are out of scope here, which
 * is why the page stops at "here is what the students will see".
 */
export function TestReviewPage() {
  const { classroomId, testId } = useParams<{ classroomId: string; testId: string }>()

  const test = useQuery({
    queryKey: ['test', testId],
    queryFn: ({ signal }) => examApi.getTest(testId as string, signal),
    enabled: Boolean(testId),
  })

  if (!testId) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <ErrorState
          title="No test selected"
          message="This address is missing a test id. Open a test from your classroom."
        />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        breadcrumbs={[
          { label: 'Classrooms', to: '/app/classrooms' },
          ...(classroomId
            ? [{ label: 'Classroom', to: `/app/classrooms/${encodeURIComponent(classroomId)}` }]
            : []),
          { label: 'Test' },
        ]}
        title={test.data?.title ?? 'Test'}
        description="Exactly what your students see when they open this test."
        actions={
          testId && classroomId ? (
            <Button asChild variant="secondary">
              <Link
                to={`/app/classrooms/${encodeURIComponent(classroomId)}/tests/${encodeURIComponent(testId)}/submissions`}
              >
                <ListChecks className="h-4 w-4" aria-hidden="true" />
                View submissions
              </Link>
            </Button>
          ) : null
        }
      />

      {test.isPending ? (
        <div className="flex flex-col gap-3" role="status" aria-live="polite">
          <p className="flex items-center gap-2 text-sm text-ink-faint">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading the test...
          </p>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : test.isError ? (
        <ErrorState
          title="Could not load this test"
          message="The test either does not exist, is not yours, or the server is unavailable."
          onRetry={() => void test.refetch()}
        />
      ) : (
        <>
          <Card className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{LANGUAGE_LABELS[test.data.language]}</Badge>
              <Badge variant="outline">
                <FileQuestion className="h-3.5 w-3.5" aria-hidden="true" />
                {test.data.questions.length}{' '}
                {test.data.questions.length === 1 ? 'question' : 'questions'}
              </Badge>
              <Badge variant="outline">
                <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
                {test.data.totalPoints} points
              </Badge>
              <TestStatusBadge window={test.data} />
            </div>
            <p className="mt-3 flex items-center gap-2 text-sm text-ink">
              <CalendarClock className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
              {formatWindow(test.data)}
            </p>
            <p className="mt-1 text-sm text-ink-faint">
              {test.data.durationMinutes} minutes per student - window{' '}
              {STATUS_PHRASE[testStatus(test.data, Date.now())]}.
            </p>
            {test.data.instructions ? (
              <p className="mt-3 whitespace-pre-wrap border-t border-line pt-3 text-sm text-ink">
                {test.data.instructions}
              </p>
            ) : null}
          </Card>

          <ol className="mt-6 flex flex-col gap-3">
            {test.data.questions.map((question, index) => (
              <li key={question.id}>
                <Card className="px-5 py-4">
                  <div className="flex items-baseline justify-between gap-4">
                    <h2 className="font-semibold text-ink-strong">
                      Question {index + 1}
                      <span className="ml-2 text-sm font-normal text-ink-faint">
                        {question.points} {question.points === 1 ? 'point' : 'points'}
                      </span>
                    </h2>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{question.prompt}</p>
                  {question.starterCode ? (
<pre className="mt-3 overflow-x-auto rounded-md border border-line bg-canvas-sunken px-3 py-2.5 font-mono text-xs leading-relaxed text-ink">
                    {question.starterCode}
                  </pre>
                  ) : null}
                  {/*
                    Hidden cases are stripped server-side, so anything absent here
                    is the contract working rather than missing data.
                  */}
                  <p className="mt-3 text-xs text-ink-faint">
                    {question.testCases.length} public test case
                    {question.testCases.length === 1 ? '' : 's'}. Hidden cases are not
                    shown to the teacher either, so they cannot be leaked from this page.
                  </p>
                </Card>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}
