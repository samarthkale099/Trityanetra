import { env } from '../../config/env';
import { Judge0RawResult } from './judge0.client';
import { JUDGE0_BOUNDS } from './judge0.constants';

// Paiza.IO (https://api.paiza.io) is a free code-execution API. Its built-in "guest" key means no signup
// and no card. It is asynchronous: create a job, poll until it completes, then fetch the details.
const PAIZA_URL = () => (env.PAIZA_API_URL || 'https://api.paiza.io').replace(/\/+$/, '');
const PAIZA_KEY = () => env.PAIZA_API_KEY || 'guest';

// Our (Judge0) language ids mapped to Paiza language names.
export const PAIZA_LANGUAGE: Record<number, string> = {
  50: 'c',
  54: 'cpp',
  62: 'java',
  63: 'javascript',
  71: 'python3',
};

const qs = (params: Record<string, string>) => new URLSearchParams(params).toString();

const normalize = (d: any): Judge0RawResult => {
  // A build failure is a compilation error.
  if (d.build_result && d.build_result !== 'success') {
    return { status: { id: 6, description: 'Compilation Error' }, stdout: d.stdout ?? null, stderr: d.stderr ?? null, compile_output: d.build_stderr || null, time: d.time ?? null, memory: d.memory ?? null };
  }
  let id = 3, description = 'Accepted';
  if (d.result === 'timeout') { id = 5; description = 'Time Limit Exceeded'; }
  else if (d.result !== 'success' || (typeof d.exit_code === 'number' && d.exit_code !== 0) || d.exit_code === 'failure') {
    id = 11; description = 'Runtime Error (NZEC)';
  }
  return { status: { id, description }, stdout: d.stdout ?? null, stderr: d.stderr ?? null, compile_output: d.build_stderr || null, time: d.time ?? null, memory: typeof d.memory === 'number' ? d.memory : null };
};

/** Runs code on Paiza and returns the result in the Judge0 result shape. */
export const runCodeOnPaiza = async (languageId: number, code: string, stdin?: string): Promise<Judge0RawResult> => {
  const language = PAIZA_LANGUAGE[languageId];
  if (!language) throw new Error('Unsupported language');
  const key = PAIZA_KEY();

  const createRes = await fetch(`${PAIZA_URL()}/runners/create.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: qs({ source_code: code, language, input: stdin ?? '', longpoll: 'true', api_key: key }),
    signal: AbortSignal.timeout(JUDGE0_BOUNDS.HTTP_TIMEOUT_MS),
  });
  if (!createRes.ok) throw new Error(`Paiza create responded with HTTP ${createRes.status}`);
  const created: any = await createRes.json().catch(() => null);
  if (!created || typeof created.id === 'undefined') throw new Error('Paiza returned an invalid create response');

  const id = String(created.id);
  let status: string = created.status;
  const deadline = Date.now() + JUDGE0_BOUNDS.SYNC_MAX_WAIT_MS;
  while (status !== 'completed' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, JUDGE0_BOUNDS.SYNC_POLL_INTERVAL_MS));
    const st = await fetch(`${PAIZA_URL()}/runners/get_status.json?${qs({ id, api_key: key })}`, { signal: AbortSignal.timeout(JUDGE0_BOUNDS.HTTP_TIMEOUT_MS) });
    if (!st.ok) throw new Error(`Paiza get_status responded with HTTP ${st.status}`);
    const sd: any = await st.json().catch(() => null);
    status = sd?.status;
  }
  if (status !== 'completed') throw new Error('Paiza run did not finish in time');

  const detRes = await fetch(`${PAIZA_URL()}/runners/get_details.json?${qs({ id, api_key: key })}`, { signal: AbortSignal.timeout(JUDGE0_BOUNDS.HTTP_TIMEOUT_MS) });
  if (!detRes.ok) throw new Error(`Paiza get_details responded with HTTP ${detRes.status}`);
  const details: any = await detRes.json().catch(() => null);
  if (!details || typeof details !== 'object') throw new Error('Paiza returned an invalid result');
  return normalize(details);
};
