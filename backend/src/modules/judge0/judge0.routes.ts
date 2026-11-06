import { Router } from 'express';
import { judge0Callback } from './judge0.callback.controller';
import { runCode, getRun } from './judge0.run.controller';
import { authenticateJwt } from '../auth/jwt.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { Role } from '../../types/roles';
import { testMembershipGuard } from '../test/membership.guard';
import { testWindowGuard } from '../test/testWindow.guard';
import { judge0RateLimiter } from './judge0.rateLimiter';

const router = Router();

// No JWT here on purpose: the caller is Judge0, authenticated by the secret in the URL.
router.put('/callback/:token', judge0Callback);
router.post('/callback/:token', judge0Callback);

// A student runs code for a test they belong to, inside the test window, rate limited per user.
router.post(
  '/tests/:testId/run',
  authenticateJwt,
  requireRole([Role.STUDENT]),
  testMembershipGuard,
  testWindowGuard,
  judge0RateLimiter,
  runCode
);

// Poll a run's status/result (only the user who started it can see it).
router.get('/runs/:runId', authenticateJwt, getRun);

export default router;
