import { getFirestore } from '../../db/firestore';
import { MONITOR_FLAG_TYPES, COLLECTIONS } from '../../config/constants';

export type MonitorFlagType = typeof MONITOR_FLAG_TYPES[keyof typeof MONITOR_FLAG_TYPES];

export interface MonitorFlag {
  id: string;
  submissionId: string;
  studentId: string;
  testId: string;
  type: MonitorFlagType;
  detail: string;
  createdAt: string;
}

export interface CreateFlagInput {
  submissionId: string;
  studentId: string;
  testId: string;
  type: MonitorFlagType;
  detail: string;
}

export class MonitorService {
  /**
   * Create a new monitor flag.
   * 
   * IMPORTANT: This is advisory-only. Flag creation has NO side effects
   * beyond storing the flag — it does NOT auto-fail, auto-terminate,
   * or auto-flag-as-plagiarism any submission.
   * 
   * Flags are append-only. No PUT/PATCH/DELETE routes exist for them.
   */
  async createFlag(input: CreateFlagInput): Promise<MonitorFlag> {
    const firestore = getFirestore();
    const flagRef = firestore.collection(COLLECTIONS.MONITOR_FLAGS).doc();

    const flag: MonitorFlag = {
      id: flagRef.id,
      submissionId: input.submissionId,
      studentId: input.studentId,
      testId: input.testId,
      type: input.type,
      detail: input.detail,
      createdAt: new Date().toISOString(),
    };

    await flagRef.set(flag);

    return flag;
  }

  /**
   * Get all flags for a submission.
   */
  async getFlagsBySubmission(submissionId: string): Promise<MonitorFlag[]> {
    const firestore = getFirestore();
    const snapshot = await firestore
      .collection(COLLECTIONS.MONITOR_FLAGS)
      .where('submissionId', '==', submissionId)
      .orderBy('createdAt', 'asc')
      .get();

    return snapshot.docs.map((doc) => doc.data() as MonitorFlag);
  }

  /**
   * Get all flags for a test (for teacher view).
   */
  async getFlagsByTest(testId: string): Promise<MonitorFlag[]> {
    const firestore = getFirestore();
    const snapshot = await firestore
      .collection(COLLECTIONS.MONITOR_FLAGS)
      .where('testId', '==', testId)
      .orderBy('createdAt', 'asc')
      .get();

    return snapshot.docs.map((doc) => doc.data() as MonitorFlag);
  }

  /**
   * Get all flags for a student.
   */
  async getFlagsByStudent(studentId: string): Promise<MonitorFlag[]> {
    const firestore = getFirestore();
    const snapshot = await firestore
      .collection(COLLECTIONS.MONITOR_FLAGS)
      .where('studentId', '==', studentId)
      .orderBy('createdAt', 'asc')
      .get();

    return snapshot.docs.map((doc) => doc.data() as MonitorFlag);
  }
}

export const monitorService = new MonitorService();
