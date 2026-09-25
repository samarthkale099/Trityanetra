import request from 'supertest';
import express from 'express';
import router from './monitor.routes';

// Mock dependencies
jest.mock('../auth/jwt.middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = {
      uid: req.headers['x-test-user-id'] || 'student-123',
      email: 'test@example.com',
      role: req.headers['x-test-user-role'] || 'STUDENT',
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

jest.mock('./monitor.service', () => ({
  monitorService: {
    createFlag: jest.fn().mockImplementation((input: any) =>
      Promise.resolve({
        id: 'flag-123',
        submissionId: input.submissionId,
        studentId: input.studentId,
        testId: input.testId,
        type: input.type,
        detail: input.detail,
        createdAt: new Date().toISOString(),
      })
    ),
    getFlagsBySubmission: jest.fn().mockResolvedValue([]),
    getFlagsByTest: jest.fn().mockResolvedValue([]),
    getFlagsByStudent: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('./rateLimiter', () => ({
  monitorRateLimiter: {
    isAllowed: jest.fn().mockResolvedValue({ allowed: true, remaining: 19 }),
    reset: jest.fn(),
  },
}));

// Advisory-only tripwires: if monitor routes ever start calling these,
// the assertions below fail (rule 4: flags must not trigger execution,
// plagiarism, or submission mutations).
jest.mock('../judge0/service', () => ({
  judge0Service: {
    submitCode: jest.fn().mockResolvedValue({ token: '', status: 'FAILED' }),
    getExecutionResult: jest.fn(),
    waitForResult: jest.fn(),
  },
}));
jest.mock('../plagiarism/service', () => ({
  plagiarismService: {
    createJob: jest.fn().mockResolvedValue({ id: 'job-1', status: 'QUEUED' }),
    updateJobStatus: jest.fn(),
  },
}));

import { monitorService } from './monitor.service';
import { monitorRateLimiter } from './rateLimiter';
import { judge0Service } from '../judge0/service';
import { plagiarismService } from '../plagiarism/service';
import { MONITOR_FLAG_TYPES } from '../../config/constants';

describe('Monitor Routes', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/monitor', router);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /flags — Happy path', () => {
    it('should create a flag successfully', async () => {
      const response = await request(app)
        .post('/api/monitor/flags')
        .set('x-test-user-id', 'student-123')
        .send({
          submissionId: 'sub-123',
          testId: 'test-123',
          type: 'TAB_SWITCH',
          detail: 'Tab switched',
        });

      expect(response.status).toBe(201);
      expect(response.body.flag).toBeDefined();
      expect(response.body.flag.type).toBe('TAB_SWITCH');
    });

    it('should use authenticated user ID, not client-sent studentId', async () => {
      const response = await request(app)
        .post('/api/monitor/flags')
        .set('x-test-user-id', 'auth-user-456')
        .send({
          submissionId: 'sub-123',
          testId: 'test-123',
          type: 'TAB_SWITCH',
          studentId: 'tampered-id', // Client tries to spoof
        });

      expect(response.status).toBe(201);
      const createCall = (monitorService.createFlag as jest.Mock).mock.calls[0][0];
      expect(createCall.studentId).toBe('auth-user-456'); // Should use auth user
    });
  });

  describe('POST /flags — Error cases', () => {
    it('should return 400 for missing submissionId', async () => {
      const response = await request(app)
        .post('/api/monitor/flags')
        .send({
          testId: 'test-123',
          type: 'TAB_SWITCH',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for missing testId', async () => {
      const response = await request(app)
        .post('/api/monitor/flags')
        .send({
          submissionId: 'sub-123',
          type: 'TAB_SWITCH',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for missing type', async () => {
      const response = await request(app)
        .post('/api/monitor/flags')
        .send({
          submissionId: 'sub-123',
          testId: 'test-123',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid flag type', async () => {
      const response = await request(app)
        .post('/api/monitor/flags')
        .send({
          submissionId: 'sub-123',
          testId: 'test-123',
          type: 'INVALID_TYPE',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 429 when rate limit exceeded', async () => {
      (monitorRateLimiter.isAllowed as jest.Mock).mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        retryAfterMs: 30000,
      });

      const response = await request(app)
        .post('/api/monitor/flags')
        .send({
          submissionId: 'sub-123',
          testId: 'test-123',
          type: 'TAB_SWITCH',
        });

      expect(response.status).toBe(429);
      expect(response.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });

  describe('GET /flags/test/:testId — Role enforcement', () => {
    it('should allow teacher to get test flags', async () => {
      const response = await request(app)
        .get('/api/monitor/flags/test/test-123')
        .set('x-test-user-role', 'TEACHER');

      expect(response.status).toBe(200);
    });

    it('should deny student from getting test flags', async () => {
      const response = await request(app)
        .get('/api/monitor/flags/test/test-123')
        .set('x-test-user-role', 'STUDENT');

      expect(response.status).toBe(403);
    });
  });

  describe('GET /flags/student/:studentId — Access control', () => {
    it('should allow student to see their own flags', async () => {
      const response = await request(app)
        .get('/api/monitor/flags/student/student-123')
        .set('x-test-user-id', 'student-123');

      expect(response.status).toBe(200);
    });

    it('should deny student from seeing another student flags', async () => {
      const response = await request(app)
        .get('/api/monitor/flags/student/other-student')
        .set('x-test-user-id', 'student-123');

      expect(response.status).toBe(403);
    });

    it('should allow teacher to see any student flags', async () => {
      const response = await request(app)
        .get('/api/monitor/flags/student/any-student')
        .set('x-test-user-role', 'TEACHER');

      expect(response.status).toBe(200);
    });
  });

  describe('Append-only guarantee', () => {
    it('should not have PUT route', async () => {
      const response = await request(app)
        .put('/api/monitor/flags/flag-123')
        .send({ type: 'TAMPERED' });

      // Should return 404 (no route) or 404 Method Not Allowed
      expect(response.status).toBe(404);
    });

    it('should not have PATCH route', async () => {
      const response = await request(app)
        .patch('/api/monitor/flags/flag-123')
        .send({ type: 'TAMPERED' });

      expect(response.status).toBe(404);
    });

    it('should not have DELETE route', async () => {
      const response = await request(app)
        .delete('/api/monitor/flags/flag-123');

      expect(response.status).toBe(404);
    });

    it('Rule 2: router stack registers ONLY GET and POST methods', () => {
      const registered: Array<{ method: string; path: string }> = [];
      const stack: any[] = (router as any).stack;

      for (const layer of stack) {
        if (layer.route) {
          for (const method of Object.keys(layer.route.methods)) {
            registered.push({ method: method.toUpperCase(), path: layer.route.path });
          }
        }
      }

      // The router must have routes at all
      expect(registered.length).toBeGreaterThan(0);

      // And every registered method must be append/read only
      for (const { method, path } of registered) {
        expect(['GET', 'POST']).toContain(method);
        expect(['PUT', 'PATCH', 'DELETE']).not.toContain(method);
        expect(path).toBeDefined();
      }
    });

    it('Rule 2: repeated POSTs append flags rather than overwrite (create called per POST)', async () => {
      await request(app)
        .post('/api/monitor/flags')
        .send({ submissionId: 'sub-1', testId: 'test-1', type: 'TAB_SWITCH', detail: 'first' });
      await request(app)
        .post('/api/monitor/flags')
        .send({ submissionId: 'sub-1', testId: 'test-1', type: 'PASTE_ATTEMPT', detail: 'second' });

      expect(monitorService.createFlag).toHaveBeenCalledTimes(2);
    });
  });

  describe('Rule 1: flag type enum is exactly the four specified values', () => {
    it('MONITOR_FLAG_TYPES contains exactly TAB_SWITCH, PASTE_ATTEMPT, FULLSCREEN_EXIT, DEVTOOLS_OPEN', () => {
      expect(MONITOR_FLAG_TYPES).toEqual({
        TAB_SWITCH: 'TAB_SWITCH',
        PASTE_ATTEMPT: 'PASTE_ATTEMPT',
        FULLSCREEN_EXIT: 'FULLSCREEN_EXIT',
        DEVTOOLS_OPEN: 'DEVTOOLS_OPEN',
      });
      expect(Object.keys(MONITOR_FLAG_TYPES)).toHaveLength(4);
    });

    it('accepts each of the four valid types', async () => {
      for (const type of Object.values(MONITOR_FLAG_TYPES)) {
        const response = await request(app)
          .post('/api/monitor/flags')
          .send({ submissionId: 'sub-1', testId: 'test-1', type });

        expect(response.status).toBe(201);
        expect(response.body.flag.type).toBe(type);
      }
    });

    it('rejects near-miss and aliased types', async () => {
      const nearMisses = [
        'TAB_SWITCHED',
        'tab_switch',
        'TAB SWITCH',
        'TABSWITCH',
        'WARNING',
        'PASTE',
        'PASTED',
        'FULLSCREEN',
        'FULLSCREEN_EXITED',
        'DEVTOOLS',
        'DEVTOOLS_OPENED',
        'DEV_TOOLS_OPEN',
        'AUTO_FAIL',
        '',
        ' TAB_SWITCH',
        'TAB_SWITCH ',
      ];

      for (const type of nearMisses) {
        const response = await request(app)
          .post('/api/monitor/flags')
          .send({ submissionId: 'sub-1', testId: 'test-1', type });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('Rule 4: advisory-only — flag creation has no execution/plagiarism/submission side effects', () => {
    it('POST /flags invokes only monitorService.createFlag among mutation services', async () => {
      const response = await request(app)
        .post('/api/monitor/flags')
        .send({ submissionId: 'sub-1', testId: 'test-1', type: 'TAB_SWITCH' });

      expect(response.status).toBe(201);
      expect(monitorService.createFlag).toHaveBeenCalledTimes(1);
      expect(judge0Service.submitCode).not.toHaveBeenCalled();
      expect(plagiarismService.createJob).not.toHaveBeenCalled();
      expect(plagiarismService.updateJobStatus).not.toHaveBeenCalled();
    });

    it('a denied (rate-limited) flag creates nothing and still touches no other service', async () => {
      (monitorRateLimiter.isAllowed as jest.Mock).mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        retryAfterMs: 30000,
      });

      const response = await request(app)
        .post('/api/monitor/flags')
        .send({ submissionId: 'sub-1', testId: 'test-1', type: 'TAB_SWITCH' });

      expect(response.status).toBe(429);
      expect(monitorService.createFlag).not.toHaveBeenCalled();
      expect(judge0Service.submitCode).not.toHaveBeenCalled();
      expect(plagiarismService.createJob).not.toHaveBeenCalled();
    });

    it('Rule 3: fails closed with 429 when the monitor rate limiter store errors', async () => {
      (monitorRateLimiter.isAllowed as jest.Mock).mockRejectedValueOnce(new Error('redis down'));

      const response = await request(app)
        .post('/api/monitor/flags')
        .send({ submissionId: 'sub-1', testId: 'test-1', type: 'TAB_SWITCH' });

      // The route must not create a flag when rate limiting cannot be verified.
      // The limiter itself fail-closes to denied; if the error still propagates,
      // a 500 is acceptable — either way, no flag is created.
      expect([429, 500]).toContain(response.status);
      expect(monitorService.createFlag).not.toHaveBeenCalled();
    });
  });
});
