import { ApiError, http } from '@/shared/lib/httpClient'
import { sanitizeCode } from '@/shared/lib/sanitize'
import {
  isExamLanguage,
  type ExamLanguage,
  type Question,
  type Submission,
  type TestDetail,
  type TestLobby,
  type TestSummary,
} from '@/shared/types/classroom'

/**
 * Exam HTTP surface, mapped onto the backend's routes:
 *
 * - `GET  /api/tests`                 -> `{ data }`: a student's tests (only
 *                                        classrooms they were added to) or a
 *                                        teacher's own tests
 * - `GET  /api/tests/:testId/lobby`   -> `{ data }`: details, server time, own
 *                                        status. No questions, never starts the timer.
 * - `GET  /api/tests/:testId/entry`   -> `{ data }`: questions (hidden cases
 *                                        masked); the first call latches `startedAt`
 * - `POST /api/submissions`           -> one submission per test+student; a
 *                                        repeat is answered idempotently
 *
 * The backend wraps payloads as `{ data }` and uses its own field names
 * (`startTime`/`endTime`, `mySubmissionStatus`, ...). Everything is converted
 * here, so the pages keep consuming the shared types unchanged.
 */

/** One run of the student's code on one input. */
export interface RunCaseResult {
  /** A visible test case id, or "custom" for the student's own input. */
  caseId: string
  input: string
  /** `null` for a custom run (nothing to compare against). */
  expected: string | null
  stdout: string
  stderr: string
  compileOutput: string
  /** Judge0's verdict, e.g. "Accepted", "Wrong Answer", "Time Limit Exceeded". */
  status: string
  /** Visible cases only: output matched the expected output. */
  passed: boolean | null
  timeMs: number | null
  memoryKb: number | null
}

export interface SubmitInput {
  code: string
  language: ExamLanguage
  /**
   * Stable per attempt. The backend already stores exactly one submission per
   * test+student and answers a repeat idempotently; the key is kept so the
   * returned Submission stays stable across retries.
   */
  idempotencyKey: string
  /**
   * Every question's code, keyed by question id. With more than one question
   * all of them are sent; otherwise `code` alone is the answer.
   */
  answers?: Record<string, string>
}

const MAX_CODE_CHARS = 200_000

/**
 * The `answers` body the backend stores. One question: `{ language, code }`,
 * the shape the plagiarism engine compares. Several: `{ language, questions }`,
 * so no question's code is dropped.
 */
export function answersPayload(input: Pick<SubmitInput, 'code' | 'language' | 'answers'>) {
  const entries = Object.entries(input.answers ?? {})
  if (entries.length > 1) {
    return {
      language: input.language,
      questions: Object.fromEntries(entries.map(([id, code]) => [id, { code: sanitizeCode(code, MAX_CODE_CHARS) }])),
    }
  }
  return { language: input.language, code: sanitizeCode(input.code, MAX_CODE_CHARS) }
}

/* ------------------------------------------------------------- code runs */

/** Language ids the backend's code runner accepts (Judge0 CE numbering). */
export const LANGUAGE_IDS: Record<ExamLanguage, number> = {
  cpp: 54,
  java: 62,
  javascript: 63,
  python: 71,
}

/** Visible cases run per press of Run; the server allows 10 runs a minute. */
export const MAX_CASES_PER_RUN = 3

export interface RunCase {
  id: string
  input: string
  /** Null for the student's own input: there is nothing to compare against. */
  expected: string | null
}

interface RawRunResult {
  statusId: number
  statusDescription: string | null
  stdout: string | null
  stderr: string | null
  compileOutput: string | null
  message: string | null
  time: string | number | null
  memory: number | null
}

const RUN_POLL_MS = 1500
const RUN_POLL_LIMIT_MS = 30_000

/** Starts one run and, when the server answers "pending", polls until it finishes. */
async function runOnce(testId: string, code: string, language: ExamLanguage, stdin: string): Promise<RawRunResult> {
  const started = await http.post<{ data: { runId: string; status: string; result?: RawRunResult } }>(
    `/api/judge0/tests/${encodeURIComponent(testId)}/run`,
    { body: { code, languageId: LANGUAGE_IDS[language], stdin }, retryOnUnauthorized: false },
  )
  let run = unwrap(started)
  const deadline = Date.now() + RUN_POLL_LIMIT_MS
  while (run.status === 'PENDING' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, RUN_POLL_MS))
    const polled = await http.get<{ data: { runId: string; status: string; result?: RawRunResult } }>(
      `/api/judge0/runs/${encodeURIComponent(run.runId)}`,
    )
    run = unwrap(polled)
  }
  if (run.status !== 'DONE' || !run.result) {
    throw new ApiError(run.status === 'PENDING' ? 'The run took too long. Try again.' : 'The run failed.', {
      status: 503,
      code: 'RUN_FAILED',
    })
  }
  return run.result
}

