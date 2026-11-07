import admin from '../../db/firebase';
import { COLLECTIONS } from '../../db/collections';
import { db } from '../../db/firestore';
import { Role, UserIdentity } from '../../types/roles';
import { attemptDeadline, loadOwnedTest, maxMarksOf } from '../test/test.service';

const throwError = (message: string, status: number): never => {
  const error: any = new Error(message);
  error.status = status;
  throw error;
};

const toIso = (value: any): string | null => {
  if (!value) return null;
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** SUBMITTED on or before the window's end, LATE after it, NOT_SUBMITTED otherwise. */
const submissionState = (submission: FirebaseFirestore.DocumentData | undefined, test: FirebaseFirestore.DocumentData) => {
  if (!submission || !isSubmissionLocked(submission.status)) return 'NOT_SUBMITTED' as const;
  const submittedAt = submission.submittedAt?.toDate ? submission.submittedAt.toDate() : null;
  const windowEnd = test.endTime?.toDate ? test.endTime.toDate() : new Date(test.endTime);
  return submittedAt && submittedAt > windowEnd ? ('LATE' as const) : ('SUBMITTED' as const);
};

/** Monitor flag counts per student for one test, e.g. { uid: { TAB_SWITCH: 2 } }. */
const flagCountsFor = async (testId: string) => {
  const snapshot = await db.collection(COLLECTIONS.MONITOR_FLAGS).where('testId', '==', testId).get();
  const counts: Record<string, Record<string, number>> = {};
  for (const doc of snapshot.docs) {
    const { studentId, flagType } = doc.data();
    counts[studentId] ??= {};
    counts[studentId][flagType] = (counts[studentId][flagType] ?? 0) + 1;
  }
  return counts;
};

/* ------------------------------------------------------------------------ */
/*  Teacher review                                                           */
/* ------------------------------------------------------------------------ */

/**
 * Every student on the test's classroom roster, with their submission state,
 * saved marks and integrity-flag counts. Teacher-owner or admin only.
 */
export const listSubmissionsForTestService = async (testId: string, user: UserIdentity) => {
  const { data: test } = await loadOwnedTest(testId, user);
  const classroom = await db.collection(COLLECTIONS.CLASSROOMS).doc(test.classroomId).get();
  const roster: string[] = classroom.exists && Array.isArray(classroom.data()?.students) ? classroom.data()!.students : [];

  const [users, submissions, flags] = await Promise.all([
    roster.length ? db.getAll(...roster.map((uid) => db.collection(COLLECTIONS.USERS).doc(uid))) : Promise.resolve([]),
    roster.length
      ? db.getAll(...roster.map((uid) => db.collection(COLLECTIONS.SUBMISSIONS).doc(`${testId}_${uid}`)))
      : Promise.resolve([]),
    flagCountsFor(testId),
  ]);

  const maxMarks = maxMarksOf(test);
  return {
    testId,
    testTitle: test.title,
    maxMarks,
    resultsReleasedAt: toIso(test.resultsReleasedAt),
    submissions: roster.map((uid, index) => {
      const profile = users[index]?.exists ? users[index].data()! : {};
      const submission = submissions[index]?.exists ? submissions[index].data()! : undefined;
      return {
        studentId: uid,
        studentName: profile.displayName ?? profile.email ?? uid,
        studentEmail: profile.email ?? '',
        state: submissionState(submission, test),
        submittedAt: toIso(submission?.submittedAt),
        marks: typeof submission?.marks === 'number' ? submission.marks : null,
        maxMarks,
        flags: flags[uid] ?? {},
      };
    }),
  };
};

/** One student's submission for grading: their code, marks, comment and flags. */
export const getSubmissionForReviewService = async (testId: string, studentId: string, user: UserIdentity) => {
  const { data: test } = await loadOwnedTest(testId, user);
  const classroom = await db.collection(COLLECTIONS.CLASSROOMS).doc(test.classroomId).get();
  const roster: string[] = classroom.exists ? classroom.data()?.students ?? [] : [];
  const submissionDoc = await db.collection(COLLECTIONS.SUBMISSIONS).doc(`${testId}_${studentId}`).get();
  // A removed student keeps their submission reviewable; anyone else is 404.
  if (!roster.includes(studentId) && !submissionDoc.exists) throwError('Submission not found', 404);

  const profileDoc = await db.collection(COLLECTIONS.USERS).doc(studentId).get();
  const profile = profileDoc.exists ? profileDoc.data()! : {};
  const submission = submissionDoc.exists ? submissionDoc.data()! : undefined;
  const flags = (await flagCountsFor(testId))[studentId] ?? {};

  return {
    testId,
    testTitle: test.title,
    studentId,
    studentName: profile.displayName ?? profile.email ?? studentId,
    studentEmail: profile.email ?? '',
    state: submissionState(submission, test),
    submittedAt: toIso(submission?.submittedAt),
    answers: submission && isSubmissionLocked(submission.status) ? submission.answers ?? null : null,
    marks: typeof submission?.marks === 'number' ? submission.marks : null,
    maxMarks: maxMarksOf(test),
    comment: submission?.comment ?? '',
    flags,
    resultsReleasedAt: toIso(test.resultsReleasedAt),
  };
};

/**
 * Saves a teacher's marks and comment. Refused once results are released (the
 * students have seen them), and for a student who did not submit.
 */
export const saveReviewService = async (
  testId: string,
  studentId: string,
  input: { marks: unknown; comment: unknown },
  user: UserIdentity
) => {
  const { data: test } = await loadOwnedTest(testId, user);
  if (test.resultsReleasedAt) throwError('Results are released, so grades are locked', 409);

  const maxMarks = maxMarksOf(test);
  let marks: number | null = null;
  if (input.marks !== null && input.marks !== undefined && input.marks !== '') {
    const parsed = Number(input.marks);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > maxMarks) {
      throwError(`Enter a whole number of marks between 0 and ${maxMarks}`, 400);
    }
    marks = parsed;
  }
  const comment = typeof input.comment === 'string' ? input.comment.slice(0, 2000) : '';

  const ref = db.collection(COLLECTIONS.SUBMISSIONS).doc(`${testId}_${studentId}`);
  await db.runTransaction(async (t) => {
    const doc = await t.get(ref);
    if (!doc.exists || !isSubmissionLocked(doc.data()?.status)) {
      throwError('This student has not submitted this test', 409);
    }
    t.update(ref, {
      marks,
      comment,
      reviewedBy: user.uid,
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return getSubmissionForReviewService(testId, studentId, user);
};

/* ------------------------------------------------------------------------ */
/*  Student result                                                           */
/* ------------------------------------------------------------------------ */

/**
 * A student's own result. Marks and the teacher's comment are withheld until
 * the teacher releases results. A student with no submission gets 404, so a
 * classmate's submission is never confirmed.
 */
export const getStudentResultService = async (testId: string, user: UserIdentity) => {
  if (user.role !== Role.STUDENT) throwError('Results are viewed through the review screens', 403);
  const testDoc = await db.collection(COLLECTIONS.TESTS).doc(testId).get();
  if (!testDoc.exists) throwError('Test not found', 404);
  const test = testDoc.data()!;
  if (user.collegeId && test.collegeId !== user.collegeId) throwError('Test not found', 404);

  const submissionDoc = await db.collection(COLLECTIONS.SUBMISSIONS).doc(`${testId}_${user.uid}`).get();
  const submission = submissionDoc.exists ? submissionDoc.data()! : undefined;
  if (!submission || !isSubmissionLocked(submission.status)) throwError('We could not find a result for this test', 404);

  const released = Boolean(test.resultsReleasedAt);
  return {
    testId,
    testTitle: test.title,
    state: submissionState(submission, test),
    submittedAt: toIso(submission!.submittedAt),
    answers: submission!.answers ?? null,
    marksReleased: released,
    resultsReleasedAt: released ? toIso(test.resultsReleasedAt) : null,
    marks: released && typeof submission!.marks === 'number' ? submission!.marks : null,
    maxMarks: maxMarksOf(test),
    comment: released ? submission!.comment ?? '' : '',
  };
};

// A submission in one of these states is final: nothing may write to it or downgrade it.
export const LOCKED_SUBMISSION_STATUSES = ['SUBMITTED', 'FINALIZED'];

export const isSubmissionLocked = (status: unknown) =>
  typeof status === 'string' && LOCKED_SUBMISSION_STATUSES.includes(status);

/** Network slack after a personal deadline, so an on-time click is not refused in transit. */
export const DEADLINE_GRACE_MS = 30_000;

/**
 * Refuses a write after the student's personal time allowance has run out.
 * The allowance starts when they first entered the exam (`attempts`), so it is
 * enforced here on the server -- a student cannot extend it by changing their
 * device clock or reloading. A student who never entered has no attempt; the
 * test-window guard still bounds them.
 */
const assertWithinAllowance = async (
  t: FirebaseFirestore.Transaction,
  testId: string,
  userId: string
) => {
  const attempt = await t.get(db.collection(COLLECTIONS.ATTEMPTS).doc(`${testId}_${userId}`));
  if (!attempt.exists || !attempt.data()?.startedAt) return;
  const test = await t.get(db.collection(COLLECTIONS.TESTS).doc(testId));
  if (!test.exists) return;
  const deadline = attemptDeadline(test.data()!, attempt.data()!.startedAt.toDate());
  if (Date.now() > deadline.getTime() + DEADLINE_GRACE_MS) {
    const error: any = new Error('Forbidden: Your time for this test is over');
    error.status = 403;
    throw error;
  }
};

export const saveAnswerService = async (testId: string, userId: string, answers: any) => {
  const submissionId = `${testId}_${userId}`;
  const submissionRef = db.collection(COLLECTIONS.SUBMISSIONS).doc(submissionId);

  // Read-check-write in one transaction so a save racing a submit can never flip
  // a SUBMITTED/FINALIZED record back to DRAFT (the route guard alone is not atomic).
  await db.runTransaction(async (t) => {
    const doc = await t.get(submissionRef);
    if (doc.exists && isSubmissionLocked(doc.data()?.status)) {
      const error: any = new Error('Forbidden: Submission is locked and cannot be modified');
      error.status = 403;
      throw error;
    }
    await assertWithinAllowance(t, testId, userId);

    t.set(submissionRef, {
      testId,
      studentId: userId,
      answers,
      status: 'DRAFT',
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
};

export const submitExamService = async (testId: string, userId: string, answers: any) => {
  const submissionId = `${testId}_${userId}`; // Enforces 1 submission per test+student
  const submissionRef = db.collection(COLLECTIONS.SUBMISSIONS).doc(submissionId);
  
  // CRITICAL: The entire transaction is kept perfectly atomic here.
  await db.runTransaction(async (t) => {
    const doc = await t.get(submissionRef);
    if (doc.exists && isSubmissionLocked(doc.data()?.status)) {
      throw new Error('ALREADY_SUBMITTED');
    }
    await assertWithinAllowance(t, testId, userId);

    t.set(submissionRef, {
      testId,
      studentId: userId,
      answers: answers || (doc.exists ? doc.data()?.answers : {}),
      status: 'SUBMITTED',
      submittedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
};
