import { plagiarismService, PlagiarismService } from './service';
import { PLAGIARISM_JOB_STATUS, PLAGIARISM_FLAG_LEVEL } from '../../config/constants';
import axios from 'axios';

// Shared mock objects so every getFirestore() call returns the same chain
const mockDoc = {
  set: jest.fn().mockResolvedValue(undefined),
  get: jest.fn().mockResolvedValue({ exists: false, data: () => null }),
  update: jest.fn().mockResolvedValue(undefined),
};
const mockCollection = {
  doc: jest.fn().mockReturnValue(mockDoc),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  get: jest.fn().mockResolvedValue({ docs: [] }),
};

// Mock dependencies
jest.mock('../../db/firestore', () => ({
  getFirestore: () => ({
    collection: jest.fn().mockReturnValue(mockCollection),
  }),
}));

jest.mock('./queue', () => ({
  enqueuePlagiarismJob: jest.fn().mockResolvedValue('job-123'),
}));

jest.mock('axios');

describe('PlagiarismService', () => {
  let service: PlagiarismService;

  beforeEach(() => {
    service = new PlagiarismService();
    jest.clearAllMocks();
  });

  describe('createJob', () => {
    it('should create a job and enqueue it', async () => {
      const job = await service.createJob('test-123', ['sub1', 'sub2'], 'teacher-123');

      expect(job.testId).toBe('test-123');
      expect(job.submissionIds).toEqual(['sub1', 'sub2']);
      expect(job.status).toBe('QUEUED');
      expect(job.createdBy).toBe('teacher-123');
    });

    it('should mark the job FAILED (and rethrow) when enqueue fails — never leave QUEUED with no worker', async () => {
      const { enqueuePlagiarismJob } = require('./queue');
      const firestore = require('../../db/firestore').getFirestore();
      const mockUpdate = firestore.collection().doc().update;
      enqueuePlagiarismJob.mockRejectedValueOnce(new Error('redis down'));

      await expect(
        service.createJob('test-123', ['sub1', 'sub2'], 'teacher-123')
      ).rejects.toThrow('redis down');

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FAILED',
          error: expect.stringContaining('Failed to enqueue job'),
        })
      );
    });
  });

  describe('Rule 10: plagiarism status enum', () => {
    it('PLAGIARISM_JOB_STATUS is exactly QUEUED, PROCESSING, COMPLETED, FAILED', () => {
      expect(PLAGIARISM_JOB_STATUS).toEqual({
        QUEUED: 'QUEUED',
        PROCESSING: 'PROCESSING',
        COMPLETED: 'COMPLETED',
        FAILED: 'FAILED',
      });
      expect(Object.keys(PLAGIARISM_JOB_STATUS)).toHaveLength(4);
      expect(Object.values(PLAGIARISM_JOB_STATUS)).not.toContain('PENDING');
      expect(Object.values(PLAGIARISM_JOB_STATUS)).not.toContain('TIMED_OUT');
    });

    it('updateJobStatus accepts every allowed status', async () => {
      for (const status of Object.values(PLAGIARISM_JOB_STATUS)) {
        await expect(service.updateJobStatus('job-1', status)).resolves.toBeUndefined();
      }
    });

    it('updateJobStatus rejects PENDING with an error and no Firestore write', async () => {
      const firestore = require('../../db/firestore').getFirestore();
      const mockUpdate = firestore.collection().doc().update;
      mockUpdate.mockClear();

      await expect(
        service.updateJobStatus('job-1', 'PENDING' as any)
      ).rejects.toThrow('Invalid plagiarism job status');

      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('updateJobStatus rejects TIMED_OUT with an error and no Firestore write', async () => {
      const firestore = require('../../db/firestore').getFirestore();
      const mockUpdate = firestore.collection().doc().update;
      mockUpdate.mockClear();

      await expect(
        service.updateJobStatus('job-1', 'TIMED_OUT' as any)
      ).rejects.toThrow('Invalid plagiarism job status');

      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('updateJobStatus rejects arbitrary values', async () => {
      await expect(
        service.updateJobStatus('job-1', 'CANCELLED' as any)
      ).rejects.toThrow('Invalid plagiarism job status');
      await expect(
        service.updateJobStatus('job-1', '' as any)
      ).rejects.toThrow('Invalid plagiarism job status');
    });
  });

  describe('callASTEEngine', () => {
    const validMetrics = {
      cosine_similarity: 0.9,
      ted_score: 0.85,
      identifier_overlap: 0.8,
      operator_overlap: 0.7,
      combined_score: 0.83,
    };

    const validBody = () => ({
      pairs: [{
        submissionA: 'sub1',
        submissionB: 'sub2',
        metrics: { ...validMetrics },
        flagLevel: 'high',
      }],
      flagged: [{
        submissionA: 'sub1',
        submissionB: 'sub2',
        metrics: { ...validMetrics },
        flagLevel: 'high',
      }],
      summary: { totalSubmissions: 2, totalPairs: 1, flaggedPairs: 1, processingTimeMs: 100 },
    });

    it('should call AST engine with correct parameters', async () => {
      (axios.post as jest.Mock).mockResolvedValue({ data: validBody() });

      const submissions = [
        { id: 'sub1', code: 'x = 1', language: 'python', studentId: 's1' },
        { id: 'sub2', code: 'y = 2', language: 'python', studentId: 's2' },
      ];

      const result = await service.callASTEEngine(submissions);

      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/plagiarism/check'),
        { submissions },
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Internal-Secret': expect.any(String),
          }),
        })
      );
      expect(result.pairs).toHaveLength(1);
    });

    it('should handle AST engine unavailable', async () => {
      (axios.post as jest.Mock).mockRejectedValue({
        code: 'ECONNREFUSED',
        message: 'connect ECONNREFUSED',
      });

      await expect(
        service.callASTEEngine([{ id: 'sub1', code: 'x = 1', language: 'python', studentId: 's1' }])
      ).rejects.toThrow('AST engine is unavailable');
    });

    it('should handle AST engine timeout', async () => {
      (axios.post as jest.Mock).mockRejectedValue({
        response: { status: 408 },
        message: 'Request timeout',
      });

      await expect(
        service.callASTEEngine([{ id: 'sub1', code: 'x = 1', language: 'python', studentId: 's1' }])
      ).rejects.toThrow('AST engine processing timed out');
    });

    it('should validate response structure', async () => {
      (axios.post as jest.Mock).mockResolvedValue({ data: { invalid: true } });

      await expect(
        service.callASTEEngine([{ id: 'sub1', code: 'x = 1', language: 'python', studentId: 's1' }])
      ).rejects.toThrow('Invalid AST engine response');
    });

    it('should handle malformed response summary', async () => {
      (axios.post as jest.Mock).mockResolvedValue({
        data: { pairs: [], summary: { notTotalSubmissions: 'bad' } },
      });

      await expect(
        service.callASTEEngine([{ id: 'sub1', code: 'x = 1', language: 'python', studentId: 's1' }])
      ).rejects.toThrow('Invalid AST engine response');
    });

    it('Rule 8: accepts a fully valid response at metric bounds (0 and 1)', async () => {
      const body = validBody();
      body.pairs[0].metrics = {
        cosine_similarity: 0,
        ted_score: 1,
        identifier_overlap: 0.5,
        operator_overlap: 1,
        combined_score: 0,
      };
      body.flagged[0].metrics = { ...body.pairs[0].metrics };
      (axios.post as jest.Mock).mockResolvedValue({ data: body });

      const submissions = [
        { id: 'sub1', code: 'x = 1', language: 'python', studentId: 's1' },
        { id: 'sub2', code: 'y = 2', language: 'python', studentId: 's2' },
      ];

      await expect(service.callASTEEngine(submissions)).resolves.toBeDefined();
    });

    it.each([
      ['cosine_similarity above 1', { cosine_similarity: 1.01 }],
      ['cosine_similarity below 0', { cosine_similarity: -0.01 }],
      ['ted_score above 1', { ted_score: 1.5 }],
      ['combined_score NaN', { combined_score: NaN }],
      ['identifier_overlap as string', { identifier_overlap: 'high' }],
      ['operator_overlap Infinity', { operator_overlap: Infinity }],
    ])('Rule 8: rejects metric out of bounds — %s', async (_label, badMetric) => {
      const body = validBody();
      body.pairs[0].metrics = { ...validMetrics, ...badMetric } as any;
      body.flagged = [];
      (axios.post as jest.Mock).mockResolvedValue({ data: body });

      const submissions = [
        { id: 'sub1', code: 'x = 1', language: 'python', studentId: 's1' },
        { id: 'sub2', code: 'y = 2', language: 'python', studentId: 's2' },
      ];

      await expect(service.callASTEEngine(submissions)).rejects.toThrow(
        'Invalid AST engine response'
      );
    });

    it('Rule 8: rejects a pair with an unknown flagLevel', async () => {
      const body = validBody();
      body.pairs[0].flagLevel = 'critical' as any;
      body.flagged = [];
      (axios.post as jest.Mock).mockResolvedValue({ data: body });

      const submissions = [
        { id: 'sub1', code: 'x = 1', language: 'python', studentId: 's1' },
        { id: 'sub2', code: 'y = 2', language: 'python', studentId: 's2' },
      ];

      await expect(service.callASTEEngine(submissions)).rejects.toThrow('flagLevel');
    });

    it('Rule 8: accepts all four valid flag levels', async () => {
      for (const level of Object.values(PLAGIARISM_FLAG_LEVEL)) {
        const body = validBody();
        body.pairs[0].flagLevel = level;
        body.flagged[0].flagLevel = level;
        (axios.post as jest.Mock).mockResolvedValue({ data: body });

        const submissions = [
          { id: 'sub1', code: 'x = 1', language: 'python', studentId: 's1' },
          { id: 'sub2', code: 'y = 2', language: 'python', studentId: 's2' },
        ];

        await expect(service.callASTEEngine(submissions)).resolves.toBeDefined();
      }
    });

    it('Rule 8: rejects pairs that are not an array of objects (garbage output)', async () => {
      (axios.post as jest.Mock).mockResolvedValue({
        data: { pairs: 'garbage', flagged: [], summary: { totalSubmissions: 2, totalPairs: 0, flaggedPairs: 0, processingTimeMs: 0 } },
      });

      const submissions = [
        { id: 'sub1', code: 'x = 1', language: 'python', studentId: 's1' },
        { id: 'sub2', code: 'y = 2', language: 'python', studentId: 's2' },
      ];

      await expect(service.callASTEEngine(submissions)).rejects.toThrow('Invalid AST engine response');
    });

    it('Rule 8: rejects negative summary counts', async () => {
      const body = validBody();
      body.summary.totalPairs = -1;
      body.flagged = [];
      (axios.post as jest.Mock).mockResolvedValue({ data: body });

      const submissions = [
        { id: 'sub1', code: 'x = 1', language: 'python', studentId: 's1' },
        { id: 'sub2', code: 'y = 2', language: 'python', studentId: 's2' },
      ];

      await expect(service.callASTEEngine(submissions)).rejects.toThrow('Invalid AST engine response');
    });

    it('Rule 8: rejects a summary whose totalSubmissions does not match the request', async () => {
      const body = validBody();
      body.summary.totalSubmissions = 99;
      body.flagged = [];
      (axios.post as jest.Mock).mockResolvedValue({ data: body });

      const submissions = [
        { id: 'sub1', code: 'x = 1', language: 'python', studentId: 's1' },
        { id: 'sub2', code: 'y = 2', language: 'python', studentId: 's2' },
      ];

      await expect(service.callASTEEngine(submissions)).rejects.toThrow('does not match');
    });

    it('Rule 8: rejects flaggedPairs greater than totalPairs', async () => {
      const body = validBody();
      body.summary.flaggedPairs = 5;
      body.flagged = [];
      (axios.post as jest.Mock).mockResolvedValue({ data: body });

      const submissions = [
        { id: 'sub1', code: 'x = 1', language: 'python', studentId: 's1' },
        { id: 'sub2', code: 'y = 2', language: 'python', studentId: 's2' },
      ];

      await expect(service.callASTEEngine(submissions)).rejects.toThrow('Invalid AST engine response');
    });

    it('Rule 8: rejects a pair missing submissionA/submissionB', async () => {
      const body = validBody();
      delete (body.pairs[0] as any).submissionA;
      body.flagged = [];
      (axios.post as jest.Mock).mockResolvedValue({ data: body });

      const submissions = [
        { id: 'sub1', code: 'x = 1', language: 'python', studentId: 's1' },
        { id: 'sub2', code: 'y = 2', language: 'python', studentId: 's2' },
      ];

      await expect(service.callASTEEngine(submissions)).rejects.toThrow('Invalid AST engine response');
    });
  });

  describe('updateJobStatus', () => {
    it('should update status with error message', async () => {
      const firestore = require('../../db/firestore').getFirestore();
      const mockUpdate = firestore.collection().doc().update;

      await service.updateJobStatus('job-123', 'FAILED', 'Error occurred');

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FAILED',
          error: 'Error occurred',
        })
      );
    });
  });
});
