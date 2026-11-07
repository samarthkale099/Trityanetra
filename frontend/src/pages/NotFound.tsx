import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { LogoMark } from '@/shared/components/brand/Logo'
import { Button } from '@/shared/components/ui/button'

export function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-7 bg-canvas px-4 py-16 text-center">
      <LogoMark size={44} className="text-brand-mark" />
      <div className="flex flex-col items-center gap-3">
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink">
          <Compass className="h-3.5 w-3.5 text-brand-text" aria-hidden="true" />
          Page not found
        </span>
        <h1 className="max-w-md text-4xl font-semibold">This page isn&rsquo;t here.</h1>
        <p className="max-w-sm text-sm leading-relaxed text-ink">
          The address may be outdated or the page moved. Try one of the destinations below.
        </p>
      </div>
      {/* Stack at phone widths: two buttons side by side at 360px leaves each
          one too narrow to read its own label. */}
      <div className="flex w-full max-w-xs flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row">
        <Button asChild className="w-full sm:w-auto">
          <Link to="/">Go to home</Link>
        </Button>
        <Button asChild variant="secondary" className="w-full sm:w-auto">
          <Link to="/app/dashboard">Open overview</Link>
        </Button>
      </div>
    </div>
  )
}