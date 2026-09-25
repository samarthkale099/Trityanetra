import { MonitorRateLimiter } from './rateLimiter';
import { getRedisClient, closeRedis } from '../../lib/redis';

describe('MonitorRateLimiter', () => {
  let limiter: MonitorRateLimiter;

  beforeAll(async () => {
    const client = getRedisClient();
    if (client.status !== 'ready') {
      await new Promise<void>((resolve) => client.on('ready', resolve));
    }
  });

  beforeEach(() => {
    limiter = new MonitorRateLimiter(5, 60000); // 5 flags per 60 seconds
  });

  afterEach(async () => {
    await limiter.reset('test-key');
    await limiter.reset('global');
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await closeRedis();
  });

  describe('Boundaries', () => {
    it('should allow requests under the limit', async () => {
      const result = await limiter.isAllowed('test-key');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });

    it('should track remaining correctly', async () => {
      await limiter.isAllowed('test-key');
      await limiter.isAllowed('test-key');
      await limiter.isAllowed('test-key');

      const result = await limiter.isAllowed('test-key');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);
    });

    it('should allow the request that hits the limit exactly (remaining 0)', async () => {
      for (let i = 0; i < 4; i++) {
        const r = await limiter.isAllowed('test-key');
        expect(r.allowed).toBe(true);
      }

      const atLimit = await limiter.isAllowed('test-key'); // 5th request
      expect(atLimit.allowed).toBe(true);
      expect(atLimit.remaining).toBe(0);
    });

    it('should deny the request one over the limit', async () => {
      for (let i = 0; i < 5; i++) {
        await limiter.isAllowed('test-key');
      }

      const over = await limiter.isAllowed('test-key'); // 6th request
      expect(over.allowed).toBe(false);
      expect(over.remaining).toBe(0);
      expect(over.retryAfterMs).toBeGreaterThan(0);
      expect(over.retryAfterMs).toBeLessThanOrEqual(60000);
    });

    it('should rate limit per student, not globally', async () => {
      for (let i = 0; i < 5; i++) {
        await limiter.isAllowed('student-a');
      }

      const a = await limiter.isAllowed('student-a');
      const b = await limiter.isAllowed('student-b');
      expect(a.allowed).toBe(false);
      expect(b.allowed).toBe(true);

      await limiter.reset('student-b');
    });
  });

  describe('Reset', () => {
    it('should restore the quota after reset', async () => {
      for (let i = 0; i < 5; i++) {
        await limiter.isAllowed('test-key');
      }

      const denied = await limiter.isAllowed('test-key');
      expect(denied.allowed).toBe(false);

      await limiter.reset('test-key');

      const again = await limiter.isAllowed('test-key');
      expect(again.allowed).toBe(true);
    });
  });

  describe('Rule 3: fail closed on store errors', () => {
    it('should deny (fail closed) when the Redis pipeline errors', async () => {
      const redis = getRedisClient();
      jest.spyOn(redis, 'pipeline').mockImplementation(() => {
        throw new Error('redis down');
      });

      const result = await limiter.isAllowed('test-key');
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it('should deny (fail closed) when pipeline.exec() rejects', async () => {
      const redis = getRedisClient();
      jest.spyOn(redis, 'pipeline').mockImplementation(() => ({
        zremrangebyscore: () => undefined,
        zcard: () => undefined,
        zadd: () => undefined,
        expire: () => undefined,
        exec: () => Promise.reject(new Error('exec failed')),
      }) as any);

      const result = await limiter.isAllowed('test-key');
      expect(result.allowed).toBe(false);
    });

    it('should deny (fail closed) when pipeline.exec() returns null', async () => {
      const redis = getRedisClient();
      jest.spyOn(redis, 'pipeline').mockImplementation(() => ({
        zremrangebyscore: () => undefined,
        zcard: () => undefined,
        zadd: () => undefined,
        expire: () => undefined,
        exec: () => Promise.resolve(null),
      }) as any);

      const result = await limiter.isAllowed('test-key');
      expect(result.allowed).toBe(false);
    });

    it('should deny (fail closed) when the zrange retry lookup errors at the limit', async () => {
      const redis = getRedisClient();
      // First 5 calls succeed via the real limiter
      for (let i = 0; i < 5; i++) {
        await limiter.isAllowed('test-key');
      }

      jest.spyOn(redis, 'zrange').mockRejectedValue(new Error('zrange failed'));

      const result = await limiter.isAllowed('test-key');
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBe(60000);
    });
  });

  describe('Namespace', () => {
    it('uses the rl:monitor key namespace, not rl:judge0', async () => {
      const redis = getRedisClient();
      await limiter.isAllowed('ns-check');

      const keys = await redis.keys('rl:monitor:*');
      expect(keys.some((k) => k.includes('ns-check'))).toBe(true);

      const judge0Keys = await redis.keys('rl:judge0:*');
      expect(judge0Keys.some((k) => k.includes('ns-check'))).toBe(false);

      await limiter.reset('ns-check');
    });
  });
});
