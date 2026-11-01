import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import request from 'supertest';
import { app } from '../../app';
import { COLLECTIONS } from '../../db/collections';
import { Role } from '../../types/roles';
import { generateToken } from '../helpers/auth';
import { MonitorFlagType } from '../../modules/monitor/monitor.types';

/**
 * End-to-end flow across modules, against the Firestore emulator:
 *
 *   teacher enrols students by email (incl. an unregistered invite)
 *   -> the invite is linked when that student registers
 *   -> students see only their own classrooms' tests, never hidden test cases
 *   -> the exam timer is latched on first entry and enforced server-side
 *   -> teacher grades, releases; the student sees marks only after release
 *   -> teacher reads the integrity (monitor) report
 */
describe('Phase 3 integration: enrolment, visibility, exam, grading', () => {
  const db = admin.firestore();
  const COLLEGE = 'college-int';
  const OTHER_COLLEGE = 'college-other';
  const teacher = { uid: 'teacher-int', email: 'teacher@int.edu', role: Role.TEACHER, collegeId: COLLEGE };
  const riya = { uid: 'student-riya', email: 'riya@int.edu', role: Role.STUDENT, collegeId: COLLEGE };
  const kabir = { uid: 'student-kabir', email: 'kabir@int.edu', role: Role.STUDENT, collegeId: COLLEGE };
  const outsider = { uid: 'student-out', email: 'out@other.edu', role: Role.STUDENT, collegeId: OTHER_COLLEGE };

  const tokenFor = (user: { uid: string; email: string; role: Role; collegeId: string }) => generateToken(user);
  const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000);

  let classroomId: string;

  /** A test in `classroomId` whose window is [startOffset, endOffset] minutes from now. */
  const seedTest = async (startOffset: number, endOffset: number, extra: Record<string, unknown> = {}) => {
    const ref = await db.collection(COLLECTIONS.TESTS).add({
      title: 'Experiment 3: Bubble sort',
      classroomId,
      teacherId: teacher.uid,
      collegeId: COLLEGE,
      startTime: admin.firestore.Timestamp.fromDate(minutesFromNow(startOffset)),
      endTime: admin.firestore.Timestamp.fromDate(minutesFromNow(endOffset)),
      durationMinutes: 30,
      language: 'python',
      questions: [
        {
          id: 'q1',
          prompt: 'Sort the list.',
          points: 10,
          solution: 'def solve(xs): return sorted(xs)',
          testCases: [
            { id: 'c1', input: '3 1 2', expected: '1 2 3', hidden: false },
            { id: 'c2', input: 'SECRET-INPUT', expected: 'SECRET-OUTPUT', hidden: true },
          ],
        },
      ],
      ...extra,
    });
    return ref.id;
  };

  beforeEach(async () => {
    await db.collection(COLLECTIONS.COLLEGES).doc(COLLEGE).set({ name: 'Int College', code: 'INT', emailDomain: 'int.edu' });
    for (const user of [teacher, riya, kabir, outsider]) {
      await db.collection(COLLECTIONS.USERS).doc(user.uid).set({
        email: user.email,
        displayName: user.uid,
        role: user.role,
        collegeId: user.collegeId,
      });
    }
    const classroom = await db.collection(COLLECTIONS.CLASSROOMS).add({
      name: 'Python Lab',
      teacherId: teacher.uid,
      collegeId: COLLEGE,
      students: [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    classroomId = classroom.id;
  });

  describe('enrolment by email', () => {
    it('adds registered students, invites unknown emails, and rejects other-college accounts', async () => {
      const res = await request(app)
        .post(`/api/classrooms/${classroomId}/students`)
        .set('Authorization', `Bearer ${tokenFor(teacher)}`)
        .send({ emails: ['RIYA@int.edu', 'new.person@int.edu', 'out@other.edu', 'not-an-email'] });

      expect(res.status).toBe(201);
      expect(res.body.result.added).toEqual(['riya@int.edu']);
      expect(res.body.result.invited).toEqual(['new.person@int.edu']);
      expect(res.body.result.rejected.map((r: any) => r.email).sort()).toEqual(['not-an-email', 'out@other.edu']);

      const roster = res.body.data.students;
      expect(roster.find((s: any) => s.email === 'riya@int.edu')).toMatchObject({ pending: false, uid: riya.uid });
      expect(roster.find((s: any) => s.email === 'new.person@int.edu')).toMatchObject({ pending: true, uid: '' });
    });

    it('is idempotent', async () => {
      const send = () =>
        request(app)
          .post(`/api/classrooms/${classroomId}/students`)
          .set('Authorization', `Bearer ${tokenFor(teacher)}`)
          .send({ emails: ['riya@int.edu'] });
      await send();
      const second = await send();
      expect(second.status).toBe(200);
      expect(second.body.result.alreadyEnrolled).toEqual(['riya@int.edu']);
      expect(second.body.data.students.filter((s: any) => s.email === 'riya@int.edu')).toHaveLength(1);
    });

    it('links an invite when that email registers', async () => {
      await request(app)
        .post(`/api/classrooms/${classroomId}/students`)
        .set('Authorization', `Bearer ${tokenFor(teacher)}`)
        .send({ emails: ['new.person@int.edu'] });

      const registered = await request(app)
        .post('/api/auth/register')
        .send({ email: 'New.Person@int.edu', password: 'pass-123456', role: Role.STUDENT, displayName: 'New Person' });
      expect(registered.status).toBe(201);
      expect(registered.body.user.collegeId).toBe(COLLEGE); // resolved from the email domain

      const classroom = (await db.collection(COLLECTIONS.CLASSROOMS).doc(classroomId).get()).data()!;
      expect(classroom.students).toContain(registered.body.user.uid);
      expect(classroom.invitedEmails ?? []).not.toContain('new.person@int.edu');
    });

    it('refuses enrolment by anyone but the owning teacher', async () => {
      const res = await request(app)
        .post(`/api/classrooms/${classroomId}/students`)
        .set('Authorization', `Bearer ${tokenFor(riya)}`)
        .send({ emails: ['kabir@int.edu'] });
      expect(res.status).toBe(403);
    });

    it('removes a student by email; the roster detail is teacher-only', async () => {
      await db.collection(COLLECTIONS.CLASSROOMS).doc(classroomId).update({ students: [riya.uid] });
      const removed = await request(app)
        .delete(`/api/classrooms/${classroomId}/students/${encodeURIComponent('riya@int.edu')}`)
        .set('Authorization', `Bearer ${tokenFor(teacher)}`);
      expect(removed.status).toBe(200);
      expect(removed.body.data.students).toHaveLength(0);

      const asStudent = await request(app)
        .get(`/api/classrooms/${classroomId}`)
        .set('Authorization', `Bearer ${tokenFor(riya)}`);
      expect(asStudent.status).toBe(403);
    });
  });

  describe('student visibility and hidden test cases', () => {
    it('lists only tests of classrooms the student was added to, without questions', async () => {
      await db.collection(COLLECTIONS.CLASSROOMS).doc(classroomId).update({ students: [riya.uid] });
      await seedTest(-5, 60);

      const asRiya = await request(app).get('/api/tests').set('Authorization', `Bearer ${tokenFor(riya)}`);
      expect(asRiya.status).toBe(200);
      expect(asRiya.body.data).toHaveLength(1);
      expect(asRiya.body.data[0].questions).toBeUndefined();
      expect(JSON.stringify(asRiya.body)).not.toContain('SECRET');

      // Same college, not enrolled: sees nothing.
      const asKabir = await request(app).get('/api/tests').set('Authorization', `Bearer ${tokenFor(kabir)}`);
      expect(asKabir.body.data).toHaveLength(0);
    });

    it('masks hidden test cases and the reference solution on entry', async () => {
      await db.collection(COLLECTIONS.CLASSROOMS).doc(classroomId).update({ students: [riya.uid] });
      const testId = await seedTest(-5, 60);

      const res = await request(app).get(`/api/tests/${testId}/entry`).set('Authorization', `Bearer ${tokenFor(riya)}`);
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('SECRET-INPUT');
      expect(body).not.toContain('SECRET-OUTPUT');
      expect(body).not.toContain('sorted(xs)');
      expect(res.body.data.test.questions[0].testCases[1]).toEqual({ id: 'c2', hidden: true, input: null, expected: null });
    });

    it("gives a student the classroom's details but never the roster or invites", async () => {
      await db
        .collection(COLLECTIONS.CLASSROOMS)
        .doc(classroomId)
        .update({ students: [riya.uid, kabir.uid], invitedEmails: ['someone@int.edu'] });
      const res = await request(app).get('/api/classrooms').set('Authorization', `Bearer ${tokenFor(riya)}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Python Lab');
      expect(res.body.data[0].students).toBeUndefined();
      expect(res.body.data[0].invitedEmails).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain(kabir.uid);
    });

    it('serves the lobby without questions and without starting the timer', async () => {
      await db.collection(COLLECTIONS.CLASSROOMS).doc(classroomId).update({ students: [riya.uid] });
      const testId = await seedTest(30, 90); // not open yet: the lobby still answers
      const res = await request(app).get(`/api/tests/${testId}/lobby`).set('Authorization', `Bearer ${tokenFor(riya)}`);
      expect(res.status).toBe(200);
      expect(res.body.data.test.questions).toBeUndefined();
      expect(res.body.data.test.questionCount).toBe(1);
      expect(res.body.data.startedAt).toBeNull();
      expect(JSON.stringify(res.body)).not.toContain('Sort the list');
      const attempt = await db.collection(COLLECTIONS.ATTEMPTS).doc(`${testId}_${riya.uid}`).get();
      expect(attempt.exists).toBe(false);
    });

    it('refuses entry to a student who was not added', async () => {
      const testId = await seedTest(-5, 60);
      const res = await request(app).get(`/api/tests/${testId}/entry`).set('Authorization', `Bearer ${tokenFor(kabir)}`);
      expect(res.status).toBe(403);
    });
  });

  describe('exam timer', () => {
    it('latches startedAt on first entry; a reload returns the same start', async () => {
      await db.collection(COLLECTIONS.CLASSROOMS).doc(classroomId).update({ students: [riya.uid] });
      const testId = await seedTest(-5, 60);
      const enter = () =>
        request(app).get(`/api/tests/${testId}/entry`).set('Authorization', `Bearer ${tokenFor(riya)}`);
      const first = await enter();
      const second = await enter();
      expect(first.body.data.startedAt).toBeTruthy();
      expect(second.body.data.startedAt).toBe(first.body.data.startedAt);
      expect(Date.parse(first.body.data.deadline)).toBeGreaterThan(Date.parse(first.body.data.startedAt));
    });

    it('refuses a submit after the personal allowance, even inside the window', async () => {
      await db.collection(COLLECTIONS.CLASSROOMS).doc(classroomId).update({ students: [riya.uid] });
      const testId = await seedTest(-120, 60); // window still open...
      await db
        .collection(COLLECTIONS.ATTEMPTS)
        .doc(`${testId}_${riya.uid}`)
        .set({ testId, studentId: riya.uid, startedAt: admin.firestore.Timestamp.fromDate(minutesFromNow(-90)) }); // ...but 30 min used up long ago

      const res = await request(app)
        .post('/api/submissions')
        .set('Authorization', `Bearer ${tokenFor(riya)}`)
        .send({ testId, answers: { language: 'python', code: 'print(1)' } });
      expect(res.status).toBe(403);
    });
  });

  describe('grading and results', () => {
    it('withholds marks until release, then locks grading', async () => {
      await db.collection(COLLECTIONS.CLASSROOMS).doc(classroomId).update({ students: [riya.uid, kabir.uid] });
      const testId = await seedTest(-5, 60);
      await request(app)
        .post('/api/submissions')
        .set('Authorization', `Bearer ${tokenFor(riya)}`)
        .send({ testId, answers: { language: 'python', code: 'print(sorted(input().split()))' } });

      const list = await request(app)
        .get(`/api/submissions/test/${testId}`)
        .set('Authorization', `Bearer ${tokenFor(teacher)}`);
      expect(list.status).toBe(200);
      const states = Object.fromEntries(list.body.data.submissions.map((s: any) => [s.studentId, s.state]));
      expect(states).toEqual({ [riya.uid]: 'SUBMITTED', [kabir.uid]: 'NOT_SUBMITTED' });

      const graded = await request(app)
        .put(`/api/submissions/test/${testId}/${riya.uid}/review`)
        .set('Authorization', `Bearer ${tokenFor(teacher)}`)
        .send({ marks: 8, comment: 'Good' });
      expect(graded.status).toBe(200);

      const before = await request(app).get(`/api/tests/${testId}/result`).set('Authorization', `Bearer ${tokenFor(riya)}`);
      expect(before.body.data).toMatchObject({ marksReleased: false, marks: null, comment: '' });

      await request(app).post(`/api/tests/${testId}/release`).set('Authorization', `Bearer ${tokenFor(teacher)}`);

      const after = await request(app).get(`/api/tests/${testId}/result`).set('Authorization', `Bearer ${tokenFor(riya)}`);
      expect(after.body.data).toMatchObject({ marksReleased: true, marks: 8, comment: 'Good' });

      const locked = await request(app)
        .put(`/api/submissions/test/${testId}/${riya.uid}/review`)
        .set('Authorization', `Bearer ${tokenFor(teacher)}`)
        .send({ marks: 10, comment: 'changed' });
      expect(locked.status).toBe(409);

      // A student who did not submit gets 404, not a classmate's result.
      const kabirResult = await request(app).get(`/api/tests/${testId}/result`).set('Authorization', `Bearer ${tokenFor(kabir)}`);
      expect(kabirResult.status).toBe(404);
    });
  });

  describe('integrity report', () => {
    it('groups monitor flags per student for the owning teacher only', async () => {
      const testId = await seedTest(-5, 60);
      for (const flagType of [MonitorFlagType.TAB_SWITCH, MonitorFlagType.TAB_SWITCH, MonitorFlagType.PASTE_ATTEMPT]) {
        await db.collection(COLLECTIONS.MONITOR_FLAGS).add({
          testId,
          studentId: riya.uid,
          flagType,
          metadata: {},
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      const report = await request(app).get(`/api/monitor/${testId}/flags`).set('Authorization', `Bearer ${tokenFor(teacher)}`);
      expect(report.status).toBe(200);
      expect(report.body.data.students[0]).toMatchObject({
        studentId: riya.uid,
        total: 3,
        counts: { TAB_SWITCH: 2, PASTE_ATTEMPT: 1 },
      });

      const asStudent = await request(app).get(`/api/monitor/${testId}/flags`).set('Authorization', `Bearer ${tokenFor(riya)}`);
      expect(asStudent.status).toBe(403);
    });
  });

  describe('code execution', () => {
    it('reports 503 while Judge0 is not configured', async () => {
      await db.collection(COLLECTIONS.CLASSROOMS).doc(classroomId).update({ students: [riya.uid] });
      const testId = await seedTest(-5, 60);
      const res = await request(app)
        .post('/api/judge0/run')
        .set('Authorization', `Bearer ${tokenFor(riya)}`)
        .send({ testId, questionId: 'q1', code: 'print(1)', language: 'python' });
      expect(res.status).toBe(503);
    });
  });
});
