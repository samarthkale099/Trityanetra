import type { Page, Route } from '@playwright/test'

/**
 * In-memory Phase 2/3 backend for the Playwright suite.
 *
 * Deliberately separate from the MSW handlers in `src/tests/msw`, even though
 * both implement the same contract. MSW runs inside the page and serves every
 * unit and component test; this runs in the Playwright driver and has to answer
 * real network requests. Sharing the data would couple the two suites for no
 * benefit, so only the *shape* is mirrored, and `shared/types/classroom.ts` is
 * the single source of truth for it.
 *
 * Identity always comes from the bearer token, exactly as the Express backend
 * would verify one. A request without a token is rejected, so a frontend that
 * forgets to authenticate fails these tests rather than quietly passing.
 */

const COLLEGE_ID = 'college-mit'
const TEACHER_EMAIL = 'aditya.teacher@mit.ac.in'

const ROLES: Record<string, 'STUDENT' | 'TEACHER' | 'ADMIN'> = {
  [TEACHER_EMAIL]: 'TEACHER',
}

type Language = 'javascript' | 'python' | 'java' | 'cpp'

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

function notFound(route: Route, message: string) {
  return json(route, { message, code: 'NOT_FOUND' }, 404)
}

function forbidden(route: Route, message: string) {
  return json(route, { message, code: 'FORBIDDEN' }, 403)
}

