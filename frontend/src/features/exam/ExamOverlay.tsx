import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { EyeOff, ShieldAlert } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { reportMonitorEvent, type MonitorContext } from '@/features/exam/monitorApi'
import { cn } from '@/shared/lib/cn'

/**
 * Blocking overlay shown when the student leaves the exam.
 *
 * It counts the violations and requires an explicit acknowledgement before the
 * exam is usable again, so a violation cannot scroll past unnoticed. Each one is
 * reported to the backend (or queued locally if the endpoint is absent) at the
 * moment it happens rather than when the overlay is dismissed, so a browser
 * crash right after a violation still leaves a record.
 *
 * The overlay is a `role="alertdialog"` with `aria-modal`, focus moved into it on
 * open and trapped while it is up, so a keyboard user cannot tab into the exam
 * behind it and a screen reader announces the interruption.
 */

export type ViolationKind = 'TAB_HIDDEN' | 'WINDOW_BLUR' | 'FULLSCREEN_EXIT' | 'DEVTOOLS_OPEN' | 'PASTE_ATTEMPT'

export interface ExamOverlayProps {
  open: boolean
  kind: ViolationKind
  /** 1-based count of violations in this attempt. */
  count: number
  context: MonitorContext
  onAcknowledge: () => void
  children?: ReactNode
}

const TITLES: Record<ViolationKind, string> = {
  TAB_HIDDEN: 'You switched away from the exam',
  WINDOW_BLUR: 'The exam window lost focus',
  FULLSCREEN_EXIT: 'You left fullscreen',
  DEVTOOLS_OPEN: 'Developer tools appear to be open',
  PASTE_ATTEMPT: 'Pasting is disabled',
}

const BODIES: Record<ViolationKind, string> = {
  TAB_HIDDEN: 'This exam must stay in the foreground. The switch has been recorded against your attempt.',
  WINDOW_BLUR: 'Another window took focus. This has been recorded against your attempt.',
  FULLSCREEN_EXIT: 'Exams run in fullscreen. This has been recorded against your attempt.',
  DEVTOOLS_OPEN: 'This looks like a docked developer-tools panel. It has been recorded against your attempt.',
  PASTE_ATTEMPT: 'Type your answer rather than pasting it. The attempt has been recorded.',
}

export function ExamOverlay({
  open,
  kind,
  count,
  context,
  onAcknowledge,
  children,
}: ExamOverlayProps) {
  const acknowledgeRef = useRef<HTMLButtonElement | null>(null)
  const [reportedKind, setReportedKind] = useState<string | null>(null)

  // Report exactly once per violation. Keyed on the kind *and* the count, so a
  // second fullscreen exit of the same kind is still reported even though the
  // kind alone would have been unchanged. This component is the only reporting
  // site for overlay-visible violations; the detectors just set state, so an
  // event can never be logged twice.
  useEffect(() => {
    if (!open) return
    const key = `${kind}:${count}`
    if (reportedKind === key) return
    setReportedKind(key)
    void reportMonitorEvent(context, kind)
  }, [open, kind, count, context, reportedKind])

  // Move focus into the dialog so the interruption is announced and the student
  // is not left tabbing through the editor behind it.
  useEffect(() => {
    if (open) acknowledgeRef.current?.focus()
  }, [open])

  // Simple focus trap: Tab and Shift+Tab cycle within the dialog.
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const focusable = acknowledgeRef.current
      if (!focusable) return
      event.preventDefault()
      focusable.focus()
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [open])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="exam-overlay"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-strong/70 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="exam-overlay-title"
            aria-describedby="exam-overlay-body"
            className={cn(
              'w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-overlay',
            )}
            initial={{ scale: 0.97, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.97, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="flex items-center gap-2.5">
              {/* Soft danger well. The danger ramp only exposes `DEFAULT` and
                  `soft`, so there is no `danger-100` step to ring with here. */}
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-danger-soft">
                <ShieldAlert className="h-5 w-5 text-danger" aria-hidden="true" />
              </span>
              <span className="text-sm font-semibold text-danger">Violation {count}</span>
            </div>
            <h2 id="exam-overlay-title" className="mt-3 text-xl font-semibold text-ink-strong">
              {TITLES[kind]}
            </h2>
            <p id="exam-overlay-body" className="mt-2 text-sm text-ink">
              {BODIES[kind]}
            </p>
            {children ? <div className="mt-4">{children}</div> : null}
            <Button ref={acknowledgeRef} className="mt-6 w-full" onClick={onAcknowledge}>
              <EyeOff className="h-4 w-4" aria-hidden="true" />
              Return to exam
            </Button>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
