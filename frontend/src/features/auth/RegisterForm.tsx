import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { LoaderCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { registerSchema, type RegisterValues } from '@/features/auth/schemas'
import { describeAuthError } from '@/features/auth/authApi'
import { useAuth } from '@/app/providers/AuthProvider'
import { roleHomePath } from '@/shared/lib/roles'
import { deriveCollegeDomain } from '@/shared/lib/sanitize'
import { toast } from '@/shared/components/ui/toast'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form'
import { PasswordInput } from '@/shared/components/ui/password-input'
import { Input } from '@/shared/components/ui/input'

export function RegisterForm() {
  const navigate = useNavigate()
  const { signUp } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  /**
   * The in-flight latch, as a ref rather than as the `submitting` state above.
   *
   * `setSubmitting` is asynchronous, so two activations landing in the same tick
   * (a fast double-click on a form this long, or a repeated Enter) would both
   * read `submitting === false` and both create an account. A ref is written
   * synchronously, so the second activation is always dropped. Same reasoning as
   * the latch in LoginForm.
   */
  const inFlight = useRef(false)

  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { displayName: '', email: '', password: '' },
    mode: 'onBlur',
  })

  const onSubmit = async (values: RegisterValues) => {
    if (inFlight.current) return
    if (!agreed) {
      setFormError('Please accept the classroom code of conduct to continue.')
      return
    }
    inFlight.current = true
    setSubmitting(true)
    setFormError(null)
    try {
      // The domain is not a separate field: it is the part of the address
      // after "@", so the payload is derived from what the student typed and
      // can never disagree with it.
      const profile = await signUp({
        email: values.email,
        password: values.password,
        displayName: values.displayName,
        collegeDomain: deriveCollegeDomain(values.email),
      })
      toast.success('Account created', { description: 'You are signed in as a student.' })
      // Null means the backend has not confirmed the role yet; the route guard
      // redirects as soon as it does, so no destination is guessed here.
      if (profile) navigate(roleHomePath(profile.role), { replace: true })
      else {
        inFlight.current = false
        setSubmitting(false)
      }
    } catch (error) {
      const message = describeAuthError(error)
      setFormError(message)
      toast.error('Account could not be created', { description: message })
      inFlight.current = false
      setSubmitting(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
        <div role="alert" aria-live="assertive">
          {formError ? (
            <p className="rounded-md border border-danger/25 bg-danger-soft px-3 py-2.5 text-sm text-danger">
              {formError}
            </p>
          ) : null}
        </div>

        <FormField
          control={form.control}
          name="displayName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full name</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="text"
                  autoComplete="name"
                  placeholder="Riya Sharma"
                  disabled={submitting}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>College email</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="riya@mit.ac.in"
                  disabled={submitting}
                />
              </FormControl>
              <p className="text-xs leading-relaxed text-ink">Use your college email address.</p>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <PasswordInput
                  {...field}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  disabled={submitting}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <label className="flex cursor-pointer items-start gap-3 rounded-md text-sm leading-relaxed text-ink">
          <Checkbox
            checked={agreed}
            onCheckedChange={(checked) => setAgreed(checked === true)}
            disabled={submitting}
            aria-label="Accept the classroom code of conduct"
            className="mt-0.5"
          />
          <span>
            I agree to follow the classroom code of conduct and understand every test
            session may be monitored for academic integrity.
          </span>
        </label>
        <Button type="submit" size="lg" disabled={submitting} className="mt-1">
          {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </Form>
  )
}