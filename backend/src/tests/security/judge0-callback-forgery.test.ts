import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { judge0Callback } from '../../modules/judge0/judge0.callback.controller';
import { verifyCallbackToken } from '../../modules/judge0/judge0.callbackToken';
import { errorHandler } from '../../middleware/errorHandler';
import { env } from '../../config/env';
import { db } from '../../db/firestore';
import { COLLECTIONS } from '../../db/collections';
import { app as realApp } from '../../app';

// Judge0 does not sign callbacks, so the secret travels in the callback URL:
//   /judge0/callback/<JUDGE0_CALLBACK_TOKEN>
const TOKEN = 'correct-callback-token';

const makeApp = () => {
  const a = express();
  a.use(express.json());
  a.put('/judge0/callback/:token', judge0Callback);
  a.post('/judge0/callback/:token', judge0Callback);
  a.use(errorHandler);
  return a;
};

const body = (over: Record<string, unknown> = {}) => ({
  token: 'run-1',
  status: { id: 3, description: 'Accepted' },
  stdout: 'hello\n',
  stderr: null,
  compile_output: null,
  time: '0.01',
  memory: 1024,
  ...over,
});

const seedRun = (id = 'run-1', status = 'PENDING') =>
  db.collection(COLLECTIONS.JUDGE0_RUNS).doc(id).set({ status, submissionId: 's1' });
const getRun = async (id = 'run-1') => (await db.collection(COLLECTIONS.JUDGE0_RUNS).doc(id).get()).data();

