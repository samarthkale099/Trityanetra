import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Clock3,
  GraduationCap,
  Radio,
  RefreshCw,
  UserCheck,
  type LucideIcon,
} from 'lucide-react'
import { classroomApi } from '@/features/classrooms/classroomApi'
import { examApi } from '@/features/exam/examApi'
import {
  describeCountdown,
  formatWindow,
  msUntilClose,
  msUntilOpen,
  testStatus,
} from '@/features/exam/testWindow'
import { useAuth } from '@/app/providers/AuthProvider'
import { useNow } from '@/shared/hooks/useNow'
import { PageHeader } from '@/shared/components/page-header'
import { Button } from '@/shared/components/ui/button'
import { Badge } from '@/shared/components/ui/badge'
import { Card } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { ErrorState } from '@/shared/components/ui/error-state'
import { LANGUAGE_LABELS, type TestStatus, type TestSummary } from '@/shared/types/classroom'

const STATUS_META: Record<TestStatus, { label: string; variant: 'info' | 'success' | 'neutral' }> = {
  UPCOMING: { label: 'Upcoming', variant: 'info' },
  LIVE: { label: 'Live now', variant: 'success' },
  ENDED: { label: 'Closed', variant: 'neutral' },
}

/**
 * One test row.
 *
 * `now` is threaded in from a single ticking clock in the parent so every row on
 * the page shares one timer instead of starting its own.
 */
function TestRow({ test, now }: { test: TestSummary; now: number }) {
  const status = testStatus(test, now)
  const countdown =
    status === 'UPCOMING' ? msUntilOpen(test, now) : status === 'LIVE' ? msUntilClose(test, now) : 0

  // A finished test this student actually sat offers its result. The flag is the
  // server's, derived from the token, so it cannot claim a submission that is
  // not there.
  const hasResult = status === 'ENDED' && test.mySubmissionId !== null
  const lobbyHref = `/app/tests/${encodeURIComponent(test.id)}/lobby`

  return (
    <li>
      <Card interactive className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-ink-strong">{test.title}</h3>
            <Badge variant={STATUS_META[status].variant} dot>
              {STATUS_META[status].label}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-ink">
            {LANGUAGE_LABELS[test.language]} - {test.questionCount}{' '}
            {test.questionCount === 1 ? 'question' : 'questions'} - {test.durationMinutes} min
          </p>
          <p className="mt-1 text-xs text-ink-faint">{formatWindow(test)}</p>
        </div>

        <div className="flex flex-col items-end gap-2">
          {status === 'UPCOMING' ? (
            <span className="font-display text-sm tabular-nums text-ink">
              Opens {describeCountdown(countdown)}
            </span>
          ) : null}
          {status === 'LIVE' ? (
            <span className="font-display text-sm tabular-nums text-danger">
              Closes {describeCountdown(countdown)}
            </span>
          ) : null}
          {/*
            The row goes to the lobby, never straight to the exam. The lobby is
            where the server-time window check lives, so this shortcut cannot be a
            way around it. A router `Link` (not an `a`) keeps the transition
            client-side. A finished test the student sat offers its result first.
          */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {hasResult ? (
              <Button asChild size="sm" variant="primary">
                <Link to={`/app/tests/${encodeURIComponent(test.id)}/result`}>
                  View result
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
            ) : null}
            {hasResult ? (
              <Button asChild size="sm" variant="secondary">
                <Link to={lobbyHref}>Review</Link>
              </Button>
            ) : (
              <Button asChild size="sm" variant={status === 'LIVE' ? 'primary' : 'secondary'}>
                <Link to={lobbyHref}>
                  {status === 'ENDED' ? 'Review' : status === 'LIVE' ? 'Start exam' : 'Open lobby'}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
            )}
          </div>
        </div>
      </Card>
    </li>
  )
}

/**
 * Enrolment is teacher-only: a student never types a code. This card says so,
 * in place of the old join box, so a student with an empty list knows whom to
 * ask rather than hunting for a missing control.
 */
function EnrolmentNoteCard({ email }: { email: string | null }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-soft ring-1 ring-inset ring-brand-300/40">
          <UserCheck className="h-4 w-4 text-brand-text" aria-hidden="true" />
        </span>
        <h3 className="text-lg font-semibold text-ink-strong">How you join a class</h3>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-ink">
        Your teacher adds you to their classroom using your email. Once they do, it appears here
        on its own, with every test they publish.
      </p>
      {email ? (
        <p className="mt-3 text-sm text-ink">
          Give your teacher this email:{' '}
          <span className="rounded-sm bg-canvas-sunken px-1.5 py-0.5 font-mono text-xs text-ink-strong">
            {email}
          </span>
        </p>
      ) : null}
    </Card>
  )
}

