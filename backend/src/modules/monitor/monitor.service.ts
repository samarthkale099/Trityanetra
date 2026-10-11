import * as admin from 'firebase-admin';
import { COLLECTIONS } from '../../db/collections';

export enum MonitorFlagType {
  TAB_SWITCH = 'TAB_SWITCH',
  DEVTOOLS_OPEN = 'DEVTOOLS_OPEN',
  PASTE_ATTEMPT = 'PASTE_ATTEMPT',
  FULLSCREEN_EXIT = 'FULLSCREEN_EXIT'
}

/**
 * EXPLICIT WARNING: Flags are advisory only.
 * No code path here should auto-fail, auto-terminate, or auto-flag-as-plagiarism
 * a submission based on monitoring signals alone. Do not add auto-punishment logic.
 */
export const submitFlagService = async (
  testId: string,
  studentId: string,
  flagType: MonitorFlagType,
  metadata?: any
) => {
  const db = admin.firestore();
  await db.collection(COLLECTIONS.MONITOR_FLAGS).add({
    testId,
    studentId,
    flagType,
    metadata: metadata || {},
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
};
