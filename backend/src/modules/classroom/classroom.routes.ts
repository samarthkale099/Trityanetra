import { Router } from 'express';
import { createClassroom, getClassrooms, updateClassroomStudents } from './classroom.controller';
import { authenticateJwt } from '../auth/jwt.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { Role } from '../../types/roles';

const router = Router();

router.post('/', authenticateJwt, requireRole([Role.TEACHER, Role.ADMIN]), createClassroom);
router.post('/:classroomId/students', authenticateJwt, requireRole([Role.TEACHER, Role.ADMIN]), updateClassroomStudents);
router.get('/', authenticateJwt, getClassrooms);

export default router;
