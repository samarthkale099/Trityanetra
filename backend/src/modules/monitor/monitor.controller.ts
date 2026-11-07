import { Request, Response, NextFunction } from 'express';
import { submitFlagService, listFlagsForTestService, MonitorFlagType } from './monitor.service';

/** Teacher: the integrity report for a test, grouped by student. */
export const listFlags = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await listFlagsForTestService(req.params.testId, req.user!);
    res.status(200).json({ data });
  } catch (error) {
    next(error);
  }
};

export const submitFlag = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { testId } = req.params;
    const studentId = req.user!.uid;
    const { flagType, metadata } = req.body;

    // Redundant fallback check just in case schema validation is bypassed
    if (!Object.values(MonitorFlagType).includes(flagType)) {
      res.status(400).json({ error: 'Invalid flag type' });
      return;
    }

    await submitFlagService(testId, studentId, flagType, metadata);
    res.status(201).json({ message: 'Flag recorded' });
  } catch (error) {
    next(error);
  }
};
