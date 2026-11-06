import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, LoaderCircle, XCircle } from 'lucide-react'
import { AuthScaffold } from '@/features/auth/AuthScaffold'
import { authApi } from '@/features/auth/authApi'

type State = 'checking' | 'verified' | 'failed'

/**
 * Where the link in the verification email lands (`/verify-email?token=...`).
 * Confirms the address once, then sends the student to sign in.
 */
export function VerifyEmailPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [state, setState] = useState<State>(token ? 'checking' : 'failed')
  // Strict mode mounts twice in development; the token works only once.
  const started = useRef(false)

  useEffect(() => {
    if (!token || started.current) return
    started.current = true
    authApi
      .verifyEmail(token)
      .then(() => setState('verified'))
      .catch(() => setState('failed'))
  }, [token])

  const signInLink = (
    <Link
      to="/login"
      className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg bg-brand-gradient px-6 text-sm font-medium text-on-brand transition-all duration-250 hover:-translate-y-px hover:shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text focus-visible:ring-offset-2"
    >
      Go to sign in
    </Link>
  )

  if (state === 'checking') {
    return (
      <AuthScaffold eyebrow="Email verification" title="Confirming your email" subtitle="This takes a moment.">
        <p className="flex items-center gap-2 text-sm text-ink" role="status">
          <LoaderCircle className="h-4 w-4 animate-spin text-brand-text" aria-hidden="true" />
          Checking your link…
        </p>
      </AuthScaffold>
    )
  }

  if (state === 'verified') {
    return (
      <AuthScaffold eyebrow="Email verification" title="Email confirmed" subtitle="Your account is ready.">
        <p className="flex items-center gap-2 text-sm text-success" role="status">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Thanks. You can sign in now.
        </p>
        {signInLink}
      </AuthScaffold>
    )
  }

  return (
    <AuthScaffold
      eyebrow="Email verification"
      title="This link does not work"
      subtitle="It may have expired (links last 24 hours) or already been used."
    >
      <p className="flex items-start gap-2 text-sm text-danger" role="alert">
        <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        Try signing in. If your email is still unconfirmed, the sign-in page lets you send a new link.
      </p>
      {signInLink}
    </AuthScaffold>
  )
}
