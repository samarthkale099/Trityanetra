import { http } from '@/shared/lib/httpClient'
import { isExamLanguage, type ExamLanguage } from '@/shared/types/classroom'
import { toIso, unwrap } from '@/features/exam/examApi'

/**
 * A student's own result for one test.
 *
 * Like `examApi`, this route does not exist on the backend yet. The single route
 * and response shape live here so the screen, the mocks and the eventual server
 * all agree on one contract:
 *
 *   `GET /api/tests/:testId/result` -> `StudentResult`
 *
 * The server rules this relies on:
 *
 * - Identity comes from the bearer token, never from the URL. The submission is
 *   the caller's own; there is no submission id to guess.
 * - A caller with no submission for the test gets a 404, not a 403, so the route
 *   never confirms that someone else's submission exists.
 * - A teacher or admin gets a 403: they read results through the review screens,
 *   not here.
 * - A hidden test case reports only its PASS/FAIL state. Its input, expected and
 *   actual values are withheld (`null`) and must never travel to the client.
 * - Marks and the comment are withheld (`marks: null`, `comment: ''`,
 *   `marksReleased: false`) until the teacher releases them for the test.
 * - Plagiarism findings are never part of this payload.
 */
export interface ResultCase {
  id: string
  /** A label a student can read, e.g. "Test case 2". */
  name: string
  state: 'PASS' | 'FAIL'
  hidden: boolean
  /** null for a hidden case; the content must never be shown or sent. */
  input: string | null
  expected: string | null
  actual: string | null
}

export interface StudentResult {
  testId: string
  testTitle: string
  language: ExamLanguage
  /** 'SUBMITTED' was on time, 'LATE' was after the window closed. */
  state: 'SUBMITTED' | 'LATE'
  submittedAt: string
  passedCases: number
  totalCases: number
  cases: ResultCase[]
  marksReleased: boolean
  releasedAt: string | null
  /** Only ever the released value; null while marks are withheld. */
  marks: number | null
  maxMarks: number
  /** Only ever the released value; '' while the comment is withheld. */
  comment: string
}

/** The backend's `{ data }` result payload as a `StudentResult`. */
function toResult(raw: any): StudentResult {
  const language = isExamLanguage(raw?.answers?.language) ? raw.answers.language : 'python'
  const cases: ResultCase[] = Array.isArray(raw.cases) ? raw.cases : []
  return {
    testId: String(raw.testId),
    testTitle: String(raw.testTitle ?? ''),
    language,
    state: raw.state === 'LATE' ? 'LATE' : 'SUBMITTED',
    submittedAt: toIso(raw.submittedAt),
    passedCases: Number(raw.passedCases) || cases.filter((c) => c.state === 'PASS').length,
    totalCases: Number(raw.totalCases) || cases.length,
    cases,
    marksReleased: Boolean(raw.marksReleased),
    releasedAt: raw.resultsReleasedAt ? toIso(raw.resultsReleasedAt) : null,
    marks: raw.marksReleased && typeof raw.marks === 'number' ? raw.marks : null,
    maxMarks: Number(raw.maxMarks) || 0,
    comment: raw.marksReleased ? String(raw.comment ?? '') : '',
  }
}

export const resultApi = {
  /**
   * The signed-in student's own result for a test (`GET /api/tests/:id/result`).
   * Rejects with a 404-status `ApiError` when the caller did not submit the
   * test, or the test is unknown. Marks and the comment stay withheld by the
   * server until the teacher releases results.
   */
  getResult: async (testId: string, signal?: AbortSignal): Promise<StudentResult> => {
    const payload = await http.get<{ data: any }>(
      `/api/tests/${encodeURIComponent(testId)}/result`,
      signal ? { signal } : {},
    )
    return toResult(unwrap(payload))
  },
}
