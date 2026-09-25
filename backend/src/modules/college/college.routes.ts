import { Router } from 'express';
import { collegeController } from './college.controller';
import { authenticate } from '../auth/jwt.middleware';

const router = Router();

router.post('/', authenticate, collegeController.create);
router.get('/', authenticate, collegeController.list);
router.get('/:id', authenticate, collegeController.getById);

export default router;
