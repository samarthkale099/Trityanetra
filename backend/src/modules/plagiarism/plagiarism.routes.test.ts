import request from 'supertest';
import express from 'express';
import router from './plagiarism.routes';

// Mock dependencies
jest.mock('../auth/jwt.middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = {
      uid: req.headers['x-test-user-id'] || 'teacher-123',
      email: 'test@example.com',
      role: req.headers['x-test-user-role'] || 'TEACHER',
      displayName: 'Test User',
    };
    next();
  },
}));

jest.mock('../../middleware/rbac.middleware', () => ({
  requireRole: (...roles: string[]) => (req: any, _res: any, next: any) => {
    if (roles.includes(req.user?.role)) {
      next();
    } else {
      _res.status(403).json({ error: { message: 'Insufficient permissions', code: 'FORBIDDEN' } });
    }
  },
}));

jest.mock('./service', () => ({
  plagiarismService: {
    createJob: jest.fn().mockResolvedValue({
      id: 'job-123',
      testId: 'test-123',
      submissionIds: ['sub1', 'sub2'],
      status: 'QUEUED',
      createdBy: 'teacher-123',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    getJob: jest.fn().mockResolvedValue({
      id: 'job-123',
      testId: 'test-123',
      status: 'COMPLETED',
    }),
    getJobsByTest: jest.fn().mockResolvedValue([]),
    getResultsByTest: jest.fn().mockResolvedValue([]),
  },
}));

import { plagiarismService } from './service';

describe('Plagiarism Routes', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/plagiarism', router);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /jobs — Happy path', () => {
    it('should create a plagiarism job', async () => {
      const response = await request(app)
        .post('/api/plagiarism/jobs')
        .send({
          testId: 'test-123',
          submissionIds: ['sub1', 'sub2'],
        });

      expect(response.status).toBe(201);
      expect(response.body.job).toBeDefined();
      expect(response.body.job.id).toBe('job-123');
    });
  });

  describe('POST /jobs — Error cases', () => {
    it('should return 400 for missing testId', async () => {
      const response = await request(app)
        .post('/api/plagiarism/jobs')
        .send({ submissionIds: ['sub1', 'sub2'] });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for missing submissionIds', async () => {
      const response = await request(app)
        .post('/api/plagiarism/jobs')
        .send({ testId: 'test-123' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for less than 2 submissionIds', async () => {
      const response = await request(app)
        .post('/api/plagiarism/jobs')
        .send({ testId: 'test-123', submissionIds: ['sub1'] });

      expect(response.status).toBe(400);
    });

    it('should return 403 for student role', async () => {
      const response = await request(app)
        .post('/api/plagiarism/jobs')
        .set('x-test-user-role', 'STUDENT')
        .send({ testId: 'test-123', submissionIds: ['sub1', 'sub2'] });

      expect(response.status).toBe(403);
    });
  });

  describe('GET /jobs/:jobId', () => {
    it('should return job details', async () => {
      const response = await request(app)
        .get('/api/plagiarism/jobs/job-123');

      expect(response.status).toBe(200);
      expect(response.body.job).toBeDefined();
    });

    it('should return 404 for non-existent job', async () => {
      (plagiarismService.getJob as jest.Mock).mockResolvedValueOnce(null);

      const response = await request(app)
        .get('/api/plagiarism/jobs/non-existent');

      expect(response.status).toBe(404);
    });
  });

  describe('GET /jobs/test/:testId — Role enforcement', () => {
    it('should allow teacher to get test jobs', async () => {
      const response = await request(app)
        .get('/api/plagiarism/jobs/test/test-123');

      expect(response.status).toBe(200);
    });

    it('should deny student from getting test jobs', async () => {
      const response = await request(app)
        .get('/api/plagiarism/jobs/test/test-123')
        .set('x-test-user-role', 'STUDENT');

      expect(response.status).toBe(403);
    });
  });

  describe('Adversarial cases', () => {
    it('should handle malformed body gracefully', async () => {
      const response = await request(app)
        .post('/api/plagiarism/jobs')
        .send('not json');

      expect(response.status).toBe(400);
    });

    it('should handle empty submissionIds array', async () => {
      const response = await request(app)
        .post('/api/plagiarism/jobs')
        .send({ testId: 'test-123', submissionIds: [] });

      expect(response.status).toBe(400);
    });

    it('should handle very large submissionIds array', async () => {
      const largeArray = Array.from({ length: 1000 }, (_, i) => `sub${i}`);
      const response = await request(app)
        .post('/api/plagiarism/jobs')
        .send({ testId: 'test-123', submissionIds: largeArray });

      // Should accept or reject gracefully — not crash
      expect([200, 201, 400]).toContain(response.status);
    });
  });
});
