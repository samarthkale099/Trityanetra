import { getFirestore } from '../../db/firestore';
import { COLLECTIONS } from '../../config/constants';

function toMillis(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === 'object' && typeof (value as any).toMillis === 'function') {
    return (value as any).toMillis();
  }
  if (typeof value === 'object' && typeof (value as any).seconds === 'number') {
    return (value as any).seconds * 1000;
  }
  return null;
}

export class TestWindowGuard {
  /**
   * Returns true when creating/working on a submission for `testId` is
   * allowed at `serverTime` (defaults to now).
   *
   * Reads the test document's time window (`startTime`/`endTime`, or
   * `startsAt`/`endsAt`). Behavior matrix:
   *  - window present  -> allowed only when start <= serverTime <= end
   *  - window absent   -> allowed (Phase 2 behavior: nothing to enforce)
   *  - test doc absent -> allowed (Phase 2 behavior)
   *  - read error      -> allowed + logged (preserves Phase 2 fail-open
   *                       behavior; a transient read error must not lock
   *                       every student out of a live test)
   */
  static async check(testId: string, serverTime?: Date): Promise<boolean> {
    if (!testId) return false;
    const now = (serverTime ?? new Date()).getTime();
    try {
      const doc = await getFirestore()
        .collection(COLLECTIONS.TESTS)
        .doc(testId)
        .get();
      if (!doc.exists) return true;
      const data = doc.data()!;

      const startValue = data.startTime ?? data.startsAt;
      const endValue = data.endTime ?? data.endsAt;
      const start = toMillis(startValue);
      const end = toMillis(endValue);
      if (start === null && end === null) return true;

      if (start !== null && now < start) return false;
      if (end !== null && now > end) return false;
      return true;
    } catch (error) {
      console.error('[TestWindow] Window check failed — allowing (fail open):', error);
      return true;
    }
  }
}
