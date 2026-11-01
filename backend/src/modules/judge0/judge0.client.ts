import { env } from '../../config/env';
import type { Judge0Result } from './judge0.types';

const toBase64 = (value: string) => Buffer.from(value, 'utf8').toString('base64');
const fromBase64 = (value: string | null | undefined) =>
  value ? Buffer.from(value, 'base64').toString('utf8') : null;

/**
 * Runs one program on Judge0 and waits for the result (`wait=true`).
 *
 * Works with a self-hosted Judge0 CE (auth via `X-Auth-Token`) or the RapidAPI
 * hosted service (detected from the URL). Bodies are base64-encoded both ways
 * so any byte in code or output survives. Limits are kept tight: this runs
 * student code, and the circuit breaker stops a struggling Judge0 being
 * hammered.
 */
export const submitCodeToJudge0 = async (
  code: string,
  languageId: number,
  stdin = ''
): Promise<Judge0Result> => {
  if (!env.JUDGE0_API_URL || !env.JUDGE0_API_KEY) {
    throw new Error('Judge0 integration not yet configured — missing JUDGE0_API_URL/JUDGE0_API_KEY');
  }

  const base = env.JUDGE0_API_URL.replace(/\/+$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (base.includes('rapidapi')) {
    headers['X-RapidAPI-Key'] = env.JUDGE0_API_KEY;
    headers['X-RapidAPI-Host'] = new URL(base).host;
  } else {
    headers['X-Auth-Token'] = env.JUDGE0_API_KEY;
  }

  const response = await fetch(`${base}/submissions?base64_encoded=true&wait=true`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      source_code: toBase64(code),
      language_id: languageId,
      stdin: toBase64(stdin),
      cpu_time_limit: 5,
      wall_time_limit: 10,
      memory_limit: 256000,
      enable_network: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Judge0 returned ${response.status}`);
  }

  const raw: any = await response.json();
  return {
    stdout: fromBase64(raw.stdout),
    stderr: fromBase64(raw.stderr),
    compile_output: fromBase64(raw.compile_output),
    message: fromBase64(raw.message),
    status: raw.status ?? { id: 0, description: 'Unknown' },
    time: raw.time ?? null,
    memory: typeof raw.memory === 'number' ? raw.memory : null,
  };
};
