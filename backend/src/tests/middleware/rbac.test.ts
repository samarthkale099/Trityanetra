import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import request from 'supertest';
import { app } from '../../app';
import { COLLECTIONS } from '../../db/collections';
import { Role } from '../../types/roles';
import { generateToken } from '../helpers/auth';

describe('RBAC Middleware', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should reject a STUDENT trying to access a TEACHER/ADMIN route with 403', async () => {
    const studentUid = 'student-rbac-1';
    const db = admin.firestore();

    // 1. Seed a STUDENT user in the emulated Firestore
    await db.collection(COLLECTIONS.USERS).doc(studentUid).set({
      role: Role.STUDENT,
      collegeId: 'collegeA'
    });

    // 2. Generate real JWT
    const token = generateToken({
      uid: studentUid,
      email: 'student@test.com',
      role: Role.STUDENT,
      collegeId: 'collegeA'
    });

    // 3. Hit a TEACHER-only route (POST /api/classrooms)
    const res = await request(app)
      .post('/api/classrooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Hacked Classroom', students: [] });

    // 4. Assert 403 Forbidden
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Forbidden/i);
  });
});
