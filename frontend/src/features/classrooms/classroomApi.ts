import { http } from '@/shared/lib/httpClient'
import { sanitizeCode, sanitizeSearchTerm, sanitizeText } from '@/shared/lib/sanitize'
import { examApi, toIso, toTestSummary, unwrap } from '@/features/exam/examApi'
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
  /** Emails newly added by this request (registered students and new invites). */
  added: string[]
  /** Emails that were already on the roster or already invited; adding is idempotent. */
  alreadyEnrolled: string[]
  /** Emails the server refused, with its reason (not a student, another college, ...). */
  rejected: { email: string; reason: string }[]
}

/** Strips control characters and caps length before a value is sent to the server. */
function clean(value: string, max: number): string {
  return sanitizeText(value, max)
}

/* ------------------------------------------------------------------ mapping */

/** A row of `GET /api/classrooms` (teacher document or student summary) as a `Classroom`. */
function toClassroom(raw: any): Classroom {
  return {
    id: String(raw.id),
    collegeId: String(raw.collegeId ?? ''),
    name: String(raw.name ?? 'Untitled classroom'),
    subject: String(raw.subject ?? ''),
    description: String(raw.description ?? ''),
    teacherId: String(raw.teacherId ?? ''),
    teacherName: String(raw.teacherName ?? ''),
    studentCount:
      typeof raw.studentCount === 'number'
        ? raw.studentCount + (Number(raw.invitedCount) || 0)
        : Array.isArray(raw.students)
          ? raw.students.length
          : 0,
    testCount: Number(raw.testCount) || 0,
    createdAt: toIso(raw.createdAt),
  }
}

/**
 * The backend's classroom detail plus the teacher's full test rows (which
 * carry submission counts and points) as a `ClassroomDetail`.
 */
function toClassroomDetail(raw: any, tests: TestSummary[]): ClassroomDetail {
  const students = (Array.isArray(raw.students) ? raw.students : []).map((student: any) => ({
    uid: String(student.uid ?? ''),
    email: String(student.email ?? ''),
    displayName: String(student.displayName ?? ''),
    joinedAt: toIso(student.joinedAt) || toIso(raw.createdAt),
    pending: Boolean(student.pending),
  }))
  const ownTests = tests.filter((test) => test.classroomId === raw.id)
  return {
    ...toClassroom({ ...raw, students: undefined }),
    studentCount: students.length,
    testCount: ownTests.length,
    students,
    tests: ownTests,
  }
}

const classroomPath = (classroomId: string) => `/api/classrooms/${encodeURIComponent(classroomId)}`

/* ---------------------------------------------------------------------- api */

export const classroomApi = {
  /**
   * Classrooms the signed-in teacher owns. Scoped to their college server-side.
   */
  listMine: async (signal?: AbortSignal): Promise<Classroom[]> => {
    const payload = await http.get<{ data: any[] }>('/api/classrooms', signal ? { signal } : {})
    return (unwrap(payload) ?? []).map(toClassroom)
  },

  /**
   * Classrooms the signed-in student was added to. Same route as the teacher
   * list: the server scopes it by role, and gives a student no roster data.
   */
  listJoined: async (signal?: AbortSignal): Promise<Classroom[]> => {
    const payload = await http.get<{ data: any[] }>('/api/classrooms', signal ? { signal } : {})
    return (unwrap(payload) ?? []).map(toClassroom)
  },

  get: async (classroomId: string, signal?: AbortSignal): Promise<ClassroomDetail> => {
    const [detail, tests] = await Promise.all([
      http.get<{ data: any }>(classroomPath(classroomId), signal ? { signal } : {}),
      examApi.listForStudent(signal),
    ])
    return toClassroomDetail(unwrap(detail), tests)
  },

  create: async (input: CreateClassroomInput): Promise<Classroom> => {
    const body = {
      name: clean(input.name, 120),
      subject: clean(input.subject, 80),
      description: clean(input.description ?? '', 500),
    }
    const payload = await http.post<{ data: { id: string } }>('/api/classrooms', { body })
    return toClassroom({ ...body, id: unwrap(payload).id, createdAt: new Date().toISOString() })
  },

  /**
   * Adds students by email (teacher only). Emails are lower-cased and
   * de-duplicated here as well as on the server. Unregistered emails are
   * accepted as invites and show on the roster as pending.
   */
  addStudents: async (classroomId: string, emails: string[]): Promise<AddStudentsResult> => {
    const [payload, tests] = await Promise.all([
      http.post<{ result: any; data: any }>(`${classroomPath(classroomId)}/students`, {
        body: { emails: [...new Set(emails.map((email) => clean(email, 254).toLowerCase()))] },
      }),
      examApi.listForStudent(),
    ])
    const result = payload.result ?? {}
    return {
      classroom: toClassroomDetail(payload.data, tests),
      added: [...(result.added ?? []), ...(result.invited ?? [])],
      alreadyEnrolled: result.alreadyEnrolled ?? [],
      rejected: result.rejected ?? [],
    }
  },

  /** Removes one student (or a pending invite) from the roster. Their past submissions are kept. */
  removeStudent: async (classroomId: string, email: string): Promise<ClassroomDetail> => {
    const [payload, tests] = await Promise.all([
      http.delete<{ data: any }>(`${classroomPath(classroomId)}/students/${encodeURIComponent(email.toLowerCase())}`),
      examApi.listForStudent(),
    ])
    return toClassroomDetail(unwrap(payload), tests)
  },

  listTests: async (classroomId: string, signal?: AbortSignal): Promise<TestSummary[]> =>
    (await examApi.listForStudent(signal)).filter((test) => test.classroomId === classroomId),

  createTest: async (classroomId: string, input: CreateTestInput): Promise<TestSummary> => {
    const body = {
      classroomId,
      title: clean(input.title, 120),
      instructions: clean(input.instructions ?? '', 1000),
      language: input.language,
      startTime: input.windowStart,
      endTime: input.windowEnd,
      durationMinutes: input.durationMinutes,
      questions: input.questions.map((question, index) => ({
        // Stable ids: the Run button and per-question answers refer to them.
        id: `q${index + 1}`,
        prompt: clean(question.prompt, 2000),
        // Code keeps its indentation and newlines, so it uses the code sanitizer
        // rather than the whitespace-collapsing text one.
        starterCode: sanitizeCode(question.starterCode ?? '', 20_000),
        points: question.points,
        order: index,
        testCases: question.testCases.map((testCase, caseIndex) => ({
          id: `c${caseIndex + 1}`,
          input: sanitizeCode(testCase.input, 4000),
          expected: sanitizeCode(testCase.expected, 4000),
          hidden: testCase.hidden,
        })),
      })),
    }
    const payload = await http.post<{ data: { id: string } }>('/api/tests', { body })
    return toTestSummary({ ...body, id: unwrap(payload).id, createdAt: new Date().toISOString() })
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
