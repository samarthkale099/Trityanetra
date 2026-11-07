import { useEffect, useState } from 'react'

/**
 * Trailing debounce for a value.
 *
 * Used by the classroom and test search boxes. The delay is long enough that a
 * fast typist sends one query, and short enough that the list does not feel
 * stuck. The timer is always cleared, including when the input unmounts
 * mid-flight, so a pending update cannot land on a gone component.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
