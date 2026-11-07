import { Router } from 'express';
import { createTest, getTests, enterTest, releaseResults, getMyResult, getLobby } from './test.controller';
import { authenticateJwt } from '../auth/jwt.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { Role } from '../../types/roles';
import { testWindowGuard } from './testWindow.guard';
import { testMembershipGuard } from './membership.guard';

const router = Router();

router.post('/', authenticateJwt, requireRole([Role.TEACHER, Role.ADMIN]), createTest);
router.get('/', authenticateJwt, getTests);

// Lobby: test details, server time and own status. No questions, no timer start, no window check.
router.get('/:testId/lobby', authenticateJwt, requireRole([Role.STUDENT]), testMembershipGuard, getLobby);

// Exam Entry endpoint (starts the timer on first call; questions with hidden cases masked)
router.get('/:testId/entry', authenticateJwt, requireRole([Role.STUDENT]), testMembershipGuard, testWindowGuard, enterTest);

// Teacher releases marks and comments to the students (idempotent; locks grading).
router.post('/:testId/release', authenticateJwt, requireRole([Role.TEACHER, Role.ADMIN]), releaseResults);
// Student's own result; marks/comment withheld until release.
router.get('/:testId/result', authenticateJwt, requireRole([Role.STUDENT]), getMyResult);

export default router;
