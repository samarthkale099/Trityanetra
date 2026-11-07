import { useEffect, useRef } from 'react'

/**
 * Heuristic detector for an open developer-tools panel.
 *
 * The classic trick: docking devtools shrinks the viewport, so a wide gap between
 * `window.outerWidth - window.innerWidth` (or the height equivalent) suggests
 * tools are taking up screen space. It is a guess, and a deliberately unreliable
 * one:
 *
 * - A maximised browser on a small screen produces a similar gap.
 * - Un-docked devtools changes nothing, so it is not detected at all.
 * - Any page that legitimately resizes can trigger it.
 *
 * It is included because it catches the common docked case cheaply, and the
 * report says plainly that it is a heuristic. It must never be used to deny
 * access or fail a submission: a false positive that blocks a student's exam is
 * far worse than a missed detection, so this only emits a signal.
 */

export interface DevToolsDetectorOptions {
  enabled: boolean
  /** Receives the measured gap in pixels when tools appear to be open. */
  onDetected: (thresholdPx: number) => void
  /**
   * Pixels of unexplained outer/inner size difference before reporting.
   * ~160px is roughly a docked panel at default width, comfortably above the
   * scrollbar and OS-chrome noise.
   */
  thresholdPx?: number
  /** How often to measure. Cheap, but there is no reason to do it per frame. */
  intervalMs?: number
}

export function useDevToolsDetector({
  enabled,
  onDetected,
  thresholdPx = 160,
  intervalMs = 1000,
}: DevToolsDetectorOptions): void {
  const onDetectedRef = useRef(onDetected)
  useEffect(() => {
    onDetectedRef.current = onDetected
  }, [onDetected])

  // Latched until the gap closes, so a single docked panel produces one report
  // per open/close cycle rather than one per interval.
  const reportedRef = useRef(false)

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return

    const measure = () => {
      const widthGap = window.outerWidth - window.innerWidth
      const heightGap = window.outerHeight - window.innerHeight
      const gap = Math.max(widthGap, heightGap)

      if (gap >= thresholdPx) {
        if (!reportedRef.current) {
          reportedRef.current = true
          onDetectedRef.current(gap)
        }
        return
      }
      reportedRef.current = false
    }

    measure()
    const timer = setInterval(measure, Math.max(intervalMs, 250))
    return () => {
      clearInterval(timer)
      reportedRef.current = false
    }
  }, [enabled, thresholdPx, intervalMs])
}
