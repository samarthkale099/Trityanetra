// Checks the real Redis in REDIS_URL (backend/.env) with everything the app uses it for:
//   npx ts-node scripts/redis-smoke.ts
// Uses throwaway keys/queues (smoke-...) and cleans up. Never prints the URL.
import * as dotenv from 'dotenv';
import Redis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { RedisRateLimitStore } from '../src/middleware/redisRateLimitStore';

dotenv.config();

const url = process.env.REDIS_URL;
if (!url) {
  console.error('FAIL: REDIS_URL is not set in backend/.env');
  process.exit(1);
}

const id = Date.now().toString(36);
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!ok) failed++;
};

async function main() {
  const redis = new Redis(url!, { maxRetriesPerRequest: 1, retryStrategy: () => null, lazyConnect: true });
  redis.on('error', () => {}); // reported by the checks below, never print the URL

  try {
    await redis.connect();
  } catch (e) {
    console.error('FAIL: cannot connect to Redis (is it running, and is REDIS_URL right?)');
    process.exit(1);
  }

  // 1. Basics
  check('PING', (await redis.ping()) === 'PONG');
  await redis.set(`smoke:${id}`, 'ok', 'PX', 5000);
  check('SET/GET with expiry', (await redis.get(`smoke:${id}`)) === 'ok' && (await redis.pttl(`smoke:${id}`)) > 0);

  // 2. The rate-limit store, as both limiters use it (own prefix, fixed window)
  const store = new RedisRateLimitStore(redis as any, `rl:smoke-${id}:`);
  store.init({ windowMs: 1500 } as any);
  const a = await store.increment('user1');
  const b = await store.increment('user1');
  const other = await store.increment('user2');
  check('rate-limit store counts per key', a.totalHits === 1 && b.totalHits === 2 && other.totalHits === 1);
  await new Promise((r) => setTimeout(r, 1700));
  check('rate-limit window expires', (await store.increment('user1')).totalHits === 1);
  await store.resetKey('user1');
  await store.resetKey('user2');

  // 3. BullMQ round trip (what the plagiarism queue relies on)
  const connection = new Redis(url!, { maxRetriesPerRequest: null });
  connection.on('error', () => {});
  const name = `smoke-${id}`;
  const queue = new Queue(name, { connection });
  const done = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 10000);
    const worker = new Worker(name, async (job) => job.data.value * 2, { connection });
    worker.on('completed', (_job, result) => {
      clearTimeout(timer);
      worker.close().then(() => resolve(String(result)));
    });
    worker.on('failed', (_job, err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  await queue.add('job', { value: 21 });
  try {
    check('BullMQ job queued, processed and completed', (await done) === '42');
  } catch (e) {
    check('BullMQ job queued, processed and completed', false, (e as Error).message);
  }
  await queue.obliterate({ force: true }).catch(() => {});
  await queue.close();
  await connection.quit();

  await redis.del(`smoke:${id}`);
  await redis.quit();

  console.log(failed ? `\n${failed} check(s) FAILED` : '\nOK: Redis works for rate limits and the job queue.');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.name : 'error');
  process.exit(1);
});
