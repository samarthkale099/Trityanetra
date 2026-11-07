import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { draftKeyFor, useDraftAutosave, type DraftKey } from './useDraftAutosave'

const KEY: DraftKey = { testId: 'test-1', userId: 'u-1', questionId: 'q-1' }
const OTHER_QUESTION: DraftKey = { testId: 'test-1', userId: 'u-1', questionId: 'q-2' }
const STARTER = 'function f() {}'

describe('useDraftAutosave', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    window.localStorage.clear()
  })

  it('writes a draft once typing pauses', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDraftAutosave(KEY, value, STARTER),
      { initialProps: { value: STARTER } },
    )

    rerender({ value: 'function f() { return 1 }' })
    act(() => {
      vi.advanceTimersByTime(800)
    })

    expect(window.localStorage.getItem(draftKeyFor(KEY))).toBe('function f() { return 1 }')
    expect(result.current.savedAt).not.toBeNull()
  })

  it('does not store a copy of the untouched starter code', () => {
    renderHook(() => useDraftAutosave(KEY, STARTER, STARTER))
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(window.localStorage.getItem(draftKeyFor(KEY))).toBeNull()
  })

  /*
   * Regression: switching questions used to lose the outgoing answer.
   *
   * The pending value was tracked in a ref assigned *during render*, but React
   * runs the next render before the previous effects' cleanups. The flush on key
   * change therefore read the incoming question's entry, compared it against
   * itself, and wrote nothing -- while the debounce cleanup dropped the pending
   * timer. Anything typed in the last 800 ms of question 1 was gone.
   */
  it('flushes the outgoing question when the key changes inside the debounce window', () => {
    const { rerender } = renderHook(
      ({ key, value }) => useDraftAutosave(key, value, STARTER),
      { initialProps: { key: KEY, value: STARTER } },
    )

    // Type, then switch question before the 800 ms trailing write fires.
    rerender({ key: KEY, value: 'question one answer' })
    vi.advanceTimersByTime(200)
    rerender({ key: OTHER_QUESTION, value: STARTER })

    expect(window.localStorage.getItem(draftKeyFor(KEY))).toBe('question one answer')
    // The incoming question has nothing typed yet, so it gets no draft at all.
    expect(window.localStorage.getItem(draftKeyFor(OTHER_QUESTION))).toBeNull()
  })

  it('namespaces drafts per question, per test and per user', () => {
    const { rerender } = renderHook(
      ({ key, value }) => useDraftAutosave(key, value, STARTER),
      { initialProps: { key: KEY, value: 'q1' } },
    )
    act(() => {
      vi.advanceTimersByTime(800)
    })

    rerender({ key: OTHER_QUESTION, value: 'q2' })
    act(() => {
      vi.advanceTimersByTime(800)
    })

    const third = { testId: 'test-1', userId: 'u-2', questionId: 'q-1' }
    rerender({ key: third, value: 'other user' })
    act(() => {
      vi.advanceTimersByTime(800)
    })

    expect(window.localStorage.getItem(draftKeyFor(KEY))).toBe('q1')
    expect(window.localStorage.getItem(draftKeyFor(OTHER_QUESTION))).toBe('q2')
    expect(window.localStorage.getItem(draftKeyFor(third))).toBe('other user')
  })

  it('restores an existing draft when the key changes', () => {
    window.localStorage.setItem(draftKeyFor(OTHER_QUESTION), 'saved earlier')
    const { result } = renderHook(() => useDraftAutosave(OTHER_QUESTION, STARTER, STARTER))
    expect(result.current.restored).toBe('saved earlier')
  })

  it('writes on unmount so leaving mid-debounce keeps the draft', () => {
    const { unmount } = renderHook(() => useDraftAutosave(KEY, 'typed then left', STARTER))
    unmount()
    expect(window.localStorage.getItem(draftKeyFor(KEY))).toBe('typed then left')
  })

  it('clears the draft on request and no longer restores it', () => {
    window.localStorage.setItem(draftKeyFor(KEY), 'to be discarded')
    const { result } = renderHook(() => useDraftAutosave(KEY, 'to be discarded', STARTER))
    act(() => {
      result.current.clear()
    })
    expect(window.localStorage.getItem(draftKeyFor(KEY))).toBeNull()
  })

  it('does nothing when there is no key', () => {
    const { result } = renderHook(() => useDraftAutosave(null, 'no key', STARTER))
    act(() => {
      result.current.flush()
    })
    expect(window.localStorage.length).toBe(0)
  })
})
