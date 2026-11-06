import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import request from 'supertest';
import { app } from '../../app';
import { COLLECTIONS } from '../../db/collections';
import { Role } from '../../types/roles';
import { generateToken } from '../helpers/auth';
import { env } from '../../config/env';
import * as client from '../../modules/judge0/judge0.client';

vi.mock('../../modules/judge0/judge0.client', () => ({
  submitCodeToJudge0: vi.fn(),
  runCodeToJudge0Sync: vi.fn(),
  getJudge0Submission: vi.fn(),
}));

const COLLEGE = 'college-A';
const tokenFor = (uid: string, role: Role = Role.STUDENT) =>
  generateToken({ uid, email: `${uid}@test.com`, role, collegeId: COLLEGE });

describe('Judge0: running code for a test', () => {
  const db = admin.firestore();
  const submit = vi.mocked(client.submitCodeToJudge0);
  const saved = {
    url: env.JUDGE0_API_URL, key: env.JUDGE0_API_KEY, tok: env.JUDGE0_CALLBACK_TOKEN, base: env.JUDGE0_CALLBACK_BASE_URL,
  };

  beforeAll(() => {
    env.JUDGE0_API_URL = 'https://judge0.example.com';
    env.JUDGE0_API_KEY = 'judge0-key';
    env.JUDGE0_CALLBACK_TOKEN = 'cb-secret';
    env.JUDGE0_CALLBACK_BASE_URL = 'https://api.example.com/';
  });
  afterAll(() => {
    env.JUDGE0_API_URL = saved.url;
    env.JUDGE0_API_KEY = saved.key;
    env.JUDGE0_CALLBACK_TOKEN = saved.tok;
    env.JUDGE0_CALLBACK_BASE_URL = saved.base;
  });

  const seedTest = async (testId: string, startOffsetMs: number, endOffsetMs: number) => {
    const now = Date.now();
    await db.collection(COLLECTIONS.TESTS).doc(testId).set({
      classroomId: 'class-1',
      collegeId: COLLEGE,
      teacherId: 'teacher-1',
      startTime: admin.firestore.Timestamp.fromDate(new Date(now + startOffsetMs)),
      endTime: admin.firestore.Timestamp.fromDate(new Date(now + endOffsetMs)),
    });
  };

  beforeEach(async () => {
    submit.mockReset();
    submit.mockResolvedValue({ token: 'jt-1' });
    await db.collection(COLLECTIONS.CLASSROOMS).doc('class-1').set({ collegeId: COLLEGE, students: ['s1', 's3', 's-rate'] });
    await seedTest('test-open', -3_600_000, 3_600_000);
    await seedTest('test-future', 3_600_000, 7_200_000);
    await seedTest('test-ended', -7_200_000, -3_600_000);
  });

  const run = (uid: string, testId: string, body: object = { code: 'print(1)', languageId: 71, stdin: '1' }) =>
    request(app).post(`/api/judge0/tests/${testId}/run`).set('Authorization', `Bearer ${tokenFor(uid)}`).send(body);
  const runs = async () => (await db.collection(COLLECTIONS.JUDGE0_RUNS).get()).docs;

  it('starts a run: creates a PENDING record first, then submits with a callback url carrying the run id', async () => {
    const res = await run('s1', 'test-open');
    expect(res.status).toBe(202);
    const { runId } = res.body.data;
    expect(res.body.data.status).toBe('PENDING');

    const doc = (await db.collection(COLLECTIONS.JUDGE0_RUNS).doc(runId).get()).data();
    expect(doc).toMatchObject({ status: 'PENDING', userId: 's1', testId: 'test-open', languageId: 71, judge0Token: 'jt-1' });

    expect(submit).toHaveBeenCalledTimes(1);
    const [code, lang, options] = submit.mock.calls[0] as [string, number, { stdin?: string; callbackUrl?: string }];
    expect(code).toBe('print(1)');
    expect(lang).toBe(71);
    expect(options.stdin).toBe('1');
    expect(options.callbackUrl).toBe(`https://api.example.com/api/judge0/callback/cb-secret?run=${runId}`);
  });

  it('end to end: the callback completes the run, and only its owner can read the result', async () => {
    const { runId } = (await run('s1', 'test-open')).body.data;

    const cb = await request(app)
      .put(`/api/judge0/callback/cb-secret?run=${runId}`)
      .send({ token: 'jt-1', status: { id: 3, description: 'Accepted' }, stdout: '1\n', time: '0.02', memory: 900 });
    expect(cb.body.applied).toBe(true);

    const own = await request(app).get(`/api/judge0/runs/${runId}`).set('Authorization', `Bearer ${tokenFor('s1')}`);
    expect(own.status).toBe(200);
    expect(own.body.data.status).toBe('DONE');
    expect(own.body.data.result.stdout).toBe('1\n');

    const other = await request(app).get(`/api/judge0/runs/${runId}`).set('Authorization', `Bearer ${tokenFor('s3')}`);
    expect(other.status).toBe(404);
    const missing = await request(app).get('/api/judge0/runs/doesnotexist').set('Authorization', `Bearer ${tokenFor('s1')}`);
    expect(missing.status).toBe(404);
    const anon = await request(app).get(`/api/judge0/runs/${runId}`);
    expect(anon.status).toBe(401);
  });

  it('requires a login', async () => {
    const res = await request(app).post('/api/judge0/tests/test-open/run').send({ code: 'x', languageId: 71 });
    expect(res.status).toBe(401);
    expect(submit).not.toHaveBeenCalled();
  });

  it('refuses a student who is not in the test classroom (403) and runs nothing', async () => {
    const res = await run('outsider', 'test-open');
    expect(res.status).toBe(403);
    expect(submit).not.toHaveBeenCalled();
    expect(await runs()).toHaveLength(0);
  });

  it.each([['test-future'], ['test-ended']])('refuses a run outside the test window: %s (403)', async (testId) => {
    const res = await run('s1', testId);
    expect(res.status).toBe(403);
    expect(submit).not.toHaveBeenCalled();
  });

  it('refuses an unknown test (404) and a teacher (403)', async () => {
    expect((await run('s1', 'no-such-test')).status).toBe(404);
    const teacher = await request(app)
      .post('/api/judge0/tests/test-open/run')
      .set('Authorization', `Bearer ${tokenFor('teacher-1', Role.TEACHER)}`)
      .send({ code: 'x', languageId: 71 });
    expect(teacher.status).toBe(403);
  });

  it.each([
    ['no code', { languageId: 71 }],
    ['empty code', { code: '', languageId: 71 }],
    ['a non-integer language', { code: 'x', languageId: '71' }],
    ['an unsupported language', { code: 'x', languageId: 999 }],
    ['oversized source', { code: 'x'.repeat(70 * 1024), languageId: 71 }],
    ['oversized stdin', { code: 'x', languageId: 71, stdin: 'y'.repeat(20 * 1024) }],
  ])('rejects %s (400): nothing is created or submitted', async (_name, body) => {
    const res = await run('s3', 'test-open', body); // own user: keeps s1 well under the rate limit
    expect(res.status).toBe(400);
    expect(submit).not.toHaveBeenCalled();
    expect(await runs()).toHaveLength(0);
  });

  it('answers 503 and creates nothing when the Judge0 provider is selected but not configured', async () => {
    const originalKey = env.JUDGE0_API_KEY;
    const originalProvider = env.CODE_EXECUTION_PROVIDER;
    // Force Judge0 (so it does not silently fall back to Piston) with no key -> not configured.
    env.CODE_EXECUTION_PROVIDER = 'judge0';
    env.JUDGE0_API_KEY = undefined;
    try {
      const res = await run('s1', 'test-open');
      expect(res.status).toBe(503);
      expect(submit).not.toHaveBeenCalled();
      expect(await runs()).toHaveLength(0);
    } finally {
      env.JUDGE0_API_KEY = originalKey;
      env.CODE_EXECUTION_PROVIDER = originalProvider;
    }
  });

  it('when Judge0 fails: 502 with a generic message, and the run is closed as FAILED (never left PENDING)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    submit.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:2358 secret-internal-detail'));
    const res = await run('s1', 'test-open');
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.5');
    const [doc] = await runs();
    expect(doc.data().status).toBe('FAILED');
  });

  it('rate limits runs per user (429 after 10 in a minute)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await run('s-rate', 'test-open')).status);
    expect(statuses.slice(0, 10).every((s) => s === 202)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe('Judge0: synchronous mode (no public callback URL)', () => {
  const db = admin.firestore();
  const runSync = vi.mocked(client.runCodeToJudge0Sync);
  const submit = vi.mocked(client.submitCodeToJudge0);
  const saved = { url: env.JUDGE0_API_URL, key: env.JUDGE0_API_KEY, tok: env.JUDGE0_CALLBACK_TOKEN, base: env.JUDGE0_CALLBACK_BASE_URL };

  beforeAll(() => {
    env.JUDGE0_API_URL = 'https://judge0-ce.p.rapidapi.com';
    env.JUDGE0_API_KEY = 'rapid-key';
    // No callback token/base URL -> the service runs synchronously.
    env.JUDGE0_CALLBACK_TOKEN = undefined;
    env.JUDGE0_CALLBACK_BASE_URL = undefined;
  });
  afterAll(() => {
    env.JUDGE0_API_URL = saved.url; env.JUDGE0_API_KEY = saved.key;
    env.JUDGE0_CALLBACK_TOKEN = saved.tok; env.JUDGE0_CALLBACK_BASE_URL = saved.base;
  });

  beforeEach(async () => {
    runSync.mockReset();
    submit.mockReset();
    await db.collection(COLLECTIONS.CLASSROOMS).doc('class-1').set({ collegeId: COLLEGE, students: ['s1'] });
    const now = Date.now();
    await db.collection(COLLECTIONS.TESTS).doc('test-open').set({
      classroomId: 'class-1', collegeId: COLLEGE, teacherId: 'teacher-1',
      startTime: admin.firestore.Timestamp.fromDate(new Date(now - 3_600_000)),
      endTime: admin.firestore.Timestamp.fromDate(new Date(now + 3_600_000)),
    });
  });

  const runReq = (body: object = { code: 'print(1)', languageId: 71 }) =>
    request(app).post('/api/judge0/tests/test-open/run').set('Authorization', `Bearer ${tokenFor('s1')}`).send(body);
  const runs = async () => (await db.collection(COLLECTIONS.JUDGE0_RUNS).get()).docs;

  it('returns the finished result inline (200) and stores the run as DONE, without using the callback path', async () => {
    runSync.mockResolvedValue({ status: { id: 3, description: 'Accepted' }, stdout: '1\n', stderr: null, time: '0.01', memory: 800, token: 'jt-sync' });
    const res = await runReq();
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('DONE');
    expect(res.body.data.result.statusId).toBe(3);
    expect(res.body.data.result.stdout).toBe('1\n');
    expect(submit).not.toHaveBeenCalled();

    const [doc] = await runs();
    expect(doc.data().status).toBe('DONE');
    expect(doc.data().result.stdout).toBe('1\n');
    expect(doc.data().judge0Token).toBe('jt-sync');
  });

  it('the stored result is readable by its owner via GET /runs/:runId', async () => {
    runSync.mockResolvedValue({ status: { id: 6, description: 'Compilation Error' }, stdout: null, compile_output: 'boom', token: 't' });
    const runId = (await runReq({ code: 'bad', languageId: 71 })).body.data.runId;
    const got = await request(app).get(`/api/judge0/runs/${runId}`).set('Authorization', `Bearer ${tokenFor('s1')}`);
    expect(got.status).toBe(200);
    expect(got.body.data.result.compileOutput).toBe('boom');
  });

  it('when Judge0 fails: 502 with a generic message and the run is closed as FAILED', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    runSync.mockRejectedValue(new Error('connect ECONNREFUSED 10.9.9.9 secret-detail'));
    const res = await runReq();
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('10.9.9.9');
    const [doc] = await runs();
    expect(doc.data().status).toBe('FAILED');
  });
});
