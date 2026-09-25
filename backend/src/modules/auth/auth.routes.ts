import { Router } from 'express';
import { authController } from './auth.controller';
import { authenticate } from './jwt.middleware';

const router = Router();

router.post('/register', authController.register);
router.get('/me', authenticate, authController.getMe);

export default router;
