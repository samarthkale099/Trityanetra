import { Request, Response, NextFunction } from 'express';
import { saveAnswerService, submitExamService } from './submission.service';

export const saveAnswer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { testId, answers } = req.body;
    const userId = req.user?.uid;
    
    if (!testId || !userId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await saveAnswerService(testId, userId, answers);

    res.status(200).json({ message: 'Answers saved successfully' });
  } catch (error) {
    next(error);
  }
};

export const submitExam = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { testId, answers } = req.body;
    const userId = req.user?.uid;
    
    if (!testId || !userId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await submitExamService(testId, userId, answers);

    res.status(200).json({ message: 'Exam submitted successfully' });
  } catch (error: any) {
    if (error.message === 'ALREADY_SUBMITTED') {
      // Idempotent response for duplicate requests
      return res.status(200).json({ message: 'Exam already submitted (Idempotent response)' });
    }
    next(error);
  }
};
