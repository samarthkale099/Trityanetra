import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  CalendarClock,
  FileQuestion,
  Fingerprint,
  ListChecks,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react'
import { examApi } from '@/features/exam/examApi'
import {
  FLAG_LABELS,
  integrityApi,
  plagiarismApi,
  reviewApi,
  type FlagLevel,
  type FlagType,
  type PlagiarismPair,
} from '@/features/classrooms/reviewApi'
import { formatWindow, testStatus } from '@/features/exam/testWindow'
import { formatIST } from '@/shared/lib/datetime'
import { PageHeader } from '@/shared/components/page-header'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card } from '@/shared/components/ui/card'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { ErrorState } from '@/shared/components/ui/error-state'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { toast } from '@/shared/components/ui/toast'
import { TestStatusBadge } from '@/pages/teacher/TestStatusBadge'
import { LANGUAGE_LABELS, type TestDetail, type TestStatus } from '@/shared/types/classroom'

const STATUS_PHRASE: Record<TestStatus, string> = {
  UPCOMING: 'has not opened yet',
  LIVE: 'is open now',
  ENDED: 'has closed',
}

const percent = (value: number) => `${Math.round((Number(value) || 0) * 100)}%`

/* ===================================================================== */
/*  Questions                                                             */
/* ===================================================================== */

function QuestionsTab({ test }: { test: TestDetail }) {
  return (
    <>
      <Card className="px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{LANGUAGE_LABELS[test.language]}</Badge>
          <Badge variant="outline">
            <FileQuestion className="h-3.5 w-3.5" aria-hidden="true" />
            {test.questions.length} {test.questions.length === 1 ? 'question' : 'questions'}
          </Badge>
          <Badge variant="outline">
            <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
            {test.totalPoints} points
          </Badge>
          <TestStatusBadge window={test} />
        </div>
        <p className="mt-3 flex items-center gap-2 text-sm text-ink">
          <CalendarClock className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
          {formatWindow(test)}
        </p>
        <p className="mt-1 text-sm text-ink-faint">
          {test.durationMinutes} minutes per student · window {STATUS_PHRASE[testStatus(test, Date.now())]}.
        </p>
        {test.instructions ? (
          <p className="mt-3 whitespace-pre-wrap border-t border-line pt-3 text-sm text-ink">{test.instructions}</p>
        ) : null}
      </Card>

      <ol className="stagger mt-6 flex flex-col gap-3">
        {test.questions.map((question, index) => (
          <li key={question.id}>
            <Card className="px-5 py-4">
              <h2 className="font-semibold text-ink-strong">
                Question {index + 1}
                <span className="ml-2 text-sm font-normal text-ink-faint">
                  {question.points} {question.points === 1 ? 'point' : 'points'}
                </span>
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{question.prompt}</p>
              {question.starterCode ? (
                <pre className="mt-3 overflow-x-auto rounded-md border border-line bg-canvas-sunken px-3 py-2.5 font-mono text-xs leading-relaxed text-ink">
                  {question.starterCode}
                </pre>
              ) : null}
              <p className="mt-3 text-xs text-ink-faint">
                {question.testCases.length} test {question.testCases.length === 1 ? 'case' : 'cases'}. Hidden cases are
                never sent to students -- they see only whether each passed.
              </p>
            </Card>
          </li>
        ))}
      </ol>
    </>
  )
}

/* ===================================================================== */
/*  Integrity                                                             */
/* ===================================================================== */

