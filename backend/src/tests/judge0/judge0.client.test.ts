import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { submitCodeToJudge0, Judge0NotConfiguredError } from '../../modules/judge0/judge0.client';
import { env } from '../../config/env';

describe('Judge0 client', () => {
  const saved = { url: env.JUDGE0_API_URL, key: env.JUDGE0_API_KEY };
  const fetchMock = vi.fn();

  beforeEach(() => {
    env.JUDGE0_API_URL = 'https://judge0.example.com/';
    env.JUDGE0_API_KEY = 'secret-key';
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    env.JUDGE0_API_URL = saved.url;
    env.JUDGE0_API_KEY = saved.key;
  });

  const ok = (json: unknown) => ({ ok: true, status: 201, json: async () => json });

  it('posts the submission to Judge0 with the auth header and callback url, and returns the token', async () => {
    fetchMock.mockResolvedValue(ok({ token: 'abc-123' }));
    const out = await submitCodeToJudge0('print(1)', 71, { stdin: '5', callbackUrl: 'https://us/cb?run=r1' });
    expect(out).toEqual({ token: 'abc-123' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://judge0.example.com/submissions?base64_encoded=false&wait=false');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Auth-Token']).toBe('secret-key');
    const sent = JSON.parse(init.body);
    expect(sent).toMatchObject({ source_code: 'print(1)', language_id: 71, stdin: '5', callback_url: 'https://us/cb?run=r1' });
    expect(sent.cpu_time_limit).toBeGreaterThan(0);
    expect(sent.memory_limit).toBeGreaterThan(0);
  });

  it('omits stdin and callback_url when not given', async () => {
    fetchMock.mockResolvedValue(ok({ token: 'abc' }));
    await submitCodeToJudge0('x', 71);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent).not.toHaveProperty('stdin');
    expect(sent).not.toHaveProperty('callback_url');
  });

  it('throws a not-configured error (503) and makes no request when URL or key is missing', async () => {
    env.JUDGE0_API_KEY = undefined;
    await expect(submitCodeToJudge0('x', 71)).rejects.toBeInstanceOf(Judge0NotConfiguredError);
    env.JUDGE0_API_KEY = 'k';
    env.JUDGE0_API_URL = undefined;
    await expect(submitCodeToJudge0('x', 71)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-2xx response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(submitCodeToJudge0('x', 71)).rejects.toThrow('HTTP 500');
  });

  it.each([[null], [{}], [{ token: 5 }], [{ token: '../x' }], [{ token: '' }], [{ token: 'a'.repeat(200) }]])(
    'rejects a malformed response %j',
    async (json) => {
      fetchMock.mockResolvedValue(ok(json));
      await expect(submitCodeToJudge0('x', 71)).rejects.toThrow('invalid response');
    }
  );
});
