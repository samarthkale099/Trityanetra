import { useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { zodResolver } from '@hookform/resolvers/zod'
import { CalendarClock, FilePlus2, LoaderCircle, Search, UserMinus, UserPlus, Users } from 'lucide-react'
import { classroomApi } from '@/features/classrooms/classroomApi'
import {
  addStudentsSchema,
  parseEmailList,
  type AddStudentsValues,
} from '@/features/classrooms/schemas'
import { formatWindow, testStatus } from '@/features/exam/testWindow'
import { formatISTDate } from '@/shared/lib/datetime'
import { sanitizeSearchTerm } from '@/shared/lib/sanitize'
import { useAuth } from '@/app/providers/AuthProvider'
import { PageHeader } from '@/shared/components/page-header'
import { Button } from '@/shared/components/ui/button'
import { Badge } from '@/shared/components/ui/badge'
import { Card } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Textarea } from '@/shared/components/ui/textarea'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { ErrorState } from '@/shared/components/ui/error-state'
import { toast } from '@/shared/components/ui/toast'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form'
import {
  LANGUAGE_LABELS,
  type ClassroomDetail,
  type ClassroomStudent,
} from '@/shared/types/classroom'
import { TestStatusBadge } from '@/pages/teacher/TestStatusBadge'

/** One headline figure in the classroom's summary strip. */
function Figure({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.12em] text-ink-faint">{label}</dt>
      <dd
        className={`mt-1.5 font-serif text-3xl font-medium tabular-nums leading-none ${
          accent ? 'text-brand-text' : 'text-ink-strong'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}

/**
 * "Add students": the only way into a classroom. The teacher pastes one or
 * more emails -- from a spreadsheet column, an email thread, or typed by hand
 * -- and the server enrols each one. An email nobody has registered with yet is
 * still accepted and shows on the roster as "Invited"; the classroom appears
 * for that student as soon as they sign up with it.
 */
function AddStudentsCard({
  classroomId,
  onAdded,
}: {
  classroomId: string
  onAdded: (detail: ClassroomDetail) => void
}) {
  const inFlight = useRef(false)
  const [submitting, setSubmitting] = useState(false)

  const form = useForm<AddStudentsValues>({
    resolver: zodResolver(addStudentsSchema),
    defaultValues: { emails: '' },
    mode: 'onSubmit',
  })

  const pendingCount = parseEmailList(form.watch('emails')).length

  const add = useMutation({
    mutationFn: (values: AddStudentsValues) => classroomApi.addStudents(classroomId, parseEmailList(values.emails)),
    onSuccess: (result) => {
      onAdded(result.classroom)
      form.reset()
      const added = result.added.length
      const already = result.alreadyEnrolled.length
      // Addresses the server refused (another college, not a student, malformed) must be
      // named, or a teacher reads "0 students added" with no idea why.
      const rejected = result.rejected
        .slice(0, 3)
        .map((entry) => `${entry.email}: ${entry.reason}`)
        .join(' · ')
      const moreRejected = result.rejected.length > 3 ? ` (+${result.rejected.length - 3} more)` : ''
      if (added === 0 && already === 0 && result.rejected.length > 0) {
        toast.error('No students added', { description: `${rejected}${moreRejected}` })
        return
      }
      toast.success(added === 1 ? 'Student added' : `${added} students added`, {
        description:
          [
            already > 0 ? `${already} ${already === 1 ? 'was' : 'were'} already in this classroom.` : '',
            result.rejected.length > 0 ? `Not added: ${rejected}${moreRejected}` : '',
          ]
            .filter(Boolean)
            .join(' ') || 'They can see this classroom and its tests now.',
      })
    },
    onError: (error: Error) => {
      toast.error('Could not add students', { description: error.message })
    },
  })

  const onSubmit = async (values: AddStudentsValues) => {
    if (inFlight.current) return
    inFlight.current = true
    setSubmitting(true)
    try {
      await add.mutateAsync(values)
    } catch {
      // Reported by `onError`; the list stays in the field for correction.
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-soft ring-1 ring-inset ring-brand-300/40">
          <UserPlus className="h-4 w-4 text-brand-text" aria-hidden="true" />
        </span>
        <h3 className="text-lg font-semibold text-ink-strong">Add students</h3>
      </div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="mt-4 flex flex-col gap-3" noValidate>
          <FormField
            control={form.control}
            name="emails"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Student emails</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    rows={4}
                    placeholder={'riya.sharma@college.edu\nkabir.mehta@college.edu'}
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono text-xs"
                  />
                </FormControl>
                <FormDescription>
                  One per line, or separated by commas. Students who have not signed up yet are
                  invited, and see this classroom as soon as they register with that email.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex items-center justify-end gap-3">
            {pendingCount > 0 ? (
              <span className="text-xs text-ink-faint">
                {pendingCount} {pendingCount === 1 ? 'email' : 'emails'}
              </span>
            ) : null}
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <UserPlus className="h-4 w-4" aria-hidden="true" />
              )}
              {submitting ? 'Adding' : 'Add to classroom'}
            </Button>
          </div>
        </form>
      </Form>
    </Card>
  )
}

/** Confirms removing one student; their past submissions are kept. */
function RemoveStudentDialog({
  classroomId,
  student,
  onOpenChange,
  onRemoved,
}: {
  classroomId: string
  student: ClassroomStudent | null
  onOpenChange: (open: boolean) => void
  onRemoved: (detail: ClassroomDetail) => void
}) {
  const remove = useMutation({
    mutationFn: (email: string) => classroomApi.removeStudent(classroomId, email),
    onSuccess: (detail, email) => {
      onRemoved(detail)
      onOpenChange(false)
      toast.success('Student removed', { description: email })
    },
    onError: (error: Error) => {
      toast.error('Could not remove the student', { description: error.message })
    },
  })

  const name = student ? student.displayName || student.email : ''

  return (
    <Dialog open={student !== null} onOpenChange={(open) => !remove.isPending && onOpenChange(open)}>
      <DialogContent>
        <DialogTitle className="font-serif text-2xl font-medium text-ink-strong">Remove {name}?</DialogTitle>
        <DialogDescription className="mt-2 text-sm leading-relaxed text-ink">
          They will no longer see this classroom or be able to start its tests. Anything they have
          already submitted is kept for grading. You can add them again at any time.
        </DialogDescription>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={remove.isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={remove.isPending || !student}
            onClick={() => student && remove.mutate(student.email)}
          >
            {remove.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {remove.isPending ? 'Removing' : 'Remove student'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ClassroomDetailPage() {
  // The only source of the classroom identity. Every request, link, and test
  // row below is derived from this value, so a page opened for classroom A can
  // never display or act on classroom B.
  const { classroomId } = useParams<{ classroomId: string }>()
  const { collegeId } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [rosterSearch, setRosterSearch] = useState('')
  const [removing, setRemoving] = useState<ClassroomStudent | null>(null)

  const queryKey = ['classrooms', classroomId] as const
  const query = useQuery({
    queryKey,
    // A missing param must not fire a request at `/api/classrooms/undefined`.
    enabled: Boolean(classroomId),
    queryFn: ({ signal }) => classroomApi.get(classroomId as string, signal),
  })

  const classroom = query.data ?? null

  /** A roster change returns the fresh classroom: show it, and refresh the list's counts. */
  const applyDetail = (detail: ClassroomDetail) => {
    queryClient.setQueryData(queryKey, detail)
    void queryClient.invalidateQueries({ queryKey: ['classrooms'], exact: true })
  }

  const totals = useMemo(() => {
    const tests = classroom?.tests ?? []
    const now = Date.now()
    return {
      live: tests.filter((test) => testStatus(test, now) === 'LIVE').length,
      upcoming: tests.filter((test) => testStatus(test, now) === 'UPCOMING').length,
      submissions: tests.reduce((total, test) => total + test.submittedCount, 0),
      invited: (classroom?.students ?? []).filter((student) => student.pending).length,
    }
  }, [classroom])

  const roster = useMemo(() => {
    const students = classroom?.students ?? []
    const needle = sanitizeSearchTerm(rosterSearch)
    if (!needle) return students
    return students.filter((student) => `${student.displayName} ${student.email}`.toLowerCase().includes(needle))
  }, [classroom, rosterSearch])

  if (!classroomId) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <ErrorState
          title="No classroom selected"
          message="This address is missing a classroom id. Open a classroom from your list."
        />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader
        breadcrumbs={[
          { label: 'Classrooms', to: '/app/classrooms' },
          { label: classroom?.name ?? 'Classroom' },
        ]}
        title={classroom?.name ?? 'Classroom'}
        description={classroom ? `${classroom.subject} · taught by ${classroom.teacherName}` : undefined}
        actions={
          classroom ? (
            <Button asChild>
              {/* The classroom id travels in the path, taken from the param. */}
              <Link to={`/app/classrooms/${encodeURIComponent(classroomId)}/tests/new`}>
                <FilePlus2 className="h-4 w-4" aria-hidden="true" />
                New test
              </Link>
            </Button>
          ) : null
        }
      />

      {query.isPending ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading the classroom">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      ) : null}

      {query.isError ? (
        <ErrorState
          title="We couldn't load this classroom"
          message={
            query.error instanceof Error
              ? query.error.message
              : 'The classroom may have been removed, or it belongs to another college.'
          }
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {classroom ? (
        <div className="flex flex-col gap-10">
          <section aria-labelledby="classroom-overview">
            <h2 id="classroom-overview" className="sr-only">
              Classroom overview
            </h2>
            <Card className="flex flex-wrap items-center justify-between gap-6 p-5 sm:p-6">
              <dl className="flex flex-wrap gap-x-10 gap-y-5">
                <Figure label="Students" value={classroom.students.length - totals.invited} />
                <Figure label="Invited" value={totals.invited} />
                <Figure label="Tests" value={classroom.tests.length} />
                {/* Gold only when something is actually live. */}
                <Figure label="Live now" value={totals.live} accent={totals.live > 0} />
                <Figure label="Submissions" value={totals.submissions} />
              </dl>
              {collegeId && classroom.collegeId !== collegeId ? (
                <Badge variant="warning">Different college</Badge>
              ) : null}
            </Card>
          </section>

          <section aria-labelledby="classroom-tests">
            <div className="mb-4 flex items-end justify-between gap-4">
              <h2 id="classroom-tests" className="font-serif text-2xl font-medium text-ink-strong">
                Tests
              </h2>
              {classroom.tests.length > 0 ? (
                <p className="text-sm text-ink">
                  {totals.upcoming} upcoming · {totals.live} live ·{' '}
                  {classroom.tests.length - totals.upcoming - totals.live} closed
                </p>
              ) : null}
            </div>

            {classroom.tests.length === 0 ? (
              <Card>
                <EmptyState
                  icon={CalendarClock}
                  title="No tests yet"
                  description="Create a test to set a window, write questions, and let your students sit it."
                  action={{
                    label: 'Create the first test',
                    onClick: () => {
                      navigate(`/app/classrooms/${encodeURIComponent(classroomId)}/tests/new`)
                    },
                  }}
                />
              </Card>
            ) : (
              <ul className="stagger flex flex-col gap-2">
                {classroom.tests.map((test) => (
                  <li key={test.id}>
                    <Card interactive className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-ink-strong">{test.title}</h3>
                          <TestStatusBadge window={test} />
                        </div>
                        <p className="mt-1 text-sm text-ink">
                          {LANGUAGE_LABELS[test.language]} · {test.questionCount}{' '}
                          {test.questionCount === 1 ? 'question' : 'questions'} · {test.totalPoints} points
                        </p>
                        <p className="mt-1 text-xs text-ink-faint">{formatWindow(test)}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="whitespace-nowrap text-sm text-ink">
                          {test.submittedCount}/{classroom.students.length - totals.invited} submitted
                        </span>
                        {/*
                          A teacher previews a test rather than sitting it, so this
                          links to the author preview, not the student exam route.
                        */}
                        <Button asChild variant="secondary" size="sm">
                          <Link
                            to={`/app/classrooms/${encodeURIComponent(classroomId)}/tests/${encodeURIComponent(test.id)}`}
                          >
                            Review
                          </Link>
                        </Button>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="classroom-students" className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
            <div className="lg:sticky lg:top-24">
              <h2 id="classroom-students" className="mb-4 font-serif text-2xl font-medium text-ink-strong">
                Students
              </h2>
              <AddStudentsCard classroomId={classroomId} onAdded={applyDetail} />
            </div>

            <div className="lg:pt-12">
              {classroom.students.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={Users}
                    title="No students yet"
                    description="Add your students by email. Only the students you add can see this classroom and sit its tests."
                  />
                </Card>
              ) : (
                <Card className="overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
                    <p className="text-sm text-ink">
                      {classroom.students.length} on the roster
                      {totals.invited > 0 ? ` · ${totals.invited} invited` : ''}
                    </p>
                    <div className="relative w-full sm:w-56">
                      <label htmlFor="roster-search" className="sr-only">
                        Search students
                      </label>
                      <Search
                        className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint"
                        aria-hidden="true"
                      />
                      <Input
                        id="roster-search"
                        type="search"
                        value={rosterSearch}
                        onChange={(event) => setRosterSearch(event.target.value)}
                        placeholder="Search students"
                        className="h-9 pl-8 text-xs"
                      />
                    </div>
                  </div>
                  {roster.length === 0 ? (
                    <p className="px-5 py-8 text-center text-sm text-ink-faint">No student matches that search.</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {roster.map((student) => (
                        <li
                          key={student.email}
                          className="group flex items-center justify-between gap-4 px-5 py-3 transition-colors duration-250 hover:bg-canvas-sunken/50"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium text-ink-strong">
                              {student.pending ? student.email : student.displayName}
                            </p>
                            <p className="truncate text-sm text-ink">
                              {student.pending
                                ? `Invited ${formatISTDate(student.joinedAt)} · not signed up yet`
                                : student.email}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {student.pending ? (
                              <Badge variant="outline">Invited</Badge>
                            ) : (
                              <Badge variant="success" dot>
                                Joined
                              </Badge>
                            )}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-ink-faint hover:text-danger"
                              aria-label={`Remove ${student.displayName || student.email}`}
                              onClick={() => setRemoving(student)}
                            >
                              <UserMinus className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}
            </div>
          </section>

          <RemoveStudentDialog
            classroomId={classroomId}
            student={removing}
            onOpenChange={(open) => {
              if (!open) setRemoving(null)
            }}
            onRemoved={applyDetail}
          />
        </div>
      ) : null}
    </div>
  )
}
