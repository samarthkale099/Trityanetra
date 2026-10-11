import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import { Worker } from 'bullmq';
import { env } from '../../config/env';
import { PlagiarismStatus } from '../../modules/plagiarism/plagiarism.service';

// Mock dependencies
const mockQueueInstance = { add: vi.fn(), on: vi.fn() };
vi.mock('bullmq', () => {
  return {
    Worker: vi.fn().mockImplementation((name, processor) => {
      return { processor, on: vi.fn() };
    }),
    Queue: vi.fn().mockImplementation(() => mockQueueInstance)
  };
});

vi.mock('../../../lib/redis', () => ({
  redis: {}
}));

const mockSet = vi.fn();
const mockGet = vi.fn();
const mockWhere = vi.fn();
mockWhere.mockReturnValue({
  where: mockWhere,
  get: mockGet
});

vi.mock('firebase-admin', () => {
  return {
    firestore: Object.assign(vi.fn(() => ({
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          set: mockSet,
          get: mockGet
        })),
        where: mockWhere,
        get: mockGet
      }))
    })), {
      FieldValue: {
        serverTimestamp: vi.fn(() => 'mock-timestamp'),
        delete: vi.fn(() => 'mock-delete')
      }
    })
  };
});

// Import processor after mocks
import { plagiarismProcessor } from '../../modules/plagiarism/plagiarism.worker';

