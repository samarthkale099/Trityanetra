import { Router } from 'express';
import { assignUserRole, register, login, me } from './auth.controller';
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
// The signed-in user's profile (name, email, role, college) for the app shell.
router.get('/me', authenticateJwt, me);

export default router;
