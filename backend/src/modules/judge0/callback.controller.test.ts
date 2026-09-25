import request from 'supertest';
import express from 'express';
import crypto from 'crypto';
import { env } from '../../config/env';
import router, { judge0CallbackBodyParser } from './callback.controller';
import { JUDGE0_BOUNDS } from '../../config/constants';

// Shared spy so tests can assert whether the callback was processed (stored).
const mockDocSet = jest.fn().mockResolvedValue(undefined);

jest.mock('../../db/firestore', () => ({
  getFirestore: () => ({
    collection: jest.fn().mockReturnValue({
      doc: jest.fn().mockReturnValue({
        set: (data: unknown) => mockDocSet(data),
      }),
    }),
  }),
}));

const CALLBACK_SECRET = 'test-callback-secret';

function sign(body: unknown, key: string = CALLBACK_SECRET): string {
  return crypto.createHmac('sha256', key).update(JSON.stringify(body)).digest('hex');
}

const validBody = {
  token: 'valid-token-123',
  stdout: 'hello\n',
  stderr: null,
  compile_output: null,
  status: { id: 3, description: 'Accepted' },
  time: '0.01',
  memory: 1024,
};

describe('Judge0 Callback Controller', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    // Mirror app.ts wiring: raw-body capture scoped to the callback route
    // runs before any other body parsing (the global express.json below
    // skips bodies this parser already consumed).
    app.use('/api/judge0/callback', judge0CallbackBodyParser);
    app.use(express.json());
    app.use('/api/judge0', router);
    (env as any).JUDGE0_API_KEY = CALLBACK_SECRET;
  });

  afterAll(() => {
    (env as any).JUDGE0_API_KEY = '';
  });

  beforeEach(() => {
    mockDocSet.mockClear();
  });

  describe('Happy path (authenticated)', () => {
    it('should accept a valid, correctly signed callback', async () => {
      const response = await request(app)
        .post('/api/judge0/callback')
        .set('x-judge0-signature', sign(validBody))
        .send(validBody);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Callback processed');
      expect(mockDocSet).toHaveBeenCalledTimes(1);
    });

    it('should process a payload with unexpected extra fields (ignored, not rejected)', async () => {
      const body = { ...validBody, unexpectedField: 'value', anotherField: 123 };
      const response = await request(app)
        .post('/api/judge0/callback')
        .set('x-judge0-signature', sign(body))
        .send(body);

      expect(response.status).toBe(200);
      expect(mockDocSet).toHaveBeenCalledTimes(1);
    });

    it('should be idempotent on retry: same token stores under the same document key', async () => {
      const sig = sign(validBody);
      const first = await request(app)
        .post('/api/judge0/callback')
        .set('x-judge0-signature', sig)
        .send(validBody);
      const second = await request(app)
        .post('/api/judge0/callback')
        .set('x-judge0-signature', sig)
        .send(validBody);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      // Both writes target the token-keyed document — retry cannot create a duplicate state
      const tokens = mockDocSet.mock.calls.map((c) => (c[0] as any).token);
      expect(tokens).toEqual(['valid-token-123', 'valid-token-123']);
    });
  });

  describe('Rule 6: callback authentication — forged callbacks rejected', () => {
    it('should return 401 when the signature header is missing', async () => {
      const response = await request(app)
        .post('/api/judge0/callback')
        .send(validBody);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
      expect(mockDocSet).not.toHaveBeenCalled();
    });

    it('should return 401 for a signature computed with the wrong key', async () => {
      const response = await request(app)
        .post('/api/judge0/callback')
        .set('x-judge0-signature', sign(validBody, 'wrong-key'))
        .send(validBody);

      expect(response.status).toBe(401);
      expect(mockDocSet).not.toHaveBeenCalled();
    });

    it('should return 401 when the payload was tampered after signing', async () => {
      const response = await request(app)
        .post('/api/judge0/callback')
        .set('x-judge0-signature', sign(validBody))
        .send({ ...validBody, status: { id: 1, description: 'In Queue' }, stdout: 'tampered' });

      expect(response.status).toBe(401);
      expect(mockDocSet).not.toHaveBeenCalled();
    });

    it('should return 401 for a non-hex signature', async () => {
      const response = await request(app)
        .post('/api/judge0/callback')
        .set('x-judge0-signature', 'not-a-hex-signature!!')
        .send(validBody);

      expect(response.status).toBe(401);
      expect(mockDocSet).not.toHaveBeenCalled();
    });

    it('should reject a forged AND malformed callback with 401 (auth runs before payload validation)', async () => {
      const response = await request(app)
        .post('/api/judge0/callback')
        .set('x-judge0-signature', 'deadbeef')
        .send({ totally: 'malformed' });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
      expect(mockDocSet).not.toHaveBeenCalled();
    });
  });

  describe('Rule 6: fail closed when no secret is configured', () => {
    afterAll(() => {
      // Restore for any subsequent describes in this file
      (env as any).JUDGE0_API_KEY = CALLBACK_SECRET;
    });

    it('should reject callbacks with 401 when JUDGE0_API_KEY is not configured', async () => {
      (env as any).JUDGE0_API_KEY = '';

      const response = await request(app)
        .post('/api/judge0/callback')
        .set('x-judge0-signature', sign(validBody))
        .send(validBody);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
      expect(mockDocSet).not.toHaveBeenCalled();
    });

    it('should still reject even without any signature header when unconfigured', async () => {
      (env as any).JUDGE0_API_KEY = '';

      const response = await request(app)
        .post('/api/judge0/callback')
        .send(validBody);

      expect(response.status).toBe(401);
      expect(mockDocSet).not.toHaveBeenCalled();
    });
  });

  describe('Payload validation before processing (authenticated)', () => {
    it('should return 400 for empty body without processing', async () => {
      const body: any = {};
      const response = await request(app)
        .post('/api/judge0/callback')
        .set('x-judge0-signature', sign(body))
        .send(body);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_PAYLOAD');
      expect(mockDocSet).not.toHaveBeenCalled();
    });

    it('should return 400 for missing token without processing', async () => {
      const body = { status: { id: 3, description: 'Accepted' } };
      const response = await request(app)
        .post('/api/judge0/callback')
        .set('x-judge0-signature', sign(body))
        .send(body);

      expect(response.status).toBe(400);
      expect(mockDocSet).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid status (string id) without processing', async () => {
      const body = { token: 'token-123', status: { id: 'invalid' } };
      const response = await request(app)
        .post('/api/judge0/callback')
        .set('x-judge0-signature', sign(body))
        .send(body);

      expect(response.status).toBe(400);
      expect(mockDocSet).not.toHaveBeenCalled();
    });

    it('should return 400 for null status without processing', async () => {
      const body = { token: 'token-123', status: null };
      const response = await request(app)
        .post('/api/judge0/callback')
        .set('x-judge0-signature', sign(body))
        .send(body);

      expect(response.status).toBe(400);
      expect(mockDocSet).not.toHaveBeenCalled();
    });

    it('should return 400 for negative memory without processing', async () => {
      const body = { token: 'token-123', status: { id: 3, description: 'Accepted' }, memory: -100 };
      const response = await request(app)
        .post('/api/judge0/callback')
        .set('x-judge0-signature', sign(body))
        .send(body);

      expect(response.status).toBe(400);
      expect(mockDocSet).not.toHaveBeenCalled();
    });

    it('should return 400 for non-object body (JSON string) without processing', async () => {
      const raw = JSON.stringify('not an object');
      const response = await request(app)
        .post('/api/judge0/callback')
        .set('Content-Type', 'application/json')
        .set('x-judge0-signature', sign('not an object'))
        .send(raw);

      expect(response.status).toBe(400);
      expect(mockDocSet).not.toHaveBeenCalled();
    });
  });

  describe('Rule 5: output size bounds on callbacks', () => {
    it('should accept stdout of exactly MAX_OUTPUT_CHARS (at the boundary)', async () => {
      const body = { ...validBody, stdout: 'x'.repeat(JUDGE0_BOUNDS.MAX_OUTPUT_CHARS) };
      const response = await request(app)
        .post('/api/judge0/callback')
        .set('x-judge0-signature', sign(body))
        .send(body);

      expect(response.status).toBe(200);
      expect(mockDocSet).toHaveBeenCalledTimes(1);
    });

    it('should return 400 for stdout one character over the maximum', async () => {
      const body = { ...validBody, stdout: 'x'.repeat(JUDGE0_BOUNDS.MAX_OUTPUT_CHARS + 1) };
      const response = await request(app)
        .post('/api/judge0/callback')
        .set('x-judge0-signature', sign(body))
        .send(body);

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('maximum output size');
      expect(mockDocSet).not.toHaveBeenCalled();
    });

    it('should return 400 for non-string stdout', async () => {
      const body = { ...validBody, stdout: 12345 as any };
      const response = await request(app)
        .post('/api/judge0/callback')
        .set('x-judge0-signature', sign(body))
        .send(body);

      expect(response.status).toBe(400);
      expect(mockDocSet).not.toHaveBeenCalled();
    });

    it('should return 400 for non-string time', async () => {
      const body = { ...validBody, time: 0.01 as any };
      const response = await request(app)
        .post('/api/judge0/callback')
        .set('x-judge0-signature', sign(body))
        .send(body);

      expect(response.status).toBe(400);
      expect(mockDocSet).not.toHaveBeenCalled();
    });
  });

  describe('FIX 3: signature is verified over the true raw request bytes', () => {
    const signRaw = (raw: string, key: string = CALLBACK_SECRET): string =>
      crypto.createHmac('sha256', key).update(raw, 'utf8').digest('hex');

    it('a. valid signature computed over the true raw bytes → accepted', async () => {
      // Spaced JSON — deliberately NOT what JSON.stringify(req.body) would
      // produce, so this only passes if the captured raw bytes are used.
      const raw =
        '{ "token": "raw-token-1", "stdout": "hello", "stderr": null, "compile_output": null, "status": { "id": 3, "description": "Accepted" }, "time": "0.01", "memory": 1024 }';

      const response = await request(app)
        .post('/api/judge0/callback')
        .set('Content-Type', 'application/json')
        .set('x-judge0-signature', signRaw(raw))
        .send(raw);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Callback processed');
      expect(mockDocSet).toHaveBeenCalledTimes(1);
      expect(mockDocSet.mock.calls[0][0].token).toBe('raw-token-1');
    });

    it('b. same JSON payload with different key order/formatting, signed over ITS OWN raw bytes → both accepted', async () => {
      const rawA =
        '{"token":"order-token","stdout":"hi","stderr":null,"compile_output":null,"status":{"id":3,"description":"Accepted"},"time":"0.01","memory":1024}';
      const rawB =
        '{ "memory": 1024, "time": "0.01", "status": { "description": "Accepted", "id": 3 }, "compile_output": null, "stderr": null, "stdout": "hi", "token": "order-token" }';

      const responseA = await request(app)
        .post('/api/judge0/callback')
        .set('Content-Type', 'application/json')
        .set('x-judge0-signature', signRaw(rawA))
        .send(rawA);
      const responseB = await request(app)
        .post('/api/judge0/callback')
        .set('Content-Type', 'application/json')
        .set('x-judge0-signature', signRaw(rawB))
        .send(rawB);

      // Correctness is not tied to one specific serialization
      expect(responseA.status).toBe(200);
      expect(responseB.status).toBe(200);
      expect(mockDocSet).toHaveBeenCalledTimes(2);
      expect(mockDocSet.mock.calls.map((c) => (c[0] as any).token)).toEqual([
        'order-token',
        'order-token',
      ]);
    });

    it('c. tampered body with the original (now-invalid) signature → rejected', async () => {
      const raw =
        '{ "token": "tamper-token", "stdout": "clean output", "status": { "id": 3, "description": "Accepted" }, "memory": 512 }';
      const signatureOverOriginal = signRaw(raw);

      const tamperedRaw =
        '{ "token": "tamper-token", "stdout": "EVIL OUTPUT", "status": { "id": 3, "description": "Accepted" }, "memory": 512 }';

      const response = await request(app)
        .post('/api/judge0/callback')
        .set('Content-Type', 'application/json')
        .set('x-judge0-signature', signatureOverOriginal)
        .send(tamperedRaw);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
      expect(mockDocSet).not.toHaveBeenCalled();
    });

    it('d. valid signature but semantically malformed payload → 400 payload validation, not signature rejection', async () => {
      // Signature is perfectly valid over these exact bytes, but the
      // payload has no token/status → must fail payload validation (400),
      // proving the signature check passed.
      const raw = '{ "unexpected": "payload", "status": "not-an-object" }';

      const response = await request(app)
        .post('/api/judge0/callback')
        .set('Content-Type', 'application/json')
        .set('x-judge0-signature', signRaw(raw))
        .send(raw);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_PAYLOAD');
      expect(response.status).not.toBe(401);
      expect(mockDocSet).not.toHaveBeenCalled();
    });

    it('rejects (fails closed) when the raw body was not captured for the route', async () => {
      // A separate app that parses the body BEFORE the scoped raw-body
      // parser could ever see it — the raw bytes are gone, so the
      // signature cannot be verified and must be refused.
      const bareApp = express();
      bareApp.use(express.json());
      bareApp.use('/api/judge0', router);

      const raw = '{ "token": "no-raw", "status": { "id": 3, "description": "Accepted" } }';
      const response = await request(bareApp)
        .post('/api/judge0/callback')
        .set('Content-Type', 'application/json')
        .set('x-judge0-signature', signRaw(raw))
        .send(raw);

      expect(response.status).toBe(401);
      expect(mockDocSet).not.toHaveBeenCalled();
    });
  });
});