describe('plagiarismWorker', () => {
  let globalFetch: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    env.AST_ENGINE_URL = 'http://mock-engine';
    env.AST_ENGINE_SECRET = 'mock-secret';

    mockGet.mockResolvedValue({
      docs: [
        {
          id: 'sub1',
          data: () => ({ status: 'SUBMITTED', answers: { code: 'print("hello")', language: 'python' }, studentId: 'student1' })
        },
        {
          id: 'sub2',
          data: () => ({ status: 'SUBMITTED', answers: { code: 'print("hello world")', language: 'python' }, studentId: 'student2' })
        }
      ]
    });

    globalFetch = vi.fn();
    global.fetch = globalFetch;
  });

  const validEngineResponse = {
    pairs: [{
      submissionA: "sub1", 
      submissionB: "sub2",
      metrics: { 
        cosine_similarity: 1, 
        ted_score: 1,
        identifier_overlap: 0.1429, 
        operator_overlap: 1,
        combined_score: 0.8286 
      },
      flagLevel: "high" 
    }],
    flagged: [{
      submissionA: "sub1", 
      submissionB: "sub2",
      metrics: { 
        cosine_similarity: 1, 
        ted_score: 1,
        identifier_overlap: 0.1429, 
        operator_overlap: 1,
        combined_score: 0.8286 
      },
      flagLevel: "high" 
    }],
    summary: { 
      totalSubmissions: 2, 
      totalPairs: 1,
      flaggedPairs: 1, 
      processingTimeMs: 7.15 
    }
  };

  it('a) The real response above, verbatim, parses and is stored as COMPLETED', async () => {
    globalFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(validEngineResponse)
    });

    await plagiarismProcessor({ data: { testId: 'test1' } } as any);

    // Ensure it parsed and stored successfully
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: PlagiarismStatus.COMPLETED }),
      { merge: true }
    );
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ summary: validEngineResponse.summary }),
      { merge: true }
    );
  });

  it('b) A response missing "summary" -> FAILED, nothing stored', async () => {
    const { summary, ...missingSummary } = validEngineResponse;
    globalFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(missingSummary)
    });

    await plagiarismProcessor({ data: { testId: 'test1' } } as any);

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ 
        status: PlagiarismStatus.FAILED,
        error: 'AST response invalid'
      }),
      { merge: true }
    );
    // Should NOT have stored the malformed payload
    const allCalls = mockSet.mock.calls.map(c => c[0]);
    const storedPayload = allCalls.find(c => c.status === PlagiarismStatus.COMPLETED);
    expect(storedPayload).toBeUndefined();
  });

  it('c) A response where "pairs" is a string -> FAILED', async () => {
    const stringPairs = { ...validEngineResponse, pairs: "invalid-string" };
    globalFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(stringPairs)
    });

    await plagiarismProcessor({ data: { testId: 'test1' } } as any);

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ 
        status: PlagiarismStatus.FAILED,
        error: 'AST response invalid'
      }),
      { merge: true }
    );
  });

  it('d) A non-200 from the engine -> FAILED', async () => {
    globalFetch.mockResolvedValue({
      ok: false,
      status: 500
    });

    await plagiarismProcessor({ data: { testId: 'test1' } } as any);

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ 
        status: PlagiarismStatus.FAILED,
        error: 'AST engine request failed'
      }),
      { merge: true }
    );
  });

  it('e) A network error -> FAILED', async () => {
    globalFetch.mockRejectedValueOnce(new Error('Network error'));

    await plagiarismProcessor({ data: { testId: 'test1' } } as any);

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ 
        status: PlagiarismStatus.FAILED,
        error: 'AST engine request failed'
      }),
      { merge: true }
    );
  });

  it('f) The request carries the X-Internal-Secret header', async () => {
    globalFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(validEngineResponse)
    });

    await plagiarismProcessor({ data: { testId: 'test1' } } as any);

    expect(globalFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Internal-Secret': 'mock-secret'
        })
      })
    );
  });

  it('g) flagLevel "critical" -> FAILED, nothing stored', async () => {
    const invalidResponse = JSON.parse(JSON.stringify(validEngineResponse));
    invalidResponse.pairs[0].flagLevel = 'critical';
    
    globalFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(invalidResponse)
    });

    await plagiarismProcessor({ data: { testId: 'test1' } } as any);

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ 
        status: PlagiarismStatus.FAILED,
        error: 'AST response invalid'
      }),
      { merge: true }
    );
  });

  it('h) combined_score 1.2 -> FAILED', async () => {
    const invalidResponse = JSON.parse(JSON.stringify(validEngineResponse));
    invalidResponse.pairs[0].metrics.combined_score = 1.2;
    
    globalFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(invalidResponse)
    });

    await plagiarismProcessor({ data: { testId: 'test1' } } as any);

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ 
        status: PlagiarismStatus.FAILED,
        error: 'AST response invalid'
      }),
      { merge: true }
    );
  });

  it('i) combined_score -0.1 -> FAILED', async () => {
    const invalidResponse = JSON.parse(JSON.stringify(validEngineResponse));
    invalidResponse.pairs[0].metrics.combined_score = -0.1;
    
    globalFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(invalidResponse)
    });

    await plagiarismProcessor({ data: { testId: 'test1' } } as any);

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ 
        status: PlagiarismStatus.FAILED,
        error: 'AST response invalid'
      }),
      { merge: true }
    );
  });

  it('j) a "none" level pair inside pairs -> parses and is stored as COMPLETED', async () => {
    const validNoneResponse = JSON.parse(JSON.stringify(validEngineResponse));
    validNoneResponse.pairs[0].flagLevel = 'none';
    
    globalFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(validNoneResponse)
    });

    await plagiarismProcessor({ data: { testId: 'test1' } } as any);

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: PlagiarismStatus.COMPLETED }),
      { merge: true }
    );
  });

  it('g) should query for SUBMITTED submissions only and not send DRAFTs', async () => {
    globalFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(validEngineResponse)
    });

    await plagiarismProcessor({ data: { testId: 'test-filter' } } as any);

    expect(mockWhere).toHaveBeenCalledWith('testId', '==', 'test-filter');
    expect(mockWhere).toHaveBeenCalledWith('status', '==', 'SUBMITTED');
  });

  it('h) should skip submissions missing code or with language!==python, and if <2 remain, complete without calling engine', async () => {
    mockGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'sub1',
          data: () => ({ status: 'SUBMITTED', answers: { code: 'print("hello")', language: 'python' }, studentId: 'student1' })
        },
        {
          id: 'sub-missing-code',
          data: () => ({ status: 'SUBMITTED', answers: { language: 'python' }, studentId: 'student2' })
        },
        {
          id: 'sub-wrong-lang',
          data: () => ({ status: 'SUBMITTED', answers: { code: 'console.log("hi")', language: 'javascript' }, studentId: 'student3' })
        }
      ]
    });

    await plagiarismProcessor({ data: { testId: 'test-skips' } } as any);

    expect(globalFetch).not.toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: PlagiarismStatus.COMPLETED,
        message: 'Not enough valid submissions to check (minimum 2 required)',
        skipped: {
          'sub-missing-code': 'Missing or empty code',
          'sub-wrong-lang': 'Unsupported language (only python allowed)'
        }
      }),
      { merge: true }
    );
  });

  const manySubmissions = (n: number) => ({
    docs: Array.from({ length: n }, (_, i) => ({
      id: `sub${i}`,
      data: () => ({ status: 'SUBMITTED', answers: { code: `print(${i})`, language: 'python' }, studentId: `student${i}` })
    }))
  });

  it('m) more than 50 valid submissions -> FAILED with a clear message, engine never called, nothing truncated or chunked', async () => {
    mockGet.mockResolvedValueOnce(manySubmissions(51));

    await plagiarismProcessor({ data: { testId: 'test-too-many' } } as any);

    expect(globalFetch).not.toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: PlagiarismStatus.FAILED,
        error: 'Too many submissions for one plagiarism check (max 50)'
      }),
      { merge: true }
    );
  });

  it('n) exactly 50 valid submissions is sent whole in a single request', async () => {
    mockGet.mockResolvedValueOnce(manySubmissions(50));
    globalFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(validEngineResponse)
    });

    await plagiarismProcessor({ data: { testId: 'test-fifty' } } as any);

    expect(globalFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(globalFetch.mock.calls[0][1].body);
    expect(body.submissions).toHaveLength(50);
  });

  it('i) should clear stale fields (pairs, summary, etc.) when overwriting a previous run', async () => {
    mockGet.mockResolvedValueOnce({
      docs: [] // fewer than 2
    });

    await plagiarismProcessor({ data: { testId: 'test-stale' } } as any);

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: PlagiarismStatus.COMPLETED,
        pairs: admin.firestore.FieldValue.delete(),
        summary: admin.firestore.FieldValue.delete(),
        flagged: admin.firestore.FieldValue.delete(),
        error: admin.firestore.FieldValue.delete()
      }),
      { merge: true }
    );
  });

  it('j) should defensively skip any doc whose status is not SUBMITTED in code, never sending it in fetch', async () => {
    mockGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'sub-draft',
          data: () => ({ status: 'DRAFT', answers: { code: 'print("draft")', language: 'python' }, studentId: 'student-draft' })
        },
        {
          id: 'sub-valid1',
          data: () => ({ status: 'SUBMITTED', answers: { code: 'print("hi")', language: 'python' }, studentId: 'student-1' })
        },
        {
          id: 'sub-valid2',
          data: () => ({ status: 'SUBMITTED', answers: { code: 'print("hello")', language: 'python' }, studentId: 'student-2' })
        }
      ]
    });
    
    globalFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(validEngineResponse)
    });

    await plagiarismProcessor({ data: { testId: 'test-draft-skip' } } as any);

    // The fetch should only contain sub-valid1 and sub-valid2
    expect(globalFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringMatching(/"id":"sub-valid1"/)
      })
    );
    expect(globalFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.not.stringMatching(/"id":"sub-draft"/)
      })
    );
  });
  it('k) enqueuePlagiarismCheck creates the queue lazily and calls add', async () => {
    const { enqueuePlagiarismCheck } = await import('../../modules/plagiarism/plagiarism.queue');
    const { Queue } = await import('bullmq');
    
    await enqueuePlagiarismCheck('lazy-test-id');
    
    expect(Queue).toHaveBeenCalledWith('plagiarism-check', expect.any(Object));
    expect(mockQueueInstance.add).toHaveBeenCalledWith('check-test', { testId: 'lazy-test-id' });
  });

  it('l) triggerPlagiarismCheck writes QUEUED doc and enqueues', async () => {
    const { triggerPlagiarismCheck } = await import('../../modules/plagiarism/plagiarism.service');

    mockGet.mockResolvedValueOnce({ exists: false });

    await triggerPlagiarismCheck('trigger-test-id');

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'QUEUED' })
    );
    expect(mockQueueInstance.add).toHaveBeenCalledWith('check-test', { testId: 'trigger-test-id' });
  });
});
