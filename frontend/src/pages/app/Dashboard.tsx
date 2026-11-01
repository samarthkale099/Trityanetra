import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowUpRight,
  BookOpen,
  CalendarClock,
  ClipboardCheck,
  FilePlus2,
  Plus,
  Radio,
  RefreshCw,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'
import { authApi } from '@/features/auth/authApi'
import { classroomApi } from '@/features/classrooms/classroomApi'
import { examApi } from '@/features/exam/examApi'
import { describeCountdown, msUntilClose, msUntilOpen, testStatus } from '@/features/exam/testWindow'
import { useNow } from '@/shared/hooks/useNow'
import { isTeacherRole, roleLabel } from '@/shared/lib/roles'
import { PageHeader } from '@/shared/components/page-header'
import { TestStatusBadge } from '@/pages/teacher/TestStatusBadge'
import { LANGUAGE_LABELS, type Classroom, type TestSummary } from '@/shared/types/classroom'
import { Badge } from '@/shared/components/ui/badge'
import { Card, CardBody, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { ErrorState } from '@/shared/components/ui/error-state'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Button } from '@/shared/components/ui/button'

/* ===================================================================== */
/*  Teacher dashboard                                                     */
/* ===================================================================== */

/** One figure in the teacher's stat strip; `accent` is the single gold mark. */
function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  accent = false,
}: {
  icon: LucideIcon
  label: string
  value: number
  hint?: string
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
      {hint ? <p className="mt-2 text-xs text-ink-faint">{hint}</p> : null}
      {accent ? <span aria-hidden="true" className="absolute inset-x-4 bottom-0 h-px bg-glow-gradient opacity-70" /> : null}
    </div>
  )
}

const testPath = (test: TestSummary) =>
  `/app/classrooms/${encodeURIComponent(test.classroomId)}/tests/${encodeURIComponent(test.id)}`

/** A live or upcoming test, with its countdown and the next action a teacher takes on it. */
function ScheduleRow({ test, classroom, now }: { test: TestSummary; classroom?: Classroom; now: number }) {
  const status = testStatus(test, now)
  const live = status === 'LIVE'
  return (
    <li>
      <Card interactive className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-ink-strong">{test.title}</h3>
            <TestStatusBadge window={test} />
          </div>
          <p className="mt-1 text-sm text-ink">
            {classroom?.name ?? 'Classroom'} · {LANGUAGE_LABELS[test.language]} · {test.durationMinutes} min
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={`font-serif text-base tabular-nums ${live ? 'text-brand-text' : 'text-ink'}`}>
            {live
              ? `Closes ${describeCountdown(msUntilClose(test, now))}`
              : `Opens ${describeCountdown(msUntilOpen(test, now))}`}
          </span>
          <div className="flex items-center gap-2">
            {live ? (
              <span className="text-xs text-ink-faint">
                {test.submittedCount}/{classroom?.studentCount ?? 0} submitted
              </span>
            ) : null}
            <Button asChild size="sm" variant={live ? 'primary' : 'secondary'}>
              <Link to={live ? `${testPath(test)}/submissions` : testPath(test)}>
                {live ? 'Watch submissions' : 'Preview'}
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </Card>
    </li>
  )
}

/**
 * The teacher's home: what is happening now across every classroom, what is
 * coming up, and what is waiting to be graded -- each with its next action one
 * click away. Built from the two lists the teacher already has access to
 * (their classrooms, and the tests in them), so it needs no extra endpoint.
 */
function TeacherDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const now = useNow(1000)

  const classroomsQuery = useQuery({
    queryKey: ['classrooms', 'mine'],
    queryFn: ({ signal }) => classroomApi.listMine(signal),
  })
  const testsQuery = useQuery({
    queryKey: ['teacher', 'tests'],
    queryFn: ({ signal }) => examApi.listForStudent(signal),
  })

  const classrooms = useMemo(() => classroomsQuery.data ?? [], [classroomsQuery.data])
  const tests = useMemo(() => testsQuery.data ?? [], [testsQuery.data])
  const byId = useMemo(() => new Map(classrooms.map((room) => [room.id, room])), [classrooms])

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
    live.sort((a, b) => Date.parse(a.windowEnd) - Date.parse(b.windowEnd))
    upcoming.sort((a, b) => Date.parse(a.windowStart) - Date.parse(b.windowStart))
    finished.sort((a, b) => Date.parse(b.windowEnd) - Date.parse(a.windowEnd))
    return { live, upcoming, finished }
  }, [tests, now])

  const toGrade = grouped.finished.filter((test) => test.submittedCount > 0).slice(0, 5)
  const totals = {
    students: classrooms.reduce((sum, room) => sum + room.studentCount, 0),
    submissions: tests.reduce((sum, test) => sum + test.submittedCount, 0),
  }

  const firstName = user?.displayName?.split(/\s+/)[0] ?? 'there'
  const hour = new Date(now).getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const today = new Date(now).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  // With exactly one classroom, "Create test" can go straight to its form.
  const createTestHref =
    classrooms.length === 1
      ? `/app/classrooms/${encodeURIComponent(classrooms[0].id)}/tests/new`
      : '/app/classrooms'

  const isPending = classroomsQuery.isPending || testsQuery.isPending
  const isError = classroomsQuery.isError || testsQuery.isError
  const error = classroomsQuery.error ?? testsQuery.error
  const refetch = () => {
    void classroomsQuery.refetch()
    void testsQuery.refetch()
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title={`${greeting}, ${firstName}`}
        description={`${today} · Everything happening across your classrooms.`}
        actions={
          <>
            <Button asChild variant="secondary">
              <Link to="/app/classrooms">
                <Plus className="h-4 w-4" aria-hidden="true" />
                New classroom
              </Link>
            </Button>
            <Button asChild>
              <Link to={createTestHref}>
                <FilePlus2 className="h-4 w-4" aria-hidden="true" />
                Create test
              </Link>
            </Button>
          </>
        }
      />

      {isPending ? (
        <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading your dashboard">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-28 w-full" />
            ))}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      ) : null}

      {isError ? (
        <ErrorState
          title="We couldn't load your dashboard"
          message={error instanceof Error ? error.message : 'Check your connection and try again.'}
          onRetry={refetch}
        />
      ) : null}

      {!isPending && !isError ? (
        <div className="flex flex-col gap-10">
          <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile icon={BookOpen} label="Classrooms" value={classrooms.length} />
            <StatTile icon={Users} label="Students" value={totals.students} hint="across all rosters" />
            <StatTile
              icon={Radio}
              label="Live now"
              value={grouped.live.length}
              hint={`${grouped.upcoming.length} upcoming`}
              accent={grouped.live.length > 0}
            />
            <StatTile icon={ClipboardCheck} label="Submissions" value={totals.submissions} hint="all tests" />
          </div>

          {classrooms.length === 0 ? (
            <Card>
              <EmptyState
                icon={BookOpen}
                title="Create your first classroom"
                description="A classroom holds your students and their tests. Create one, add your students by email, then set a test."
                action={{ label: 'Go to classrooms', onClick: () => navigate('/app/classrooms') }}
              />
            </Card>
          ) : (
            <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
              <section aria-labelledby="teacher-schedule" className="min-w-0">
                <h2 id="teacher-schedule" className="mb-4 font-serif text-2xl font-medium text-ink-strong">
                  Live and upcoming
                </h2>
                {grouped.live.length + grouped.upcoming.length === 0 ? (
                  <Card>
                    <EmptyState
                      icon={CalendarClock}
                      title="Nothing scheduled"
                      description="Tests you schedule appear here with a countdown, and live ones show submissions as they arrive."
                      action={{ label: 'Create a test', onClick: () => navigate(createTestHref) }}
                    />
                  </Card>
                ) : (
                  <ul className="stagger flex flex-col gap-2">
                    {[...grouped.live, ...grouped.upcoming].slice(0, 8).map((test) => (
                      <ScheduleRow key={test.id} test={test} classroom={byId.get(test.classroomId)} now={now} />
                    ))}
                  </ul>
                )}
              </section>

              <div className="flex min-w-0 flex-col gap-8">
                <section aria-labelledby="teacher-to-grade">
                  <h2 id="teacher-to-grade" className="mb-4 font-serif text-2xl font-medium text-ink-strong">
                    Ready to grade
                  </h2>
                  {toGrade.length === 0 ? (
                    <Card className="px-5 py-6 text-sm text-ink-faint">
                      Finished tests with submissions will be listed here.
                    </Card>
                  ) : (
                    <Card className="divide-y divide-line overflow-hidden">
                      {toGrade.map((test) => (
                        <Link
                          key={test.id}
                          to={`${testPath(test)}/submissions`}
                          className="group flex items-center justify-between gap-3 px-5 py-3.5 transition-colors duration-250 hover:bg-canvas-sunken/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-text"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-ink-strong">{test.title}</span>
                            <span className="block truncate text-xs text-ink-faint">
                              {byId.get(test.classroomId)?.name ?? 'Classroom'} · {test.submittedCount}{' '}
                              {test.submittedCount === 1 ? 'submission' : 'submissions'}
                            </span>
                          </span>
                          <ArrowUpRight
                            className="h-4 w-4 shrink-0 text-ink-faint transition-transform duration-250 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-text"
                            aria-hidden="true"
                          />
                        </Link>
                      ))}
                    </Card>
                  )}
                </section>

                <section aria-labelledby="teacher-classrooms">
                  <div className="mb-4 flex items-end justify-between gap-3">
                    <h2 id="teacher-classrooms" className="font-serif text-2xl font-medium text-ink-strong">
                      Your classrooms
                    </h2>
                    <Link
                      to="/app/classrooms"
                      className="rounded-sm text-sm text-brand-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text"
                    >
                      View all
                    </Link>
                  </div>
                  <ul className="stagger flex flex-col gap-2">
                    {classrooms.slice(0, 5).map((room) => (
                      <li key={room.id}>
                        <Link
                          to={`/app/classrooms/${encodeURIComponent(room.id)}`}
                          className="surface-sheen group flex items-center gap-3 rounded-lg border border-line px-4 py-3 shadow-card transition-all duration-400 ease-out hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text"
                        >
                          <span
                            aria-hidden="true"
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#d4af5a]/30 bg-[linear-gradient(160deg,#2e2a23,#0c0b09)] font-serif text-sm font-medium tracking-wide text-[#e3c67f]"
                          >
                            {(room.subject || room.name).replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '··'}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-ink-strong">{room.name}</span>
                            <span className="block truncate text-xs text-ink-faint">
                              {room.studentCount} {room.studentCount === 1 ? 'student' : 'students'} · {room.testCount}{' '}
                              {room.testCount === 1 ? 'test' : 'tests'}
                            </span>
                          </span>
                          <ArrowUpRight
                            className="h-4 w-4 shrink-0 text-ink-faint transition-transform duration-250 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-text"
                            aria-hidden="true"
                          />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

/** `/app/dashboard`: the teacher's dashboard, or a student's account page. */
export function DashboardPage() {
  const { role } = useAuth()
  return isTeacherRole(role) ? <TeacherDashboard /> : <AccountOverview />
}

/* ===================================================================== */
/*  Account overview (students)                                           */
/* ===================================================================== */

function AccountOverview() {
  const { token, role, collegeId } = useAuth()

  const {
    data: profile,
    isPending,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['auth', 'me', token],
    // Enabled only with a token: without one the server would 401 and the
    // error state would flash before the route guard redirects.
    enabled: Boolean(token),
    queryFn: ({ signal }) => authApi.fetchProfileWithSignal(token as string, signal),
  })

  const displayProfile = profile ?? null
  const firstName = displayProfile?.displayName?.split(/\s+/)[0] ?? 'there'

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl font-medium tracking-[-0.02em] text-ink-strong">Good to see you, {firstName}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink">
            This is your home in Trityanetra. Your classes and upcoming tests will live here.
          </p>
        </div>
        <Badge variant="brand">{roleLabel(role)}</Badge>
      </div>

      {isPending ? (
        <div className="grid gap-6 md:grid-cols-2" aria-busy="true" aria-label="Loading your overview">
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
      ) : null}

      {isError ? (
        <ErrorState
          title="We couldn't load your overview"
          message="Your profile failed to refresh from the server. Check your connection and try again."
          onRetry={() => void refetch()}
          retryLabel="Retry"
        />
      ) : null}

      {displayProfile ? (
        <div className="stagger grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-brand-text" aria-hidden="true" />
                Your classrooms
              </CardTitle>
            </CardHeader>
            <CardBody>
              <EmptyState
                icon={BookOpen}
                title="No classrooms yet"
                description="When a teacher adds you to a classroom, its tests appear under My tests."

              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Your account</CardTitle>
            </CardHeader>
            <CardBody className="flex flex-col gap-3">
              <dl className="divide-y divide-line text-sm">
                {/* A definition row is a label/value pair, so the left column is
                    allowed to shrink while the value truncates. Without
                    `min-w-0` on the value cell a long email forces the row to
                    overflow the card on a narrow screen. */}
                <div className="flex justify-between gap-4 py-2.5">
                  <dt className="text-ink">Name</dt>
                  <dd className="min-w-0 truncate text-right font-medium text-ink-strong">
                    {displayProfile.displayName}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 py-2.5">
                  <dt className="text-ink">Email</dt>
                  <dd className="min-w-0 truncate text-right font-medium text-ink-strong">
                    {displayProfile.email}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 py-2.5">
                  <dt className="text-ink">Role</dt>
                  <dd className="font-medium text-ink-strong">{roleLabel(displayProfile.role)}</dd>
                </div>
                <div className="flex justify-between gap-4 py-2.5">
                  <dt className="text-ink">College</dt>
                  <dd className="min-w-0 truncate text-right font-medium text-ink-strong">
                    {displayProfile.collegeId ?? collegeId ?? 'Not assigned yet'}
                  </dd>
                </div>
              </dl>
              <Button
                type="button"
                variant="link"
                onClick={() => void refetch()}
                disabled={isFetching}
                className="w-fit"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
                {isFetching ? 'Refreshing…' : 'Refresh profile'}
              </Button>
            </CardBody>
          </Card>
        </div>
      ) : null}
    </div>
  )
}
