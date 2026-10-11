import rateLimit from 'express-rate-limit';
import { Request } from 'express';

export const judge0RateLimiter = rateLimit({
  windowMs: 60000, // 1 minute
  max: 10, // Limit each IP to 10 requests per windowMs
  keyGenerator: (req: Request) => req.user?.uid || 'anonymous',
  message: { error: 'Too many execution requests, please slow down.' },
});
