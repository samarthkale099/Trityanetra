import { Router } from 'express';
import { assignUserRole, register, login, me, verifyEmail, resendVerificationEmail } from './auth.controller';
import { authenticateJwt } from './jwt.middleware';
import { loginRateLimiter, registerRateLimiter, resendRateLimiter } from './auth.rateLimiter';
import { requireRole } from '../../middleware/rbac.middleware';
import { validateBody } from '../../middleware/validateBody';
import { registerSchema, loginSchema } from './auth.schema';
import { Role } from '../../types/roles';

const router = Router();

// Only ADMINs can assign roles via HTTP
router.post('/assign-role', authenticateJwt, requireRole([Role.ADMIN]), assignUserRole);

// New JWT auth routes
router.post('/register', registerRateLimiter, validateBody(registerSchema), register);
router.post('/login', loginRateLimiter, validateBody(loginSchema), login);
// The signed-in user's profile (name, email, role, college) for the app shell.
router.get('/me', authenticateJwt, me);

// Email verification (no auth: the token in the link is the credential).
router.get('/verify-email', verifyEmail);
router.post('/verify-email', verifyEmail);
router.post('/resend-verification', resendRateLimiter, resendVerificationEmail);

export default router;
