import { Router } from 'express';
import {
  createClassroom,
  getClassrooms,
  updateClassroomStudents,
  getClassroomDetail,
  removeStudentByEmail,
} from './classroom.controller';
import { authenticateJwt } from '../auth/jwt.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { Role } from '../../types/roles';

const router = Router();

router.post('/', authenticateJwt, requireRole([Role.TEACHER, Role.ADMIN]), createClassroom);
// Body is either { action, students: uid[] } (original) or { emails: string[] } (enrol by email).
router.post('/:classroomId/students', authenticateJwt, requireRole([Role.TEACHER, Role.ADMIN]), updateClassroomStudents);
router.get('/', authenticateJwt, getClassrooms);

// Teacher view of one classroom: roster (registered + invited) and its tests.
router.get('/:classroomId', authenticateJwt, requireRole([Role.TEACHER, Role.ADMIN]), getClassroomDetail);
// Remove one student (or a pending invite) by email.
router.delete(
  '/:classroomId/students/:email',
  authenticateJwt,
  requireRole([Role.TEACHER, Role.ADMIN]),
  removeStudentByEmail
);

export default router;
