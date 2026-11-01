import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ClipboardList, Clock, Lock, XCircle } from 'lucide-react'
import { resultApi, type ResultCase } from '@/features/exam/resultApi'
import { ApiError } from '@/shared/lib/httpClient'
import { formatIST } from '@/shared/lib/datetime'
import { PageHeader } from '@/shared/components/page-header'
import { Button } from '@/shared/components/ui/button'
import { Badge } from '@/shared/components/ui/badge'
import { Card } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { ErrorState } from '@/shared/components/ui/error-state'
import { EmptyState } from '@/shared/components/ui/empty-state'

/**
 * A student's own result for one test.
 *
 * The rules the screen renders around are the server's, not the client's: the
 * payload it reads already withholds a hidden case's content and withholds the
 * marks until release. This page only decides how to *present* what it was sent,
 * so it cannot leak a hidden case even by mistake.
 *
 * Reached from the dashboard's "View result" action on a submitted test, and from
 * the lobby's submitted panel after an exam ends.
 */

/**
 * A circular gauge for the pass rate. The arc draws itself in on mount (a CSS
 * transition on `stroke-dashoffset`), in gold, on a faint track. It is
 * decorative: the same figure is written out beside it and carried by the
 * labelled progress bar, so `aria-hidden` keeps it from being read twice.
 */
function ScoreRing({ percent }: { percent: number }) {
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const [drawn, setDrawn] = useState(0)
  useEffect(() => {
    // One frame at 0 first, so the arc animates from empty rather than
    // appearing already full.
    const frame = requestAnimationFrame(() => setDrawn(percent))
    return () => cancelAnimationFrame(frame)
  }, [percent])

  return (
    <div className="relative h-32 w-32 shrink-0" aria-hidden="true">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <defs>
          <linearGradient id="score-ring-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f0dda6" />
            <stop offset="55%" stopColor="#d4af5a" />
            <stop offset="100%" stopColor="#a8822f" />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r={radius} fill="none" strokeWidth="8" className="stroke-line" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          stroke="url(#score-ring-gold)"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - drawn / 100)}
          className="drop-shadow-[0_0_6px_rgb(var(--glow)/0.35)] transition-[stroke-dashoffset] duration-[1400ms] ease-out motion-reduce:transition-none"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-serif text-3xl font-medium tabular-nums leading-none text-ink-strong">{percent}%</span>
        <span className="mt-1 text-[10px] uppercase tracking-[0.14em] text-ink-faint">passed</span>
      </div>
    </div>
  )
}

