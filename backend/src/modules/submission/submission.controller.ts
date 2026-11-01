import { Request, Response, NextFunction } from 'express';
import {
  saveAnswerService,
  submitExamService,
  listSubmissionsForTestService,
  getSubmissionForReviewService,
  saveReviewService,
} from './submission.service';

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

/** Teacher: every rostered student's submission state, marks and flags for a test. */
export const listSubmissionsForTest = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await listSubmissionsForTestService(req.params.testId, req.user!);
    res.status(200).json({ data });
  } catch (error) {
    next(error);
  }
};

/** Teacher: one student's submission for grading. */
export const getSubmissionForReview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await getSubmissionForReviewService(req.params.testId, req.params.studentId, req.user!);
    res.status(200).json({ data });
  } catch (error) {
    next(error);
  }
};

/** Teacher: save marks and a comment (locked once results are released). */
export const saveReview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await saveReviewService(
      req.params.testId,
      req.params.studentId,
      { marks: req.body?.marks, comment: req.body?.comment },
      req.user!
    );
    res.status(200).json({ message: 'Review saved', data });
  } catch (error) {
    next(error);
  }
};
