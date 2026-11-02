// Checks the Judge0 setup against the real server, using the values in backend/.env.
//   npx ts-node scripts/judge0-smoke.ts
// Read-only apart from one tiny test program (it prints 2). Never prints the URL or the key.
import * as dotenv from 'dotenv';
import { ALLOWED_LANGUAGE_IDS } from '../src/modules/judge0/judge0.constants';

dotenv.config();

const url = process.env.JUDGE0_API_URL;
const key = process.env.JUDGE0_API_KEY;

const set = (v?: string) => (v ? 'set' : 'MISSING');
console.log('JUDGE0_API_URL           :', set(url));
console.log('JUDGE0_API_KEY           :', set(key));
console.log('JUDGE0_CALLBACK_TOKEN    :', set(process.env.JUDGE0_CALLBACK_TOKEN), '(needed to run code in the app)');
console.log('JUDGE0_CALLBACK_BASE_URL :', set(process.env.JUDGE0_CALLBACK_BASE_URL), '(needed to run code in the app)');

if (!url || !key) {
  console.error('\nFAIL: JUDGE0_API_URL and JUDGE0_API_KEY must be set in backend/.env first.');
  process.exit(1);
}

const base = url.replace(/\/+$/, '');
const headers = { 'Content-Type': 'application/json', 'X-Auth-Token': key };

async function main() {
  // 1. Reachable and the X-Auth-Token header is accepted? Which language ids exist?
  const langRes = await fetch(`${base}/languages`, { headers, signal: AbortSignal.timeout(15000) });
  console.log('\nGET /languages           : HTTP', langRes.status);
  if (!langRes.ok) {
    console.error(
      langRes.status === 401 || langRes.status === 403
        ? 'FAIL: the server rejected the key. It may not use X-Auth-Token (e.g. RapidAPI uses other headers).'
        : 'FAIL: unexpected response from the languages endpoint.'
    );
    process.exit(1);
  }
  const languages = (await langRes.json()) as { id: number; name: string }[];
  const byId = new Map(languages.map((l) => [l.id, l.name]));

  console.log('\nLanguage ids the app allows (judge0.constants.ts):');
  let missing = 0;
  for (const id of ALLOWED_LANGUAGE_IDS) {
    const name = byId.get(id);
    if (!name) missing++;
    console.log(`  ${id}: ${name ?? 'NOT FOUND on this server'}`);
  }
  if (missing) console.error(`FAIL: ${missing} allowed id(s) do not exist here. Edit ALLOWED_LANGUAGE_IDS.`);

  // 2. Run one tiny program synchronously (no callback needed) and check the output.
  const pyId = byId.has(71) ? 71 : undefined;
  if (pyId === undefined) {
    console.error('\nSKIP: no language 71, cannot run the sample program.');
    process.exit(missing ? 1 : 0);
  }
  const runRes = await fetch(`${base}/submissions?base64_encoded=false&wait=true`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ source_code: 'print(1 + 1)', language_id: pyId }),
    signal: AbortSignal.timeout(30000),
  });
  console.log('\nPOST /submissions (wait) : HTTP', runRes.status);
  const run: any = await runRes.json().catch(() => null);
  const out = typeof run?.stdout === 'string' ? run.stdout.trim() : null;
  console.log('status                   :', run?.status?.description ?? 'unknown');
  console.log('stdout                   :', out);

  if (out !== '2') {
    console.error('FAIL: the sample program did not print 2.');
    process.exit(1);
  }
  console.log(missing ? '\nPARTIAL: execution works, fix the language ids above.' : '\nOK: Judge0 reachable, key accepted, language ids valid, code runs.');
  process.exit(missing ? 1 : 0);
}

main().catch((e) => {
  // Print only the error name/message class, never the request URL.
  console.error('FAIL: could not reach Judge0:', e instanceof Error ? e.name : 'error');
  process.exit(1);
});
