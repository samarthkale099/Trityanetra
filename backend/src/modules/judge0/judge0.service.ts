import { submitCodeWithBreaker, runSyncWithBreaker } from './judge0.circuitBreaker';
import { COLLECTIONS } from '../../db/collections';
import { db } from '../../db/firestore';
import { env } from '../../config/env';
import { Judge0CallbackBody } from './judge0.callback.schema';
import { Judge0RawResult } from './judge0.client';
import { ALLOWED_LANGUAGE_IDS, JUDGE0_BOUNDS } from './judge0.constants';

const httpError = (status: number, message: string) => {
  const error: any = new Error(message);
  error.status = status;
  return error;
};

export interface RunRequester {
  uid: string;
  collegeId?: string | null;
}

/**
 * Starts a code run for a student taking a test.
 * The run record (judge0Runs/<run id>, PENDING) is created BEFORE Judge0 is called, and its id travels in
 * the callback URL, so a fast callback can never arrive before the record exists.
 */
export const runCodeService = async (
  requester: RunRequester,
  testId: string,
  code: string,
  languageId: number,
  stdin?: string
): Promise<{ runId: string; status: 'PENDING' | 'DONE'; result?: ReturnType<typeof buildResult> }> => {
  if (!ALLOWED_LANGUAGE_IDS.includes(languageId)) throw httpError(400, 'Unsupported language');
  if (Buffer.byteLength(code, 'utf8') > JUDGE0_BOUNDS.MAX_SOURCE_BYTES) throw httpError(400, 'Source code is too large');
  if (stdin !== undefined && Buffer.byteLength(stdin, 'utf8') > JUDGE0_BOUNDS.MAX_STDIN_BYTES) {
    throw httpError(400, 'stdin is too large');
  }

  // Judge0 itself must be configured. The callback URL/token are only needed for async mode.
  if (!env.JUDGE0_API_URL || !env.JUDGE0_API_KEY) {
    throw httpError(503, 'Code execution is not configured');
  }
  // Async callback mode needs both the public base URL and the shared token; without them we run synchronously.
  const asyncMode = !!(env.JUDGE0_CALLBACK_BASE_URL && env.JUDGE0_CALLBACK_TOKEN);

  const ref = db.collection(COLLECTIONS.JUDGE0_RUNS).doc();
  await ref.set({
    status: 'PENDING',
    userId: requester.uid,
    collegeId: requester.collegeId ?? null,
    testId,
    languageId,
    createdAt: new Date(),
  });

  try {
    if (asyncMode) {
      const callbackUrl =
        `${env.JUDGE0_CALLBACK_BASE_URL!.replace(/\/+$/, '')}/api/judge0/callback/` +
        `${encodeURIComponent(env.JUDGE0_CALLBACK_TOKEN!)}?run=${ref.id}`;
      const { token } = await submitCodeWithBreaker(code, languageId, { stdin, callbackUrl });
      await ref.update({ judge0Token: token });
      return { runId: ref.id, status: 'PENDING' };
    }

    // Synchronous: wait for the result inline (works on localhost, no public URL needed).
    const raw: Judge0RawResult = await runSyncWithBreaker(code, languageId, { stdin });
    const result = buildResult(raw);
    await ref.update({ status: 'DONE', result, judge0Token: raw.token ?? null, completedAt: new Date() });
    return { runId: ref.id, status: 'DONE', result };
  } catch (error) {
    // The run failed, so no result is coming: close it so it is not left PENDING forever.
    console.error('Judge0 run failed:', (error as Error).message);
    await ref.update({ status: 'FAILED', error: 'Code execution service unavailable', completedAt: new Date() });
    throw httpError(502, 'Code execution service unavailable');
  }
};

/** A run's status and result, only for the user who started it (anyone else gets 404, not 403). */
export const getRunService = async (requester: RunRequester, runId: string) => {
  const snap = await db.collection(COLLECTIONS.JUDGE0_RUNS).doc(runId).get();
  const run = snap.data();
  if (!snap.exists || !run || run.userId !== requester.uid) throw httpError(404, 'Run not found');
  return { runId, status: run.status, result: run.result ?? null, error: run.error ?? null };
};

// Judge0 status ids 1 (In Queue) and 2 (Processing) are not final results.
const NON_FINAL_STATUS_IDS = [1, 2];

/** Normalizes a Judge0 result into the shape we store on a run. */
const buildResult = (body: { status: { id: number; description?: string }; stdout?: any; stderr?: any; compile_output?: any; message?: any; time?: any; memory?: any }) => ({
  statusId: body.status.id,
  statusDescription: body.status.description ?? null,
  stdout: body.stdout ?? null,
  stderr: body.stderr ?? null,
  compileOutput: body.compile_output ?? null,
  message: body.message ?? null,
  time: body.time ?? null,
  memory: body.memory ?? null,
});

/**
 * Applies a Judge0 result to our run (judge0Runs/<run id>). Only a run that is still PENDING can be
 * completed, exactly once:
 *  - unknown run id            -> ignored (nothing is created)
 *  - already completed (replay) -> ignored, the stored result is never overwritten
 *  - non-final status (queue/processing) -> ignored
 */
export const recordJudge0Result = async (
  runId: string,
  body: Judge0CallbackBody
): Promise<{ applied: boolean; reason?: 'unknown-run' | 'not-pending' | 'not-final' }> => {
  if (NON_FINAL_STATUS_IDS.includes(body.status.id)) {
    return { applied: false, reason: 'not-final' };
  }

  const ref = db.collection(COLLECTIONS.JUDGE0_RUNS).doc(runId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { applied: false, reason: 'unknown-run' as const };
    if (snap.data()?.status !== 'PENDING') return { applied: false, reason: 'not-pending' as const };

    tx.update(ref, {
      status: 'DONE',
      result: {
        statusId: body.status.id,
        statusDescription: body.status.description ?? null,
        stdout: body.stdout ?? null,
        stderr: body.stderr ?? null,
        compileOutput: body.compile_output ?? null,
        message: body.message ?? null,
        time: body.time ?? null,
        memory: body.memory ?? null,
      },
      completedAt: new Date(),
    });
    return { applied: true };
  });
};
