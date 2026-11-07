import { testStatus, type TestWindow } from '@/features/exam/testWindow'
import { Badge } from '@/shared/components/ui/badge'
import type { TestStatus } from '@/shared/types/classroom'

const STATUS_VARIANT: Record<TestStatus, 'info' | 'success' | 'neutral'> = {
  UPCOMING: 'info',
  LIVE: 'success',
  ENDED: 'neutral',
}

const STATUS_LABEL: Record<TestStatus, string> = {
  UPCOMING: 'Upcoming',
  LIVE: 'Live now',
  ENDED: 'Closed',
}

/**
 * Window status badge shared by the classroom list, the classroom detail, and
 * the test review page.
 *
 * Takes a `TestWindow` rather than a `TestSummary` so a `TestDetail` (which
 * carries the same window fields) can be passed directly without a cast.
 * Status is derived against the local clock; the caller re-renders on a tick
 * when a live countdown matters.
 */
export function TestStatusBadge({
  window,
  nowMs = Date.now(),
}: {
  window: TestWindow
  nowMs?: number
}) {
  const status = testStatus(window, nowMs)
  return (
    // The pulse is decorative only -- the label already says "Live now", so
    // nothing is communicated by the animation alone. It is slow (2s) and never
    // stops, so it is not read as an error blink.
    <Badge
      variant={STATUS_VARIANT[status]}
      dot
      className={status === 'LIVE' ? '[&>span]:animate-violation-pulse' : undefined}
    >
      {STATUS_LABEL[status]}
    </Badge>
  )
}
