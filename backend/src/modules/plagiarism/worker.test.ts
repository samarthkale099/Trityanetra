import { processPlagiarismJob, handleStalledJobs } from './worker';
import { createInMemoryFirestore } from '../../testUtils/inMemoryFirestore';
import { PLAGIARISM_JOB_STATUS } from '../../config/constants';
import axios from 'axios';

const mockFirestore = createInMemoryFirestore();

jest.mock('../../db/firestore', () => ({ getFirestore: () => mockFirestore.getFirestore() }));
jest.mock('./queue', () => ({
  enqueuePlagiarismJob: jest.fn().mockResolvedValue('bull-job-1'),
}));
jest.mock('axios');

const validAstPayload = () => ({
  pairs: [
    {
      submissionA: 'sub1',
      submissionB: 'sub2',
      metrics: {
        cosine_similarity: 0.95,
        ted_score: 0.9,
        identifier_overlap: 0.85,
        operator_overlap: 0.8,
        combined_score: 0.9,
      },
      flagLevel: 'high',
    },
  ],
  flagged: [
    {
      submissionA: 'sub1',
      submissionB: 'sub2',
      metrics: {
        cosine_similarity: 0.95,
        ted_score: 0.9,
        identifier_overlap: 0.85,
        operator_overlap: 0.8,
        combined_score: 0.9,
      },
      flagLevel: 'high',
    },
  ],
  summary: { totalSubmissions: 2, totalPairs: 1, flaggedPairs: 1, processingTimeMs: 42 },
});

const seedTwoSubmissions = () => {
  mockFirestore.seed('submissions', 'sub1', {
    id: 'sub1', testId: 't1', code: 'print(1)', language: 'python', studentId: 's1',
  });
  mockFirestore.seed('submissions', 'sub2', {
    id: 'sub2', testId: 't1', code: 'print(1)', language: 'python', studentId: 's2',
  });
};