/**
 * One figure in the dashboard's stat strip. The number is the hero; the label
 * and icon only say what it counts. `accent` puts the single gold mark on the
 * tile that matters most right now (live tests), and nowhere else.
 */
function StatTile({
  icon: Icon,
  label,
  value,
  accent = false,
}: {
  icon: LucideIcon
  label: string
  value: number
  accent?: boolean
}) {
  return (
    <div className="surface-sheen group relative overflow-hidden rounded-lg border border-line px-4 py-4 shadow-card transition-all duration-500 ease-out hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-[0.12em] text-ink-faint">{label}</span>
        <Icon
          className={`h-4 w-4 transition-transform duration-500 ease-spring group-hover:scale-110 ${accent ? 'text-brand-text' : 'text-ink-faint'}`}
          aria-hidden="true"
        />
      </div>
      <p className="mt-3 font-serif text-4xl font-medium tabular-nums leading-none text-ink-strong">{value}</p>
      {accent ? (
        <span aria-hidden="true" className="absolute inset-x-4 bottom-0 h-px bg-glow-gradient opacity-70" />
      ) : null}
    </div>
  )
}

/** Splits a duration into the units a countdown shows. */
function clockParts(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  }
}

/**
 * The "next up" spotlight: the one test the student should think about now.
 * A live test wins over an upcoming one. It repeats the test's details on
 * purpose -- the list below is for browsing, this is for acting -- but its
 * title is a paragraph, not a heading, so the page keeps one heading per test.
 *
 * It is always a noir panel (in both schemes), the page's single dark-on-light
 * or deeper-on-dark moment, so the eye goes there first.
 */
