import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SubmitBar } from './SubmitBar';

describe('SubmitBar', () => {
  describe('Happy path', () => {
    it('should render submit button', () => {
      render(
        <SubmitBar
          submissionId="sub-123"
          onSubmit={jest.fn()}
        />
      );

      expect(screen.getByTestId('submit-button')).toBeInTheDocument();
      expect(screen.getByText('Submit Exam')).toBeInTheDocument();
    });

    it('should show time remaining when provided', () => {
      render(
        <SubmitBar
          submissionId="sub-123"
          onSubmit={jest.fn()}
          timeRemaining="30:00"
        />
      );

      expect(screen.getByTestId('time-remaining')).toBeInTheDocument();
      expect(screen.getByText('30:00')).toBeInTheDocument();
    });

    it('should call onSubmit when confirmed', async () => {
      const onSubmit = jest.fn().mockResolvedValue(undefined);
      window.confirm = jest.fn(() => true);

      render(
        <SubmitBar
          submissionId="sub-123"
          onSubmit={onSubmit}
        />
      );

      fireEvent.click(screen.getByTestId('submit-button'));

      expect(window.confirm).toHaveBeenCalled();
      expect(onSubmit).toHaveBeenCalledWith('sub-123');
    });

    it('should show submitted state after successful submission', async () => {
      const onSubmit = jest.fn().mockResolvedValue(undefined);
      window.confirm = jest.fn(() => true);

      render(
        <SubmitBar
          submissionId="sub-123"
          onSubmit={onSubmit}
        />
      );

      fireEvent.click(screen.getByTestId('submit-button'));

      await waitFor(() => {
        expect(screen.getByText('Submitted ✓')).toBeInTheDocument();
      });
    });
  });

  describe('Error cases', () => {
    it('should not submit when user cancels confirmation', () => {
      const onSubmit = jest.fn();
      window.confirm = jest.fn(() => false);

      render(
        <SubmitBar
          submissionId="sub-123"
          onSubmit={onSubmit}
        />
      );

      fireEvent.click(screen.getByTestId('submit-button'));

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('should show error when submission fails', async () => {
      const onSubmit = jest.fn().mockRejectedValue(new Error('Server error'));
      window.confirm = jest.fn(() => true);

      render(
        <SubmitBar
          submissionId="sub-123"
          onSubmit={onSubmit}
        />
      );

      fireEvent.click(screen.getByTestId('submit-button'));

      await waitFor(() => {
        expect(screen.getByTestId('submit-error')).toBeInTheDocument();
        expect(screen.getByText('Server error')).toBeInTheDocument();
      });
    });

    it('should not submit when disabled', () => {
      const onSubmit = jest.fn();

      render(
        <SubmitBar
          submissionId="sub-123"
          onSubmit={onSubmit}
          disabled={true}
        />
      );

      fireEvent.click(screen.getByTestId('submit-button'));

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('should not submit when already submitted', async () => {
      const onSubmit = jest.fn().mockResolvedValue(undefined);
      window.confirm = jest.fn(() => true);

      render(
        <SubmitBar
          submissionId="sub-123"
          onSubmit={onSubmit}
        />
      );

      // First submit
      fireEvent.click(screen.getByTestId('submit-button'));

      await waitFor(() => {
        expect(screen.getByText('Submitted ✓')).toBeInTheDocument();
      });

      // Try to submit again
      fireEvent.click(screen.getByTestId('submit-button'));

      // onSubmit should only be called once
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  describe('Adversarial cases', () => {
    it('should handle rapid double-click gracefully', async () => {
      const onSubmit = jest.fn().mockResolvedValue(undefined);
      window.confirm = jest.fn(() => true);

      render(
        <SubmitBar
          submissionId="sub-123"
          onSubmit={onSubmit}
        />
      );

      // Rapid double-click
      fireEvent.click(screen.getByTestId('submit-button'));
      fireEvent.click(screen.getByTestId('submit-button'));

      // Should only call onSubmit once
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });
    });

    it('should prevent submission after confirmation is cancelled', async () => {
      const onSubmit = jest.fn();
      let confirmCount = 0;
      window.confirm = jest.fn(() => {
        confirmCount++;
        return confirmCount === 1; // First time yes, then no
      });

      render(
        <SubmitBar
          submissionId="sub-123"
          onSubmit={onSubmit}
        />
      );

      // First submit
      fireEvent.click(screen.getByTestId('submit-button'));
      await waitFor(() => {
        expect(screen.getByText('Submitted ✓')).toBeInTheDocument();
      });

      // Button should be disabled after submission
      expect(screen.getByTestId('submit-button')).toBeDisabled();
    });
  });
});
