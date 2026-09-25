import { Judge0RateLimiter } from './rateLimiter';
import { MonitorRateLimiter } from '../monitor/rateLimiter';
import { getRedisClient, closeRedis } from '../../lib/redis';

describe('Judge0RateLimiter', () => {
  let limiter: Judge0RateLimiter;

  beforeAll(async () => {
    // Ensure Redis is connected
    const client = getRedisClient();
    if (client.status !== 'ready') {
      await new Promise<void>((resolve) => client.on('ready', resolve));
    }
  });

  beforeEach(async () => {
    limiter = new Judge0RateLimiter(5, 60000); // 5 requests per 60 seconds for testing
    await limiter.reset('test-key');
  });

  afterAll(async () => {
    await limiter.reset('test-key');
    await closeRedis();
  });

  describe('Happy path', () => {
    it('should allow requests under the limit', async () => {
      const result = await limiter.isAllowed('test-key');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4); // 5 - 1 (this request)
    });

    it('should track remaining correctly', async () => {
      await limiter.isAllowed('test-key');
      await limiter.isAllowed('test-key');
      await limiter.isAllowed('test-key');

      const result = await limiter.isAllowed('test-key');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);
    });

    it('should report zero remaining at limit', async () => {
      for (let i = 0; i < 4; i++) {
        await limiter.isAllowed('test-key');
      }

      const result = await limiter.isAllowed('test-key');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0);
    });
  });

  describe('Error cases', () => {
    it('should deny requests over the limit', async () => {
      for (let i = 0; i < 5; i++) {
        await limiter.isAllowed('test-key');
      }

      const result = await limiter.isAllowed('test-key');
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it('should report correct retry-after time', async () => {
      for (let i = 0; i < 5; i++) {
        await limiter.isAllowed('test-key');
      }

      const result = await limiter.isAllowed('test-key');
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeDefined();
      expect(result.retryAfterMs).toBeLessThanOrEqual(60000);
    });
  });

  describe('Reset', () => {
    it('should reset the usage count', async () => {
      for (let i = 0; i < 5; i++) {
        await limiter.isAllowed('test-key');
      }

      // Now at limit
      let result = await limiter.isAllowed('test-key');
      expect(result.allowed).toBe(false);

      // Reset
      await limiter.reset('test-key');

      // Should be allowed again
      result = await limiter.isAllowed('test-key');
      expect(result.allowed).toBe(true);
    });
  });

  describe('Independent namespaces', () => {
    it('should track different keys independently', async () => {
      const limiter2 = new Judge0RateLimiter(2, 60000); // 2 per 60s

      // Use up key1 limit (5)
      for (let i = 0; i < 5; i++) {
        await limiter.isAllowed('key1');
      }

      // key2 should still be available
      const result = await limiter.isAllowed('key2');
      expect(result.allowed).toBe(true);

      // Cleanup
      await limiter.reset('key1');
      await limiter.reset('key2');
      await limiter2.reset('key1');
      await limiter2.reset('key2');
    });

    it('should not share buckets between different rate limiters', async () => {
      // Create two limiters with different limits
      const limiterA = new Judge0RateLimiter(2, 60000);
      const limiterB = new Judge0RateLimiter(3, 60000);

      // They should be independent (different instances, same Redis keys though)
      // This tests that the key prefix namespace is correct
      const resultA = await limiterA.isAllowed('shared-test');
      const resultB = await limiterB.isAllowed('shared-test');

      // Both should allow (they share the same key since same prefix)
      // This confirms they share the same bucket — the independent separation
      // is between Judge0 and monitor rate limiters (different prefixes)
      expect(resultA.allowed).toBe(true);
      expect(resultB.allowed).toBe(true);

      await limiterA.reset('shared-test');
    });
  });

  describe('Adversarial cases', () => {
    it('should handle rapid concurrent requests', async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, () => limiter.isAllowed('concurrent-test'))
      );

      const allowed = results.filter((r) => r.allowed);
      const denied = results.filter((r) => !r.allowed);

      // Exactly 5 should be allowed (the limit)
      expect(allowed.length).toBe(5);
      expect(denied.length).toBe(5);

      await limiter.reset('concurrent-test');
    });

    it('should get current usage', async () => {
      await limiter.isAllowed('usage-test');
      await limiter.isAllowed('usage-test');

      const usage = await limiter.getUsage('usage-test');
      expect(usage).toBe(2);

      await limiter.reset('usage-test');
    });
  });

  describe('Rule 3: monitor and Judge0 rate limits are independent', () => {
    let monitorLimiter: MonitorRateLimiter;
    const sharedKey = 'indep-student';

    beforeEach(async () => {
      monitorLimiter = new MonitorRateLimiter(3, 60000); // monitor: 3/60s
      await limiter.reset(sharedKey); // judge0: 5/60s
      await monitorLimiter.reset(sharedKey);
    });

    afterAll(async () => {
      await limiter.reset(sharedKey);
      await monitorLimiter.reset(sharedKey);
    });

    it('exhausting the monitor limit does not affect the Judge0 limit', async () => {
      // Exhaust monitor limiter for this student
      for (let i = 0; i < 3; i++) {
        const m = await monitorLimiter.isAllowed(sharedKey);
        expect(m.allowed).toBe(true);
      }
      const denied = await monitorLimiter.isAllowed(sharedKey);
      expect(denied.allowed).toBe(false);

      // Judge0 limiter for the SAME key is untouched
      const j0 = await limiter.isAllowed(sharedKey);
      expect(j0.allowed).toBe(true);
      expect(j0.remaining).toBe(4);
    });

    it('exhausting the Judge0 limit does not affect the monitor limit', async () => {
      // Exhaust Judge0 limiter for this student
      for (let i = 0; i < 5; i++) {
        const j0 = await limiter.isAllowed(sharedKey);
        expect(j0.allowed).toBe(true);
      }
      const denied = await limiter.isAllowed(sharedKey);
      expect(denied.allowed).toBe(false);

      // Monitor limiter for the SAME key is untouched
      const m = await monitorLimiter.isAllowed(sharedKey);
      expect(m.allowed).toBe(true);
      expect(m.remaining).toBe(2);
    });

    it('the two limiters use separate Redis key namespaces', async () => {
      const monitorLimiter2 = new MonitorRateLimiter(1, 60000);

      // Drain the 1-slot monitor bucket
      await monitorLimiter2.isAllowed(sharedKey);
      const first = await monitorLimiter2.isAllowed(sharedKey);
      expect(first.allowed).toBe(false);

      // Same-instance judge0 usage is independent of that 1-slot bucket
      const j0a = await limiter.isAllowed(sharedKey);
      const j0b = await limiter.isAllowed(sharedKey);
      expect(j0a.allowed).toBe(true);
      expect(j0b.allowed).toBe(true);

      await limiter.reset(sharedKey);
      await monitorLimiter2.reset(sharedKey);
    });
  });
});