function methodNotAllowed(route: Route, allow: string) {
  return json(route, { message: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' }, 405, allow)
}

function notImplemented(route: Route) {
  return json(route, { message: 'Not stubbed for this suite.', code: 'NOT_STUBBED' }, 501)
}

function fail(route: Route, message: string) {
  return json(route, { message, code: 'VALIDATION_ERROR' }, 400)
}

/**
 * `e2e-id-token|<uid>|<email>` -> email. The uid is deliberately not used for
 * lookups: the email is the claim a real backend maps to a role document, which
 * keeps the role decision out of the client's hands.
 */
function emailFrom(request: { headers(): Record<string, string> }): string | null {
  const header = request.headers().authorization ?? ''
  if (!header.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length).split('|')[2] ?? null
}

function requireAuth(route: Route): string | null {
  const email = emailFrom(route.request())
  if (!email) {
    void json(route, { message: 'Sign in to continue.', code: 'MISSING_TOKEN' }, 401)
    return null
  }
  return email
}

function requireTeacher(route: Route, email: string): boolean {
  if (ROLES[email] === 'TEACHER' || ROLES[email] === 'ADMIN') return true
  void forbidden(route, "You don't have permission to do that.")
  return false
}

interface TestCase {
  id: string
  input: string | null
  expected: string | null
  hidden: boolean
}

interface Question {
  id: string
  prompt: string
  starterCode: string
  language: Language
  testCases: TestCase[]
  points: number
  order: number
}

interface Test {
  id: string
  classroomId: string
  classroomName: string
  title: string
  instructions: string
  language: Language
  windowStart: string
  windowEnd: string
  durationMinutes: number
  questions: Question[]
  createdAt: string
}

interface Classroom {
  id: string
  collegeId: string
  name: string
  subject: string
  description: string
  teacherId: string
  teacherName: string
  joinCode?: string
  studentCount: number
  testCount: number
  createdAt: string
}

interface RosterEntry {
  classroomId: string
  /** Empty while `pending`. */
  uid: string
  email: string
  /** Empty while `pending`. */
  displayName: string
  joinedAt: string
  /** Added by the teacher but not registered yet. */
  pending: boolean
}

/** Accounts the suites sign in as; adding any other email makes a pending invite. */
const KNOWN_ACCOUNTS: Record<string, string> = {
  'riya.student@mit.ac.in': 'Riya Sharma',
  'kabir.mehta@mit.ac.in': 'Kabir Mehta',
  'aarav.iyer@mit.ac.in': 'Aarav Iyer',
  'meera.nair@mit.ac.in': 'Meera Nair',
  'dev.classmate@mit.ac.in': 'Dev Classmate',
}

export interface E2EBackendState {
  classrooms: Classroom[]
  tests: Test[]
  roster: RosterEntry[]
  submissions: Record<string, unknown>[]
  monitorEvents: Record<string, unknown>[]
  /** `${testId}:${email}` -> latched attempt start, mirroring the real server. */
  startedAt: Map<string, string>
  /** Graded submissions for the review surface; an absent email did not submit. */
  reviews: Record<string, E2EReviewRecord>
  /** Tests whose marks have been released to the students. */
  releasedAt: Map<string, string>
}

/** A teacher's saved grade for one student on one test. */
export interface E2EReviewRecord {
  state: 'SUBMITTED' | 'LATE'
  code: string
  submittedAt: string
  /** One entry per test case, in the test's own case order. */
  caseStates: ('PASS' | 'FAIL')[]
  marks: number | null
  comment: string
}

export const SEEDED_CLASSROOM_ID = 'class-algorithms'
export const SEEDED_JOIN_CODE = 'ALGO-204'
export const SEEDED_LIVE_TEST_ID = 'test-live-1'
export const SEEDED_UPCOMING_TEST_ID = 'test-upcoming-1'
export const SEEDED_REVIEW_TEST_ID = 'test-review-1'
/** A finished test whose results have been released, for the student result page. */
export const SEEDED_RESULT_TEST_ID = 'test-result-1'

function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString()
}

function seedState(): E2EBackendState {
  const live: Test = {
    id: SEEDED_LIVE_TEST_ID,
    classroomId: SEEDED_CLASSROOM_ID,
    classroomName: 'CS 204 Algorithms',
    title: 'Sorting and searching',
    instructions: 'Write the fastest correct version you can.',
    language: 'javascript',
    windowStart: minutesFromNow(-30),
    windowEnd: minutesFromNow(90),
    durationMinutes: 45,
    questions: [
      {
        id: 'q-live-1',
        prompt: 'Return a sorted copy of the input array.',
        starterCode: 'function sortArray(xs) {\n  // your code here\n}\n',
        language: 'javascript',
        testCases: [
          { id: 'tc-live-1', input: '[3,1,2]', expected: '[1,2,3]', hidden: false },
          { id: 'tc-live-2', input: null, expected: null, hidden: true },
        ],
        points: 10,
        order: 0,
      },
    ],
    createdAt: '2026-02-01T00:00:00.000Z',
  }
  const upcoming: Test = {
    ...live,
    id: SEEDED_UPCOMING_TEST_ID,
    title: 'Graph traversal',
    instructions: 'Breadth first, please.',
    windowStart: minutesFromNow(60),
    windowEnd: minutesFromNow(180),
  }
  const review: Test = {
    id: SEEDED_REVIEW_TEST_ID,
    classroomId: SEEDED_CLASSROOM_ID,
    classroomName: 'CS 204 Algorithms',
    title: 'Lab 4: Binary search',
    instructions: 'Return the index of the target, or -1 when it is absent.',
    language: 'javascript',
    windowStart: minutesFromNow(-210),
    windowEnd: minutesFromNow(-90),
    durationMinutes: 45,
    questions: [
      {
        id: 'q-review-1',
        prompt: 'Return the index of the target in the sorted array, or -1 when it is absent.',
        starterCode: 'function search(xs, target) {\n  // your code here\n}\n',
        language: 'javascript',
        testCases: [
          { id: 'tc-review-1', input: '[1,2,3]\n2', expected: '1', hidden: false },
          { id: 'tc-review-2', input: '[1,2,3]\n5', expected: '-1', hidden: false },
          { id: 'tc-review-3', input: '[]\n0', expected: '-1', hidden: false },
          // Hidden cases travel with null content; only their outcome is shown.
          { id: 'tc-review-4', input: null, expected: null, hidden: true },
          { id: 'tc-review-5', input: null, expected: null, hidden: true },
        ],
        points: 10,
        order: 0,
      },
    ],
    createdAt: '2026-01-15T00:00:00.000Z',
  }
  const result: Test = {
    id: SEEDED_RESULT_TEST_ID,
    classroomId: SEEDED_CLASSROOM_ID,
    classroomName: 'CS 204 Algorithms',
    title: 'Lab 5: Complexity results',
    instructions: 'Return the square of the input.',
    language: 'javascript',
    windowStart: minutesFromNow(-300),
    windowEnd: minutesFromNow(-150),
    durationMinutes: 45,
    questions: [
      {
        id: 'q-result-1',
        prompt: 'Return the square of n.',
        starterCode: 'function square(n) {\n  // your code here\n}\n',
        language: 'javascript',
        testCases: [
          { id: 'tc-result-1', input: '2', expected: '4', hidden: false },
          { id: 'tc-result-2', input: '5', expected: '25', hidden: false },
          { id: 'tc-result-3', input: null, expected: null, hidden: true },
        ],
        points: 10,
        order: 0,
      },
    ],
    createdAt: '2026-01-20T00:00:00.000Z',
  }
  const riya = 'riya.student@mit.ac.in'
  const kabir = 'kabir.mehta@mit.ac.in'
  const aarav = 'aarav.iyer@mit.ac.in'
  const meera = 'meera.nair@mit.ac.in'
  return {
    classrooms: [
      {
        id: SEEDED_CLASSROOM_ID,
        collegeId: COLLEGE_ID,
        name: 'CS 204 Algorithms',
        subject: 'CS204',
        description: 'Weekly problem sets.',
        teacherId: `uid-${TEACHER_EMAIL}`,
        teacherName: 'Aditya Rao',
        joinCode: SEEDED_JOIN_CODE,
        studentCount: 4,
        testCount: 4,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    tests: [live, upcoming, review, result],
    roster: [
      {
        classroomId: SEEDED_CLASSROOM_ID,
        uid: `uid-${riya}`,
        email: riya,
        displayName: 'Riya Sharma',
        joinedAt: '2026-01-02T00:00:00.000Z',
        pending: false,
      },
      {
        classroomId: SEEDED_CLASSROOM_ID,
        uid: `uid-${kabir}`,
        email: kabir,
        displayName: 'Kabir Mehta',
        joinedAt: '2026-01-03T00:00:00.000Z',
        pending: false,
      },
      {
        classroomId: SEEDED_CLASSROOM_ID,
        uid: `uid-${aarav}`,
        email: aarav,
        displayName: 'Aarav Iyer',
        joinedAt: '2026-01-04T00:00:00.000Z',
        pending: false,
      },
      // Meera is enrolled but never submitted the review test.
      {
        classroomId: SEEDED_CLASSROOM_ID,
        uid: `uid-${meera}`,
        email: meera,
        displayName: 'Meera Nair',
        joinedAt: '2026-01-05T00:00:00.000Z',
        pending: false,
      },
    ],
    submissions: [],
    monitorEvents: [],
    startedAt: new Map(),
    reviews: {
      [`${review.id}:${riya}`]: {
        state: 'SUBMITTED',
        code: 'function search(xs, target) {\n  return xs.indexOf(target)\n}\n',
        submittedAt: minutesFromNow(-175),
        caseStates: ['PASS', 'FAIL', 'PASS', 'PASS', 'PASS'],
        marks: null,
        comment: '',
      },
      [`${review.id}:${kabir}`]: {
        state: 'SUBMITTED',
        code: 'function search(xs, target) {\n  let lo = 0\n  let hi = xs.length - 1\n  while (lo <= hi) {\n    const mid = (lo + hi) >> 1\n    if (xs[mid] === target) return mid\n    if (xs[mid] < target) lo = mid + 1\n    else hi = mid - 1\n  }\n  return -1\n}\n',
        submittedAt: minutesFromNow(-170),
        caseStates: ['PASS', 'PASS', 'PASS', 'PASS', 'PASS'],
        marks: 8,
        comment: 'Clean binary search. Watch the empty-array early return.',
      },
      [`${review.id}:${aarav}`]: {
        state: 'LATE',
        code: 'function search(xs, target) {\n  for (let i = 0; i < xs.length; i++) {\n    if (xs[i] === target) return i\n  }\n  return 0\n}\n',
        submittedAt: minutesFromNow(-95),
        caseStates: ['PASS', 'FAIL', 'FAIL', 'PASS', 'PASS'],
        marks: null,
        comment: '',
      },
      // A released result: Riya fails one visible case and the hidden one.
      [`${result.id}:${riya}`]: {
        state: 'SUBMITTED',
        code: 'function square(n) {\n  return n * n\n}\n',
        submittedAt: minutesFromNow(-240),
        caseStates: ['PASS', 'FAIL', 'FAIL'],
        marks: 7,
        comment: 'Watch the hidden edge case before the next lab.',
      },
    },
    // Only the result test is released; the review test stays unreleased so the
    // student's "not released yet" state has a home.
    releasedAt: new Map([[result.id, minutesFromNow(-120)]]),
  }
}

/**
 * The id of the caller's own submission on a test, or null. Derived from the
 * token's email, never sent by the client.
 */
function mySubmissionIdFor(test: Test, email: string, state: E2EBackendState): string | null {
  if (state.reviews[`${test.id}:${email}`]) return submissionIdFor(test.id, email, state)
  const live = state.submissions.find(
    (s) => s.testId === test.id && s.uid === email && s.status !== 'FAILED',
  )
  return live ? String(live.id) : null
}

/** Metadata only. The question list is never part of a summary. */
function summaryOf(test: Test, state: E2EBackendState, email: string) {
  return {
    id: test.id,
    classroomId: test.classroomId,
    title: test.title,
    language: test.language,
    windowStart: test.windowStart,
    windowEnd: test.windowEnd,
    durationMinutes: test.durationMinutes,
    questionCount: test.questions.length,
    totalPoints: test.questions.reduce((total, q) => total + q.points, 0),
    submittedCount: state.submissions.filter((s) => s.testId === test.id).length,
    mySubmissionId: mySubmissionIdFor(test, email, state),
    createdAt: test.createdAt,
  }
}

/**
 * Hidden cases travel as `input: null`, never as a stripped list, so the client
 * can still tell a student that the case exists and is being withheld.
 */
function detailOf(test: Test) {
  return {
    id: test.id,
    classroomId: test.classroomId,
    classroomName: test.classroomName,
    title: test.title,
    instructions: test.instructions,
    language: test.language,
    windowStart: test.windowStart,
    windowEnd: test.windowEnd,
    durationMinutes: test.durationMinutes,
    questions: test.questions.map((question) => ({
      ...question,
      testCases: question.testCases.map((testCase) =>
        testCase.hidden ? { ...testCase, input: null, expected: null } : testCase,
      ),
    })),
    totalPoints: test.questions.reduce((total, q) => total + q.points, 0),
  }
}

function withCounts(classroom: Classroom, state: E2EBackendState) {
  return {
    ...classroom,
    studentCount: state.roster.filter((r) => r.classroomId === classroom.id).length,
    testCount: state.tests.filter((t) => t.classroomId === classroom.id).length,
  }
}

/** The teacher's view of a classroom: counts, roster (classroom id stripped) and tests. */
function classroomDetailFor(classroom: Classroom, state: E2EBackendState, email: string) {
  return {
    ...withCounts(classroom, state),
    students: state.roster
      .filter((r) => r.classroomId === classroom.id)
      .map(({ classroomId: _classroomId, ...student }) => student),
    tests: state.tests.filter((t) => t.classroomId === classroom.id).map((t) => summaryOf(t, state, email)),
  }
}

function findTest(testId: string, state: E2EBackendState): Test | undefined {
  return state.tests.find((t) => t.id === testId)
}

/** The `:id` of `/api/tests/:id...`: the segment right after `/api/tests`, at
 * any nesting depth (`/lobby`, `/submissions/:id`, `/submissions/:id/review`). */
function testIdOf(route: Route): string {
  return decodeURIComponent(new URL(route.request().url()).pathname.split('/')[3] ?? '')
}

/** Last path segment, i.e. the `:id` of `/api/tests/:id`. */
function lastSegment(route: Route): string {
  return decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1) ?? '')
}

/** Second-to-last path segment, i.e. the `:id` of `/api/classrooms/:id/tests`. */
function secondToLastSegment(route: Route): string {
  return decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-2) ?? '')
}

