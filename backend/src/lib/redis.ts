import Redis from 'ioredis';
import { env } from '../config/env';

// Fail startup loudly if missing
if (!env.REDIS_URL) {
  throw new Error('REDIS_URL environment variable is missing. Failed to initialize Redis connection.');
}

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // Required by BullMQ
  lazyConnect: true
});

redis.on('error', (err) => {
  console.error('Redis connection error:', err.message);
});

// Separate connection for rate limiting. Unlike the BullMQ connection above, it must fail fast:
// with the offline queue disabled, a Redis outage rejects commands immediately instead of
// leaving HTTP requests hanging, so each limiter's fail-open / fail-closed policy takes effect.
export const rateLimitRedis = new Redis(env.REDIS_URL, {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => Math.min(times * 500, 5000),
});

rateLimitRedis.on('error', (err) => {
  console.error('Rate-limit Redis error:', err.message);
});
