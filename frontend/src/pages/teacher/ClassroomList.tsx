import { useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link } from 'react-router-dom'
import { ArrowUpRight, BookOpen, ClipboardList, LoaderCircle, Plus, Search, Users } from 'lucide-react'
import { classroomApi, filterClassroomsByTerm, type CreateClassroomInput } from '@/features/classrooms/classroomApi'
import { createClassroomSchema, type CreateClassroomValues } from '@/features/classrooms/schemas'
import { useAuth } from '@/app/providers/AuthProvider'
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue'
import { PageHeader } from '@/shared/components/page-header'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Badge } from '@/shared/components/ui/badge'
import { Card } from '@/shared/components/ui/card'
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form'

const CLASSROOMS_KEY = ['classrooms', 'mine'] as const

function CreateClassroomDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const inFlight = useRef(false)
  const [submitting, setSubmitting] = useState(false)

  const form = useForm<CreateClassroomValues>({
    resolver: zodResolver(createClassroomSchema),
    defaultValues: { name: '', subject: '', description: '' },
    mode: 'onBlur',
  })

  const create = useMutation({
    mutationFn: (values: CreateClassroomValues) => {
      const input: CreateClassroomInput = {
        name: values.name,
        subject: values.subject,
        description: values.description,
      }
      return classroomApi.create(input)
    },
    onSuccess: async (classroom) => {
      // Seed the list so the new row is present even before the next fetch.
      await queryClient.invalidateQueries({ queryKey: CLASSROOMS_KEY })
      form.reset()
      onOpenChange(false)
      toast.success('Classroom created', { description: `${classroom.name} is ready to share.` })
    },
    onError: (error: Error) => {
      toast.error('Could not create the classroom', { description: error.message })
    },
  })

  const onSubmit = async (values: CreateClassroomValues) => {
    if (inFlight.current) return
    inFlight.current = true
    setSubmitting(true)
    try {
      await create.mutateAsync(values)
    } catch {
      // Already surfaced by `onError`; the dialog stays open with the values intact.
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>New classroom</DialogTitle>
        <DialogDescription>
          Once it exists, open it and add your students by email.
        </DialogDescription>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="mt-5 flex flex-col gap-4" noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Classroom name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Data Structures 2026" autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="subject"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Subject or course code</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="CS201" autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (optional)</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="What this course covers" autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : null}
                {submitting ? 'Creating' : 'Create classroom'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * A two-letter monogram for a classroom tile, taken from its subject code
 * (or name). It gives every tile a recognisable mark without needing an image.
 */
function monogram(subject: string, name: string): string {
  const source = (subject || name).replace(/[^A-Za-z0-9 ]/g, ' ').trim()
  const words = source.split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return source.slice(0, 2).toUpperCase() || '··'
}

/** A headline figure for the summary strip above the classroom grid. */
function SummaryFigure({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-5 py-4 first:pl-0 sm:first:pl-5">
      <p className="font-serif text-3xl font-medium tabular-nums leading-none text-ink-strong">{value}</p>
      <p className="mt-1.5 text-xs uppercase tracking-[0.12em] text-ink-faint">{label}</p>
    </div>
  )
}

export function ClassroomListPage() {
  const { collegeId } = useAuth()
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const debouncedSearch = useDebouncedValue(search, 250)

  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: CLASSROOMS_KEY,
    queryFn: ({ signal }) => classroomApi.listMine(signal),
  })

  const classrooms = useMemo(
    () => filterClassroomsByTerm(data ?? [], debouncedSearch),
    [data, debouncedSearch],
  )

  const isFiltering = debouncedSearch.trim().length > 0
  const totals = useMemo(() => {
    const all = data ?? []
    return {
      classrooms: all.length,
      students: all.reduce((sum, room) => sum + room.studentCount, 0),
      tests: all.reduce((sum, room) => sum + room.testCount, 0),
    }
  }, [data])

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader
        title="Classrooms"
        description={
          collegeId
            ? 'Every classroom here belongs to your college. Open one to add students by email.'
            : 'Every classroom here belongs to your college. Open one to add students by email.'
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => void refetch()} disabled={isFetching}>
              Refresh
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New classroom
            </Button>
          </>
        }
      />

      {data && data.length > 0 ? (
        <div className="surface-sheen mb-6 grid grid-cols-3 divide-x divide-line rounded-lg border border-line shadow-card">
          <SummaryFigure label="Classrooms" value={totals.classrooms} />
          <SummaryFigure label="Students" value={totals.students} />
          <SummaryFigure label="Tests" value={totals.tests} />
        </div>
      ) : null}

      <div className="mb-6 max-w-sm">
        <label htmlFor="classroom-search" className="sr-only">
          Search classrooms
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
            aria-hidden="true"
          />
          <Input
            id="classroom-search"
            type="search"
            className="pl-9"
            placeholder="Search by name or subject"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      {isPending ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading your classrooms">
          {[0, 1, 2].map((index) => (
            <Card key={index} className="p-5">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="mt-3 h-4 w-72" />
              <Skeleton className="mt-4 h-9 w-40" />
            </Card>
          ))}
        </div>
      ) : null}

      {isError ? (
        <ErrorState
          title="We couldn't load your classrooms"
          message={error instanceof Error ? error.message : 'Check your connection and try again.'}
          onRetry={() => void refetch()}
        />
      ) : null}

      {!isPending && !isError && classrooms.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={isFiltering ? 'No classroom matches that search' : 'No classrooms yet'}
          description={
            isFiltering
              ? 'Try a different name or subject.'
              : 'Create your first classroom, then add your students to it by email.'
          }
          action={
            isFiltering
              ? { label: 'Clear search', onClick: () => setSearch('') }
              : { label: 'New classroom', onClick: () => setCreateOpen(true) }
          }
        />
      ) : null}

      {classrooms.length > 0 ? (
        <ul className="stagger grid gap-4 md:grid-cols-2">
          {classrooms.map((classroom) => (
            <li key={classroom.id}>
              {/*
                `interactive` (rather than raw hover classes) so the cursor and
                the hover border stay in step with the card primitive everywhere
                else. Only the border and the whisper shadow change -- the row
                does not jump or scale on hover.
              */}
              <Card interactive className="flex h-full flex-col p-5">
                <div className="flex items-start gap-4">
                  {/* Gold-on-black monogram: the tile's mark, stable across schemes. */}
                  <span
                    aria-hidden="true"
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-[#d4af5a]/30 bg-[linear-gradient(160deg,#2e2a23,#0c0b09)] font-serif text-lg font-medium tracking-wide text-[#e3c67f] shadow-[inset_0_1px_0_rgba(255,248,230,0.08)]"
                  >
                    {monogram(classroom.subject, classroom.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    {/*
                      The link target is built from this row's own `id`. A card
                      can therefore never open a different classroom: there is no
                      index, position, or shared variable in the URL, so a bug
                      that pointed every card at one record is not expressible.
                      `e2e`/`ClassroomList.test.tsx` asserts this per row.
                    */}
                    <h2 className="font-serif text-xl font-medium leading-snug text-ink-strong">
                      <Link
                        to={`/app/classrooms/${encodeURIComponent(classroom.id)}`}
                        className="rounded-sm hover:text-brand-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text"
                      >
                        {classroom.name}
                      </Link>
                    </h2>
                    <p className="mt-1 text-sm text-ink">{classroom.subject}</p>
                    {classroom.description ? (
                      <p className="mt-1.5 max-w-2xl text-sm text-ink-faint">{classroom.description}</p>
                    ) : null}
                  </div>
                </div>

                <div className="mb-5 mt-5 flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    <Users className="h-3 w-3" aria-hidden="true" />
                    {classroom.studentCount}{' '}
                    {classroom.studentCount === 1 ? 'student' : 'students'}
                  </Badge>
                  <Badge variant="outline">
                    <ClipboardList className="h-3 w-3" aria-hidden="true" />
                    {classroom.testCount} tests
                  </Badge>
                </div>

                <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                  <span className="text-xs text-ink-faint">
                    Created {new Date(classroom.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                  <Button asChild variant="secondary" size="sm">
                    <Link to={`/app/classrooms/${encodeURIComponent(classroom.id)}`}>
                      Open classroom
                      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}

      <CreateClassroomDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
