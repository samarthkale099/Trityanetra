import type { Store, Options, ClientRateLimitInfo } from 'express-rate-limit';

// The few ioredis commands the store needs (lets tests pass a small fake).
export interface RedisLike {
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
  pttl(key: string): Promise<number>;
  del(key: string): Promise<number>;
}

/**
 * Redis-backed store for express-rate-limit, so limits survive restarts and are shared across
 * server instances. Every limiter gets its own key prefix (namespace), e.g. "rl:monitor:" and
 * "rl:judge0:", so limiters never interfere with each other.
 */
export class RedisRateLimitStore implements Store {
  // Shared store: express-rate-limit must not treat keys as process-local.
  localKeys = false;
  private windowMs = 60_000;

  constructor(private readonly client: RedisLike, readonly prefix: string) {}

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const k = this.prefix + key;
    const totalHits = await this.client.incr(k);
    if (totalHits === 1) {
      await this.client.pexpire(k, this.windowMs);
    }
    let ttl = await this.client.pttl(k);
    if (ttl < 0) {
      // Key has no expiry (e.g. the process died between INCR and PEXPIRE): repair it.
      await this.client.pexpire(k, this.windowMs);
      ttl = this.windowMs;
    }
    return { totalHits, resetTime: new Date(Date.now() + ttl) };
  }

  async decrement(key: string): Promise<void> {
    await this.client.decr(this.prefix + key);
  }

  async resetKey(key: string): Promise<void> {
    await this.client.del(this.prefix + key);
  }
}
