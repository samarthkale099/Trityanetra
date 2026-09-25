import { Router } from 'express';
import { classroomController } from './classroom.controller';
import { authenticate } from '../auth/jwt.middleware';

const router = Router();
router.post('/', authenticate, classroomController.create);
router.get('/', authenticate, classroomController.list);
router.get('/:id', authenticate, classroomController.getById);
router.post('/:id/students', authenticate, classroomController.addStudent);

export default router;
