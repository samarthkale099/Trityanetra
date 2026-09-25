import request from 'supertest';
import express from 'express';
import { createInMemoryFirestore } from '../../testUtils/inMemoryFirestore';
import { COLLECTIONS, SUBMISSION_STATUS } from '../../config/constants';

const mockFirestore = createInMemoryFirestore();

jest.mock('../../db/firestore', () => ({ getFirestore: () => mockFirestore.getFirestore() }));
jest.mock('../plagiarism/queue', () => ({
  enqueuePlagiarismJob: jest.fn().mockResolvedValue('bull-job-1'),
}));
jest.mock('../auth/jwt.middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = {
      uid: req.headers['x-test-user-id'] || 'student-1',
      email: 'student@test.com',
      role: req.headers['x-test-user-role'] || 'STUDENT',
      displayName: 'Student',
    };
    next();
  },
}));

import submissionRoutes from './submission.routes';
import {
  submissionService,
  SubmissionLockedError,
} from './submission.service';

describe('Submission persistence (create / get / submit)', () => {
  let app: express.Application;

  const student = (uid: string) => ({ 'x-test-user-id': uid });

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/submissions', submissionRoutes);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockFirestore.reset();
  });

  describe('create()', () => {
    it('a. creating twice for the same (testId, studentId) yields one submission — second call returns the same one', async () => {
      const first = await request(app)
        .post('/api/submissions')
        .set(student('s1'))
        .send({ testId: 't1' });

      expect(first.status).toBe(201);
      expect(first.body.submission.id).toBe('t1_s1');
      expect(first.body.submission.testId).toBe('t1');
      expect(first.body.submission.studentId).toBe('s1');
      expect(first.body.submission.status).toBe(SUBMISSION_STATUS.DRAFT);

      const second = await request(app)
        .post('/api/submissions')
        .set(student('s1'))
        .send({ testId: 't1' });

      // Idempotent: no throw, no duplicate — same submission returned
      expect(second.status).toBe(200);
      expect(second.body.submission).toEqual(first.body.submission);
      expect(mockFirestore.rows(COLLECTIONS.SUBMISSIONS)).toHaveLength(1);
      expect(mockFirestore.row(COLLECTIONS.SUBMISSIONS, 't1_s1')).toBeDefined();
    });

    it('b. creating outside the test time window is rejected (ended and not-yet-started)', async () => {
      const now = Date.now();
      const past = new Date(now - 60 * 60 * 1000).toISOString();
      const future = new Date(now + 60 * 60 * 1000).toISOString();

      // Window already ended
      mockFirestore.seed(COLLECTIONS.TESTS, 't-ended', {
        id: 't-ended', startTime: past, endTime: past,
      });
      // Window not started yet
      mockFirestore.seed(COLLECTIONS.TESTS, 't-not-started', {
        id: 't-not-started', startTime: future, endTime: future,
      });

      const ended = await request(app)
        .post('/api/submissions')
        .set(student('s1'))
        .send({ testId: 't-ended' });
      expect(ended.status).toBe(403);
      expect(ended.body.error.code).toBe('TEST_WINDOW_CLOSED');

      const notStarted = await request(app)
        .post('/api/submissions')
        .set(student('s1'))
        .send({ testId: 't-not-started' });
      expect(notStarted.status).toBe(403);
      expect(notStarted.body.error.code).toBe('TEST_WINDOW_CLOSED');

      // Nothing was persisted for either test
      expect(mockFirestore.rows(COLLECTIONS.SUBMISSIONS)).toHaveLength(0);

      // Sanity: creation inside an open window succeeds
      mockFirestore.seed(COLLECTIONS.TESTS, 't-open', {
        id: 't-open', startTime: past, endTime: future,
      });
      const open = await request(app)
        .post('/api/submissions')
        .set(student('s1'))
        .send({ testId: 't-open' });
      expect(open.status).toBe(201);
      expect(mockFirestore.rows(COLLECTIONS.SUBMISSIONS)).toHaveLength(1);
    });

    it('rejects create without testId', async () => {
      const res = await request(app).post('/api/submissions').set(student('s1')).send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(mockFirestore.rows(COLLECTIONS.SUBMISSIONS)).toHaveLength(0);
    });
  });

  describe('getSubmission()', () => {
    it('c. returns real data for an existing submission and null (not a fake object) for a missing one', async () => {
      const created = await request(app)
        .post('/api/submissions')
        .set(student('s1'))
        .send({ testId: 't1' });
      expect(created.status).toBe(201);

      // Existing submission -> real data
      const existing = await request(app)
        .get('/api/submissions/me')
        .query({ testId: 't1' })
        .set(student('s1'));
      expect(existing.status).toBe(200);
      expect(existing.body.submission).not.toBeNull();
      expect(existing.body.submission).toMatchObject({
        id: 't1_s1',
        testId: 't1',
        studentId: 's1',
        status: SUBMISSION_STATUS.DRAFT,
        code: '',
      });

      // Different student, same test -> no submission -> null
      const missing = await request(app)
        .get('/api/submissions/me')
        .query({ testId: 't1' })
        .set(student('s2'));
      expect(missing.status).toBe(200);
      expect(missing.body.submission).toBeNull();

      // Unknown test -> null
      const unknownTest = await request(app)
        .get('/api/submissions/me')
        .query({ testId: 'nope' })
        .set(student('s1'));
      expect(unknownTest.status).toBe(200);
      expect(unknownTest.body.submission).toBeNull();
    });

    it('requires testId on GET /me', async () => {
      const res = await request(app).get('/api/submissions/me').set(student('s1'));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('submit()', () => {
    const createSubmission = async (testId: string, uid: string) => {
      const res = await request(app)
        .post('/api/submissions')
        .set(student(uid))
        .send({ testId });
      expect(res.status).toBe(201);
      return res.body.submission.id;
    };

    it('d. submit() then submit() again — second call rejected, first submission content unchanged', async () => {
      const submissionId = await createSubmission('t1', 's1');

      const first = await request(app)
        .post(`/api/submissions/${submissionId}/submit`)
        .set(student('s1'))
        .send({ code: 'print("first")', language: 'python' });
      expect(first.status).toBe(200);
      expect(first.body.message).toBe('Submitted');
      expect(first.body.submission.status).toBe(SUBMISSION_STATUS.SUBMITTED);
      expect(first.body.submission.code).toBe('print("first")');
      expect(first.body.submission.submittedAt).toBeDefined();

      // Second submit is rejected, not silently overwritten
      const second = await request(app)
        .post(`/api/submissions/${submissionId}/submit`)
        .set(student('s1'))
        .send({ code: 'print("overwritten")' });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('SUBMISSION_LOCKED');

      // First submission's content is unchanged in Firestore
      const stored = mockFirestore.row(COLLECTIONS.SUBMISSIONS, submissionId)!;
      expect(stored.status).toBe(SUBMISSION_STATUS.SUBMITTED);
      expect(stored.code).toBe('print("first")');

      // And getSubmission reflects the immutable submitted state
      const readBack = await request(app)
        .get('/api/submissions/me')
        .query({ testId: 't1' })
        .set(student('s1'));
      expect(readBack.body.submission.status).toBe(SUBMISSION_STATUS.SUBMITTED);
      expect(readBack.body.submission.code).toBe('print("first")');
    });

    it('e. two concurrent submit() calls — exactly one succeeds', async () => {
      const submissionId = await createSubmission('t3', 's1');

      const [r1, r2] = await Promise.all([
        request(app)
          .post(`/api/submissions/${submissionId}/submit`)
          .set(student('s1'))
          .send({ code: 'print("race-one")' }),
        request(app)
          .post(`/api/submissions/${submissionId}/submit`)
          .set(student('s1'))
          .send({ code: 'print("race-two")' }),
      ]);

      const statuses = [r1.status, r2.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 409]);

      const winner = r1.status === 200 ? r1 : r2;
      const loser = r1.status === 200 ? r2 : r1;
      expect(loser.body.error.code).toBe('SUBMISSION_LOCKED');

      // Stored content matches exactly the request that won — never a merge of both
      const stored = mockFirestore.row(COLLECTIONS.SUBMISSIONS, submissionId)!;
      expect(stored.status).toBe(SUBMISSION_STATUS.SUBMITTED);
      expect(stored.code).toBe(winner.body.submission.code);
      expect([ 'print("race-one")', 'print("race-two")' ]).toContain(stored.code);

      // Service level: two submit transactions issued back-to-back before
      // either commits — only the transactional read-check-write can make
      // exactly one succeed here (a plain read-then-write lets both through).
      const raceId = await (async () => {
        const res = await request(app)
          .post('/api/submissions')
          .set(student('s1'))
          .send({ testId: 't-race' });
        expect(res.status).toBe(201);
        return res.body.submission.id as string;
      })();

      const results = await Promise.allSettled([
        submissionService.submitSubmission(raceId, 's1', 'print("tx-one")'),
        submissionService.submitSubmission(raceId, 's1', 'print("tx-two")'),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(SubmissionLockedError);
      expect((rejected[0].reason as SubmissionLockedError).code).toBe('SUBMISSION_LOCKED');

      const raced = mockFirestore.row(COLLECTIONS.SUBMISSIONS, raceId)!;
      expect(raced.status).toBe(SUBMISSION_STATUS.SUBMITTED);
      expect(raced.code).toBe(
        (fulfilled[0] as PromiseFulfilledResult<{ code: string }>).value.code
      );
      expect(['print("tx-one")', 'print("tx-two")']).toContain(raced.code);
    });

    it('submit requires code and an existing submission', async () => {
      const submissionId = await createSubmission('t4', 's1');

      const noCode = await request(app)
        .post(`/api/submissions/${submissionId}/submit`)
        .set(student('s1'))
        .send({});
      expect(noCode.status).toBe(400);
      expect(noCode.body.error.code).toBe('VALIDATION_ERROR');

      const notFound = await request(app)
        .post('/api/submissions/missing_submission/submit')
        .set(student('s1'))
        .send({ code: 'x = 1' });
      expect(notFound.status).toBe(404);
      expect(notFound.body.error.code).toBe('NOT_FOUND');
    });
  });
});