/** Trailing whitespace and line endings never decide pass or fail. */
const normaliseOutput = (text: string) =>
  text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()

function toRunCaseResult(job: RunCase, raw: RawRunResult): RunCaseResult {
  const stdout = raw.stdout ?? ''
  const accepted = raw.statusId === 3
  const seconds = raw.time === null || raw.time === undefined ? null : Number(raw.time)
  return {
    caseId: job.id,
    input: job.input,
    expected: job.expected,
    stdout,
    stderr: raw.stderr ?? raw.message ?? '',
    compileOutput: raw.compileOutput ?? '',
    status: raw.statusDescription ?? (accepted ? 'Accepted' : 'Error'),
    passed: job.expected === null ? null : accepted && normaliseOutput(stdout) === normaliseOutput(job.expected),
    timeMs: seconds === null || Number.isNaN(seconds) ? null : Math.round(seconds * 1000),
    memoryKb: raw.memory ?? null,
  }
}

/* ------------------------------------------------------------------ mapping */

/** Unwraps the backend's `{ data }` envelope. */
export const unwrap = <T,>(payload: { data: T } | T): T =>
  payload && typeof payload === 'object' && 'data' in (payload as object) ? (payload as { data: T }).data : (payload as T)

/** ISO string from an ISO string, a Date, or a serialised Firestore Timestamp. */
export function toIso(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    const seconds = (value as { _seconds?: number; seconds?: number })._seconds ?? (value as { seconds?: number }).seconds
    if (typeof seconds === 'number') return new Date(seconds * 1000).toISOString()
  }
  return ''
}

const languageOf = (value: unknown): ExamLanguage => (isExamLanguage(value) ? value : 'python')

/** A backend question (any loose shape the teacher form produced) as a `Question`. */
export function toQuestion(raw: any, index: number, language: ExamLanguage): Question {
  const testCases: any[] = Array.isArray(raw?.testCases) ? raw.testCases : []
  return {
    id: String(raw?.id ?? `q${index + 1}`),
    prompt: String(raw?.prompt ?? raw?.text ?? ''),
    starterCode: String(raw?.starterCode ?? ''),
    language: languageOf(raw?.language ?? language),
    points: Number(raw?.points) > 0 ? Number(raw.points) : 10,
    order: typeof raw?.order === 'number' ? raw.order : index,
    testCases: testCases.map((testCase, caseIndex) => ({
      id: String(testCase?.id ?? `c${caseIndex + 1}`),
      hidden: Boolean(testCase?.hidden),
      input: testCase?.hidden ? null : (testCase?.input ?? null),
      expected: testCase?.hidden ? null : (testCase?.expected ?? null),
    })),
  }
}

/** A row of `GET /api/tests` (student summary or teacher document) as a `TestSummary`. */
export function toTestSummary(raw: any, uid?: string): TestSummary {
  const questions: any[] = Array.isArray(raw?.questions) ? raw.questions : []
  const submitted = raw?.mySubmissionStatus === 'SUBMITTED' || raw?.mySubmissionStatus === 'FINALIZED'
  return {
    id: String(raw.id),
    classroomId: String(raw.classroomId ?? ''),
    title: String(raw.title ?? 'Untitled test'),
    language: languageOf(raw.language),
    windowStart: toIso(raw.windowStart ?? raw.startTime),
    windowEnd: toIso(raw.windowEnd ?? raw.endTime),
    durationMinutes: Number(raw.durationMinutes) || 0,
    questionCount: typeof raw.questionCount === 'number' ? raw.questionCount : questions.length,
    totalPoints:
      typeof raw.totalPoints === 'number'
        ? raw.totalPoints
        : questions.reduce((sum, q) => sum + (Number(q?.points) > 0 ? Number(q.points) : 10), 0),
    submittedCount: Number(raw.submittedCount) || 0,
    mySubmissionId: submitted ? `${raw.id}_${uid ?? 'me'}` : null,
    createdAt: toIso(raw.createdAt),
  }
}

