import rateLimit from 'express-rate-limit';
import { Request } from 'express';

export const monitorRateLimiter = rateLimit({
  windowMs: 2000, // 2 seconds
  max: 1, // Limit each IP to 1 request per window
  keyGenerator: (req: Request) => {
    const userId = req.user?.uid || 'anonymous';
    const testId = req.params.testId || 'unknown';
    return `${userId}_${testId}`;
  },
  message: { error: 'Too many flag requests, please slow down.' },
});
