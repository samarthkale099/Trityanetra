import React, { useEffect, useRef } from 'react';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { basicSetup } from 'codemirror';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: 'python' | 'javascript';
  readOnly?: boolean;
}

/**
 * Code editor component using CodeMirror 6.
 * Integrates with anti-cheat monitoring hooks (paste block, etc.)
 */
export function CodeEditor({
  value,
  onChange,
  language = 'python',
  readOnly = false,
}: CodeEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!editorRef.current) return;

    const languageExtension = language === 'python' ? python() : javascript();

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        languageExtension,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString());
          }
        }),
        ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
      ],
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [language, readOnly]); // Recreate on language or readOnly change

  return (
    <div className="code-editor" data-testid="code-editor">
      <div ref={editorRef} />
    </div>
  );
}