function NextUpSpotlight({ test, now }: { test: TestSummary; now: number }) {
  const status = testStatus(test, now)
  const live = status === 'LIVE'
  const remaining = live ? msUntilClose(test, now) : msUntilOpen(test, now)
  const parts = clockParts(remaining)
  const start = Date.parse(test.windowStart)
  const end = Date.parse(test.windowEnd)
  const elapsed = live && end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : 0
  const units: [string, number][] =
    parts.days > 0
      ? [
          ['days', parts.days],
          ['hrs', parts.hours],
          ['min', parts.minutes],
        ]
      : [
          ['hrs', parts.hours],
          ['min', parts.minutes],
          ['sec', parts.seconds],
        ]

  return (
    <section
      aria-label="Next up"
      className="panel-ink glow-border relative overflow-hidden rounded-xl border border-line p-6 shadow-lift sm:p-8"
    >
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#e3c67f]">
            {live ? (
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#e3c67f] opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#e3c67f]" />
              </span>
            ) : null}
            {live ? 'In progress' : 'Next up'}
          </p>
          <p className="mt-3 font-serif text-3xl font-medium leading-tight tracking-tight sm:text-4xl">{test.title}</p>
          <p className="mt-2 text-sm text-[#f6f2e8]/65">
            {LANGUAGE_LABELS[test.language]} · {test.questionCount}{' '}
            {test.questionCount === 1 ? 'question' : 'questions'} · {test.durationMinutes} min
          </p>
        </div>

        <div className="flex flex-col gap-4 lg:items-end">
          <div
            className="flex items-end gap-2.5"
            role="timer"
            aria-label={`${live ? 'Closes' : 'Opens'} ${describeCountdown(remaining)}`}
          >
            {units.map(([unit, value]) => (
              <div key={unit} className="text-center">
                <span className="block min-w-[2.7ch] rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 font-serif text-3xl tabular-nums leading-none">
                  {String(value).padStart(2, '0')}
                </span>
                <span className="mt-1.5 block text-[10px] uppercase tracking-[0.14em] text-[#f6f2e8]/50">{unit}</span>
              </div>
            ))}
          </div>
          <Link
            to={`/app/tests/${encodeURIComponent(test.id)}/lobby`}
            className="sheen-sweep relative inline-flex h-10 items-center gap-2 rounded-md bg-[linear-gradient(160deg,#f0dda6_0%,#d4af5a_42%,#b08a3a_100%)] px-4 text-sm font-medium text-[#14110a] shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] transition-all duration-250 ease-out hover:-translate-y-px hover:shadow-[0_10px_30px_-10px_rgb(212_175_90/0.6)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e3c67f] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0908]"
          >
            {live ? 'Enter the lobby' : 'Preview the lobby'}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>

      {live ? (
        <div className="relative mt-6">
          <div className="h-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,#b08a3a,#f0dda6)] transition-[width] duration-1000 ease-linear"
              style={{ width: `${(elapsed * 100).toFixed(2)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-[#f6f2e8]/50">Window {Math.round(elapsed * 100)}% elapsed</p>
        </div>
      ) : null}
    </section>
  )
}

/* Status group headings. Sentence case rather than an uppercase eyebrow: these
   sit directly above lists of tests and the caps were shouting over the content
   they label. The semantic colour still carries the grouping. */
const GROUP_HEADING = 'mb-2 text-sm font-semibold'

export function StudentDashboardPage() {
  const { user } = useAuth()
  const now = useNow(1000)

  const classroomsQuery = useQuery({
    queryKey: ['student', 'classrooms'],
    queryFn: ({ signal }) => classroomApi.listJoined(signal),
  })
  const testsQuery = useQuery({
    queryKey: ['student', 'tests'],
    queryFn: ({ signal }) => examApi.listForStudent(signal),
  })

  const isPending = classroomsQuery.isPending || testsQuery.isPending
  const isError = classroomsQuery.isError || testsQuery.isError
  const error = classroomsQuery.error ?? testsQuery.error

  // Own memo so the identity is stable across renders that only change `now`.
  // Without it, `?? []` yields a fresh array each render and `grouped` below
  // would be rebuilt on every one-second tick.
  const tests = useMemo(() => testsQuery.data ?? [], [testsQuery.data])

  const grouped = useMemo(() => {
    const live: TestSummary[] = []
    const upcoming: TestSummary[] = []
    const finished: TestSummary[] = []
    for (const test of tests) {
      const status = testStatus(test, now)
      if (status === 'LIVE') live.push(test)
      else if (status === 'UPCOMING') upcoming.push(test)
      else finished.push(test)
    }
    // Soonest first, so the next thing to do is at the top of its group.
    upcoming.sort((a, b) => Date.parse(a.windowStart) - Date.parse(b.windowStart))
    live.sort((a, b) => Date.parse(a.windowEnd) - Date.parse(b.windowEnd))
    finished.sort((a, b) => Date.parse(b.windowEnd) - Date.parse(a.windowEnd))
    return { live, upcoming, finished }
  }, [tests, now])

  const firstName = user?.displayName?.split(/\s+/)[0] ?? 'there'
  const nextUp = grouped.live[0] ?? grouped.upcoming[0] ?? null
  const classrooms = classroomsQuery.data ?? []
  const today = new Date(now).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader
        title={`Hello, ${firstName}`}
        description={`${today} · Your classrooms, and every test you are allowed to sit.`}
        actions={
          <Button
            variant="secondary"
            onClick={() => {
              void classroomsQuery.refetch()
              void testsQuery.refetch()
            }}
            disabled={classroomsQuery.isFetching || testsQuery.isFetching}
          >
            <RefreshCw
              className={`h-4 w-4 ${classroomsQuery.isFetching || testsQuery.isFetching ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            Refresh
          </Button>
        }
      />

      {isPending ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading your tests">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : null}

      {isError ? (
        <ErrorState
          title="We couldn't load your classroom"
          message={error instanceof Error ? error.message : 'Check your connection and try again.'}
          onRetry={() => {
            void classroomsQuery.refetch()
            void testsQuery.refetch()
          }}
        />
      ) : null}

      {!isPending && !isError ? (
        <div className="flex flex-col gap-10">
          <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile icon={Radio} label="Live" value={grouped.live.length} accent={grouped.live.length > 0} />
            <StatTile icon={Clock3} label="Upcoming" value={grouped.upcoming.length} />
            <StatTile icon={CheckCircle2} label="Finished" value={grouped.finished.length} />
            <StatTile icon={BookOpen} label="Classrooms" value={classrooms.length} />
          </div>

          {nextUp ? <NextUpSpotlight test={nextUp} now={now} /> : null}

          <section aria-labelledby="student-classrooms">
            <h2 id="student-classrooms" className="mb-4 font-serif text-2xl font-medium text-ink-strong">
              Your classrooms
            </h2>
            <div className="stagger grid gap-4 md:grid-cols-2">
              <EnrolmentNoteCard email={user?.email ?? null} />
              <Card className="p-5">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-soft ring-1 ring-inset ring-brand-300/40">
                    <GraduationCap className="h-4 w-4 text-brand-text" aria-hidden="true" />
                  </span>
                  <h3 className="text-lg font-semibold text-ink-strong">Enrolled</h3>
                </div>
                {classrooms.length === 0 ? (
                  <p className="mt-3 text-sm text-ink">
                    You are not in a classroom yet. Your teacher will add you.
                  </p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-2">
                    {classrooms.map((classroom) => (
                      <li
                        key={classroom.id}
                        className="flex items-center justify-between gap-3 border-b border-line pb-2 last:border-0 last:pb-0"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink-strong">{classroom.name}</p>
                          <p className="truncate text-sm text-ink">
                            {classroom.subject} - {classroom.teacherName}
                          </p>
                        </div>
                        <Badge variant="outline">{classroom.testCount} tests</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </section>

          <section aria-labelledby="student-tests">
            <h2 id="student-tests" className="mb-4 font-serif text-2xl font-medium text-ink-strong">
              Your tests
            </h2>
            {tests.length === 0 ? (
              <Card>
                <EmptyState
                  icon={CalendarClock}
                  title="No tests available"
                  description="Once your teacher adds you to a classroom, its tests appear here as soon as they are published."
                />
              </Card>
            ) : (
              <div className="flex flex-col gap-6">
                {grouped.live.length > 0 ? (
                  <div>
                    <h3 className={`${GROUP_HEADING} text-brand-text`}>
                      Live now
                    </h3>
                    <ul className="stagger flex flex-col gap-2">
                      {grouped.live.map((test) => (
                        <TestRow key={test.id} test={test} now={now} />
                      ))}
                    </ul>
                  </div>
                ) : null}

                {grouped.upcoming.length > 0 ? (
                  <div>
                    <h3 className={`${GROUP_HEADING} text-ink-faint`}>
                      Upcoming
                    </h3>
                    <ul className="stagger flex flex-col gap-2">
                      {grouped.upcoming.map((test) => (
                        <TestRow key={test.id} test={test} now={now} />
                      ))}
                    </ul>
                  </div>
                ) : null}

                {grouped.finished.length > 0 ? (
                  <div>
                    <h3 className={`${GROUP_HEADING} text-ink-faint`}>
                      Finished
                    </h3>
                    <ul className="stagger flex flex-col gap-2">
                      {grouped.finished.map((test) => (
                        <TestRow key={test.id} test={test} now={now} />
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  )
}
