import { useEffect, useRef, useCallback } from 'react';

interface TabFocusMonitorOptions {
  submissionId: string;
  testId: string;
  enabled?: boolean;
  onTabSwitch?: (timestamp: number) => void;
}

/**
 * Hook to monitor tab focus changes during an exam.
 * 
 * Reports tab switches to the monitor API as advisory flags.
 * Does NOT auto-fail or terminate the exam — advisory only.
 * 
 * Uses the Page Visibility API (visibilitychange event).
 */
export function useTabFocusMonitor({
  submissionId,
  testId,
  enabled = true,
  onTabSwitch,
}: TabFocusMonitorOptions) {
  const flagCountRef = useRef(0);

  const reportTabSwitch = useCallback(async () => {
    if (!enabled || !submissionId || !testId) return;

    try {
      await fetch('/api/monitor/flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId,
          testId,
          type: 'TAB_SWITCH',
          detail: `Tab switch detected at ${new Date().toISOString()}`,
        }),
      });

      flagCountRef.current += 1;
      onTabSwitch?.(Date.now());
    } catch (error) {
      console.error('[TabFocusMonitor] Failed to report tab switch:', error);
    }
  }, [enabled, submissionId, testId, onTabSwitch]);

  useEffect(() => {
    if (!enabled) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        reportTabSwitch();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, reportTabSwitch]);

  return {
    flagCount: flagCountRef.current,
  };
}
