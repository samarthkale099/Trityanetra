import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { getFirestore } from '../../db/firestore';
import { env } from '../../config/env';
import { PLAGIARISM_JOB_STATUS, PlagiarismJobStatus, PLAGIARISM_FLAG_LEVEL, COLLECTIONS } from '../../config/constants';
import { enqueuePlagiarismJob, PlagiarismJobData } from './queue';

export interface PlagiarismJob {
  id: string;
  testId: string;
  submissionIds: string[];
  status: PlagiarismJobStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface ASTEngineSubmission {
  id: string;
  code: string;
  language: string;
  studentId: string;
}

export interface ASTEngineResult {
  pairs: Array<{
    submissionA: string;
    submissionB: string;
    metrics: {
      cosine_similarity: number;
      ted_score: number;
      identifier_overlap: number;
      operator_overlap: number;
      combined_score: number;
    };
    flagLevel: string;
  }>;
  flagged: Array<any>;
  summary: {
    totalSubmissions: number;
    totalPairs: number;
    flaggedPairs: number;
    processingTimeMs: number;
  };
}

export interface PlagiarismResult {
  id: string;
  jobId: string;
  testId: string;
  submissionA: string;
  submissionB: string;
  flagLevel: string;
  metrics: any;
  createdAt: string;
}

export class PlagiarismService {
  /**
   * Create a plagiarism detection job and enqueue it.
   *
   * Every job has a defined terminal state (rule: status enum is exactly
   * QUEUED | PROCESSING | COMPLETED | FAILED):
   *  - QUEUED: Created, waiting for the worker
   *  - COMPLETED: Successfully processed
   *  - FAILED: Error during enqueue or processing
   */
  async createJob(
    testId: string,
    submissionIds: string[],
    createdBy: string,
  ): Promise<PlagiarismJob> {
    const firestore = getFirestore();
    const jobId = uuidv4();
    const now = new Date().toISOString();

    const job: PlagiarismJob = {
      id: jobId,
      testId,
      submissionIds,
      status: PLAGIARISM_JOB_STATUS.QUEUED,
      createdBy,
      createdAt: now,
      updatedAt: now,
    };

    // Store job in Firestore
    await firestore.collection(COLLECTIONS.PLAGIARISM_JOBS).doc(jobId).set(job);

    // Enqueue to BullMQ — if enqueue fails, mark FAILED (never leave a
    // job stuck in QUEUED with nothing processing it) and rethrow.
    try {
      await enqueuePlagiarismJob({
        jobId,
        testId,
        submissionIds,
        createdBy,
      });
    } catch (error) {
      await this.updateJobStatus(
        jobId,
        PLAGIARISM_JOB_STATUS.FAILED,
        `Failed to enqueue job: ${(error as Error).message}`,
      );
      throw error;
    }

    return job;
  }

  /**
   * Get a plagiarism job by ID.
   */
  async getJob(jobId: string): Promise<PlagiarismJob | null> {
    const firestore = getFirestore();
    const doc = await firestore.collection(COLLECTIONS.PLAGIARISM_JOBS).doc(jobId).get();
    if (!doc.exists) return null;
    return doc.data() as PlagiarismJob;
  }

  /**
   * Get all jobs for a test.
   */
  async getJobsByTest(testId: string): Promise<PlagiarismJob[]> {
    const firestore = getFirestore();
    const snapshot = await firestore
      .collection(COLLECTIONS.PLAGIARISM_JOBS)
      .where('testId', '==', testId)
      .orderBy('createdAt', 'desc')
      .get();

    return snapshot.docs.map((doc) => doc.data() as PlagiarismJob);
  }

  /**
   * Update job status with optional error message.
   * Enforces rule: status must be one of QUEUED | PROCESSING | COMPLETED | FAILED.
   * Any other value (e.g. PENDING, TIMED_OUT) is rejected — it throws and
   * no Firestore write occurs.
   */
  async updateJobStatus(
    jobId: string,
    status: PlagiarismJobStatus,
    error?: string,
  ): Promise<void> {
    const validStatuses: string[] = Object.values(PLAGIARISM_JOB_STATUS);
    if (!validStatuses.includes(status)) {
      throw new Error(
        `Invalid plagiarism job status "${status}". Allowed: ${validStatuses.join(', ')}`
      );
    }

    const firestore = getFirestore();
    const updateData: any = {
      status,
      updatedAt: new Date().toISOString(),
    };
    if (error) updateData.error = error;

    await firestore.collection(COLLECTIONS.PLAGIARISM_JOBS).doc(jobId).update(updateData);
  }

  /**
   * Get submissions code for the plagiarism job.
   */
  async getSubmissionsForJob(submissionIds: string[]): Promise<ASTEngineSubmission[]> {
    const firestore = getFirestore();
    const submissions: ASTEngineSubmission[] = [];

    for (const id of submissionIds) {
      const doc = await firestore.collection(COLLECTIONS.SUBMISSIONS).doc(id).get();
      if (doc.exists) {
        const data = doc.data()!;
        submissions.push({
          id: doc.id,
          code: data.code || '',
          language: data.language || 'python',
          studentId: data.studentId || '',
        });
      }
    }

    return submissions;
  }

