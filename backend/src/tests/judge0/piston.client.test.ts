import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runCodeOnPiston, _resetPistonRuntimeCache, PISTON_LANGUAGE } from '../../modules/judge0/piston.client';

const RUNTIMES = [
  { language: 'python', version: '3.10.0', aliases: ['py', 'python3'] },
  { language: 'c', version: '10.2.0', aliases: [] },
  { language: 'c++', version: '10.2.0', aliases: ['cpp'] },
  { language: 'java', version: '15.0.2', aliases: [] },
  { language: 'javascript', version: '18.15.0', aliases: ['node', 'js'] },
];

describe('Piston client', () => {
  const fetchMock = vi.fn();
  const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });

  beforeEach(() => {
    _resetPistonRuntimeCache();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('maps our language ids to Piston languages', () => {
    expect(PISTON_LANGUAGE[71]).toBe('python');
    expect(PISTON_LANGUAGE[54]).toBe('c++');
  });

  it('resolves the version from /runtimes (once, cached) and posts to /execute', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(RUNTIMES))
      .mockResolvedValueOnce(ok({ run: { stdout: '2\n', stderr: '', code: 0, signal: null } }))
      .mockResolvedValueOnce(ok({ run: { stdout: 'hi\n', stderr: '', code: 0, signal: null } }));

    const r1 = await runCodeOnPiston(71, 'print(1+1)');
    expect(r1.status.id).toBe(3);
    expect(r1.stdout).toBe('2\n');

    const runtimesUrl = fetchMock.mock.calls[0][0];
    const execInit = fetchMock.mock.calls[1][1];
    expect(String(runtimesUrl)).toContain('/runtimes');
    const body = JSON.parse(execInit.body);
    expect(body).toMatchObject({ language: 'python', version: '3.10.0' });
    expect(body.files[0].content).toBe('print(1+1)');

    // Second run reuses the cached runtimes (no extra /runtimes call).
    await runCodeOnPiston(71, 'print(2)');
    const runtimeCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/runtimes'));
    expect(runtimeCalls).toHaveLength(1);
  });

  it('maps a non-zero exit code to a runtime error', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(RUNTIMES))
      .mockResolvedValueOnce(ok({ run: { stdout: '', stderr: 'boom', code: 1, signal: null } }));
    const r = await runCodeOnPiston(71, 'raise SystemExit(1)');
    expect(r.status.id).toBe(11);
    expect(r.stderr).toBe('boom');
  });

  it('maps a kill signal to a time limit', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(RUNTIMES))
      .mockResolvedValueOnce(ok({ run: { stdout: '', stderr: '', code: null, signal: 'SIGKILL' } }));
    const r = await runCodeOnPiston(71, 'while True: pass');
    expect(r.status.id).toBe(5);
  });

  it('maps a failed compile to a compilation error with its output', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(RUNTIMES))
      .mockResolvedValueOnce(ok({ compile: { stdout: '', stderr: 'syntax error', code: 1 }, run: { stdout: '', stderr: '', code: 1 } }));
    const r = await runCodeOnPiston(54, 'int main(){');
    expect(r.status.id).toBe(6);
    expect(r.compile_output).toBe('syntax error');
  });

  it('rejects an unsupported language, a bad runtimes list and a bad execute response', async () => {
    await expect(runCodeOnPiston(999, 'x')).rejects.toThrow('Unsupported language');

    _resetPistonRuntimeCache();
    fetchMock.mockResolvedValueOnce(ok({ not: 'an array' }));
    await expect(runCodeOnPiston(71, 'x')).rejects.toThrow('invalid runtimes');

    _resetPistonRuntimeCache();
    fetchMock.mockResolvedValueOnce(ok(RUNTIMES)).mockResolvedValueOnce(ok({ no: 'run' }));
    await expect(runCodeOnPiston(71, 'x')).rejects.toThrow('invalid result');
  });
});
