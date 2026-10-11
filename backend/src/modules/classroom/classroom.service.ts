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
  collegeId: string | null
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
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
