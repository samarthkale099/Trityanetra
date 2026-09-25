import { Request, Response, NextFunction } from 'express';
import { SUBMISSION_STATUS } from '../../config/constants';

export function submissionLockGuard(req: Request, res: Response, next: NextFunction) {
  // This middleware should be used on any route that modifies a submission
  // It checks that the submission is not in a SUBMITTED/FINALIZED state
  const submission = (req as any).submission;
  if (submission && (submission.status === SUBMISSION_STATUS.SUBMITTED || submission.status === SUBMISSION_STATUS.FINALIZED)) {
    return res.status(409).json({
      error: { message: 'Submission is immutable once submitted', code: 'SUBMISSION_LOCKED' },
    });
  }
  next();
}
