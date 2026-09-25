import { renderHook, act } from '@testing-library/react';
import { vi } from 'vitest';
import { useDevToolsDetector } from './useDevToolsDetector';

global.fetch = jest.fn(() => Promise.resolve({ ok: true })) as jest.Mock;

const defaultOuterWidth = window.outerWidth;
const defaultInnerWidth = window.innerWidth;
const defaultOuterHeight = window.outerHeight;
const defaultInnerHeight = window.innerHeight;

function setSize(outerW: number, innerW: number, outerH: number, innerH: number) {
  Object.defineProperty(window, 'outerWidth', { value: outerW, writable: true, configurable: true });
  Object.defineProperty(window, 'innerWidth', { value: innerW, writable: true, configurable: true });
  Object.defineProperty(window, 'outerHeight', { value: outerH, writable: true, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: innerH, writable: true, configurable: true });
}

describe('useDevToolsDetector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    vi.useFakeTimers();
    // Default: no size difference (no DevTools)
    setSize(defaultOuterWidth, defaultInnerWidth, defaultOuterHeight, defaultInnerHeight);
  });

  afterEach(() => {
    vi.useRealTimers();
    setSize(defaultOuterWidth, defaultInnerWidth, defaultOuterHeight, defaultInnerHeight);
  });

  describe('Happy path', () => {
    it('reports DEVTOOLS_OPEN when window size difference exceeds the threshold', async () => {
      renderHook(() =>
        useDevToolsDetector({
          submissionId: 'sub-123',
          testId: 'test-123',
          enabled: true,
        })
      );

      // Simulate DevTools docked to the side: outer >> inner width
      setSize(2000, 800, defaultOuterHeight, defaultInnerHeight);

      await act(async () => {
        vi.advanceTimersByTime(3000);
        await Promise.resolve();
      });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/monitor/flags',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('DEVTOOLS_OPEN'),
        })
      );
    });

    it('reports on height difference as well as width', async () => {
      renderHook(() =>
        useDevToolsDetector({
          submissionId: 'sub-123',
          testId: 'test-123',
          enabled: true,
        })
      );

      setSize(defaultOuterWidth, defaultInnerWidth, 2000, 400);

      await act(async () => {
        vi.advanceTimersByTime(3000);
        await Promise.resolve();
      });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/monitor/flags',
        expect.objectContaining({
          body: expect.stringContaining('DEVTOOLS_OPEN'),
        })
      );
    });

    it('calls onDevToolsOpen callback', async () => {
      const onDevToolsOpen = jest.fn();

      renderHook(() =>
        useDevToolsDetector({
          submissionId: 'sub-123',
          testId: 'test-123',
          enabled: true,
          onDevToolsOpen,
        })
      );

      setSize(2000, 800, defaultOuterHeight, defaultInnerHeight);

      await act(async () => {
        vi.advanceTimersByTime(3000);
        await Promise.resolve();
      });

      expect(onDevToolsOpen).toHaveBeenCalled();
    });
  });

  describe('Error cases', () => {
    it('does not report when no size difference exists', async () => {
      renderHook(() =>
        useDevToolsDetector({
          submissionId: 'sub-123',
          testId: 'test-123',
          enabled: true,
        })
      );

      // No difference (defaults)
      await act(async () => {
        vi.advanceTimersByTime(3000);
        await Promise.resolve();
      });

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('does not report when disabled', async () => {
      renderHook(() =>
        useDevToolsDetector({
          submissionId: 'sub-123',
          testId: 'test-123',
          enabled: false,
        })
      );

      setSize(2000, 800, defaultOuterHeight, defaultInnerHeight);

      await act(async () => {
        vi.advanceTimersByTime(9000);
        await Promise.resolve();
      });

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('does not report without submissionId', async () => {
      renderHook(() =>
        useDevToolsDetector({
          submissionId: '',
          testId: 'test-123',
          enabled: true,
        })
      );

      setSize(2000, 800, defaultOuterHeight, defaultInnerHeight);

      await act(async () => {
        vi.advanceTimersByTime(3000);
        await Promise.resolve();
      });

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('handles fetch errors gracefully', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      renderHook(() =>
        useDevToolsDetector({
          submissionId: 'sub-123',
          testId: 'test-123',
          enabled: true,
        })
      );

      setSize(2000, 800, defaultOuterHeight, defaultInnerHeight);

      await act(async () => {
        vi.advanceTimersByTime(3000);
        await Promise.resolve();
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('Rule 4: advisory-only', () => {
    it('only ever posts to /api/monitor/flags — no other endpoints', async () => {
      renderHook(() =>
        useDevToolsDetector({
          submissionId: 'sub-123',
          testId: 'test-123',
          enabled: true,
        })
      );

      setSize(2000, 800, defaultOuterHeight, defaultInnerHeight);

      await act(async () => {
        vi.advanceTimersByTime(6000);
        await Promise.resolve();
      });

      expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(0);
      for (const call of (global.fetch as jest.Mock).mock.calls) {
        expect(call[0]).toBe('/api/monitor/flags');
      }
    });

    it('flag payload contains only advisory fields — no status or auto-fail fields', async () => {
      renderHook(() =>
        useDevToolsDetector({
          submissionId: 'sub-123',
          testId: 'test-123',
          enabled: true,
        })
      );

      setSize(2000, 800, defaultOuterHeight, defaultInnerHeight);

      await act(async () => {
        vi.advanceTimersByTime(3000);
        await Promise.resolve();
      });

      const body = (global.fetch as jest.Mock).mock.calls[0][1].body;
      const payload = JSON.parse(body);
      expect(Object.keys(payload).sort()).toEqual(['detail', 'submissionId', 'testId', 'type']);
      expect(payload.type).toBe('DEVTOOLS_OPEN');
      expect(payload).not.toHaveProperty('autoFail');
      expect(payload).not.toHaveProperty('status');
      expect(payload).not.toHaveProperty('verdict');
    });
  });
});
