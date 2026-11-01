import { http } from '@/shared/lib/httpClient'
import { sanitizeSearchTerm, sanitizeText } from '@/shared/lib/sanitize'
import type { ExamLanguage } from '@/shared/types/classroom'

/**
 * Review HTTP surface: a teacher reading and grading one test's submissions.
 *
 * NOTE: like `classroomApi` and `examApi`, the backend does not implement these
 * routes yet (`docs/frontend-report.md` §8). The shapes below are the contract
 * this frontend is written against; MSW implements exactly them
 * (`src/tests/msw/classroomHandlers.ts`). If the backend is implemented
 * differently, change the paths and body keys here and nothing else.
 *
 * Routes:
 * - `GET  /api/tests/:testId/submissions`                       -> `SubmissionsList`
 * - `GET  /api/tests/:testId/submissions/:submissionId`        -> `SubmissionReviewDetail`
 * - `PUT  /api/tests/:testId/submissions/:submissionId/review` -> `SubmissionReviewDetail`
 * - `POST /api/tests/:testId/submissions/release`              -> `SubmissionsList`
 *
 * Rules the frontend relies on and the backend must enforce:
 * - Every route is teacher/admin only. A student's request is refused rather
 *   than silently scoped down, so a wrong-role screen fails loudly.
 * - A submission id encodes the student: `sub-{testId}-{studentUid}` once one
 *   exists, `pending-{testId}-{studentUid}` while the student has not submitted.
 *   The server derives the student from the classroom roster, never from a body.
 * - Marks and a comment may be saved repeatedly and stay hidden from students
 *   until `release`. After release a save is a `409 CONFLICT`, and the values are
 *   frozen.
 * - A hidden test case's `input`, `expected`, and `actual` are never sent: only
 *   its PASS/FAIL `state`, so a teacher can grade without the case leaking.
 * - A test in another college is reported as missing (404), not refused (403),
 *   so its existence is not confirmed.
 */

export type SubmissionState = 'SUBMITTED' | 'LATE' | 'NOT_SUBMITTED'

/** One row of the review list. Carries no code and no case detail. */
export interface SubmissionSummary {
  id: string
  studentUid: string
  studentName: string
  studentEmail: string
  state: SubmissionState
  passedCases: number
  totalCases: number
  /** ISO-8601, or `null` for a student who did not submit. */
  submittedAt: string | null
  /** Saved by the teacher, hidden from the student until release. */
  marks: number | null
  maxMarks: number
}

export interface SubmissionsList {
  testId: string
  testTitle: string
  maxMarks: number
  /** False until the teacher presses "Release results". */
  resultsReleased: boolean
  releasedAt: string | null
  submissions: SubmissionSummary[]
}

export type CaseResultState = 'PASS' | 'FAIL'

/**
 * One test case as the teacher sees it. A hidden case reports its `state` but
 * `input`, `expected`, and `actual` are all `null` — the content never leaves the
 * server for a case the students must not see.
 */
export interface CaseResult {
  id: string
  name: string
  state: CaseResultState
  hidden: boolean
  input: string | null
  expected: string | null
  actual: string | null
}

export interface SubmissionReviewDetail {
  id: string
  testId: string
  testTitle: string
  studentUid: string
  studentName: string
  studentEmail: string
  state: SubmissionState
  language: ExamLanguage
  code: string
  submittedAt: string | null
  cases: CaseResult[]
  passedCases: number
  totalCases: number
  marks: number | null
  maxMarks: number
  comment: string
  resultsReleased: boolean
  releasedAt: string | null
}

export interface SaveReviewInput {
  /** `null` clears any saved mark. */
  marks: number | null
  comment: string
}

const path = (testId: string) => `/api/tests/${encodeURIComponent(testId)}/submissions`

export const reviewApi = {
  /** The class list for one test, in roster order. Teacher/admin only. */
  listSubmissions: (testId: string, signal?: AbortSignal): Promise<SubmissionsList> =>
    http.get<SubmissionsList>(path(testId), signal ? { signal } : {}),

  getSubmission: (
    testId: string,
    submissionId: string,
    signal?: AbortSignal,
  ): Promise<SubmissionReviewDetail> =>
    http.get<SubmissionReviewDetail>(
      `${path(testId)}/${encodeURIComponent(submissionId)}`,
      signal ? { signal } : {},
    ),

  /**
   * Saves marks and a comment for one submission. Repeatable until the results
   * are released; the server rejects a later save with a `409`.
   */
  saveReview: (
    testId: string,
    submissionId: string,
    input: SaveReviewInput,
  ): Promise<SubmissionReviewDetail> =>
    http.put<SubmissionReviewDetail>(`${path(testId)}/${encodeURIComponent(submissionId)}/review`, {
      body: { marks: input.marks, comment: sanitizeText(input.comment, 2000) },
    }),

  /** Releases every saved mark for the test, making results visible to students. */
  releaseResults: (testId: string): Promise<SubmissionsList> =>
    http.post<SubmissionsList>(`${path(testId)}/release`),
}

/** Client-side search over an already-fetched list, across name and email. */
export function filterSubmissionsByStudent(
  submissions: SubmissionSummary[],
  term: string,
): SubmissionSummary[] {
  const needle = sanitizeSearchTerm(term)
  if (needle.length === 0) return submissions
  return submissions.filter((submission) =>
    `${submission.studentName} ${submission.studentEmail}`.toLowerCase().includes(needle),
  )
}
