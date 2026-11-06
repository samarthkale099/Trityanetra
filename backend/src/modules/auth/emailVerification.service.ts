import { db } from '../../db/firestore';
import { COLLECTIONS } from '../../db/collections';
import { env } from '../../config/env';
import { sendMail } from '../../lib/mailer';
import { generateVerificationToken, hashToken } from './emailVerification.util';
import * as admin from 'firebase-admin';

const httpError = (status: number, message: string) => {
  const error: any = new Error(message);
  error.status = status;
  return error;
};

const verificationLink = (raw: string) =>
  `${env.APP_BASE_URL.replace(/\/+$/, '')}/verify-email?token=${raw}`;

/** Attaches a fresh verification token to a user doc and emails the link. */
export const issueVerification = async (userId: string, email: string): Promise<void> => {
  const { raw, tokenHash, expiresAt } = generateVerificationToken();
  await db.collection(COLLECTIONS.USERS).doc(userId).update({
    emailVerification: { tokenHash, expiresAt },
  });
  await sendMail({
    to: email,
    subject: 'Verify your Trityanetra account',
    text: `Welcome to Trityanetra.\n\nVerify your email by opening this link (valid for 24 hours):\n${verificationLink(raw)}\n\nIf you did not create an account, ignore this message.`,
  });
};

/** Verifies the raw token: marks the user verified and clears the token (single use). */
export const verifyEmailToken = async (raw: unknown): Promise<void> => {
  if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/.test(raw)) {
    throw httpError(400, 'Invalid or expired verification link');
  }
  const snap = await db
    .collection(COLLECTIONS.USERS)
    .where('emailVerification.tokenHash', '==', hashToken(raw))
    .limit(1)
    .get();

  if (snap.empty) throw httpError(400, 'Invalid or expired verification link');

  const doc = snap.docs[0];
  const exp = doc.data().emailVerification?.expiresAt;
  const expiresAt = exp?.toDate ? exp.toDate() : new Date(exp);
  if (!expiresAt || expiresAt.getTime() < Date.now()) {
    throw httpError(400, 'Invalid or expired verification link');
  }

  await doc.ref.update({
    emailVerified: true,
    emailVerification: admin.firestore.FieldValue.delete(),
  });
};

/**
 * Resends a verification email if the address belongs to an unverified account. Always resolves without
 * revealing whether the email exists or its state, so this cannot be used to enumerate accounts.
 */
export const resendVerification = async (email: unknown): Promise<void> => {
  if (typeof email !== 'string' || !email) return;
  const snap = await db.collection(COLLECTIONS.USERS).where('email', '==', email).limit(1).get();
  if (snap.empty) return;
  const doc = snap.docs[0];
  if (doc.data().emailVerified === true) return; // already verified, or legacy accounts are left alone
  if (doc.data().emailVerified !== false) return; // only accounts created with the field get re-sent
  await issueVerification(doc.id, email);
};
