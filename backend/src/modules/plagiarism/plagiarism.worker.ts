import { Worker, Job } from 'bullmq';
import * as admin from 'firebase-admin';
import { redis } from '../../lib/redis';
import { COLLECTIONS } from '../../db/collections';
import { PlagiarismStatus } from './plagiarism.service';
import { PlagiarismResponseSchema } from './plagiarism.schema';
import { callAstEngine } from './plagiarism.astClient';
import type { AstSubmission } from './plagiarism.types';

/**
 * The code to compare from a submission's `answers`. Two shapes are accepted:
 *
 *   { code, language }                                  -- one program per test
 *   { language, questions: { [questionId]: { code } } } -- one per question
 *
 * For the per-question shape the programs are joined in question order, so a
 * test with one question per experiment (the recommended setup) compares
 * exactly that experiment's code.
 */
export const extractCode = (answers: any): { code: unknown; language: unknown } => {
  if (answers && typeof answers.code === 'string') {
    return { code: answers.code, language: answers.language };
  }
  const questions = answers?.questions;
  if (questions && typeof questions === 'object') {
    const parts = Object.keys(questions)
      .sort()
      .map((key) => questions[key]?.code)
      .filter((part): part is string => typeof part === 'string' && part.trim() !== '');
    return { code: parts.join('\n\n'), language: answers.language };
  }
  return { code: undefined, language: answers?.language };
};

// The AST engine rejects batches above this size with a 422 (MAX_BATCH_SIZE, config.py:24 in the engine).
// Splitting into chunks is NOT a safe workaround: pairs that straddle chunks would silently never be compared.
// Above the limit we fail loudly instead of truncating or chunking.
export const MAX_AST_BATCH_SIZE = 50;

export const plagiarismProcessor = async (job: Job) => {
  const { testId } = job.data;
  const db = admin.firestore();
  const docRef = db.collection(COLLECTIONS.PLAGIARISM_RESULTS).doc(testId);

  const clearData = {
    pairs: admin.firestore.FieldValue.delete(),
    flagged: admin.firestore.FieldValue.delete(),
    summary: admin.firestore.FieldValue.delete(),
    skipped: admin.firestore.FieldValue.delete(),
    message: admin.firestore.FieldValue.delete(),
    error: admin.firestore.FieldValue.delete()
  };

  try {
    await docRef.set({ status: PlagiarismStatus.PROCESSING }, { merge: true });

    // Fetch submissions
    const submissionsSnapshot = await db.collection(COLLECTIONS.SUBMISSIONS)
      .where('testId', '==', testId)
      .where('status', '==', 'SUBMITTED')
      .get();
    
    const submissions: AstSubmission[] = [];
    const skipped: Record<string, string> = {};

    submissionsSnapshot.docs.forEach(doc => {
      const data = doc.data();

      if (data.status !== 'SUBMITTED') {
        return; // defensive skip, though query should filter this
      }

      const { code, language } = extractCode(data.answers);

      if (!code || typeof code !== 'string' || code.trim() === '') {
        skipped[doc.id] = 'Missing or empty code';
        return;
      }

      if (language !== 'python') {
        skipped[doc.id] = 'Unsupported language (only python allowed)';
        return;
      }

      submissions.push({
        id: doc.id,
        code,
        language,
        studentId: data.studentId
      });
    });

    if (submissions.length < 2) {
      await docRef.set({ 
        ...clearData,
        status: PlagiarismStatus.COMPLETED,
        message: 'Not enough valid submissions to check (minimum 2 required)',
        skipped,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return;
    }

    if (submissions.length > MAX_AST_BATCH_SIZE) {
      await docRef.set({
        ...clearData,
        status: PlagiarismStatus.FAILED,
        error: `Too many submissions for one plagiarism check (max ${MAX_AST_BATCH_SIZE})`,
        skipped,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return;
    }

    const result = await callAstEngine(submissions);

    const parsed = PlagiarismResponseSchema.safeParse(result);

    if (!parsed.success) {
      await docRef.set({
        ...clearData,
        status: PlagiarismStatus.FAILED,
        error: 'AST response invalid',
        skipped,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return;
    }

    await docRef.set({
      ...clearData,
      status: PlagiarismStatus.COMPLETED,
      pairs: parsed.data.pairs,
      flagged: parsed.data.flagged,
      summary: parsed.data.summary,
      skipped,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

  } catch (error: any) {
    console.error(`Plagiarism job failed for testId ${testId}:`, error);
    await docRef.set({ 
      ...clearData,
      status: PlagiarismStatus.FAILED, 
      error: 'AST engine request failed',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }
};

export let plagiarismWorker: Worker;

export const initPlagiarismWorker = () => {
  if (!plagiarismWorker) {
    plagiarismWorker = new Worker('plagiarism-check', plagiarismProcessor, { connection: redis });
    plagiarismWorker.on('error', (err) => {
      console.error('Plagiarism worker error:', err.message);
    });
  }
};
