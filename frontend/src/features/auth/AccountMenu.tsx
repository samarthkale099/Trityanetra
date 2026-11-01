import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, LogOut } from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'
import { toast } from '@/shared/components/ui/toast'
import { Avatar, AvatarFallback } from '@/shared/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Button } from '@/shared/components/ui/button'

export function SignOutDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)

  const handleSignOut = async () => {
    setSubmitting(true)
    try {
      await signOut()
      toast.success('Signed out')
      onOpenChange(false)
      navigate('/login', { replace: true })
    } catch {
      toast.error('Sign-out failed', {
        description: 'Please try again.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" showCloseButton>
        <DialogTitle>Sign out?</DialogTitle>
        <DialogDescription className="text-sm text-ink">
          You&rsquo;ll need your password to sign back in.
        </DialogDescription>
        <div className="mt-4 flex justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={handleSignOut}
            disabled={submitting}
          >
            {submitting ? 'Signing out…' : 'Sign out'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function AccountMenu() {
  const { user } = useAuth()
  const [signOutOpen, setSignOutOpen] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text"
            aria-label="Account menu"
          >
            <Avatar className="h-8 w-8">
              <AvatarFallback name={user?.displayName ?? user?.email ?? 'U'} />
            </Avatar>
            <span className="hidden text-left sm:block">
              <span className="block max-w-[10rem] truncate text-sm font-medium text-ink-strong">
                {user?.displayName ?? user?.email ?? 'Account'}
              </span>
            </span>
            <ChevronDown className="hidden h-4 w-4 text-ink-faint sm:block" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6}>
          <DropdownMenuLabel>
            <span className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-ink-strong">
                {user?.displayName ?? 'Account'}
              </span>
              <span className="text-xs font-normal text-ink">{user?.email}</span>
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSignOutOpen(true)}>
            <LogOut className="h-4 w-4 text-ink-faint" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} />
    </>
  )
}