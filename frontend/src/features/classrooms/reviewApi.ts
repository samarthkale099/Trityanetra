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

/* ------------------------------------------------------------- integrity */

export type FlagType = 'TAB_SWITCH' | 'DEVTOOLS_OPEN' | 'PASTE_ATTEMPT' | 'FULLSCREEN_EXIT'

export const FLAG_LABELS: Readonly<Record<FlagType, string>> = {
  TAB_SWITCH: 'Left the exam tab',
  DEVTOOLS_OPEN: 'Opened developer tools',
  PASTE_ATTEMPT: 'Tried to paste',
  FULLSCREEN_EXIT: 'Exited fullscreen',
}

export interface StudentIntegrity {
  studentId: string
  studentName: string
  studentEmail: string
  total: number
  counts: FlagCounts
  flags: { flagType: FlagType; at: string | null }[]
}

export interface IntegrityReport {
  testId: string
  /** Students with at least one flag, most-flagged first. Advisory only. */
  students: StudentIntegrity[]
}

/* ------------------------------------------------------------ plagiarism */

export type PlagiarismStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
export type FlagLevel = 'high' | 'medium' | 'low' | 'none'

export interface PlagiarismPair {
  submissionA: string
  submissionB: string
  studentA: { id: string; name: string; email: string }
  studentB: { id: string; name: string; email: string }
  metrics: {
    cosine_similarity: number
    ted_score: number
    identifier_overlap: number
    operator_overlap: number
    combined_score: number
  }
  flagLevel: FlagLevel
}

export interface PlagiarismResult {
  /** `null` when no check has been run for this test yet. */
  status: PlagiarismStatus | null
  pairs: PlagiarismPair[]
  flagged: PlagiarismPair[]
  summary: { totalSubmissions: number; totalPairs: number; flaggedPairs: number; processingTimeMs: number } | null
  /** Submissions left out, keyed by submission id, with the reason (e.g. not Python). */
  skipped: Record<string, string>
  /** e.g. "Not enough valid submissions to check (minimum 2 required)". */
  message: string | null
  error: string | null
  updatedAt: string | null
}

const studentFromSubmission = (testId: string, submissionId: string) =>
  submissionId.startsWith(`${testId}_`) ? submissionId.slice(testId.length + 1) : submissionId

function toPair(testId: string, raw: any): PlagiarismPair {
  const person = (value: any, submissionId: string) => ({
    id: String(value?.id ?? studentFromSubmission(testId, submissionId)),
    name: String(value?.name ?? studentFromSubmission(testId, submissionId)),
    email: String(value?.email ?? ''),
  })
  return {
    submissionA: String(raw.submissionA),
    submissionB: String(raw.submissionB),
    studentA: person(raw.studentA, String(raw.submissionA)),
    studentB: person(raw.studentB, String(raw.submissionB)),
    metrics: raw.metrics,
    flagLevel: raw.flagLevel ?? 'none',
  }
}

export const integrityApi = {
  /**
   * The test's integrity report (`GET /api/monitor/:testId/flags`): every
   * advisory flag, grouped per student. Teacher-owner only.
   */
  getReport: async (testId: string, signal?: AbortSignal): Promise<IntegrityReport> => {
    const payload = await http.get<{ data: any }>(
      `/api/monitor/${encodeURIComponent(testId)}/flags`,
      signal ? { signal } : {},
    )
    const raw = unwrap(payload)
    return {
      testId: String(raw.testId ?? testId),
      students: (Array.isArray(raw.students) ? raw.students : []).map((student: any) => ({
        studentId: String(student.studentId),
        studentName: String(student.studentName ?? student.studentEmail ?? student.studentId),
        studentEmail: String(student.studentEmail ?? ''),
        total: Number(student.total) || 0,
        counts: student.counts ?? {},
        flags: (Array.isArray(student.flags) ? student.flags : []).map((flag: any) => ({
          flagType: flag.flagType,
          at: flag.at ? toIso(flag.at) : null,
        })),
      })),
    }
  },
}

export const plagiarismApi = {
  /** Queues an AST similarity check over every submitted answer (`202`). */
  check: async (testId: string): Promise<void> => {
    await http.post(`/api/plagiarism/${encodeURIComponent(testId)}/check`)
  },

  /** The latest check's status and results; `status: null` when none has run. */
  getResult: async (testId: string, signal?: AbortSignal): Promise<PlagiarismResult> => {
    try {
      const raw = await http.get<any>(`/api/plagiarism/${encodeURIComponent(testId)}/status`, signal ? { signal } : {})
      return {
        status: raw?.status ?? null,
        pairs: (Array.isArray(raw?.pairs) ? raw.pairs : []).map((pair: any) => toPair(testId, pair)),
        flagged: (Array.isArray(raw?.flagged) ? raw.flagged : []).map((pair: any) => toPair(testId, pair)),
        summary: raw?.summary ?? null,
        skipped: raw?.skipped ?? {},
        message: raw?.message ?? null,
        error: raw?.error ?? null,
        updatedAt: raw?.updatedAt ? toIso(raw.updatedAt) : null,
      }
    } catch (error) {
      // 404 means "never checked", which the page shows as an empty state.
      if ((error as { status?: number })?.status === 404) {
        return { status: null, pairs: [], flagged: [], summary: null, skipped: {}, message: null, error: null, updatedAt: null }
      }
      throw error
    }
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
