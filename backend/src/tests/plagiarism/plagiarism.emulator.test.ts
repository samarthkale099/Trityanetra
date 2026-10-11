import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import * as admin from 'firebase-admin';
import { plagiarismProcessor } from '../../modules/plagiarism/plagiarism.worker';
import { COLLECTIONS } from '../../db/collections';
import { PlagiarismStatus } from '../../modules/plagiarism/plagiarism.service';
import '../../app'; // Initializes Firebase admin

describe('plagiarismProcessor (Emulator)', () => {
  const db = admin.firestore();
  let globalFetch: any;

  beforeAll(async () => {
    // Warm up
    await db.collection('warmup').doc('warmup').get();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    globalFetch = vi.fn();
    global.fetch = globalFetch;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it('clears stale results (pairs, summary) when a new run fails', async () => {
    const testId = 'stale-test-1';
    const docRef = db.collection(COLLECTIONS.PLAGIARISM_RESULTS).doc(testId);
    
    // Seed with COMPLETED
    await docRef.set({
      status: PlagiarismStatus.COMPLETED,
      pairs: ['some-old-pair'],
      summary: { old: 'summary' },
      flagged: ['old-flag'],
      error: 'old error'
    });

    // Seed 2 submissions so it attempts to call the engine
    await db.collection(COLLECTIONS.SUBMISSIONS).doc(`sub1_${testId}`).set({ testId, status: 'SUBMITTED', answers: { code: 'a', language: 'python' } });
    await db.collection(COLLECTIONS.SUBMISSIONS).doc(`sub2_${testId}`).set({ testId, status: 'SUBMITTED', answers: { code: 'b', language: 'python' } });

    // Mock fetch to FAIL (500)
    globalFetch.mockResolvedValue({ ok: false, status: 500 });

    // Run processor
    await plagiarismProcessor({ data: { testId } } as any);

    // Assert stale fields are gone and status is FAILED
    const updatedDoc = await docRef.get();
    const data = updatedDoc.data()!;
    
    expect(data.status).toBe(PlagiarismStatus.FAILED);
    expect(data.error).toBe('AST engine request failed');
    expect(data.pairs).toBeUndefined();
    expect(data.summary).toBeUndefined();
    expect(data.flagged).toBeUndefined();
  });

  it('clears stale results when a new run aborts due to fewer than 2 valid submissions', async () => {
    const testId = 'stale-test-2';
    const docRef = db.collection(COLLECTIONS.PLAGIARISM_RESULTS).doc(testId);
    
    // Seed with COMPLETED
    await docRef.set({
      status: PlagiarismStatus.COMPLETED,
      pairs: ['some-old-pair'],
      summary: { old: 'summary' }
    });

    // DO NOT seed 2 valid submissions (we leave it empty)
    
    // Run processor
    await plagiarismProcessor({ data: { testId } } as any);

    // Assert stale fields are gone and status is COMPLETED with skipped message
    const updatedDoc = await docRef.get();
    const data = updatedDoc.data()!;
    
    expect(data.status).toBe(PlagiarismStatus.COMPLETED);
    expect(data.message).toBe('Not enough valid submissions to check (minimum 2 required)');
    expect(data.pairs).toBeUndefined();
    expect(data.summary).toBeUndefined();
  });
});
