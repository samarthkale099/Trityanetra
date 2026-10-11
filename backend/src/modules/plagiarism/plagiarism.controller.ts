import { Request, Response, NextFunction } from 'express';
import { triggerPlagiarismCheck, getPlagiarismStatus } from './plagiarism.service';
import { db } from '../../db/firestore';
import { COLLECTIONS } from '../../db/collections';
import { Role } from '../../types/roles';

const authorizeTestOwnership = async (testId: string, user: any) => {
  const testDoc = await db.collection(COLLECTIONS.TESTS).doc(testId).get();
  if (!testDoc.exists) {
    const error: any = new Error('Test not found');
    error.status = 404;
    throw error;
  }
  const testData = testDoc.data();
  if (user.collegeId && testData?.collegeId !== user.collegeId) {
    const error: any = new Error('Forbidden: Test belongs to a different college');
    error.status = 403;
    throw error;
  }
  if (testData?.teacherId !== user.uid && user.role !== Role.ADMIN) {
    const error: any = new Error('Forbidden: You do not own this test');
    error.status = 403;
    throw error;
  }
};

export const checkPlagiarism = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { testId } = req.params;
    await authorizeTestOwnership(testId, req.user);
    await triggerPlagiarismCheck(testId);
    res.status(202).json({ message: 'Plagiarism check queued' });
  } catch (error) {
    next(error);
  }
};

export const checkPlagiarismStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { testId } = req.params;
    await authorizeTestOwnership(testId, req.user);
    const status = await getPlagiarismStatus(testId);
    if (!status?.status) {
      res.status(404).json({ error: 'Plagiarism result not found' });
      return;
    }
    res.status(200).json(status);
  } catch (error) {
    next(error);
  }
};
