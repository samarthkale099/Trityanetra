import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, Search, ShieldCheck, UserCog, Users } from 'lucide-react'
import { collegeApi, userAdminApi, type AdminUser } from '@/features/college/collegeApi'
import { COLLEGES_KEY } from '@/pages/college/Colleges'
import { useAuth } from '@/app/providers/AuthProvider'
import { ROLE_LABELS } from '@/shared/lib/roles'
import type { UserRole } from '@/shared/types'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/select'

const ROLE_FILTERS: readonly { value: UserRole | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'Everyone' },
  { value: 'STUDENT', label: 'Students' },
  { value: 'TEACHER', label: 'Teachers' },
  { value: 'ADMIN', label: 'Admins' },
]

const ROLE_BADGE: Record<UserRole, 'neutral' | 'brand' | 'info'> = {
  STUDENT: 'neutral',
  TEACHER: 'brand',
  ADMIN: 'info',
}

/** Select needs a non-empty value; this stands for "no college" (a root admin). */
const NO_COLLEGE = '__none__'

function ChangeRoleDialog({
  person,
  isRootAdmin,
  ownCollegeId,
  collegeNames,
  onClose,
}: {
  person: AdminUser | null
  isRootAdmin: boolean
  ownCollegeId: string | null
  collegeNames: Map<string, string>
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [role, setRole] = useState<UserRole>('STUDENT')
  const [collegeId, setCollegeId] = useState<string>(NO_COLLEGE)

  // Start from the person's current role and college each time the dialog opens.
  useEffect(() => {
    if (!person) return
    setRole(person.role)
    setCollegeId(person.collegeId ?? ownCollegeId ?? NO_COLLEGE)
  }, [person, ownCollegeId])

  const save = useMutation({
    mutationFn: () =>
      userAdminApi.assignRole(person!.uid, role, collegeId === NO_COLLEGE ? null : collegeId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      toast.success('Role updated', {
        description: `${person!.displayName} is now ${ROLE_LABELS[role].toLowerCase()}. It applies the next time they sign in.`,
      })
      onClose()
    },
    onError: (error: Error) => toast.error('Could not change the role', { description: error.message }),
  })

  // Only a root admin may grant ADMIN or move people between colleges.
  const roles: UserRole[] = isRootAdmin ? ['STUDENT', 'TEACHER', 'ADMIN'] : ['STUDENT', 'TEACHER']
  const needsCollege = !(isRootAdmin && role === 'ADMIN')
  const missingCollege = needsCollege && collegeId === NO_COLLEGE

  return (
    <Dialog
      open={person !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <DialogTitle>Change role</DialogTitle>
        <DialogDescription>
          {person?.displayName} ({person?.email}). The change applies the next time they sign in.
        </DialogDescription>
        <div className="mt-5 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink-strong" id="role-label">
              Role
            </span>
            <Select value={role} onValueChange={(value) => setRole(value as UserRole)}>
              <SelectTrigger aria-labelledby="role-label">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((value) => (
                  <SelectItem key={value} value={value}>
                    {ROLE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isRootAdmin ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-strong" id="college-label">
                College
              </span>
              <Select value={collegeId} onValueChange={setCollegeId}>
                <SelectTrigger aria-labelledby="college-label">
                  <SelectValue placeholder="Choose a college" />
                </SelectTrigger>
                <SelectContent>
                  {role === 'ADMIN' ? (
                    <SelectItem value={NO_COLLEGE}>No college (root admin: manages every college)</SelectItem>
                  ) : null}
                  {[...collegeNames.entries()].map(([id, name]) => (
                    <SelectItem key={id} value={id}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {missingCollege ? <p className="text-xs text-danger">Choose a college for this role.</p> : null}
            </div>
          ) : null}

          {role === 'ADMIN' ? (
            <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
              Admins can change other people&apos;s roles{collegeId === NO_COLLEGE ? ' in every college' : ''}. Only
              give this to people you trust.
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" onClick={() => save.mutate()} disabled={save.isPending || missingCollege}>
              {save.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Save role
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Admin: find people by email or role, and make them teachers or admins. */
export function PeoplePage() {
  const { user } = useAuth()
  const isRootAdmin = !user?.collegeId
  const [emailInput, setEmailInput] = useState('')
  const [email, setEmail] = useState('')
  const [roleFilter, setRoleFilter] = useState<UserRole | 'ALL'>('ALL')
  const [editing, setEditing] = useState<AdminUser | null>(null)

  const colleges = useQuery({ queryKey: COLLEGES_KEY, queryFn: ({ signal }) => collegeApi.list(signal) })
  const collegeNames = useMemo(
    () => new Map((colleges.data ?? []).map((college) => [college.id, college.name])),
    [colleges.data],
  )

  const people = useQuery({
    queryKey: ['admin', 'users', email, roleFilter],
    queryFn: ({ signal }) =>
      userAdminApi.search({ ...(email ? { email } : {}), ...(roleFilter !== 'ALL' ? { role: roleFilter } : {}) }, signal),
  })

  return (
    <div className="page-enter mx-auto w-full max-w-5xl px-4 py-8 lg:px-8">
      <PageHeader
        title="People"
        description={
          isRootAdmin
            ? 'Everyone registered, in every college. Make teachers and admins here.'
            : 'Everyone registered in your college. Make teachers here.'
        }
      />

      <form
        className="mt-8 flex flex-wrap items-end gap-3"
        role="search"
        onSubmit={(event) => {
          event.preventDefault()
          setEmail(emailInput.trim())
        }}
      >
        <div className="flex min-w-[16rem] flex-1 flex-col gap-1.5">
          <label htmlFor="people-email" className="text-sm font-medium text-ink-strong">
            Find by email
          </label>
          <Input
            id="people-email"
            type="email"
            value={emailInput}
            onChange={(event) => {
              setEmailInput(event.target.value)
              if (event.target.value === '') setEmail('')
            }}
            placeholder="teacher@college.ac.in"
            autoComplete="off"
          />
        </div>
        <Button type="submit" variant="secondary">
          <Search className="h-4 w-4" aria-hidden="true" />
          Search
        </Button>
      </form>

      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter by role">
        {ROLE_FILTERS.map((filter) => (
          <Button
            key={filter.value}
            size="sm"
            variant={roleFilter === filter.value ? 'primary' : 'outline'}
            aria-pressed={roleFilter === filter.value}
            onClick={() => setRoleFilter(filter.value)}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      <div className="mt-6">
        {people.isPending ? (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading people">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : people.isError ? (
          <ErrorState title="Could not load people" message={people.error.message} onRetry={() => void people.refetch()} />
        ) : people.data.length === 0 ? (
          <EmptyState
            icon={Users}
            title={email ? 'Nobody with that email' : 'Nobody here yet'}
            description={
              email
                ? 'Check the spelling. People only appear after they register.'
                : 'People appear here once they register.'
            }
          />
        ) : (
          <ul className="stagger flex flex-col gap-2" aria-label="People">
            {people.data.map((person) => {
              const isSelf = person.uid === user?.uid
              return (
                <li key={person.uid}>
                  <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-ink-strong">
                        {person.displayName}
                        <Badge variant={ROLE_BADGE[person.role]}>
                          {person.role === 'ADMIN' ? <ShieldCheck className="h-3 w-3" aria-hidden="true" /> : null}
                          {ROLE_LABELS[person.role]}
                        </Badge>
                        {!person.emailVerified ? <Badge variant="warning">Email not verified</Badge> : null}
                        {isSelf ? <Badge variant="outline">You</Badge> : null}
                      </p>
                      <p className="mt-0.5 truncate text-sm text-ink">{person.email}</p>
                      {isRootAdmin ? (
                        <p className="mt-0.5 text-xs text-ink-faint">
                          {person.collegeId ? (collegeNames.get(person.collegeId) ?? person.collegeId) : 'All colleges'}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setEditing(person)}
                      disabled={isSelf}
                      title={isSelf ? 'You cannot change your own role' : undefined}
                      aria-label={`Change role for ${person.displayName}`}
                    >
                      <UserCog className="h-3.5 w-3.5" aria-hidden="true" />
                      Change role
                    </Button>
                  </Card>
                </li>
              )
            })}
          </ul>
        )}
        {people.data && people.data.length >= 100 ? (
          <p className="mt-3 text-xs text-ink-faint">Showing the first 100. Search by email to find someone specific.</p>
        ) : null}
      </div>

      <ChangeRoleDialog
        person={editing}
        isRootAdmin={isRootAdmin}
        ownCollegeId={user?.collegeId ?? null}
        collegeNames={collegeNames}
        onClose={() => setEditing(null)}
      />
    </div>
  )
}
