import { http } from '@/shared/lib/httpClient'
import { sanitizeCode } from '@/shared/lib/sanitize'
import type {
  ExamLanguage,
  Submission,
  TestDetail,
  TestLobby,
  TestSummary,
} from '@/shared/types/classroom'

/**
 * Exam HTTP surface: reading a test, the lobby payload, and submitting.
 *
 * Like `classroomApi`, these routes do not exist on the backend yet (it ships
 * only `/api/health` and `/api/auth/*`). The contract is:
 *
 * - `GET  /api/tests`                   -> `TestSummary[]` for the classrooms the
 *                                          signed-in student has joined
 * - `GET  /api/tests/:testId`         -> `TestDetail` (hidden test cases stripped)
 * - `GET  /api/tests/:testId/lobby`   -> `TestLobby` (detail + `serverTime` + the
 *                                        latched `startedAt` + the caller's
 *                                        existing submission). Read-only: it
 *                                        never starts an attempt.
 * - `POST /api/tests/:testId/attempts` -> `TestLobby`, starting the attempt. The
 *                                        first call latches `startedAt`.
 * - `POST /api/tests/:testId/submissions` -> `Submission`, de-duplicated by the
 *                                        `idempotencyKey` in the body
 *
 * The server is the authority on the test window: it rejects a submission whose
 * `windowStart`/`windowEnd` has passed, and it re-checks the window on submit so
 * a client clock cannot buy extra time.
 */

export interface SubmitInput {
  code: string
  language: ExamLanguage
  /**
   * Stable per attempt. Generated once when the exam opens and reused on every
   * retry, so a double-click or a network retry stores one submission rather
   * than two.
   */
  idempotencyKey: string
}

export const examApi = {
  /**
   * Every test the signed-in student may sit, across the classrooms they have
   * joined. The college and enrolment filter is the server's; the client sends no
   * scope parameter that could widen it.
   */
  listForStudent: (signal?: AbortSignal): Promise<TestSummary[]> =>
    http.get<TestSummary[]>('/api/tests', signal ? { signal } : {}),

  getTest: (testId: string, signal?: AbortSignal): Promise<TestDetail> =>
    http.get<TestDetail>(`/api/tests/${encodeURIComponent(testId)}`, signal ? { signal } : {}),

  getLobby: (testId: string, signal?: AbortSignal): Promise<TestLobby> =>
    http.get<TestLobby>(`/api/tests/${encodeURIComponent(testId)}/lobby`, signal ? { signal } : {}),

  /**
   * Starts this student's attempt and returns the refreshed lobby.
   *
   * Idempotent by construction: the server latches `startedAt` on the first
   * successful call and returns the same value afterwards, so a reload or a
   * double-click cannot hand back a fresh clock. Rejected once the window has
   * closed or a submission already exists.
   *
   * It exists so that *previewing* the lobby costs no time. Latching the attempt
   * on the lobby read instead would start the countdown while a student was still
   * reading the rules.
   */
  startAttempt: (testId: string): Promise<TestLobby> =>
    http.post<TestLobby>(`/api/tests/${encodeURIComponent(testId)}/attempts`, {
      // A 401 mid-exam must not trigger the client's refresh-and-sign-out path:
      // that would throw away an in-progress attempt.
      retryOnUnauthorized: false,
    }),

  submit: (testId: string, input: SubmitInput): Promise<Submission> =>
    http.post<Submission>(`/api/tests/${encodeURIComponent(testId)}/submissions`, {
      body: {
        code: sanitizeCode(input.code, 200_000),
        language: input.language,
        idempotencyKey: input.idempotencyKey,
      },
      // A 401 here must not trigger the client's refresh-and-sign-out path: the
      // exam shell re-checks the session itself and shows a re-auth prompt, and a
      // silent sign-out mid-exam would throw away the student's work.
      retryOnUnauthorized: false,
    }),

  mySubmission: (testId: string, signal?: AbortSignal): Promise<Submission | null> =>
    http.get<Submission | null>(
      `/api/tests/${encodeURIComponent(testId)}/submissions/mine`,
      signal ? { signal } : {},
    ),
}