function IntegrityTab({ testId }: { testId: string }) {
  const report = useQuery({
    queryKey: ['integrity', testId],
    queryFn: ({ signal }) => integrityApi.getReport(testId, signal),
  })

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex items-start gap-3 px-5 py-4">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-brand-text" aria-hidden="true" />
        <p className="text-sm leading-relaxed text-ink">
          These signals were raised in each student's browser during the exam. They are{' '}
          <strong className="text-ink-strong">advisory only</strong>: a flag can have an innocent cause (a
          notification, a pop-up), and nothing here changes a mark on its own. Use them together with the code itself.
        </p>
      </Card>

      {report.isPending ? (
        <div aria-busy="true" aria-label="Loading the integrity report" className="flex flex-col gap-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : report.isError ? (
        <ErrorState
          title="Could not load the integrity report"
          message={report.error instanceof Error ? report.error.message : 'Try again in a moment.'}
          onRetry={() => void report.refetch()}
        />
      ) : report.data.students.length === 0 ? (
        <Card>
          <EmptyState
            icon={ShieldAlert}
            title="No flags raised"
            description="No student left the exam tab, pasted, opened developer tools or exited fullscreen."
          />
        </Card>
      ) : (
        <ul className="stagger flex flex-col gap-2">
          {report.data.students.map((student) => (
            <li key={student.studentId}>
              <Card className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink-strong">{student.studentName}</p>
                    <p className="truncate text-sm text-ink-faint">{student.studentEmail}</p>
                  </div>
                  <Badge variant={student.total >= 5 ? 'danger' : student.total >= 2 ? 'warning' : 'neutral'} dot>
                    {student.total} {student.total === 1 ? 'flag' : 'flags'}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(Object.entries(student.counts) as [FlagType, number][]).map(([type, count]) => (
                    <Badge key={type} variant="outline">
                      {FLAG_LABELS[type] ?? type} × {count}
                    </Badge>
                  ))}
                </div>
                {student.flags.some((flag) => flag.at) ? (
                  <p className="mt-2 text-xs text-ink-faint">
                    Most recent: {formatIST(student.flags.find((flag) => flag.at)?.at ?? '')}
                  </p>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ===================================================================== */
/*  Plagiarism                                                            */
/* ===================================================================== */

const LEVEL_META: Record<FlagLevel, { label: string; variant: 'danger' | 'warning' | 'info' | 'neutral' }> = {
  high: { label: 'High', variant: 'danger' },
  medium: { label: 'Medium', variant: 'warning' },
  low: { label: 'Low', variant: 'info' },
  none: { label: 'None', variant: 'neutral' },
}

const METRIC_ROWS: { key: keyof PlagiarismPair['metrics']; label: string; hint: string }[] = [
  { key: 'combined_score', label: 'Combined', hint: 'Weighted overall similarity' },
  { key: 'cosine_similarity', label: 'Building blocks', hint: 'Same constructs, in similar amounts (40%)' },
  { key: 'ted_score', label: 'Structure', hint: 'Tree-edit similarity of the program shape (30%)' },
  { key: 'identifier_overlap', label: 'Names', hint: 'Shared variable and function names (20%)' },
  { key: 'operator_overlap', label: 'Operators', hint: 'Shared operators (10%)' },
]

/** The two students' code, side by side, for one compared pair. */
function PairCompare({ testId, pair, onClose }: { testId: string; pair: PlagiarismPair; onClose: () => void }) {
  const a = useQuery({
    queryKey: ['review', testId, pair.studentA.id],
    queryFn: ({ signal }) => reviewApi.getSubmission(testId, pair.studentA.id, signal),
  })
  const b = useQuery({
    queryKey: ['review', testId, pair.studentB.id],
    queryFn: ({ signal }) => reviewApi.getSubmission(testId, pair.studentB.id, signal),
  })

  const side = (label: string, query: typeof a) => (
    <div className="min-w-0">
      <p className="mb-2 truncate text-sm font-medium text-ink-strong">{label}</p>
      {query.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : query.isError ? (
        <p className="text-sm text-danger">Could not load this submission.</p>
      ) : (
        <pre className="max-h-[28rem] overflow-auto rounded-md border border-line bg-canvas-sunken px-3 py-2.5 font-mono text-xs leading-relaxed text-ink">
          {query.data.code || '(no code)'}
        </pre>
      )}
    </div>
  )

  return (
    <Card elevated className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-serif text-xl font-medium text-ink-strong">Side by side</h3>
          <Badge variant={LEVEL_META[pair.flagLevel].variant} dot>
            {LEVEL_META[pair.flagLevel].label} · {percent(pair.metrics.combined_score)}
          </Badge>
        </div>
        <Button variant="ghost" size="icon" aria-label="Close comparison" onClick={onClose}>
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {side(pair.studentA.name, a)}
        {side(pair.studentB.name, b)}
      </div>
      <p className="mt-3 text-xs text-ink-faint">
        A high score is a reason to look closer, not a verdict: short or very standard solutions can be similar when
        written honestly.
      </p>
    </Card>
  )
}

function PlagiarismTab({ testId }: { testId: string }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState<PlagiarismPair | null>(null)
  const [showAll, setShowAll] = useState(false)

  const result = useQuery({
    queryKey: ['plagiarism', testId],
    queryFn: ({ signal }) => plagiarismApi.getResult(testId, signal),
    // Poll while the check is queued or running.
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'QUEUED' || status === 'PROCESSING' ? 2000 : false
    },
  })

  const run = useMutation({
    mutationFn: () => plagiarismApi.check(testId),
    onSuccess: () => {
      toast.success('Plagiarism check started', { description: 'Results appear here when it finishes.' })
      void queryClient.invalidateQueries({ queryKey: ['plagiarism', testId] })
    },
    onError: (error: Error) => toast.error('Could not start the check', { description: error.message }),
  })

  const data = result.data
  const running = data?.status === 'QUEUED' || data?.status === 'PROCESSING' || run.isPending
  const pairs = data ? [...(showAll ? data.pairs : data.pairs.filter((p) => p.flagLevel !== 'none'))] : []
  pairs.sort((x, y) => y.metrics.combined_score - x.metrics.combined_score)
  const skipped = data ? Object.entries(data.skipped) : []

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <Fingerprint className="mt-0.5 h-5 w-5 shrink-0 text-brand-text" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm leading-relaxed text-ink">
              Compares every submitted answer with every other one by its <strong>structure</strong>, so renamed
              variables and reordered lines are still caught. Python submissions only, up to 50 per check.
            </p>
            {data?.updatedAt ? (
              <p className="mt-1 text-xs text-ink-faint">Last updated {formatIST(data.updatedAt)}</p>
            ) : null}
          </div>
        </div>
        <Button onClick={() => run.mutate()} disabled={running}>
          {running ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          )}
          {running ? 'Checking…' : data?.status ? 'Run again' : 'Run check'}
        </Button>
      </Card>

      {result.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : result.isError ? (
        <ErrorState
          title="Could not load plagiarism results"
          message={result.error instanceof Error ? result.error.message : 'Try again in a moment.'}
          onRetry={() => void result.refetch()}
        />
      ) : !data || data.status === null ? (
        <Card>
          <EmptyState
            icon={Fingerprint}
            title="No check run yet"
            description="Run a check once students have submitted. It compares this test's submissions with each other."
          />
        </Card>
      ) : data.status === 'QUEUED' || data.status === 'PROCESSING' ? (
        <Card className="flex items-center gap-3 px-5 py-6" role="status" aria-live="polite">
          <LoaderCircle className="h-5 w-5 animate-spin text-brand-text" aria-hidden="true" />
          <p className="text-sm text-ink">
            {data.status === 'QUEUED' ? 'Waiting for the checker to start…' : 'Comparing submissions…'}
          </p>
        </Card>
      ) : data.status === 'FAILED' ? (
        <Card className="flex items-start gap-3 px-5 py-4" role="alert">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden="true" />
          <p className="text-sm text-ink">The check failed: {data.error ?? 'unknown error'}. Run it again.</p>
        </Card>
      ) : (
        <>
          {data.message ? (
            <Card className="px-5 py-4 text-sm text-ink">{data.message}</Card>
          ) : null}

          {data.summary ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                ['Submissions', data.summary.totalSubmissions],
                ['Pairs compared', data.summary.totalPairs],
                ['Flagged', data.summary.flaggedPairs],
                ['Time', `${(data.summary.processingTimeMs / 1000).toFixed(1)} s`],
              ].map(([label, value]) => (
                <div key={String(label)} className="surface-sheen rounded-lg border border-line px-4 py-3 shadow-card">
                  <p className="text-xs uppercase tracking-[0.12em] text-ink-faint">{label}</p>
                  <p className="mt-2 font-serif text-3xl font-medium tabular-nums text-ink-strong">{value}</p>
                </div>
              ))}
            </div>
          ) : null}

          {open ? <PairCompare testId={testId} pair={open} onClose={() => setOpen(null)} /> : null}

          <div className="flex items-center justify-between gap-3">
            <h3 className="font-serif text-2xl font-medium text-ink-strong">
              {showAll ? 'All compared pairs' : 'Pairs worth a look'}
            </h3>
            <Button variant="link" onClick={() => setShowAll((value) => !value)}>
              {showAll ? 'Show only flagged' : 'Show all pairs'}
            </Button>
          </div>

          {pairs.length === 0 ? (
            <Card className="px-5 py-6 text-sm text-ink-faint">
              {showAll ? 'No pairs were compared.' : 'No pair scored above the low threshold.'}
            </Card>
          ) : (
            <ul className="stagger flex flex-col gap-2">
              {pairs.map((pair) => (
                <li key={`${pair.submissionA}|${pair.submissionB}`}>
                  <Card interactive className="px-5 py-4" onClick={() => setOpen(pair)}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="min-w-0 font-medium text-ink-strong">
                        {pair.studentA.name} <span className="text-ink-faint">↔</span> {pair.studentB.name}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="font-serif text-xl tabular-nums text-ink-strong">
                          {percent(pair.metrics.combined_score)}
                        </span>
                        <Badge variant={LEVEL_META[pair.flagLevel].variant} dot>
                          {LEVEL_META[pair.flagLevel].label}
                        </Badge>
                      </div>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
                      {METRIC_ROWS.slice(1).map((metric) => (
                        <div key={metric.key} className="flex justify-between gap-2" title={metric.hint}>
                          <dt className="text-ink-faint">{metric.label}</dt>
                          <dd className="tabular-nums text-ink">{percent(pair.metrics[metric.key])}</dd>
                        </div>
                      ))}
                    </dl>
                    <Button
                      variant="link"
                      size="sm"
                      className="mt-2"
                      onClick={(event) => {
                        event.stopPropagation()
                        setOpen(pair)
                      }}
                    >
                      Compare code side by side
                    </Button>
                  </Card>
                </li>
              ))}
            </ul>
          )}

          {skipped.length > 0 ? (
            <Card className="px-5 py-4">
              <p className="text-sm font-medium text-ink-strong">
                {skipped.length} {skipped.length === 1 ? 'submission was' : 'submissions were'} not checked
              </p>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-ink-faint">
                {skipped.map(([submissionId, reason]) => (
                  <li key={submissionId}>
                    {submissionId.replace(`${testId}_`, '')}: {reason}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      )}
    </div>
  )
}

/* ===================================================================== */
/*  Page                                                                  */
/* ===================================================================== */

/**
 * A teacher's view of one test: the questions as students will see them, the
 * integrity (monitoring) report, and the AST plagiarism check.
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
        <ErrorState title="No test selected" message="This address is missing a test id. Open a test from your classroom." />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader
        breadcrumbs={[
          { label: 'Classrooms', to: '/app/classrooms' },
          ...(classroomId ? [{ label: 'Classroom', to: `/app/classrooms/${encodeURIComponent(classroomId)}` }] : []),
          { label: 'Test' },
        ]}
        title={test.data?.title ?? 'Test'}
        description="The questions, the integrity report and the plagiarism check for this test."
        actions={
          classroomId ? (
            <Button asChild variant="secondary">
              <Link
                to={`/app/classrooms/${encodeURIComponent(classroomId)}/tests/${encodeURIComponent(testId)}/submissions`}
              >
                <ListChecks className="h-4 w-4" aria-hidden="true" />
                Submissions &amp; grading
              </Link>
            </Button>
          ) : null
        }
      />

      <Tabs defaultValue="questions">
        <TabsList className="mb-6 flex gap-2 border-b border-line" aria-label="Test sections">
          <TabsTrigger value="questions">Questions</TabsTrigger>
          <TabsTrigger value="integrity">Integrity</TabsTrigger>
          <TabsTrigger value="plagiarism">Plagiarism</TabsTrigger>
        </TabsList>

        <TabsContent value="questions">
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
            <QuestionsTab test={test.data} />
          )}
        </TabsContent>
        <TabsContent value="integrity">
          <IntegrityTab testId={testId} />
        </TabsContent>
        <TabsContent value="plagiarism">
          <PlagiarismTab testId={testId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
