import { Request, Response, NextFunction } from 'express';
import { Role } from '../../types/roles';
import { listUsersService } from './users.service';

const ROLES = Object.values(Role) as string[];

/**
 * GET /api/users?email=&role=&collegeId=  (admin only)
 * Looks users up so an admin can change their role with POST /api/auth/assign-role.
 */
export const listUsers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = typeof req.query.email === 'string' ? req.query.email.trim() : '';
    const role = typeof req.query.role === 'string' ? req.query.role.trim().toUpperCase() : '';
    const collegeId = typeof req.query.collegeId === 'string' ? req.query.collegeId.trim() : '';

    if (email && (email.length > 254 || !email.includes('@'))) {
      return res.status(400).json({ error: 'email must be a full email address' });
    }
    if (role && !ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of ${ROLES.join(', ')}` });
    }

    const data = await listUsersService(req.user!, {
      ...(email ? { email } : {}),
      ...(role ? { role: role as Role } : {}),
      ...(collegeId ? { collegeId } : {}),
    });
    res.status(200).json({ data });
  } catch (error) {
    next(error);
  }
};
