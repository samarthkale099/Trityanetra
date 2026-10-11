import { Request, Response, NextFunction } from 'express';
import { 
  createTestService, 
  getTestsService, 
  enterTestService 
} from './test.service';

export const createTest = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, classroomId, startTime, endTime, questions = [] } = req.body;
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const data = await createTestService(title, classroomId, startTime, endTime, questions, user);

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
    const requesterCollegeId = req.user?.collegeId;
    
    const data = await enterTestService(testId, requesterCollegeId);
    
    res.status(200).json({ message: 'Entered exam successfully', data });
  } catch (error) {
    next(error);
  }
};
