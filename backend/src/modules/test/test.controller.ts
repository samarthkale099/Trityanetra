import { Request, Response, NextFunction } from 'express';
import {
  createTestService,
  getTestsService,
  enterTestService
} from './test.service';

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
