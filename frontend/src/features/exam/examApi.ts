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

export interface SubmitInput {
  code: string
  language: ExamLanguage
  /**
   * Stable per attempt. The backend already stores exactly one submission per
   * test+student and answers a repeat idempotently; the key is kept so the
   * returned Submission stays stable across retries.
   */
  idempotencyKey: string
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
          answers: { language: input.language, code: sanitizeCode(input.code, 200_000) },
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
      body: { testId, answers: { language: input.language, code: sanitizeCode(input.code, 200_000) } },
      retryOnUnauthorized: false,
    })
  },

  /** This student's own submission for a test, or null. */
  mySubmission: async (testId: string, signal?: AbortSignal): Promise<Submission | null> => {
    const payload = await http.get<{ data: any }>(`${testPath(testId)}/lobby`, signal ? { signal } : {})
    return toLobby(unwrap(payload)).submission
  },
}
