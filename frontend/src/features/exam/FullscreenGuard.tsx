import React, { useEffect, useCallback } from 'react';

interface FullscreenGuardProps {
  children: React.ReactNode;
  submissionId: string;
  testId: string;
  enabled?: boolean;
  onFullscreenExit?: () => void;
}

/**
 * Fullscreen guard component.
 *
 * Monitors fullscreen state and reports fullscreen exits as advisory flags.
 * Reports whenever a fullscreenchange event fires while the document is NOT
 * in fullscreen (the exit state), regardless of the previously observed state.
 * Advisory-only: does NOT auto-fail or terminate the exam.
 */
export function FullscreenGuard({
  children,
  submissionId,
  testId,
  enabled = true,
  onFullscreenExit,
}: FullscreenGuardProps) {
  const reportFullscreenExit = useCallback(async () => {
    if (!enabled || !submissionId || !testId) return;

    try {
      await fetch('/api/monitor/flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId,
          testId,
          type: 'FULLSCREEN_EXIT',
          detail: `Fullscreen exit detected at ${new Date().toISOString()}`,
        }),
      });

      onFullscreenExit?.();
    } catch (error) {
      console.error('[FullscreenGuard] Failed to report fullscreen exit:', error);
    }
  }, [enabled, submissionId, testId, onFullscreenExit]);

  useEffect(() => {
    if (!enabled) return;

    const handleFullscreenChange = () => {
      const fullscreenElement =
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement;

      // A fullscreenchange event showing no fullscreen element is an exit.
      if (!fullscreenElement) {
        reportFullscreenExit();
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
    };
  }, [enabled, reportFullscreenExit]);

  return (
    <div className="fullscreen-guard" data-testid="fullscreen-guard">
      {children}
    </div>
  );
}
