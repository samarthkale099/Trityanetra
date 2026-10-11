import { describe, it, expect, vi } from 'vitest';
import * as admin from 'firebase-admin';
import request from 'supertest';
import { app } from '../../app';
import { COLLECTIONS } from '../../db/collections';
import { Role } from '../../types/roles';
import { generateToken } from '../helpers/auth';

const db = admin.firestore();
const tok = (uid: string, role: Role, collegeId: string | null) =>
  generateToken({ uid, email: `${uid}@x.com`, role, collegeId });

// Seeds: college A with teacher A (owns classroom + test), teacher B (same college, owns nothing),
// students 1 and 2 in the classroom, student 3 not in it.
const seed = async () => {
  const hours = (h: number) => admin.firestore.Timestamp.fromDate(new Date(Date.now() + h * 3600_000));
  await db.collection(COLLECTIONS.CLASSROOMS).doc('cls-A').set({
    teacherId: 'teacherA',
    collegeId: 'collegeA',
    students: ['student1', 'student2'],
  });
  await db.collection(COLLECTIONS.TESTS).doc('test-A').set({
    teacherId: 'teacherA',
    classroomId: 'cls-A',
    collegeId: 'collegeA',
    startTime: hours(-1),
    endTime: hours(1),
    questions: [],
  });
  for (const [uid, role] of [
    ['teacherA', Role.TEACHER],
    ['teacherB', Role.TEACHER],
    ['student1', Role.STUDENT],
    ['student2', Role.STUDENT],
    ['student3', Role.STUDENT],
  ] as const) {
    await db.collection(COLLECTIONS.USERS).doc(uid).set({ role, collegeId: 'collegeA' });
  }
};

describe('Security: IDOR (object-level authorization)', () => {
  it('a student outside the classroom cannot enter the test (403)', async () => {
    await seed();
    const res = await request(app).get('/api/tests/test-A/entry').set('Authorization', `Bearer ${tok('student3', Role.STUDENT, 'collegeA')}`);
    expect(res.status).toBe(403);
  });

  it('entering a test that does not exist is 404, not a leak or a crash', async () => {
    await seed();
    const res = await request(app).get('/api/tests/no-such-test/entry').set('Authorization', `Bearer ${tok('student1', Role.STUDENT, 'collegeA')}`);
    expect(res.status).toBe(404);
  });

  it('a student cannot write into another student submission by passing their id in the body', async () => {
    await seed();
    const victimId = `test-A_student1`;
    await db.collection(COLLECTIONS.SUBMISSIONS).doc(victimId).set({
      testId: 'test-A',
      studentId: 'student1',
      answers: { q1: 'victim original' },
      status: 'DRAFT',
    });

    const attacker = tok('student2', Role.STUDENT, 'collegeA');
    for (const path of ['/api/submissions/save', '/api/submissions']) {
      const res = await request(app)
        .post(path)
        .set('Authorization', `Bearer ${attacker}`)
        .send({ testId: 'test-A', answers: { q1: 'attacker text' }, studentId: 'student1', userId: 'student1', uid: 'student1' });
      expect(res.status, path).toBe(200);
    }

    const victim = (await db.collection(COLLECTIONS.SUBMISSIONS).doc(victimId).get()).data()!;
    expect(victim.answers).toEqual({ q1: 'victim original' });
    expect(victim.status).toBe('DRAFT');

    const own = (await db.collection(COLLECTIONS.SUBMISSIONS).doc('test-A_student2').get()).data()!;
    expect(own.studentId).toBe('student2');
    expect(own.answers).toEqual({ q1: 'attacker text' });
  }, 20000);

  it('a student cannot submit for a test in a classroom they are not in (403) and nothing is written', async () => {
    await seed();
    const res = await request(app)
      .post('/api/submissions')
      .set('Authorization', `Bearer ${tok('student3', Role.STUDENT, 'collegeA')}`)
      .send({ testId: 'test-A', answers: { q1: 'x' } });
    expect(res.status).toBe(403);
    expect((await db.collection(COLLECTIONS.SUBMISSIONS).doc('test-A_student3').get()).exists).toBe(false);
  });

  it('another teacher in the same college cannot trigger or read plagiarism results for a test they do not own (403)', async () => {
    await seed();
    await db.collection(COLLECTIONS.PLAGIARISM_RESULTS).doc('test-A').set({ status: 'COMPLETED' });
    const other = `Bearer ${tok('teacherB', Role.TEACHER, 'collegeA')}`;
    const check = await request(app).post('/api/plagiarism/test-A/check').set('Authorization', other);
    const status = await request(app).get('/api/plagiarism/test-A/status').set('Authorization', other);
    expect(check.status).toBe(403);
    expect(status.status).toBe(403);
    expect(((await db.collection(COLLECTIONS.PLAGIARISM_RESULTS).doc('test-A').get()).data() as any).status).toBe('COMPLETED');
  });

  it('a college-scoped admin from another college cannot touch this college plagiarism results (403)', async () => {
    await seed();
    const res = await request(app).get('/api/plagiarism/test-A/status').set('Authorization', `Bearer ${tok('adminB', Role.ADMIN, 'collegeB')}`);
    expect(res.status).toBe(403);
  });

  it('another teacher cannot add or remove students in a classroom they do not own (403) and the roster is unchanged', async () => {
    await seed();
    const other = `Bearer ${tok('teacherB', Role.TEACHER, 'collegeA')}`;
    for (const action of ['add', 'remove']) {
      const res = await request(app).post('/api/classrooms/cls-A/students').set('Authorization', other).send({ students: ['student3', 'student1'], action });
      expect(res.status, action).toBe(403);
    }
    const roster = (await db.collection(COLLECTIONS.CLASSROOMS).doc('cls-A').get()).data()!.students;
    expect(roster.sort()).toEqual(['student1', 'student2']);
  });

  it('a student only sees classrooms they belong to, and another teacher sees none of this teacher classrooms', async () => {
    await seed();
    const s3 = await request(app).get('/api/classrooms').set('Authorization', `Bearer ${tok('student3', Role.STUDENT, 'collegeA')}`);
    expect(s3.status).toBe(200);
    expect(s3.body.data).toEqual([]);
    const tB = await request(app).get('/api/classrooms').set('Authorization', `Bearer ${tok('teacherB', Role.TEACHER, 'collegeA')}`);
    expect(tB.body.data).toEqual([]);
    const tests = await request(app).get('/api/tests').set('Authorization', `Bearer ${tok('teacherB', Role.TEACHER, 'collegeA')}`);
    expect(tests.body.data).toEqual([]);
  });
});
