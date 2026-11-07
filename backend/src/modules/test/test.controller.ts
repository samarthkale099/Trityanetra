import { Request, Response, NextFunction } from 'express';
import {
  createTestService,
  getTestsService,
  enterTestService,
  releaseResultsService,
  getLobbyService,
} from './test.service';

/** Student: the lobby (no questions, timer not started). */
export const getLobby = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await getLobbyService(req.params.testId, req.user!);
    res.status(200).json({ data });
  } catch (error) {
    next(error);
  }
};
import { getStudentResultService } from '../submission/submission.service';

/** Teacher: release marks and comments for a test (idempotent). */
export const releaseResults = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await releaseResultsService(req.params.testId, req.user!);
    res.status(200).json({ message: 'Results released', data });
  } catch (error) {
    next(error);
  }
};

/** Student: their own result for a test. */
export const getMyResult = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await getStudentResultService(req.params.testId, req.user!);
    res.status(200).json({ data });
  } catch (error) {
    next(error);
  }
};

export const createTest = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, classroomId, startTime, endTime, questions = [], durationMinutes, instructions, language } = req.body;
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const data = await createTestService(title, classroomId, startTime, endTime, questions, user, {
      durationMinutes: typeof durationMinutes === 'number' ? durationMinutes : undefined,
      instructions: typeof instructions === 'string' ? instructions : undefined,
      language: typeof language === 'string' ? language : undefined,
    });

    res.status(201).json({ message: 'Test created successfully', data });
  } catch (error) {
    next(error);
  }
};

export const getTests = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const data = await getTestsService(user);

    res.status(200).json({ data });
  } catch (error) {
    next(error);
  }
};

export const enterTest = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const testId = req.params.testId;

    // Returns the test with hidden test cases masked, the server time, the
    // latched start time and personal deadline, and any saved draft.
    const data = await enterTestService(testId, req.user!);

    res.status(200).json({ message: 'Entered exam successfully', data });
  } catch (error) {
    next(error);
  }
};
