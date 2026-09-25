import Redis from 'ioredis';
import { env } from '../config/env';

let redisClient: Redis | null = null;

/**
 * Get or create the shared Redis connection.
 * Uses a singleton pattern — multiple calls return the same instance.
 */
export function getRedisClient(): Redis {
  if (redisClient) return redisClient;

  redisClient = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      if (times > 10) {
        console.error('[Redis] Max reconnection attempts reached');
        return null; // Stop retrying
      }
      return Math.min(times * 200, 5000);
    },
    enableReadyCheck: true,
    lazyConnect: false,
  });

  redisClient.on('connect', () => {
    console.log('[Redis] Connected');
  });

  redisClient.on('error', (err) => {
    console.error('[Redis] Error:', err.message);
  });

  redisClient.on('close', () => {
    console.warn('[Redis] Connection closed');
    redisClient = null;
  });

  return redisClient;
}

/**
 * Create a separate Redis connection for a specific module.
 * This ensures independent connection pools per namespace.
 */
export function createModuleRedis(prefix: string): Redis {
  const client = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      if (times > 10) return null;
      return Math.min(times * 200, 5000);
    },
    enableReadyCheck: true,
    keyPrefix: `${prefix}:`,
  });

  client.on('error', (err) => {
    console.error(`[Redis:${prefix}] Error:`, err.message);
  });

  return client;
}

/**
 * Check Redis health by sending a PING.
 */
export async function checkRedisHealth(client?: Redis): Promise<boolean> {
  try {
    const c = client || getRedisClient();
    const result = await c.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}

/**
 * Gracefully close the Redis connection.
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
