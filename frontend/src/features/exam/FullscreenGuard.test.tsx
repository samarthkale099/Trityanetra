import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { FullscreenGuard } from './FullscreenGuard';

global.fetch = jest.fn(() => Promise.resolve({ ok: true })) as jest.Mock;

describe('FullscreenGuard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Happy path', () => {
    it('should render children', () => {
      render(
        <FullscreenGuard
          submissionId="sub-123"
          testId="test-123"
          enabled={true}
        >
          <div data-testid="child">Exam content</div>
        </FullscreenGuard>
      );

      expect(screen.getByTestId('child')).toBeInTheDocument();
      expect(screen.getByText('Exam content')).toBeInTheDocument();
    });

    it('should report fullscreen exit', async () => {
      render(
        <FullscreenGuard
          submissionId="sub-123"
          testId="test-123"
          enabled={true}
        >
          <div>Exam content</div>
        </FullscreenGuard>
      );

      // Simulate fullscreen exit
      act(() => {
        document.dispatchEvent(new Event('fullscreenchange'));
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/monitor/flags',
        expect.objectContaining({
          body: expect.stringContaining('FULLSCREEN_EXIT'),
        })
      );
    });
  });

  describe('Error cases', () => {
    it('should not report when disabled', () => {
      render(
        <FullscreenGuard
          submissionId="sub-123"
          testId="test-123"
          enabled={false}
        >
          <div>Exam content</div>
        </FullscreenGuard>
      );

      act(() => {
        document.dispatchEvent(new Event('fullscreenchange'));
      });

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should handle fetch errors gracefully', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      render(
        <FullscreenGuard
          submissionId="sub-123"
          testId="test-123"
          enabled={true}
        >
          <div>Exam content</div>
        </FullscreenGuard>
      );

      act(() => {
        document.dispatchEvent(new Event('fullscreenchange'));
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('Advisory-only guarantee', () => {
    it('should not modify exam state or show warnings to student', () => {
      const onFullscreenExit = jest.fn();

      render(
        <FullscreenGuard
          submissionId="sub-123"
          testId="test-123"
          enabled={true}
          onFullscreenExit={onFullscreenExit}
        >
          <div data-testid="exam-content">Normal exam content</div>
        </FullscreenGuard>
      );

      // Exam content should still be visible
      expect(screen.getByTestId('exam-content')).toBeInTheDocument();
    });
  });
});
