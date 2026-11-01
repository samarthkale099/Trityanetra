import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, Check, Clock3, LoaderCircle, Lock } from 'lucide-react'
import { examApi } from '@/features/exam/examApi'
import { flushMonitorQueue, type MonitorContext } from '@/features/exam/monitorApi'
import {
  createServerClock,
  effectiveDeadlineMs,
  formatCountdown,
  serverNow,
  testStatus,
} from '@/features/exam/testWindow'
import { CodeEditor } from '@/features/exam/CodeEditor'
import { FullscreenGuard } from '@/features/exam/FullscreenGuard'
import { ExamOverlay, type ViolationKind } from '@/features/exam/ExamOverlay'
import { SubmitBar } from '@/features/exam/SubmitBar'
import { useTabFocusMonitor } from '@/features/exam/useTabFocusMonitor'
import { useDevToolsDetector } from '@/features/exam/useDevToolsDetector'
import { usePasteBlock } from '@/features/exam/usePasteBlock'
import { useDraftAutosave } from '@/features/exam/useDraftAutosave'
import { useAuth } from '@/app/providers/AuthProvider'
import { useTheme } from '@/app/providers/ThemeProvider'
import { useNow } from '@/shared/hooks/useNow'
import { LogoMark } from '@/shared/components/brand/Logo'
import { Button } from '@/shared/components/ui/button'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { ErrorState } from '@/shared/components/ui/error-state'
import { LANGUAGE_LABELS, type TestDetail } from '@/shared/types/classroom'
import { toast } from '@/shared/components/ui/toast'

/**
 * The proctored exam surface.
 *
 * Layered deliberately, outermost first:
 *   FullscreenGuard   blocks the page until fullscreen, blocks it again on exit
 *   ExamOverlay       blocks again on a tab/window/devtools violation
 *   editor + SubmitBar  the actual exam
 *
 * Every guard is a *deterrent*, not a security control, and the UI says so. The
 * real authority on time and on one-submission-per-attempt is the server, which
 * re-checks the window and de-duplicates on the idempotency key.
 *
 * The page reads the lobby payload rather than the plain test, because the lobby
 * is the only response that carries the server clock and the latched attempt
 * start. Reading `/api/tests/:id` here would leave the countdown running off the
 * device's own clock, which is exactly what a student can change.
 */
