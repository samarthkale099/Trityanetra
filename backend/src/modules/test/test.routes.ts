import { Router } from 'express';
import { testController } from './test.controller';
import { authenticate } from '../auth/jwt.middleware';

const router = Router();
router.post('/', authenticate, testController.create);
router.get('/', authenticate, testController.list);
router.get('/:id', authenticate, testController.getById);
router.post('/:id/start', authenticate, testController.startExam);

export default router;
