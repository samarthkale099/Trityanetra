import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import request from 'supertest';
import { app } from '../../app';
import { COLLECTIONS } from '../../db/collections';
import { Role } from '../../types/roles';
import { generateToken } from '../helpers/auth';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';

describe('College Module', () => {
  const db = admin.firestore();

  beforeEach(() => {
    vi.restoreAllMocks();
  });



  describe('JWT Authentication', () => {
    it('should reject a request with a JWT signed using the wrong secret', async () => {
      const wrongSecretToken = jwt.sign({ uid: 'user-1', email: 'test@example.com', role: Role.ADMIN, collegeId: null }, 'wrong-secret');
      
      const res = await request(app)
        .get('/api/colleges')
        .set('Authorization', `Bearer ${wrongSecretToken}`);
      
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized: Invalid or expired token');
    });

    it('should reject a request with an expired JWT', async () => {
      const expiredToken = jwt.sign({ uid: 'user-1', email: 'test@example.com', role: Role.ADMIN, collegeId: null }, env.JWT_SECRET, { expiresIn: '-1s' });
      
      const res = await request(app)
        .get('/api/colleges')
        .set('Authorization', `Bearer ${expiredToken}`);
      
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized: Invalid or expired token');
    });
  });

  describe('POST /api/colleges', () => {
    it('should allow a root-admin (collegeId: null) to create a college', async () => {
      const rootAdminUid = 'root-admin-1';
      
      await db.collection(COLLECTIONS.USERS).doc(rootAdminUid).set({
        role: Role.ADMIN,
        collegeId: null
      });

      const token = generateToken({
        uid: rootAdminUid,
        email: 'root@admin.com',
        role: Role.ADMIN,
        collegeId: null
      });

      const res = await request(app)
        .post('/api/colleges')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Root College', code: 'RC' });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('College created successfully');
      expect(res.body.data.name).toBe('Root College');
      expect(res.body.data.code).toBe('RC');
      
      const collegeDoc = await db.collection(COLLECTIONS.COLLEGES).doc(res.body.data.id).get();
      expect(collegeDoc.exists).toBe(true);
    });

    it('should reject a college-scoped admin from creating a college with 403', async () => {
      const scopedAdminUid = 'scoped-admin-1';
      
      await db.collection(COLLECTIONS.USERS).doc(scopedAdminUid).set({
        role: Role.ADMIN,
        collegeId: 'some-college-id'
      });

      const token = generateToken({
        uid: scopedAdminUid,
        email: 'scoped@admin.com',
        role: Role.ADMIN,
        collegeId: 'some-college-id'
      });

      const res = await request(app)
        .post('/api/colleges')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Scoped College', code: 'SC' });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Forbidden: Only root admins can create colleges/i);
    });
  });

  describe('GET /api/colleges', () => {
    it('should return only their own college for a college-scoped admin', async () => {
      const scopedAdminUid = 'scoped-admin-2';
      const myCollegeId = 'college-A';
      
      await db.collection(COLLECTIONS.USERS).doc(scopedAdminUid).set({
        role: Role.ADMIN,
        collegeId: myCollegeId
      });

      // Seed a few colleges
      await db.collection(COLLECTIONS.COLLEGES).doc(myCollegeId).set({ name: 'College A', code: 'CA' });
      await db.collection(COLLECTIONS.COLLEGES).doc('college-B').set({ name: 'College B', code: 'CB' });

      const token = generateToken({
        uid: scopedAdminUid,
        email: 'scoped2@admin.com',
        role: Role.ADMIN,
        collegeId: myCollegeId
      });

      const res = await request(app)
        .get('/api/colleges')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].id).toBe(myCollegeId);
    });

    it('should return all colleges for a root admin', async () => {
      const rootAdminUid = 'root-admin-2';
      
      await db.collection(COLLECTIONS.USERS).doc(rootAdminUid).set({
        role: Role.ADMIN,
        collegeId: null
      });

      // Seed a few colleges
      await db.collection(COLLECTIONS.COLLEGES).doc('college-C').set({ name: 'College C', code: 'CC' });
      await db.collection(COLLECTIONS.COLLEGES).doc('college-D').set({ name: 'College D', code: 'CD' });

      const token = generateToken({
        uid: rootAdminUid,
        email: 'root2@admin.com',
        role: Role.ADMIN,
        collegeId: null
      });

      const res = await request(app)
        .get('/api/colleges')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      // We know there are at least two colleges from this test, but since teardown happens, it should be exactly 2
      expect(res.body.data.length).toBe(2);
      const names = res.body.data.map((c: any) => c.name);
      expect(names).toContain('College C');
      expect(names).toContain('College D');
    });
  });
});
