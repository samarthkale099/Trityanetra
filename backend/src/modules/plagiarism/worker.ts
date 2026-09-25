import { Worker, Job } from 'bullmq';
import { getRedisClient } from '../../lib/redis';
import { plagiarismService } from './service';
import { PlagiarismJobData } from './queue';
import { PLAGIARISM_JOB_STATUS } from '../../config/constants';

const WORKER_NAME = 'plagiarism-worker';

/**
 * Process a single plagiarism job. Exported so tests can invoke the full
 * worker logic directly without a live BullMQ connection.
 *
 * Chain: QUEUED → PROCESSING → (AST engine) → results stored → COMPLETED
 * Failure: any error → FAILED (with error message). No path leaves the job
 * in an ambiguous state, and status values are only ever from the
 * QUEUED | PROCESSING | COMPLETED | FAILED enum.
 */
export async function processPlagiarismJob(job: Job<PlagiarismJobData>): Promise<any> {
  console.log(`[Plagiarism Worker] Processing job ${job.id} for test ${job.data.testId}`);

  try {
    // 1. Update job status to PROCESSING
    await plagiarismService.updateJobStatus(job.data.jobId, PLAGIARISM_JOB_STATUS.PROCESSING);

    // 2. Get submission codes from Firestore
    const submissions = await plagiarismService.getSubmissionsForJob(job.data.submissionIds);

    if (submissions.length < 2) {
      // Not enough submissions to compare — mark as completed with no pairs
      await plagiarismService.updateJobStatus(job.data.jobId, PLAGIARISM_JOB_STATUS.COMPLETED);
      await plagiarismService.storeResult(job.data.jobId, {
        pairs: [],
        flagged: [],
        summary: {
          totalSubmissions: submissions.length,
          totalPairs: 0,
          flaggedPairs: 0,
          processingTimeMs: 0,
        },
      });
      return { result: 'completed_no_pairs' };
    }

    // 3. Call AST engine (validated output — malformed throws here)
    const astResult = await plagiarismService.callASTEEngine(submissions);

    // 4. Store results
    await plagiarismService.storeResult(job.data.jobId, astResult);

    // 5. Create plagiarism results for each flagged pair
    await plagiarismService.storePlagiarismResults(job.data.testId, job.data.jobId, astResult.flagged);

    // 6. Update job status to COMPLETED
    await plagiarismService.updateJobStatus(job.data.jobId, PLAGIARISM_JOB_STATUS.COMPLETED);

    console.log(`[Plagiarism Worker] Job ${job.id} completed: ${astResult.summary.flaggedPairs} flagged pairs`);

    return { result: 'completed', flaggedPairs: astResult.summary.flaggedPairs };
  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error(`[Plagiarism Worker] Job ${job.id} failed:`, errorMessage);

    // Update to terminal failure state — wrapped so a status-write failure
    // cannot mask the original error path.
    try {
      await plagiarismService.updateJobStatus(
        job.data.jobId,
        PLAGIARISM_JOB_STATUS.FAILED,
        errorMessage
      );
    } catch (statusError) {
      console.error('[Plagiarism Worker] Failed to mark job FAILED:', statusError);
    }

    // Re-throw to let BullMQ handle retries
    throw error;
  }
}

/**
 * Create and start the plagiarism detection worker.
 */
export function createPlagiarismWorker(): Worker {
  const redis = getRedisClient();

  const worker = new Worker(WORKER_NAME, processPlagiarismJob, {
    connection: redis,
    concurrency: 2,
    limiter: {
      max: 5,
      duration: 60000, // Max 5 jobs per minute
    },
  });

  worker.on('failed', (job, error) => {
    console.error(`[Plagiarism Worker] Job ${job?.id} failed permanently:`, error.message);
  });

  worker.on('completed', (job) => {
    console.log(`[Plagiarism Worker] Job ${job.id} completed`);
  });

  worker.on('error', (error) => {
    console.error(`[Plagiarism Worker] Error:`, error.message);
  });

  return worker;
}

/**
 * Handle stalled jobs — mark them as FAILED.
 * This ensures no job is left in a permanently ambiguous state.
 * (Stalled maps to FAILED: the allowed enum has no TIMED_OUT value.)
 */
export async function handleStalledJobs(): Promise<void> {
  const { getFirestore } = await import('../../db/firestore');
  const firestore = getFirestore();

  // Find jobs that have been PROCESSING for too long (>5 minutes)
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const stalledJobs = await firestore
    .collection('plagiarismJobs')
    .where('status', '==', PLAGIARISM_JOB_STATUS.PROCESSING)
    .where('updatedAt', '<', fiveMinutesAgo)
    .get();

  for (const doc of stalledJobs.docs) {
    console.warn(`[Plagiarism Worker] Marking stalled job ${doc.id} as FAILED`);
    await plagiarismService.updateJobStatus(
      doc.id,
      PLAGIARISM_JOB_STATUS.FAILED,
      'Job exceeded maximum processing time'
    );
  }
}

export { WORKER_NAME };