function submissionFor(testId: string, email: string, state: E2EBackendState) {
  return state.submissions.find((s) => s.testId === testId && s.uid === email) ?? null
}

function lobbyFor(test: Test, email: string, state: E2EBackendState) {
  return {
    test: detailOf(test),
    serverTime: new Date().toISOString(),
    startedAt: state.startedAt.get(`${test.id}:${email}`) ?? null,
    submission: submissionFor(test.id, email, state),
  }
}

/** The stable id for a student's (possible) submission on a test. */
function submissionIdFor(testId: string, email: string, state: E2EBackendState): string {
  const prefix = state.reviews[`${testId}:${email}`] ? 'sub' : 'pending'
  return `${prefix}-${testId}-uid-${email}`
}

/** Every test case across the test's questions, in order. */
function allCasesOf(test: Test): TestCase[] {
  return test.questions.flatMap((question) => question.testCases)
}

function totalPointsOf(test: Test): number {
  return test.questions.reduce((total, q) => total + q.points, 0)
}

/** The row for every roster member of the test's classroom, roster order. */
function reviewListFor(test: Test, state: E2EBackendState) {
  const roster = state.roster.filter((r) => r.classroomId === test.classroomId)
  const cases = allCasesOf(test)
  return {
    testId: test.id,
    testTitle: test.title,
    maxMarks: totalPointsOf(test),
    resultsReleased: state.releasedAt.has(test.id),
    releasedAt: state.releasedAt.get(test.id) ?? null,
    submissions: roster.map((member) => {
      const record = state.reviews[`${test.id}:${member.email}`]
      return {
        id: submissionIdFor(test.id, member.email, state),
        studentUid: member.uid,
        studentName: member.displayName,
        studentEmail: member.email,
        state: record ? record.state : 'NOT_SUBMITTED',
        passedCases: record ? record.caseStates.filter((value) => value === 'PASS').length : 0,
        totalCases: cases.length,
        submittedAt: record?.submittedAt ?? null,
        marks: record?.marks ?? null,
        maxMarks: totalPointsOf(test),
      }
    }),
  }
}

