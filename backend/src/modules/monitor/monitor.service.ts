import * as admin from 'firebase-admin';
import { COLLECTIONS } from '../../db/collections';
import { UserIdentity } from '../../types/roles';
import { loadOwnedTest } from '../test/test.service';
import { MonitorFlagType, MonitorFlagEntry, StudentFlagSummary } from './monitor.types';

// Re-exported so existing imports from './monitor.service' keep working.
export { MonitorFlagType } from './monitor.types';

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

/**
 * The integrity report for one test: every flag, grouped by student, for the
 * test's teacher (or an admin). Read-only -- flags stay append-only, and this
 * report only informs a human decision.
 */
export const listFlagsForTestService = async (
  testId: string,
  user: UserIdentity
): Promise<{ testId: string; students: StudentFlagSummary[] }> => {
  await loadOwnedTest(testId, user);
  const db = admin.firestore();
  const snapshot = await db.collection(COLLECTIONS.MONITOR_FLAGS).where('testId', '==', testId).get();

  const byStudent = new Map<string, MonitorFlagEntry[]>();
  for (const doc of snapshot.docs) {
    const flag = doc.data();
    const at = flag.timestamp?.toDate ? flag.timestamp.toDate().toISOString() : null;
    const list = byStudent.get(flag.studentId) ?? [];
    list.push({ flagType: flag.flagType, at, metadata: flag.metadata ?? {} });
    byStudent.set(flag.studentId, list);
  }

  const studentIds = [...byStudent.keys()];
  const profiles = studentIds.length
    ? await db.getAll(...studentIds.map((uid) => db.collection(COLLECTIONS.USERS).doc(uid)))
    : [];

  const students = studentIds.map((studentId, index) => {
    const profile = profiles[index]?.exists ? profiles[index].data()! : {};
    const flags = (byStudent.get(studentId) ?? []).sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
    const counts: Partial<Record<MonitorFlagType, number>> = {};
    for (const flag of flags) counts[flag.flagType] = (counts[flag.flagType] ?? 0) + 1;
    return {
      studentId,
      studentName: profile.displayName ?? profile.email ?? studentId,
      studentEmail: profile.email ?? '',
      total: flags.length,
      counts,
      flags,
    };
  });

  students.sort((a, b) => b.total - a.total);
  return { testId, students };
};
