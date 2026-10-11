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

export const createTestService = async (
  title: string,
  classroomId: string,
  startTime: string,
  endTime: string,
  questions: any[],
  user: UserIdentity
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

  const docRef = await db.collection(COLLECTIONS.TESTS).add({
    title,
    classroomId,
    teacherId: user.uid,
    collegeId: classroomData?.collegeId || null,
    startTime: admin.firestore.Timestamp.fromDate(new Date(startTime)),
    endTime: admin.firestore.Timestamp.fromDate(new Date(endTime)),
    questions,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { id: docRef.id };
};

export const getTestsService = async (user: UserIdentity) => {
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

export const enterTestService = async (testId: string, requesterCollegeId: string | null | undefined) => {
  const testDoc = await db.collection(COLLECTIONS.TESTS).doc(testId).get();
  
  if (!testDoc.exists) throwError('Test not found', 404);
  const testData = testDoc.data();
  
  if (requesterCollegeId && testData?.collegeId !== requesterCollegeId) {
    throwError('Forbidden: Test belongs to a different college', 403);
  }
  
  return { id: testId, ...testData };
};