/** The grading page for one student: content withheld for hidden cases. */
function reviewDetailFor(test: Test, member: RosterEntry, state: E2EBackendState) {
  const record = state.reviews[`${test.id}:${member.email}`]
  const cases = allCasesOf(test)
  return {
    id: submissionIdFor(test.id, member.email, state),
    testId: test.id,
    testTitle: test.title,
    studentUid: member.uid,
    studentName: member.displayName,
    studentEmail: member.email,
    state: record ? record.state : 'NOT_SUBMITTED',
    language: test.language,
    code: record?.code ?? '',
    submittedAt: record?.submittedAt ?? null,
    cases: record
      ? cases.map((testCase, index) => {
          const state_ = record.caseStates[index] === 'PASS' ? 'PASS' : 'FAIL'
          return {
            id: testCase.id,
            name: `Test case ${index + 1}`,
            state: state_,
            hidden: testCase.hidden,
            input: testCase.hidden ? null : testCase.input,
            expected: testCase.hidden ? null : testCase.expected,
            actual: testCase.hidden ? null : state_ === 'PASS' ? (testCase.expected ?? '') : 'undefined',
          }
        })
      : [],
    passedCases: record ? record.caseStates.filter((value) => value === 'PASS').length : 0,
    totalCases: cases.length,
    marks: record?.marks ?? null,
    maxMarks: totalPointsOf(test),
    comment: record?.comment ?? '',
    resultsReleased: state.releasedAt.has(test.id),
    releasedAt: state.releasedAt.get(test.id) ?? null,
  }
}

