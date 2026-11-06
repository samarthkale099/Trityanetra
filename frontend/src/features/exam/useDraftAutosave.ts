import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Autosaves the editor contents to local storage so a refresh, a crash, or an
 * accidental tab close does not cost the student their work.
 *
 * Debounced because typing is continuous: writing on every keystroke would mean
 * a synchronous serialise-and-write per character, which is exactly the kind of
 * jank that makes an editor feel broken. The trailing write fires once typing
 * pauses.
 *
 * Drafts are namespaced by user, test *and question*, so a shared machine cannot
 * leak one student's answer to another, a new attempt for the same test is not
 * silently restored over, and moving between questions cannot carry question 1's
 * code into question 2.
 *
 * Nothing here is treated as the submission: it is a convenience buffer, and the
 * server copy is the only record that counts.
 */

const DEBOUNCE_MS = 800

export interface DraftKey {
  testId: string
  userId: string
  /** Question id. Two questions in one test are two separate drafts. */
  questionId: string
}

function storageKey({ testId, userId, questionId }: DraftKey): string {
  return `trityanetra.draft.${userId}.${testId}.${questionId}`
}

function readDraft(path: string): string | null {
  try {
    const draft = window.localStorage.getItem(path)
    return draft !== null && draft.length > 0 ? draft : null
  } catch {
    // Storage blocked (private mode, quota). Autosave is a convenience, so this
    // is not worth surfacing to a student mid-exam.
    return null
  }
}

function writeDraft(path: string, value: string): boolean {
  try {
    window.localStorage.setItem(path, value)
    return true
  } catch {
    // Storage full or blocked. The exam continues.
    return false
  }
}

function removeDraft(path: string): void {
  try {
    window.localStorage.removeItem(path)
  } catch {
    /* Best effort. */
  }
}

export interface DraftAutosave {
  /** Restored value, or null when there is no draft for this question. */
  restored: string | null
  /** True once a draft has been written this session. */
  savedAt: number | null
  clear: () => void
  flush: () => void
}

/** The most recent value written, or awaiting a write, for one key. */
interface PendingDraft {
  keyString: string
  path: string
  value: string
  initialValue: string
}

/** Reads one question's saved draft without the hook (e.g. at submit time). */
export function readDraftFor(key: DraftKey): string | null {
  return readDraft(storageKey(key))
}

/** Removes one question's saved draft (after a successful submit). */
export function clearDraftFor(key: DraftKey): void {
  removeDraft(storageKey(key))
}

export function useDraftAutosave(
  key: DraftKey | null,
  value: string,
  initialValue: string,
): DraftAutosave {
  const [savedAt, setSavedAt] = useState<number | null>(null)
  // Restored once per key, not per value: re-running it on every keystroke would
  // reset the cursor with the autosave's own write.
  const [restored, setRestored] = useState<string | null>(null)

  /*
   * Effects below depend on this string, never on the `key` object. The caller
   * builds a fresh object literal on every render, so depending on it would tear
   * down and re-create the debounce timer on every render, and the unmount
   * effect would rewrite storage each time.
   */
  const keyString = key ? `${key.userId}:${key.testId}:${key.questionId}` : null
  const path = key ? storageKey(key) : null

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<PendingDraft | null>(null)

  const writePending = useCallback((entry: PendingDraft | null) => {
    if (!entry) return
    if (entry.value === entry.initialValue) {
      // Unchanged from the starter code: drop the draft rather than keeping a
      // copy of content the student never wrote.
      removeDraft(entry.path)
    } else if (!writeDraft(entry.path, entry.value)) {
      // Storage blocked or full. Nothing was saved, so `savedAt` must not claim
      // otherwise, and the student carries on to submit from memory.
      return
    }
    setSavedAt(Date.now())
  }, [])

  /*
   * Flush the outgoing question's draft before reading the incoming one, so
   * switching questions cannot lose the last few seconds of typing.
   *
   * This effect must be declared BEFORE the effect that refreshes
   * `pendingRef` (see below): React runs the new render function first and only
   * then the previous effects' cleanups, so a render-time assignment would
   * already have overwritten the outgoing question's value by the time this ran.
   */
  useEffect(() => {
    const previous = pendingRef.current
    if (keyString && previous && previous.keyString !== keyString) writePending(previous)
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setRestored(path === null ? null : readDraft(path))
    // `keyString` and `path` are derived from `key`; depending on the key string
    // is what makes this run once per key rather than once per render.
  }, [keyString, path, writePending])

  // Trailing debounce. Value-equality on the starter code short-circuits, so an
  // untouched question never writes a copy of its own starter code.
  useEffect(() => {
    if (!keyString || !path || value === initialValue) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      writePending(pendingRef.current)
    }, DEBOUNCE_MS)
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [keyString, path, value, initialValue, writePending])

  /*
   * Keeps the value a write would use in step with the latest render.
   *
   * Declared last on purpose. It is the only writer of `pendingRef`, and the
   * flush above has to read the *previous* question's entry first, so it may not
   * run until the flush has already had its turn.
   */
  useEffect(() => {
    pendingRef.current = keyString && path ? { keyString, path, value, initialValue } : null
  }, [keyString, path, value, initialValue])

  // Written on unmount as well, so leaving the exam inside the debounce window
  // does not lose the last few seconds of typing.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      writePending(pendingRef.current)
    }
  }, [writePending])

  const clear = useCallback(() => {
    if (!path) return
    removeDraft(path)
    pendingRef.current = null
    setSavedAt(null)
  }, [path])

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    writePending(pendingRef.current)
  }, [writePending])

  return { restored, savedAt, clear, flush }
}

/** Test-only helper. */
export function draftKeyFor(key: DraftKey): string {
  return storageKey(key)
}
