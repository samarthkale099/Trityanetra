import { env } from '../../config/env';
import { Judge0RawResult } from './judge0.client';
import { JUDGE0_BOUNDS } from './judge0.constants';

// Piston (https://github.com/engineer-man/piston) is a free, open code-execution engine. Its public API
// needs no key, so it is the default provider. It is synchronous: /execute returns the result directly.
const PISTON_URL = () => (env.PISTON_API_URL || 'https://emkc.org/api/v2/piston').replace(/\/+$/, '');
// Some public instances sit behind a bot filter that rejects requests with no User-Agent.
const PISTON_HEADERS = { 'Content-Type': 'application/json', 'User-Agent': 'Trityanetra/1.0 (+code-execution)' };

// Our language ids are Judge0's; map them to Piston language names (same ids stay in the frontend/allowlist).
export const PISTON_LANGUAGE: Record<number, string> = {
  50: 'c',
  54: 'c++',
  62: 'java',
  63: 'javascript',
  71: 'python',
};

// Cache of Piston language/alias -> version, fetched once from /runtimes.
let runtimeCache: Record<string, string> | null = null;
export const _resetPistonRuntimeCache = () => { runtimeCache = null; };

const resolveVersion = async (language: string): Promise<string> => {
  if (!runtimeCache) {
    const res = await fetch(`${PISTON_URL()}/runtimes`, { headers: PISTON_HEADERS, signal: AbortSignal.timeout(JUDGE0_BOUNDS.HTTP_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Piston /runtimes responded with HTTP ${res.status}`);
    const list: any = await res.json().catch(() => null);
    if (!Array.isArray(list)) throw new Error('Piston returned an invalid runtimes list');
    const map: Record<string, string> = {};
    for (const rt of list) {
      for (const name of [rt.language, ...(rt.aliases || [])]) {
        if (typeof name === 'string' && !(name in map) && typeof rt.version === 'string') map[name] = rt.version;
      }
    }
    runtimeCache = map;
  }
  const v = runtimeCache[language];
  if (!v) throw new Error(`Piston has no runtime for ${language}`);
  return v;
};

// Translate Piston's output into the same result shape Judge0 produces, so the rest of the app is unchanged.
const normalize = (data: any): Judge0RawResult => {
  const compile = data.compile;
  const run = data.run || {};
  if (compile && typeof compile.code === 'number' && compile.code !== 0) {
    return { status: { id: 6, description: 'Compilation Error' }, stdout: run.stdout ?? null, stderr: run.stderr ?? null, compile_output: compile.stderr || compile.output || null, time: null, memory: null };
  }
  let id = 3, description = 'Accepted';
  if (run.signal === 'SIGKILL' || run.signal === 'SIGTERM' || run.signal === 'SIGXCPU') {
    id = 5; description = 'Time Limit Exceeded';
  } else if (typeof run.code === 'number' && run.code !== 0) {
    id = 11; description = 'Runtime Error (NZEC)';
  }
  return { status: { id, description }, stdout: run.stdout ?? null, stderr: run.stderr ?? null, compile_output: null, time: null, memory: null };
};

/** Runs code on Piston and returns the result in the Judge0 result shape. */
export const runCodeOnPiston = async (languageId: number, code: string, stdin?: string): Promise<Judge0RawResult> => {
  const language = PISTON_LANGUAGE[languageId];
  if (!language) throw new Error('Unsupported language');
  const version = await resolveVersion(language);

  const res = await fetch(`${PISTON_URL()}/execute`, {
    method: 'POST',
    headers: PISTON_HEADERS,
    body: JSON.stringify({
      language,
      version,
      files: [{ content: code }],
      stdin: stdin ?? '',
      run_timeout: JUDGE0_BOUNDS.CPU_TIME_LIMIT_S * 1000,
    }),
    signal: AbortSignal.timeout(JUDGE0_BOUNDS.HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Piston /execute responded with HTTP ${res.status}`);
  const data: any = await res.json().catch(() => null);
  if (!data || !data.run || typeof data.run !== 'object') throw new Error('Piston returned an invalid result');
  return normalize(data);
};