function toTestDetail(raw: any, extra: Partial<TestDetail> = {}): TestDetail {
  const language = languageOf(raw.language)
  const questions = (Array.isArray(raw.questions) ? raw.questions : []).map((q: any, i: number) =>
    toQuestion(q, i, language),
  )
  return {
    id: String(raw.id),
    classroomId: String(raw.classroomId ?? ''),
    classroomName: String(raw.classroomName ?? ''),
    title: String(raw.title ?? ''),
    instructions: String(raw.instructions ?? ''),
    language,
    windowStart: toIso(raw.windowStart ?? raw.startTime),
    windowEnd: toIso(raw.windowEnd ?? raw.endTime),
    durationMinutes: Number(raw.durationMinutes) || 0,
    questions,
    totalPoints:
      typeof raw.totalPoints === 'number'
        ? raw.totalPoints
        : questions.reduce((sum: number, q: Question) => sum + q.points, 0),
    questionCount: typeof raw.questionCount === 'number' ? raw.questionCount : questions.length,
    ...extra,
  }
}

/** The backend's submission status as the UI's `Submission`, or null when not submitted. */
function toSubmission(testId: string, raw: any, language: ExamLanguage): Submission | null {
  if (!raw || (raw.status !== 'SUBMITTED' && raw.status !== 'FINALIZED')) return null
  return {
    id: `${testId}_me`,
    testId,
    uid: '',
    language,
    code: '',
    status: 'QUEUED',
    idempotencyKey: '',
    submittedAt: toIso(raw.submittedAt) || new Date().toISOString(),
    score: null,
    maxScore: null,
  }
}

function toLobby(raw: any): TestLobby {
  const testRaw = raw.test ?? raw
  const test = toTestDetail(testRaw)
  return {
    test,
    serverTime: toIso(raw.serverTime) || new Date().toISOString(),
    startedAt: raw.startedAt ? toIso(raw.startedAt) : null,
    submission: toSubmission(test.id, raw.submission, test.language),
  }
}

const testPath = (testId: string) => `/api/tests/${encodeURIComponent(testId)}`

/* ---------------------------------------------------------------------- api */

