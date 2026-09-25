import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CodeEditor } from './CodeEditor';

describe('CodeEditor', () => {
  it('renders the editor container', () => {
    render(<CodeEditor value="x = 1" onChange={jest.fn()} />);

    expect(screen.getByTestId('code-editor')).toBeInTheDocument();
  });

  it('shows the initial value', async () => {
    const { container } = render(
      <CodeEditor value="print('hello')" onChange={jest.fn()} />
    );

    await waitFor(() => {
      expect(container.querySelector('.cm-content')).toBeInTheDocument();
    });
    expect(container.querySelector('.cm-content')!.textContent).toContain("print('hello')");
  });

  it('does not call onChange on mount', async () => {
    const onChange = jest.fn();
    render(<CodeEditor value="x = 1" onChange={onChange} />);

    await waitFor(() => {
      expect(document.querySelector('.cm-content')).toBeInTheDocument();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports edits through onChange', async () => {
    const onChange = jest.fn();
    const { container } = render(<CodeEditor value="ab" onChange={onChange} />);

    const content = await waitFor(() => {
      const el = container.querySelector('.cm-content');
      expect(el).toBeInTheDocument();
      return el as HTMLElement;
    });

    await userEvent.click(content);
    await userEvent.keyboard('c');

    expect(onChange).toHaveBeenCalled();
    const lastValue = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(typeof lastValue).toBe('string');
    expect(lastValue).toContain('c');
  });

  it('renders read-only editors as non-editable', async () => {
    const { container } = render(
      <CodeEditor value="x = 1" onChange={jest.fn()} readOnly={true} />
    );

    const content = await waitFor(() => {
      const el = container.querySelector('.cm-content');
      expect(el).toBeInTheDocument();
      return el as HTMLElement;
    });

    expect(content.getAttribute('contenteditable')).toBe('false');
  });

  it('renders editable by default', async () => {
    const { container } = render(
      <CodeEditor value="x = 1" onChange={jest.fn()} readOnly={false} />
    );

    const content = await waitFor(() => {
      const el = container.querySelector('.cm-content');
      expect(el).toBeInTheDocument();
      return el as HTMLElement;
    });

    expect(content.getAttribute('contenteditable')).toBe('true');
  });

  it('keeps the editor mounted when language changes', async () => {
    const { container, rerender } = render(
      <CodeEditor value="x = 1" onChange={jest.fn()} language="python" />
    );

    await waitFor(() => {
      expect(container.querySelector('.cm-content')).toBeInTheDocument();
    });

    rerender(<CodeEditor value="x = 1" onChange={jest.fn()} language="javascript" />);

    await waitFor(() => {
      expect(container.querySelector('.cm-content')).toBeInTheDocument();
    });
    expect(screen.getByTestId('code-editor')).toBeInTheDocument();
  });
});
