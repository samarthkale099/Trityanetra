import { renderHook, act } from '@testing-library/react';
import { usePasteBlock } from './usePasteBlock';

global.fetch = jest.fn(() => Promise.resolve({ ok: true })) as jest.Mock;

describe('usePasteBlock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Happy path', () => {
    it('should report paste attempt when paste event fires', async () => {
      renderHook(() =>
        usePasteBlock({
          submissionId: 'sub-123',
          testId: 'test-123',
          enabled: true,
          blockPaste: false,
        })
      );

      act(() => {
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
        });
        document.dispatchEvent(pasteEvent);
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/monitor/flags',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('PASTE_ATTEMPT'),
        })
      );
    });

    it('should block paste when blockPaste is true', async () => {
      renderHook(() =>
        usePasteBlock({
          submissionId: 'sub-123',
          testId: 'test-123',
          enabled: true,
          blockPaste: true,
        })
      );

      let defaultPrevented = false;

      act(() => {
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
        });
        const originalPreventDefault = pasteEvent.preventDefault.bind(pasteEvent);
        pasteEvent.preventDefault = () => {
          defaultPrevented = true;
          originalPreventDefault();
        };
        document.dispatchEvent(pasteEvent);
      });

      expect(defaultPrevented).toBe(true);
    });

    it('should call onPasteAttempt callback', async () => {
      const onPasteAttempt = jest.fn();

      renderHook(() =>
        usePasteBlock({
          submissionId: 'sub-123',
          testId: 'test-123',
          enabled: true,
          onPasteAttempt,
        })
      );

      act(() => {
        document.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true }));
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      expect(onPasteAttempt).toHaveBeenCalled();
    });
  });

  describe('Error cases', () => {
    it('should not report when disabled', () => {
      renderHook(() =>
        usePasteBlock({
          submissionId: 'sub-123',
          testId: 'test-123',
          enabled: false,
        })
      );

      act(() => {
        document.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true }));
      });

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should handle fetch errors gracefully', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      renderHook(() =>
        usePasteBlock({
          submissionId: 'sub-123',
          testId: 'test-123',
          enabled: true,
        })
      );

      act(() => {
        document.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true }));
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