describe('Security: Judge0 callback forgery', () => {
  const original = env.JUDGE0_CALLBACK_TOKEN;
  beforeAll(() => {
    env.JUDGE0_CALLBACK_TOKEN = TOKEN;
  });
  afterAll(() => {
    env.JUDGE0_CALLBACK_TOKEN = original;
  });

  describe('token check', () => {
    it.each(['wrong-token', 'CORRECT-CALLBACK-TOKEN', 'correct-callback-toke', 'correct-callback-token2', 'undefined', 'null', 'x'])(
      'rejects wrong URL token %j (401), whatever its length',
      async (tok) => {
        await seedRun();
        const res = await request(makeApp()).put(`/judge0/callback/${encodeURIComponent(tok)}`).send(body());
        expect(res.status).toBe(401);
        expect((await getRun())?.status).toBe('PENDING');
      }
    );

    it('does not accept the correct token from a header, query string or body when the URL token is wrong', async () => {
      await seedRun();
      const res = await request(makeApp())
        .put(`/judge0/callback/wrong?token=${TOKEN}`)
        .set('X-Judge0-Token', TOKEN)
        .send({ ...body(), 'x-judge0-token': TOKEN });
      expect(res.status).toBe(401);
      expect((await getRun())?.status).toBe('PENDING');
    });

    it('when no callback token is configured, rejects every request rather than failing open', async () => {
      env.JUDGE0_CALLBACK_TOKEN = undefined;
      try {
        for (const tok of ['undefined', 'null', 'anything', TOKEN]) {
          const res = await request(makeApp()).put(`/judge0/callback/${tok}`).send(body());
          expect(res.status, `token=${tok}`).toBe(401);
        }
        env.JUDGE0_CALLBACK_TOKEN = '';
        const res = await request(makeApp()).put('/judge0/callback/x').send(body());
        expect(res.status).toBe(401);
      } finally {
        env.JUDGE0_CALLBACK_TOKEN = TOKEN;
      }
    });

    it('verifyCallbackToken is exact-match only and never throws on odd input', () => {
      expect(verifyCallbackToken(TOKEN, TOKEN)).toBe(true);
      for (const bad of [undefined, null, '', 5, {}, [], 'a', TOKEN + ' ', ' ' + TOKEN]) {
        expect(verifyCallbackToken(bad, TOKEN)).toBe(false);
      }
      expect(verifyCallbackToken(TOKEN, undefined)).toBe(false);
      expect(verifyCallbackToken('', '')).toBe(false);
    });

    it('is mounted at /api/judge0/callback/:token on the real app, with no JWT required', async () => {
      const bad = await request(realApp).put('/api/judge0/callback/not-the-token').send(body());
      expect(bad.status).toBe(401);
      await seedRun();
      const good = await request(realApp).put(`/api/judge0/callback/${TOKEN}`).send(body());
      expect(good.status).toBe(200);
      expect((await getRun())?.status).toBe('DONE');
    });
  });

  describe('accepted callbacks', () => {
    it.each(['put', 'post'] as const)('a correct token completes a pending run (%s)', async (method) => {
      await seedRun();
      const res = await request(makeApp())[method](`/judge0/callback/${TOKEN}`).send(body());
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: true, applied: true });
      const run = await getRun();
      expect(run?.status).toBe('DONE');
      expect(run?.result.statusId).toBe(3);
      expect(run?.result.stdout).toBe('hello\n');
    });

    it.each([
      ['a missing judge0 token', { token: undefined }],
      ['a token that could be a path', { token: '../users/x' }],
      ['a missing status', { status: undefined }],
      ['a non-numeric status id', { status: { id: 'three' } }],
    ])('rejects a malformed body: %s (400) and writes nothing', async (_name, over) => {
      await seedRun();
      const res = await request(makeApp()).put(`/judge0/callback/${TOKEN}`).send(body(over));
      expect(res.status).toBe(400);
      expect((await getRun())?.status).toBe('PENDING');
    });
  });

  describe('replay and state', () => {
    it('rejects a replayed callback: the first stored result is never overwritten', async () => {
      await seedRun();
      const first = await request(makeApp()).put(`/judge0/callback/${TOKEN}`).send(body());
      expect(first.body.applied).toBe(true);

      const replay = await request(makeApp())
        .put(`/judge0/callback/${TOKEN}`)
        .send(body({ status: { id: 4, description: 'Wrong Answer' }, stdout: 'forged' }));
      expect(replay.status).toBe(200);
      expect(replay.body.applied).toBe(false);

      const run = await getRun();
      expect(run?.result.statusId).toBe(3);
      expect(run?.result.stdout).toBe('hello\n');
    });

    it('two concurrent callbacks for one run apply exactly once', async () => {
      await seedRun();
      const [a, b] = await Promise.all([
        request(makeApp()).put(`/judge0/callback/${TOKEN}`).send(body({ stdout: 'A' })),
        request(makeApp()).put(`/judge0/callback/${TOKEN}`).send(body({ stdout: 'B' })),
      ]);
      expect([a.body.applied, b.body.applied].filter(Boolean)).toHaveLength(1);
      expect(['A', 'B']).toContain((await getRun())?.result.stdout);
    });

    it('ignores callbacks for runs that are not awaiting a result', async () => {
      await seedRun('run-done', 'DONE');
      const res = await request(makeApp()).put(`/judge0/callback/${TOKEN}`).send(body({ token: 'run-done' }));
      expect(res.status).toBe(200);
      expect(res.body.applied).toBe(false);
      expect((await getRun('run-done'))?.result).toBeUndefined();
    });

    it('ignores a callback for an unknown run and does not create one', async () => {
      const res = await request(makeApp()).put(`/judge0/callback/${TOKEN}`).send(body({ token: 'nope' }));
      expect(res.status).toBe(200);
      expect(res.body.applied).toBe(false);
      expect((await db.collection(COLLECTIONS.JUDGE0_RUNS).doc('nope').get()).exists).toBe(false);
    });

    it.each([1, 2])('ignores non-final status %i (in queue / processing) and keeps the run pending', async (id) => {
      await seedRun();
      const res = await request(makeApp()).put(`/judge0/callback/${TOKEN}`).send(body({ status: { id } }));
      expect(res.body.applied).toBe(false);
      expect((await getRun())?.status).toBe('PENDING');
    });
  });
});
