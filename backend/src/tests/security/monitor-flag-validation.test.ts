import { describe, it, expect } from 'vitest';
import * as admin from 'firebase-admin';
import request from 'supertest';
import { app } from '../../app';
import { COLLECTIONS } from '../../db/collections';
import { Role } from '../../types/roles';
import { generateToken } from '../helpers/auth';

// The flag route rate-limits per (user, testId) at 1 request / 2s, so every case uses its own
// testId to stay independent of timing.
const db = admin.firestore();
let n = 0;

const tokenFor = (uid: string, role: Role = Role.STUDENT) =>
  generateToken({ uid, email: `${uid}@x.com`, role, collegeId: 'c1' });
const post = (testId: string, token: string, body: unknown) =>
  request(app).post(`/api/monitor/${testId}/flags`).set('Authorization', `Bearer ${token}`).send(body as object);

// Creates a test whose classroom contains `uid`, and returns the testId.
const enrolledTest = async (uid: string) => {
  const testId = `mon-sec-test-${++n}`;
  await db.collection(COLLECTIONS.CLASSROOMS).doc(`cls-${testId}`).set({ collegeId: 'c1', teacherId: 'someTeacher', students: [uid] });
  await db.collection(COLLECTIONS.TESTS).doc(testId).set({ classroomId: `cls-${testId}`, collegeId: 'c1', teacherId: 'someTeacher' });
  return testId;
};
const flagsFor = (testId: string) => db.collection(COLLECTIONS.MONITOR_FLAGS).where('testId', '==', testId).get();

describe('Security: monitor flag validation', () => {
  it('rejects unknown flag types (400) and stores nothing', async () => {
    const uid = 'mon-sec-student';
    for (const flagType of ['NOT_A_FLAG', 'tab_switch', '', 123, null, { a: 1 }]) {
      const testId = await enrolledTest(uid);
      const res = await post(testId, tokenFor(uid), { flagType });
      expect(res.status, JSON.stringify(flagType)).toBe(400);
      expect((await flagsFor(testId)).empty).toBe(true);
    }
  }, 20000);

  it('rejects a body with no flagType (400)', async () => {
    const uid = 'mon-sec-student-2';
    const res = await post(await enrolledTest(uid), tokenFor(uid), { metadata: { x: 1 } });
    expect(res.status).toBe(400);
  });

  it('only accepts STUDENT tokens (TEACHER and ADMIN get 403)', async () => {
    for (const role of [Role.TEACHER, Role.ADMIN]) {
      const uid = `u-${role}`;
      const res = await post(await enrolledTest(uid), tokenFor(uid, role), { flagType: 'TAB_SWITCH' });
      expect(res.status, role).toBe(403);
    }
  });

  it('takes the student identity from the JWT, ignoring a studentId in the body', async () => {
    const testId = await enrolledTest('real-student');
    const res = await post(testId, tokenFor('real-student'), {
      flagType: 'TAB_SWITCH',
      studentId: 'victim-student',
      testId: 'some-other-test',
    });
    expect(res.status).toBe(201);
    const snap = await flagsFor(testId);
    expect(snap.size).toBe(1);
    expect(snap.docs[0].data().studentId).toBe('real-student');
    expect((await db.collection(COLLECTIONS.MONITOR_FLAGS).where('studentId', '==', 'victim-student').get()).empty).toBe(true);
  });

  it('rejects a flag from a student who is NOT enrolled in the test classroom (403) and stores nothing', async () => {
    const testId = await enrolledTest('enrolled-student');
    const res = await post(testId, tokenFor('outsider-student'), { flagType: 'TAB_SWITCH' });
    expect(res.status).toBe(403);
    expect((await flagsFor(testId)).empty).toBe(true);
  });

  it('rejects a flag for a test that does not exist (404) and stores nothing', async () => {
    const testId = 'mon-sec-no-such-test';
    const res = await post(testId, tokenFor('any-student'), { flagType: 'TAB_SWITCH' });
    expect(res.status).toBe(404);
    expect((await flagsFor(testId)).empty).toBe(true);
  });

  it('an enrolled student of one test cannot flag a different test they are not enrolled in', async () => {
    const own = await enrolledTest('two-tests-student');
    const other = await enrolledTest('someone-else');
    expect((await post(own, tokenFor('two-tests-student'), { flagType: 'TAB_SWITCH' })).status).toBe(201);
    expect((await post(other, tokenFor('two-tests-student'), { flagType: 'TAB_SWITCH' })).status).toBe(403);
    expect((await flagsFor(other)).empty).toBe(true);
  });

  it('rejects a payload larger than the 1 MB body limit (413) and stores nothing', async () => {
    const uid = 'mon-sec-big';
    const testId = await enrolledTest(uid);
    const res = await post(testId, tokenFor(uid), { flagType: 'TAB_SWITCH', metadata: { blob: 'x'.repeat(1_200_000) } });
    expect(res.status).toBe(413);
    expect((await flagsFor(testId)).empty).toBe(true);
  });

  it('rate-limits a flag flood from one student on one test (429)', async () => {
    const uid = 'flooder';
    const testId = await enrolledTest(uid);
    const token = tokenFor(uid);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await post(testId, token, { flagType: 'TAB_SWITCH' })).status);
    expect(statuses[0]).toBe(201);
    expect(statuses.slice(1).every((s) => s === 429)).toBe(true);
    expect((await flagsFor(testId)).size).toBe(1);
  });

  it('flags are append-only: PUT, PATCH and DELETE do not exist (404)', async () => {
    const uid = 'mon-sec-append';
    const testId = await enrolledTest(uid);
    for (const m of ['put', 'patch', 'delete'] as const) {
      const res = await (request(app) as any)[m](`/api/monitor/${testId}/flags`)
        .set('Authorization', `Bearer ${tokenFor(uid)}`)
        .send({ flagType: 'TAB_SWITCH' });
      expect(res.status, m).toBe(404);
    }
  });
});