  /**
   * Call the AST engine to analyze submissions.
   * Only ever called via an authenticated internal request (X-Internal-Secret)
   * and the response is fully validated (structure, flag level enum, numeric
   * bounds) before it is used. Malformed output throws — it never crashes
   * the backend; the worker maps the throw to a FAILED job status.
   */
  async callASTEEngine(submissions: ASTEngineSubmission[]): Promise<ASTEngineResult> {
    try {
      const response = await axios.post(
        `${env.AST_ENGINE_URL}/api/v1/plagiarism/check`,
        { submissions },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Secret': env.AST_ENGINE_INTERNAL_SECRET,
          },
          timeout: 120000, // 2 minute timeout
        }
      );

      return this.validateASTEEngineResponse(response.data, submissions.length);
    } catch (error: any) {
      if (axios.isAxiosError(error) || (error && typeof error === 'object')) {
        const code = error.code;
        const status = error.response?.status;
        if (code === 'ECONNREFUSED') {
          throw new Error('AST engine is unavailable');
        }
        if (status === 408) {
          throw new Error('AST engine processing timed out');
        }
        if (axios.isAxiosError(error)) {
          throw new Error(`AST engine error: ${error.message}`);
        }
      }
      throw error;
    }
  }

  /**
   * Validate the AST engine response: structure, enum membership, and
   * numeric bounds. Throws on any malformed field.
   */
  private validateASTEEngineResponse(data: any, expectedSubmissions: number): ASTEngineResult {
    const fail = (message: string): never => {
      throw new Error(`Invalid AST engine response: ${message}`);
    };

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      fail('not an object');
    }
    if (!Array.isArray(data.pairs)) fail('missing pairs array');
    if (!Array.isArray(data.flagged)) fail('missing flagged array');
    if (!data.summary || typeof data.summary !== 'object' || Array.isArray(data.summary)) {
      fail('missing summary object');
    }

    // Summary numeric bounds (all must be finite, non-negative numbers)
    const summaryFields = ['totalSubmissions', 'totalPairs', 'flaggedPairs', 'processingTimeMs'];
    for (const field of summaryFields) {
      const value = (data.summary as any)[field];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        fail(`summary.${field} must be a non-negative finite number`);
      }
    }
    if (data.summary.totalSubmissions !== expectedSubmissions) {
      fail(`summary.totalSubmissions (${data.summary.totalSubmissions}) does not match submitted count (${expectedSubmissions})`);
    }
    if (data.summary.flaggedPairs > data.summary.totalPairs) {
      fail('summary.flaggedPairs exceeds summary.totalPairs');
    }

    const allowedFlagLevels: string[] = Object.values(PLAGIARISM_FLAG_LEVEL);
    const metricFields = [
      'cosine_similarity',
      'ted_score',
      'identifier_overlap',
      'operator_overlap',
      'combined_score',
    ];

    const validatePair = (pair: any, where: string): void => {
      if (!pair || typeof pair !== 'object' || Array.isArray(pair)) {
        fail(`${where} is not an object`);
      }
      if (typeof pair.submissionA !== 'string' || pair.submissionA.length === 0) {
        fail(`${where}.submissionA must be a non-empty string`);
      }
      if (typeof pair.submissionB !== 'string' || pair.submissionB.length === 0) {
        fail(`${where}.submissionB must be a non-empty string`);
      }
      if (typeof pair.flagLevel !== 'string' || !allowedFlagLevels.includes(pair.flagLevel)) {
        fail(`${where}.flagLevel must be one of: ${allowedFlagLevels.join(', ')}`);
      }
      if (!pair.metrics || typeof pair.metrics !== 'object' || Array.isArray(pair.metrics)) {
        fail(`${where}.metrics must be an object`);
      }
      for (const metric of metricFields) {
        const value = pair.metrics[metric];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
          fail(`${where}.metrics.${metric} must be a number in [0, 1]`);
        }
      }
    };

    data.pairs.forEach((pair: any, index: number) => validatePair(pair, `pairs[${index}]`));
    data.flagged.forEach((pair: any, index: number) => validatePair(pair, `flagged[${index}]`));

    return data as ASTEngineResult;
  }

  /**
   * Store the raw AST engine result.
   */
  async storeResult(jobId: string, result: ASTEngineResult): Promise<void> {
    const firestore = getFirestore();
    await firestore.collection(COLLECTIONS.PLAGIARISM_JOBS).doc(jobId).update({
      result,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Store individual plagiarism results for each flagged pair.
   */
  async storePlagiarismResults(
    testId: string,
    jobId: string,
    flaggedPairs: any[],
  ): Promise<void> {
    const firestore = getFirestore();

    for (const pair of flaggedPairs) {
      const resultId = uuidv4();
      const result: PlagiarismResult = {
        id: resultId,
        jobId,
        testId,
        submissionA: pair.submissionA,
        submissionB: pair.submissionB,
        flagLevel: pair.flagLevel,
        metrics: pair.metrics,
        createdAt: new Date().toISOString(),
      };

      await firestore.collection(COLLECTIONS.PLAGIARISM_RESULTS).doc(resultId).set(result);
    }
  }

  /**
   * Get plagiarism results for a test.
   */
  async getResultsByTest(testId: string): Promise<PlagiarismResult[]> {
    const firestore = getFirestore();
    const snapshot = await firestore
      .collection(COLLECTIONS.PLAGIARISM_RESULTS)
      .where('testId', '==', testId)
      .get();

    return snapshot.docs.map((doc) => doc.data() as PlagiarismResult);
  }
}

export const plagiarismService = new PlagiarismService();
