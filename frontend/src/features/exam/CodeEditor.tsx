import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, LoaderCircle, RefreshCw } from 'lucide-react'
import { useLazyLoadWatchdog } from '@/features/exam/useLazyLoadWatchdog'
import { Button } from '@/shared/components/ui/button'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { cn } from '@/shared/lib/cn'

/**
 * The Monaco editor, loaded on demand.
 *
 * Monaco is the single largest dependency in the app (several megabytes of
 * language grammars and workers). Loading it on the exam route only, and behind
 * a dynamic import, keeps it out of the login and dashboard bundles entirely.
 *
 * The failure paths matter as much as the happy one:
 * - A skeleton while the chunk downloads, with `aria-busy` so it is announced.
 * - A timeout after 12s that offers a retry, because a spinner that never
 *   resolves is indistinguishable from a hang.
 * - A plain-text fallback if Monaco cannot be loaded at all. The exam is still
 *   sit-able: a student with a broken CDN can type their answer into a textarea
 *   and submit it, which is strictly better than a dead page.
 */

export interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  language: string
  theme: 'light' | 'dark'
  readOnly?: boolean
  height?: string
  className?: string
  /** Monospace font stack, matching the rest of the app's code surfaces. */
  fontFamily?: string
  /** Called once the editor is interactive. */
  onReady?: () => void
  onError?: (error: Error) => void
  children?: ReactNode
}

/** Split out so the fallback textarea can share the styling and the handlers. */
function FallbackTextarea({
  value,
  onChange,
  readOnly,
  className,
  'aria-label': ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
  className?: string
  'aria-label': string
}) {
  return (
    <textarea
      aria-label={ariaLabel}
      className={cn(
        'h-full w-full resize-none border-0 bg-surface p-4 font-mono text-sm text-ink-strong outline-none',
        className,
      )}
      value={value}
      readOnly={readOnly}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

export function CodeEditor({
  value,
  onChange,
  language,
  theme,
  readOnly = false,
  height = '100%',
  className,
  onReady,
  onError,
  children,
}: CodeEditorProps) {
  const watchdog = useLazyLoadWatchdog({
    onReady,
  })
  const [usingFallback, setUsingFallback] = useState(false)
  const valueRef = useRef(value)

  // Monaco is mounted only after the chunk resolves, so the first render is the
  // skeleton. A change made while it loads must still reach the editor, hence
  // the effect below rather than only an initial `value` prop.
  useEffect(() => {
    valueRef.current = value
  }, [value])

  // Kept in a ref because the `fallback` prop is read by the library on mount;
  // re-creating the callback on every keystroke would be pure churn.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const reportError = useCallback(
    (error: Error) => {
      setUsingFallback(true)
      onError?.(error)
    },
    [onError],
  )

  if (usingFallback) {
    return (
      <div className={cn('flex flex-col', className)} style={{ height }}>
        <div role="alert" className="flex items-start gap-2 border-b border-line bg-warning-soft px-4 py-2.5 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            The syntax-highlighting editor could not be loaded, so you are typing in a plain text
            box. Your work still saves and submits normally.
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <FallbackTextarea
            aria-label="Your answer (plain text editor)"
            value={value}
            onChange={onChange}
            readOnly={readOnly}
          />
        </div>
      </div>
    )
  }

  if (watchdog.state === 'timeout' || watchdog.state === 'error') {
    return (
      <div className={cn('flex items-center justify-center p-6', className)} style={{ height }} role="alert">
        <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft">
            <AlertTriangle className="h-5 w-5 text-danger" aria-hidden="true" />
          </div>
          <h3 className="mt-3 text-base font-semibold text-ink-strong">
            {watchdog.state === 'timeout' ? 'The editor took too long to load' : 'The editor failed to load'}
          </h3>
          <p className="mt-1.5 text-sm text-ink">
            This is usually a slow or interrupted connection. Try again, or continue in a plain
            text box - your answer submits the same way.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <Button
              onClick={() => {
                watchdog.retry()
              }}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
            <Button variant="secondary" onClick={() => reportError(watchdog.error ?? new Error('Editor unavailable'))}>
              Continue in plain text
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('relative', className)} style={{ height }}>
      <Suspense
        fallback={
          <div
            className="flex h-full w-full flex-col gap-2 bg-surface p-4"
            aria-busy="true"
            aria-label="Loading the code editor"
          >
            <div className="flex items-center gap-2 text-sm text-ink-faint">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading editor...
            </div>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        }
      >
        <MonacoLoader
          // Remounting on `retryToken` re-runs the dynamic import.
          key={watchdog.retryToken}
          value={value}
          onChange={onChangeRef}
          language={language}
          theme={theme}
          height={height}
          readOnly={readOnly}
          onMount={watchdog.markReady}
          onFail={reportError}
        />
      </Suspense>
      {children}
    </div>
  )
}

/**
 * Isolated so the dynamic import lives in exactly one place and its rejection is
 * catchable. `React.lazy` has no error boundary of its own, so the promise is
 * caught here and turned into the `onFail` path; without that a chunk-load
 * failure would unmount the whole route with no UI at all.
 */
function MonacoLoader({
  value,
  onChange,
  language,
  theme,
  height,
  readOnly,
  onMount,
  onFail,
}: {
  value: string
  onChange: React.MutableRefObject<(value: string) => void>
  language: string
  theme: 'light' | 'dark'
  height: string
  readOnly: boolean
  onMount: () => void
  onFail: (error: Error) => void
}) {
  const [Component, setComponent] = useState<EditorComponent | null>(null)

  useEffect(() => {
    let active = true
    import('@monaco-editor/react')
      .then((module) => {
        if (!active) return
        setComponent(() => module.default as unknown as EditorComponent)
      })
      .catch((error: unknown) => {
        if (!active) return
        onFail(error instanceof Error ? error : new Error('Editor chunk failed to load'))
      })
    return () => {
      active = false
    }
  }, [onFail])

  if (!Component) {
    return (
      <div className="flex h-full w-full flex-col gap-2 bg-surface p-4" aria-busy="true" aria-label="Loading the code editor">
        <div className="flex items-center gap-2 text-sm text-ink-faint">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading editor...
        </div>
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    )
  }

  return (
    <Component
      value={value}
      onChange={(next: string | undefined) => onChange.current(next ?? '')}
      language={language}
      theme={theme === 'dark' ? 'trityanetra-dark' : 'trityanetra-light'}
      beforeMount={defineEditorThemes}
      height={height}
      // `readOnly` is a real monaco construction option, so it is passed as a
      // top-level prop rather than duplicated inside `options`.
      readOnly={readOnly}
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        /*
         * The app's own mono stack (see `fontFamily.mono` in tailwind.config.ts).
         * This previously led with `Inter`, which is proportional: because Inter
         * has full Latin coverage the browser never fell back to the monospace
         * entries, so code was drawn in a sans-serif with no column alignment and
         * misleading indentation. Monaco takes a raw CSS font list, so the stack
         * is repeated here rather than referenced by token.
         */
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        renderLineHighlight: 'line',
        padding: { top: 12, bottom: 12 },
        // A single exam question is one file. Full IDE behaviour is noise here.
        quickSuggestions: false,
        suggestOnTriggerCharacters: false,
        wordWrap: 'on',
        contextmenu: false,
        folding: false,
        lineNumbersMinChars: 3,
      }}
      loading={
        <div className="flex h-full w-full items-center gap-2 bg-surface p-4 text-sm text-ink-faint" aria-busy="true">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading editor...
        </div>
      }
      onMount={onMount}
    />
  )
}