/** Resolves the roster member a submission id names, without parsing the id. */
function reviewMemberOf(test: Test, submissionId: string, state: E2EBackendState): RosterEntry | undefined {
  return state.roster.find(
    (member) => member.classroomId === test.classroomId && submissionIdFor(test.id, member.email, state) === submissionId,
  )
}

/**
 * A student's own result, scoped to `email`.
 *
 * Hidden cases keep only their state, and the marks/comment stay withheld until
 * the test is released — the same withholding the real server applies.
 */
function resultFor(test: Test, email: string, state: E2EBackendState) {
  const record = state.reviews[`${test.id}:${email}`]
  const live = state.submissions.find(
    (s) => s.testId === test.id && s.uid === email && s.status !== 'FAILED',
  )
  const cases = allCasesOf(test)
  const caseStates = record ? record.caseStates : cases.map(() => 'PASS')
  const released = state.releasedAt.has(test.id)
  const submittedAt = record?.submittedAt ?? (live?.submittedAt as string) ?? new Date().toISOString()
  const late = Date.parse(submittedAt) >= Date.parse(test.windowEnd)
  return {
    testId: test.id,
    testTitle: test.title,
    language: test.language,
    state: record ? record.state : late ? 'LATE' : 'SUBMITTED',
    submittedAt,
    passedCases: caseStates.filter((value) => value === 'PASS').length,
    totalCases: cases.length,
    cases: cases.map((testCase, index) => {
      const caseState = caseStates[index] === 'PASS' ? 'PASS' : 'FAIL'
      return {
        id: testCase.id,
        name: `Test case ${index + 1}`,
        state: caseState,
        hidden: testCase.hidden,
        input: testCase.hidden ? null : testCase.input,
        expected: testCase.hidden ? null : testCase.expected,
        actual: testCase.hidden ? null : caseState === 'PASS' ? (testCase.expected ?? '') : 'undefined',
      }
    }),
    marksReleased: released,
    releasedAt: released ? state.releasedAt.get(test.id) ?? null : null,
    marks: released ? record?.marks ?? null : null,
    maxMarks: totalPointsOf(test),
    comment: released ? record?.comment ?? '' : '',
  }
}

/**
 * Routes the classroom/test contract.
 *
 * ORDER MATTERS. Playwright matches the most recently registered handler first,
 * so generic patterns are registered before the specific ones that must win:
 * a `classrooms` + one-segment pattern would otherwise swallow the
 * `/api/classrooms/mine` sub-resource and answer a student with 403.
 *
 * Every branch answers explicitly, including 405s, so no request can fall
 * through to the real network and surface as an opaque `requestfailed`.
 */
