import admin from '../../db/firebase';
import { COLLECTIONS } from '../../db/collections';
import { db } from '../../db/firestore';
import { attemptDeadline } from '../test/test.service';

// A submission in one of these states is final: nothing may write to it or downgrade it.
export const LOCKED_SUBMISSION_STATUSES = ['SUBMITTED', 'FINALIZED'];

export const isSubmissionLocked = (status: unknown) =>
  typeof status === 'string' && LOCKED_SUBMISSION_STATUSES.includes(status);

/** Network slack after a personal deadline, so an on-time click is not refused in transit. */
export const DEADLINE_GRACE_MS = 30_000;

/**
 * Refuses a write after the student's personal time allowance has run out.
 * The allowance starts when they first entered the exam (`attempts`), so it is
 * enforced here on the server -- a student cannot extend it by changing their
 * device clock or reloading. A student who never entered has no attempt; the
 * test-window guard still bounds them.
 */
const assertWithinAllowance = async (
  t: FirebaseFirestore.Transaction,
  testId: string,
  userId: string
) => {
  const attempt = await t.get(db.collection(COLLECTIONS.ATTEMPTS).doc(`${testId}_${userId}`));
  if (!attempt.exists || !attempt.data()?.startedAt) return;
  const test = await t.get(db.collection(COLLECTIONS.TESTS).doc(testId));
  if (!test.exists) return;
  const deadline = attemptDeadline(test.data()!, attempt.data()!.startedAt.toDate());
  if (Date.now() > deadline.getTime() + DEADLINE_GRACE_MS) {
    const error: any = new Error('Forbidden: Your time for this test is over');
    error.status = 403;
    throw error;
  }
};

export const saveAnswerService = async (testId: string, userId: string, answers: any) => {
  const submissionId = `${testId}_${userId}`;
  const submissionRef = db.collection(COLLECTIONS.SUBMISSIONS).doc(submissionId);

  // Read-check-write in one transaction so a save racing a submit can never flip
  // a SUBMITTED/FINALIZED record back to DRAFT (the route guard alone is not atomic).
  await db.runTransaction(async (t) => {
    const doc = await t.get(submissionRef);
    if (doc.exists && isSubmissionLocked(doc.data()?.status)) {
      const error: any = new Error('Forbidden: Submission is locked and cannot be modified');
      error.status = 403;
      throw error;
    }
    await assertWithinAllowance(t, testId, userId);

    t.set(submissionRef, {
      testId,
      studentId: userId,
      answers,
      status: 'DRAFT',
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
};

export const submitExamService = async (testId: string, userId: string, answers: any) => {
  const submissionId = `${testId}_${userId}`; // Enforces 1 submission per test+student
  const submissionRef = db.collection(COLLECTIONS.SUBMISSIONS).doc(submissionId);
  
  // CRITICAL: The entire transaction is kept perfectly atomic here.
  await db.runTransaction(async (t) => {
    const doc = await t.get(submissionRef);
    if (doc.exists && isSubmissionLocked(doc.data()?.status)) {
      throw new Error('ALREADY_SUBMITTED');
    }
    await assertWithinAllowance(t, testId, userId);

    t.set(submissionRef, {
      testId,
      studentId: userId,
      answers: answers || (doc.exists ? doc.data()?.answers : {}),
      status: 'SUBMITTED',
      submittedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
};
