import { Request, Response, NextFunction } from 'express';
import { submitFlagService, MonitorFlagType } from './monitor.service';

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
