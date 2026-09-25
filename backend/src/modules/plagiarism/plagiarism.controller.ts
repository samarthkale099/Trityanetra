import { Request, Response } from 'express';
import { plagiarismService } from './service';
import { ROLES } from '../../config/constants';

export class PlagiarismController {
  /**
   * POST /api/plagiarism/jobs
   * Create a plagiarism detection job.
   * 
   * Authentication: Required (TEACHER or ADMIN role)
   * 
   * Errors:
   *  - 401: Not authenticated
   *  - 403: Not a teacher or admin
   *  - 400: Missing or invalid request body
   */
  async createJob(req: Request, res: Response) {
    try {
      const { testId, submissionIds } = req.body;
      const user = (req as any).user;

      // Validate
      if (!testId) {
        return res.status(400).json({
          error: { message: 'testId is required', code: 'VALIDATION_ERROR' },
        });
      }

      if (!submissionIds || !Array.isArray(submissionIds) || submissionIds.length < 2) {
        return res.status(400).json({
          error: { message: 'At least 2 submissionIds required', code: 'VALIDATION_ERROR' },
        });
      }

      const job = await plagiarismService.createJob(testId, submissionIds, user.uid);
      return res.status(201).json({ job });
    } catch (error) {
      console.error('[Plagiarism Controller] Error creating job:', error);
      return res.status(500).json({
        error: { message: 'Failed to create plagiarism job', code: 'INTERNAL_ERROR' },
      });
    }
  }

  /**
   * GET /api/plagiarism/jobs/:jobId
   * Get plagiarism job status.
   * 
   * Authentication: Required
   */
  async getJob(req: Request, res: Response) {
    try {
      const { jobId } = req.params;
      const job = await plagiarismService.getJob(jobId);

      if (!job) {
        return res.status(404).json({
          error: { message: 'Job not found', code: 'NOT_FOUND' },
        });
      }

      return res.json({ job });
    } catch (error) {
      console.error('[Plagiarism Controller] Error fetching job:', error);
      return res.status(500).json({
        error: { message: 'Failed to fetch plagiarism job', code: 'INTERNAL_ERROR' },
      });
    }
  }

  /**
   * GET /api/plagiarism/jobs/test/:testId
   * Get all plagiarism jobs for a test.
   * 
   * Authentication: Required (TEACHER or ADMIN role)
   */
  async getJobsByTest(req: Request, res: Response) {
    try {
      const { testId } = req.params;
      const jobs = await plagiarismService.getJobsByTest(testId);
      return res.json({ jobs });
    } catch (error) {
      console.error('[Plagiarism Controller] Error fetching test jobs:', error);
      return res.status(500).json({
        error: { message: 'Failed to fetch test plagiarism jobs', code: 'INTERNAL_ERROR' },
      });
    }
  }

  /**
   * GET /api/plagiarism/results/test/:testId
   * Get plagiarism results for a test.
   * 
   * Authentication: Required (TEACHER or ADMIN role)
   */
  async getResultsByTest(req: Request, res: Response) {
    try {
      const { testId } = req.params;
      const results = await plagiarismService.getResultsByTest(testId);
      return res.json({ results });
    } catch (error) {
      console.error('[Plagiarism Controller] Error fetching results:', error);
      return res.status(500).json({
        error: { message: 'Failed to fetch plagiarism results', code: 'INTERNAL_ERROR' },
      });
    }
  }
}

export const plagiarismController = new PlagiarismController();
