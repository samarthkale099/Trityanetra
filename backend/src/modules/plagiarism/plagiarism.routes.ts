import { Router } from 'express';
import { checkPlagiarism, checkPlagiarismStatus } from './plagiarism.controller';
import { authenticateJwt } from '../auth/jwt.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { Role } from '../../types/roles';

const router = Router({ mergeParams: true });

router.post('/:testId/check', authenticateJwt, requireRole([Role.TEACHER, Role.ADMIN]), checkPlagiarism);
router.get('/:testId/status', authenticateJwt, requireRole([Role.TEACHER, Role.ADMIN]), checkPlagiarismStatus);

export default router;
