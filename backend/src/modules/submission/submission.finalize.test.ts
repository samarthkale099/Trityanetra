import request from 'supertest';
import express from 'express';
import { createInMemoryFirestore } from '../../testUtils/inMemoryFirestore';
import { PLAGIARISM_JOB_STATUS, COLLECTIONS, SUBMISSION_STATUS } from '../../config/constants';

const mockFirestore = createInMemoryFirestore();

jest.mock('../../db/firestore', () => ({ getFirestore: () => mockFirestore.getFirestore() }));
jest.mock('../plagiarism/queue', () => ({
  enqueuePlagiarismJob: jest.fn().mockResolvedValue('bull-job-1'),
}));
jest.mock('../auth/jwt.middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = {
      uid: 'teacher-uid',
      email: 't@example.com',
      role: req.headers['x-test-user-role'] || 'TEACHER',
      displayName: 'Teacher',
    };
    next();
  },
}));
jest.mock('axios');

import submissionRoutes from './submission.routes';
import plagiarismRoutes from '../plagiarism/plagiarism.routes';
import { processPlagiarismJob } from '../plagiarism/worker';
import { enqueuePlagiarismJob } from '../plagiarism/queue';
import axios from 'axios';

const validAstPayload = () => ({
  pairs: [
    {
      submissionA: 'sub1',
      submissionB: 'sub2',
      metrics: {
        cosine_similarity: 0.97,
        ted_score: 0.91,
        identifier_overlap: 0.88,
        operator_overlap: 0.82,
        combined_score: 0.92,
      },
      flagLevel: 'high',
    },
  ],
  flagged: [
    {
      submissionA: 'sub1',
      submissionB: 'sub2',
      metrics: {
        cosine_similarity: 0.97,
        ted_score: 0.91,
        identifier_overlap: 0.88,
        operator_overlap: 0.82,
        combined_score: 0.92,
      },
      flagLevel: 'high',
    },
  ],
  summary: { totalSubmissions: 2, totalPairs: 1, flaggedPairs: 1, processingTimeMs: 77 },
});

