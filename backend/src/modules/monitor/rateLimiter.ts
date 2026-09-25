import { getRedisClient } from '../../lib/redis';
import { env } from '../../config/env';

const MONITOR_RATE_LIMIT_KEY_PREFIX = 'rl:monitor';

/**
 * Sliding window rate limiter for monitor flag creation.
 * Uses Redis sorted sets for precise sliding window tracking.
 * 
 * IMPORTANT: This is completely independent from the Judge0 rate limiter.
 * - Separate Redis key namespace: rl:monitor:* vs rl:judge0:*
 * - Separate max requests config
 * - Separate window config
 * - Tested independently
 */
export class MonitorRateLimiter {
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests?: number, windowMs?: number) {
    this.maxRequests = maxRequests ?? env.MONITOR_RATE_LIMIT_MAX;
    this.windowMs = windowMs ?? env.MONITOR_RATE_LIMIT_WINDOW_MS;
  }

  /**
   * Check if a flag creation request is allowed.
   * Per-student key to prevent one student from flooding flags.
   */
  async isAllowed(studentId: string = 'global'): Promise<{ allowed: boolean; remaining: number; retryAfterMs?: number }> {
    const redis = getRedisClient();
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const redisKey = `${MONITOR_RATE_LIMIT_KEY_PREFIX}:${studentId}`;

    let results: [error: Error | null, result: unknown][] | null;
    try {
      const pipeline = redis.pipeline();
      pipeline.zremrangebyscore(redisKey, 0, windowStart);
      pipeline.zcard(redisKey);
      pipeline.zadd(redisKey, now.toString(), `${now}:${Math.random()}`);
      pipeline.expire(redisKey, Math.ceil(this.windowMs / 1000) + 1);

      results = await pipeline.exec();
    } catch {
      // Fail closed: if the limiter store is unavailable, deny the flag
      // creation rather than letting requests bypass rate limiting.
      return { allowed: false, remaining: 0, retryAfterMs: this.windowMs };
    }

    if (!results) {
      return { allowed: false, remaining: 0, retryAfterMs: this.windowMs };
    }

    const count = (results[1]?.[1] as number) || 0;

    if (count >= this.maxRequests) {
      let oldest: string[] = [];
      try {
        oldest = await redis.zrange(redisKey, 0, 0, 'WITHSCORES');
      } catch {
        // Fail closed — cannot compute retry, deny with full window
        return { allowed: false, remaining: 0, retryAfterMs: this.windowMs };
      }
      const retryAfterMs = oldest.length >= 2
        ? Math.max(0, parseInt(oldest[1], 10) + this.windowMs - now)
        : this.windowMs;

      return { allowed: false, remaining: 0, retryAfterMs };
    }

    return { allowed: true, remaining: this.maxRequests - count - 1 };
  }

  /**
   * Reset the rate limit for a specific student.
   */
  async reset(studentId: string = 'global'): Promise<void> {
    const redis = getRedisClient();
    await redis.del(`${MONITOR_RATE_LIMIT_KEY_PREFIX}:${studentId}`);
  }
}

export const monitorRateLimiter = new MonitorRateLimiter();
