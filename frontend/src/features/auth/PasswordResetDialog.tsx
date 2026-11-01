import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { LoaderCircle } from 'lucide-react'
import { passwordResetSchema, type PasswordResetValues } from '@/features/auth/schemas'
import { describeAuthError } from '@/features/auth/authApi'
import { useAuth } from '@/app/providers/AuthProvider'
import { toast } from '@/shared/components/ui/toast'
import { Button } from '@/shared/components/ui/button'
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
import { Input } from '@/shared/components/ui/input'

interface PasswordResetDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PasswordResetDialog({ open, onOpenChange }: PasswordResetDialogProps) {
  const { resetPassword } = useAuth()
  const [submitting, setSubmitting] = useState(false)

  const form = useForm<PasswordResetValues>({
    resolver: zodResolver(passwordResetSchema),
    defaultValues: { email: '' },
  })

  const onSubmit = async (values: PasswordResetValues) => {
    setSubmitting(true)
    try {
      await resetPassword(values.email)
      toast.success('Password reset email sent', {
        description: 'Follow the link in the email to choose a new password.',
      })
      form.reset()
      onOpenChange(false)
    } catch (error) {
      toast.error('Reset email could not be sent', {
        description: describeAuthError(error),
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" showCloseButton>
        <DialogTitle>Reset your password</DialogTitle>
        <DialogDescription className="text-sm text-ink">
          We&rsquo;ll email you a link to set a new password.
        </DialogDescription>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="mt-4 flex flex-col gap-5" noValidate>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      placeholder="you@college.edu"
                      disabled={submitting}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                {submitting ? 'Sending…' : 'Send reset email'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}