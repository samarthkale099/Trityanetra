import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import request from 'supertest';
import { app } from '../../app';
import { COLLECTIONS } from '../../db/collections';
import { Role } from '../../types/roles';
import { generateToken } from '../helpers/auth';
import { env } from '../../config/env';
import * as piston from '../../modules/judge0/piston.client';

vi.mock('../../modules/judge0/piston.client', () => ({
  runCodeOnPiston: vi.fn(),
  PISTON_LANGUAGE: { 71: 'python' },
}));

const COLLEGE = 'college-P';
const tokenFor = (uid: string) => generateToken({ uid, email: `${uid}@t.com`, role: Role.STUDENT, collegeId: COLLEGE });

describe('Code execution via Piston (default provider)', () => {
  const db = admin.firestore();
  const run = vi.mocked(piston.runCodeOnPiston);
  const saved = {
    prov: env.CODE_EXECUTION_PROVIDER, url: env.JUDGE0_API_URL, key: env.JUDGE0_API_KEY,
    tok: env.JUDGE0_CALLBACK_TOKEN, base: env.JUDGE0_CALLBACK_BASE_URL,
  };

  beforeAll(() => {
    // No Judge0 config at all -> provider defaults to Piston.
    env.CODE_EXECUTION_PROVIDER = undefined;
    env.JUDGE0_API_URL = undefined; env.JUDGE0_API_KEY = undefined;
    env.JUDGE0_CALLBACK_TOKEN = undefined; env.JUDGE0_CALLBACK_BASE_URL = undefined;
  });
  afterAll(() => {
    env.CODE_EXECUTION_PROVIDER = saved.prov; env.JUDGE0_API_URL = saved.url; env.JUDGE0_API_KEY = saved.key;
    env.JUDGE0_CALLBACK_TOKEN = saved.tok; env.JUDGE0_CALLBACK_BASE_URL = saved.base;
  });

  beforeEach(async () => {
    run.mockReset();
    await db.collection(COLLECTIONS.CLASSROOMS).doc('class-P').set({ collegeId: COLLEGE, students: ['s1'] });
    const now = Date.now();
    await db.collection(COLLECTIONS.TESTS).doc('test-P').set({
      classroomId: 'class-P', collegeId: COLLEGE, teacherId: 'teacher-P',
      startTime: admin.firestore.Timestamp.fromDate(new Date(now - 3_600_000)),
      endTime: admin.firestore.Timestamp.fromDate(new Date(now + 3_600_000)),
    });
  });

  const runReq = (body: object = { code: 'print(1+1)', languageId: 71 }) =>
    request(app).post('/api/judge0/tests/test-P/run').set('Authorization', `Bearer ${tokenFor('s1')}`).send(body);
  const runs = async () => (await db.collection(COLLECTIONS.JUDGE0_RUNS).get()).docs;

  it('runs code on Piston and returns the result inline (200, DONE), recording the provider', async () => {
    run.mockResolvedValue({ status: { id: 3, description: 'Accepted' }, stdout: '2\n', stderr: null, compile_output: null, time: null, memory: null });
    const res = await runReq();
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('DONE');
    expect(res.body.data.result.stdout).toBe('2\n');
    expect(run).toHaveBeenCalledWith(71, 'print(1+1)', undefined);
    const [doc] = await runs();
    expect(doc.data().provider).toBe('piston');
    expect(doc.data().status).toBe('DONE');
  });

  it('owner can read the Piston result; it needs no Judge0 key', async () => {
    run.mockResolvedValue({ status: { id: 11, description: 'Runtime Error (NZEC)' }, stdout: '', stderr: 'err', compile_output: null, time: null, memory: null });
    const runId = (await runReq()).body.data.runId;
    const got = await request(app).get(`/api/judge0/runs/${runId}`).set('Authorization', `Bearer ${tokenFor('s1')}`);
    expect(got.body.data.result.stderr).toBe('err');
  });

  it('when Piston fails: 502 with a generic message and the run is FAILED', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    run.mockRejectedValue(new Error('getaddrinfo ENOTFOUND emkc.org'));
    const res = await runReq();
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('ENOTFOUND');
    const [doc] = await runs();
    expect(doc.data().status).toBe('FAILED');
  });

  it('still rejects an unsupported language before calling Piston (400)', async () => {
    const res = await runReq({ code: 'x', languageId: 999 });
    expect(res.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });
});
