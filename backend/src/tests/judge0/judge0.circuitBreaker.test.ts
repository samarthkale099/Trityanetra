import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as client from '../../modules/judge0/judge0.client';
import { submitCodeWithBreaker, judge0CircuitBreaker } from '../../modules/judge0/judge0.circuitBreaker';

vi.mock('../../modules/judge0/judge0.client', () => ({
  submitCodeToJudge0: vi.fn(),
}));

describe('Judge0 Circuit Breaker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Close the breaker before each test if it was left open
    if (judge0CircuitBreaker.opened) {
      judge0CircuitBreaker.close();
    }
    judge0CircuitBreaker.clearCache();
  });

  it('should open the circuit breaker after threshold failures and fail fast', async () => {
    // Mock the client to simulate a failing Judge0 call
    const mockSubmit = vi.mocked(client.submitCodeToJudge0);
    mockSubmit.mockImplementation(async () => {
      // Simulate some delay before failing
      return new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Simulated Judge0 Timeout or Failure')), 20);
      });
    });

    // Fire requests until the breaker trips
    let mockCallsBeforeOpen = 0;
    while (!judge0CircuitBreaker.opened && mockCallsBeforeOpen < 20) {
      try {
        mockCallsBeforeOpen++;
        await submitCodeWithBreaker('console.log("hello")', 63);
      } catch (err: any) {
        // expected to fail
      }
    }
    
    expect(judge0CircuitBreaker.opened).toBe(true);

    // Now the circuit is open. The next call should fail FAST.
    const startTime = Date.now();
    try {
      await submitCodeWithBreaker('console.log("hello")', 63);
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      const duration = Date.now() - startTime;
      expect(err.message).toBe('Judge0 temporarily unavailable');
      
      // Should fail almost instantly, well under the 20ms delay we mocked
      expect(duration).toBeLessThan(15);
    }
    
    // The underlying mock should not have been called for this last fast-failing request
    expect(mockSubmit).toHaveBeenCalledTimes(mockCallsBeforeOpen);
  });
});
