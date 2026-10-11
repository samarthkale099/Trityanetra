import { Queue } from 'bullmq';
import { redis } from '../../lib/redis';

export let plagiarismQueue: Queue;

export const initPlagiarismQueue = () => {
  if (!plagiarismQueue) {
    plagiarismQueue = new Queue('plagiarism-check', { connection: redis });
    plagiarismQueue.on('error', (err) => console.error(err.message));
  }
};

export const enqueuePlagiarismCheck = async (testId: string) => {
  if (!plagiarismQueue) initPlagiarismQueue();
  await plagiarismQueue.add('check-test', { testId });
};
