import { Queue, QueueOptions } from 'bullmq';
import { getRedisClient } from '../../lib/redis';

const PLAGIARISM_QUEUE_NAME = 'plagiarism-detection';

/**
 * Create a BullMQ connection config using the shared Redis client.
 */
function getQueueConfig(): QueueOptions {
  const redis = getRedisClient();
  return {
    connection: redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: {
        age: 86400, // Keep completed jobs for 24 hours
        count: 100,
      },
      removeOnFail: {
        age: 86400,
        count: 50,
      },
    },
  };
}

/**
 * Plagiarism job data interface.
 */
export interface PlagiarismJobData {
  jobId: string;
  testId: string;
  submissionIds: string[];
  createdBy: string;
}

/**
 * Create and enqueue a plagiarism detection job.
 */
export async function enqueuePlagiarismJob(data: PlagiarismJobData): Promise<string> {
  const queue = new Queue(PLAGIARISM_QUEUE_NAME, getQueueConfig());
  
  try {
    const job = await queue.add('detect', data, {
      jobId: data.jobId,
    });
    return job.id!;
  } finally {
    await queue.close();
  }
}

/**
 * Get the plagiarism queue instance.
 */
export function getPlagiarismQueue(): Queue {
  return new Queue(PLAGIARISM_QUEUE_NAME, getQueueConfig());
}

export { PLAGIARISM_QUEUE_NAME };
