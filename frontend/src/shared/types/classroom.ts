/**
 * Domain types for College -> Classroom -> Test -> Submission.
 *
 * The `users` document shape lives in `index.ts` because the backend already
 * serves it. Everything here describes collections the backend *declares*
 * (`backend/src/db/collections.ts`: `colleges`, `classrooms`, `tests`,
 * `questions`, `submissions`, `monitorFlags`) but does not yet expose over HTTP.
 *
 * @see docs/frontend-report.md#8-backend-issues-or-mismatches-found-not-changed
 */

export interface College {
  id: string
  name: string
  /** Domain a student signup must match, e.g. `mit.ac.in`. */
  emailDomain: string
}

export interface Classroom {
  id: string
  /** Server-scoped: a teacher only ever sees classrooms from their own college. */
  collegeId: string
  name: string
  subject: string
  description: string
  /** uid of the owning teacher. */
  teacherId: string
  teacherName: string
  /**
   * Legacy field from the join-code flow. Enrolment is now teacher-only (see
   * `classroomApi.addStudents`), so the UI never shows or uses it.
   */
  joinCode?: string
  studentCount: number
  testCount: number
  createdAt: string
}

/**
 * A student on a classroom's roster. The roster is teacher-only.
 *
 * Students are added by their teacher, by email. An email that has not
 * registered yet is still accepted -- it is `pending`, with an empty `uid` and
 * no display name -- and the classroom appears for that student as soon as they
 * sign up with that email.
 */
export interface ClassroomStudent {
  /** Empty while `pending`. */
  uid: string
  email: string
  /** Empty while `pending`. */
  displayName: string
  /** When the teacher added this email. */
  joinedAt: string
  /** True until someone registers with this email. */
  pending: boolean
}

export type TestStatus = 'UPCOMING' | 'LIVE' | 'ENDED'

/** Languages a test may be authored and answered in. */
export const EXAM_LANGUAGES = ['javascript', 'python', 'java', 'cpp'] as const
export type ExamLanguage = (typeof EXAM_LANGUAGES)[number]

export const LANGUAGE_LABELS: Readonly<Record<ExamLanguage, string>> = {
  javascript: 'JavaScript',
  python: 'Python',
  java: 'Java',
  cpp: 'C++',
}

export function isExamLanguage(value: unknown): value is ExamLanguage {
  return typeof value === 'string' && (EXAM_LANGUAGES as readonly string[]).includes(value)
}

export interface TestCase {
  id: string
  /** Shown to the student. Hidden ones are sent as `input: null`. */
  input: string | null
  expected: string | null
  hidden: boolean
}

export interface Question {
  id: string
  prompt: string
  starterCode: string
  language: ExamLanguage
  testCases: TestCase[]
  points: number
  order: number
}

/** A test as the teacher list sees it: metadata only, never the questions. */
export interface TestSummary {
  id: string
  classroomId: string
  title: string
  language: ExamLanguage
  windowStart: string
  windowEnd: string
  durationMinutes: number
  questionCount: number
  totalPoints: number
  submittedCount: number
  /**
   * The id of *this* signed-in student's submission for the test, or `null`.
   *
   * Server-derived from the verified token, never sent by the client, so it is
   * the one honest signal the dashboard has that a "View result" action will
   * find something. It is `null` for a teacher, whose own attempts do not exist.
   */
  mySubmissionId: string | null
  createdAt: string
}

/** A test as a student may see it in the lobby: no hidden test cases. */
export interface TestDetail {
  id: string
  classroomId: string
  classroomName: string
  title: string
  instructions: string
  language: ExamLanguage
  windowStart: string
  windowEnd: string
  durationMinutes: number
  questions: Question[]
  totalPoints: number
  /**
   * Number of questions. The lobby carries this without the questions
   * themselves -- they are only sent once the attempt starts.
   */
  questionCount?: number
}

/** The classroom detail response: a classroom plus its roster and test list. */
export interface ClassroomDetail extends Classroom {
  students: ClassroomStudent[]
  tests: TestSummary[]
}

export type SubmissionStatus = 'QUEUED' | 'GRADING' | 'GRADED' | 'FAILED'

export interface Submission {
  id: string
  testId: string
  uid: string
  language: ExamLanguage
  code: string
  status: SubmissionStatus
  /**
   * Client-generated key. The server treats a repeat of the same key as the same
   * submission, which is what makes a double-clicked submit button safe.
   */
  idempotencyKey: string
  submittedAt: string
  score: number | null
  maxScore: number | null
}

/** The student's view of one test: enough to render the lobby and gate the exam. */
export interface TestLobby {
  test: TestDetail
  /**
   * Server clock at response time. The client measures the offset against its own
   * clock and counts down from that, so a wrong device clock cannot let a student
   * into a test that has not opened.
   */
  serverTime: string
  /**
   * When this student's attempt at the test began, or `null` if they have not
   * started yet.
   *
   * The per-attempt allowance runs from here, not from `windowStart`, so a
   * student who opens a test halfway through the window still gets the full
   * `durationMinutes`. The server latches this on the first sit-able lobby read
   * and never rewrites it, which is what stops a reload from buying extra time.
   */
  startedAt: string | null
  submission: Submission | null
}
