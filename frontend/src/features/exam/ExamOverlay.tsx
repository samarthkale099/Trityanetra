import React from 'react';
import { useTabFocusMonitor } from './useTabFocusMonitor';
import { useDevToolsDetector } from './useDevToolsDetector';
import { usePasteBlock } from './usePasteBlock';
import { FullscreenGuard } from './FullscreenGuard';

interface ExamOverlayProps {
  children: React.ReactNode;
  submissionId: string;
  testId: string;
  enabled?: boolean;
}

/**
 * Exam overlay component that composes all anti-cheat monitoring.
 * 
 * Advisory-only monitoring: flags are reported but never auto-fail,
 * auto-terminate, or auto-flag-as-plagiarism the submission.
 */
export function ExamOverlay({
  children,
  submissionId,
  testId,
  enabled = true,
}: ExamOverlayProps) {
  // Initialize all monitoring hooks
  const tabMonitor = useTabFocusMonitor({
    submissionId,
    testId,
    enabled,
  });

  const devtoolsDetector = useDevToolsDetector({
    submissionId,
    testId,
    enabled,
  });

  const pasteBlocker = usePasteBlock({
    submissionId,
    testId,
    enabled,
    blockPaste: false, // Monitor only, don't block
  });

  return (
    <FullscreenGuard
      submissionId={submissionId}
      testId={testId}
      enabled={enabled}
    >
      <div className="exam-overlay" data-testid="exam-overlay">
        {children}
        {/* Advisory-only flag counters (hidden, for testing/debugging) */}
        <div data-testid="flag-counts" style={{ display: 'none' }}>
          <span data-testid="tab-flags">{tabMonitor.flagCount}</span>
          <span data-testid="devtools-flags">{devtoolsDetector.flagCount}</span>
          <span data-testid="paste-flags">{pasteBlocker.flagCount}</span>
        </div>
      </div>
    </FullscreenGuard>
  );
}
