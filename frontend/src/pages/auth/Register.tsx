import { Link } from 'react-router-dom'
import { AuthScaffold } from '@/features/auth/AuthScaffold'
import { RegisterForm } from '@/features/auth/RegisterForm'

export function RegisterPage() {
  return (
    <AuthScaffold
      eyebrow="Join Trityanetra"
      title="Create your account"
      subtitle="All accounts start as students. Your teacher or administrator sets your role."
    >
      <RegisterForm />
      <p className="mt-6 border-t border-line pt-5 text-center text-sm text-ink">
        Already have an account?{' '}
        <Link
          to="/login"
          className="rounded-sm font-medium text-brand-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text focus-visible:ring-offset-2"
        >
          Sign in
        </Link>
      </p>
    </AuthScaffold>
  )
}