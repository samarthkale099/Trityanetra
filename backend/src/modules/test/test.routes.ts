import { Router } from 'express';
import { createTest, getTests, enterTest, releaseResults, getMyResult } from './test.controller';
import { authenticateJwt } from '../auth/jwt.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { Role } from '../../types/roles';
import { testWindowGuard } from './testWindow.guard';
import { testMembershipGuard } from './membership.guard';

const router = Router();

router.post('/', authenticateJwt, requireRole([Role.TEACHER, Role.ADMIN]), createTest);
router.get('/', authenticateJwt, getTests);

// Exam Entry endpoint
router.get('/:testId/entry', authenticateJwt, requireRole([Role.STUDENT]), testMembershipGuard, testWindowGuard, enterTest);

// Teacher releases marks and comments to the students (idempotent; locks grading).
router.post('/:testId/release', authenticateJwt, requireRole([Role.TEACHER, Role.ADMIN]), releaseResults);
// Student's own result; marks/comment withheld until release.
router.get('/:testId/result', authenticateJwt, requireRole([Role.STUDENT]), getMyResult);

export default router;
