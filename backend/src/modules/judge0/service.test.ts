import { Judge0Service } from './service';
import { judge0Client, Judge0ValidationError } from './client';
import { judge0RateLimiter } from './rateLimiter';
import { judge0CircuitBreaker } from './circuitBreaker';
import { JUDGE0_BOUNDS } from '../../config/constants';

jest.mock('./client');
jest.mock('./rateLimiter');
jest.mock('./circuitBreaker');

const mockClient = jest.mocked(judge0Client);
const mockRateLimiter = jest.mocked(judge0RateLimiter);
const mockCircuitBreaker = jest.mocked(judge0CircuitBreaker);

describe('Judge0Service', () => {
  let service: Judge0Service;

  beforeEach(() => {
    service = new Judge0Service();
    jest.clearAllMocks();
    // Default: breaker closed and rate limiter open (individual tests override)
    mockCircuitBreaker.canExecute.mockResolvedValue(true);
    mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true, remaining: 29 });
  });

  describe('submitCode', () => {
    it('should submit successfully when all checks pass', async () => {
      mockCircuitBreaker.canExecute.mockResolvedValue(true);
      mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true, remaining: 29 });
      mockClient.submit.mockResolvedValue({ token: 'token-123' });

      const result = await service.submitCode('print("hello")', 71);

      expect(result.token).toBe('token-123');
      expect(result.status).toBe('SUBMITTED');
      expect(mockCircuitBreaker.recordSuccess).toHaveBeenCalled();
    });

    it('should return EXECUTION_UNAVAILABLE when circuit breaker is open', async () => {
      mockCircuitBreaker.canExecute.mockResolvedValue(false);

      const result = await service.submitCode('code', 71);

      expect(result.status).toBe('EXECUTION_UNAVAILABLE');
      expect(result.error).toContain('Circuit breaker');
      expect(mockClient.submit).not.toHaveBeenCalled();
    });

    it('should return FAILED when rate limit exceeded', async () => {
      mockCircuitBreaker.canExecute.mockResolvedValue(true);
      mockRateLimiter.isAllowed.mockResolvedValue({ allowed: false, remaining: 0, retryAfterMs: 30000 });

      const result = await service.submitCode('code', 71);

      expect(result.status).toBe('FAILED');
      expect(result.error).toContain('Rate limit');
      expect(mockClient.submit).not.toHaveBeenCalled();
    });

    it('should record circuit breaker failure on submission error', async () => {
      mockCircuitBreaker.canExecute.mockResolvedValue(true);
      mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true, remaining: 29 });
      mockClient.submit.mockRejectedValue(new Error('Connection refused'));

      const result = await service.submitCode('code', 71);

      expect(result.status).toBe('FAILED');
      expect(mockCircuitBreaker.recordFailure).toHaveBeenCalled();
    });

    it('should handle Judge0 validation errors', async () => {
      mockCircuitBreaker.canExecute.mockResolvedValue(true);
      mockRateLimiter.isAllowed.mockResolvedValue({ allowed: true, remaining: 29 });
      mockClient.submit.mockRejectedValue(new Judge0ValidationError('Invalid response'));

      const result = await service.submitCode('code', 71);

      expect(result.status).toBe('FAILED');
      expect(result.error).toContain('Invalid Judge0 response');
      expect(mockCircuitBreaker.recordFailure).toHaveBeenCalled();
    });
  });

  describe('Rule 5: request size and execution time bounds', () => {
    it('should reject source code over MAX_SOURCE_BYTES without calling Judge0', async () => {
      const oversized = 'x'.repeat(JUDGE0_BOUNDS.MAX_SOURCE_BYTES + 1);

      const result = await service.submitCode(oversized, 71);

      expect(result.status).toBe('FAILED');
      expect(result.error).toContain('Source code exceeds maximum size');
      expect(mockClient.submit).not.toHaveBeenCalled();
      expect(mockCircuitBreaker.canExecute).not.toHaveBeenCalled();
      expect(mockRateLimiter.isAllowed).not.toHaveBeenCalled();
    });

    it('should accept source code of exactly MAX_SOURCE_BYTES (at the boundary)', async () => {
      mockClient.submit.mockResolvedValue({ token: 'at-limit' });
      const exact = 'x'.repeat(JUDGE0_BOUNDS.MAX_SOURCE_BYTES);

      const result = await service.submitCode(exact, 71);

      expect(result.status).toBe('SUBMITTED');
      expect(mockClient.submit).toHaveBeenCalledTimes(1);
    });

    it('should accept source code under MAX_SOURCE_BYTES', async () => {
      mockClient.submit.mockResolvedValue({ token: 'under-limit' });
      const under = 'x'.repeat(JUDGE0_BOUNDS.MAX_SOURCE_BYTES - 1);

      const result = await service.submitCode(under, 71);

      expect(result.status).toBe('SUBMITTED');
    });

    it('should measure source size in bytes, not characters (multi-byte UTF-8)', async () => {
      // Each '€' is 3 bytes in UTF-8: MAX/3 chars already over the byte budget
      const multiByte = '€'.repeat(Math.ceil(JUDGE0_BOUNDS.MAX_SOURCE_BYTES / 3) + 1);

      const result = await service.submitCode(multiByte, 71);

      expect(result.status).toBe('FAILED');
      expect(result.error).toContain('Source code exceeds maximum size');
      expect(mockClient.submit).not.toHaveBeenCalled();
    });

    it('should reject stdin over MAX_STDIN_BYTES', async () => {
      const oversizedStdin = 'y'.repeat(JUDGE0_BOUNDS.MAX_STDIN_BYTES + 1);

      const result = await service.submitCode('print(1)', 71, oversizedStdin);

      expect(result.status).toBe('FAILED');
      expect(result.error).toContain('stdin exceeds maximum size');
      expect(mockClient.submit).not.toHaveBeenCalled();
    });

    it('should accept stdin of exactly MAX_STDIN_BYTES', async () => {
      mockClient.submit.mockResolvedValue({ token: 'stdin-at-limit' });
      const exactStdin = 'y'.repeat(JUDGE0_BOUNDS.MAX_STDIN_BYTES);

      const result = await service.submitCode('print(1)', 71, exactStdin);

      expect(result.status).toBe('SUBMITTED');
    });

    it('should reject cpuTimeLimit above the maximum (execution time bound)', async () => {
      const result = await service.submitCode('print(1)', 71, undefined, String(JUDGE0_BOUNDS.MAX_CPU_TIME_LIMIT_S + 1));

      expect(result.status).toBe('FAILED');
      expect(result.error).toContain('cpu_time_limit');
      expect(mockClient.submit).not.toHaveBeenCalled();
    });

    it('should reject a non-numeric cpuTimeLimit', async () => {
      const result = await service.submitCode('print(1)', 71, undefined, 'abc');

      expect(result.status).toBe('FAILED');
      expect(result.error).toContain('cpu_time_limit');
      expect(mockClient.submit).not.toHaveBeenCalled();
    });

    it('should reject a non-positive cpuTimeLimit', async () => {
      const result = await service.submitCode('print(1)', 71, undefined, '0');

      expect(result.status).toBe('FAILED');
      expect(result.error).toContain('cpu_time_limit');
      expect(mockClient.submit).not.toHaveBeenCalled();
    });

    it('should apply default cpu_time_limit and memory_limit when not provided', async () => {
      mockClient.submit.mockResolvedValue({ token: 'defaults' });

      await service.submitCode('print(1)', 71);

      expect(mockClient.submit).toHaveBeenCalledWith(
        expect.objectContaining({
          cpu_time_limit: JUDGE0_BOUNDS.DEFAULT_CPU_TIME_LIMIT_S,
          memory_limit: JUDGE0_BOUNDS.DEFAULT_MEMORY_LIMIT_MB,
        })
      );
    });

    it('should reject memoryLimit above the maximum', async () => {
      const result = await service.submitCode(
        'print(1)',
        71,
        undefined,
        undefined,
        String(JUDGE0_BOUNDS.MAX_MEMORY_LIMIT_MB + 1)
      );

      expect(result.status).toBe('FAILED');
      expect(result.error).toContain('memory_limit');
      expect(mockClient.submit).not.toHaveBeenCalled();
    });
  });

  describe('Rule 3: fail-closed when infrastructure is unavailable', () => {
    it('should return EXECUTION_UNAVAILABLE when the breaker store errors on canExecute', async () => {
      mockCircuitBreaker.canExecute.mockRejectedValue(new Error('redis down'));

      const result = await service.submitCode('print(1)', 71);

      expect(result.status).toBe('EXECUTION_UNAVAILABLE');
      expect(result.error).toContain('failing closed');
      expect(mockClient.submit).not.toHaveBeenCalled();
    });

    it('should return EXECUTION_UNAVAILABLE when the rate limiter store errors', async () => {
      mockRateLimiter.isAllowed.mockRejectedValue(new Error('redis down'));

      const result = await service.submitCode('print(1)', 71);

      expect(result.status).toBe('EXECUTION_UNAVAILABLE');
      expect(result.error).toContain('failing closed');
      expect(mockClient.submit).not.toHaveBeenCalled();
    });
  });

  describe('getExecutionResult', () => {
    it('should return COMPLETED for accepted submissions', async () => {
      mockClient.getResult.mockResolvedValue({
        token: 'token-123',
        stdout: 'hello\n',
        stderr: null,
        compile_output: null,
        status: { id: 3, description: 'Accepted' },
        time: '0.01',
        memory: 1024,
      });

      const result = await service.getExecutionResult('token-123');

      expect(result.status).toBe('COMPLETED');
      expect(result.judge0Result?.stdout).toBe('hello\n');
    });

    it('should return PROCESSING for in-queue submissions', async () => {
      mockClient.getResult.mockResolvedValue({
        token: 'token-123',
        stdout: null,
        stderr: null,
        compile_output: null,
        status: { id: 1, description: 'In Queue' },
        time: null,
        memory: null,
      });

      const result = await service.getExecutionResult('token-123');

      expect(result.status).toBe('PROCESSING');
    });

    it('should return FAILED for validation errors', async () => {
      mockClient.getResult.mockRejectedValue(new Judge0ValidationError('Invalid'));

      const result = await service.getExecutionResult('token-123');

      expect(result.status).toBe('FAILED');
      expect(result.error).toContain('Invalid Judge0 response');
    });

    it('should return FAILED for network errors', async () => {
      mockClient.getResult.mockRejectedValue(new Error('Network error'));

      const result = await service.getExecutionResult('token-123');

      expect(result.status).toBe('FAILED');
      expect(result.error).toContain('Network error');
    });

    it('Rule 7: should record a circuit breaker failure on network error', async () => {
      mockClient.getResult.mockRejectedValue(new Error('Network error'));

      await service.getExecutionResult('token-123');

      expect(mockCircuitBreaker.recordFailure).toHaveBeenCalled();
    });

    it('Rule 7: should record a circuit breaker failure on malformed response', async () => {
      mockClient.getResult.mockRejectedValue(new Judge0ValidationError('bad shape'));

      await service.getExecutionResult('token-123');

      expect(mockCircuitBreaker.recordFailure).toHaveBeenCalled();
    });

    it('Rule 7: should record a circuit breaker success on valid response', async () => {
      mockClient.getResult.mockResolvedValue({
        token: 'token-123',
        stdout: null,
        stderr: null,
        compile_output: null,
        status: { id: 3, description: 'Accepted' },
        time: '0.01',
        memory: 100,
      });

      await service.getExecutionResult('token-123');

      expect(mockCircuitBreaker.recordSuccess).toHaveBeenCalled();
    });

    it('Rule 7: returns EXECUTION_UNAVAILABLE when breaker is open (no Judge0 call)', async () => {
      mockCircuitBreaker.canExecute.mockResolvedValue(false);

      const result = await service.getExecutionResult('token-123');

      expect(result.status).toBe('EXECUTION_UNAVAILABLE');
      expect(result.error).toContain('Circuit breaker');
      expect(mockClient.getResult).not.toHaveBeenCalled();
    });

    it('Rule 7: fails closed with EXECUTION_UNAVAILABLE when breaker store errors', async () => {
      mockCircuitBreaker.canExecute.mockRejectedValue(new Error('redis down'));

      const result = await service.getExecutionResult('token-123');

      expect(result.status).toBe('EXECUTION_UNAVAILABLE');
      expect(result.error).toContain('failing closed');
      expect(mockClient.getResult).not.toHaveBeenCalled();
    });

    it('Rule 7: always returns a defined status — never undefined', async () => {
      mockClient.getResult.mockRejectedValue(new Error('boom'));

      const result = await service.getExecutionResult('token-123');

      expect(result.status).toBeDefined();
      expect(typeof result.status).toBe('string');
      expect(['SUBMITTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'TIMED_OUT', 'EXECUTION_UNAVAILABLE']).toContain(
        result.status
      );
    });

    it('Rule 5: maps Judge0 time-limit-exceeded (status 5) to TIMED_OUT', async () => {
      mockClient.getResult.mockResolvedValue({
        token: 'token-123',
        stdout: null,
        stderr: null,
        compile_output: null,
        status: { id: 5, description: 'Time Limit Exceeded' },
        time: '2.0',
        memory: 512,
      });

      const result = await service.getExecutionResult('token-123');

      expect(result.status).toBe('TIMED_OUT');
    });
  });

  describe('waitForResult', () => {
    it('should return result when completed', async () => {
      const completedResult = {
        token: 'token-123',
        stdout: 'hello\n',
        stderr: null,
        compile_output: null,
        status: { id: 3, description: 'Accepted' },
        time: '0.01',
        memory: 1024,
      };

      mockClient.getResult.mockResolvedValue(completedResult);

      const result = await service.waitForResult('token-123', 5000, 100);

      expect(result.status).toBe('COMPLETED');
    });

    it('should return TIMED_OUT when max wait exceeded', async () => {
      const processingResult = {
        token: 'token-123',
        stdout: null,
        stderr: null,
        compile_output: null,
        status: { id: 2, description: 'Processing' },
        time: null,
        memory: null,
      };

      mockClient.getResult.mockResolvedValue(processingResult);

      const result = await service.waitForResult('token-123', 500, 100);

      expect(result.status).toBe('TIMED_OUT');
    });

    it('Rule 7: terminates with a defined status if the breaker opens mid-wait', async () => {
      mockCircuitBreaker.canExecute.mockResolvedValue(false);

      const result = await service.waitForResult('token-123', 5000, 100);

      expect(result.status).toBe('EXECUTION_UNAVAILABLE');
    });
  });
});
