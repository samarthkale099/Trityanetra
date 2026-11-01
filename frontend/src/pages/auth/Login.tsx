import { Link } from 'react-router-dom'
import { AuthScaffold } from '@/features/auth/AuthScaffold'
import { LoginForm } from '@/features/auth/LoginForm'
import { PasswordResetDialog } from '@/features/auth/PasswordResetDialog'
import { useState } from 'react'

export function LoginPage() {
  const [resetOpen, setResetOpen] = useState(false)

  return (
    <AuthScaffold
      eyebrow="Welcome back"
      title="Sign in to your classroom"
      subtitle="Use the same email and password you registered with."
    >
      <LoginForm />
      {/* Stacks below 640px: "New here? Create an account" and "Forgot password?"
          on one 360px line leaves neither enough room to be read or tapped. */}
      <div className="mt-6 flex flex-col items-start gap-3 border-t border-line pt-5 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <button
          type="button"
          onClick={() => setResetOpen(true)}
          className="rounded-sm text-brand-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text focus-visible:ring-offset-2"
        >
          Forgot password?
        </button>
        <span className="text-ink">
          New here?{' '}
          <Link
            to="/register"
            className="rounded-sm font-medium text-brand-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text focus-visible:ring-offset-2"
          >
            Create an account
          </Link>
        </span>
      </div>
      <PasswordResetDialog open={resetOpen} onOpenChange={setResetOpen} />
    </AuthScaffold>
  )
}