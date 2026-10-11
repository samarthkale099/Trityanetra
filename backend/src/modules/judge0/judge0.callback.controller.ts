import { Request, Response, NextFunction } from 'express';
import { env } from '../../config/env';

export const judge0Callback = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Verify callback origin via secret token
    // TODO: Confirm exact Judge0 callback auth scheme with the team
    const authHeader = req.headers['x-judge0-token'];
    
    if (!authHeader || authHeader !== env.JUDGE0_CALLBACK_TOKEN) {
      res.status(401).json({ error: 'Unauthorized callback forgery attempt detected' });
      return;
    }

    throw new Error('Judge0 integration not yet configured — missing JUDGE0_API_URL/JUDGE0_API_KEY');
    
  } catch (error) {
    next(error);
  }
};
