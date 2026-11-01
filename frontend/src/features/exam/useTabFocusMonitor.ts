import { useEffect, useRef } from 'react'

/**
 * Detects the exam tab being hidden or the browser window losing focus.
 *
 * Two signals, because neither alone is sufficient:
 * - `visibilitychange` fires when the document is hidden (tab switch, another
 *   window minimised, screen lock). It is the reliable one.
 * - `blur` on `window` also fires when devtools are docked or opened in a
 *   separate window, which `visibilitychange` does not report.
 *
 * Neither can be trusted as a security control. Both are trivially defeated by
 * disabling JavaScript, and both produce false positives (an OS dialog, a
 * password manager, a notification). They are recorded as signals for a human to
 * review, which is stated in the exam UI as well.
 *
 * Listener cleanup is exact: the handlers are removed on unmount and whenever
 * `enabled` flips, so a long exam session does not accumulate listeners and a
 * re-enabled monitor never double-reports the same event.
 */

export type FocusViolation = 'TAB_HIDDEN' | 'WINDOW_BLUR'

export interface TabFocusMonitorOptions {
  /** Monitoring is off while false, e.g. before the exam actually opens. */
  enabled: boolean
  /** Called once per violation, with the signal that produced it. */
  onViolation: (violation: FocusViolation) => void
  /**
   * Grace period in ms after a re-focus during which a further violation is
   * ignored. Switching to a calculator and back produces a blur/focus pair; a
   * short window keeps that from reading as a second offence.
   */
  cooldownMs?: number
  /** Suppresses the *first* blur, which some browsers fire spuriously on load. */
  skipFirstBlur?: boolean
}

export function useTabFocusMonitor({
  enabled,
  onViolation,
  cooldownMs = 1000,
  skipFirstBlur = true,
}: TabFocusMonitorOptions): void {
  // The callback is read through a ref so a caller can pass an inline arrow
  // function without re-subscribing the listeners on every render.
  const onViolationRef = useRef(onViolation)
  useEffect(() => {
    onViolationRef.current = onViolation
  }, [onViolation])

  const lastReportRef = useRef(0)
  const blurSeenRef = useRef(false)

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return

    const report = (violation: FocusViolation) => {
      const now = Date.now()
      // The cooldown is compared against the last report, not the last event, so
      // a hide followed quickly by a blur (switching windows does both) is one
      // report rather than two.
      if (now - lastReportRef.current < cooldownMs) return
      lastReportRef.current = now
      onViolationRef.current(violation)
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') report('TAB_HIDDEN')
    }

    const handleBlur = () => {
      if (skipFirstBlur && !blurSeenRef.current) {
        blurSeenRef.current = true
        return
      }
      report('WINDOW_BLUR')
    }

    const handleFocus = () => {
      // Focus returning is not itself a violation, but it resets the
      // first-blur suppression so a later genuine blur is still reported.
      blurSeenRef.current = true
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('focus', handleFocus)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('focus', handleFocus)
      lastReportRef.current = 0
      blurSeenRef.current = false
    }
  }, [enabled, cooldownMs, skipFirstBlur])
}
