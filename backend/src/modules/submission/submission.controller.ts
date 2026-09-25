import { Request, Response } from 'express';
import { COLLECTIONS, PLAGIARISM_JOB_STATUS } from '../../config/constants';
import { getFirestore } from '../../db/firestore';
import { plagiarismService } from '../plagiarism/service';
import { submissionLockGuard } from './submissionLock.guard';
import {
  submissionService,
  SubmissionServiceError,
  SubmissionRecord,
} from './submission.service';

function handleServiceError(res: Response, error: unknown): Response {
  if (error instanceof SubmissionServiceError) {
    return res
      .status(error.statusCode)
      .json({ error: { message: error.message, code: error.code } });
  }
  console.error('[Submission] Unexpected error:', error);
  return res.status(500).json({ error: { message: 'Internal error', code: 'INTERNAL_ERROR' } });
}

/**
 * Outcome of the best-effort plagiarism trigger, reported honestly in the
 * finalize response instead of a single static message:
 *  - QUEUED:  a job was created and enqueued
 *  - SKIPPED: intentionally not queued (below threshold / already active / no test)
 *  - FAILED:  queueing was attempted and threw
 */
type PlagiarismOutcome = {
  queued: boolean;
  status: 'QUEUED' | 'SKIPPED' | 'FAILED';
  jobId?: string;
  reason?: 'NOT_ENOUGH_SUBMISSIONS' | 'JOB_ALREADY_ACTIVE' | 'NO_TEST_ID' | 'QUEUE_ERROR';
  error?: string;
};

async function triggerPlagiarism(
  submission: SubmissionRecord,
  requestedBy: string | undefined
): Promise<PlagiarismOutcome> {
  try {
    const testId = submission.testId;
    if (!testId) {
      return { queued: false, status: 'SKIPPED', reason: 'NO_TEST_ID' };
    }

    // Idempotency: skip if this test already has an active job
    const existing = await plagiarismService.getJobsByTest(testId);
    const hasActiveJob = existing.some(
      (job) =>
        job.status === PLAGIARISM_JOB_STATUS.QUEUED ||
        job.status === PLAGIARISM_JOB_STATUS.PROCESSING
    );
    if (hasActiveJob) {
      return { queued: false, status: 'SKIPPED', reason: 'JOB_ALREADY_ACTIVE' };
    }

    const firestore = getFirestore();
    const snapshot = await firestore
      .collection(COLLECTIONS.SUBMISSIONS)
      .where('testId', '==', testId)
      .get();
    const submissionIds: string[] = snapshot.docs.map((doc: any) => doc.id);

    if (submissionIds.length < 2) {
      return { queued: false, status: 'SKIPPED', reason: 'NOT_ENOUGH_SUBMISSIONS' };
    }

    const job = await plagiarismService.createJob(testId, submissionIds, requestedBy ?? 'system');
    return { queued: true, status: 'QUEUED', jobId: job.id };
  } catch (error) {
    // Best-effort: finalize must never fail because plagiarism could not
    // be queued; the teacher can still trigger a job manually.
    console.error('[Submission] Best-effort plagiarism trigger failed:', error);
    return {
      queued: false,
      status: 'FAILED',
      reason: 'QUEUE_ERROR',
      error: (error as Error).message,
    };
  }
}

export class SubmissionController {
  async create(req: Request, res: Response) {
    // Idempotent: one submission per (test, student)
    const { testId } = req.body ?? {};
    const user = (req as any).user;
    if (!testId) {
      return res.status(400).json({ error: { message: 'testId required', code: 'VALIDATION_ERROR' } });
    }
    try {
      const { submission, created } = await submissionService.createSubmission(testId, user?.uid);
      // 201 = newly created, 200 = idempotent hit (existing submission returned)
      return res.status(created ? 201 : 200).json({ submission });
    } catch (error) {
      return handleServiceError(res, error);
    }
  }

  async getMySubmission(req: Request, res: Response) {
    const user = (req as any).user;
    const testId = req.query.testId;
    if (!testId || typeof testId !== 'string') {
      return res.status(400).json({ error: { message: 'testId required', code: 'VALIDATION_ERROR' } });
    }
    try {
      const submission = await submissionService.getSubmission(testId, user?.uid);
      return res.json({ submission });
    } catch (error) {
      return handleServiceError(res, error);
    }
  }

  async submit(req: Request, res: Response) {
    // Immutable once submitted — no PATCH/DELETE for submitted submissions
    const submissionId = req.params.id;
    const user = (req as any).user;
    const { code, language } = req.body ?? {};
    if (typeof code !== 'string') {
      return res.status(400).json({ error: { message: 'code required', code: 'VALIDATION_ERROR' } });
    }
    try {
      // Reuse submissionLockGuard for the non-concurrent lock check; the
      // service re-checks inside a transaction for concurrent double-submit.
      const existing = await submissionService.getSubmissionById(submissionId);
      (req as any).submission = existing;

      let allowed = false;
      submissionLockGuard(req, res, () => {
        allowed = true;
      });
      if (!allowed) return; // guard already sent the 409 response

      const submission = await submissionService.submitSubmission(
        submissionId,
        user?.uid,
        code,
        language
      );
      return res.json({ message: 'Submitted', submission });
    } catch (error) {
      return handleServiceError(res, error);
    }
  }

  /**
   * Finalize a submission and trigger the plagiarism chain:
   * finalize → job (QUEUED) → BullMQ → worker → AST engine → results.
   *
   * Truthful response:
   *  - 404 when the submission does not exist
   *  - 500 when the submission document itself cannot be written
   *  - 200 only when the submission document was really finalized, with a
   *    `plagiarism` field distinguishing QUEUED / SKIPPED / FAILED outcomes.
   *
   * The plagiarism trigger stays best-effort and non-blocking: a failed
   * trigger is reported in `plagiarism` but never fails finalize itself,
   * and repeated finalize calls with an existing QUEUED/PROCESSING job do
   * not create a duplicate job.
   */
  async finalize(req: Request, res: Response) {
    const submissionId = req.params.id;
    const user = (req as any).user;

    // 1. Finalize the submission record itself. Failures here are genuine
    //    finalize failures and must not be reported as success.
    let submission: SubmissionRecord;
    try {
      submission = await submissionService.finalizeSubmission(submissionId);
    } catch (error) {
      if (error instanceof SubmissionServiceError) {
        return res
          .status(error.statusCode)
          .json({ error: { message: error.message, code: error.code } });
      }
      console.error('[Submission] Finalize write failed:', error);
      return res
        .status(500)
        .json({ error: { message: 'Failed to finalize submission', code: 'INTERNAL_ERROR' } });
    }

    // 2. Best-effort plagiarism trigger — never throws, outcome reported.
    const plagiarism = await triggerPlagiarism(submission, user?.uid);

    return res.json({ message: 'Submission finalized', submission, plagiarism });
  }
}

export const submissionController = new SubmissionController();
