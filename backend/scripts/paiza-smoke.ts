// Proves code execution works live via Paiza.IO (free, built-in guest key, no signup). Run from backend/:
//   npx ts-node scripts/paiza-smoke.ts
import { runCodeOnPaiza } from '../src/modules/judge0/paiza.client';

async function main() {
  console.log('Running print(2+2) on Paiza.IO (free, guest key)…');
  const res = await runCodeOnPaiza(71, 'print(2 + 2)');
  console.log('status :', res.status.description);
  console.log('stdout :', JSON.stringify(res.stdout));
  if ((res.stdout || '').trim() !== '4') {
    console.error('FAIL: expected 4');
    process.exit(1);
  }
  console.log('\nOK: Paiza works. Code execution is live with no key and no cost.');
  console.log('Set CODE_EXECUTION_PROVIDER=paiza in backend/.env to use it in the app.');
  process.exit(0);
}
main().catch((e) => {
  console.error('FAIL: could not reach Paiza:', e instanceof Error ? e.message : 'error');
  process.exit(1);
});
