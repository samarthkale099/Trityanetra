import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Watchdog for a lazily imported chunk.
 *
 * A dynamic import that never settles leaves a spinner up forever, and a spinner
 * is not an error state: the student cannot tell a slow network from a broken
 * build, so they sit and wait. This turns "still loading" into a visible,
 * actionable failure after a bounded time, and offers a retry that actually
 * re-runs the import.
 *
 * The timer is cleared on every terminal outcome and on unmount, so nothing
 * leaks and no state update lands on an unmounted component.
 */

export type LoaderState = 'loading' | 'ready' | 'timeout' | 'error'

export interface WatchdogOptions {
  /** Milliseconds before a still-pending import is called a timeout. */
  timeoutMs?: number
  /** Notified when the import settles successfully. */
  onReady?: () => void
}

export interface Watchdog {
  state: LoaderState
  error: Error | null
  /** Bumped to force a fresh attempt; pass it to the lazy component's `key`. */
  retryToken: number
  retry: () => void
  markReady: () => void
}

export function useLazyLoadWatchdog({ timeoutMs = 12_000, onReady }: WatchdogOptions = {}): Watchdog {
  const [state, setState] = useState<LoaderState>('loading')
  const [error, setError] = useState<Error | null>(null)
  const [retryToken, setRetryToken] = useState(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // One timer per attempt. Keyed on `retryToken`, so a retry starts a fresh
  // deadline instead of inheriting a nearly-expired one.
  useEffect(() => {
    if (state !== 'loading') return
    const timer = setTimeout(() => {
      if (!mountedRef.current) return
      setState('timeout')
      setError(new Error('The editor took too long to load.'))
    }, timeoutMs)
    return () => clearTimeout(timer)
  }, [state, timeoutMs, retryToken])

  const markReady = useCallback(() => {
    setState((current) => (current === 'ready' ? current : 'ready'))
    setError(null)
    onReady?.()
  }, [onReady])

  const retry = useCallback(() => {
    setState('loading')
    setError(null)
    setRetryToken((token) => token + 1)
  }, [])

  return { state, error, retryToken, retry, markReady }
}
