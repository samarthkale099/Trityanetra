import { Router, Request, Response, NextFunction } from 'express';
import { authenticateJwt } from '../auth/jwt.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { Role } from '../../types/roles';
import { testMembershipGuard } from '../test/membership.guard';
import { testWindowGuard } from '../test/testWindow.guard';
import { submissionLockGuard } from '../submission/submissionLock.guard';
import { judge0RateLimiter } from './judge0.rateLimiter';
import { runForQuestionService } from './judge0.service';

const router = Router();

/**
 * POST /api/judge0/run  { testId, questionId, code, language, customInput? }
 *
 * Student-only, enrolled, inside the test window, before submitting, and rate
 * limited (10/min). Runs against visible test cases only.
 *
 * The Judge0 callback (`judge0.callback.controller.ts`) stays unmounted until
 * the team settles its signing scheme -- see the TODO there.
 */
router.post(
  '/run',
  authenticateJwt,
  requireRole([Role.STUDENT]),
  testMembershipGuard,
  testWindowGuard,
  submissionLockGuard,
  judge0RateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { testId, questionId, code, language, customInput } = req.body ?? {};
      const data = await runForQuestionService({ testId, questionId, code, language, customInput });
      res.status(200).json({ data });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
