import admin from '../../db/firebase';
import { Role, UserIdentity } from '../../types/roles';
import { COLLECTIONS } from '../../db/collections';
import { CLASSROOM_ACTIONS, ClassroomAction } from '../../config/constants';
import { db } from '../../db/firestore';

// Helper to throw HTTP-like errors
const throwError = (message: string, status: number) => {
  const error: any = new Error(message);
  error.status = status;
  throw error;
};

export const createClassroomService = async (
  name: string,
  students: string[],
  teacherId: string | undefined,
  collegeId: string | null,
  details: { subject?: string; description?: string; teacherName?: string } = {}
) => {

  if (students.length > 0) {
    for (const uid of students) {
      const userDoc = await db.collection(COLLECTIONS.USERS).doc(uid).get();
      if (!userDoc.exists) throwError(`User ${uid} not found`, 400);
      
      const userData = userDoc.data();
      if (userData?.role !== Role.STUDENT) throwError(`User ${uid} is not a STUDENT`, 400);
      if (collegeId && userData?.collegeId !== collegeId) throwError(`User ${uid} does not belong to this college`, 400);
    }
  }

  const docRef = await db.collection(COLLECTIONS.CLASSROOMS).add({
    name,
    subject: (details.subject ?? '').slice(0, 80),
    description: (details.description ?? '').slice(0, 500),
    teacherName: details.teacherName ?? '',
    teacherId,
    collegeId,
    students,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { id: docRef.id };
};

export const getClassroomsService = async (user: UserIdentity) => {
  let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.CLASSROOMS);

  if (user.collegeId) {
    query = query.where('collegeId', '==', user.collegeId);
  }

  if (user.role === Role.TEACHER) {
    query = query.where('teacherId', '==', user.uid);
  } else if (user.role === Role.STUDENT) {
    query = query.where('students', 'array-contains', user.uid);
  }

  const snapshot = await query.get();
  const createdAt = (value: any) => (value?.toDate ? value.toDate().toISOString() : value ?? null);

  // SECURITY: a student receives only what describes the classroom -- never the
  // roster (classmates' uids) or the invited emails.
  if (user.role === Role.STUDENT) {
    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name,
        subject: data.subject ?? '',
        description: data.description ?? '',
        teacherName: data.teacherName ?? '',
        collegeId: data.collegeId ?? null,
        createdAt: createdAt(data.createdAt),
      };
    });
  }

  // Teachers/admins: the full document plus the counts the dashboard shows.
  const testCounts = new Map<string, number>();
  if (!snapshot.empty) {
    let testsQuery: FirebaseFirestore.Query = db.collection(COLLECTIONS.TESTS);
    if (user.role === Role.TEACHER) testsQuery = testsQuery.where('teacherId', '==', user.uid);
    else if (user.collegeId) testsQuery = testsQuery.where('collegeId', '==', user.collegeId);
    const tests = await testsQuery.select('classroomId').get();
    for (const test of tests.docs) {
      const classroomId = test.data().classroomId;
      testCounts.set(classroomId, (testCounts.get(classroomId) ?? 0) + 1);
    }
  }
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: createdAt(data.createdAt),
      studentCount: Array.isArray(data.students) ? data.students.length : 0,
      invitedCount: Array.isArray(data.invitedEmails) ? data.invitedEmails.length : 0,
      testCount: testCounts.get(doc.id) ?? 0,
    };
  });
};

export const updateClassroomStudentsService = async (
  classroomId: string,
  students: string[],
  action: ClassroomAction,
  requesterUid: string | undefined,
  requesterRole: Role | undefined,
  requesterCollegeId: string | null
) => {
  const docRef = db.collection(COLLECTIONS.CLASSROOMS).doc(classroomId);
  
  const doc = await docRef.get();
  if (!doc.exists) throwError('Classroom not found', 404);
  
  const data = doc.data();

  if (data?.teacherId !== requesterUid && requesterRole !== Role.ADMIN) {
    throwError('Forbidden: You do not own this classroom', 403);
  }

  if (requesterCollegeId && data?.collegeId !== requesterCollegeId) {
    throwError('Forbidden: Cross-college access denied', 403);
  }

  if (action === CLASSROOM_ACTIONS.ADD) {
    for (const uid of students) {
      const userDoc = await db.collection(COLLECTIONS.USERS).doc(uid).get();
      if (!userDoc.exists) throwError(`User ${uid} not found`, 400);
      
      const userData = userDoc.data();
      if (userData?.role !== Role.STUDENT) throwError(`User ${uid} is not a STUDENT`, 400);
      if (data?.collegeId && userData?.collegeId !== data.collegeId) throwError(`User ${uid} does not belong to this college`, 400);
    }
    await docRef.update({
      students: admin.firestore.FieldValue.arrayUnion(...students)
    });
  } else {
    await docRef.update({
      students: admin.firestore.FieldValue.arrayRemove(...students)
    });
  }
};

