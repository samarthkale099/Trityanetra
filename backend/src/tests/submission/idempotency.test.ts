import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import * as admin from 'firebase-admin';
import request from 'supertest';
import { app } from '../../app';
import { COLLECTIONS } from '../../db/collections';
import { Role } from '../../types/roles';
import { generateToken } from '../helpers/auth';
import { env } from '../../config/env';
import jwt from 'jsonwebtoken';

describe('Submission Module API & Idempotency', () => {
  const db = admin.firestore();

  beforeAll(async () => {
    // Warm up Firestore connection
    await db.collection('warmup').doc('warmup').get();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('JWT Authentication', () => {
    it('should reject a request with a JWT signed using the wrong secret', async () => {
      const wrongSecretToken = jwt.sign({ uid: 'student-1', email: 'test@example.com', role: Role.STUDENT, collegeId: null }, 'wrong-secret');
      
      const res = await request(app)
        .post('/api/submissions')
        .set('Authorization', `Bearer ${wrongSecretToken}`);
      
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized: Invalid or expired token');
    });

    it('should reject a request with an expired JWT', async () => {
      const expiredToken = jwt.sign({ uid: 'student-1', email: 'test@example.com', role: Role.STUDENT, collegeId: null }, env.JWT_SECRET, { expiresIn: '-1s' });
      
      const res = await request(app)
        .post('/api/submissions')
        .set('Authorization', `Bearer ${expiredToken}`);
      
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized: Invalid or expired token');
    });
  });

  describe('POST /api/submissions Idempotency and Guards', () => {
    it('should only allow one submission, reject rapid concurrent requests, and block subsequent modification via lock guard', async () => {
      const testId = 'idempotency-api-test-1';
      const studentUid = 'student-idemp-1';
      const classroomId = 'class-idemp-1';
      const collegeId = 'college-idemp-1';
      const submissionId = `${testId}_${studentUid}`;

      // 1. Seed user, classroom, test
      await db.collection(COLLECTIONS.USERS).doc(studentUid).set({ role: Role.STUDENT, collegeId });
      await db.collection(COLLECTIONS.CLASSROOMS).doc(classroomId).set({ collegeId, students: [studentUid] });

      const pastStart = new Date();
      pastStart.setHours(pastStart.getHours() - 1);
      const futureEnd = new Date();
      futureEnd.setHours(futureEnd.getHours() + 1);
      
      await db.collection(COLLECTIONS.TESTS).doc(testId).set({
        classroomId,
        collegeId,
        startTime: admin.firestore.Timestamp.fromDate(pastStart),
        endTime: admin.firestore.Timestamp.fromDate(futureEnd),
        questions: [{ text: 'Q1' }]
      });

      const token = generateToken({ uid: studentUid, email: 'student1@idemp.com', role: Role.STUDENT, collegeId });

      // 2. Rapid concurrent submissions
      const req1 = request(app)
        .post('/api/submissions')
        .set('Authorization', `Bearer ${token}`)
        .send({ testId, answers: { q1: 'answer 1' } });

      const req2 = request(app)
        .post('/api/submissions')
        .set('Authorization', `Bearer ${token}`)
        .send({ testId, answers: { q1: 'answer 2' } });

      const [res1, res2] = await Promise.all([req1, req2]);

      const succeeded = res1.body.message === 'Exam submitted successfully' ? res1 : (res2.body.message === 'Exam submitted successfully' ? res2 : null);
      const failed = res1.body.message === 'Exam already submitted (Idempotent response)' ? res1 : (res2.body.message === 'Exam already submitted (Idempotent response)' ? res2 : null);

      expect(succeeded).not.toBeNull();
      expect(succeeded!.status).toBe(200);

      expect(failed).not.toBeNull();
      expect(failed!.status).toBe(200);

      // 3. Verify exactly ONE document exists
      const doc = await db.collection(COLLECTIONS.SUBMISSIONS).doc(submissionId).get();
      expect(doc.exists).toBe(true);
      expect(doc.data()?.status).toBe('SUBMITTED');

      // 4. Test submissionLockGuard directly (third sequential request)
      const res3 = await request(app)
        .post('/api/submissions')
        .set('Authorization', `Bearer ${token}`)
        .send({ testId, answers: { q1: 'answer 3' } });

      // The lock guard should catch this before the transaction
      expect(res3.status).toBe(403);
      expect(res3.body.error).toMatch(/Submission is locked/i);
    }, 10000);
  });
});
