import { db } from '../../db/firestore';
import { COLLECTIONS } from '../../db/collections';
import { Role, UserIdentity } from '../../types/roles';
import { normalizeEmail } from '../classroom/classroom.service';

/** What an admin may see about a user. Never the password hash or verification token. */
export interface UserSummary {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  collegeId: string | null;
  emailVerified: boolean;
  createdAt: string | null;
}

export interface UserQuery {
  /** Exact email (case-insensitive). */
  email?: string;
  role?: Role;
  /** Root admins only; a college admin is always limited to their own college. */
  collegeId?: string;
}

/** Results are capped: this is a lookup tool, not an export. */
export const USER_LIST_LIMIT = 100;

const toIso = (value: any): string | null => {
  if (!value) return null;
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const toSummary = (id: string, data: FirebaseFirestore.DocumentData): UserSummary => ({
  uid: id,
  email: String(data.email ?? ''),
  displayName: String(data.displayName ?? String(data.email ?? '').split('@')[0]),
  role: data.role as Role,
  collegeId: data.collegeId ?? null,
  // Accounts created before email verification existed have no flag and count as verified.
  emailVerified: data.emailVerified !== false,
  createdAt: toIso(data.createdAt),
});

/**
 * Finds users for the admin screens. A root admin (no collegeId) sees every
 * college; a college admin only ever sees their own college, and a user from
 * another college is reported exactly like one that does not exist.
 */
export const listUsersService = async (requester: UserIdentity, query: UserQuery): Promise<UserSummary[]> => {
  const isRootAdmin = requester.role === Role.ADMIN && !requester.collegeId;
  const scopeCollegeId = isRootAdmin ? query.collegeId : requester.collegeId;
  const users = db.collection(COLLECTIONS.USERS);

  let docs: FirebaseFirestore.QueryDocumentSnapshot[];
  if (query.email) {
    const email = normalizeEmail(query.email);
    const snap = await users.where('email', '==', email).limit(5).get();
    // Accounts created before emails were lower-cased.
    const legacy = snap.empty && email !== query.email.trim()
      ? await users.where('email', '==', query.email.trim()).limit(5).get()
      : null;
    docs = snap.empty && legacy ? legacy.docs : snap.docs;
  } else {
    // Equality filters only, so no composite index is needed; sorted below.
    let q: FirebaseFirestore.Query = users;
    if (scopeCollegeId) q = q.where('collegeId', '==', scopeCollegeId);
    if (query.role) q = q.where('role', '==', query.role);
    docs = (await q.limit(USER_LIST_LIMIT).get()).docs;
  }

  return docs
    .map((doc) => toSummary(doc.id, doc.data()))
    .filter((user) => !scopeCollegeId || user.collegeId === scopeCollegeId)
    .filter((user) => !query.role || user.role === query.role)
    .sort((a, b) => a.email.localeCompare(b.email));
};
