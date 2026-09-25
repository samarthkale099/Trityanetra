import { getFirestore } from '../../db/firestore';
import { COLLECTIONS, SUBMISSION_STATUS, SubmissionStatus } from '../../config/constants';
import { TestWindowGuard } from '../test/testWindow.guard';

export interface SubmissionRecord {
  id: string;
  testId: string;
  studentId: string;
  status: SubmissionStatus;
  code: string;
  language?: string;
  createdAt: string;
  submittedAt?: string;
  finalizedAt?: string;
}

export class SubmissionServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = 'SubmissionServiceError';
  }
}

export class TestWindowClosedError extends SubmissionServiceError {
  constructor(testId: string) {
    super(`Test window is closed for test ${testId}`, 'TEST_WINDOW_CLOSED', 403);
    this.name = 'TestWindowClosedError';
  }
}

export class SubmissionNotFoundError extends SubmissionServiceError {
  constructor(submissionId: string) {
    super(`Submission ${submissionId} not found`, 'NOT_FOUND', 404);
    this.name = 'SubmissionNotFoundError';
  }
}

export class SubmissionLockedError extends SubmissionServiceError {
  constructor(submissionId: string) {
    super('Submission is immutable once submitted', 'SUBMISSION_LOCKED', 409);
    this.name = 'SubmissionLockedError';
  }
}

export class SubmissionForbiddenError extends SubmissionServiceError {
  constructor(submissionId: string) {
    super(`Submission ${submissionId} does not belong to this student`, 'FORBIDDEN', 403);
    this.name = 'SubmissionForbiddenError';
  }
}

const isLockedStatus = (status: unknown): boolean =>
  status === SUBMISSION_STATUS.SUBMITTED || status === SUBMISSION_STATUS.FINALIZED;

export class SubmissionService {
  /** Deterministic document ID — one submission per (testId, studentId). */
  private docId(testId: string, studentId: string): string {
    return `${testId}_${studentId}`;
  }

  /**
   * Idempotent get-or-create: calling twice for the same (testId, studentId)
   * yields exactly one submission document; the second call returns the
   * existing record instead of creating a duplicate or throwing.
   * Creation outside the test's time window is rejected.
   */
  async createSubmission(
    testId: string,
    studentId: string,
    options?: { serverTime?: Date }
  ): Promise<{ submission: SubmissionRecord; created: boolean }> {
    if (!testId || !studentId) {
      throw new SubmissionServiceError('testId and studentId required', 'VALIDATION_ERROR', 400);
    }

    const serverTime = options?.serverTime ?? new Date();
    const windowOpen = await TestWindowGuard.check(testId, serverTime);
    if (!windowOpen) {
      throw new TestWindowClosedError(testId);
    }

    const firestore = getFirestore();
    const ref = firestore.collection(COLLECTIONS.SUBMISSIONS).doc(this.docId(testId, studentId));

    const existing = await ref.get();
    if (existing.exists) {
      return { submission: existing.data() as SubmissionRecord, created: false };
    }

    const record: SubmissionRecord = {
      id: this.docId(testId, studentId),
      testId,
      studentId,
      status: SUBMISSION_STATUS.DRAFT,
      code: '',
      createdAt: serverTime.toISOString(),
    };
    await ref.set(record);
    return { submission: record, created: true };
  }

  /** Real Firestore read by (testId, studentId) — returns null when absent. */
  async getSubmission(testId: string, studentId: string): Promise<SubmissionRecord | null> {
    if (!testId || !studentId) return null;
    return this.getSubmissionById(this.docId(testId, studentId));
  }

  async getSubmissionById(submissionId: string): Promise<SubmissionRecord | null> {
    if (!submissionId) return null;
    const doc = await getFirestore()
      .collection(COLLECTIONS.SUBMISSIONS)
      .doc(submissionId)
      .get();
    return doc.exists ? (doc.data() as SubmissionRecord) : null;
  }

  /**
   * Final submit: writes the code and marks status SUBMITTED.
   *
   * Enforced inside a Firestore transaction (read-check-write), not a plain
   * read-then-write, so two near-simultaneous submit requests (double-click,
   * retry) cannot both succeed: the loser re-reads the committed SUBMITTED
   * status and is rejected with SubmissionLockedError. Submission content is
   * immutable from this point on (also enforced by submissionLockGuard in the
   * controller for the non-concurrent path).
   */
  async submitSubmission(
    submissionId: string,
    studentId: string | undefined,
    code: string,
    language?: string
  ): Promise<SubmissionRecord> {
    if (!submissionId) {
      throw new SubmissionServiceError('submissionId required', 'VALIDATION_ERROR', 400);
    }
    if (typeof code !== 'string') {
      throw new SubmissionServiceError('code required', 'VALIDATION_ERROR', 400);
    }

    const firestore = getFirestore();
    const ref = firestore.collection(COLLECTIONS.SUBMISSIONS).doc(submissionId);

    return await firestore.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new SubmissionNotFoundError(submissionId);
      }
      const data = snap.data() as SubmissionRecord;

      if (isLockedStatus(data.status)) {
        throw new SubmissionLockedError(submissionId);
      }
      if (studentId && data.studentId && data.studentId !== studentId) {
        throw new SubmissionForbiddenError(submissionId);
      }

      const updated: SubmissionRecord = {
        ...data,
        code,
        status: SUBMISSION_STATUS.SUBMITTED,
        submittedAt: new Date().toISOString(),
      };
      if (language !== undefined) updated.language = language;

      await tx.set(ref, updated);
      return updated;
    });
  }

  /**
   * Finalize the submission record itself: status -> FINALIZED plus a
   * finalizedAt timestamp (preserved on repeated finalize calls).
   * Throws SubmissionNotFoundError when the document does not exist.
   */
  async finalizeSubmission(submissionId: string): Promise<SubmissionRecord> {
    if (!submissionId) {
      throw new SubmissionServiceError('submissionId required', 'VALIDATION_ERROR', 400);
    }
    const firestore = getFirestore();
    const ref = firestore.collection(COLLECTIONS.SUBMISSIONS).doc(submissionId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new SubmissionNotFoundError(submissionId);
    }
    const data = snap.data() as SubmissionRecord;
    const update: Partial<SubmissionRecord> = { status: SUBMISSION_STATUS.FINALIZED };
    if (!data.finalizedAt) update.finalizedAt = new Date().toISOString();

    await ref.update(update);
    return { ...data, ...update } as SubmissionRecord;
  }
}

export const submissionService = new SubmissionService();
