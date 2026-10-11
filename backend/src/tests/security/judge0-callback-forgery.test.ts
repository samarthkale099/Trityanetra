import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { judge0Callback } from '../../modules/judge0/judge0.callback.controller';
import { errorHandler } from '../../middleware/errorHandler';
import { env } from '../../config/env';

// The callback route is not mounted in app.ts yet, so the controller is exercised
// on a minimal express app. The signing scheme is still an open question with the team
// (the controller has a TODO), so this covers the shared-token check that exists today.
const makeApp = () => {
  const a = express();
  a.use(express.json());
  a.post('/judge0/callback', judge0Callback);
  a.use(errorHandler);
  return a;
};

describe('Security: Judge0 callback forgery', () => {
  const original = env.JUDGE0_CALLBACK_TOKEN;
  beforeAll(() => {
    env.JUDGE0_CALLBACK_TOKEN = 'correct-callback-token';
  });
  afterAll(() => {
    env.JUDGE0_CALLBACK_TOKEN = original;
  });

  it('rejects a callback with no token header (401)', async () => {
    const res = await request(makeApp()).post('/judge0/callback').send({ status: 'done' });
    expect(res.status).toBe(401);
  });

  it('rejects an empty token header (401)', async () => {
    const res = await request(makeApp()).post('/judge0/callback').set('X-Judge0-Token', '').send({});
    expect(res.status).toBe(401);
  });

  it.each(['wrong-token', 'CORRECT-CALLBACK-TOKEN', 'correct-callback-toke', 'undefined', 'null'])(
    'rejects wrong token %j (401)',
    async (tok) => {
      const res = await request(makeApp()).post('/judge0/callback').set('X-Judge0-Token', tok).send({});
      expect(res.status).toBe(401);
    }
  );

  it('does not accept the token via query string or body instead of the header', async () => {
    const res = await request(makeApp())
      .post('/judge0/callback?x-judge0-token=correct-callback-token')
      .send({ 'x-judge0-token': 'correct-callback-token' });
    expect(res.status).toBe(401);
  });

  it('when no callback token is configured, rejects every request rather than failing open', async () => {
    env.JUDGE0_CALLBACK_TOKEN = undefined;
    try {
      for (const header of [undefined, '', 'undefined', 'anything']) {
        const r = request(makeApp()).post('/judge0/callback');
        if (header !== undefined) r.set('X-Judge0-Token', header);
        const res = await r.send({});
        expect(res.status, `header=${String(header)}`).toBe(401);
      }
    } finally {
      env.JUDGE0_CALLBACK_TOKEN = 'correct-callback-token';
    }
  });

  it('a correct token passes the auth check (the stub then fails because Judge0 is not configured)', async () => {
    const res = await request(makeApp()).post('/judge0/callback').set('X-Judge0-Token', 'correct-callback-token').send({});
    expect(res.status).not.toBe(401);
  });

  // Blocked on the real signing scheme (open question with the Judge0 account owner).
  it.todo('rejects replayed callbacks (needs the signing/nonce scheme)');
  it.todo('ignores callbacks for submissions that are not awaiting a result');
});
