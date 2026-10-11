import admin from '../../db/firebase';
import { COLLECTIONS } from '../../db/collections';
import { db } from '../../db/firestore';

// A submission in one of these states is final: nothing may write to it or downgrade it.
export const LOCKED_SUBMISSION_STATUSES = ['SUBMITTED', 'FINALIZED'];

export const isSubmissionLocked = (status: unknown) =>
  typeof status === 'string' && LOCKED_SUBMISSION_STATUSES.includes(status);

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
    
    t.set(submissionRef, {
      testId,
      studentId: userId,
      answers: answers || (doc.exists ? doc.data()?.answers : {}),
      status: 'SUBMITTED',
      submittedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
};
