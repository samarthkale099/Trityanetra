import rateLimit from 'express-rate-limit';
import { Request } from 'express';
import { rateLimitRedis } from '../../lib/redis';
import { RedisRateLimitStore } from '../../middleware/redisRateLimitStore';

// Own "rl:judge0:" Redis namespace, independent of the monitor limiter.
const useRedis = process.env.NODE_ENV !== 'test';

export const judge0RateLimiter = rateLimit({
  windowMs: 60000, // 1 minute
  max: 10, // 10 execution requests per user per window
  keyGenerator: (req: Request) => req.user?.uid || 'anonymous',
  message: { error: 'Too many execution requests, please slow down.' },
  ...(useRedis ? { store: new RedisRateLimitStore(rateLimitRedis as any, 'rl:judge0:') } : {}),
  // Code execution is costly/abusable: if Redis is down, fail closed (default) instead of allowing.
});
