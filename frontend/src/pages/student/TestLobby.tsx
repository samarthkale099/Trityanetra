import { useCallback, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Clock, Info, LoaderCircle, ShieldCheck } from 'lucide-react'
import { examApi } from '@/features/exam/examApi'
import {
  canStartExam,
  createServerClock,
  describeCountdown,
  effectiveDeadlineMs,
  formatCountdown,
  formatWindow,
  msUntilClose,
  msUntilOpen,
  serverNow,
  testStatus,
} from '@/features/exam/testWindow'
import { formatIST, formatISTTime } from '@/shared/lib/datetime'
import { useNow } from '@/shared/hooks/useNow'
import { PageHeader } from '@/shared/components/page-header'
import { Button } from '@/shared/components/ui/button'
import { Badge } from '@/shared/components/ui/badge'
import { Card } from '@/shared/components/ui/card'
import { Alert } from '@/shared/components/ui/alert'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { ErrorState } from '@/shared/components/ui/error-state'
import { LANGUAGE_LABELS } from '@/shared/types/classroom'
import { toast } from '@/shared/components/ui/toast'

/** The rules a student reads before committing to an exam. */
const RULES = [
  'Stay in fullscreen for the whole exam. Leaving it pauses nothing but is recorded.',
  'Switching tabs or windows is recorded against this attempt.',
  'Pasting and dropping code is blocked. Type your solution.',
  'Your work is saved as you type and submitted once. You can submit early.',
] as const

