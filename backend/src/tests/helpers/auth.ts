import jwt from 'jsonwebtoken';
import * as admin from 'firebase-admin';
import { env } from '../../config/env';
import { COLLECTIONS } from '../../db/collections';

export const generateToken = (payload: any) => {
  return jwt.sign(payload, env.JWT_SECRET);
};

// Marks a registered user's email as verified, so register-then-login flows can proceed in tests that
// are not themselves about verification.
export const markEmailVerified = async (email: string) => {
  const db = admin.firestore();
  const snap = await db.collection(COLLECTIONS.USERS).where('email', '==', email).limit(1).get();
  if (!snap.empty) await snap.docs[0].ref.update({ emailVerified: true });
};
