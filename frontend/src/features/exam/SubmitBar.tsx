import React, { useState, useCallback } from 'react';

interface SubmitBarProps {
  submissionId: string;
  onSubmit: (submissionId: string) => Promise<void>;
  disabled?: boolean;
  timeRemaining?: string;
}

/**
 * Submit bar component for the exam interface.
 * Shows submission status, time remaining, and submit button.
 */
export function SubmitBar({
  submissionId,
  onSubmit,
  disabled = false,
  timeRemaining,
}: SubmitBarProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (isSubmitting || submitted || disabled) return;

    const confirmed = window.confirm('Are you sure you want to submit? This action cannot be undone.');
    if (!confirmed) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await onSubmit(submissionId);
      setSubmitted(true);
    } catch (err) {
      setError((err as Error).message || 'Submission failed');
    } finally {
      setIsSubmitting(false);
    }
  }, [submissionId, onSubmit, isSubmitting, submitted, disabled]);

  return (
    <div className="submit-bar" data-testid="submit-bar">
      {timeRemaining && (
        <span className="time-remaining" data-testid="time-remaining">
          {timeRemaining}
        </span>
      )}

      {error && (
        <span className="error" data-testid="submit-error">
          {error}
        </span>
      )}

      <button
        onClick={handleSubmit}
        disabled={disabled || isSubmitting || submitted}
        data-testid="submit-button"
        className={`submit-button ${submitted ? 'submitted' : ''}`}
      >
        {submitted
          ? 'Submitted ✓'
          : isSubmitting
            ? 'Submitting...'
            : 'Submit Exam'}
      </button>
    </div>
  );
}
