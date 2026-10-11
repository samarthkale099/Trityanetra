import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import request from 'supertest';
import { app } from '../../app';
import { COLLECTIONS } from '../../db/collections';
import { Role } from '../../types/roles';
import { generateToken } from '../helpers/auth';
import { env } from '../../config/env';
import jwt from 'jsonwebtoken';

describe('Test Module API & Guards', () => {
  const db = admin.firestore();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('JWT Authentication', () => {
    it('should reject a request with a JWT signed using the wrong secret', async () => {
      const wrongSecretToken = jwt.sign({ uid: 'student-1', email: 'test@example.com', role: Role.STUDENT, collegeId: null }, 'wrong-secret');
      
      const res = await request(app)
        .get('/api/tests/some-test/entry')
        .set('Authorization', `Bearer ${wrongSecretToken}`);
      
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized: Invalid or expired token');
    });

    it('should reject a request with an expired JWT', async () => {
      const expiredToken = jwt.sign({ uid: 'student-1', email: 'test@example.com', role: Role.STUDENT, collegeId: null }, env.JWT_SECRET, { expiresIn: '-1s' });
      
      const res = await request(app)
        .get('/api/tests/some-test/entry')
        .set('Authorization', `Bearer ${expiredToken}`);
      
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized: Invalid or expired token');
    });
  });

  describe('testMembershipGuard and testWindowGuard via GET /api/tests/:testId/entry', () => {
    it('should reject a request if the test has not started yet (testWindowGuard)', async () => {
      const testId = 'future-test-1';
      const studentUid = 'student-test-1';
      const classroomId = 'class-1';
      const collegeId = 'college-A';

      await db.collection(COLLECTIONS.USERS).doc(studentUid).set({ role: Role.STUDENT, collegeId });
      await db.collection(COLLECTIONS.CLASSROOMS).doc(classroomId).set({ collegeId, students: [studentUid] });

      const futureTime = new Date();
      futureTime.setHours(futureTime.getHours() + 1);
      
      await db.collection(COLLECTIONS.TESTS).doc(testId).set({
        classroomId,
        collegeId,
        startTime: admin.firestore.Timestamp.fromDate(futureTime),
        endTime: admin.firestore.Timestamp.fromDate(new Date(futureTime.getTime() + 3600000))
      });

      const token = generateToken({ uid: studentUid, email: 'student1@test.com', role: Role.STUDENT, collegeId });

      const res = await request(app)
        .get(`/api/tests/${testId}/entry`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/has not started yet/i);
    });

    it('should reject a request if the test has already ended (testWindowGuard)', async () => {
      const testId = 'past-test-1';
      const studentUid = 'student-test-2';
      const classroomId = 'class-2';
      const collegeId = 'college-B';

      await db.collection(COLLECTIONS.USERS).doc(studentUid).set({ role: Role.STUDENT, collegeId });
      await db.collection(COLLECTIONS.CLASSROOMS).doc(classroomId).set({ collegeId, students: [studentUid] });

      const pastStart = new Date();
      pastStart.setHours(pastStart.getHours() - 2);
      const pastEnd = new Date();
      pastEnd.setHours(pastEnd.getHours() - 1);
      
      await db.collection(COLLECTIONS.TESTS).doc(testId).set({
        classroomId,
        collegeId,
        startTime: admin.firestore.Timestamp.fromDate(pastStart),
        endTime: admin.firestore.Timestamp.fromDate(pastEnd)
      });

      const token = generateToken({ uid: studentUid, email: 'student2@test.com', role: Role.STUDENT, collegeId });

      const res = await request(app)
        .get(`/api/tests/${testId}/entry`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/has already ended/i);
    });

    it('should allow entry if the user is a member and the window is open', async () => {
      const testId = 'open-test-1';
      const studentUid = 'student-test-3';
      const classroomId = 'class-3';
      const collegeId = 'college-C';

      await db.collection(COLLECTIONS.USERS).doc(studentUid).set({ role: Role.STUDENT, collegeId });
      await db.collection(COLLECTIONS.CLASSROOMS).doc(classroomId).set({ collegeId, students: [studentUid] });

      const pastStart = new Date();
      pastStart.setHours(pastStart.getHours() - 1);
      const futureEnd = new Date();
      futureEnd.setHours(futureEnd.getHours() + 1);
      
      await db.collection(COLLECTIONS.TESTS).doc(testId).set({
        title: 'Open Test',
        classroomId,
        collegeId,
        startTime: admin.firestore.Timestamp.fromDate(pastStart),
        endTime: admin.firestore.Timestamp.fromDate(futureEnd),
        questions: [{ text: 'Q1' }]
      });

      const token = generateToken({ uid: studentUid, email: 'student3@test.com', role: Role.STUDENT, collegeId });

      const res = await request(app)
        .get(`/api/tests/${testId}/entry`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.title).toBe('Open Test');
    });
  });
});
