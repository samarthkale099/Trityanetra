import { getRedisClient, checkRedisHealth, closeRedis, createModuleRedis } from './redis';

// Use REDIS_URL from env or fall back to default
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

describe('Redis Client', () => {
  let client: ReturnType<typeof getRedisClient>;

  beforeAll(async () => {
    client = getRedisClient();
    // Wait for connection
    await new Promise<void>((resolve) => {
      if (client.status === 'ready') {
        resolve();
      } else {
        client.on('ready', resolve);
      }
    });
  });

  afterAll(async () => {
    await closeRedis();
  });

  describe('Happy path', () => {
    it('should connect to Redis successfully', async () => {
      const health = await checkRedisHealth(client);
      expect(health).toBe(true);
    });

    it('should ping Redis', async () => {
      const result = await client.ping();
      expect(result).toBe('PONG');
    });

    it('should set and get a value', async () => {
      await client.set('test:key1', 'value1');
      const value = await client.get('test:key1');
      expect(value).toBe('value1');
      await client.del('test:key1');
    });

    it('should set a value with expiry', async () => {
      await client.set('test:key2', 'value2', 'EX', 10);
      const ttl = await client.ttl('test:key2');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(10);
      await client.del('test:key2');
    });
  });

  describe('Singleton pattern', () => {
    it('should return the same client instance', () => {
      const client1 = getRedisClient();
      const client2 = getRedisClient();
      expect(client1).toBe(client2);
    });
  });

  describe('Module Redis with prefix', () => {
    it('should create a separate connection with key prefix', async () => {
      const moduleClient = createModuleRedis('test-module');
      try {
        await moduleClient.set('key1', 'module-value');
        // The key in Redis should be prefixed
        const rawValue = await client.get('test-module:key1');
        expect(rawValue).toBe('module-value');
        await client.del('test-module:key1');
      } finally {
        await moduleClient.quit();
      }
    });
  });

  describe('Error handling', () => {
    it('should return false for health check when Redis is unavailable', async () => {
      // ioredis is globally substituted with ioredis-mock in the test env,
      // which always "connects" regardless of host/port. Simulate an
      // unavailable server with a client whose ping rejects.
      const badClient = {
        ping: () => Promise.reject(new Error('Connection refused')),
      } as any;

      const health = await checkRedisHealth(badClient);
      expect(health).toBe(false);
    });

    it('should return false for health check when ping returns a non-PONG response', async () => {
      const weirdClient = { ping: () => Promise.resolve('NOT-PONG') } as any;
      const health = await checkRedisHealth(weirdClient);
      expect(health).toBe(false);
    });

    it('should not throw when a module client emits an error event', () => {
      const moduleClient = createModuleRedis('err-module');
      try {
        // An 'error' listener must be attached, otherwise EventEmitter throws.
        expect(moduleClient.listenerCount('error')).toBeGreaterThan(0);
        expect(() => moduleClient.emit('error', new Error('simulated'))).not.toThrow();
      } finally {
        moduleClient.quit();
      }
    });
  });

  describe('Reconnection policy', () => {
    it('should stop retrying after the max attempt threshold', () => {
      const c = getRedisClient();
      const retryStrategy = (c as any).options?.retryStrategy;
      expect(typeof retryStrategy).toBe('function');

      // Below threshold: numeric backoff delay
      const early = retryStrategy(5);
      expect(typeof early).toBe('number');
      expect(early).toBeGreaterThan(0);

      // At/beyond threshold: null => stop retrying (no infinite reconnect loop)
      expect(retryStrategy(11)).toBeNull();
      expect(retryStrategy(100)).toBeNull();
    });

    it('should cap backoff delay so retries do not wait forever between attempts', () => {
      const c = getRedisClient();
      const retryStrategy = (c as any).options?.retryStrategy;
      expect(retryStrategy(10)).toBeLessThanOrEqual(5000);
    });
  });

  describe('closeRedis', () => {
    it('should clear the singleton so the next call creates a fresh client', async () => {
      const before = getRedisClient();
      await closeRedis();
      const after = getRedisClient();
      expect(after).not.toBe(before);
      expect(after).toBe(getRedisClient());
    });

    it('should be safe to call when no client exists', async () => {
      await closeRedis();
      await expect(closeRedis()).resolves.toBeUndefined();
    });
  });

  describe('Module namespace isolation', () => {
    it('should keep keys from different module prefixes independent', async () => {
      const client = getRedisClient();
      const moduleA = createModuleRedis('mod-a');
      const moduleB = createModuleRedis('mod-b');
      try {
        await moduleA.set('k', 'value-a');
        await moduleB.set('k', 'value-b');

        expect(await client.get('mod-a:k')).toBe('value-a');
        expect(await client.get('mod-b:k')).toBe('value-b');

        await client.del('mod-a:k', 'mod-b:k');
      } finally {
        await moduleA.quit();
        await moduleB.quit();
      }
    });
  });
});
