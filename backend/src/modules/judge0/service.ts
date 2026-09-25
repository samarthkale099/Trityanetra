import { judge0Client, Judge0Submission, Judge0Result, Judge0ValidationError } from './client';
import { judge0RateLimiter } from './rateLimiter';
import { judge0CircuitBreaker } from './circuitBreaker';
import { JUDGE0_BOUNDS } from '../../config/constants';

export type ExecutionStatus = 'SUBMITTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'TIMED_OUT' | 'EXECUTION_UNAVAILABLE';

export interface ExecutionResult {
  token: string;
  status: ExecutionStatus;
  judge0Result?: Judge0Result;
  error?: string;
}

export class Judge0Service {
  /**
   * Validate request bounds (request size + execution time limits) before
   * any external call. Returns an error message, or null when the request
   * is within bounds.
   */
  private validateRequestBounds(
    sourceCode: string,
    stdin?: string,
    cpuTimeLimit?: string,
    memoryLimit?: string,
  ): string | null {
    const sourceBytes = Buffer.byteLength(sourceCode, 'utf8');
    if (sourceBytes > JUDGE0_BOUNDS.MAX_SOURCE_BYTES) {
      return `Source code exceeds maximum size of ${JUDGE0_BOUNDS.MAX_SOURCE_BYTES} bytes (got ${sourceBytes})`;
    }

    if (stdin !== undefined) {
      const stdinBytes = Buffer.byteLength(stdin, 'utf8');
      if (stdinBytes > JUDGE0_BOUNDS.MAX_STDIN_BYTES) {
        return `stdin exceeds maximum size of ${JUDGE0_BOUNDS.MAX_STDIN_BYTES} bytes (got ${stdinBytes})`;
      }
    }

    if (cpuTimeLimit !== undefined) {
      const cpu = Number(cpuTimeLimit);
      if (!Number.isFinite(cpu) || cpu <= 0 || cpu > JUDGE0_BOUNDS.MAX_CPU_TIME_LIMIT_S) {
        return `cpu_time_limit must be a number in (0, ${JUDGE0_BOUNDS.MAX_CPU_TIME_LIMIT_S}] seconds (got "${cpuTimeLimit}")`;
      }
    }

    if (memoryLimit !== undefined) {
      const mem = Number(memoryLimit);
      if (!Number.isFinite(mem) || mem <= 0 || mem > JUDGE0_BOUNDS.MAX_MEMORY_LIMIT_MB) {
        return `memory_limit must be a number in (0, ${JUDGE0_BOUNDS.MAX_MEMORY_LIMIT_MB}] MB (got "${memoryLimit}")`;
      }
    }

    return null;
  }

