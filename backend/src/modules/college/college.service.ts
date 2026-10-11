import { COLLECTIONS } from '../../db/collections';
import { db } from '../../db/firestore';

export const createCollegeService = async (
  requesterCollegeId: string | null | undefined,
  name: string,
  code: string
) => {
  // Only root admins (collegeId is null/undefined) can create colleges
  if (requesterCollegeId) {
    const error: any = new Error('Forbidden: Only root admins can create colleges');
    error.status = 403;
    throw error;
  }

  const docRef = await db.collection(COLLECTIONS.COLLEGES).add({ name, code });
  return { id: docRef.id, name, code };
};

export const getCollegesService = async (requesterCollegeId: string | null | undefined) => {
  // If Admin has a collegeId, they can only get their own college
  if (requesterCollegeId) {
    const docRef = await db.collection(COLLECTIONS.COLLEGES).doc(requesterCollegeId).get();
    return docRef.exists ? [{ id: docRef.id, ...docRef.data() }] : [];
  }

  const snapshot = await db.collection(COLLECTIONS.COLLEGES).get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};
