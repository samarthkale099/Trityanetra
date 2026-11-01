import { http } from '@/shared/lib/httpClient'
import { sanitizeCode, sanitizeSearchTerm, sanitizeText } from '@/shared/lib/sanitize'
import type {
  Classroom,
  ClassroomDetail,
  ExamLanguage,
  TestSummary,
} from '@/shared/types/classroom'

/**
 * Classroom HTTP surface.
 *
 * NOTE: the backend does not implement these routes yet. It ships only
 * `GET /api/health` and the three `/api/auth` routes; `colleges`, `classrooms`
 * and `tests` exist in `backend/src/db/collections.ts` as constants but are never
 * read or written (`docs/frontend-report.md` §8). The shapes below are the
 * contract this frontend is written against, derived from the documented data
 * model and Phase 1's conventions: bearer-authenticated, JSON bodies, and the
 * backend's `{ message, code, details? }` error envelope. MSW implements exactly
 * these shapes (`src/tests/msw/handlers.ts`), so every screen is exercised
 * against them. If the backend is implemented differently, change the paths and
 * body keys here and nothing else.
 *
 * Security rules the frontend relies on and the backend must enforce:
 * - `GET /api/classrooms` is filtered by the caller's `collegeId`, from the
 *   verified token. A `collegeId` query parameter is never honoured.
 * - `GET /api/classrooms/:id` 404s for a classroom in another college, and
 *   403s when the caller is not its teacher.
 * - Enrolment is teacher-only. `POST /api/classrooms/:id/students` and
 *   `DELETE /api/classrooms/:id/students/:email` are for the classroom's own
 *   teacher; there is no student-facing join route.
 * - `GET /api/classrooms/mine` and `GET /api/tests` match a student to the
 *   classrooms they were added to by the email in their verified token, so an
 *   email added before it registered sees its classrooms on first sign-in.
 */

export interface CreateClassroomInput {
  name: string
  subject: string
  description?: string
}

export interface CreateTestInput {
  title: string
  instructions?: string
  language: ExamLanguage
  /** ISO-8601. */
  windowStart: string
  /** ISO-8601. */
  windowEnd: string
  durationMinutes: number
  questions: {
    prompt: string
    starterCode?: string
    points: number
    /** Kept private: sent for grading, never returned in a `TestSummary`. */
    testCases: { input: string; expected: string; hidden: boolean }[]
  }[]
}

export interface AddStudentsResult {
  /** The classroom after the change, roster included. */
  classroom: ClassroomDetail
  /** Emails newly added by this request. */
  added: string[]
  /** Emails that were already on the roster; adding is idempotent. */
  alreadyEnrolled: string[]
}

/** Strips control characters and caps length before a value is sent to the server. */
function clean(value: string, max: number): string {
  return sanitizeText(value, max)
}

export const classroomApi = {
  /**
   * Classrooms the signed-in teacher owns. Scoped to their college server-side.
   */
  listMine: (signal?: AbortSignal): Promise<Classroom[]> =>
    http.get<Classroom[]>('/api/classrooms', signal ? { signal } : {}),

  /** Classrooms the signed-in student has joined. */
  listJoined: (signal?: AbortSignal): Promise<Classroom[]> =>
    http.get<Classroom[]>('/api/classrooms/mine', signal ? { signal } : {}),

  get: (classroomId: string, signal?: AbortSignal): Promise<ClassroomDetail> =>
    http.get<ClassroomDetail>(`/api/classrooms/${encodeURIComponent(classroomId)}`, signal ? { signal } : {}),

  create: (input: CreateClassroomInput): Promise<Classroom> =>
    http.post<Classroom>('/api/classrooms', {
      body: {
        name: clean(input.name, 120),
        subject: clean(input.subject, 80),
        description: clean(input.description ?? '', 500),
      },
    }),

  /**
   * Adds students by email (teacher only). Emails are lower-cased and
   * de-duplicated here as well as on the server. Unregistered emails are
   * accepted and show on the roster as pending.
   */
  addStudents: (classroomId: string, emails: string[]): Promise<AddStudentsResult> =>
    http.post<AddStudentsResult>(`/api/classrooms/${encodeURIComponent(classroomId)}/students`, {
      body: {
        emails: [...new Set(emails.map((email) => clean(email, 254).toLowerCase()))],
      },
    }),

  /** Removes one student from the roster (teacher only). Their past submissions are kept. */
  removeStudent: (classroomId: string, email: string): Promise<ClassroomDetail> =>
    http.delete<ClassroomDetail>(
      `/api/classrooms/${encodeURIComponent(classroomId)}/students/${encodeURIComponent(email.toLowerCase())}`,
    ),

  listTests: (classroomId: string, signal?: AbortSignal): Promise<TestSummary[]> =>
    http.get<TestSummary[]>(
      `/api/classrooms/${encodeURIComponent(classroomId)}/tests`,
      signal ? { signal } : {},
    ),

  createTest: (classroomId: string, input: CreateTestInput): Promise<TestSummary> => {
    const body = {
      title: clean(input.title, 120),
      instructions: clean(input.instructions ?? '', 1000),
      language: input.language,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      durationMinutes: input.durationMinutes,
      questions: input.questions.map((question, index) => ({
        prompt: clean(question.prompt, 2000),
        // Code keeps its indentation and newlines, so it uses the code sanitizer
        // rather than the whitespace-collapsing text one.
        starterCode: sanitizeCode(question.starterCode ?? '', 20_000),
        points: question.points,
        order: index,
        testCases: question.testCases.map((testCase) => ({
          input: sanitizeCode(testCase.input, 4000),
          expected: sanitizeCode(testCase.expected, 4000),
          hidden: testCase.hidden,
        })),
      })),
    }
    return http.post<TestSummary>(`/api/classrooms/${encodeURIComponent(classroomId)}/tests`, { body })
  },
}

/** Normalised free-text search applied client-side to an already-fetched list. */
export function filterClassroomsByTerm(classrooms: Classroom[], term: string): Classroom[] {
  const needle = sanitizeSearchTerm(term)
  if (needle.length === 0) return classrooms
  return classrooms.filter((classroom) =>
    `${classroom.name} ${classroom.subject} ${classroom.teacherName}`
      .toLowerCase()
      .includes(needle),
  )
}
