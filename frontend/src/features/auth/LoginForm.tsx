import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { LoaderCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { loginSchema, type LoginValues } from '@/features/auth/schemas'
import { ResendVerification } from '@/features/auth/ResendVerification'
import { describeAuthError } from '@/features/auth/authApi'
import { useAuth } from '@/app/providers/AuthProvider'
import { roleHomePath } from '@/shared/lib/roles'
import { toast } from '@/shared/components/ui/toast'
import { Button } from '@/shared/components/ui/button'
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

export function LoginForm() {
  const navigate = useNavigate()
  const { signIn } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  // Set when the account exists but has not confirmed its email yet.
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null)

  /**
   * The in-flight latch, as a ref rather than as the `submitting` state above.
   *
   * `setSubmitting` is asynchronous: React re-renders after the current tick, so
   * two activations that land in the same tick (a fast double-click, or Enter
   * pressed while the first submit is still being dispatched) both read
   * `submitting === false` and both send a request. That produced duplicate
   * `POST /api/auth/session` exchanges, and with them a duplicate toast and a
   * race over which response wins. A ref is written synchronously, so the second
   * activation is always dropped.
   */
  const inFlight = useRef(false)

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
    // Re-validate as the user corrects a field, so a stale banner clears itself.
    mode: 'onBlur',
  })

  const onSubmit = async (values: LoginValues) => {
    // The button also disables, but Enter can still reach this handler while the
    // first request is in flight, so the guard has to be synchronous. See the
    // note on `inFlight` above.
    if (inFlight.current) return
    inFlight.current = true
    setSubmitting(true)
    setFormError(null)
    try {
      // Resolves with the server-assigned profile, not a client-side guess.
      const profile = await signIn(values.email, values.password)
      // Null: the server never confirmed who this is, even after retries.
      if (!profile) throw new Error('We signed you in but could not load your account from the server. Check your connection and try again.')
      toast.success('Signed in')
      navigate(roleHomePath(profile.role), { replace: true })
    } catch (error) {
      const message = describeAuthError(error)
      setFormError(message)
      setUnverifiedEmail((error as { code?: string } | null)?.code === 'auth/email-not-verified' ? values.email : null)
      toast.error('Sign-in failed', { description: message })
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
        {/*
          A live region so a failed sign-in is announced, not just drawn. The
          per-field messages below already use role="alert"; this covers the
          server-side failure that belongs to no single field.
        */}
        <div role="alert" aria-live="assertive">
          {formError ? (
            <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger">
              {formError}
            </p>
          ) : null}
        </div>
        {unverifiedEmail ? <ResendVerification email={unverifiedEmail} /> : null}

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                {/* The shared Input, not a bare <input>: it was hand-rolling
                    the field classes and so was missing the hover border and the
                    invalid-state focus ring that PasswordInput already had. */}
                <Input
                  {...field}
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="you@mit.ac.in"
                  disabled={submitting}
                />
              </FormControl>
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
                  autoComplete="current-password"
                  placeholder="Your password"
                  disabled={submitting}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" size="lg" disabled={submitting} className="mt-1">
          {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </Form>
  )
}
