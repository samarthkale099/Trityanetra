import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { LoaderCircle, MailCheck } from 'lucide-react'
import { authApi } from '@/features/auth/authApi'
import { Button } from '@/shared/components/ui/button'

/**
 * "Send the link again" for an account that has not confirmed its email yet.
 * The server answers the same way whether or not the account exists, so this
 * never reveals who is registered.
 */
export function ResendVerification({ email }: { email: string }) {
  const [sent, setSent] = useState(false)
  const resend = useMutation({
    mutationFn: () => authApi.resendVerification(email),
    onSuccess: () => setSent(true),
  })

  if (sent) {
    return (
      <p className="flex items-center gap-2 text-sm text-success" role="status">
        <MailCheck className="h-4 w-4" aria-hidden="true" />
        A new link is on its way to {email}. It is valid for 24 hours.
      </p>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="secondary" size="sm" onClick={() => resend.mutate()} disabled={resend.isPending}>
        {resend.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        Resend verification email
      </Button>
      {resend.isError ? (
        <span className="text-xs text-danger">Could not send it. Try again in a moment.</span>
      ) : null}
    </div>
  )
}