/**
 * Editor themes tuned to the app palette, so the editor reads as part of the
 * page rather than a grey box dropped onto it. Syntax colours come from the
 * stock themes (`inherit`); only the chrome is retinted. Defining a theme twice
 * is harmless, so this can run on every mount.
 */
function defineEditorThemes(monaco: MonacoNamespace) {
  monaco.editor.defineTheme('trityanetra-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: 'e3c67f' },
      { token: 'string', foreground: 'b9d3a8' },
      { token: 'number', foreground: 'e8a87c' },
      { token: 'type', foreground: 'a9c1e0' },
      { token: 'comment', foreground: '6f6a5e', fontStyle: 'italic' },
    ],
    colors: {
      'editor.background': '#0e0d0b',
      'editor.foreground': '#e9e4d6',
      'editor.lineHighlightBackground': '#1a1813',
      'editor.selectionBackground': '#4a3d1f99',
      'editorCursor.foreground': '#d4af5a',
      'editorLineNumber.foreground': '#4a463c',
      'editorLineNumber.activeForeground': '#e3c67f',
      'editorIndentGuide.background1': '#27241e',
    },
  })
  monaco.editor.defineTheme('trityanetra-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '8a6a22' },
      { token: 'string', foreground: '3f6b45' },
      { token: 'number', foreground: '96501c' },
      { token: 'type', foreground: '3d5a85' },
      { token: 'comment', foreground: '9a9483', fontStyle: 'italic' },
    ],
    colors: {
      'editor.background': '#fdfcf9',
      'editor.foreground': '#1f1d18',
      'editor.lineHighlightBackground': '#f7f3e8',
      'editor.selectionBackground': '#ebdcb4',
      'editorCursor.foreground': '#8a6a22',
      'editorLineNumber.foreground': '#c2bcab',
      'editorLineNumber.activeForeground': '#8a6a22',
    },
  })
}

/** The slice of the Monaco namespace the theme setup needs. */
interface MonacoNamespace {
  editor: {
    defineTheme: (
      name: string,
      data: {
        base: 'vs' | 'vs-dark'
        inherit: boolean
        rules: { token: string; foreground?: string; fontStyle?: string }[]
        colors: Record<string, string>
      },
    ) => void
  }
}

/** Structural type for the Monaco wrapper, so no `any` is needed. */
interface EditorComponent {
  (props: {
    value: string
    onChange: (value: string | undefined) => void
    language: string
    theme: string
    height: string
    readOnly: boolean
    options: Record<string, unknown>
    loading: ReactNode
    onMount: () => void
    beforeMount: (monaco: MonacoNamespace) => void
  }): ReactNode
}
