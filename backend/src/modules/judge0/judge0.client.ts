import { env } from '../../config/env';
import { JUDGE0_BOUNDS } from './judge0.constants';

export interface Judge0SubmitOptions {
  stdin?: string;
  /** Full URL Judge0 calls back with the result (async mode only). */
  callbackUrl?: string;
}

// The normalized result of one execution, as our app stores it.
export interface Judge0RawResult {
  status: { id: number; description?: string };
  stdout?: string | null;
  stderr?: string | null;
  compile_output?: string | null;
  message?: string | null;
  time?: string | number | null;
  memory?: number | null;
  token?: string;
}

export class Judge0NotConfiguredError extends Error {
  status = 503;
  constructor() {
    super('Code execution is not configured');
    this.name = 'Judge0NotConfiguredError';
  }
}

const base = () => {
  if (!env.JUDGE0_API_URL || !env.JUDGE0_API_KEY) throw new Judge0NotConfiguredError();
  return env.JUDGE0_API_URL.replace(/\/+$/, '');
};

/**
 * Auth headers for whichever Judge0 this is. Self-hosted Judge0 CE reads X-Auth-Token; the RapidAPI-hosted
 * Judge0 CE reads X-RapidAPI-Key + X-RapidAPI-Host. We send the matching ones (detected from the URL host),
 * and X-Auth-Token always, so either kind of server works without extra configuration.
 */
export const judge0Headers = (): Record<string, string> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = env.JUDGE0_API_KEY;
  if (!key) return headers;
  headers['X-Auth-Token'] = key;
  try {
    const host = new URL(env.JUDGE0_API_URL as string).host;
    if (host.endsWith('rapidapi.com')) {
      headers['X-RapidAPI-Key'] = key;
      headers['X-RapidAPI-Host'] = host;
    }
  } catch {
    /* URL parse failure is reported elsewhere */
  }
  return headers;
};

const submissionBody = (code: string, languageId: number, stdin?: string) => ({
  source_code: code,
  language_id: languageId,
  ...(stdin !== undefined ? { stdin } : {}),
  cpu_time_limit: JUDGE0_BOUNDS.CPU_TIME_LIMIT_S,
  memory_limit: JUDGE0_BOUNDS.MEMORY_LIMIT_KB,
});

const isFinal = (statusId: unknown) => typeof statusId === 'number' && statusId > 2; // 1=queue, 2=processing

/**
 * ASYNC submit (wait=false): the result arrives later on callbackUrl. Returns Judge0's submission token.
 * Used when the backend has a public callback URL (production).
 */
export const submitCodeToJudge0 = async (
  code: string,
  languageId: number,
  options: Judge0SubmitOptions = {}
): Promise<{ token: string }> => {
  const url = `${base()}/submissions?base64_encoded=false&wait=false`;
  const res = await fetch(url, {
    method: 'POST',
    headers: judge0Headers(),
    body: JSON.stringify({ ...submissionBody(code, languageId, options.stdin), ...(options.callbackUrl ? { callback_url: options.callbackUrl } : {}) }),
    signal: AbortSignal.timeout(JUDGE0_BOUNDS.HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Judge0 responded with HTTP ${res.status}`);
  const data: any = await res.json().catch(() => null);
  if (!data || typeof data.token !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(data.token)) {
    throw new Error('Judge0 returned an invalid response (missing or malformed token)');
  }
  return { token: data.token };
};

/** Fetches a submission's current state by token. */
export const getJudge0Submission = async (token: string): Promise<Judge0RawResult> => {
  const url = `${base()}/submissions/${encodeURIComponent(token)}?base64_encoded=false`;
  const res = await fetch(url, { headers: judge0Headers(), signal: AbortSignal.timeout(JUDGE0_BOUNDS.HTTP_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Judge0 responded with HTTP ${res.status}`);
  const data: any = await res.json().catch(() => null);
  if (!data || !data.status || typeof data.status.id !== 'number') {
    throw new Error('Judge0 returned an invalid result');
  }
  return data as Judge0RawResult;
};

/**
 * SYNC run: submit with wait=true (one request on servers that honor it), then poll until the result is final
 * or we time out. Needs no public callback URL, so it works on localhost. Returns the final result.
 */
export const runCodeToJudge0Sync = async (
  code: string,
  languageId: number,
  options: Judge0SubmitOptions = {}
): Promise<Judge0RawResult> => {
  const res = await fetch(`${base()}/submissions?base64_encoded=false&wait=true`, {
    method: 'POST',
    headers: judge0Headers(),
    body: JSON.stringify(submissionBody(code, languageId, options.stdin)),
    signal: AbortSignal.timeout(JUDGE0_BOUNDS.HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Judge0 responded with HTTP ${res.status}`);
  let data: any = await res.json().catch(() => null);
  if (!data || !data.status || typeof data.status.id !== 'number') {
    throw new Error('Judge0 returned an invalid result');
  }

  // Some instances ignore wait=true and return a queued submission; poll by token until it is final.
  const token: string | undefined = typeof data.token === 'string' ? data.token : undefined;
  const deadline = Date.now() + JUDGE0_BOUNDS.SYNC_MAX_WAIT_MS;
  while (!isFinal(data.status.id) && token && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, JUDGE0_BOUNDS.SYNC_POLL_INTERVAL_MS));
    data = await getJudge0Submission(token);
  }
  if (!isFinal(data.status.id)) throw new Error('Judge0 run did not finish in time');
  return data as Judge0RawResult;
};
