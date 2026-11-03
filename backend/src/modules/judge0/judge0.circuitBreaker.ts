import CircuitBreaker from 'opossum';
import { submitCodeToJudge0, runCodeToJudge0Sync, Judge0SubmitOptions, Judge0RawResult } from './judge0.client';

// Circuit breaker: if Judge0 keeps failing, stop calling it for a while so requests fail fast.
const options = {
  timeout: 20000, // a sync run may submit + poll, so allow a little over SYNC_MAX_WAIT_MS
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 5,
};

type Mode = 'async' | 'sync';
const dispatch = (mode: Mode, code: string, languageId: number, opts: Judge0SubmitOptions) =>
  mode === 'sync' ? runCodeToJudge0Sync(code, languageId, opts) : submitCodeToJudge0(code, languageId, opts);

export const judge0CircuitBreaker = new CircuitBreaker(dispatch as any, options);

const fire = async <T>(mode: Mode, code: string, languageId: number, opts: Judge0SubmitOptions): Promise<T> => {
  try {
    return (await judge0CircuitBreaker.fire(mode, code, languageId, opts)) as T;
  } catch (error: any) {
    if (error && error.code === 'EOPENBREAKER') throw new Error('Judge0 temporarily unavailable');
    throw error;
  }
};

/** Async submit through the breaker (production, callback mode). */
export const submitCodeWithBreaker = (code: string, languageId: number, opts: Judge0SubmitOptions = {}) =>
  fire<{ token: string }>('async', code, languageId, opts);

/** Synchronous run through the breaker (localhost mode). */
export const runSyncWithBreaker = (code: string, languageId: number, opts: Judge0SubmitOptions = {}) =>
  fire<Judge0RawResult>('sync', code, languageId, opts);
