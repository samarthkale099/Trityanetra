import { submitCodeWithBreaker } from './judge0.circuitBreaker';
import { COLLECTIONS } from '../../db/collections';
import { db } from '../../db/firestore';
import { Judge0CallbackBody } from './judge0.callback.schema';

export const runCodeService = async (code: string, languageId: number) => {
  return await submitCodeWithBreaker(code, languageId);
};

// Judge0 status ids 1 (In Queue) and 2 (Processing) are not final results.
const NON_FINAL_STATUS_IDS = [1, 2];

/**
 * Applies a Judge0 result to the run we created when the code was submitted (judge0Runs/<judge0 token>,
 * status PENDING). Only a run that is still PENDING can be completed, exactly once:
 *  - unknown token            -> ignored (nothing is created)
 *  - already completed (replay) -> ignored, the stored result is never overwritten
 *  - non-final status (queue/processing) -> ignored
 */
export const recordJudge0Result = async (
  body: Judge0CallbackBody
): Promise<{ applied: boolean; reason?: 'unknown-run' | 'not-pending' | 'not-final' }> => {
  if (NON_FINAL_STATUS_IDS.includes(body.status.id)) {
    return { applied: false, reason: 'not-final' };
  }

  const ref = db.collection(COLLECTIONS.JUDGE0_RUNS).doc(body.token);

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
