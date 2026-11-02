import { env } from '../../config/env';
import { JUDGE0_BOUNDS } from './judge0.constants';

export interface Judge0SubmitOptions {
  stdin?: string;
  /** Full URL Judge0 calls back with the result. */
  callbackUrl?: string;
}

export class Judge0NotConfiguredError extends Error {
  status = 503;
  constructor() {
    super('Code execution is not configured');
    this.name = 'Judge0NotConfiguredError';
  }
}

/**
 * Submits code to Judge0 CE (POST /submissions, asynchronous). The result arrives later on callbackUrl.
 * ASSUMPTION: a Judge0 CE server that authenticates with the X-Auth-Token header (JUDGE0_API_KEY).
 * Returns Judge0's own token for the submission.
 */
export const submitCodeToJudge0 = async (
  code: string,
  languageId: number,
  options: Judge0SubmitOptions = {}
): Promise<{ token: string }> => {
  if (!env.JUDGE0_API_URL || !env.JUDGE0_API_KEY) throw new Judge0NotConfiguredError();

  const url = `${env.JUDGE0_API_URL.replace(/\/+$/, '')}/submissions?base64_encoded=false&wait=false`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': env.JUDGE0_API_KEY },
    body: JSON.stringify({
      source_code: code,
      language_id: languageId,
      ...(options.stdin !== undefined ? { stdin: options.stdin } : {}),
      cpu_time_limit: JUDGE0_BOUNDS.CPU_TIME_LIMIT_S,
      memory_limit: JUDGE0_BOUNDS.MEMORY_LIMIT_KB,
      ...(options.callbackUrl ? { callback_url: options.callbackUrl } : {}),
    }),
    signal: AbortSignal.timeout(JUDGE0_BOUNDS.HTTP_TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`Judge0 responded with HTTP ${res.status}`);

  const data: any = await res.json().catch(() => null);
  if (!data || typeof data.token !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(data.token)) {
    throw new Error('Judge0 returned an invalid response (missing or malformed token)');
  }
  return { token: data.token };
};
