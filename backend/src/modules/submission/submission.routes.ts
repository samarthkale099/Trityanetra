import { Router } from 'express';
import { submissionController } from './submission.controller';
import { authenticate } from '../auth/jwt.middleware';

const router = Router();
router.post('/', authenticate, submissionController.create);
router.get('/me', authenticate, submissionController.getMySubmission);
router.post('/:id/submit', authenticate, submissionController.submit);
router.post('/:id/finalize', authenticate, submissionController.finalize);

export default router;
