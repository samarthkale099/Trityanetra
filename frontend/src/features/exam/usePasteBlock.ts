import { useEffect, useRef } from 'react'

/**
 * Blocks paste and drop into the exam, so an answer cannot be brought in from
 * outside the editor.
 *
 * A DOM-level `paste` listener is used rather than a React handler on one
 * element. The exam contains several editable surfaces (the editor, question
 * navigation, a question list) and Monaco renders its own textarea, so a handler
 * bound to a single node would leave gaps. A capture-phase listener on the
 * document sees the event before any target can act on it, and
 * `preventDefault` there is what actually stops the insertion.
 *
 * Limitation worth stating: this is client-side, so it stops an accidental or
 * casual paste and nothing more. A student who wants to paste can dispatch a
 * synthetic event or edit the DOM directly. The recorded `PASTE_ATTEMPT` event
 * is the part with any value.
 */

export interface PasteBlockOptions {
  enabled: boolean
  /** Called once per blocked attempt, for telemetry. */
  onBlocked?: (kind: 'paste' | 'drop') => void
  /** Shown to the student so the block is not silent. */
  message?: string
}

export function usePasteBlock({
  enabled,
  onBlocked,
  message = 'Pasting is disabled during this exam. Type your solution instead.',
}: PasteBlockOptions): void {
  const onBlockedRef = useRef(onBlocked)
  useEffect(() => {
    onBlockedRef.current = onBlocked
  }, [onBlocked])

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return

    let lastNotice = 0
    const notice = (kind: 'paste' | 'drop') => {
      onBlockedRef.current?.(kind)
      // Rate-limited: holding Ctrl+V fires a stream of paste events, and one
      // toast per event would bury the screen.
      const now = Date.now()
      if (now - lastNotice > 2000) {
        lastNotice = now
        if (typeof window !== 'undefined' && 'dispatchEvent' in window) {
          window.dispatchEvent(new CustomEvent('trityanetra:paste-blocked', { detail: { message } }))
        }
      }
    }

    const handlePaste = (event: ClipboardEvent) => {
      event.preventDefault()
      notice('paste')
    }
    const handleDrop = (event: DragEvent) => {
      event.preventDefault()
      notice('drop')
    }

    // Capture phase: runs before the target's own handler, so the text never
    // reaches the textarea or Monaco's model.
    document.addEventListener('paste', handlePaste, true)
    document.addEventListener('drop', handleDrop, true)

    return () => {
      document.removeEventListener('paste', handlePaste, true)
      document.removeEventListener('drop', handleDrop, true)
    }
  }, [enabled, message])
}
