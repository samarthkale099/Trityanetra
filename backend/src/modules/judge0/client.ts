import axios, { AxiosInstance, AxiosError } from 'axios';
import { env } from '../../config/env';
import { JUDGE0_BOUNDS } from '../../config/constants';

export interface Judge0Submission {
  source_code: string;
  language_id: number;
  stdin?: string;
  expected_output?: string;
  cpu_time_limit?: string;
  memory_limit?: string;
}

export interface Judge0Result {
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  status: {
    id: number;
    description: string;
  };
  time: string | null;
  memory: number | null;
  token: string;
}

export interface Judge0BatchResponse {
  submissions: Judge0Result[];
}

export class Judge0Client {
  private http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: env.JUDGE0_API_URL,
      timeout: JUDGE0_BOUNDS.HTTP_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        ...(env.JUDGE0_API_KEY ? { 'X-Auth-Token': env.JUDGE0_API_KEY } : {}),
      },
    });
  }

  /**
   * Submit code for execution.
   * Validates response structure before returning.
   */
  async submit(submission: Judge0Submission): Promise<{ token: string }> {
    const response = await this.handleHttp(this.http.post('/submissions', submission));
    const data = response.data;

    // Validate structure
    if (!data || typeof data.token !== 'string') {
      throw new Judge0ValidationError('Invalid response: missing or invalid token');
    }

    return { token: data.token };
  }

  /**
   * Submit a batch of code for execution.
   * Validates each submission result before returning.
   */
  async submitBatch(submissions: Judge0Submission[]): Promise<{ token: string }> {
    const response = await this.handleHttp(
      this.http.post('/submissions?base64_encoded=false&wait=false', {
        submissions,
      })
    );

    const data = response.data;
    if (!data || typeof data.token !== 'string') {
      throw new Judge0ValidationError('Invalid batch response: missing or invalid token');
    }

    return { token: data.token };
  }

  /**
   * Get the status of a submission by token.
   * Validates the result structure before returning.
   */
  async getResult(token: string): Promise<Judge0Result> {
    const response = await this.handleHttp(
      this.http.get(`/submissions/${token}?base64_encoded=false`)
    );
    return this.validateResult(response.data);
  }

  /**
   * Get the status of a batch submission.
   */
  async getBatchResult(token: string): Promise<Judge0BatchResponse> {
    const response = await this.handleHttp(
      this.http.get(`/submissions/${token}?base64_encoded=false`)
    );
    const data = response.data;

    if (!data || !Array.isArray(data.submissions)) {
      throw new Judge0ValidationError('Invalid batch response: missing submissions array');
    }

    return {
      submissions: data.submissions.map((s: any) => this.validateResult(s)),
    };
  }

  /**
   * Execute an HTTP promise, converting rejected responses into proper Errors.
   * Guarantees every failure path rejects with an Error (defined terminal state).
   */
  private async handleHttp(promise: Promise<{ data: any }>): Promise<{ data: any }> {
    try {
      return await promise;
    } catch (error) {
      if (error instanceof Error) throw error;

      const status = (error as { response?: { status?: number } })?.response?.status;
      throw new Judge0RequestError(
        status
          ? `Judge0 responded with HTTP status ${status}`
          : 'Judge0 request failed'
      );
    }
  }

  /**
   * Validate a single Judge0 result to ensure it matches expected structure.
   * Rejects malformed payloads that could cause crashes or unvalidated DB writes.
   */
  private validateResult(data: any): Judge0Result {
    if (!data || typeof data !== 'object') {
      throw new Judge0ValidationError('Result is not an object');
    }

    if (typeof data.token !== 'string') {
      throw new Judge0ValidationError('Result missing token');
    }

    if (!data.status || typeof data.status.id !== 'number' || typeof data.status.description !== 'string') {
      throw new Judge0ValidationError('Result has invalid status field');
    }

    // Validate optional numeric bounds
    if (data.memory !== null && data.memory !== undefined) {
      if (typeof data.memory !== 'number' || data.memory < 0) {
        throw new Judge0ValidationError('Result has invalid memory value');
      }
    }

    // Output size bound: reject oversized stdout/stderr/compile_output
    this.assertOutputSize('stdout', data.stdout);
    this.assertOutputSize('stderr', data.stderr);
    this.assertOutputSize('compile_output', data.compile_output);

    return {
      stdout: data.stdout ?? null,
      stderr: data.stderr ?? null,
      compile_output: data.compile_output ?? null,
      status: {
        id: data.status.id,
        description: data.status.description,
      },
      time: data.time ?? null,
      memory: data.memory ?? null,
      token: data.token,
    };
  }

  /**
   * Enforce the output size bound on a single output field.
   */
  private assertOutputSize(field: string, value: unknown): void {
    if (value === null || value === undefined) return;
    if (typeof value !== 'string') {
      throw new Judge0ValidationError(`Result has invalid ${field} value`);
    }
    if (value.length > JUDGE0_BOUNDS.MAX_OUTPUT_CHARS) {
      throw new Judge0ValidationError(
        `Result ${field} exceeds maximum output size of ${JUDGE0_BOUNDS.MAX_OUTPUT_CHARS} characters`
      );
    }
  }
}

export class Judge0ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Judge0ValidationError';
  }
}

export class Judge0RequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Judge0RequestError';
  }
}

// Singleton
export const judge0Client = new Judge0Client();