export async function stubTestBackend(page: Page, state: E2EBackendState = seedState()): Promise<E2EBackendState> {
  // Registered FIRST, so it is matched LAST: this is the safety net for
  // endpoints the app calls that this suite has not modelled. Anything the
  // stubs below match takes precedence, so /api/auth/session is not swallowed.
  // A request that lands here is reported loudly rather than passed through to a
  // real network that does not exist, where it would surface as an opaque
  // `requestfailed` instead of a named gap.
  await page.route('**/api/**', (route) => notImplemented(route))

  // --- generic: 3 segments, e.g. /api/classrooms/:id/tests
  await page.route('**/api/classrooms/*/tests', async (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (!requireTeacher(route, email)) return
    const classroomId = secondToLastSegment(route)
    const classroom = state.classrooms.find((c) => c.id === classroomId)
    if (!classroom) return notFound(route, 'That classroom could not be found.')

    if (route.request().method() === 'GET') {
      return json(route, state.tests.filter((t) => t.classroomId === classroom.id).map((t) => summaryOf(t, state, email)))
    }
    if (route.request().method() !== 'POST') return methodNotAllowed(route, 'GET, POST')

    const body = (route.request().postDataJSON() ?? {}) as {
      title?: string
      language?: Language
      windowStart?: string
      windowEnd?: string
      durationMinutes?: number
      questions?: { prompt?: string; starterCode?: string; points?: number }[]
    }
    const questions = body.questions ?? []
    if ((body.title ?? '').trim().length === 0) return fail(route, 'The test needs a title.')
    if (questions.length === 0) return fail(route, 'Add at least one question.')
    if (questions.some((q) => (q.prompt ?? '').trim().length === 0)) {
      return fail(route, 'Every question needs a prompt.')
    }
    const created: Test = {
      id: `test-created-${state.tests.length + 1}`,
      classroomId: classroom.id,
      classroomName: classroom.name,
      title: String(body.title),
      instructions: String(body.instructions ?? ''),
      language: body.language ?? 'javascript',
      windowStart: String(body.windowStart),
      windowEnd: String(body.windowEnd),
      durationMinutes: Number(body.durationMinutes) || 60,
      createdAt: new Date().toISOString(),
      questions: questions.map((q, index) => ({
        id: `q-created-${state.tests.length + 1}-${index}`,
        prompt: String(q.prompt),
        starterCode: String(q.starterCode ?? ''),
        language: body.language ?? 'javascript',
        testCases: [],
        points: Number(q.points) || 10,
        order: index,
      })),
    }
    state.tests.push(created)
    return json(route, summaryOf(created, state, email), 201)
  })

  // --- generic: 2 segments, e.g. /api/classrooms/:id
  await page.route('**/api/classrooms/*', (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (!requireTeacher(route, email)) return
    if (route.request().method() !== 'GET') return methodNotAllowed(route, 'GET')
    const classroom = state.classrooms.find((c) => c.id === lastSegment(route))
    if (!classroom) return notFound(route, 'That classroom could not be found.')
    return json(route, classroomDetailFor(classroom, state, email))
  })

  // --- generic: /api/classrooms (collection)
  await page.route('**/api/classrooms', async (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (!requireTeacher(route, email)) return
    if (route.request().method() === 'GET') {
      return json(route, state.classrooms.map((c) => withCounts(c, state)))
    }
    if (route.request().method() !== 'POST') return methodNotAllowed(route, 'GET, POST')
    const body = (route.request().postDataJSON() ?? {}) as {
      name?: string
      subject?: string
      description?: string
    }
    if ((body.name ?? '').trim().length === 0) return fail(route, 'The classroom needs a name.')
    const created: Classroom = {
      id: `class-created-${state.classrooms.length + 1}`,
      collegeId: COLLEGE_ID,
      name: String(body.name),
      subject: String(body.subject ?? ''),
      description: String(body.description ?? ''),
      teacherId: `uid-${email}`,
      teacherName: 'Aditya Rao',
      joinCode: `JOIN-${state.classrooms.length + 1}`,
      studentCount: 0,
      testCount: 0,
      createdAt: new Date().toISOString(),
    }
    state.classrooms.push(created)
    return json(route, created, 201)
  })

  // --- enrolment: teacher adds students by email (3 segments, wins over /:id)
  await page.route('**/api/classrooms/*/students', async (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (!requireTeacher(route, email)) return
    if (route.request().method() !== 'POST') return methodNotAllowed(route, 'POST')
    const classroom = state.classrooms.find((c) => c.id === secondToLastSegment(route))
    if (!classroom) return notFound(route, 'That classroom could not be found.')
    const body = (route.request().postDataJSON() ?? {}) as { emails?: unknown }
    const emails = Array.isArray(body.emails)
      ? [...new Set(body.emails.map((value) => String(value).trim().toLowerCase()).filter(Boolean))]
      : []
    if (emails.length === 0) return fail(route, 'Enter at least one student email.')
    if (emails.some((value) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) {
      return fail(route, 'One or more of those emails is not valid.')
    }
    const added: string[] = []
    const alreadyEnrolled: string[] = []
    for (const student of emails) {
      if (state.roster.some((r) => r.classroomId === classroom.id && r.email === student)) {
        alreadyEnrolled.push(student)
        continue
      }
      const name = KNOWN_ACCOUNTS[student]
      state.roster.push({
        classroomId: classroom.id,
        uid: name ? `uid-${student}` : '',
        email: student,
        displayName: name ?? '',
        joinedAt: new Date().toISOString(),
        pending: !name,
      })
      added.push(student)
    }
    return json(
      route,
      { classroom: classroomDetailFor(classroom, state, email), added, alreadyEnrolled },
      added.length > 0 ? 201 : 200,
    )
  })

  await page.route('**/api/classrooms/*/students/*', (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (!requireTeacher(route, email)) return
    if (route.request().method() !== 'DELETE') return methodNotAllowed(route, 'DELETE')
    const parts = new URL(route.request().url()).pathname.split('/')
    const classroom = state.classrooms.find((c) => c.id === decodeURIComponent(parts.at(-3) ?? ''))
    if (!classroom) return notFound(route, 'That classroom could not be found.')
    const student = decodeURIComponent(parts.at(-1) ?? '').toLowerCase()
    const before = state.roster.length
    state.roster = state.roster.filter((r) => !(r.classroomId === classroom.id && r.email === student))
    if (state.roster.length === before) return notFound(route, 'That student is not in this classroom.')
    return json(route, classroomDetailFor(classroom, state, email))
  })

  // --- specific: wins over `**/api/classrooms/*`
  await page.route('**/api/classrooms/mine', (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (route.request().method() !== 'GET') return methodNotAllowed(route, 'GET')
    const joined = new Set(state.roster.filter((r) => r.email === email).map((r) => r.classroomId))
    return json(
      route,
      state.classrooms.filter((c) => joined.has(c.id)).map((c) => withCounts(c, state)),
    )
  })

  // --- test sub-resources, most specific first
  await page.route('**/api/tests/*/monitor-events', (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (route.request().method() !== 'POST') return methodNotAllowed(route, 'POST')
    const body = (route.request().postDataJSON() ?? {}) as { events?: Record<string, unknown>[] }
    for (const event of body.events ?? []) state.monitorEvents.push({ uid: email, ...event })
    return route.fulfill({ status: 204, body: '' })
  })

  await page.route('**/api/tests/*/submissions', (route) => {
    const email = requireAuth(route)
    if (!email) return
    const test = findTest(testIdOf(route), state)
    if (!test) return notFound(route, 'That test could not be found.')
    if (route.request().method() === 'GET') {
      // The review list: teacher/admin only, every roster member, roster order.
      if (!requireTeacher(route, email)) return
      return json(route, reviewListFor(test, state))
    }
    if (route.request().method() !== 'POST') return methodNotAllowed(route, 'GET, POST')
    const body = (route.request().postDataJSON() ?? {}) as { code?: string; idempotencyKey?: string }
    const idempotencyKey = body.idempotencyKey ?? ''
    if (idempotencyKey.length === 0) return fail(route, 'A submission needs an idempotency key.')

    // The same key is one submission however many times it arrives, so a
    // double-clicked submit button cannot create two attempts at grading.
    const existing = state.submissions.find(
      (s) => s.testId === test.id && s.uid === email && s.idempotencyKey === idempotencyKey,
    )
    if (existing) return json(route, existing)
    if (Date.now() >= Date.parse(test.windowEnd)) {
      return fail(route, 'The window for this test has closed.')
    }
    const totalPoints = test.questions.reduce((total, q) => total + q.points, 0)
    const submission = {
      id: `sub-${state.submissions.length + 1}`,
      testId: test.id,
      uid: email,
      language: test.language,
      code: body.code ?? '',
      status: 'QUEUED',
      idempotencyKey,
      submittedAt: new Date().toISOString(),
      score: null,
      maxScore: totalPoints,
    }
    state.submissions.push(submission)
    return json(route, submission, 201)
  })

  await page.route('**/api/tests/*/attempts', (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (route.request().method() !== 'POST') return methodNotAllowed(route, 'POST')
    const test = findTest(testIdOf(route), state)
    if (!test) return notFound(route, 'That test could not be found.')
    if (submissionFor(test.id, email, state)) {
      return json(route, { message: 'You have already submitted this test.', code: 'CONFLICT' }, 409)
    }
    const now = Date.now()
    if (now < Date.parse(test.windowStart)) return forbidden(route, 'This test has not opened yet.')
    if (now >= Date.parse(test.windowEnd)) return forbidden(route, 'This test has closed.')
    // Latched: a reload cannot buy a second allowance.
    const key = `${test.id}:${email}`
    if (!state.startedAt.has(key)) state.startedAt.set(key, new Date().toISOString())
    return json(route, { ...lobbyFor(test, email, state), submission: null })
  })

  await page.route('**/api/tests/*/lobby', (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (route.request().method() !== 'GET') return methodNotAllowed(route, 'GET')
    const test = findTest(testIdOf(route), state)
    if (!test) return notFound(route, 'That test could not be found.')
    return json(route, lobbyFor(test, email, state))
  })

  // The student's own result. Teacher/admin use the review screens instead, and a
  // caller with no submission gets a 404 so a peer's submission is not confirmed.
  await page.route('**/api/tests/*/result', (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (route.request().method() !== 'GET') return methodNotAllowed(route, 'GET')
    if (ROLES[email]) return forbidden(route, 'Results are viewed through the review screens.')
    const test = findTest(testIdOf(route), state)
    if (!test) return notFound(route, 'That test could not be found.')
    const submitted =
      Boolean(state.reviews[`${test.id}:${email}`]) ||
      state.submissions.some((s) => s.testId === test.id && s.uid === email && s.status !== 'FAILED')
    if (!submitted) return notFound(route, 'We could not find a result for this test.')
    return json(route, resultFor(test, email, state))
  })

  // --- review detail (also serves a student's own latest submission at .../mine)
  await page.route('**/api/tests/*/submissions/*', (route) => {
    const email = requireAuth(route)
    if (!email) return
    const test = findTest(testIdOf(route), state)
    if (!test) return notFound(route, 'That test could not be found.')
    const last = lastSegment(route)

    // A student reads their own submission the same way the single-owner
    // contract works elsewhere: no body, no other student reachable.
    if (last === 'mine') {
      if (route.request().method() !== 'GET') return methodNotAllowed(route, 'GET')
      const submission = submissionFor(test.id, email, state)
      if (!submission) return route.fulfill({ status: 204, body: '' })
      return json(route, submission)
    }

    if (!requireTeacher(route, email)) return
    if (route.request().method() !== 'GET') return methodNotAllowed(route, 'GET')
    const member = reviewMemberOf(test, last, state)
    if (!member) return notFound(route, 'That submission could not be found.')
    return json(route, reviewDetailFor(test, member, state))
  })

  // Registered after the detail wildcard so release wins: newest-handler-first.
  await page.route('**/api/tests/*/submissions/release', (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (!requireTeacher(route, email)) return
    if (route.request().method() !== 'POST') return methodNotAllowed(route, 'POST')
    const test = findTest(testIdOf(route), state)
    if (!test) return notFound(route, 'That test could not be found.')
    // Idempotent: releasing twice keeps the time the students first saw.
    if (!state.releasedAt.has(test.id)) state.releasedAt.set(test.id, new Date().toISOString())
    return json(route, reviewListFor(test, state))
  })

  await page.route('**/api/tests/*/submissions/*/review', (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (!requireTeacher(route, email)) return
    if (route.request().method() !== 'PUT') return methodNotAllowed(route, 'PUT')
    const test = findTest(testIdOf(route), state)
    if (!test) return notFound(route, 'That test could not be found.')
    // A release freezes the grades: a later save cannot contradict the students.
    if (state.releasedAt.has(test.id)) {
      return json(route, { message: 'Results are released, so gradings are locked.', code: 'CONFLICT' }, 409)
    }
    const member = reviewMemberOf(test, secondToLastSegment(route), state)
    if (!member) return notFound(route, 'That submission could not be found.')
    const record = state.reviews[`${test.id}:${member.email}`]
    if (!record) return json(route, { message: 'This student did not submit this test.', code: 'CONFLICT' }, 409)

    const body = (route.request().postDataJSON() ?? {}) as { marks?: unknown; comment?: unknown }
    let marks: number | null = null
    if (body.marks !== null && body.marks !== undefined) {
      const parsed = Number(body.marks)
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > totalPointsOf(test)) {
        return fail(route, `Enter a whole number of marks between 0 and ${totalPointsOf(test)}.`)
      }
      marks = parsed
    }
    record.marks = marks
    record.comment = String(body.comment ?? '')
    return json(route, reviewDetailFor(test, member, state))
  })

  // --- generic: /api/tests/:id
  await page.route('**/api/tests/*', (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (route.request().method() !== 'GET') return methodNotAllowed(route, 'GET')
    const test = findTest(lastSegment(route), state)
    if (!test) return notFound(route, 'That test could not be found.')
    return json(route, detailOf(test))
  })

  // --- collection
  await page.route('**/api/tests', (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (route.request().method() !== 'GET') return methodNotAllowed(route, 'GET')
    const enrolled = new Set(state.roster.filter((r) => r.email === email).map((r) => r.classroomId))
    const visible = ROLES[email] ? state.tests : state.tests.filter((t) => enrolled.has(t.classroomId))
    return json(route, visible.map((t) => summaryOf(t, state, email)))
  })

  return state
}