export const examApi = {
  /**
   * Every test the signed-in user may see. For a student the server returns
   * only tests of classrooms their teacher added them to.
   */
  listForStudent: async (signal?: AbortSignal): Promise<TestSummary[]> => {
    const payload = await http.get<{ data: any[] }>('/api/tests', signal ? { signal } : {})
    return (unwrap(payload) ?? []).map((row) => toTestSummary(row))
  },

  /**
   * A teacher's view of one of their tests (with every test case). The
   * backend has no single-test route for teachers, so it is read from their
   * own test list, which carries the full documents.
   */
  getTest: async (testId: string, signal?: AbortSignal): Promise<TestDetail> => {
    const payload = await http.get<{ data: any[] }>('/api/tests', signal ? { signal } : {})
    const raw = (unwrap(payload) ?? []).find((row) => row.id === testId)
    if (!raw) {
      throw new ApiError('That test could not be found.', { status: 404, code: 'NOT_FOUND' })
    }
    const language = languageOf(raw.language)
    return toTestDetail({
      ...raw,
      // The owner sees every case in full, hidden ones included.
      questions: (Array.isArray(raw.questions) ? raw.questions : []).map((q: any) => ({
        ...q,
        testCases: (Array.isArray(q?.testCases) ? q.testCases : []).map((c: any) => ({ ...c, hidden: false })),
      })),
    }, { language })
  },

  /**
   * The lobby: details, server clock and own status, with no questions and no
   * timer start. When this student's attempt is already running (a reload
   * mid-exam), the questions are fetched too -- re-entering never moves the
   * latched start time.
   */
  getLobby: async (testId: string, signal?: AbortSignal): Promise<TestLobby> => {
    const payload = await http.get<{ data: any }>(`${testPath(testId)}/lobby`, signal ? { signal } : {})
    const lobby = toLobby(unwrap(payload))
    const windowOpen = (() => {
      const now = Date.parse(lobby.serverTime)
      return now >= Date.parse(lobby.test.windowStart) && now < Date.parse(lobby.test.windowEnd)
    })()
    if (lobby.startedAt && !lobby.submission && windowOpen) {
      const entry = await http.get<{ data: any }>(`${testPath(testId)}/entry`, {
        ...(signal ? { signal } : {}),
        retryOnUnauthorized: false,
      })
      const entered = toLobby(unwrap(entry))
      return { ...lobby, test: { ...lobby.test, questions: entered.test.questions } }
    }
    return lobby
  },

  /**
   * Starts this student's attempt and returns the lobby with the questions.
   * The server latches `startedAt` on the first entry and returns the same
   * value afterwards, so a reload or a double-click cannot reset the clock.
   */
  startAttempt: async (testId: string): Promise<TestLobby> => {
    const payload = await http.get<{ data: any }>(`${testPath(testId)}/entry`, {
      // A 401 mid-exam must not trigger the client's refresh-and-sign-out path:
      // that would throw away an in-progress attempt.
      retryOnUnauthorized: false,
    })
    const lobby = toLobby(unwrap(payload))
    // A submitted exam is closed: never hand back a fresh editor for it. (The
    // backend's save/submit routes refuse a locked submission as well.)
    if (lobby.submission) {
      throw new ApiError('You have already submitted this test.', { status: 409, code: 'CONFLICT' })
    }
    return lobby
  },

  submit: async (testId: string, input: SubmitInput): Promise<Submission> => {
    try {
      await http.post<{ message: string }>('/api/submissions', {
        body: {
          testId,
          // The answer shape the plagiarism engine reads: one program per test.
          answers: answersPayload(input),
        },
        // A 401 here must not trigger the client's refresh-and-sign-out path: the
        // exam shell re-checks the session itself and shows a re-auth prompt, and a
        // silent sign-out mid-exam would throw away the student's work.
        retryOnUnauthorized: false,
      })
    } catch (error) {
      // A retry after a lost response finds the submission already stored: the
      // backend's lock guard answers 403 "locked". That is success, not failure.
      const locked =
        error instanceof ApiError && error.status === 403 && /locked|already submitted/i.test(error.message)
      if (!locked) throw error
    }
    return {
      id: `${testId}_me`,
      testId,
      uid: '',
      language: input.language,
      code: input.code,
      status: 'QUEUED',
      idempotencyKey: input.idempotencyKey,
      submittedAt: new Date().toISOString(),
      score: null,
      maxScore: null,
    }
  },

  /** Saves an in-progress answer server-side (a draft; never final). */
  saveDraft: async (testId: string, input: Omit<SubmitInput, 'idempotencyKey'>): Promise<void> => {
    await http.post<{ message: string }>('/api/submissions/save', {
      body: { testId, answers: answersPayload(input) },
      retryOnUnauthorized: false,
    })
  },

  /**
   * Runs the student's code on the question's VISIBLE test cases (plus an
   * optional custom input) via `POST /api/judge0/tests/:testId/run`. Nothing is saved.
   * Rejects with status 503 while Judge0 is not configured on the server.
   */
  /**
   * Runs the code on the question's visible test cases (at most
   * `MAX_CASES_PER_RUN`, to stay inside the server's 10-runs-a-minute limit), or
   * on the student's own input. One backend run per input; nothing is saved.
   */
  run: async (
    testId: string,
    input: { code: string; language: ExamLanguage; cases: RunCase[]; customInput?: string },
  ): Promise<RunCaseResult[]> => {
    const code = sanitizeCode(input.code, 60_000)
    const jobs: RunCase[] =
      input.customInput !== undefined
        ? [{ id: 'custom', input: input.customInput, expected: null }]
        : input.cases.slice(0, MAX_CASES_PER_RUN)
    if (jobs.length === 0) jobs.push({ id: 'custom', input: '', expected: null })
    const results: RunCaseResult[] = []
    // One after another: parallel runs would trip the per-student rate limit.
    for (const job of jobs) {
      const raw = await runOnce(testId, code, input.language, job.input)
      results.push(toRunCaseResult(job, raw))
    }
    return results
  },

  /** This student's own submission for a test, or null. */
  mySubmission: async (testId: string, signal?: AbortSignal): Promise<Submission | null> => {
    const payload = await http.get<{ data: any }>(`${testPath(testId)}/lobby`, signal ? { signal } : {})
    return toLobby(unwrap(payload)).submission
  },
}
