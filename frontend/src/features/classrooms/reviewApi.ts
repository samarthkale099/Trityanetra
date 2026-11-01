import { http } from '@/shared/lib/httpClient'
import { sanitizeSearchTerm, sanitizeText } from '@/shared/lib/sanitize'
import { isExamLanguage, type ExamLanguage } from '@/shared/types/classroom'
import { toIso, unwrap } from '@/features/exam/examApi'

/**
 * Review HTTP surface: a teacher reading and grading one test's submissions.
 *
 * Backend routes (teacher-owner or admin only; ownership checked server-side):
 * - `GET  /api/submissions/test/:testId`                    -> roster with state, marks, flags
 * - `GET  /api/submissions/test/:testId/:studentId`         -> one student's answers
 * - `PUT  /api/submissions/test/:testId/:studentId/review`  -> save marks + comment
 * - `POST /api/tests/:testId/release`                       -> release results (idempotent)
 *
 * A "submission id" in this UI is the student's uid: the backend stores one
 * submission per test+student, so the student identifies it uniquely.
 *
 * Marks and a comment may be saved repeatedly and stay hidden from students
 * until release. After release a save is a `409`, and the values are frozen.
 *
 * Per-case PASS/FAIL arrives from automatic judging (Judge0). Until a
 * submission has been judged, `cases` is empty and the counts are 0.
 */

export type SubmissionState = 'SUBMITTED' | 'LATE' | 'NOT_SUBMITTED'

/** Monitor flag counts for one student, e.g. `{ TAB_SWITCH: 2, PASTE_ATTEMPT: 1 }`. Advisory only. */
export type FlagCounts = Partial<Record<'TAB_SWITCH' | 'DEVTOOLS_OPEN' | 'PASTE_ATTEMPT' | 'FULLSCREEN_EXIT', number>>

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
  /** Integrity flags raised during the exam. */
  flags?: FlagCounts
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
  /** Integrity flags raised during the exam. */
  flags?: FlagCounts
}

export interface SaveReviewInput {
  /** `null` clears any saved mark. */
  marks: number | null
  comment: string
}

/* ------------------------------------------------------------------ mapping */

const stateOf = (value: unknown): SubmissionState =>
  value === 'SUBMITTED' || value === 'LATE' ? value : 'NOT_SUBMITTED'

function toSummary(raw: any): SubmissionSummary {
  return {
    id: String(raw.studentId),
    studentUid: String(raw.studentId),
    studentName: String(raw.studentName ?? raw.studentEmail ?? ''),
    studentEmail: String(raw.studentEmail ?? ''),
    state: stateOf(raw.state),
    passedCases: Number(raw.passedCases) || 0,
    totalCases: Number(raw.totalCases) || 0,
    submittedAt: raw.submittedAt ? toIso(raw.submittedAt) : null,
    marks: typeof raw.marks === 'number' ? raw.marks : null,
    maxMarks: Number(raw.maxMarks) || 0,
    flags: raw.flags ?? {},
  }
}

function toList(raw: any): SubmissionsList {
  return {
    testId: String(raw.testId),
    testTitle: String(raw.testTitle ?? ''),
    maxMarks: Number(raw.maxMarks) || 0,
    resultsReleased: Boolean(raw.resultsReleasedAt),
    releasedAt: raw.resultsReleasedAt ? toIso(raw.resultsReleasedAt) : null,
    submissions: (Array.isArray(raw.submissions) ? raw.submissions : []).map(toSummary),
  }
}

/** The program text of a submission, whichever answer shape it was saved in. */
export function codeFromAnswers(answers: any): { code: string; language: ExamLanguage } {
  const language = isExamLanguage(answers?.language) ? answers.language : 'python'
  if (typeof answers?.code === 'string') return { code: answers.code, language }
  const questions = answers?.questions
  if (questions && typeof questions === 'object') {
    const parts = Object.keys(questions)
      .sort()
      .map((key) => `# ${key}\n${String(questions[key]?.code ?? '')}`)
    return { code: parts.join('\n\n'), language }
  }
  return { code: '', language }
}

function toDetail(raw: any): SubmissionReviewDetail {
  const { code, language } = codeFromAnswers(raw.answers)
  return {
    id: String(raw.studentId),
    testId: String(raw.testId),
    testTitle: String(raw.testTitle ?? ''),
    studentUid: String(raw.studentId),
    studentName: String(raw.studentName ?? raw.studentEmail ?? ''),
    studentEmail: String(raw.studentEmail ?? ''),
    state: stateOf(raw.state),
    language,
    code,
    submittedAt: raw.submittedAt ? toIso(raw.submittedAt) : null,
    cases: Array.isArray(raw.cases) ? raw.cases : [],
    passedCases: Number(raw.passedCases) || 0,
    totalCases: Number(raw.totalCases) || 0,
    marks: typeof raw.marks === 'number' ? raw.marks : null,
    maxMarks: Number(raw.maxMarks) || 0,
    comment: String(raw.comment ?? ''),
    resultsReleased: Boolean(raw.resultsReleasedAt),
    releasedAt: raw.resultsReleasedAt ? toIso(raw.resultsReleasedAt) : null,
    flags: raw.flags ?? {},
  }
}

const listPath = (testId: string) => `/api/submissions/test/${encodeURIComponent(testId)}`
const studentPath = (testId: string, studentId: string) =>
  `${listPath(testId)}/${encodeURIComponent(studentId)}`

/* ---------------------------------------------------------------------- api */

export const reviewApi = {
  /** The class list for one test, in roster order. Teacher/admin only. */
  listSubmissions: async (testId: string, signal?: AbortSignal): Promise<SubmissionsList> => {
    const payload = await http.get<{ data: any }>(listPath(testId), signal ? { signal } : {})
    return toList(unwrap(payload))
  },

  getSubmission: async (
    testId: string,
    submissionId: string,
    signal?: AbortSignal,
  ): Promise<SubmissionReviewDetail> => {
    const payload = await http.get<{ data: any }>(studentPath(testId, submissionId), signal ? { signal } : {})
    return toDetail(unwrap(payload))
  },

  /**
   * Saves marks and a comment for one submission. Repeatable until the results
   * are released; the server rejects a later save with a `409`.
   */
  saveReview: async (
    testId: string,
    submissionId: string,
    input: SaveReviewInput,
  ): Promise<SubmissionReviewDetail> => {
    const payload = await http.put<{ data: any }>(`${studentPath(testId, submissionId)}/review`, {
      body: { marks: input.marks, comment: sanitizeText(input.comment, 2000) },
    })
    return toDetail(unwrap(payload))
  },

  /** Releases every saved mark for the test, making results visible to students. */
  releaseResults: async (testId: string): Promise<SubmissionsList> => {
    await http.post(`/api/tests/${encodeURIComponent(testId)}/release`)
    return reviewApi.listSubmissions(testId)
  },
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
