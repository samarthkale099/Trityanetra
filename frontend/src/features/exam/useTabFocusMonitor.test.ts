import { renderHook, act } from '@testing-library/react';
import { useTabFocusMonitor } from './useTabFocusMonitor';

// Mock fetch
global.fetch = jest.fn(() => Promise.resolve({ ok: true })) as jest.Mock;

describe('useTabFocusMonitor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Clean up any event listeners
    jest.restoreAllMocks();
  });

  describe('Happy path', () => {
    it('should report tab switch when visibility changes to hidden', async () => {
      const { result } = renderHook(() =>
        useTabFocusMonitor({
          submissionId: 'sub-123',
          testId: 'test-123',
          enabled: true,
        })
      );

      // Simulate tab switch
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true,
      });

      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });

      // Wait for async fetch
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/monitor/flags',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('TAB_SWITCH'),
        })
      );
    });

    it('should call onTabSwitch callback when tab switch is detected', async () => {
      const onTabSwitch = jest.fn();

      renderHook(() =>
        useTabFocusMonitor({
          submissionId: 'sub-123',
          testId: 'test-123',
          enabled: true,
          onTabSwitch,
        })
      );

      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true,
      });

      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      expect(onTabSwitch).toHaveBeenCalled();
    });
  });

  describe('Error cases', () => {
    it('should not report when disabled', () => {
      renderHook(() =>
        useTabFocusMonitor({
          submissionId: 'sub-123',
          testId: 'test-123',
          enabled: false,
        })
      );

      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true,
      });

      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should not report without submissionId', () => {
      renderHook(() =>
        useTabFocusMonitor({
          submissionId: '',
          testId: 'test-123',
          enabled: true,
        })
      );

      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true,
      });

      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should handle fetch errors gracefully', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      renderHook(() =>
        useTabFocusMonitor({
          submissionId: 'sub-123',
          testId: 'test-123',
          enabled: true,
        })
      );

      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true,
      });

      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('Adversarial cases', () => {
    it('should not report when visibility becomes visible', () => {
      renderHook(() =>
        useTabFocusMonitor({
          submissionId: 'sub-123',
          testId: 'test-123',
          enabled: true,
        })
      );

      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      });

      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
