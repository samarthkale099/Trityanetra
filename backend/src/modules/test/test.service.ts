import admin from '../../db/firebase';
import { Role, UserIdentity } from '../../types/roles';
import { COLLECTIONS } from '../../db/collections';
import { db } from '../../db/firestore';

// Helper to throw HTTP-like errors
const throwError = (message: string, status: number) => {
  const error: any = new Error(message);
  error.status = status;
  throw error;
};

/** Optional test settings beyond the original title/window/questions. */
export interface TestOptions {
  /** Per-attempt time allowance; defaults to the whole window. */
  durationMinutes?: number;
  instructions?: string;
  language?: string;
}

const toDate = (value: any): Date => (value?.toDate ? value.toDate() : new Date(value));
const toIso = (value: any): string | null => {
  if (!value) return null;
  const date = toDate(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const createTestService = async (
  title: string,
  classroomId: string,
  startTime: string,
  endTime: string,
  questions: any[],
  user: UserIdentity,
  options: TestOptions = {}
) => {

  const classroomDoc = await db.collection(COLLECTIONS.CLASSROOMS).doc(classroomId).get();
  if (!classroomDoc.exists) throwError('Classroom not found', 404);

  const classroomData = classroomDoc.data();

  if (user.collegeId && classroomData?.collegeId !== user.collegeId) {
    throwError('Forbidden: Classroom belongs to a different college', 403);
  }

  if (classroomData?.teacherId !== user.uid && user.role !== Role.ADMIN) {
    throwError('Forbidden: You do not own this classroom', 403);
  }

  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throwError('endTime must be after startTime', 400);
  }
  const windowMinutes = Math.floor((end.getTime() - start.getTime()) / 60000);
  const durationMinutes =
    options.durationMinutes && options.durationMinutes > 0
      ? Math.min(Math.floor(options.durationMinutes), windowMinutes)
      : windowMinutes;

  const docRef = await db.collection(COLLECTIONS.TESTS).add({
    title,
    classroomId,
    teacherId: user.uid,
    collegeId: classroomData?.collegeId || null,
    startTime: admin.firestore.Timestamp.fromDate(start),
    endTime: admin.firestore.Timestamp.fromDate(end),
    durationMinutes,
    instructions: options.instructions ?? '',
    language: options.language ?? 'python',
    questions,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { id: docRef.id };
};

/**
 * What a student may see of a test in a list: metadata only. Questions --
 * and with them every test case -- are never part of a student's list.
 */
const studentSummary = (id: string, test: FirebaseFirestore.DocumentData) => {
  const questions: any[] = Array.isArray(test.questions) ? test.questions : [];
  return {
    id,
    title: test.title,
    classroomId: test.classroomId,
    startTime: toIso(test.startTime),
    endTime: toIso(test.endTime),
    durationMinutes: test.durationMinutes ?? null,
    language: test.language ?? 'python',
    questionCount: questions.length,
    totalPoints: questions.reduce((sum, q) => sum + (Number(q?.points) || 0), 0),
    resultsReleasedAt: toIso(test.resultsReleasedAt),
  };
};

/**
 * A test the requester owns (its teacher) or administers. Another college's
 * test is reported as missing so its existence is not confirmed.
 */
export const loadOwnedTest = async (testId: string, user: UserIdentity) => {
  const ref = db.collection(COLLECTIONS.TESTS).doc(testId);
  const doc = await ref.get();
  if (!doc.exists) throwError('Test not found', 404);
  const data = doc.data()!;
  if (user.collegeId && data.collegeId !== user.collegeId) throwError('Test not found', 404);
  if (data.teacherId !== user.uid && user.role !== Role.ADMIN) {
    throwError('Forbidden: You do not own this test', 403);
  }
  return { ref, data };
};

/** Maximum marks for a test: the sum of its question points (10 per question if unset). */
export const maxMarksOf = (test: FirebaseFirestore.DocumentData) => {
  const questions: any[] = Array.isArray(test.questions) ? test.questions : [];
  const total = questions.reduce((sum, q) => sum + (Number(q?.points) > 0 ? Number(q.points) : 10), 0);
  return total > 0 ? total : 10;
};

/**
 * Releases a test's marks and comments to its students. Idempotent: the first
 * release time is kept. After release, grades are locked.
 */
export const releaseResultsService = async (testId: string, user: UserIdentity) => {
  const { ref, data } = await loadOwnedTest(testId, user);
  if (!data.resultsReleasedAt) {
    await ref.update({ resultsReleasedAt: admin.firestore.FieldValue.serverTimestamp() });
  }
  const fresh = await ref.get();
  return { testId, resultsReleasedAt: toIso(fresh.data()?.resultsReleasedAt) };
};

/** Classroom ids a student is enrolled in (within their college). */
export const enrolledClassroomIds = async (user: UserIdentity) => {
  let query: FirebaseFirestore.Query = db
    .collection(COLLECTIONS.CLASSROOMS)
    .where('students', 'array-contains', user.uid);
  if (user.collegeId) query = query.where('collegeId', '==', user.collegeId);
  const snapshot = await query.get();
  return snapshot.docs.map((doc) => doc.id);
};

export const getTestsService = async (user: UserIdentity) => {
  // SECURITY: a student sees only the tests of classrooms they were added to.
  // (Previously every test in the college was returned, with full questions.)
  if (user.role === Role.STUDENT) {
    const classroomIds = await enrolledClassroomIds(user);
    if (classroomIds.length === 0) return [];
    const results: ReturnType<typeof studentSummary>[] = [];
    // Firestore `in` accepts at most 30 values per query.
    for (let i = 0; i < classroomIds.length; i += 30) {
      const snapshot = await db
        .collection(COLLECTIONS.TESTS)
        .where('classroomId', 'in', classroomIds.slice(i, i + 30))
        .get();
      for (const doc of snapshot.docs) results.push(studentSummary(doc.id, doc.data()));
    }
    // A student's own submission status, so the list can say "Submitted".
    const submissionRefs = results.map((test) =>
      db.collection(COLLECTIONS.SUBMISSIONS).doc(`${test.id}_${user.uid}`)
    );
    const submissions = submissionRefs.length ? await db.getAll(...submissionRefs) : [];
    return results.map((test, index) => ({
      ...test,
      mySubmissionStatus: submissions[index]?.exists ? submissions[index].data()?.status ?? null : null,
    }));
  }

  let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.TESTS);

  if (user.collegeId) {
    query = query.where('collegeId', '==', user.collegeId);
  }

  if (user.role === Role.TEACHER) {
    query = query.where('teacherId', '==', user.uid);
  }

  const snapshot = await query.get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

/**
 * Removes what a student must never receive: the content of hidden test
 * cases (kept as `{ hidden: true, input: null, expected: null }` so the UI can
 * still say a hidden case exists), and any reference solution.
 */
export const sanitizeTestForStudent = (id: string, test: FirebaseFirestore.DocumentData) => {
  const questions: any[] = Array.isArray(test.questions) ? test.questions : [];
  return {
    id,
    title: test.title,
    classroomId: test.classroomId,
    instructions: test.instructions ?? '',
    language: test.language ?? 'python',
    startTime: toIso(test.startTime),
    endTime: toIso(test.endTime),
    durationMinutes: test.durationMinutes ?? null,
    questions: questions.map((question, index) => {
      const { solution: _solution, referenceSolution: _referenceSolution, ...rest } = question ?? {};
      const testCases: any[] = Array.isArray(rest.testCases) ? rest.testCases : [];
      return {
        ...rest,
        id: rest.id ?? `q${index + 1}`,
        testCases: testCases.map((testCase, caseIndex) =>
          testCase?.hidden
            ? { id: testCase.id ?? `c${caseIndex + 1}`, hidden: true, input: null, expected: null }
            : { id: testCase?.id ?? `c${caseIndex + 1}`, hidden: false, input: testCase?.input ?? '', expected: testCase?.expected ?? '' }
        ),
      };
    }),
  };
};

/**
 * The moment this student's time runs out: their latched start plus the
 * allowance, but never later than the test window's end.
 */
export const attemptDeadline = (test: FirebaseFirestore.DocumentData, startedAt: Date) => {
  const windowEnd = toDate(test.endTime);
  const minutes = Number(test.durationMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return windowEnd;
  const personal = new Date(startedAt.getTime() + minutes * 60000);
  return personal < windowEnd ? personal : windowEnd;
};

/**
 * A student entering an exam. Called only after the membership and window
 * guards. The first entry latches `startedAt` in a transaction and it is never
 * rewritten, so reloading the page cannot buy extra time.
 */
export const enterTestService = async (testId: string, user: UserIdentity) => {
  const testDoc = await db.collection(COLLECTIONS.TESTS).doc(testId).get();

  if (!testDoc.exists) throwError('Test not found', 404);
  const testData = testDoc.data()!;

  if (user.collegeId && testData?.collegeId !== user.collegeId) {
    throwError('Forbidden: Test belongs to a different college', 403);
  }

  const attemptRef = db.collection(COLLECTIONS.ATTEMPTS).doc(`${testId}_${user.uid}`);
  const startedAt = await db.runTransaction(async (t) => {
    const attempt = await t.get(attemptRef);
    if (attempt.exists && attempt.data()?.startedAt) return toDate(attempt.data()!.startedAt);
    const now = admin.firestore.Timestamp.now();
    t.set(attemptRef, { testId, studentId: user.uid, startedAt: now });
    return now.toDate();
  });

  const submission = await db.collection(COLLECTIONS.SUBMISSIONS).doc(`${testId}_${user.uid}`).get();
  const submissionData = submission.exists ? submission.data() : null;

  return {
    test: sanitizeTestForStudent(testId, testData),
    serverTime: new Date().toISOString(),
    startedAt: startedAt.toISOString(),
    deadline: attemptDeadline(testData, startedAt).toISOString(),
    submission: submissionData
      ? {
          status: submissionData.status ?? null,
          // A saved draft is handed back so a reload resumes where the student was.
          answers: submissionData.status === 'DRAFT' ? submissionData.answers ?? null : null,
          submittedAt: toIso(submissionData.submittedAt),
        }
      : null,
  };
};
