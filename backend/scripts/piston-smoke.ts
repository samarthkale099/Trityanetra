// Proves code execution works live via Piston (free, no key). Run from backend/:
//   npx ts-node scripts/piston-smoke.ts
import { runCodeOnPiston } from '../src/modules/judge0/piston.client';

async function main() {
  console.log('Running print(2+2) on Piston (free public API)…');
  const res = await runCodeOnPiston(71, 'print(2 + 2)');
  console.log('status :', res.status.description);
  console.log('stdout :', JSON.stringify(res.stdout));
  if ((res.stdout || '').trim() !== '4') {
    console.error('FAIL: expected 4');
    process.exit(1);
  }
  console.log('\nOK: Piston works. Code execution is live with no key and no cost.');
  process.exit(0);
}
main().catch((e) => {
  console.error('FAIL: could not reach Piston:', e instanceof Error ? e.message : 'error');
  console.error('(Check your internet connection; the public Piston API must be reachable.)');
  process.exit(1);
});
