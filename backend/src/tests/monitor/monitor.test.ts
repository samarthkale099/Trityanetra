import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import request from 'supertest';
import { app } from '../../app';
import { COLLECTIONS } from '../../db/collections';
import { Role } from '../../types/roles';
import { generateToken } from '../helpers/auth';

describe('Monitor Module - Flag Append-Only Behavior', () => {
  const db = admin.firestore();

  beforeEach(async () => {
    vi.restoreAllMocks();
  });

  it('should successfully store a valid monitor flag (POST) and deny PUT/PATCH/DELETE with 404', async () => {
    const studentUid = 'student-monitor-test';
    const testId = 'test-123';
    
    // Create the student user in the database
    await db.collection(COLLECTIONS.USERS).doc(studentUid).set({
      role: Role.STUDENT,
      collegeId: 'college-A'
    });

    // The student must be enrolled in the classroom the test belongs to
    await db.collection(COLLECTIONS.CLASSROOMS).doc('class-monitor').set({ collegeId: 'college-A', students: [studentUid] });
    await db.collection(COLLECTIONS.TESTS).doc(testId).set({ classroomId: 'class-monitor', collegeId: 'college-A' });

    // Generate JWT token for the student
    const token = generateToken({
      uid: studentUid,
      email: 'student@college.com',
      role: Role.STUDENT,
      collegeId: 'college-A'
    });

    const route = `/api/monitor/${testId}/flags`;

    // 1. POST a valid flag
    const postRes = await request(app)
      .post(route)
      .set('Authorization', `Bearer ${token}`)
      .send({ flagType: 'TAB_SWITCH', metadata: { someData: true } });

    expect(postRes.status).toBe(201);
    expect(postRes.body.message).toBe('Flag recorded');

    // Verify it was actually stored in Firestore
    const flagsSnapshot = await db.collection(COLLECTIONS.MONITOR_FLAGS)
      .where('testId', '==', testId)
      .where('studentId', '==', studentUid)
      .get();
      
    expect(flagsSnapshot.empty).toBe(false);
    expect(flagsSnapshot.docs[0].data().flagType).toBe('TAB_SWITCH');
    expect(flagsSnapshot.docs[0].data().metadata.someData).toBe(true);

    // 2. Attempt PUT
    const putRes = await request(app)
      .put(route)
      .set('Authorization', `Bearer ${token}`)
      .send({ flagType: 'TAB_SWITCH' });
    expect(putRes.status).toBe(404);

    // 3. Attempt PATCH
    const patchRes = await request(app)
      .patch(route)
      .set('Authorization', `Bearer ${token}`)
      .send({ flagType: 'TAB_SWITCH' });
    expect(patchRes.status).toBe(404);

    // 4. Attempt DELETE
    const deleteRes = await request(app)
      .delete(route)
      .set('Authorization', `Bearer ${token}`);
    expect(deleteRes.status).toBe(404);
  });
});
