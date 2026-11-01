import { useEffect, useState } from 'react'

/**
 * A clock that re-renders on an interval.
 *
 * Countdowns and window status have to change without a user action, which means
 * something has to tick. The interval is only created while a component is
 * mounted and is always cleared on unmount, so a page that navigates away does
 * not leave a timer running.
 *
 * `intervalMs` below roughly one second is refused: a sub-second countdown
 * re-renders a list far faster than anyone can read, which is pure wasted work.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const safeInterval = Math.max(intervalMs, 250)
    const timer = setInterval(() => setNow(Date.now()), safeInterval)
    return () => clearInterval(timer)
  }, [intervalMs])

  return now
}