/* ------------------------------------------------------------------------ */
/*  Enrolment by email                                                       */
/* ------------------------------------------------------------------------ */

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** The classroom document, after the owner/admin and same-college checks. */
const loadOwnedClassroom = async (classroomId: string, requester: UserIdentity) => {
  const docRef = db.collection(COLLECTIONS.CLASSROOMS).doc(classroomId);
  const doc = await docRef.get();
  if (!doc.exists) throwError('Classroom not found', 404);
  const data = doc.data()!;
  if (requester.collegeId && data.collegeId !== requester.collegeId) {
    // Reported as missing, so another college's classroom is not confirmed to exist.
    throwError('Classroom not found', 404);
  }
  if (data.teacherId !== requester.uid && requester.role !== Role.ADMIN) {
    throwError('Forbidden: You do not own this classroom', 403);
  }
  return { docRef, data };
};

/** Finds a user by (lower-cased) email. */
export const findUserByEmail = async (email: string) => {
  const snapshot = await db.collection(COLLECTIONS.USERS).where('email', '==', email).limit(1).get();
  return snapshot.empty ? undefined : snapshot.docs[0];
};

export interface EnrolmentResult {
  /** Registered students added to the roster now. */
  added: string[];
  /** Emails not registered yet: kept as invites, linked on sign-up. */
  invited: string[];
  /** Already on the roster or already invited: nothing changed. */
  alreadyEnrolled: string[];
  /** Emails that cannot be enrolled, with the reason. */
  rejected: { email: string; reason: string }[];
}

/**
 * Teacher enrols students by email.
 *
 * - A registered STUDENT of the classroom's college is added to `students` (by uid).
 * - An email nobody has registered with yet is kept in `invitedEmails`; the
 *   student is moved onto the roster automatically when they register or sign
 *   in with that email (see `linkInvitesForUser`).
 * - A registered account that is not a STUDENT, or belongs to another college,
 *   is rejected rather than silently added.
 */
export const addStudentsByEmailService = async (
  classroomId: string,
  rawEmails: string[],
  requester: UserIdentity
): Promise<EnrolmentResult> => {
  const { docRef, data } = await loadOwnedClassroom(classroomId, requester);

  const emails = [...new Set(rawEmails.map(normalizeEmail).filter(Boolean))];
  if (emails.length === 0) throwError('Enter at least one student email', 400);
  if (emails.length > 200) throwError('Add at most 200 students at a time', 400);

  const roster: string[] = Array.isArray(data.students) ? data.students : [];
  const invites: string[] = Array.isArray(data.invitedEmails) ? data.invitedEmails : [];
  const result: EnrolmentResult = { added: [], invited: [], alreadyEnrolled: [], rejected: [] };
  const uidsToAdd: string[] = [];
  const emailsToInvite: string[] = [];

  for (const email of emails) {
    if (!EMAIL_SHAPE.test(email)) {
      result.rejected.push({ email, reason: 'Not a valid email address' });
      continue;
    }
    const userDoc = await findUserByEmail(email);
    if (!userDoc) {
      if (invites.includes(email)) {
        result.alreadyEnrolled.push(email);
      } else {
        emailsToInvite.push(email);
        result.invited.push(email);
      }
      continue;
    }
    const user = userDoc.data();
    if (user.role !== Role.STUDENT) {
      result.rejected.push({ email, reason: 'This account is not a student' });
      continue;
    }
    if (data.collegeId && user.collegeId !== data.collegeId) {
      result.rejected.push({ email, reason: 'This student belongs to a different college' });
      continue;
    }
    if (roster.includes(userDoc.id)) {
      result.alreadyEnrolled.push(email);
    } else {
      uidsToAdd.push(userDoc.id);
      result.added.push(email);
    }
  }

  const update: Record<string, unknown> = {};
  if (uidsToAdd.length) update.students = admin.firestore.FieldValue.arrayUnion(...uidsToAdd);
  if (emailsToInvite.length) update.invitedEmails = admin.firestore.FieldValue.arrayUnion(...emailsToInvite);
  if (Object.keys(update).length) await docRef.update(update);

  return result;
};

