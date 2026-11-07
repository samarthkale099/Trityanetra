import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { LoaderCircle, Search, Send, Users } from 'lucide-react'
import { filterSubmissionsByStudent, reviewApi, type SubmissionState } from '@/features/classrooms/reviewApi'
import { formatIST } from '@/shared/lib/datetime'
import { PageHeader } from '@/shared/components/page-header'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Badge } from '@/shared/components/ui/badge'
import { Card } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { ErrorState } from '@/shared/components/ui/error-state'
import { toast } from '@/shared/components/ui/toast'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'

const STATE_VARIANT: Record<SubmissionState, 'neutral' | 'success' | 'warning'> = {
  SUBMITTED: 'success',
  LATE: 'warning',
  NOT_SUBMITTED: 'neutral',
}

const STATE_LABEL: Record<SubmissionState, string> = {
  SUBMITTED: 'Submitted',
  LATE: 'Late',
  NOT_SUBMITTED: 'Not submitted',
}

/**
 * The teacher's view of one test's submissions: every enrolled student, derived
 * from the roster server-side, with their state, case pass count, and saved
 * marks alongside. Grading happens on the detail page; this page's one action is
 * releasing the whole set, which locks further edits and tells the students.
 */
export function SubmissionListPage() {
  const { classroomId, testId } = useParams<{ classroomId: string; testId: string }>()
  const [search, setSearch] = useState('')
  const [releaseOpen, setReleaseOpen] = useState(false)
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['review', 'submissions', testId],
    enabled: Boolean(testId),
    queryFn: ({ signal }) => reviewApi.listSubmissions(testId as string, signal),
  })

  const list = query.data ?? null
  const rows = useMemo(
    () => (list ? filterSubmissionsByStudent(list.submissions, search) : []),
    [list, search],
  )
  const isFiltering = search.trim().length > 0

  const release = useMutation({
    mutationFn: (releaseTestId: string) => reviewApi.releaseResults(releaseTestId),
    onSuccess: async (released) => {
      await queryClient.invalidateQueries({ queryKey: ['review', 'submissions', released.testId] })
      // The detail pages are cached for 30s; a teacher who opens a student right
      // after releasing must see the locked form, not the editable pre-release one.
      await queryClient.invalidateQueries({ queryKey: ['review', 'submission', released.testId] })
      setReleaseOpen(false)
      toast.success('Results released', { description: 'Students can now see their marks and comments.' })
    },
    onError: (error: Error) => {
      toast.error('Could not release results', { description: error.message })
    },
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

  const listPath = `/app/classrooms/${encodeURIComponent(classroomId ?? '')}/tests/${encodeURIComponent(testId)}`

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader
        breadcrumbs={[
          { label: 'Classrooms', to: '/app/classrooms' },
          ...(classroomId
            ? [{ label: 'Classroom', to: `/app/classrooms/${encodeURIComponent(classroomId)}` }]
            : []),
          { label: 'Test', to: listPath },
          { label: 'Submissions' },
        ]}
        title="Submissions"
        description={list ? `Grading for ${list.testTitle}. Marks stay hidden from students until you release them.` : undefined}
        actions={
          list ? (
            list.resultsReleased ? (
              <Badge variant="success" dot>
                Results released
              </Badge>
            ) : (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setReleaseOpen(true)}
                disabled={list.submissions.length === 0}
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                Release results
              </Button>
            )
          ) : null
        }
      />

      {query.isPending ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading submissions">
          <Skeleton className="h-10 w-full max-w-sm" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : null}

      {query.isError ? (
        <ErrorState
          title="We couldn't load these submissions"
          message={
            query.error instanceof Error
              ? query.error.message
              : 'The test may have been removed, or it belongs to another college.'
          }
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {list ? (
        <>
          <div className="mb-5 max-w-sm">
            <label htmlFor="submission-search" className="sr-only">
              Search submissions
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
                aria-hidden="true"
              />
              <Input
                id="submission-search"
                type="search"
                className="pl-9"
                placeholder="Search by student name or email"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>

          {list.submissions.length === 0 ? (
            <Card>
              <EmptyState
                icon={Users}
                title="No one has submitted yet"
                description="The submissions list mirrors your classroom roster, so a student appears here the moment they join."
              />
            </Card>
          ) : rows.length === 0 ? (
            <Card>
              <EmptyState
                icon={Users}
                title={isFiltering ? 'No student matches that search' : 'No submissions'}
                description={
                  isFiltering ? 'Try a different name or email.' : 'There is nothing to review yet.'
                }
                action={isFiltering ? { label: 'Clear search', onClick: () => setSearch('') } : undefined}
              />
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Cases passed</TableHead>
                    <TableHead>Marks</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead className="text-right">
                      <span className="sr-only">Grade</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <p className="truncate font-medium text-ink-strong">{row.studentName}</p>
                        <p className="truncate text-xs text-ink-faint">{row.studentEmail}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATE_VARIANT[row.state]} dot>
                          {STATE_LABEL[row.state]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {row.passedCases}/{row.totalCases}
                      </TableCell>
                      <TableCell>
                        {row.marks === null ? (
                          <span className="text-ink-faint">Not graded</span>
                        ) : (
                          `${row.marks}/${row.maxMarks}`
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-ink">
                        {row.submittedAt ? formatIST(row.submittedAt) : <span className="text-ink-faint">—</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.state === 'NOT_SUBMITTED' ? (
                          <span className="text-sm text-ink-faint">No submission</span>
                        ) : (
                          <Button asChild variant="secondary" size="sm">
                            <Link
                              to={`${listPath}/submissions/${encodeURIComponent(row.id)}`}
                              aria-label={`Grade ${row.studentName}`}
                            >
                              Grade
                            </Link>
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}

          <Dialog open={releaseOpen} onOpenChange={setReleaseOpen}>
            <DialogContent>
              <DialogTitle>Release results?</DialogTitle>
              <DialogDescription>
                Students will immediately see their marks and your comments. Gradings are then locked, so
                you will not be able to change them.
              </DialogDescription>
              <div className="mt-5 flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setReleaseOpen(false)} disabled={release.isPending}>
                  Cancel
                </Button>
                <Button type="button" onClick={() => release.mutate(testId)} disabled={release.isPending}>
                  {release.isPending ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Send className="h-4 w-4" aria-hidden="true" />
                  )}
                  {release.isPending ? 'Releasing' : 'Release results'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  )
}