const seedJob = (id = 'job-1') => {
  mockFirestore.seed('plagiarismJobs', id, {
    id, testId: 't1', submissionIds: ['sub1', 'sub2'],
    status: PLAGIARISM_JOB_STATUS.QUEUED,
    createdBy: 'teacher-1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
  return id;
};

const makeJob = (jobId: string) => ({
  id: 'bull-1',
  data: { jobId, testId: 't1', submissionIds: ['sub1', 'sub2'], createdBy: 'teacher-1' },
} as any);

describe('Plagiarism worker processor (rule 8/9/10)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFirestore.reset();
  });

  it('runs the full chain: PROCESSING → AST → results stored → COMPLETED', async () => {
    seedTwoSubmissions();
    const jobId = seedJob();
    (axios.post as jest.Mock).mockResolvedValue({ data: validAstPayload() });

    const result = await processPlagiarismJob(makeJob(jobId));

    expect(result).toEqual({ result: 'completed', flaggedPairs: 1 });
    const job = mockFirestore.row('plagiarismJobs', jobId)!;
    expect(job.status).toBe(PLAGIARISM_JOB_STATUS.COMPLETED);
    expect(job.result).toBeDefined();
    expect(job.result.summary.flaggedPairs).toBe(1);

    // Flagged pair was written for the teacher report
    const results = mockFirestore.rows('plagiarismResults');
    expect(results).toHaveLength(1);
    expect(results[0].data.flagLevel).toBe('high');
    expect(results[0].data.submissionA).toBe('sub1');
    expect(results[0].data.jobId).toBe(jobId);

    // AST engine was called with the authenticated internal secret header
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/plagiarism/check'),
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Internal-Secret': expect.any(String) }),
      })
    );
  });

  it('marks COMPLETED with no pairs when fewer than 2 submissions exist (AST not called)', async () => {
    mockFirestore.seed('submissions', 'sub1', {
      id: 'sub1', testId: 't1', code: 'print(1)', language: 'python', studentId: 's1',
    });
    const jobId = seedJob();

    const result = await processPlagiarismJob(makeJob(jobId));

    expect(result).toEqual({ result: 'completed_no_pairs' });
    expect(axios.post).not.toHaveBeenCalled();
    const job = mockFirestore.row('plagiarismJobs', jobId)!;
    expect(job.status).toBe(PLAGIARISM_JOB_STATUS.COMPLETED);
    expect(job.result.pairs).toEqual([]);
  });

  it('Rule 8: malformed AST output → job FAILED, no crash, error recorded', async () => {
    seedTwoSubmissions();
    const jobId = seedJob();
    (axios.post as jest.Mock).mockResolvedValue({
      data: { pairs: 'garbage', flagged: null, summary: 'nope' },
    });

    await expect(processPlagiarismJob(makeJob(jobId))).rejects.toThrow('Invalid AST engine response');

    const job = mockFirestore.row('plagiarismJobs', jobId)!;
    expect(job.status).toBe(PLAGIARISM_JOB_STATUS.FAILED);
    expect(job.error).toContain('Invalid AST engine response');
    // No partial results written
    expect(mockFirestore.rows('plagiarismResults')).toHaveLength(0);
  });

  it('Rule 8: AST engine unreachable → job FAILED with defined terminal status', async () => {
    seedTwoSubmissions();
    const jobId = seedJob();
    (axios.post as jest.Mock).mockRejectedValue({ code: 'ECONNREFUSED', message: 'refused' });

    await expect(processPlagiarismJob(makeJob(jobId))).rejects.toThrow('AST engine is unavailable');

    const job = mockFirestore.row('plagiarismJobs', jobId)!;
    expect(job.status).toBe(PLAGIARISM_JOB_STATUS.FAILED);
    expect(job.error).toBe('AST engine is unavailable');
  });

  it('Rule 8: metric out of bounds (1.5) → job FAILED', async () => {
    seedTwoSubmissions();
    const jobId = seedJob();
    const payload = validAstPayload();
    payload.pairs[0].metrics.combined_score = 1.5;
    (axios.post as jest.Mock).mockResolvedValue({ data: payload });

    await expect(processPlagiarismJob(makeJob(jobId))).rejects.toThrow('Invalid AST engine response');
    expect(mockFirestore.row('plagiarismJobs', jobId)!.status).toBe(PLAGIARISM_JOB_STATUS.FAILED);
  });

  it('Rule 10: every status written during processing is from the allowed enum', async () => {
    seedTwoSubmissions();
    const jobId = seedJob();
    (axios.post as jest.Mock).mockResolvedValue({ data: validAstPayload() });

    await processPlagiarismJob(makeJob(jobId));

    const allowed = Object.values(PLAGIARISM_JOB_STATUS);
    const finalStatus = mockFirestore.row('plagiarismJobs', jobId)!.status;
    expect(allowed).toContain(finalStatus);
    expect(allowed).not.toContain('PENDING');
    expect(allowed).not.toContain('TIMED_OUT');
  });
});

describe('handleStalledJobs (rule 10: stalled → FAILED, never TIMED_OUT)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFirestore.reset();
  });

  it('marks stalled PROCESSING jobs as FAILED', async () => {
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    mockFirestore.seed('plagiarismJobs', 'stalled-1', {
      id: 'stalled-1',
      status: PLAGIARISM_JOB_STATUS.PROCESSING,
      updatedAt: stale,
      testId: 't1',
    });
    mockFirestore.seed('plagiarismJobs', 'fresh-1', {
      id: 'fresh-1',
      status: PLAGIARISM_JOB_STATUS.PROCESSING,
      updatedAt: new Date().toISOString(),
      testId: 't1',
    });

    await handleStalledJobs();

    const stalled = mockFirestore.row('plagiarismJobs', 'stalled-1')!;
    expect(stalled.status).toBe(PLAGIARISM_JOB_STATUS.FAILED);
    expect(stalled.error).toContain('maximum processing time');

    // Fresh PROCESSING job is untouched
    const fresh = mockFirestore.row('plagiarismJobs', 'fresh-1')!;
    expect(fresh.status).toBe(PLAGIARISM_JOB_STATUS.PROCESSING);
  });
});