export function TestLobbyPage() {
  const { testId } = useParams<{ testId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const localNow = useNow(1000)

  const query = useQuery({
    queryKey: ['test', 'lobby', testId],
    enabled: Boolean(testId),
    // The window moves continuously, so the lobby is refetched periodically to
    // pick up a window that opened or closed while the tab was in the background.
    refetchInterval: 30_000,
    queryFn: ({ signal }) => examApi.getLobby(testId as string, signal),
  })

  const lobby = query.data ?? null

  /**
   * Server time, derived from the `serverTime` the backend sent.
   *
   * `query.dataUpdatedAt` is the local timestamp at which this payload was
   * received, which is exactly the pair `createServerClock` needs to measure the
   * offset. Memoised on both values so the object is stable across the one-second
   * ticks that only change `localNow`.
   */
  const clock = useMemo(
    () =>
      lobby ? createServerClock(lobby.serverTime, query.dataUpdatedAt || Date.now()) : null,
    [lobby, query.dataUpdatedAt],
  )

  const now = clock ? serverNow(clock, localNow) : localNow

  const status = lobby ? testStatus(lobby.test, now) : null
  const submitted = lobby?.submission ?? null
  const attemptStarted = lobby?.startedAt != null

  /*
   * How long this student can still sit the test. Before the attempt starts the
   * answer is "the full duration, clipped by the window close"; afterwards it is
   * what is left of the latched allowance. Either way the start button is only
   * enabled when the answer is positive, so an exhausted attempt is resumed back
   * into the exam's read-only "time is up" state rather than a fresh editor.
   */
  const timeLeftMs = useMemo(() => {
    if (!lobby) return 0
    const from = lobby.startedAt ? Date.parse(lobby.startedAt) : now
    if (!Number.isFinite(from)) return 0
    return Math.max(0, effectiveDeadlineMs(lobby.test, from) - now)
  }, [lobby, now])

  const startable = Boolean(lobby) && canStartExam(lobby!.test, now, Boolean(submitted)) && timeLeftMs > 0

  /*
   * The attempt is latched here, at the moment the student commits to it, and the
   * exam route is only entered once the server has answered.
   *
   * `ExamPage` starts an attempt too, because a student can type the exam URL and
   * skip this screen. Latching only there left a gap as wide as the lazily loaded
   * exam chunk: pressing Start navigated straight away, and any reload inside that
   * window cost the student nothing, because the server had not yet been told an
   * attempt began. That is exactly the "reload must not buy a fresh clock" rule
   * this screen exists to protect, and it failed whenever the chunk was slower
   * than the navigation. Committing here closes the gap at its source.
   *
   * The server latches on the first successful call and returns the same clock
   * afterwards, so the exam's own call is a no-op that costs one round trip and
   * cannot reset anything. An attempt that already exists skips the call
   * entirely; the allowance is already running and there is nothing to ask for.
   */
  const [starting, setStarting] = useState(false)

  const enterExam = useCallback(async () => {
    if (!testId) return
    const openExam = () => navigate(`/app/tests/${encodeURIComponent(testId)}/exam`, { replace: true })

    if (attemptStarted) {
      openExam()
      return
    }

    setStarting(true)
    try {
      const latched = await examApi.startAttempt(testId)
      // Seeded into the cache the exam reads under the same key, so the exam
      // mounts already holding the latched clock instead of latching again.
      queryClient.setQueryData(['test', 'lobby', testId], latched)
      openExam()
    } catch (error) {
      setStarting(false)
      toast.error('Could not start the exam', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    }
  }, [attemptStarted, navigate, queryClient, testId])

  if (!testId) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <ErrorState
          title="No test selected"
          message="This address is missing a test id. Open a test from your dashboard."
        />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        breadcrumbs={[
          { label: 'My tests', to: '/app/student' },
          { label: lobby?.test.title ?? 'Test' },
        ]}
        title={lobby?.test.title ?? 'Test lobby'}
        description={lobby ? lobby.test.classroomName : undefined}
      />

      {query.isPending ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading the test">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : null}

      {query.isError ? (
        <ErrorState
          title="We couldn't load this test"
          message={
            query.error instanceof Error
              ? query.error.message
              : 'The test may have been withdrawn, or you may not be enrolled.'
          }
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {lobby && clock ? (
        <div className="flex flex-col gap-6">
          {/* Submission state replaces the start panel entirely: a closed exam
              that has already been submitted is a result screen, not a lobby. */}
          {submitted ? (
            <Card className="p-6">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-success" aria-hidden="true" />
                <div>
                  <h2 className="text-xl font-semibold text-ink-strong">Submitted</h2>
                  <p className="mt-1 text-sm text-ink">
                    Your work was recorded at{' '}
                    {formatIST(submitted.submittedAt)}. It cannot be changed now.
                  </p>
                  {submitted.score !== null && submitted.maxScore !== null ? (
                    <p className="mt-3 font-display text-2xl font-semibold text-ink-strong">
                      {submitted.score}
                      <span className="text-base font-normal text-ink-faint"> / {submitted.maxScore}</span>
                    </p>
                  ) : (
                    <Badge variant="warning" className="mt-3">
                      Awaiting grading
                    </Badge>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      onClick={() =>
                        navigate(`/app/tests/${encodeURIComponent(lobby.test.id)}/result`)
                      }
                    >
                      View result
                    </Button>
                    <Button variant="secondary" onClick={() => navigate('/app/student')}>
                      Back to my tests
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          ) : (
            <Card className="p-6">
              <div className="flex flex-wrap items-center justify-between gap-6">
                <div>
                  <p className="text-sm text-ink">Time remaining in the window</p>
                  {/*
                    `text-5xl` and `tabular-nums`: this countdown is the one
                    expressive moment on the page, and tabular figures stop the
                    whole block twitching once a second as the digits change width.
                  */}
                  {status === 'LIVE' ? (
                    <p
                      className="mt-1 font-display text-5xl font-semibold tabular-nums text-ink-strong"
                      // Announced every second would be hostile to a screen
                      // reader, so the live region is polite and short.
                      aria-live="off"
                    >
                      {formatCountdown(msUntilClose(lobby.test, now))}
                    </p>
                  ) : status === 'UPCOMING' ? (
                    <p className="mt-1 font-display text-5xl font-semibold tabular-nums text-ink-strong">
                      {formatCountdown(msUntilOpen(lobby.test, now))}
                    </p>
                  ) : (
                    <p className="mt-1 font-display text-3xl font-semibold text-ink-faint">Closed</p>
                  )}
                </div>
                {/* Right-aligned only once there is room beside it; below that the
                    flex wrap puts it on its own line, where right alignment reads
                    as accidental. */}
                <div className="text-left sm:text-right">
                  <p className="text-sm text-ink">Your allowance</p>
                  <p className="mt-1 font-display text-2xl font-semibold text-ink-strong">
                    {lobby.test.durationMinutes} min
                  </p>
                  {/*
                    The allowance runs from the moment the attempt is started, not
                    from `windowStart`. A student who opens the test halfway
                    through the window still gets the full duration, so the only
                    honest thing to show before starting is the duration itself.
                  */}
                  {lobby.startedAt && !submitted ? (
                    <p className="mt-1 text-xs text-warning">
                      Started {formatISTTime(lobby.startedAt)} -{' '}
                      {formatCountdown(timeLeftMs)} left
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-ink-faint">Starts when you press Start exam</p>
                  )}
                </div>
              </div>

              <div className="mt-5 border-t border-line pt-5">
                {status === 'UPCOMING' ? (
                  <Alert variant="info" icon={Clock} title="Not open yet">
                    This exam opens {describeCountdown(msUntilOpen(lobby.test, now))}. The start button
                    unlocks on its own - there is nothing to refresh.
                  </Alert>
                ) : null}

                {status === 'ENDED' ? (
                  <Alert variant="warning" icon={AlertTriangle} title="This exam has closed">
                    The window ended {describeCountdown(msUntilClose(lobby.test, now))}. Ask your
                    teacher if you believe that is wrong.
                  </Alert>
                ) : null}

                {status === 'LIVE' ? (
                  <Alert
                    variant={attemptStarted ? 'warning' : 'info'}
                    icon={attemptStarted ? AlertTriangle : Info}
                    title={attemptStarted ? 'You have an attempt in progress' : 'Before you start'}
                  >
                    {attemptStarted ? (
                      <>
                        Your timer is already running and re-entering will not reset it. Pick up
                        where you left off, or your draft is restored as you go.
                      </>
                    ) : (
                      <>
                        The exam opens in fullscreen and your timer starts the moment you press
                        Start. Read the rules below first.
                      </>
                    )}
                  </Alert>
                ) : null}

                {attemptStarted && !startable && !submitted ? (
                  <Alert variant="warning" icon={AlertTriangle} title="Your time has run out">
                    The allowance from when you started has elapsed, so the exam will open
                    read-only. You can still submit whatever you have.
                  </Alert>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button
                    size="lg"
                    disabled={!startable || starting}
                    onClick={() => void enterExam()}
                  >
                    {/* The label stops claiming "Start" while the latch is in
                        flight, so the button never promises a fresh allowance it
                        has not been charged for yet. */}
                    {starting ? (
                      <>
                        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                        Starting your attempt...
                      </>
                    ) : (
                      (attemptStarted ? 'Resume exam' : 'Start exam')
                    )}
                  </Button>
                  {startable ? null : (
                    <p className="text-sm text-ink-faint">
                      {status === 'UPCOMING'
                        ? 'Available when the window opens.'
                        : status === 'ENDED'
                          ? 'This exam is no longer available.'
                          : 'Not available.'}
                    </p>
                  )}
                </div>
              </div>
            </Card>
          )}

          <Card className="p-6">
            <div className="flex items-center gap-2.5">
              {/* Soft brand well rather than a bare icon, matching EmptyState, so
                  section icons read as one family across the app. */}
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-soft ring-1 ring-inset ring-brand-100">
                <ShieldCheck className="h-4 w-4 text-brand-text" aria-hidden="true" />
              </span>
              <h2 className="text-lg font-semibold text-ink-strong">Exam rules</h2>
            </div>
            <ul className="mt-3 flex flex-col gap-2">
              {RULES.map((rule) => (
                <li key={rule} className="flex gap-2.5 text-sm text-ink">
                  <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
                  {rule}
                </li>
              ))}
            </ul>
            <p className="mt-4 border-t border-line pt-4 text-xs text-ink-faint">
              These checks are deterrents recorded for a human to review. They are not a security
              boundary, and a determined candidate can bypass anything that runs in their own
              browser.
            </p>
          </Card>

          <Card className="p-6">
            <h2 className="text-lg font-semibold text-ink-strong">What you will be asked</h2>
            <dl className="mt-3 flex flex-col gap-3 text-sm">
              <div className="flex justify-between gap-4 border-b border-line pb-2">
                <dt className="text-ink">Language</dt>
                <dd className="font-medium text-ink-strong">{LANGUAGE_LABELS[lobby.test.language]}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-line pb-2">
                <dt className="text-ink">Questions</dt>
                <dd className="font-medium text-ink-strong">
                  {lobby.test.questions.length} ({lobby.test.totalPoints} points)
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink">Open window (IST)</dt>
                <dd className="min-w-0 truncate text-right font-medium text-ink-strong">
                  {formatWindow(lobby.test)}
                </dd>
              </div>
            </dl>

            {lobby.test.instructions ? (
              <div className="mt-4 border-t border-line pt-4">
                <h3 className="text-sm font-semibold text-ink-strong">Instructions</h3>
                <p className="mt-1.5 whitespace-pre-line text-sm text-ink">{lobby.test.instructions}</p>
              </div>
            ) : null}

            <ol className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
              {lobby.test.questions.map((question, index) => (
                <li key={question.id}>
                  <p className="text-sm font-semibold text-ink-strong">
                    {index + 1}. {question.prompt}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    {question.points} points - {question.testCases.length} visible{' '}
                    {question.testCases.length === 1 ? 'test case' : 'test cases'}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      ) : null}
    </div>
  )
}
