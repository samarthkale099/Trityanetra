import { Router } from 'express';
import { plagiarismController } from './plagiarism.controller';
import { authenticate } from '../auth/jwt.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { ROLES } from '../../config/constants';

const router = Router();

// Create plagiarism job — TEACHER or ADMIN only
router.post(
  '/jobs',
  authenticate,
  requireRole(ROLES.TEACHER, ROLES.ADMIN),
  plagiarismController.createJob
);

// Get job status — authenticated users
router.get('/jobs/:jobId', authenticate, plagiarismController.getJob);

// Get all jobs for a test — TEACHER or ADMIN only
router.get(
  '/jobs/test/:testId',
  authenticate,
  requireRole(ROLES.TEACHER, ROLES.ADMIN),
  plagiarismController.getJobsByTest
);

// Get plagiarism results for a test — TEACHER or ADMIN only
router.get(
  '/results/test/:testId',
  authenticate,
  requireRole(ROLES.TEACHER, ROLES.ADMIN),
  plagiarismController.getResultsByTest
);

export default router;
