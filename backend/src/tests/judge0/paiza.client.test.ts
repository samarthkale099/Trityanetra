import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runCodeOnPaiza, PAIZA_LANGUAGE } from '../../modules/judge0/paiza.client';

describe('Paiza client', () => {
  const fetchMock = vi.fn();
  const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('maps our language ids to Paiza languages', () => {
    expect(PAIZA_LANGUAGE[71]).toBe('python3');
    expect(PAIZA_LANGUAGE[54]).toBe('cpp');
  });

  it('creates a job, polls to completion, fetches details and returns an Accepted result', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ id: 'abc', status: 'running' }))
      .mockResolvedValueOnce(ok({ status: 'running' }))
      .mockResolvedValueOnce(ok({ status: 'completed' }))
      .mockResolvedValueOnce(ok({ build_result: 'success', result: 'success', exit_code: 0, stdout: '4\n', stderr: '', time: '0.02', memory: 1200 }));
    const r = await runCodeOnPaiza(71, 'print(2+2)', '');
    expect(r.status.id).toBe(3);
    expect(r.stdout).toBe('4\n');
    expect(r.time).toBe('0.02');

    const createInit = fetchMock.mock.calls[0][1];
    expect(createInit.method).toBe('POST');
    expect(createInit.body).toContain('language=python3');
    expect(createInit.body).toContain('api_key=guest');
  });

  it('completes immediately when create already returns completed', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ id: 'x', status: 'completed' }))
      .mockResolvedValueOnce(ok({ result: 'success', exit_code: 0, stdout: 'hi\n' }));
    const r = await runCodeOnPaiza(71, 'print("hi")');
    expect(r.stdout).toBe('hi\n');
    // create + details only, no status polls
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps a build failure to a compilation error', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ id: 'x', status: 'completed' }))
      .mockResolvedValueOnce(ok({ build_result: 'failure', build_stderr: 'syntax error', result: 'failure' }));
    const r = await runCodeOnPaiza(54, 'int main(){');
    expect(r.status.id).toBe(6);
    expect(r.compile_output).toBe('syntax error');
  });

  it('maps a non-zero exit to a runtime error and a timeout result to TLE', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ id: 'x', status: 'completed' }))
      .mockResolvedValueOnce(ok({ build_result: 'success', result: 'failure', exit_code: 1, stderr: 'boom' }));
    expect((await runCodeOnPaiza(71, 'x')).status.id).toBe(11);

    fetchMock
      .mockResolvedValueOnce(ok({ id: 'y', status: 'completed' }))
      .mockResolvedValueOnce(ok({ build_result: 'success', result: 'timeout' }));
    expect((await runCodeOnPaiza(71, 'x')).status.id).toBe(5);
  });

  it('rejects unsupported languages and bad responses', async () => {
    await expect(runCodeOnPaiza(999, 'x')).rejects.toThrow('Unsupported language');
    fetchMock.mockResolvedValueOnce(ok({ no: 'id' }));
    await expect(runCodeOnPaiza(71, 'x')).rejects.toThrow('invalid create');
  });
});
