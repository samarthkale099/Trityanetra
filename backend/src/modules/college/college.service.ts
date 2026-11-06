import { COLLECTIONS } from '../../db/collections';
import { db } from '../../db/firestore';
import * as admin from 'firebase-admin';
import { parseCollegeEmailDomain, domainsOverlap, domainCoveredBy, emailDomainOf } from './emailDomain.util';

const httpError = (status: number, message: string) => {
  const error: any = new Error(message);
  error.status = status;
  return error;
};

// Validates a domain and makes sure no other college's domain equals, contains or is contained by it.
const validateUniqueDomain = async (input: unknown, selfCollegeId?: string): Promise<string> => {
  const parsed = parseCollegeEmailDomain(input);
  if ('error' in parsed) throw httpError(400, parsed.error);

  const all = await db.collection(COLLECTIONS.COLLEGES).get();
  for (const doc of all.docs) {
    const other = doc.data().emailDomain;
    if (doc.id !== selfCollegeId && typeof other === 'string' && domainsOverlap(parsed.domain, other)) {
      throw httpError(409, 'Another college already uses an overlapping emailDomain');
    }
  }
  return parsed.domain;
};

/** The college whose emailDomain covers this email, or null. Domains never overlap, so at most one matches. */
export const findCollegeByEmail = async (email: unknown): Promise<{ id: string } | null> => {
  const domain = emailDomainOf(email);
  if (!domain) return null;
  const all = await db.collection(COLLECTIONS.COLLEGES).get();
  for (const doc of all.docs) {
    const d = doc.data().emailDomain;
    if (typeof d === 'string' && domainCoveredBy(domain, d)) return { id: doc.id };
  }
  return null;
};

export const createCollegeService = async (
  requesterCollegeId: string | null | undefined,
  name: string,
  code: string,
  emailDomain?: unknown
) => {
  // Only root admins (collegeId is null/undefined) can create colleges
  if (requesterCollegeId) {
    const error: any = new Error('Forbidden: Only root admins can create colleges');
    error.status = 403;
    throw error;
  }

  const data: Record<string, unknown> = { name, code };
  if (emailDomain !== undefined && emailDomain !== null && emailDomain !== '') {
    data.emailDomain = await validateUniqueDomain(emailDomain);
  }

  const docRef = await db.collection(COLLECTIONS.COLLEGES).add(data);
  return { id: docRef.id, ...data };
};

/** Sets (or, with null, clears) a college's emailDomain. Root admins only. */
export const setCollegeEmailDomainService = async (
  requesterCollegeId: string | null | undefined,
  collegeId: string,
  emailDomain: unknown
) => {
  if (requesterCollegeId) throw httpError(403, 'Forbidden: Only root admins can change a college email domain');

  const ref = db.collection(COLLECTIONS.COLLEGES).doc(collegeId);
  if (!(await ref.get()).exists) throw httpError(404, 'College not found');

  if (emailDomain === null) {
    await ref.update({ emailDomain: admin.firestore.FieldValue.delete() });
    return { id: collegeId, emailDomain: null };
  }
  const domain = await validateUniqueDomain(emailDomain, collegeId);
  await ref.update({ emailDomain: domain });
  return { id: collegeId, emailDomain: domain };
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
