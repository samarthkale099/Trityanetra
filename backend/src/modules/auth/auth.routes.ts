import { Router } from 'express';
import { assignUserRole, register, login, verifyEmail, resendVerificationEmail } from './auth.controller';
import { authenticateJwt } from './jwt.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { validateBody } from '../../middleware/validateBody';
import { registerSchema, loginSchema } from './auth.schema';
import { Role } from '../../types/roles';

const router = Router();

// Only ADMINs can assign roles via HTTP
router.post('/assign-role', authenticateJwt, requireRole([Role.ADMIN]), assignUserRole);

// New JWT auth routes
router.post('/register', validateBody(registerSchema), register);
router.post('/login', validateBody(loginSchema), login);

// Email verification (no auth: the token in the link is the credential).
router.get('/verify-email', verifyEmail);
router.post('/verify-email', verifyEmail);
router.post('/resend-verification', resendVerificationEmail);

export default router;
