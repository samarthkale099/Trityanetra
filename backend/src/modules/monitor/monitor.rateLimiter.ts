import rateLimit from 'express-rate-limit';
import { Request } from 'express';
import { rateLimitRedis } from '../../lib/redis';
import { RedisRateLimitStore } from '../../middleware/redisRateLimitStore';

// Redis-backed in real runs (shared across instances, survives restarts, own "rl:monitor:" namespace).
// Tests mock ioredis, so they use express-rate-limit's default in-memory store.
const useRedis = process.env.NODE_ENV !== 'test';

export const monitorRateLimiter = rateLimit({
  windowMs: 2000, // 2 seconds
  max: 1, // 1 request per window per (user, test)
  keyGenerator: (req: Request) => {
    const userId = req.user?.uid || 'anonymous';
    const testId = req.params.testId || 'unknown';
    return `${userId}_${testId}`;
  },
  message: { error: 'Too many flag requests, please slow down.' },
  ...(useRedis ? { store: new RedisRateLimitStore(rateLimitRedis as any, 'rl:monitor:') } : {}),
  // Flags are advisory-only: if Redis is down, let the request through rather than drop the flag.
  passOnStoreError: true,
});
