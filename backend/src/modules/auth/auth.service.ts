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

export const assignUserRoleService = async (
  targetUid: string,
  role: Role,
  collegeId: string | null,
  requester: UserIdentity
) => {
  // A root admin has no collegeId. A college-scoped admin is limited to their own college.
  const isRootAdmin = requester.role === Role.ADMIN && !requester.collegeId;

  if (!isRootAdmin) {
    // Only root admins may grant ADMIN; a scoped admin may only assign STUDENT or TEACHER...
    if (role === Role.ADMIN) throwError('Forbidden: Only root admins can grant ADMIN', 403);
    // ...and only within their own college (cannot move users into another college).
    if (collegeId !== requester.collegeId) {
      throwError('Forbidden: You can only assign users within your own college', 403);
    }
  }

  const userRef = db.collection(COLLECTIONS.USERS).doc(targetUid);
  const userDoc = await userRef.get();
  if (!userDoc.exists) {
    throwError('User not found', 404);
  }

  if (!isRootAdmin) {
    const target = userDoc.data();
    // Users outside the requester's college look exactly like users that do not exist.
    if (target?.collegeId !== requester.collegeId) throwError('User not found', 404);
    // A scoped admin cannot modify (e.g. demote) ADMIN accounts.
    if (target?.role === Role.ADMIN) throwError('Forbidden: Only root admins can modify ADMIN accounts', 403);
  }

  if (collegeId) {
    const collegeDoc = await db.collection(COLLECTIONS.COLLEGES).doc(collegeId).get();
    if (!collegeDoc.exists) throwError('Unknown collegeId', 400);
  }

  // Set Firestore Document (for UI and consistency)
  await userRef.set({
    role,
    collegeId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
};
