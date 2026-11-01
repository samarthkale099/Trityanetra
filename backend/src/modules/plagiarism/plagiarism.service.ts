import * as admin from 'firebase-admin';
import { enqueuePlagiarismCheck } from './plagiarism.queue';
import { COLLECTIONS } from '../../db/collections';

export enum PlagiarismStatus {
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}

export const getPlagiarismStatus = async (testId: string) => {
  const db = admin.firestore();
  const doc = await db.collection(COLLECTIONS.PLAGIARISM_RESULTS).doc(testId).get();

  if (!doc.exists) {
    return { status: null };
  }
  return withStudentNames(testId, doc.data()!);
};

/**
 * Attaches each student's id, name and email to the stored pairs. Submission
 * ids are `${testId}_${studentId}`, so the student is recovered from the id
 * rather than trusted from the engine's output. Timestamps become ISO strings.
 */
const withStudentNames = async (
  testId: string,
  result: FirebaseFirestore.DocumentData
): Promise<Record<string, any>> => {
  const db = admin.firestore();
  const studentOf = (submissionId: string) =>
    submissionId.startsWith(`${testId}_`) ? submissionId.slice(testId.length + 1) : submissionId;

  const pairs: any[] = Array.isArray(result.pairs) ? result.pairs : [];
  const flagged: any[] = Array.isArray(result.flagged) ? result.flagged : [];
  const studentIds = [
    ...new Set([...pairs, ...flagged].flatMap((pair) => [studentOf(pair.submissionA), studentOf(pair.submissionB)])),
  ];
  const profiles = studentIds.length
    ? await db.getAll(...studentIds.map((uid) => db.collection(COLLECTIONS.USERS).doc(uid)))
    : [];
  const people = new Map(
    studentIds.map((uid, index) => {
      const profile = profiles[index]?.exists ? profiles[index].data()! : {};
      return [uid, { id: uid, name: profile.displayName ?? profile.email ?? uid, email: profile.email ?? '' }];
    })
  );
  const named = (pair: any) => ({
    ...pair,
    studentA: people.get(studentOf(pair.submissionA)),
    studentB: people.get(studentOf(pair.submissionB)),
  });
  const iso = (value: any) => (value?.toDate ? value.toDate().toISOString() : value ?? null);

  return {
    ...result,
    createdAt: iso(result.createdAt),
    updatedAt: iso(result.updatedAt),
    pairs: pairs.map(named),
    flagged: flagged.map(named),
  };
};

export const triggerPlagiarismCheck = async (testId: string) => {
  const db = admin.firestore();
  const docRef = db.collection(COLLECTIONS.PLAGIARISM_RESULTS).doc(testId);
  
  const doc = await docRef.get();
  if (!doc.exists) {
    await docRef.set({
      status: PlagiarismStatus.QUEUED,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } else {
    await docRef.set({
      status: PlagiarismStatus.QUEUED,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }

  await enqueuePlagiarismCheck(testId);
};
