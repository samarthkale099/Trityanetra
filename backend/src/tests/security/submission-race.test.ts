import { describe, it, expect } from 'vitest';
import * as admin from 'firebase-admin';
import request from 'supertest';
import { app } from '../../app';
import { COLLECTIONS } from '../../db/collections';
import { Role } from '../../types/roles';
import { generateToken } from '../helpers/auth';
import { saveAnswerService, submitExamService } from '../../modules/submission/submission.service';

const db = admin.firestore();

const seed = async (testId: string, uid: string) => {
  const hours = (h: number) => admin.firestore.Timestamp.fromDate(new Date(Date.now() + h * 3600_000));
  await db.collection(COLLECTIONS.USERS).doc(uid).set({ role: Role.STUDENT, collegeId: 'c1' });
  await db.collection(COLLECTIONS.CLASSROOMS).doc(`cls-${testId}`).set({ collegeId: 'c1', students: [uid] });
  await db.collection(COLLECTIONS.TESTS).doc(testId).set({
    classroomId: `cls-${testId}`,
    collegeId: 'c1',
    startTime: hours(-1),
    endTime: hours(1),
    questions: [],
  });
  return generateToken({ uid, email: `${uid}@x.com`, role: Role.STUDENT, collegeId: 'c1' });
};

describe('Security: submission race', () => {
  it('concurrent submits leave exactly one SUBMITTED record whose answers match exactly one request', async () => {
    const testId = 'race-1';
    const uid = 'race-student-1';
    const token = await seed(testId, uid);
    const answersList = [{ q1: 'A' }, { q1: 'B' }, { q1: 'C' }];

    const results = await Promise.all(
      answersList.map((answers) =>
        request(app).post('/api/submissions').set('Authorization', `Bearer ${token}`).send({ testId, answers })
      )
    );
    // Duplicates are answered idempotently (200); none may error or be a conflict.
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);

    const snap = await db.collection(COLLECTIONS.SUBMISSIONS).where('testId', '==', testId).get();
    expect(snap.size).toBe(1);
    expect(snap.docs[0].id).toBe(`${testId}_${uid}`);
    const data = snap.docs[0].data();
    expect(data.status).toBe('SUBMITTED');
    // The stored answers are one request's answers intact, never a merge of several.
    expect(answersList).toContainEqual(data.answers);
  }, 30000);

  it('after submission, save is rejected (403) and a repeat submit is a no-op that cannot overwrite answers', async () => {
    const testId = 'race-2';
    const uid = 'race-student-2';
    const token = await seed(testId, uid);

    const first = await request(app).post('/api/submissions').set('Authorization', `Bearer ${token}`).send({ testId, answers: { q1: 'final' } });
    expect(first.status).toBe(200);

    const save = await request(app).post('/api/submissions/save').set('Authorization', `Bearer ${token}`).send({ testId, answers: { q1: 'tampered' } });
    expect(save.status).toBe(403);

    const again = await request(app).post('/api/submissions').set('Authorization', `Bearer ${token}`).send({ testId, answers: { q1: 'tampered again' } });
    expect(again.status).toBe(403);

    const data = (await db.collection(COLLECTIONS.SUBMISSIONS).doc(`${testId}_${uid}`).get()).data()!;
    expect(data.status).toBe('SUBMITTED');
    expect(data.answers).toEqual({ q1: 'final' });
  }, 30000);

  it('a save racing a submit can never downgrade the SUBMITTED record or overwrite its answers', async () => {
    const testId = 'race-3';
    const uid = 'race-student-3';
    await seed(testId, uid);

    // Service level on purpose: this bypasses the route guard, which is the non-atomic part.
    const outcomes = await Promise.allSettled([
      submitExamService(testId, uid, { q1: 'submitted' }),
      saveAnswerService(testId, uid, { q1: 'draft-1' }),
      saveAnswerService(testId, uid, { q1: 'draft-2' }),
    ]);

    // The submit itself must succeed; any save that lost the race must fail with 403, never silently apply.
    expect(outcomes[0].status).toBe('fulfilled');
    for (const o of outcomes.slice(1)) {
      if (o.status === 'rejected') expect((o.reason as any).status).toBe(403);
    }

    const data = (await db.collection(COLLECTIONS.SUBMISSIONS).doc(`${testId}_${uid}`).get()).data()!;
    expect(data.status).toBe('SUBMITTED');
    expect(data.answers).toEqual({ q1: 'submitted' });
  }, 40000);

  it('saveAnswerService refuses to write over a SUBMITTED record even when the route guard is bypassed', async () => {
    const testId = 'race-4';
    const uid = 'race-student-4';
    await seed(testId, uid);
    await submitExamService(testId, uid, { q1: 'final' });

    await expect(saveAnswerService(testId, uid, { q1: 'late edit' })).rejects.toMatchObject({ status: 403 });

    const data = (await db.collection(COLLECTIONS.SUBMISSIONS).doc(`${testId}_${uid}`).get()).data()!;
    expect(data.status).toBe('SUBMITTED');
    expect(data.answers).toEqual({ q1: 'final' });
  }, 30000);

  it('a FINALIZED record is locked too: save and submit cannot downgrade it, at service and HTTP level', async () => {
    const testId = 'race-5';
    const uid = 'race-student-5';
    const token = await seed(testId, uid);
    const ref = db.collection(COLLECTIONS.SUBMISSIONS).doc(`${testId}_${uid}`);
    await ref.set({ testId, studentId: uid, answers: { q1: 'graded' }, status: 'FINALIZED' });

    await expect(saveAnswerService(testId, uid, { q1: 'x' })).rejects.toMatchObject({ status: 403 });
    await expect(submitExamService(testId, uid, { q1: 'x' })).rejects.toThrow('ALREADY_SUBMITTED');

    const save = await request(app).post('/api/submissions/save').set('Authorization', `Bearer ${token}`).send({ testId, answers: { q1: 'x' } });
    const submit = await request(app).post('/api/submissions').set('Authorization', `Bearer ${token}`).send({ testId, answers: { q1: 'x' } });
    expect(save.status).toBe(403);
    expect(submit.status).toBe(403);

    const data = (await ref.get()).data()!;
    expect(data.status).toBe('FINALIZED');
    expect(data.answers).toEqual({ q1: 'graded' });
  }, 30000);
});