  /**
   * Submit code for execution through Judge0.
   * Applies bounds validation, circuit breaker, and rate limiting before
   * making the API call. Every failure path returns a defined terminal
   * status — never throws for expected failure modes.
   */
  async submitCode(
    sourceCode: string,
    languageId: number,
    stdin?: string,
    cpuTimeLimit?: string,
    memoryLimit?: string,
    rateLimitKey: string = 'global'
  ): Promise<ExecutionResult> {
    // 0. Request size + execution time bounds (no external call made)
    const boundError = this.validateRequestBounds(sourceCode, stdin, cpuTimeLimit, memoryLimit);
    if (boundError) {
      return {
        token: '',
        status: 'FAILED',
        error: boundError,
      };
    }

    // 1. Check circuit breaker (fail closed if the breaker store is unavailable)
    let canExecute: boolean;
    try {
      canExecute = await judge0CircuitBreaker.canExecute();
    } catch {
      return {
        token: '',
        status: 'EXECUTION_UNAVAILABLE',
        error: 'Circuit breaker state unavailable — failing closed',
      };
    }
    if (!canExecute) {
      return {
        token: '',
        status: 'EXECUTION_UNAVAILABLE',
        error: 'Circuit breaker is OPEN — Judge0 API is experiencing failures',
      };
    }

    // 2. Check rate limiter (fail closed if the limiter store is unavailable)
    let rateLimitResult: { allowed: boolean; remaining: number; retryAfterMs?: number };
    try {
      rateLimitResult = await judge0RateLimiter.isAllowed(rateLimitKey);
    } catch {
      return {
        token: '',
        status: 'EXECUTION_UNAVAILABLE',
        error: 'Rate limiter unavailable — failing closed',
      };
    }
    if (!rateLimitResult.allowed) {
      return {
        token: '',
        status: 'FAILED',
        error: `Rate limit exceeded. Retry after ${rateLimitResult.retryAfterMs}ms`,
      };
    }

    // 3. Submit to Judge0
    try {
      const submission: Judge0Submission = {
        source_code: sourceCode,
        language_id: languageId,
        stdin,
        cpu_time_limit: cpuTimeLimit ?? JUDGE0_BOUNDS.DEFAULT_CPU_TIME_LIMIT_S,
        memory_limit: memoryLimit ?? JUDGE0_BOUNDS.DEFAULT_MEMORY_LIMIT_MB,
      };

      const result = await judge0Client.submit(submission);
      await judge0CircuitBreaker.recordSuccess();

      return {
        token: result.token,
        status: 'SUBMITTED',
      };
    } catch (error) {
      await judge0CircuitBreaker.recordFailure();

      if (error instanceof Judge0ValidationError) {
        return {
          token: '',
          status: 'FAILED',
          error: `Invalid Judge0 response: ${error.message}`,
        };
      }

      return {
        token: '',
        status: 'FAILED',
        error: `Judge0 submission failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Get the execution result for a given token.
   * Routes all failure modes (timeout, unavailable, malformed response,
   * network error) through the circuit breaker. Maps Judge0 status to our
   * internal ExecutionStatus.
   */
  async getExecutionResult(token: string): Promise<ExecutionResult> {
    // Circuit breaker check — fail closed if the breaker store is unavailable
    let canExecute: boolean;
    try {
      canExecute = await judge0CircuitBreaker.canExecute();
    } catch {
      return {
        token,
        status: 'EXECUTION_UNAVAILABLE',
        error: 'Circuit breaker state unavailable — failing closed',
      };
    }
    if (!canExecute) {
      return {
        token,
        status: 'EXECUTION_UNAVAILABLE',
        error: 'Circuit breaker is OPEN — Judge0 API is experiencing failures',
      };
    }

    try {
      const result = await judge0Client.getResult(token);
      await judge0CircuitBreaker.recordSuccess();
      const status = this.mapJudge0Status(result);

      return {
        token: result.token,
        status,
        judge0Result: result,
      };
    } catch (error) {
      // Malformed responses and network errors both count as Judge0 failures
      try {
        await judge0CircuitBreaker.recordFailure();
      } catch {
        // Fail safe: breaker bookkeeping must not mask the defined result
      }

      if (error instanceof Judge0ValidationError) {
        return {
          token,
          status: 'FAILED',
          error: `Invalid Judge0 response: ${error.message}`,
        };
      }

      return {
        token,
        status: 'FAILED',
          error: `Failed to get Judge0 result: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Poll for execution result until completion or timeout.
   * Always terminates with a defined status — never loops forever.
   */
  async waitForResult(token: string, maxWaitMs: number = JUDGE0_BOUNDS.MAX_WAIT_MS, pollIntervalMs: number = 1000): Promise<ExecutionResult> {
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      const result = await this.getExecutionResult(token);

      if (result.status !== 'SUBMITTED' && result.status !== 'PROCESSING') {
        return result;
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    return {
      token,
      status: 'TIMED_OUT',
      error: `Execution timed out after ${maxWaitMs}ms`,
    };
  }

  /**
   * Map Judge0 status codes to our internal ExecutionStatus.
   * Handles edge cases and unknown status codes gracefully.
   */
  private mapJudge0Status(result: Judge0Result): ExecutionStatus {
    const statusId = result.status.id;

    // Judge0 status codes: https://judge0.com/docs/api-reference/status-codes
    switch (statusId) {
      case 1: // In Queue
      case 2: // Processing
        return 'PROCESSING';
      case 3: // Accepted
        return 'COMPLETED';
      case 5: // Time Limit Exceeded
        return 'TIMED_OUT';
      case 4: // Wrong Answer
      case 6: // Compilation Error
      case 7: // Runtime Error (SIGSEGV)
      case 8: // Runtime Error (SIGXFSZ)
      case 9: // Runtime Error (SIGFPE)
      case 10: // Runtime Error (SIGABRT)
      case 11: // Runtime Error (NZEC)
      case 12: // Runtime Error (Other)
      case 13: // Internal Error
      case 14: // Exec Format Error
        return 'COMPLETED'; // Execution completed (even if error)
      default:
        // Unknown status — treat as completed with warning
        if (statusId >= 1 && statusId <= 2) return 'PROCESSING';
        return 'COMPLETED';
    }
  }
}

export const judge0Service = new Judge0Service();
