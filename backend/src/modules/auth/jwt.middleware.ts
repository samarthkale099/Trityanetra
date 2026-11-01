import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { UserIdentity } from '../../types/roles';

declare global {
  namespace Express {
    interface Request {
      user?: UserIdentity;
    }
  }
}

export const authenticateJwt = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as UserIdentity;
    
    req.user = {
      uid: payload.uid,
      email: payload.email,
      role: payload.role,
      collegeId: payload.collegeId || undefined,
      displayName: payload.displayName || undefined,
    };

    next();
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }
};
