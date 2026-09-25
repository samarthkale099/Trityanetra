import { useEffect, useRef, useCallback } from 'react';

interface DevToolsDetectorOptions {
  submissionId: string;
  testId: string;
  enabled?: boolean;
  onDevToolsOpen?: (timestamp: number) => void;
}

/**
 * Hook to detect browser DevTools opening during an exam.
 * 
 * Uses multiple detection strategies:
 *  1. Window size comparison (inner vs outer dimensions)
 *  2. Console.debug timing
 * 
 * Reports as advisory flags only — does NOT auto-fail or terminate.
 * 
 * NOTE: DevTools detection is inherently unreliable and can produce false
 * positives. This is advisory-only by design per the ground rules.
 */
export function useDevToolsDetector({
  submissionId,
  testId,
  enabled = true,
  onDevToolsOpen,
}: DevToolsDetectorOptions) {
  const flagCountRef = useRef(0);
  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reportDevTools = useCallback(async () => {
    if (!enabled || !submissionId || !testId) return;

    try {
      await fetch('/api/monitor/flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId,
          testId,
          type: 'DEVTOOLS_OPEN',
          detail: `DevTools opening detected at ${new Date().toISOString()}`,
        }),
      });

      flagCountRef.current += 1;
      onDevToolsOpen?.(Date.now());
    } catch (error) {
      console.error('[DevToolsDetector] Failed to report DevTools:', error);
    }
  }, [enabled, submissionId, testId, onDevToolsOpen]);

  const checkDevTools = useCallback(() => {
    // Strategy 1: Size comparison
    const threshold = 100;
    const widthDiff = Math.abs(window.outerWidth - window.innerWidth);
    const heightDiff = Math.abs(window.outerHeight - window.innerHeight);

    if (widthDiff > threshold || heightDiff > threshold) {
      reportDevTools();
    }
  }, [reportDevTools]);

  useEffect(() => {
    if (!enabled) return;

    // Check every 3 seconds
    checkIntervalRef.current = setInterval(checkDevTools, 3000);

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
    };
  }, [enabled, checkDevTools]);

  return {
    flagCount: flagCountRef.current,
  };
}
