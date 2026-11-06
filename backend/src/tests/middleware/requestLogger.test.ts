import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requestLogger, redactSecrets } from '../../middleware/requestLogger';

describe('requestLogger redaction', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('redacts the Judge0 callback token from a URL', () => {
    expect(redactSecrets('/api/judge0/callback/s3cr3t-T0ken')).toBe('/api/judge0/callback/[redacted]');
    expect(redactSecrets('/api/judge0/callback/s3cr3t?x=1')).toBe('/api/judge0/callback/[redacted]?x=1');
    expect(redactSecrets('/api/tests/abc/entry')).toBe('/api/tests/abc/entry');
  });

  it('never writes the callback token to the log output', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const a = express();
    a.use(requestLogger);
    a.put('/api/judge0/callback/:token', (_req, res) => res.sendStatus(200));
    await request(a).put('/api/judge0/callback/SUPER-SECRET-VALUE').send({});
    const lines = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(lines).toContain('/api/judge0/callback/[redacted]');
    expect(lines).not.toContain('SUPER-SECRET-VALUE');
  });
});
