import { Router } from 'express';
import { authenticateJwt } from '../auth/jwt.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { Role } from '../../types/roles';
import { listUsers } from './users.controller';

const router = Router();

// Admin lookup for the role-management screen. Scoped to the admin's college in the service.
router.get('/', authenticateJwt, requireRole([Role.ADMIN]), listUsers);

export default router;