describe('Rule 9: finalize → job → queue → worker → AST → Firestore → poll → teacher report', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/submissions', submissionRoutes);
    app.use('/api/plagiarism', plagiarismRoutes);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockFirestore.reset();
    // Seed two submissions for test t1
    mockFirestore.seed(COLLECTIONS.SUBMISSIONS, 'sub1', {
      id: 'sub1', testId: 't1', code: 'x = 1', language: 'python', studentId: 's1',
    });
    mockFirestore.seed(COLLECTIONS.SUBMISSIONS, 'sub2', {
      id: 'sub2', testId: 't1', code: 'x = 1', language: 'python', studentId: 's2',
    });
  });

  it('runs the entire chain end-to-end with a truthful finalize response', async () => {
    // --- 1. finalize updates the submission + triggers job creation (QUEUED) + enqueue ---
    const finalizeRes = await request(app).post('/api/submissions/sub1/finalize');

    expect(finalizeRes.status).toBe(200);
    expect(finalizeRes.body.message).toBe('Submission finalized');
    expect(finalizeRes.body.submission).toMatchObject({
      id: 'sub1',
      status: SUBMISSION_STATUS.FINALIZED,
    });
    expect(finalizeRes.body.submission.finalizedAt).toBeDefined();
    expect(finalizeRes.body.plagiarism.queued).toBe(true);
    expect(finalizeRes.body.plagiarism.status).toBe('QUEUED');

    const jobs = mockFirestore.rows(COLLECTIONS.PLAGIARISM_JOBS);
    expect(jobs).toHaveLength(1);
    const job = jobs[0].data;
    expect(job.status).toBe(PLAGIARISM_JOB_STATUS.QUEUED);
    expect(job.testId).toBe('t1');
    expect(job.submissionIds).toEqual(['sub1', 'sub2']);
    expect(job.createdBy).toBe('teacher-uid');
    expect(finalizeRes.body.plagiarism.jobId).toBe(jobs[0].id);

    expect(enqueuePlagiarismJob).toHaveBeenCalledTimes(1);
    expect(enqueuePlagiarismJob).toHaveBeenCalledWith({
      jobId: jobs[0].id,
      testId: 't1',
      submissionIds: ['sub1', 'sub2'],
      createdBy: 'teacher-uid',
    });

    // --- 2. finalize again → idempotent, no duplicate job; response says so ---
    const finalizeAgain = await request(app).post('/api/submissions/sub2/finalize');
    expect(finalizeAgain.status).toBe(200);
    expect(finalizeAgain.body.message).toBe('Submission finalized');
    expect(finalizeAgain.body.plagiarism).toEqual({
      queued: false,
      status: 'SKIPPED',
      reason: 'JOB_ALREADY_ACTIVE',
    });
    expect(mockFirestore.rows(COLLECTIONS.PLAGIARISM_JOBS)).toHaveLength(1);
    expect(enqueuePlagiarismJob).toHaveBeenCalledTimes(1);

    // --- 3. worker processes the queued job ---
    (axios.post as jest.Mock).mockResolvedValue({ data: validAstPayload() });
    const jobId = jobs[0].id;
    const workerResult = await processPlagiarismJob({
      id: 'bull-1',
      data: { jobId, testId: 't1', submissionIds: ['sub1', 'sub2'], createdBy: 'teacher-uid' },
    } as any);
    expect(workerResult).toEqual({ result: 'completed', flaggedPairs: 1 });

    // --- 4. results persisted to Firestore ---
    const jobAfter = mockFirestore.row(COLLECTIONS.PLAGIARISM_JOBS, jobId)!;
    expect(jobAfter.status).toBe(PLAGIARISM_JOB_STATUS.COMPLETED);
    expect(jobAfter.result.summary.flaggedPairs).toBe(1);

    // --- 5. poll: student/any authenticated user can poll job status ---
    const pollRes = await request(app).get(`/api/plagiarism/jobs/${jobId}`);
    expect(pollRes.status).toBe(200);
    expect(pollRes.body.job.status).toBe(PLAGIARISM_JOB_STATUS.COMPLETED);

    // --- 6. teacher report: flagged results for the test ---
    const reportRes = await request(app).get('/api/plagiarism/results/test/t1');
    expect(reportRes.status).toBe(200);
    expect(reportRes.body.results).toHaveLength(1);
    expect(reportRes.body.results[0]).toMatchObject({
      submissionA: 'sub1',
      submissionB: 'sub2',
      flagLevel: 'high',
      jobId,
      testId: 't1',
    });
    expect(reportRes.body.results[0].metrics.combined_score).toBeCloseTo(0.92);
  });

  it('malformed AST output anywhere in the chain ends at FAILED (never undefined)', async () => {
    const finalizeRes = await request(app).post('/api/submissions/sub1/finalize');
    expect(finalizeRes.status).toBe(200);
    expect(finalizeRes.body.plagiarism.queued).toBe(true);
    const jobId = mockFirestore.rows(COLLECTIONS.PLAGIARISM_JOBS)[0].id;

    (axios.post as jest.Mock).mockResolvedValue({ data: { nonsense: true } });

    await expect(
      processPlagiarismJob({
        id: 'bull-1',
        data: { jobId, testId: 't1', submissionIds: ['sub1', 'sub2'], createdBy: 'teacher-uid' },
      } as any)
    ).rejects.toThrow('Invalid AST engine response');

    const job = mockFirestore.row(COLLECTIONS.PLAGIARISM_JOBS, jobId)!;
    expect(job.status).toBe(PLAGIARISM_JOB_STATUS.FAILED);
    expect(job.error).toBeDefined();

    const pollRes = await request(app).get(`/api/plagiarism/jobs/${jobId}`);
    expect(pollRes.body.job.status).toBe(PLAGIARISM_JOB_STATUS.FAILED);
  });

  describe('FIX 2: finalize reports the truth', () => {
    it('a. finalize() on a nonexistent submission ID → 404, not 200', async () => {
      mockFirestore.reset();

      const res = await request(app).post('/api/submissions/does-not-exist/finalize');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.message).toBeUndefined();
      expect(mockFirestore.rows(COLLECTIONS.PLAGIARISM_JOBS)).toHaveLength(0);
      expect(enqueuePlagiarismJob).not.toHaveBeenCalled();
    });

    it('b. finalize() on a real submission → document actually updated in Firestore AND response reports success', async () => {
      const before = mockFirestore.row(COLLECTIONS.SUBMISSIONS, 'sub1')!;
      expect(before.status).toBeUndefined();
      expect(before.finalizedAt).toBeUndefined();

      const res = await request(app).post('/api/submissions/sub1/finalize');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Submission finalized');
      expect(res.body.submission.status).toBe(SUBMISSION_STATUS.FINALIZED);
      expect(res.body.submission.finalizedAt).toBeDefined();
      expect(res.body.plagiarism.queued).toBe(true);

      // Checked in Firestore, not just in the response
      const stored = mockFirestore.row(COLLECTIONS.SUBMISSIONS, 'sub1')!;
      expect(stored.status).toBe(SUBMISSION_STATUS.FINALIZED);
      expect(stored.finalizedAt).toBeDefined();
      expect(Number.isNaN(Date.parse(stored.finalizedAt))).toBe(false);
      // code is untouched by finalize
      expect(stored.code).toBe('x = 1');
    });

    it('c. plagiarism queueing throws internally → submission still finalized, success response, plagiarism reported NOT queued', async () => {
      (enqueuePlagiarismJob as jest.Mock).mockRejectedValueOnce(new Error('redis down'));

      const res = await request(app).post('/api/submissions/sub1/finalize');

      // Still a genuine success: the submission record was finalized
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Submission finalized');
      expect(res.body.submission.status).toBe(SUBMISSION_STATUS.FINALIZED);
      const stored = mockFirestore.row(COLLECTIONS.SUBMISSIONS, 'sub1')!;
      expect(stored.status).toBe(SUBMISSION_STATUS.FINALIZED);
      expect(stored.finalizedAt).toBeDefined();

      // ...but the response body says plagiarism was NOT queued (distinct
      // from the queued case: queued=false, status=FAILED, reason/error set)
      expect(res.body.plagiarism).toEqual({
        queued: false,
        status: 'FAILED',
        reason: 'QUEUE_ERROR',
        error: 'redis down',
      });

      const jobs = mockFirestore.rows(COLLECTIONS.PLAGIARISM_JOBS);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].data.status).toBe(PLAGIARISM_JOB_STATUS.FAILED);
    });

    it('d. only 1 submission for the test → response indicates plagiarism was SKIPPED (not identical to the queued case)', async () => {
      mockFirestore.reset();
      mockFirestore.seed(COLLECTIONS.SUBMISSIONS, 'solo', {
        id: 'solo', testId: 't-solo', code: 'x=1', language: 'python', studentId: 's1',
      });

      const res = await request(app).post('/api/submissions/solo/finalize');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Submission finalized');
      // Skipped is distinguishable from queued (queued would be {queued:true, status:'QUEUED'})
      expect(res.body.plagiarism).toEqual({
        queued: false,
        status: 'SKIPPED',
        reason: 'NOT_ENOUGH_SUBMISSIONS',
      });
      expect(mockFirestore.rows(COLLECTIONS.PLAGIARISM_JOBS)).toHaveLength(0);

      // The submission itself WAS finalized even though plagiarism was skipped
      const stored = mockFirestore.row(COLLECTIONS.SUBMISSIONS, 'solo')!;
      expect(stored.status).toBe(SUBMISSION_STATUS.FINALIZED);
      expect(stored.finalizedAt).toBeDefined();
    });

    it('e. the three plagiarism outcomes (queued / skipped / failed) are pairwise distinct', async () => {
      // queued: two submissions for t1, no active job
      const queued = await request(app).post('/api/submissions/sub1/finalize');

      // failed: another test with two submissions, but enqueue throws
      mockFirestore.seed(COLLECTIONS.SUBMISSIONS, 'f1', {
        id: 'f1', testId: 't-f', code: 'a', language: 'python', studentId: 'sA',
      });
      mockFirestore.seed(COLLECTIONS.SUBMISSIONS, 'f2', {
        id: 'f2', testId: 't-f', code: 'b', language: 'python', studentId: 'sB',
      });
      (enqueuePlagiarismJob as jest.Mock).mockRejectedValueOnce(new Error('redis down'));
      const failed = await request(app).post('/api/submissions/f1/finalize');

      // skipped: only one submission for the test
      mockFirestore.seed(COLLECTIONS.SUBMISSIONS, 'only1', {
        id: 'only1', testId: 't-single', code: 'c', language: 'python', studentId: 'sC',
      });
      const skipped = await request(app).post('/api/submissions/only1/finalize');

      expect(queued.status).toBe(200);
      expect(failed.status).toBe(200);
      expect(skipped.status).toBe(200);
      expect(queued.body.plagiarism.status).toBe('QUEUED');
      expect(failed.body.plagiarism.status).toBe('FAILED');
      expect(skipped.body.plagiarism.status).toBe('SKIPPED');

      const serialized = [
        JSON.stringify(queued.body.plagiarism),
        JSON.stringify(failed.body.plagiarism),
        JSON.stringify(skipped.body.plagiarism),
      ];
      expect(new Set(serialized).size).toBe(3);
    });
  });
});
