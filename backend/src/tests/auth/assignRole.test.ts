import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import request from 'supertest';
import { app } from '../../app';
import { COLLECTIONS } from '../../db/collections';
import { Role } from '../../types/roles';
import { randomUUID } from 'crypto';
import { generateToken, markEmailVerified } from '../helpers/auth';
import jwt from 'jsonwebtoken';

describe('Auth Module - Assign Role', () => {
  const db = admin.firestore();

  beforeEach(async () => {
    vi.restoreAllMocks();
  });

  describe('POST /api/auth/assign-role', () => {
    it('should reject a non-ADMIN identity (STUDENT or TEACHER) with 403', async () => {
      const studentUid = 'student-requester';
      
      await db.collection(COLLECTIONS.USERS).doc(studentUid).set({ role: Role.STUDENT, collegeId: 'c1' });

      const token = generateToken({ uid: studentUid, email: 'student@college.com', role: Role.STUDENT, collegeId: 'c1' });

      const res = await request(app)
        .post('/api/auth/assign-role')
        .set('Authorization', `Bearer ${token}`)
        .send({ targetUid: 'some-user', role: Role.TEACHER, collegeId: 'c1' });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Forbidden/i);
    });

    it('should reject an ADMIN assigning an invalid role string with 400', async () => {
      const adminUid = 'admin-requester-1';
      
      await db.collection(COLLECTIONS.USERS).doc(adminUid).set({ role: Role.ADMIN, collegeId: null });

      const token = generateToken({ uid: adminUid, email: 'admin1@college.com', role: Role.ADMIN, collegeId: null });

      const res = await request(app)
        .post('/api/auth/assign-role')
        .set('Authorization', `Bearer ${token}`)
        .send({ targetUid: 'some-user', role: 'INVALID_ROLE', collegeId: 'c1' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid role/i);
    });

    it('should reject an ADMIN assigning STUDENT or TEACHER WITHOUT collegeId with 400', async () => {
      const adminUid = 'admin-requester-2';
      
      await db.collection(COLLECTIONS.USERS).doc(adminUid).set({ role: Role.ADMIN, collegeId: null });

      const token = generateToken({ uid: adminUid, email: 'admin2@college.com', role: Role.ADMIN, collegeId: null });

      const res = await request(app)
        .post('/api/auth/assign-role')
        .set('Authorization', `Bearer ${token}`)
        .send({ targetUid: 'some-user', role: Role.TEACHER }); // missing collegeId

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/collegeId is required/i);
    });

    it('should reject assigning a role to a targetUid that does NOT exist in Firestore with 404', async () => {
      const adminUid = 'admin-requester-3';
      
      await db.collection(COLLECTIONS.USERS).doc(adminUid).set({ role: Role.ADMIN, collegeId: null });

      const token = generateToken({ uid: adminUid, email: 'admin3@college.com', role: Role.ADMIN, collegeId: null });

      const res = await request(app)
        .post('/api/auth/assign-role')
        .set('Authorization', `Bearer ${token}`)
        .send({ targetUid: 'non-existent-user', role: Role.TEACHER, collegeId: 'c1' });

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/User not found/i);
    });

    it('should successfully assign a valid role and collegeId to an EXISTING user, updating Firestore', async () => {
      const adminUid = 'admin-requester-4';
      const targetUid = `target-user-${randomUUID()}`; 
      
      await db.collection(COLLECTIONS.USERS).doc(adminUid).set({ role: Role.ADMIN, collegeId: null });

      await db.collection(COLLECTIONS.COLLEGES).doc('new-college').set({ name: 'New College', code: 'NC' });

      // Seed target user in Firestore
      await db.collection(COLLECTIONS.USERS).doc(targetUid).set({
        role: Role.STUDENT,
        collegeId: 'old-college'
      });

      const token = generateToken({ uid: adminUid, email: 'admin4@college.com', role: Role.ADMIN, collegeId: null });

      const res = await request(app)
        .post('/api/auth/assign-role')
        .set('Authorization', `Bearer ${token}`)
        .send({ targetUid, role: Role.TEACHER, collegeId: 'new-college' });

      expect(res.status).toBe(200);

      // 1. Assert Firestore was updated
      const updatedUserDoc = await db.collection(COLLECTIONS.USERS).doc(targetUid).get();
      expect(updatedUserDoc.data()?.role).toBe(Role.TEACHER);
      expect(updatedUserDoc.data()?.collegeId).toBe('new-college');
    });
  });

  describe('scoping: who may assign which role to whom', () => {
    const tok = (uid: string, role: Role, collegeId: string | null) =>
      generateToken({ uid, email: `${uid}@x.com`, role, collegeId });
    const assign = (token: string, body: object) =>
      request(app).post('/api/auth/assign-role').set('Authorization', `Bearer ${token}`).send(body);
    const userDoc = async (uid: string) => (await db.collection(COLLECTIONS.USERS).doc(uid).get()).data();

    const seed = async () => {
      await db.collection(COLLECTIONS.COLLEGES).doc('collegeA').set({ name: 'A', code: 'A' });
      await db.collection(COLLECTIONS.COLLEGES).doc('collegeB').set({ name: 'B', code: 'B' });
      const users: Array<[string, Role, string | null]> = [
        ['scopedAdminA', Role.ADMIN, 'collegeA'],
        ['otherAdminA', Role.ADMIN, 'collegeA'],
        ['rootAdmin', Role.ADMIN, null],
        ['studentA', Role.STUDENT, 'collegeA'],
        ['studentB', Role.STUDENT, 'collegeB'],
      ];
      for (const [uid, role, collegeId] of users) await db.collection(COLLECTIONS.USERS).doc(uid).set({ role, collegeId });
    };
    const scoped = () => tok('scopedAdminA', Role.ADMIN, 'collegeA');
    const root = () => tok('rootAdmin', Role.ADMIN, null);

    it('a college-scoped admin cannot grant ADMIN to anyone, including themselves (403) and nothing changes', async () => {
      await seed();
      for (const targetUid of ['studentA', 'scopedAdminA']) {
        const before = await userDoc(targetUid);
        for (const collegeId of [undefined, 'collegeA']) {
          const res = await assign(scoped(), { targetUid, role: Role.ADMIN, collegeId });
          expect(res.status, `${targetUid} collegeId=${collegeId}`).toBe(403);
        }
        expect(await userDoc(targetUid)).toEqual(before);
      }
    });

    it('a college-scoped admin can promote a user in their own college to TEACHER', async () => {
      await seed();
      const res = await assign(scoped(), { targetUid: 'studentA', role: Role.TEACHER, collegeId: 'collegeA' });
      expect(res.status).toBe(200);
      const after = await userDoc('studentA');
      expect(after?.role).toBe(Role.TEACHER);
      expect(after?.collegeId).toBe('collegeA');
    });

    it('a college-scoped admin cannot touch a user in another college: indistinguishable from not found (404)', async () => {
      await seed();
      const before = await userDoc('studentB');
      const res = await assign(scoped(), { targetUid: 'studentB', role: Role.TEACHER, collegeId: 'collegeA' });
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/User not found/i);
      expect(await userDoc('studentB')).toEqual(before);
    });

    it('a college-scoped admin cannot move a user into another college (403)', async () => {
      await seed();
      const before = await userDoc('studentA');
      const res = await assign(scoped(), { targetUid: 'studentA', role: Role.TEACHER, collegeId: 'collegeB' });
      expect(res.status).toBe(403);
      expect(await userDoc('studentA')).toEqual(before);
    });

    it('a college-scoped admin cannot modify or demote another ADMIN (403) nor a root admin (404)', async () => {
      await seed();
      const peerBefore = await userDoc('otherAdminA');
      const peer = await assign(scoped(), { targetUid: 'otherAdminA', role: Role.STUDENT, collegeId: 'collegeA' });
      expect(peer.status).toBe(403);
      expect(await userDoc('otherAdminA')).toEqual(peerBefore);

      const rootBefore = await userDoc('rootAdmin');
      const rootRes = await assign(scoped(), { targetUid: 'rootAdmin', role: Role.STUDENT, collegeId: 'collegeA' });
      expect(rootRes.status).toBe(404);
      expect(await userDoc('rootAdmin')).toEqual(rootBefore);
    });

    it('a root admin can grant ADMIN (root, with no college)', async () => {
      await seed();
      const res = await assign(root(), { targetUid: 'studentA', role: Role.ADMIN });
      expect(res.status).toBe(200);
      const after = await userDoc('studentA');
      expect(after?.role).toBe(Role.ADMIN);
      expect(after?.collegeId).toBeNull();
    });

    it('a root admin can assign across colleges', async () => {
      await seed();
      const res = await assign(root(), { targetUid: 'studentB', role: Role.TEACHER, collegeId: 'collegeB' });
      expect(res.status).toBe(200);
      expect((await userDoc('studentB'))?.role).toBe(Role.TEACHER);
    });

    it('assigning to a college that does not exist is rejected (400) and nothing changes', async () => {
      await seed();
      const before = await userDoc('studentA');
      const res = await assign(root(), { targetUid: 'studentA', role: Role.TEACHER, collegeId: 'no-such-college' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Unknown collegeId');
      expect(await userDoc('studentA')).toEqual(before);
    });

    it('end to end: register as STUDENT, get promoted by the college admin, and the next login carries TEACHER', async () => {
      await seed();
      const reg = await request(app).post('/api/auth/register').send({
        email: 'new.teacher@x.com', password: 'password123', role: Role.STUDENT, collegeId: 'collegeA',
      });
      expect(reg.status).toBe(201);
      const uid = reg.body.user.uid;
      await markEmailVerified('new.teacher@x.com');

      const login1 = await request(app).post('/api/auth/login').send({ email: 'new.teacher@x.com', password: 'password123' });
      expect((jwt.decode(login1.body.token) as any).role).toBe(Role.STUDENT);

      const promote = await assign(scoped(), { targetUid: uid, role: Role.TEACHER, collegeId: 'collegeA' });
      expect(promote.status).toBe(200);

      // The old token keeps the old role until it expires; a fresh login picks up the new role.
      const login2 = await request(app).post('/api/auth/login').send({ email: 'new.teacher@x.com', password: 'password123' });
      expect((jwt.decode(login2.body.token) as any).role).toBe(Role.TEACHER);
    });
  });
});
