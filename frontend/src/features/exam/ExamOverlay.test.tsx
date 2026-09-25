import React from 'react';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { ExamOverlay } from './ExamOverlay';

global.fetch = jest.fn(() => Promise.resolve({ ok: true })) as jest.Mock;

const ALLOWED_FLAG_TYPES = ['TAB_SWITCH', 'PASTE_ATTEMPT', 'FULLSCREEN_EXIT', 'DEVTOOLS_OPEN'];

function hideTab() {
  Object.defineProperty(document, 'visibilityState', {
    value: 'hidden',
    writable: true,
    configurable: true,
  });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
}

describe('ExamOverlay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
  });

  describe('Happy path', () => {
    it('renders children inside the overlay', () => {
      render(
        <ExamOverlay submissionId="sub-123" testId="test-123">
          <div data-testid="exam-body">Question 1</div>
        </ExamOverlay>
      );

      expect(screen.getByTestId('exam-overlay')).toBeInTheDocument();
      expect(screen.getByTestId('exam-body')).toBeInTheDocument();
      expect(screen.getByText('Question 1')).toBeInTheDocument();
    });

    it('exposes the hidden flag counters', () => {
      render(
        <ExamOverlay submissionId="sub-123" testId="test-123">
          <div>content</div>
        </ExamOverlay>
      );

      expect(screen.getByTestId('flag-counts')).toBeInTheDocument();
      expect(screen.getByTestId('tab-flags')).toBeInTheDocument();
      expect(screen.getByTestId('devtools-flags')).toBeInTheDocument();
      expect(screen.getByTestId('paste-flags')).toBeInTheDocument();
    });

    it('wraps content in the fullscreen guard', () => {
      render(
        <ExamOverlay submissionId="sub-123" testId="test-123">
          <div data-testid="inner">inner</div>
        </ExamOverlay>
      );

      expect(screen.getByTestId('fullscreen-guard')).toBeInTheDocument();
      expect(screen.getByTestId('inner')).toBeInTheDocument();
    });
  });

  describe('Rule 4: advisory-only — flags only, no other side effects', () => {
    it('every network call goes to /api/monitor/flags and nowhere else', async () => {
      render(
        <ExamOverlay submissionId="sub-123" testId="test-123">
          <div>content</div>
        </ExamOverlay>
      );

      // Trigger fullscreen exit, tab switch, and paste monitors
      act(() => {
        document.dispatchEvent(new Event('fullscreenchange'));
      });
      hideTab();
      act(() => {
        document.dispatchEvent(
          new ClipboardEvent('paste', { bubbles: true, cancelable: true })
        );
      });
      await flush();

      expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(3);
      for (const call of (global.fetch as jest.Mock).mock.calls) {
        expect(call[0]).toBe('/api/monitor/flags');
        expect(call[1].method).toBe('POST');
      }
    });

    it('aggregated flag payloads use only the four allowed types and advisory fields', async () => {
      render(
        <ExamOverlay submissionId="sub-123" testId="test-123">
          <div>content</div>
        </ExamOverlay>
      );

      act(() => {
        document.dispatchEvent(new Event('fullscreenchange'));
      });
      hideTab();
      act(() => {
        document.dispatchEvent(
          new ClipboardEvent('paste', { bubbles: true, cancelable: true })
        );
      });
      await flush();

      const calls = (global.fetch as jest.Mock).mock.calls;
      const types = new Set<string>();
      for (const call of calls) {
        const payload = JSON.parse(call[1].body);
        expect(Object.keys(payload).sort()).toEqual([
          'detail',
          'submissionId',
          'testId',
          'type',
        ]);
        expect(payload.submissionId).toBe('sub-123');
        expect(payload.testId).toBe('test-123');
        expect(ALLOWED_FLAG_TYPES).toContain(payload.type);
        expect(payload).not.toHaveProperty('autoFail');
        expect(payload).not.toHaveProperty('autoTerminate');
        expect(payload).not.toHaveProperty('flaggedAsPlagiarism');
        expect(payload).not.toHaveProperty('status');
        types.add(payload.type);
      }

      expect(types.has('FULLSCREEN_EXIT')).toBe(true);
      expect(types.has('TAB_SWITCH')).toBe(true);
      expect(types.has('PASTE_ATTEMPT')).toBe(true);
    });

    it('shows no disruptive student-facing UI (no alert/confirm) when flags fire', async () => {
      render(
        <ExamOverlay submissionId="sub-123" testId="test-123">
          <div data-testid="still-here">content</div>
        </ExamOverlay>
      );

      act(() => {
        document.dispatchEvent(new Event('fullscreenchange'));
      });
      hideTab();
      await flush();

      expect(window.alert).not.toHaveBeenCalled();
      expect(window.confirm).not.toHaveBeenCalled();
      // Exam content remains visible — flags never hide/terminate the exam
      expect(screen.getByTestId('still-here')).toBeInTheDocument();
    });

    it('makes no network calls at all when disabled', async () => {
      render(
        <ExamOverlay submissionId="sub-123" testId="test-123" enabled={false}>
          <div>content</div>
        </ExamOverlay>
      );

      act(() => {
        document.dispatchEvent(new Event('fullscreenchange'));
      });
      hideTab();
      act(() => {
        document.dispatchEvent(
          new ClipboardEvent('paste', { bubbles: true, cancelable: true })
        );
      });
      await flush();

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('does not block paste (monitor-only mode)', async () => {
      render(
        <ExamOverlay submissionId="sub-123" testId="test-123">
          <div>content</div>
        </ExamOverlay>
      );

      let defaultPrevented = false;
      act(() => {
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
        });
        const original = pasteEvent.preventDefault.bind(pasteEvent);
        pasteEvent.preventDefault = () => {
          defaultPrevented = true;
          original();
        };
        document.dispatchEvent(pasteEvent);
      });
      await flush();

      expect(defaultPrevented).toBe(false);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/monitor/flags',
        expect.objectContaining({
          body: expect.stringContaining('PASTE_ATTEMPT'),
        })
      );
    });
  });
});