export function ExamPage() {
  const { testId } = useParams<{ testId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { theme } = useTheme()
  const localNow = useNow(1000)

  const [code, setCode] = useState('')
  const [activeQuestion, setActiveQuestion] = useState(0)
  const [violation, setViolation] = useState<{ kind: ViolationKind; count: number } | null>(null)
  const [violationCount, setViolationCount] = useState(0)
  const [submitted, setSubmitted] = useState(false)
  const [expired, setExpired] = useState(false)

  const query = useQuery({
    queryKey: ['test', 'lobby', testId],
    enabled: Boolean(testId),
    queryFn: ({ signal }) => examApi.getLobby(testId as string, signal),
  })
  const lobby = query.data ?? null
  const test = lobby?.test ?? null
  const alreadySubmitted = lobby?.submission != null

  /*
   * Offset between the server clock and this device's clock, measured once per
   * payload. `serverNow` applies it to every tick, so a device whose clock is
   * minutes off still counts down in real time.
   */
  const clock = useMemo(
    () => (lobby ? createServerClock(lobby.serverTime, Date.now()) : null),
    [lobby],
  )
  const now = clock ? serverNow(clock, localNow) : localNow

  /**
   * Stable for the whole attempt. Generated once per mount, reused for every
   * submit call, which is what makes a double-click or a retry one submission.
   * `crypto.randomUUID` needs a secure context; the fallback keeps working in
   * plain http on a lab machine.
   */
  const idempotencyKeyRef = useRef(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `attempt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  )

  const context = useMemo<MonitorContext>(
    () => ({ testId: testId ?? '', language: test?.language ?? 'javascript' }),
    [testId, test?.language],
  )

  const questions = test?.questions ?? []
  const currentQuestion: TestDetail['questions'][number] | undefined = questions[activeQuestion]
  const starterCode = currentQuestion?.starterCode ?? ''

  const draft = useDraftAutosave(
    user && testId && currentQuestion ? { testId, userId: user.uid, questionId: currentQuestion.id } : null,
    code,
    starterCode,
  )

  // Seed the editor from a restored draft, or the question's starter code, when
  // the question first becomes available. Keyed on the question so switching
  // questions loads that question's own draft rather than leaking one into
  // another.
  const seededRef = useRef<string | null>(null)
  useEffect(() => {
    if (!currentQuestion) return
    const seedKey = `${testId}:${currentQuestion.id}`
    if (seededRef.current === seedKey) return
    seededRef.current = seedKey
    const restored = draft.restored
    setCode(restored !== null ? restored : currentQuestion.starterCode)
  }, [currentQuestion, draft.restored, testId])

  const raiseViolation = useCallback((kind: ViolationKind) => {
    setViolationCount((count) => {
      const next = count + 1
      setViolation({ kind, count: next })
      return next
    })
  }, [])

  useTabFocusMonitor({
    enabled: Boolean(test) && !submitted,
    onViolation: (violationKind) => raiseViolation(violationKind),
  })

  /*
   * The detectors below only raise the overlay. `ExamOverlay` is the single
   * reporting site, so an event cannot be logged twice by a detector that
   * reports and a dialog that reports on open.
   */
  useDevToolsDetector({
    enabled: Boolean(test) && !submitted,
    onDetected: () => raiseViolation('DEVTOOLS_OPEN'),
  })

  const [pasteNotice, setPasteNotice] = useState<string | null>(null)
  usePasteBlock({
    enabled: Boolean(test) && !submitted,
    message: 'Pasting is disabled during this exam.',
    onBlocked: () => {
      raiseViolation('PASTE_ATTEMPT')
      setPasteNotice('Pasting is disabled during this exam. Type your solution instead.')
    },
  })
  useEffect(() => {
    if (!pasteNotice) return
    const timer = setTimeout(() => setPasteNotice(null), 3000)
    return () => clearTimeout(timer)
  }, [pasteNotice])

  /*
   * The countdown runs from the server-latched attempt start, not from
   * `windowStart`, so a student who opens a test halfway through the window
   * still gets the full allowance. It is additionally capped by `windowEnd`.
   */
  const remainingMs = useMemo(() => {
    if (!test || !lobby) return 0
    const openedAt = lobby.startedAt ? Date.parse(lobby.startedAt) : Date.now()
    if (!Number.isFinite(openedAt)) return 0
    return Math.max(0, effectiveDeadlineMs(test, openedAt) - now)
  }, [test, lobby, now])

  /*
   * Time pressure, in three calm steps rather than a sudden red: ivory with
   * plenty of time, amber inside ten minutes, danger inside five (with a slow
   * pulse). The bar under the header shows the share of the allowance left.
   */
  const allowanceMs = (test?.durationMinutes ?? 0) * 60_000
  const timeLeftShare = allowanceMs > 0 ? Math.min(1, remainingMs / allowanceMs) : 0
  const timeTone = remainingMs < 5 * 60_000 ? 'danger' : remainingMs < 10 * 60_000 ? 'warning' : 'calm'

  // Hard stop. The server rejects a late submission anyway, so this stops the
  // student wasting effort on an answer that cannot be stored.
  useEffect(() => {
    if (submitted || !test) return
    if (testStatus(test, now) === 'ENDED' || remainingMs <= 0) setExpired(true)
  }, [test, now, remainingMs, submitted])

  // Best-effort drain of anything queued while the endpoint was absent.
  useEffect(() => {
    if (!testId) return
    void flushMonitorQueue({ testId, language: test?.language ?? 'javascript' })
  }, [testId, test?.language])

  const onSubmitted = useCallback(
    (submissionId: string) => {
      setSubmitted(true)
      // The draft has served its purpose and must not be restored next time.
      draft.clear()
      void queryClient.invalidateQueries({ queryKey: ['test', 'lobby', testId] })
      void queryClient.invalidateQueries({ queryKey: ['tests'] })
      toast.success('Exam submitted', { description: `Reference ${submissionId}` })
    },
    [draft, queryClient, testId],
  )

  /*
   * A safety net for the one way into the exam that skips the lobby: a student
   * who types the URL. The lobby already latches the attempt before navigating,
   * so this normally sees `startedAt` and does nothing; it exists so the direct
   * route cannot reach an editor whose clock the server never started. Both
   * paths call the same idempotent endpoint, and the server latches once, so
   * there is no separate "if you came from the lobby" branch to get wrong.
   */
  const [startError, setStartError] = useState<Error | null>(null)
  useEffect(() => {
    if (!testId || !lobby || lobby.startedAt !== null) return
    let cancelled = false
    void examApi
      .startAttempt(testId)
      .then((next) => {
        if (cancelled) return
        queryClient.setQueryData(['test', 'lobby', testId], next)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setStartError(error instanceof Error ? error : new Error('Could not start this exam.'))
      })
    return () => {
      cancelled = true
    }
  }, [lobby, testId, queryClient])

  /*
   * Latched the first time the lobby payload carries a started attempt, and never
   * recomputed. "May this student sit the test" is a question about the moment
   * they arrived; if it were re-evaluated every tick, running out of time would
   * tear the editor away instead of leaving it read-only so the work can still
   * be submitted.
   */
  const [enterable, setEnterable] = useState<boolean | null>(null)
  useEffect(() => {
    if (!lobby || enterable !== null) return
    // No attempt yet: the effect above is starting one.
    if (lobby.startedAt === null) return
    setEnterable(!alreadySubmitted && remainingMs > 0)
  }, [lobby, alreadySubmitted, remainingMs, enterable])

  const startingAttempt = lobby !== null && lobby.startedAt === null && startError === null

  if (!testId) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <ErrorState title="No test selected" message="This address is missing a test id." />
      </div>
    )
  }

  return (
    <FullscreenGuard
      enabled={Boolean(test) && enterable === true && !submitted}
      onExit={() => raiseViolation('FULLSCREEN_EXIT')}
    >
      {query.isPending || startingAttempt ? (
        <div className="flex min-h-dvh flex-col gap-4 p-6" aria-busy="true" aria-label="Loading the exam">
          {startingAttempt ? (
            <p className="flex items-center gap-2 text-sm text-ink-faint">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              Starting your attempt...
            </p>
          ) : null}
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="min-h-0 flex-1 w-full" />
        </div>
      ) : null}

      {startError ? (
        <div className="mx-auto w-full max-w-3xl p-6">
          <ErrorState
            title="We couldn't start this exam"
            message={startError.message}
            action={{
              label: 'Back to the lobby',
              onClick: () => navigate(`/app/tests/${encodeURIComponent(testId)}/lobby`, { replace: true }),
            }}
          />
        </div>
      ) : null}

      {query.isError ? (
        <div className="mx-auto w-full max-w-3xl p-6">
          <ErrorState
            title="We couldn't load this exam"
            message={
              query.error instanceof Error
                ? query.error.message
                : 'The test may have been withdrawn.'
            }
            onRetry={() => void query.refetch()}
          />
        </div>
      ) : null}

      {/*
       * Reached by typing or pasting the exam URL directly, skipping the lobby.
       * The lobby read has already latched the attempt, so this is a real gate,
       * not a race: if the test is closed, already submitted, or the allowance
       * has run out, the student is sent back to the lobby rather than shown an
       * editor whose every submit would be rejected.
       */}
      {lobby && enterable === false && !submitted ? (
        <div className="mx-auto w-full max-w-3xl p-6">
          <ErrorState
            title={alreadySubmitted ? 'You have already submitted this test' : 'This exam is not open'}
            message={
              alreadySubmitted
                ? 'Your attempt is closed. Head back to the lobby for the receipt.'
                : 'The test is not open, or your time for it has run out.'
            }
            action={{ label: 'Back to the lobby', onClick: () => navigate(`/app/tests/${encodeURIComponent(testId)}/lobby`, { replace: true }) }}
          />
        </div>
      ) : null}

      {test && enterable ? (
        <div className="flex min-h-dvh flex-col bg-canvas lg:h-dvh lg:overflow-hidden">
          <header className="glass relative z-10 flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-4 py-3 lg:px-6">
            <LogoMark size={30} className="hidden shrink-0 sm:block" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-serif text-xl font-medium text-ink-strong">{test.title}</h1>
              <p className="truncate text-xs text-ink-faint">
                {test.classroomName} · {LANGUAGE_LABELS[test.language]}
              </p>
            </div>

            <div className="flex items-center gap-3">
              {violationCount > 0 ? (
                <Badge variant="danger">
                  <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                  {violationCount} {violationCount === 1 ? 'violation' : 'violations'}
                </Badge>
              ) : null}
              <div
                className={`flex items-center gap-2.5 rounded-lg border px-3 py-1.5 transition-colors duration-700 ${
                  timeTone === 'danger'
                    ? 'animate-violation-pulse border-danger/40 bg-danger-soft'
                    : timeTone === 'warning'
                      ? 'border-warning/40 bg-warning-soft'
                      : 'border-line bg-surface'
                }`}
                // Polite rather than assertive: a per-second assertive timer would
                // interrupt whatever a screen-reader user is doing every second.
                aria-live="polite"
                aria-atomic="true"
              >
                <Clock3
                  className={`h-4 w-4 ${
                    timeTone === 'danger' ? 'text-danger' : timeTone === 'warning' ? 'text-warning' : 'text-brand-text'
                  }`}
                  aria-hidden="true"
                />
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">Time left</p>
                  <p
                    className={`font-serif text-xl font-medium tabular-nums leading-tight ${
                      timeTone === 'danger' ? 'text-danger' : timeTone === 'warning' ? 'text-warning' : 'text-ink-strong'
                    }`}
                  >
                    {formatCountdown(remainingMs)}
                  </p>
                </div>
              </div>
            </div>
            {/* Allowance remaining: a hairline that drains left as time passes. */}
            <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[2px] bg-line/60">
              <div
                className={`h-full transition-[width,background-color] duration-1000 ease-linear ${
                  timeTone === 'danger' ? 'bg-danger' : timeTone === 'warning' ? 'bg-warning' : 'bg-glow-gradient'
                }`}
                style={{ width: `${(timeLeftShare * 100).toFixed(2)}%` }}
              />
            </div>
          </header>

          {pasteNotice ? (
            <p role="alert" className="border-b border-line bg-warning-soft px-4 py-2 text-sm text-warning lg:px-6">
              {pasteNotice}
            </p>
          ) : null}

          {expired && !submitted ? (
            <p role="alert" className="border-b border-line bg-danger-soft px-4 py-2 text-sm text-danger lg:px-6">
              Time is up. Your editor is read-only; submit what you have.
            </p>
          ) : null}

          {draft.savedAt ? (
            <p className="flex items-center gap-1.5 border-b border-line bg-surface px-4 py-1.5 text-xs text-ink-faint lg:px-6">
              <Check className="h-3 w-3" aria-hidden="true" />
              Draft saved locally
            </p>
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <aside className="shrink-0 border-b border-line bg-surface lg:w-72 lg:overflow-y-auto lg:border-b-0 lg:border-r">
              <div className="p-4">
                <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">Questions</h2>
                <ol className="mt-3 flex flex-col gap-1.5">
                  {questions.map((question, index) => (
                    <li key={question.id}>
                      <button
                        type="button"
                        aria-current={index === activeQuestion ? 'true' : undefined}
                        onClick={() => setActiveQuestion(index)}
                        className={`group flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm transition-all duration-250 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text ${
                          index === activeQuestion
                            ? 'bg-brand-soft font-medium text-ink-strong shadow-[inset_0_0_0_1px_rgb(var(--glow)/0.18)]'
                            : 'text-ink hover:translate-x-0.5 hover:bg-canvas-sunken'
                        }`}
                      >
                        {/* Numbered medallion; the active one takes the gold ring. */}
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-serif text-xs tabular-nums transition-colors duration-250 ${
                            index === activeQuestion
                              ? 'border-brand-400 bg-brand-400/10 text-brand-text'
                              : 'border-line-strong text-ink-faint group-hover:border-brand-400/50'
                          }`}
                          aria-hidden="true"
                        >
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          <span className="sr-only">{index + 1}. </span>
                          {question.prompt.split('\n')[0]}
                        </span>
                        <span className="shrink-0 text-xs text-ink-faint">{question.points}pt</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            </aside>

            <main className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="border-b border-line bg-surface px-4 py-4 lg:max-h-[38%] lg:shrink-0 lg:overflow-y-auto lg:px-6">
                {/* Orientation crumb, so a student who has jumped between questions always
                    knows which one they are looking at. Brand-tinted rather than
                    faint grey, because this is working state, not metadata. */}
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-text">
                  Question {activeQuestion + 1} of {questions.length}
                </p>
                {/* `text-base`: the prompt is the primary reading material of the
                    whole exam, so it should not be set smaller than body copy. */}
                <p className="mt-1.5 whitespace-pre-line text-base leading-relaxed text-ink-strong">
                  {currentQuestion?.prompt}
                </p>
                {currentQuestion ? (
                  <p className="mt-2 text-xs text-ink-faint">
                    {currentQuestion.points} points - {currentQuestion.testCases.length} visible{' '}
                    {currentQuestion.testCases.length === 1 ? 'test case' : 'test cases'}
                  </p>
                ) : null}
                {currentQuestion && currentQuestion.testCases.length > 0 ? (
                  <ul className="mt-3 flex flex-col gap-1.5">
                    {currentQuestion.testCases.map((testCase) => (
                      /* `break-words`: test-case inputs are arbitrary-length
                         JSON, and a long one would otherwise push the editor
                         sideways at 360px. */
                      <li
                        key={testCase.id}
                        className="break-words rounded-md border border-line bg-canvas-sunken/60 px-3 py-2 font-mono text-xs text-ink"
                      >
                        <span className="text-ink-faint">in</span> {testCase.input}
                        <span className="mx-1.5 text-brand-text" aria-hidden="true">→</span>
                        <span className="sr-only"> expected </span>
                        <span className="text-ink-faint">out</span> {testCase.expected}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className="min-h-[16rem] flex-1 lg:min-h-0">
                <CodeEditor
                  value={code}
                  onChange={setCode}
                  language={test.language}
                  theme={theme}
                  readOnly={expired || submitted}
                  height="100%"
                  className="h-full"
                  onError={() => {
                    // The editor fell back to a textarea; nothing else to do,
                    // and the student has already been told on screen.
                  }}
                />
              </div>

              {/*
                The action bar: Previous / Next on the left, Submit on the right.
                Pinned to the bottom of the screen on phones; on desktop the
                layout above guarantees it is always in view.
              */}
              <div className="glass sticky bottom-0 z-10 flex shrink-0 flex-wrap items-center justify-between gap-4 border-t border-line px-4 py-3 lg:static lg:px-6">
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={activeQuestion === 0}
                    onClick={() => setActiveQuestion((index) => Math.max(0, index - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={activeQuestion >= questions.length - 1}
                    onClick={() => setActiveQuestion((index) => Math.min(questions.length - 1, index + 1))}
                  >
                    Next
                  </Button>
                </div>
                <SubmitBar
                  testId={testId}
                  context={context}
                  code={code}
                  idempotencyKey={idempotencyKeyRef.current}
                  locked={submitted}
                  onSubmitted={onSubmitted}
                  onDone={() => navigate(`/app/tests/${encodeURIComponent(testId)}/lobby`, { replace: true })}
                />
              </div>
            </main>
          </div>

          {submitted ? (
            <div className="flex shrink-0 items-center justify-center gap-2 border-t border-line bg-success-soft px-4 py-2 text-sm text-success">
              <Lock className="h-4 w-4" aria-hidden="true" />
              Submitted. Your attempt is closed.
            </div>
          ) : null}

          <ExamOverlay
            open={violation !== null}
            kind={violation?.kind ?? 'TAB_HIDDEN'}
            count={violation?.count ?? 1}
            context={context}
            onAcknowledge={() => setViolation(null)}
          />
        </div>
      ) : null}
    </FullscreenGuard>
  )
}
