import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Minimize, ShieldAlert } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { Alert } from '@/shared/components/ui/alert'

/**
 * Keeps the exam in fullscreen and blocks the page while it is not.
 *
 * Two things are going on:
 * 1. A continuous check against `document.fullscreenElement`, on the
 *    `fullscreenchange` event. The event alone is not enough: if the request is
 *    rejected the promise rejects and no event fires, so the exam would be left
 *    believing it is in fullscreen when it is not. Polling closes that gap.
 * 2. A blocking gate. While outside fullscreen the exam content is not rendered
 *    and a recovery panel is, so the student cannot read the paper by simply
 *    dismissing a banner.
 *
 * Entering fullscreen requires a user gesture, so `requestFullscreen` is only
 * ever called from a click handler. Browsers reject the request when the page is
 * not visible, which is also handled, and reported as a failure rather than
 * silently ignored.
 */

export interface FullscreenGuardProps {
  enabled: boolean
  /** Fired on every confirmed exit, for the proctoring overlay. */
  onExit?: () => void
  children: ReactNode
}

type FullscreenState = 'unsupported' | 'out' | 'requesting' | 'in' | 'denied'

function detectSupport(): boolean {
  if (typeof document === 'undefined') return false
  return Boolean(
    document.documentElement.requestFullscreen ?? (document as { webkitRequestFullscreen?: unknown }).webkitRequestFullscreen,
  )
}

export function FullscreenGuard({ enabled, onExit, children }: FullscreenGuardProps) {
  const [state, setState] = useState<FullscreenState>(() =>
    detectSupport() ? 'out' : 'unsupported',
  )
  const containerRef = useRef<HTMLDivElement | null>(null)
  const onExitRef = useRef(onExit)

  useEffect(() => {
    onExitRef.current = onExit
  }, [onExit])

  const isFullscreen = useCallback(
    () =>
      document.fullscreenElement === document.documentElement ||
      // Safari's prefixed API, kept so the guard degrades rather than breaks.
      Boolean((document as { webkitFullscreenElement?: Element | null }).webkitFullscreenElement),
    [],
  )

  /**
   * Reports an exit at most once per in->out transition. Without the latch, the
   * polling check would fire `onExit` on every tick for as long as the student
   * stayed out, and a returning student would see a growing violation count.
   */
  const wasInRef = useRef(false)

  // Extracted so the effect below depends on a boolean rather than a complex
  // expression, which keeps the dependency list statically checkable.
  const unsupported = state === 'unsupported'

  useEffect(() => {
    if (!enabled || unsupported) return

    const check = () => {
      const inside = isFullscreen()
      if (inside) {
        wasInRef.current = true
        setState((current) => (current === 'in' ? current : 'in'))
        return
      }
      if (wasInRef.current) {
        wasInRef.current = false
        setState('out')
        onExitRef.current?.()
      } else {
        setState((current) => (current === 'out' ? current : 'out'))
      }
    }

    document.addEventListener('fullscreenchange', check)
    document.addEventListener('webkitfullscreenchange', check)
    // Backstop for a rejected or silently-dropped request.
    const timer = setInterval(check, 1000)
    check()

    return () => {
      document.removeEventListener('fullscreenchange', check)
      document.removeEventListener('webkitfullscreenchange', check)
      clearInterval(timer)
      wasInRef.current = false
    }
  }, [enabled, unsupported, isFullscreen])

  /** Escape hatch on unmount, so leaving the exam does not strand fullscreen. */
  useEffect(() => {
    if (!enabled) return
    return () => {
      if (isFullscreen()) {
        void document.exitFullscreen?.().catch(() => {
          /* Already exited, or the browser refused. Nothing to do. */
        })
      }
    }
  }, [enabled, isFullscreen])

  const request = useCallback(async () => {
    const element = containerRef.current ?? document.documentElement
    setState('requesting')
    try {
      const requestFn =
        element.requestFullscreen ??
        (element as { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen
      if (!requestFn) throw new Error('Fullscreen API unavailable')
      await requestFn.call(element)
      setState('in')
      wasInRef.current = true
    } catch {
      // Typically: the document is hidden, or the gesture was not trusted.
      setState('denied')
    }
  }, [])

  if (!enabled) return <>{children}</>

  const blocked = state === 'out' || state === 'denied' || state === 'requesting'

  return (
    <div ref={containerRef} className="flex min-h-dvh flex-col bg-canvas">
      {blocked ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-lg">
            <div className="rounded-xl border border-line bg-surface p-8 shadow-overlay">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-danger-soft">
                  <ShieldAlert className="h-5 w-5 text-danger" aria-hidden="true" />
                </span>
                <span className="text-sm font-semibold text-danger">Fullscreen required</span>
              </div>
              <h1 className="mt-3 text-2xl font-semibold text-ink-strong">
                {state === 'denied' ? 'Your browser blocked fullscreen' : 'This exam runs in fullscreen'}
              </h1>
              <p className="mt-2 text-sm text-ink">
                {state === 'denied'
                  ? 'Your browser refused the request. Allow fullscreen for this site in the address bar, then try again. If you are in an embedded or automated browser, fullscreen may be unavailable entirely.'
                  : 'Close anything else on screen, then continue. Leaving fullscreen during the exam is recorded.'}
              </p>

              {state === 'denied' ? (
                <Alert variant="warning" className="mt-4" title="Nothing you can do about this?">
                  Ask your teacher to reissue the attempt, or try a different browser. The exam
                  cannot start without fullscreen.
                </Alert>
              ) : null}

              <Button className="mt-6 w-full" size="lg" onClick={() => void request()} disabled={state === 'requesting'}>
                <Minimize className="h-4 w-4" aria-hidden="true" />
                {state === 'requesting' ? 'Requesting' : 'Enter fullscreen'}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        children
      )}
    </div>
  )
}
