import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Globe, LoaderCircle, Pencil, Plus } from 'lucide-react'
import { collegeApi, type College } from '@/features/college/collegeApi'
import { useAuth } from '@/app/providers/AuthProvider'
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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/components/ui/form'

export const COLLEGES_KEY = ['admin', 'colleges'] as const

/** Loose client check; the server validates the domain properly (no gmail.com, no "ac.in"). */
const domainField = z
  .string()
  .trim()
  .max(253, 'That domain is too long.')
  .refine((value) => value === '' || /^@?[a-z0-9.-]+\.[a-z]{2,}$/i.test(value), 'Use a domain like college.ac.in')

const collegeSchema = z.object({
  name: z.string().trim().min(2, 'Enter the college name.').max(120, 'Use at most 120 characters.'),
  code: z.string().trim().min(2, 'Enter a short code, like MIT.').max(20, 'Use at most 20 characters.'),
  emailDomain: domainField,
})
type CollegeValues = z.infer<typeof collegeSchema>

function AddCollegeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const form = useForm<CollegeValues>({
    resolver: zodResolver(collegeSchema),
    defaultValues: { name: '', code: '', emailDomain: '' },
    mode: 'onBlur',
  })

  const create = useMutation({
    mutationFn: (values: CollegeValues) =>
      collegeApi.create({ name: values.name, code: values.code, emailDomain: values.emailDomain || undefined }),
    onSuccess: async (college) => {
      await queryClient.invalidateQueries({ queryKey: COLLEGES_KEY })
      form.reset()
      onOpenChange(false)
      toast.success('College added', { description: `${college.name} (ID ${college.id})` })
    },
    onError: (error: Error) => toast.error('Could not add the college', { description: error.message }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Add a college</DialogTitle>
        <DialogDescription>
          With an email domain, students who register with that address join this college automatically.
        </DialogDescription>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) => create.mutate(values))}
            className="mt-5 flex flex-col gap-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>College name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="MIT World Peace University" autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Short code</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="MITWPU" autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="emailDomain"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email domain (optional)</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="mitwpu.edu.in" autoComplete="off" spellCheck={false} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                Add college
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function EditDomainDialog({ college, onClose }: { college: College | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Start from the college's current domain each time the dialog opens.
  useEffect(() => {
    setValue(college?.emailDomain ?? '')
    setError(null)
  }, [college])

  const save = useMutation({
    mutationFn: (domain: string | null) => collegeApi.setEmailDomain(college!.id, domain),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: COLLEGES_KEY })
      toast.success('Email domain updated')
      onClose()
    },
    onError: (err: Error) => setError(err.message),
  })

  const submit = (domain: string | null) => {
    setError(null)
    if (domain !== null) {
      const parsed = domainField.safeParse(domain)
      if (!parsed.success || !parsed.data) return setError('Use a domain like college.ac.in')
    }
    save.mutate(domain)
  }

  return (
    <Dialog
      open={college !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <DialogTitle>Email domain for {college?.name}</DialogTitle>
        <DialogDescription>
          Students registering with this domain, or any subdomain of it, are placed in this college.
        </DialogDescription>
        <form
          className="mt-5 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            submit(value)
          }}
        >
          <label htmlFor="edit-domain" className="text-sm font-medium text-ink-strong">
            Email domain
          </label>
          <Input
            id="edit-domain"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={college?.emailDomain ?? 'college.ac.in'}
            spellCheck={false}
            autoComplete="off"
          />
          {error ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-between gap-2 pt-2">
            {college?.emailDomain ? (
              <Button type="button" variant="ghost" onClick={() => submit(null)} disabled={save.isPending}>
                Remove domain
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                Save
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Admin: every college (root admin) or your own, with its email domain. */
export function CollegesPage() {
  const { user } = useAuth()
  // A root admin has no college of its own and is the only one who may create colleges.
  const isRootAdmin = !user?.collegeId
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<College | null>(null)

  const colleges = useQuery({
    queryKey: COLLEGES_KEY,
    queryFn: ({ signal }) => collegeApi.list(signal),
  })

  return (
    <div className="page-enter mx-auto w-full max-w-5xl px-4 py-8 lg:px-8">
      <PageHeader
        title="Colleges"
        description={
          isRootAdmin
            ? 'Every college on Trityanetra. Students join one automatically when their email matches its domain.'
            : 'Your college. Students join it automatically when their email matches its domain.'
        }
        actions={
          isRootAdmin ? (
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add college
            </Button>
          ) : null
        }
      />

      <div className="mt-8">
        {colleges.isPending ? (
          <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading colleges">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : colleges.isError ? (
          <ErrorState
            title="Could not load colleges"
            message={colleges.error.message}
            onRetry={() => void colleges.refetch()}
          />
        ) : colleges.data.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No colleges yet"
            description="Add your first college so students can register."
            action={isRootAdmin ? { label: 'Add college', onClick: () => setAdding(true) } : undefined}
          />
        ) : (
          <ul className="stagger flex flex-col gap-3">
            {colleges.data.map((college) => (
              <li key={college.id}>
                <Card className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium text-ink-strong">
                      {college.name}
                      <Badge variant="outline">{college.code}</Badge>
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-ink">
                      <Globe className="h-3.5 w-3.5 text-ink-faint" aria-hidden="true" />
                      {college.emailDomain ? (
                        <span className="font-mono text-xs">@{college.emailDomain}</span>
                      ) : (
                        <span className="text-ink-faint">No email domain: students need the college ID</span>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-ink-faint">
                      College ID <span className="font-mono">{college.id}</span>
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setEditing(college)}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    Edit domain
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AddCollegeDialog open={adding} onOpenChange={setAdding} />
      <EditDomainDialog college={editing} onClose={() => setEditing(null)} />
    </div>
  )
}
