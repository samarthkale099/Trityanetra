import { Router } from 'express';
import { createTest, getTests, enterTest } from './test.controller';
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

export default router;
