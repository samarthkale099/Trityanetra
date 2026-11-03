import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import request from 'supertest';
import { app } from '../../app';
import { COLLECTIONS } from '../../db/collections';
import { Role } from '../../types/roles';
import { devOutbox } from '../../lib/mailer';
import { hashToken } from '../../modules/auth/emailVerification.util';

const db = admin.firestore();

const register = (email: string, extra: object = {}) =>
  request(app).post('/api/auth/register').send({ email, password: 'password123', role: Role.STUDENT, collegeId: 'college-1', ...extra });
const login = (email: string, password = 'password123') =>
  request(app).post('/api/auth/login').send({ email, password });

// The raw token is only ever emailed; tests read it from the dev outbox, like a real inbox would.
const tokenFromLastEmail = (): string => {
  const mail = devOutbox[devOutbox.length - 1];
  const m = mail?.text.match(/token=([a-f0-9]{64})/);
  if (!m) throw new Error('no verification token in the last email');
  return m[1];
};
const userByEmail = async (email: string) =>
  (await db.collection(COLLECTIONS.USERS).where('email', '==', email).limit(1).get()).docs[0]?.data();

describe('Email verification', () => {
  beforeEach(async () => {
    devOutbox.length = 0;
    await db.collection(COLLECTIONS.COLLEGES).doc('college-1').set({ name: 'C1', code: 'C1' });
  });

  it('registration creates an unverified account, emails a link, and blocks login until verified', async () => {
    const reg = await register('stu@x.com');
    expect(reg.status).toBe(201);
    expect(reg.body.message).toMatch(/verif/i);
    expect((await userByEmail('stu@x.com'))?.emailVerified).toBe(false);
    expect(devOutbox).toHaveLength(1);
    expect(devOutbox[0].to).toBe('stu@x.com');

    const blocked = await login('stu@x.com');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('the emailed token verifies the account, and then login works and issues a JWT', async () => {
    await register('stu@x.com');
    const token = tokenFromLastEmail();

    const verify = await request(app).post('/api/auth/verify-email').send({ token });
    expect(verify.status).toBe(200);
    expect((await userByEmail('stu@x.com'))?.emailVerified).toBe(true);
    // The token is cleared on use.
    expect((await userByEmail('stu@x.com'))?.emailVerification).toBeUndefined();

    const ok = await login('stu@x.com');
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeDefined();
  });

  it('accepts the token via a GET link too', async () => {
    await register('stu@x.com');
    const token = tokenFromLastEmail();
    const res = await request(app).get(`/api/auth/verify-email?token=${token}`);
    expect(res.status).toBe(200);
    expect((await userByEmail('stu@x.com'))?.emailVerified).toBe(true);
  });

  it('a token is single use: verifying twice fails the second time', async () => {
    await register('stu@x.com');
    const token = tokenFromLastEmail();
    expect((await request(app).post('/api/auth/verify-email').send({ token })).status).toBe(200);
    const again = await request(app).post('/api/auth/verify-email').send({ token });
    expect(again.status).toBe(400);
  });

  it('rejects an expired token (400) and does not verify', async () => {
    await register('stu@x.com');
    const token = tokenFromLastEmail();
    // Backdate the stored token's expiry.
    const doc = (await db.collection(COLLECTIONS.USERS).where('email', '==', 'stu@x.com').limit(1).get()).docs[0];
    await doc.ref.update({ emailVerification: { tokenHash: hashToken(token), expiresAt: new Date(Date.now() - 1000) } });
    const res = await request(app).post('/api/auth/verify-email').send({ token });
    expect(res.status).toBe(400);
    expect((await userByEmail('stu@x.com'))?.emailVerified).toBe(false);
  });

  it.each(['', 'not-a-token', 'z'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)])(
    'rejects a malformed or unknown token %j (400)',
    async (token) => {
      await register('stu@x.com');
      const res = await request(app).post('/api/auth/verify-email').send({ token });
      expect(res.status).toBe(400);
    }
  );

  describe('resend', () => {
    it('sends a fresh, working link for an unverified account', async () => {
      await register('stu@x.com');
      devOutbox.length = 0;
      const res = await request(app).post('/api/auth/resend-verification').send({ email: 'stu@x.com' });
      expect(res.status).toBe(200);
      expect(devOutbox).toHaveLength(1);

      const token = tokenFromLastEmail();
      expect((await request(app).post('/api/auth/verify-email').send({ token })).status).toBe(200);
    });

    it('is a generic 200 that sends nothing for an unknown email (no account enumeration)', async () => {
      devOutbox.length = 0;
      const res = await request(app).post('/api/auth/resend-verification').send({ email: 'ghost@x.com' });
      expect(res.status).toBe(200);
      expect(devOutbox).toHaveLength(0);
    });

    it('does not resend to an already-verified account', async () => {
      await register('stu@x.com');
      const token = tokenFromLastEmail();
      await request(app).post('/api/auth/verify-email').send({ token });
      devOutbox.length = 0;
      await request(app).post('/api/auth/resend-verification').send({ email: 'stu@x.com' });
      expect(devOutbox).toHaveLength(0);
    });
  });

  it('grandfathers legacy accounts that have no emailVerified field (login still works)', async () => {
    // Simulate a user created before verification existed (bootstrap admin, older signups).
    const { hashPassword } = await import('../../modules/auth/passwordHash.util');
    await db.collection(COLLECTIONS.USERS).doc('legacy-1').set({
      email: 'legacy@x.com',
      passwordHash: await hashPassword('password123'),
      role: Role.STUDENT,
      collegeId: 'college-1',
    });
    const res = await login('legacy@x.com');
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });
});