function CaseRow({ testCase }: { testCase: ResultCase }) {
  const passed = testCase.state === 'PASS'
  return (
    <li className="relative overflow-hidden rounded-md border border-line bg-canvas/40 p-4 pl-5 transition-colors duration-300 hover:border-line-strong">
      {/* A slim state stripe on the leading edge: scannable down a long list. */}
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-[3px] ${passed ? 'bg-success/70' : 'bg-danger/70'}`}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-ink-strong">{testCase.name}</span>
        <Badge variant={passed ? 'success' : 'danger'} dot>
          {passed ? (
            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
          ) : (
            <XCircle className="h-3 w-3" aria-hidden="true" />
          )}
          {/* The state is spelled out as text as well as coloured, so it does not
              depend on colour alone to be read. */}
          {passed ? 'Passed' : 'Failed'}
        </Badge>
      </div>

      {testCase.hidden ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-faint">
          <Lock className="h-3 w-3" aria-hidden="true" />
          This is a hidden test case. Only its result is shown.
        </p>
      ) : (
        <dl className="mt-2 grid gap-1 font-mono text-xs text-ink">
          <div className="flex gap-2">
            <dt className="shrink-0 text-ink-faint">Input</dt>
            <dd className="break-words">{testCase.input ?? '—'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="shrink-0 text-ink-faint">Expected</dt>
            <dd className="break-words">{testCase.expected ?? '—'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="shrink-0 text-ink-faint">Your output</dt>
            <dd className="break-words">{testCase.actual ?? '—'}</dd>
          </div>
        </dl>
      )}
    </li>
  )
}

export function StudentResultPage() {
  const { testId } = useParams<{ testId: string }>()

  const query = useQuery({
    queryKey: ['test', 'result', testId],
    enabled: Boolean(testId),
    queryFn: ({ signal }) => resultApi.getResult(testId as string, signal),
  })

  const result = query.data ?? null
  const notFound = query.error instanceof ApiError && query.error.status === 404

  const backToTests = (
    <Button asChild variant="secondary">
      <Link to="/app/student">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        My tests
      </Link>
    </Button>
  )

  if (!testId) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <ErrorState
          title="No test selected"
          message="This address is missing a test id. Open a result from your dashboard."
        />
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4">
        <ErrorState
          title="We couldn't find that result"
          message="There is no result for you on this test. If you submitted it, ask your teacher to check it is recorded."
        />
        <Button asChild variant="secondary">
          <Link to="/app/student">Back to my tests</Link>
        </Button>
      </div>
    )
  }

  const percent = result && result.totalCases > 0 ? Math.round((result.passedCases / result.totalCases) * 100) : 0
  const onTime = result?.state === 'SUBMITTED'

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        breadcrumbs={[{ label: 'My tests', to: '/app/student' }, { label: result?.testTitle ?? 'Result' }]}
        title={result?.testTitle ?? 'Your result'}
        actions={backToTests}
      />

      {query.isPending ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading your result">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      ) : null}

      {query.isError && !notFound ? (
        <ErrorState
          title="We couldn't load your result"
          message={query.error instanceof Error ? query.error.message : 'Check your connection and try again.'}
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {result ? (
        <div className="flex flex-col gap-6">
          <Card className="p-6 sm:p-7">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
              <ScoreRing percent={percent} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="font-serif text-2xl font-medium text-ink-strong">Your submission</h2>
                    <p className="mt-1 text-sm text-ink">Submitted {formatIST(result.submittedAt)}</p>
                  </div>
                  <Badge variant={onTime ? 'success' : 'warning'} dot>
                    {onTime ? 'On time' : 'Late'}
                  </Badge>
                </div>

                <div className="mt-5">
                  <p className="text-sm text-ink">
                    <span className="font-display text-lg font-semibold tabular-nums text-ink-strong">
                      {result.passedCases}
                    </span>{' '}
                    of {result.totalCases} test {result.totalCases === 1 ? 'case' : 'cases'} passed
                  </p>
                  {/* A bar AND the sentence above: the count is never carried by the
                  fill alone, which a colour-blind reader could not measure. */}
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={result.totalCases}
                    aria-valuenow={result.passedCases}
                    aria-label="Test cases passed"
                    className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink-faint/15"
                  >
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,#a8822f,#d4af5a,#f0dda6)] transition-[width] duration-1000 ease-out"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-soft ring-1 ring-inset ring-brand-300/40">
                <ClipboardList className="h-4 w-4 text-brand-text" aria-hidden="true" />
              </span>
              <h2 className="font-serif text-2xl font-medium text-ink-strong">Test cases</h2>
            </div>

            {result.cases.length === 0 ? (
              <EmptyState
                icon={Clock}
                title="Results are on their way"
                description="Your code has not finished being checked yet. Check back in a moment."
              />
            ) : (
              <ul className="stagger mt-4 flex flex-col gap-3">
                {result.cases.map((testCase) => (
                  <CaseRow key={testCase.id} testCase={testCase} />
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-6">
            <h2 className="font-serif text-2xl font-medium text-ink-strong">Marks and comment</h2>
            {result.marksReleased ? (
              <>
                {result.marks !== null ? (
                  <p className="mt-4 font-serif text-6xl font-medium tabular-nums leading-none tracking-tight text-ink-strong">
                    {result.marks}
                    <span className="font-sans text-lg font-normal tracking-normal text-ink-faint">
                      {' '}
                      / {result.maxMarks}
                    </span>
                  </p>
                ) : (
                  <Badge variant="warning" className="mt-3">
                    Not graded
                  </Badge>
                )}
                {result.comment ? (
                  <blockquote className="mt-5 whitespace-pre-line border-l-2 border-brand-400/60 pl-4 font-serif text-lg italic leading-relaxed text-ink">
                    {result.comment}
                  </blockquote>
                ) : (
                  <p className="mt-3 text-sm text-ink-faint">Your teacher left no comment.</p>
                )}
                {result.releasedAt ? (
                  <p className="mt-3 text-xs text-ink-faint">Released {formatIST(result.releasedAt)}</p>
                ) : null}
              </>
            ) : (
              <p className="mt-3 text-sm text-ink">Your teacher has not released marks yet.</p>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  )
}
