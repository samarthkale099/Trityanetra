import { CircuitBreaker, CircuitState } from './circuitBreaker';
import { getRedisClient, closeRedis } from '../../lib/redis';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeAll(async () => {
    const client = getRedisClient();
    if (client.status !== 'ready') {
      await new Promise<void>((resolve) => client.on('ready', resolve));
    }
  });

  beforeEach(async () => {
    breaker = new CircuitBreaker(3, 5000); // 3 failures, 5s reset for testing
    await breaker.reset('test');
  });

  afterAll(async () => {
    await breaker.reset('test');
    await closeRedis();
  });

  describe('Happy path', () => {
    it('should start in CLOSED state', async () => {
      const state = await breaker.getState('test');
      expect(state).toBe('CLOSED');
    });

    it('should allow execution when CLOSED', async () => {
      const canExecute = await breaker.canExecute('test');
      expect(canExecute).toBe(true);
    });

    it('should stay CLOSED after successful execution', async () => {
      await breaker.recordSuccess('test');
      const state = await breaker.getState('test');
      expect(state).toBe('CLOSED');
    });
  });

  describe('Error cases — opening the circuit', () => {
    it('should open after threshold failures', async () => {
      await breaker.recordFailure('test');
      await breaker.recordFailure('test');
      await breaker.recordFailure('test');

      const state = await breaker.getState('test');
      expect(state).toBe('OPEN');
    });

    it('should deny execution when OPEN', async () => {
      await breaker.recordFailure('test');
      await breaker.recordFailure('test');
      await breaker.recordFailure('test');

      const canExecute = await breaker.canExecute('test');
      expect(canExecute).toBe(false);
    });

    it('should transition to HALF_OPEN after reset timeout', async () => {
      // Open the circuit
      await breaker.recordFailure('test');
      await breaker.recordFailure('test');
      await breaker.recordFailure('test');

      // Wait for reset window
      await new Promise((resolve) => setTimeout(resolve, 6000));

      // Should transition to HALF_OPEN
      const canExecute = await breaker.canExecute('test');
      expect(canExecute).toBe(true);

      const state = await breaker.getState('test');
      expect(state).toBe('HALF_OPEN');
    });

    it('should close circuit on success from HALF_OPEN', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        await breaker.recordFailure('test');
      }

      // Wait for reset
      await new Promise((resolve) => setTimeout(resolve, 6000));

      // Allow probe
      await breaker.canExecute('test');

      // Record success
      await breaker.recordSuccess('test');

      const state = await breaker.getState('test');
      expect(state).toBe('CLOSED');
    });

    it('should re-open on failure from HALF_OPEN', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        await breaker.recordFailure('test');
      }

      // Wait for reset
      await new Promise((resolve) => setTimeout(resolve, 6000));

      // Allow probe (HALF_OPEN)
      await breaker.canExecute('test');

      // Record failure — should go back to OPEN
      await breaker.recordFailure('test');

      const state = await breaker.getState('test');
      expect(state).toBe('OPEN');
    });
  });

  describe('Reset', () => {
    it('should reset to CLOSED from any state', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        await breaker.recordFailure('test');
      }

      await breaker.reset('test');

      const state = await breaker.getState('test');
      expect(state).toBe('CLOSED');
    });
  });

  describe('Adversarial cases', () => {
    it('should reset failure count on success while CLOSED', async () => {
      // Record 2 failures (below threshold)
      await breaker.recordFailure('test');
      await breaker.recordFailure('test');

      // Record success — resets failure count
      await breaker.recordSuccess('test');

      // 2 more failures should NOT open the circuit (count was reset)
      await breaker.recordFailure('test');
      await breaker.recordFailure('test');

      const state = await breaker.getState('test');
      expect(state).toBe('CLOSED');
    });

    it('should handle independent keys separately', async () => {
      // Open circuit for key1
      for (let i = 0; i < 3; i++) {
        await breaker.recordFailure('key1');
      }

      // key2 should still be CLOSED
      const state = await breaker.getState('key2');
      expect(state).toBe('CLOSED');

      const canExecute = await breaker.canExecute('key2');
      expect(canExecute).toBe(true);

      await breaker.reset('key1');
      await breaker.reset('key2');
    });
  });
});
