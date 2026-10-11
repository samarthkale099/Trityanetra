import CircuitBreaker from 'opossum';
import { submitCodeToJudge0 } from './judge0.client';

// Circuit breaker configuration
// - timeout: 10000ms (10s is a sane max wait time for code execution to return from Judge0)
// - errorThresholdPercentage: 50 (if 50% of requests fail in the window, trip the breaker)
// - resetTimeout: 30000 (wait 30s before trying again)
// - volumeThreshold: 5 (minimum 5 requests in the rolling window before tripping)
const options = {
  timeout: 10000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 5,
};

export const judge0CircuitBreaker = new CircuitBreaker(submitCodeToJudge0, options);

export const submitCodeWithBreaker = async (code: string, languageId: number) => {
  try {
    return await judge0CircuitBreaker.fire(code, languageId);
  } catch (error: any) {
    if (error && error.code === 'EOPENBREAKER') {
      throw new Error('Judge0 temporarily unavailable');
    }
    throw error;
  }
};
