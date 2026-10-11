import { Router } from 'express';
import { submitExam, saveAnswer } from './submission.controller';
import { authenticateJwt } from '../auth/jwt.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { Role } from '../../types/roles';
import { testWindowGuard } from './../test/testWindow.guard';
import { submissionLockGuard } from './submissionLock.guard';
import { testMembershipGuard } from './../test/membership.guard';

const router = Router();

// Student can save answers
router.post(
  '/save', 
  authenticateJwt, 
  requireRole([Role.STUDENT]), 
  testMembershipGuard,
  testWindowGuard, 
  submissionLockGuard, 
  saveAnswer
);

// Student can submit
router.post(
  '/', 
  authenticateJwt, 
  requireRole([Role.STUDENT]), 
  testMembershipGuard,
  testWindowGuard, 
  submissionLockGuard, 
  submitExam
);

export default router;
