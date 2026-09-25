import { getRedisClient } from '../../lib/redis';
import { env } from '../../config/env';

const JUDGE0_RATE_LIMIT_KEY_PREFIX = 'rl:judge0';

/**
 * Sliding window rate limiter for Judge0 submissions.
 * Uses Redis sorted sets for precise sliding window tracking.
 * Independent key namespace — does NOT share buckets with monitor rate limiter.
 */
export class Judge0RateLimiter {
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests?: number, windowMs?: number) {
    this.maxRequests = maxRequests ?? env.JUDGE0_RATE_LIMIT_MAX;
    this.windowMs = windowMs ?? env.JUDGE0_RATE_LIMIT_WINDOW_MS;
  }

  /**
   * Check if a request is allowed under the rate limit.
   * Uses Redis sorted sets with timestamps for sliding window.
   */
  async isAllowed(key: string = 'global'): Promise<{ allowed: boolean; remaining: number; retryAfterMs?: number }> {
    const redis = getRedisClient();
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const redisKey = `${JUDGE0_RATE_LIMIT_KEY_PREFIX}:${key}`;

    // Pipeline: remove expired entries, count current, add new entry
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(redisKey, 0, windowStart); // Remove expired
    pipeline.zcard(redisKey); // Count current entries in window
    pipeline.zadd(redisKey, now.toString(), `${now}:${Math.random()}`); // Add new entry
    pipeline.expire(redisKey, Math.ceil(this.windowMs / 1000) + 1); // TTL slightly larger than window

    const results = await pipeline.exec();

    if (!results) {
      return { allowed: false, remaining: 0, retryAfterMs: this.windowMs };
    }

    // Count result is the second command (index 1)
    const count = (results[1]?.[1] as number) || 0;

    if (count >= this.maxRequests) {
      // Calculate retry-after based on oldest entry in window
      const oldest = await redis.zrange(redisKey, 0, 0, 'WITHSCORES');
      const retryAfterMs = oldest.length >= 2
        ? Math.max(0, parseInt(oldest[1], 10) + this.windowMs - now)
        : this.windowMs;

      return { allowed: false, remaining: 0, retryAfterMs };
    }

    return { allowed: true, remaining: this.maxRequests - count - 1 };
  }

  /**
   * Reset the rate limit for a specific key.
   */
  async reset(key: string = 'global'): Promise<void> {
    const redis = getRedisClient();
    await redis.del(`${JUDGE0_RATE_LIMIT_KEY_PREFIX}:${key}`);
  }

  /**
   * Get the current usage count for a key.
   */
  async getUsage(key: string = 'global'): Promise<number> {
    const redis = getRedisClient();
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const redisKey = `${JUDGE0_RATE_LIMIT_KEY_PREFIX}:${key}`;

    // Remove expired entries first
    await redis.zremrangebyscore(redisKey, 0, windowStart);
    return await redis.zcard(redisKey);
  }
}

export const judge0RateLimiter = new Judge0RateLimiter();
