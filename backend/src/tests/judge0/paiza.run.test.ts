import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import request from 'supertest';
import { app } from '../../app';
import { COLLECTIONS } from '../../db/collections';
import { Role } from '../../types/roles';
import { generateToken } from '../helpers/auth';
import { env } from '../../config/env';
import * as paiza from '../../modules/judge0/paiza.client';

vi.mock('../../modules/judge0/paiza.client', () => ({
  runCodeOnPaiza: vi.fn(),
  PAIZA_LANGUAGE: { 71: 'python3' },
}));

const COLLEGE = 'college-PZ';
const tokenFor = (uid: string) => generateToken({ uid, email: `${uid}@t.com`, role: Role.STUDENT, collegeId: COLLEGE });

describe('Code execution via Paiza (CODE_EXECUTION_PROVIDER=paiza)', () => {
  const db = admin.firestore();
  const run = vi.mocked(paiza.runCodeOnPaiza);
  const saved = { prov: env.CODE_EXECUTION_PROVIDER };

  beforeAll(() => { env.CODE_EXECUTION_PROVIDER = 'paiza'; });
  afterAll(() => { env.CODE_EXECUTION_PROVIDER = saved.prov; });

  beforeEach(async () => {
    run.mockReset();
    await db.collection(COLLECTIONS.CLASSROOMS).doc('class-PZ').set({ collegeId: COLLEGE, students: ['s1'] });
    const now = Date.now();
    await db.collection(COLLECTIONS.TESTS).doc('test-PZ').set({
      classroomId: 'class-PZ', collegeId: COLLEGE, teacherId: 'teacher-PZ',
      startTime: admin.firestore.Timestamp.fromDate(new Date(now - 3_600_000)),
      endTime: admin.firestore.Timestamp.fromDate(new Date(now + 3_600_000)),
    });
  });

  const runReq = (body: object = { code: 'print(2+2)', languageId: 71 }) =>
    request(app).post('/api/judge0/tests/test-PZ/run').set('Authorization', `Bearer ${tokenFor('s1')}`).send(body);
  const runs = async () => (await db.collection(COLLECTIONS.JUDGE0_RUNS).get()).docs;

  it('runs code on Paiza and returns the result inline (200, DONE), recording the provider', async () => {
    run.mockResolvedValue({ status: { id: 3, description: 'Accepted' }, stdout: '4\n', stderr: null, compile_output: null, time: '0.02', memory: 1000 });
    const res = await runReq();
    expect(res.status).toBe(200);
    expect(res.body.data.result.stdout).toBe('4\n');
    expect(run).toHaveBeenCalledWith(71, 'print(2+2)', undefined);
    const [doc] = await runs();
    expect(doc.data().provider).toBe('paiza');
  });

  it('returns a generic 502 and marks the run FAILED when Paiza errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    run.mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.paiza.io'));
    const res = await runReq();
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('ENOTFOUND');
    expect((await runs())[0].data().status).toBe('FAILED');
  });
});
