import { useEffect, useRef, useCallback } from 'react';

interface PasteBlockOptions {
  submissionId: string;
  testId: string;
  enabled?: boolean;
  blockPaste?: boolean; // If true, prevent paste. If false, allow but monitor.
  onPasteAttempt?: (timestamp: number) => void;
}

/**
 * Hook to detect paste attempts during an exam.
 * 
 * Two modes:
 *  1. Monitor-only (blockPaste=false): Allows paste but reports as advisory flag
 *  2. Block mode (blockPaste=true): Prevents paste and reports as advisory flag
 * 
 * Advisory-only: paste detection does NOT auto-fail or terminate the exam.
 */
export function usePasteBlock({
  submissionId,
  testId,
  enabled = true,
  blockPaste = false,
  onPasteAttempt,
}: PasteBlockOptions) {
  const flagCountRef = useRef(0);

  const reportPaste = useCallback(async () => {
    if (!enabled || !submissionId || !testId) return;

    try {
      await fetch('/api/monitor/flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId,
          testId,
          type: 'PASTE_ATTEMPT',
          detail: `Paste attempt detected at ${new Date().toISOString()}`,
        }),
      });

      flagCountRef.current += 1;
      onPasteAttempt?.(Date.now());
    } catch (error) {
      console.error('[PasteBlock] Failed to report paste:', error);
    }
  }, [enabled, submissionId, testId, onPasteAttempt]);

  useEffect(() => {
    if (!enabled) return;

    const handlePaste = (e: ClipboardEvent) => {
      reportPaste();

      if (blockPaste) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    document.addEventListener('paste', handlePaste, true);

    return () => {
      document.removeEventListener('paste', handlePaste, true);
    };
  }, [enabled, blockPaste, reportPaste]);

  return {
    flagCount: flagCountRef.current,
  };
}
