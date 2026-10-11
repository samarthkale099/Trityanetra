import { Request, Response, NextFunction } from 'express';
import { COLLECTIONS } from '../../db/collections';
import { db } from '../../db/firestore';
import { isSubmissionLocked } from './submission.service';
export const submissionLockGuard = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const testId = req.params.testId || req.body.testId;
    const userId = req.user?.uid;

    if (!testId || !userId) {
      return res.status(400).json({ error: 'Bad Request: Missing testId or user identity' });
    }

    const submissionId = `${testId}_${userId}`; // Composite ID enforcing 1-to-1

    const submissionDoc = await db.collection(COLLECTIONS.SUBMISSIONS).doc(submissionId).get();
    
    const isSubmitted = submissionDoc.exists && isSubmissionLocked(submissionDoc.data()?.status);

    if (isSubmitted) {
      return res.status(403).json({ error: 'Forbidden: Submission is locked and cannot be modified' });
    }

    next();
  } catch (error) {
    return res.status(500).json({ error: 'Internal Server Error checking submission lock' });
  }
};
