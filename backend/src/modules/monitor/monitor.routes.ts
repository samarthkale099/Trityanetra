import { Router } from 'express';
import { submitFlag, listFlags } from './monitor.controller';
import { authenticateJwt } from '../auth/jwt.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { Role } from '../../types/roles';
import { monitorRateLimiter } from './monitor.rateLimiter';
import { testMembershipGuard } from '../test/membership.guard';
import { validateBody } from '../../middleware/validateBody';
import { z } from 'zod';
import { MonitorFlagType } from './monitor.service';

const router = Router({ mergeParams: true });

const flagSchema = z.object({
  flagType: z.nativeEnum(MonitorFlagType),
  metadata: z.any().optional()
});

// Append-only flag route. No PUT/PATCH/DELETE.
router.post(
  '/:testId/flags',
  authenticateJwt,
  requireRole([Role.STUDENT]),
  testMembershipGuard, // only students enrolled in the test's classroom may flag it
  monitorRateLimiter,
  validateBody(flagSchema),
  submitFlag
);

// Read-only integrity report for the test's teacher (ownership checked in the service).
router.get('/:testId/flags', authenticateJwt, requireRole([Role.TEACHER, Role.ADMIN]), listFlags);

export default router;
