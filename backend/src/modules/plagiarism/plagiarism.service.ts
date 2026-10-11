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
  return doc.data();
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
