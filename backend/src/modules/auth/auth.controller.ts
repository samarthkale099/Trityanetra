import { Request, Response } from 'express';
import { authService } from './auth.service';

export class AuthController {
  async register(req: Request, res: Response) {
    try {
      const { email, password, displayName, role, collegeId } = req.body;

      if (!email || !password || !displayName) {
        return res.status(400).json({
          error: { message: 'email, password, and displayName are required', code: 'VALIDATION_ERROR' },
        });
      }

      const result = await authService.register({ email, password, displayName, role, collegeId });
      return res.status(201).json(result);
    } catch (error: any) {
      if (error.code === 'auth/email-already-exists') {
        return res.status(409).json({
          error: { message: 'Email already in use', code: 'EMAIL_EXISTS' },
        });
      }
      return res.status(500).json({
        error: { message: 'Registration failed', code: 'INTERNAL_ERROR' },
      });
    }
  }

  async getMe(req: Request, res: Response) {
    const user = (req as any).user;
    return res.json({ user });
  }
}

export const authController = new AuthController();