/** Teacher removes one student (registered or invited) by email. Past submissions are kept. */
export const removeStudentByEmailService = async (
  classroomId: string,
  rawEmail: string,
  requester: UserIdentity
) => {
  const { docRef, data } = await loadOwnedClassroom(classroomId, requester);
  const email = normalizeEmail(rawEmail);
  const userDoc = await findUserByEmail(email);
  const onRoster = Boolean(userDoc && (data.students ?? []).includes(userDoc.id));
  const invited = (data.invitedEmails ?? []).includes(email);
  if (!onRoster && !invited) throwError('That student is not in this classroom', 404);

  const update: Record<string, unknown> = {};
  if (onRoster) update.students = admin.firestore.FieldValue.arrayRemove(userDoc!.id);
  if (invited) update.invitedEmails = admin.firestore.FieldValue.arrayRemove(email);
  await docRef.update(update);
};

/**
 * Moves every pending invite for this email onto the roster. Called after a
 * student registers and on each sign-in, so an invite is honoured whichever
 * happens first. Only classrooms of the student's own college are linked.
 */
export const linkInvitesForUser = async (uid: string, rawEmail: string, collegeId: string | null) => {
  const email = normalizeEmail(rawEmail);
  const snapshot = await db
    .collection(COLLECTIONS.CLASSROOMS)
    .where('invitedEmails', 'array-contains', email)
    .get();
  const batch = db.batch();
  let changed = 0;
  for (const doc of snapshot.docs) {
    const classroom = doc.data();
    if (classroom.collegeId && classroom.collegeId !== collegeId) continue;
    batch.update(doc.ref, {
      students: admin.firestore.FieldValue.arrayUnion(uid),
      invitedEmails: admin.firestore.FieldValue.arrayRemove(email),
    });
    changed++;
  }
  if (changed) await batch.commit();
  return changed;
};

/* ------------------------------------------------------------------------ */
/*  Classroom detail (teacher)                                               */
/* ------------------------------------------------------------------------ */

export const toIso = (value: any): string | null => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/**
 * The teacher's view of one classroom: details, roster (registered and
 * invited), and its tests as summaries. Teacher-owner or admin only -- the
 * roster carries names and emails, so a student must never receive it.
 */
export const getClassroomDetailService = async (classroomId: string, requester: UserIdentity) => {
  const { data } = await loadOwnedClassroom(classroomId, requester);

  const uids: string[] = Array.isArray(data.students) ? data.students : [];
  const userDocs = uids.length
    ? await db.getAll(...uids.map((uid) => db.collection(COLLECTIONS.USERS).doc(uid)))
    : [];
  const students = userDocs
    .filter((doc) => doc.exists)
    .map((doc) => {
      const user = doc.data()!;
      return {
        uid: doc.id,
        email: user.email ?? '',
        displayName: user.displayName ?? '',
        pending: false,
      };
    });
  const invited = ((data.invitedEmails ?? []) as string[]).map((email) => ({
    uid: '',
    email,
    displayName: '',
    pending: true,
  }));

  const testsSnapshot = await db.collection(COLLECTIONS.TESTS).where('classroomId', '==', classroomId).get();
  const tests = testsSnapshot.docs.map((doc) => {
    const test = doc.data();
    const questions: any[] = Array.isArray(test.questions) ? test.questions : [];
    return {
      id: doc.id,
      title: test.title,
      startTime: toIso(test.startTime),
      endTime: toIso(test.endTime),
      durationMinutes: test.durationMinutes ?? null,
      questionCount: questions.length,
      resultsReleasedAt: toIso(test.resultsReleasedAt),
    };
  });

  return {
    id: classroomId,
    name: data.name,
    subject: data.subject ?? '',
    description: data.description ?? '',
    collegeId: data.collegeId ?? null,
    teacherId: data.teacherId,
    createdAt: toIso(data.createdAt),
    students: [...students, ...invited],
    tests,
  };
};
