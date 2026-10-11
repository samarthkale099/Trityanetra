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
