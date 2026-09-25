import { getRedisClient } from '../../lib/redis';
import { env } from '../../config/env';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

const CIRCUIT_KEY_PREFIX = 'circuit:judge0';

/**
 * Circuit breaker for Judge0 API calls.
 * States:
 *  - CLOSED: Normal operation. Requests pass through.
 *  - OPEN: Too many failures. Requests are rejected immediately.
 *  - HALF_OPEN: After reset timeout, allows one probe request through.
 */
export class CircuitBreaker {
  private failureThreshold: number;
  private resetMs: number;

  constructor(failureThreshold?: number, resetMs?: number) {
    this.failureThreshold = failureThreshold ?? env.JUDGE0_CIRCUIT_BREAKER_THRESHOLD;
    this.resetMs = resetMs ?? env.JUDGE0_CIRCUIT_BREAKER_RESET_MS;
  }

  /**
   * Check if the circuit allows a request through.
   */
  async canExecute(key: string = 'global'): Promise<boolean> {
    const redis = getRedisClient();
    const state = await this.getState(key);

    if (state === 'CLOSED') return true;

    if (state === 'OPEN') {
      // Check if reset window has passed
      const openedAt = await redis.get(`${CIRCUIT_KEY_PREFIX}:openedAt:${key}`);
      if (openedAt && Date.now() - parseInt(openedAt, 10) >= this.resetMs) {
        // Transition to HALF_OPEN
        await this.setState(key, 'HALF_OPEN');
        return true;
      }
      return false;
    }

    // HALF_OPEN: allow one probe
    return true;
  }

  /**
   * Record a successful execution. Resets the circuit if in HALF_OPEN.
   */
  async recordSuccess(key: string = 'global'): Promise<void> {
    const state = await this.getState(key);
    if (state === 'HALF_OPEN' || state === 'OPEN') {
      await this.reset(key);
    } else {
      // CLOSED: reset failure count
      const redis = getRedisClient();
      await redis.set(`${CIRCUIT_KEY_PREFIX}:failures:${key}`, '0');
    }
  }

  /**
   * Record a failed execution. Opens the circuit if threshold reached.
   */
  async recordFailure(key: string = 'global'): Promise<void> {
    const redis = getRedisClient();
    const failureKey = `${CIRCUIT_KEY_PREFIX}:failures:${key}`;

    const failures = await redis.incr(failureKey);
    await redis.expire(failureKey, Math.ceil(this.resetMs / 1000) + 60);

    if (failures >= this.failureThreshold) {
      await this.setState(key, 'OPEN');
      await redis.set(`${CIRCUIT_KEY_PREFIX}:openedAt:${key}`, Date.now().toString());
      await redis.expire(`${CIRCUIT_KEY_PREFIX}:openedAt:${key}`, Math.ceil(this.resetMs / 1000) + 60);
    }
  }

  /**
   * Reset the circuit to CLOSED state.
   */
  async reset(key: string = 'global'): Promise<void> {
    const redis = getRedisClient();
    await redis.del(
      `${CIRCUIT_KEY_PREFIX}:state:${key}`,
      `${CIRCUIT_KEY_PREFIX}:failures:${key}`,
      `${CIRCUIT_KEY_PREFIX}:openedAt:${key}`
    );
  }

  /**
   * Get the current state of the circuit.
   */
  async getState(key: string = 'global'): Promise<CircuitState> {
    const redis = getRedisClient();
    const state = await redis.get(`${CIRCUIT_KEY_PREFIX}:state:${key}`);
    return (state as CircuitState) || 'CLOSED';
  }

  private async setState(key: string, state: CircuitState): Promise<void> {
    const redis = getRedisClient();
    await redis.set(`${CIRCUIT_KEY_PREFIX}:state:${key}`, state);
  }
}

export const judge0CircuitBreaker = new CircuitBreaker();
