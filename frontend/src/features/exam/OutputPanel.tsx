import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2, ChevronDown, LoaderCircle, Play, Terminal, XCircle } from 'lucide-react'
import { examApi, type RunCaseResult } from '@/features/exam/examApi'
import { ApiError } from '@/shared/lib/httpClient'
import { cn } from '@/shared/lib/cn'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Textarea } from '@/shared/components/ui/textarea'
import type { ExamLanguage } from '@/shared/types/classroom'

interface OutputPanelProps {
  testId: string
  questionId: string
  code: string
  language: ExamLanguage
  /** True once time is up or the exam is submitted: running is closed too. */
  disabled?: boolean
  className?: string
}

/** One block of program output, shown only when it has content. */
function Stream({ label, text, tone = 'ink' }: { label: string; text: string; tone?: 'ink' | 'danger' }) {
  if (!text) return null
  return (
    <div className="mt-2">
      <p className="text-[11px] uppercase tracking-[0.12em] text-ink-faint">{label}</p>
      <pre
        className={cn(
          'mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-canvas-sunken px-3 py-2 font-mono text-xs',
          tone === 'danger' ? 'text-danger' : 'text-ink',
        )}
      >
        {text}
      </pre>
    </div>
  )
}

function CaseResult({ result, index }: { result: RunCaseResult; index: number }) {
  const custom = result.caseId === 'custom'
  return (
    <li className="rounded-md border border-line px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink-strong">{custom ? 'Your input' : `Test case ${index + 1}`}</span>
        <div className="flex items-center gap-2">
          {result.timeMs !== null ? <span className="text-xs tabular-nums text-ink-faint">{result.timeMs} ms</span> : null}
          {result.memoryKb !== null ? (
            <span className="text-xs tabular-nums text-ink-faint">{Math.round(result.memoryKb / 1024)} MB</span>
          ) : null}
          {result.passed === true ? (
            <Badge variant="success" dot>
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              Passed
            </Badge>
          ) : result.passed === false ? (
            <Badge variant="danger" dot>
              <XCircle className="h-3 w-3" aria-hidden="true" />
              Failed
            </Badge>
          ) : (
            <Badge variant="outline">{result.status}</Badge>
          )}
        </div>
      </div>
      {result.passed === false && result.status !== 'Accepted' ? (
        <p className="mt-1 text-xs text-danger">{result.status}</p>
      ) : null}
      <Stream label="Input" text={result.input} />
      {!custom && result.expected !== null ? <Stream label="Expected" text={result.expected} /> : null}
      <Stream label="Your output" text={result.stdout} />
      <Stream label="Compile errors" text={result.compileOutput} tone="danger" />
      <Stream label="Errors" text={result.stderr} tone="danger" />
    </li>
  )
}

/**
 * "Run" during an exam: executes the code on the question's visible test cases
 * (and, optionally, the student's own input) and shows the output, errors,
 * pass/fail, time and memory. Hidden test cases are never run here, so they
 * cannot be probed. Running never saves or submits anything.
 */
export function OutputPanel({ testId, questionId, code, language, disabled = false, className }: OutputPanelProps) {
  const [open, setOpen] = useState(false)
  const [useCustom, setUseCustom] = useState(false)
  const [customInput, setCustomInput] = useState('')

  const run = useMutation({
    mutationFn: () =>
      examApi.run(testId, { questionId, code, language, ...(useCustom ? { customInput } : {}) }),
    onMutate: () => setOpen(true),
  })

  const results = run.data ?? []
  const passed = results.filter((r) => r.passed === true).length
  const graded = results.filter((r) => r.passed !== null).length
  const notConfigured = run.error instanceof ApiError && run.error.status === 503
  const rateLimited = run.error instanceof ApiError && run.error.status === 429

  return (
    <section aria-label="Run your code" className={cn('border-t border-line bg-surface', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 lg:px-6">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex items-center gap-2 rounded-sm text-sm font-medium text-ink-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text"
        >
          <Terminal className="h-4 w-4 text-brand-text" aria-hidden="true" />
          Output
          {graded > 0 ? (
            <span className={cn('text-xs tabular-nums', passed === graded ? 'text-success' : 'text-ink-faint')}>
              {passed}/{graded} passed
            </span>
          ) : null}
          <ChevronDown className={cn('h-4 w-4 transition-transform duration-250', open && 'rotate-180')} aria-hidden="true" />
        </button>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-ink">
            <input
              type="checkbox"
              checked={useCustom}
              onChange={(event) => {
                setUseCustom(event.target.checked)
                if (event.target.checked) setOpen(true)
              }}
              className="accent-[var(--brand-400)]"
            />
            Use my own input
          </label>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => run.mutate()}
            disabled={disabled || run.isPending || code.trim() === ''}
          >
            {run.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="h-4 w-4" aria-hidden="true" />
            )}
            {run.isPending ? 'Running…' : 'Run'}
          </Button>
        </div>
      </div>

      {open ? (
        <div className="max-h-[40vh] overflow-y-auto border-t border-line px-4 py-3 lg:px-6" aria-live="polite">
          {useCustom ? (
            <div className="mb-3">
              <label htmlFor="custom-input" className="text-xs font-medium text-ink">
                Your input (sent to the program's standard input)
              </label>
              <Textarea
                id="custom-input"
                rows={3}
                value={customInput}
                onChange={(event) => setCustomInput(event.target.value)}
                className="mt-1 font-mono text-xs"
                spellCheck={false}
              />
            </div>
          ) : null}

          {notConfigured ? (
            <p className="text-sm text-ink-faint">
              Running code isn't set up on this server yet. Your answer is still saved and submitted normally.
            </p>
          ) : rateLimited ? (
            <p className="text-sm text-warning">You're running code too often. Wait a moment and try again.</p>
          ) : run.isError ? (
            <p className="text-sm text-danger">{run.error instanceof Error ? run.error.message : 'The run failed.'}</p>
          ) : run.isPending ? (
            <p className="flex items-center gap-2 text-sm text-ink-faint">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              Running your code…
            </p>
          ) : results.length === 0 ? (
            <p className="text-sm text-ink-faint">
              Press Run to try your code on this question's sample test cases. Hidden test cases are only checked
              after you submit.
            </p>
          ) : (
            <ol className="flex flex-col gap-2">
              {results.map((result, index) => (
                <CaseResult key={`${result.caseId}-${index}`} result={result} index={index} />
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </section>
  )
}
