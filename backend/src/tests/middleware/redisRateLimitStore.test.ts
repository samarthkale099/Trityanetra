import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RedisRateLimitStore, RedisLike } from '../../middleware/redisRateLimitStore';

// Minimal in-memory fake of the Redis commands the store uses, with real expiry behaviour.
class FakeRedis implements RedisLike {
  data = new Map<string, { v: number; exp: number | null }>();
  private live(k: string) {
    const e = this.data.get(k);
    if (e && e.exp !== null && e.exp <= Date.now()) { this.data.delete(k); return undefined; }
    return e;
  }
  async incr(k: string) { const e = this.live(k); const v = (e?.v ?? 0) + 1; this.data.set(k, { v, exp: e?.exp ?? null }); return v; }
  async decr(k: string) { const e = this.live(k); const v = (e?.v ?? 0) - 1; this.data.set(k, { v, exp: e?.exp ?? null }); return v; }
  async pexpire(k: string, ms: number) { const e = this.live(k); if (!e) return 0; e.exp = Date.now() + ms; return 1; }
  async pttl(k: string) { const e = this.live(k); if (!e) return -2; return e.exp === null ? -1 : e.exp - Date.now(); }
  async del(k: string) { return this.data.delete(k) ? 1 : 0; }
}

describe('RedisRateLimitStore', () => {
  let redis: FakeRedis;
  let store: RedisRateLimitStore;

  beforeEach(() => {
    vi.useFakeTimers();
    redis = new FakeRedis();
    store = new RedisRateLimitStore(redis, 'rl:test:');
    store.init({ windowMs: 2000 } as any);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('counts hits per key and reports when the window resets', async () => {
    const a = await store.increment('u1');
    const b = await store.increment('u1');
    expect(a.totalHits).toBe(1);
    expect(b.totalHits).toBe(2);
    expect(b.resetTime!.getTime()).toBeGreaterThan(Date.now());
    expect(b.resetTime!.getTime()).toBeLessThanOrEqual(Date.now() + 2000);
  });

  it('keeps different keys independent', async () => {
    await store.increment('u1'); await store.increment('u1');
    expect((await store.increment('u2')).totalHits).toBe(1);
  });

  it('starts a fresh window after the TTL expires', async () => {
    await store.increment('u1'); await store.increment('u1');
    vi.advanceTimersByTime(2001);
    expect((await store.increment('u1')).totalHits).toBe(1);
  });

  it('uses its own namespace prefix, so limiters cannot collide', async () => {
    const other = new RedisRateLimitStore(redis, 'rl:other:');
    other.init({ windowMs: 2000 } as any);
    await store.increment('u1'); await store.increment('u1');
    expect((await other.increment('u1')).totalHits).toBe(1);
    expect([...redis.data.keys()].sort()).toEqual(['rl:other:u1', 'rl:test:u1']);
  });

  it('repairs a key that has no expiry (crash between INCR and PEXPIRE)', async () => {
    redis.data.set('rl:test:stuck', { v: 5, exp: null });
    const r = await store.increment('stuck');
    expect(r.totalHits).toBe(6);
    expect(await redis.pttl('rl:test:stuck')).toBeGreaterThan(0);
  });

  it('decrement and resetKey work', async () => {
    await store.increment('u1'); await store.increment('u1');
    await store.decrement('u1');
    expect((await store.increment('u1')).totalHits).toBe(2);
    await store.resetKey('u1');
    expect((await store.increment('u1')).totalHits).toBe(1);
  });
});
