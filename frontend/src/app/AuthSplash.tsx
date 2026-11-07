import { LogoMark } from '@/shared/components/brand/Logo'
import { Skeleton } from '@/shared/components/ui/skeleton'

export function AuthSplash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-6">
          <LogoMark size={44} className="text-brand-mark" />
          <p className="font-display text-lg font-semibold text-ink-strong">
            Preparing your classroom&hellip;
          </p>
          <div className="w-full space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </div>
        </div>
      </div>
    </div>
  )
}