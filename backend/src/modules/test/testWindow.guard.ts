import { Request, Response, NextFunction } from 'express';
import admin from '../../db/firebase';
import { COLLECTIONS } from '../../db/collections';
import { db } from '../../db/firestore';
export const testWindowGuard = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const testId = req.params.testId || req.body.testId || req.query.testId;
    if (!testId) {
      return res.status(400).json({ error: 'Bad Request: Missing testId' });
    }

    const testDoc = await db.collection(COLLECTIONS.TESTS).doc(testId).get();
    if (!testDoc.exists) return res.status(404).json({ error: 'Test not found' });
    const test = testDoc.data();
    
    // Use server time
    const now = admin.firestore.Timestamp.now().toDate();
    
    const startTime = test?.startTime?.toDate ? test.startTime.toDate() : new Date(test?.startTime);
    const endTime = test?.endTime?.toDate ? test.endTime.toDate() : new Date(test?.endTime);

    if (now < startTime) {
      return res.status(403).json({ error: 'Forbidden: Test has not started yet' });
    }

    if (now > endTime) {
      return res.status(403).json({ error: 'Forbidden: Test has already ended' });
    }

    next();
  } catch (error) {
    return res.status(500).json({ error: 'Internal Server Error checking test window' });
  }
};
