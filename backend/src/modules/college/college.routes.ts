import { Router } from 'express';
import { createCollege, getColleges, setCollegeEmailDomain } from './college.controller';
import { authenticateJwt } from '../auth/jwt.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { Role } from '../../types/roles';

const router = Router();

// Only Admins can manage colleges
router.post('/', authenticateJwt, requireRole([Role.ADMIN]), createCollege);
router.get('/', authenticateJwt, requireRole([Role.ADMIN]), getColleges);
router.patch('/:collegeId/email-domain', authenticateJwt, requireRole([Role.ADMIN]), setCollegeEmailDomain);

export default router;
