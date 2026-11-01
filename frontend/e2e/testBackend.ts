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
 * Routes the backend's API (the real Express routes, `{ data }` envelopes).
 *
 * ORDER MATTERS. Playwright matches the most recently registered handler first,
 * so generic patterns are registered before the specific ones that must win.
 *
 * Every branch answers explicitly, including 405s, so no request can fall
 * through to the real network and surface as an opaque `requestfailed`.
 */
export async function stubTestBackend(page: Page, state: E2EBackendState = seedState()): Promise<E2EBackendState> {
  // Registered FIRST, so it is matched LAST: the safety net for endpoints this
  // suite has not modelled. Anything below takes precedence.
  await page.route('**/api/**', (route) => notImplemented(route))

  const isTeacher = (email: string) => ROLES[email] === 'TEACHER' || ROLES[email] === 'ADMIN'
  const enrolled = (classroomId: string, email: string) =>
    state.roster.some((r) => r.classroomId === classroomId && r.email === email)
  const submittedStatus = (testId: string, email: string) => {
    const record = state.reviews[`${testId}:${email}`]
    const live = state.submissions.find((s) => s.testId === testId && s.uid === email && s.status !== 'FAILED')
    if (!record && !live) return null
    return { status: 'SUBMITTED', submittedAt: record?.submittedAt ?? (live?.submittedAt as string) }
  }
  const maskQuestions = (test: Test) =>
    test.questions.map((q) => ({
      ...q,
      testCases: q.testCases.map((c) => (c.hidden ? { id: c.id, hidden: true, input: null, expected: null } : c)),
    }))
  const flagCounts = (testId: string, uid: string) => {
    const counts: Record<string, number> = {}
    for (const event of state.monitorEvents) {
      if (event.testId === testId && event.uid === uid) {
        const type = String(event.flagType)
        counts[type] = (counts[type] ?? 0) + 1
      }
    }
    return counts
  }
  const memberByUid = (test: Test, uid: string) =>
    state.roster.find((m) => m.classroomId === test.classroomId && (m.uid === uid || submissionIdFor(test.id, m.email, state) === uid))
  const segments = (route: Route) => new URL(route.request().url()).pathname.split('/').map(decodeURIComponent)

  /* ---------------------------------------------------------------- classrooms */

  // /api/classrooms/:id (teacher detail)
  await page.route('**/api/classrooms/*', (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (!requireTeacher(route, email)) return
    if (route.request().method() !== 'GET') return methodNotAllowed(route, 'GET')
    const classroom = state.classrooms.find((c) => c.id === lastSegment(route))
    if (!classroom) return notFound(route, 'Classroom not found')
    return json(route, { data: classroomDetailFor(classroom, state, email) })
  })

  // /api/classrooms (one route for both roles; a student never gets the roster)
  await page.route('**/api/classrooms', async (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (route.request().method() === 'GET') {
      if (isTeacher(email)) {
        return json(route, {
          data: state.classrooms.map((c) => {
            const roster = state.roster.filter((r) => r.classroomId === c.id)
            return {
              ...withCounts(c, state),
              students: roster.filter((r) => !r.pending).map((r) => r.uid),
              invitedEmails: roster.filter((r) => r.pending).map((r) => r.email),
              studentCount: roster.filter((r) => !r.pending).length,
              invitedCount: roster.filter((r) => r.pending).length,
            }
          }),
        })
      }
      return json(route, {
        data: state.classrooms
          .filter((c) => enrolled(c.id, email))
          .map(({ id, name, subject, description, teacherName, collegeId, createdAt }) => ({
            id,
            name,
            subject,
            description,
            teacherName,
            collegeId,
            createdAt,
          })),
      })
    }
    if (route.request().method() !== 'POST') return methodNotAllowed(route, 'GET, POST')
    if (!requireTeacher(route, email)) return
    const body = (route.request().postDataJSON() ?? {}) as { name?: string; subject?: string; description?: string }
    if ((body.name ?? '').trim().length === 0) return fail(route, 'The classroom needs a name.')
    const created: Classroom = {
      id: `class-created-${state.classrooms.length + 1}`,
      collegeId: COLLEGE_ID,
      name: String(body.name),
      subject: String(body.subject ?? ''),
      description: String(body.description ?? ''),
      teacherId: `uid-${email}`,
      teacherName: 'Aditya Rao',
      studentCount: 0,
      testCount: 0,
      createdAt: new Date().toISOString(),
    }
    state.classrooms.push(created)
    return json(route, { message: 'Classroom created successfully', data: { id: created.id } }, 201)
  })

  // /api/classrooms/:id/students (enrol by email)
  await page.route('**/api/classrooms/*/students', async (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (!requireTeacher(route, email)) return
    if (route.request().method() !== 'POST') return methodNotAllowed(route, 'POST')
    const classroom = state.classrooms.find((c) => c.id === secondToLastSegment(route))
    if (!classroom) return notFound(route, 'Classroom not found')
    const body = (route.request().postDataJSON() ?? {}) as { emails?: unknown }
    const emails = Array.isArray(body.emails)
      ? [...new Set(body.emails.map((value) => String(value).trim().toLowerCase()).filter(Boolean))]
      : []
    if (emails.length === 0) return fail(route, 'Enter at least one student email')
    const result = { added: [] as string[], invited: [] as string[], alreadyEnrolled: [] as string[], rejected: [] as { email: string; reason: string }[] }
    for (const student of emails) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(student)) {
        result.rejected.push({ email: student, reason: 'Not a valid email address' })
        continue
      }
      if (state.roster.some((r) => r.classroomId === classroom.id && r.email === student)) {
        result.alreadyEnrolled.push(student)
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
      ;(name ? result.added : result.invited).push(student)
    }
    const changed = result.added.length + result.invited.length > 0
    return json(route, { message: 'Students updated', result, data: classroomDetailFor(classroom, state, email) }, changed ? 201 : 200)
  })

  // /api/classrooms/:id/students/:email (remove)
  await page.route('**/api/classrooms/*/students/*', (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (!requireTeacher(route, email)) return
    if (route.request().method() !== 'DELETE') return methodNotAllowed(route, 'DELETE')
    const parts = segments(route)
    const classroom = state.classrooms.find((c) => c.id === parts.at(-3))
    if (!classroom) return notFound(route, 'Classroom not found')
    const student = String(parts.at(-1) ?? '').toLowerCase()
    const before = state.roster.length
    state.roster = state.roster.filter((r) => !(r.classroomId === classroom.id && r.email === student))
    if (state.roster.length === before) return notFound(route, 'That student is not in this classroom')
    return json(route, { message: 'Student removed', data: classroomDetailFor(classroom, state, email) })
  })

  /* --------------------------------------------------------------------- tests */

  // /api/tests (list for both roles; create for teachers)
  await page.route('**/api/tests', async (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (route.request().method() === 'GET') {
      const teacher = isTeacher(email)
      const visible = teacher ? state.tests : state.tests.filter((t) => enrolled(t.classroomId, email))
      return json(route, {
        data: visible.map((t) => {
          const summary = summaryOf(t, state, email)
          return {
            ...summary,
            startTime: summary.windowStart,
            endTime: summary.windowEnd,
            mySubmissionStatus: submittedStatus(t.id, email) ? 'SUBMITTED' : null,
            ...(teacher ? { questions: t.questions, instructions: t.instructions } : {}),
          }
        }),
      })
    }
    if (route.request().method() !== 'POST') return methodNotAllowed(route, 'GET, POST')
    if (!requireTeacher(route, email)) return
    const body = (route.request().postDataJSON() ?? {}) as {
      classroomId?: string
      title?: string
      instructions?: string
      language?: Language
      startTime?: string
      endTime?: string
      durationMinutes?: number
      questions?: { id?: string; prompt?: string; starterCode?: string; points?: number; testCases?: TestCase[] }[]
    }
    const classroom = state.classrooms.find((c) => c.id === body.classroomId)
    if (!classroom) return notFound(route, 'Classroom not found')
    const questions = body.questions ?? []
    if ((body.title ?? '').trim().length === 0) return fail(route, 'The test needs a title.')
    if (questions.length === 0) return fail(route, 'Add at least one question.')
    if (questions.some((q) => (q.prompt ?? '').trim().length === 0)) return fail(route, 'Every question needs a prompt.')
    const created: Test = {
      id: `test-created-${state.tests.length + 1}`,
      classroomId: classroom.id,
      classroomName: classroom.name,
      title: String(body.title),
      instructions: String(body.instructions ?? ''),
      language: body.language ?? 'python',
      windowStart: String(body.startTime),
      windowEnd: String(body.endTime),
      durationMinutes: Number(body.durationMinutes) || 60,
      createdAt: new Date().toISOString(),
      questions: questions.map((q, index) => ({
        id: q.id ?? `q${index + 1}`,
        prompt: String(q.prompt),
        starterCode: String(q.starterCode ?? ''),
        language: body.language ?? 'python',
        testCases: (q.testCases ?? []).map((c, i) => ({ ...c, id: c.id ?? `c${i + 1}` })),
        points: Number(q.points) || 10,
        order: index,
      })),
    }
    state.tests.push(created)
    return json(route, { message: 'Test created successfully', data: { id: created.id } }, 201)
  })

  // /api/tests/:id/lobby (no questions, no timer start)
  await page.route('**/api/tests/*/lobby', (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (route.request().method() !== 'GET') return methodNotAllowed(route, 'GET')
    const test = findTest(testIdOf(route), state)
    if (!test) return notFound(route, 'Test not found')
    if (!enrolled(test.classroomId, email)) return forbidden(route, "Forbidden: You are not a member of this test's classroom")
    const detail = detailOf(test)
    return json(route, {
      data: {
        test: {
          id: detail.id,
          title: detail.title,
          classroomId: detail.classroomId,
          classroomName: detail.classroomName,
          instructions: detail.instructions,
          language: detail.language,
          windowStart: detail.windowStart,
          windowEnd: detail.windowEnd,
          durationMinutes: detail.durationMinutes,
          questionCount: test.questions.length,
          totalPoints: detail.totalPoints,
        },
        serverTime: new Date().toISOString(),
        startedAt: state.startedAt.get(`${test.id}:${email}`) ?? null,
        deadline: null,
        submission: submittedStatus(test.id, email),
      },
    })
  })

  // /api/tests/:id/entry (starts the attempt; latched start time)
  await page.route('**/api/tests/*/entry', (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (route.request().method() !== 'GET') return methodNotAllowed(route, 'GET')
    const test = findTest(testIdOf(route), state)
    if (!test) return notFound(route, 'Test not found')
    if (!enrolled(test.classroomId, email)) return forbidden(route, "Forbidden: You are not a member of this test's classroom")
    const now = Date.now()
    if (now < Date.parse(test.windowStart)) return forbidden(route, 'Forbidden: Test has not started yet')
    if (now > Date.parse(test.windowEnd)) return forbidden(route, 'Forbidden: Test has already ended')
    const key = `${test.id}:${email}`
    if (!state.startedAt.has(key)) state.startedAt.set(key, new Date().toISOString())
    const masked = { ...detailOf(test), questions: maskQuestions(test) }
    return json(route, {
      message: 'Entered exam successfully',
      data: {
        ...masked,
        test: masked,
        serverTime: new Date().toISOString(),
        startedAt: state.startedAt.get(key),
        submission: submittedStatus(test.id, email),
      },
    })
  })

  // /api/tests/:id/result (student's own; marks withheld until release)
  await page.route('**/api/tests/*/result', (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (route.request().method() !== 'GET') return methodNotAllowed(route, 'GET')
    if (ROLES[email]) return forbidden(route, 'Results are viewed through the review screens')
    const test = findTest(testIdOf(route), state)
    if (!test) return notFound(route, 'Test not found')
    if (!submittedStatus(test.id, email)) return notFound(route, 'We could not find a result for this test')
    const result = resultFor(test, email, state)
    return json(route, {
      data: {
        testId: result.testId,
        testTitle: result.testTitle,
        state: result.state,
        submittedAt: result.submittedAt,
        answers: { language: result.language },
        cases: result.cases,
        passedCases: result.passedCases,
        totalCases: result.totalCases,
        marksReleased: result.marksReleased,
        resultsReleasedAt: result.releasedAt,
        marks: result.marks,
        maxMarks: result.maxMarks,
        comment: result.comment,
      },
    })
  })

  // /api/tests/:id/release (teacher; idempotent)
  await page.route('**/api/tests/*/release', (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (!requireTeacher(route, email)) return
    if (route.request().method() !== 'POST') return methodNotAllowed(route, 'POST')
    const test = findTest(testIdOf(route), state)
    if (!test) return notFound(route, 'Test not found')
    if (!state.releasedAt.has(test.id)) state.releasedAt.set(test.id, new Date().toISOString())
    return json(route, { message: 'Results released', data: { testId: test.id, resultsReleasedAt: state.releasedAt.get(test.id) } })
  })

  /* --------------------------------------------------------------- submissions */

  // /api/submissions (submit): membership, window, then lock -- as the backend
  await page.route('**/api/submissions', (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (route.request().method() !== 'POST') return methodNotAllowed(route, 'POST')
    const body = (route.request().postDataJSON() ?? {}) as { testId?: string; answers?: { code?: string; language?: Language } }
    const test = findTest(String(body.testId ?? ''), state)
    if (!test) return notFound(route, 'Test not found')
    if (!enrolled(test.classroomId, email)) return forbidden(route, "Forbidden: You are not a member of this test's classroom")
    const now = Date.now()
    if (now < Date.parse(test.windowStart)) return forbidden(route, 'Forbidden: Test has not started yet')
    if (now > Date.parse(test.windowEnd)) return forbidden(route, 'Forbidden: Test has already ended')
    if (submittedStatus(test.id, email)) return forbidden(route, 'Forbidden: Submission is locked and cannot be modified')
    state.submissions.push({
      id: `${test.id}_uid-${email}`,
      testId: test.id,
      uid: email,
      language: body.answers?.language ?? test.language,
      code: body.answers?.code ?? '',
      status: 'QUEUED',
      submittedAt: new Date().toISOString(),
    })
    return json(route, { message: 'Exam submitted successfully' })
  })

  await page.route('**/api/submissions/save', (route) => {
    const email = requireAuth(route)
    if (!email) return
    const body = (route.request().postDataJSON() ?? {}) as { testId?: string }
    if (submittedStatus(String(body.testId ?? ''), email)) {
      return forbidden(route, 'Forbidden: Submission is locked and cannot be modified')
    }
    return json(route, { message: 'Answers saved successfully' })
  })

  // /api/submissions/test/:testId (teacher list)
  await page.route('**/api/submissions/test/*', (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (!requireTeacher(route, email)) return
    if (route.request().method() !== 'GET') return methodNotAllowed(route, 'GET')
    const test = findTest(lastSegment(route), state)
    if (!test) return notFound(route, 'Test not found')
    const list = reviewListFor(test, state)
    return json(route, {
      data: {
        testId: list.testId,
        testTitle: list.testTitle,
        maxMarks: list.maxMarks,
        resultsReleasedAt: list.releasedAt,
        submissions: list.submissions.map((row) => ({
          studentId: row.studentUid,
          studentName: row.studentName,
          studentEmail: row.studentEmail,
          state: row.state,
          submittedAt: row.submittedAt,
          marks: row.marks,
          maxMarks: row.maxMarks,
          passedCases: row.passedCases,
          totalCases: row.totalCases,
          flags: flagCounts(test.id, row.studentEmail),
        })),
      },
    })
  })

  const reviewBody = (test: Test, member: RosterEntry) => {
    const detail = reviewDetailFor(test, member, state)
    return {
      testId: detail.testId,
      testTitle: detail.testTitle,
      studentId: detail.studentUid,
      studentName: detail.studentName,
      studentEmail: detail.studentEmail,
      state: detail.state,
      submittedAt: detail.submittedAt,
      answers: detail.state === 'NOT_SUBMITTED' ? null : { language: detail.language, code: detail.code },
      cases: detail.cases,
      passedCases: detail.passedCases,
      totalCases: detail.totalCases,
      marks: detail.marks,
      maxMarks: detail.maxMarks,
      comment: detail.comment,
      resultsReleasedAt: detail.releasedAt,
      flags: flagCounts(test.id, member.email),
    }
  }

  // /api/submissions/test/:testId/:studentId (teacher detail)
  await page.route('**/api/submissions/test/*/*', (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (!requireTeacher(route, email)) return
    if (route.request().method() !== 'GET') return methodNotAllowed(route, 'GET')
    const parts = segments(route)
    const test = findTest(String(parts.at(-2)), state)
    if (!test) return notFound(route, 'Test not found')
    const member = memberByUid(test, String(parts.at(-1)))
    if (!member) return notFound(route, 'Submission not found')
    return json(route, { data: reviewBody(test, member) })
  })

  // /api/submissions/test/:testId/:studentId/review (save grade)
  await page.route('**/api/submissions/test/*/*/review', (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (!requireTeacher(route, email)) return
    if (route.request().method() !== 'PUT') return methodNotAllowed(route, 'PUT')
    const parts = segments(route)
    const test = findTest(String(parts.at(-3)), state)
    if (!test) return notFound(route, 'Test not found')
    if (state.releasedAt.has(test.id)) {
      return json(route, { message: 'Results are released, so grades are locked', code: 'CONFLICT' }, 409)
    }
    const member = memberByUid(test, String(parts.at(-2)))
    if (!member) return notFound(route, 'Submission not found')
    const record = state.reviews[`${test.id}:${member.email}`]
    if (!record) return json(route, { message: 'This student has not submitted this test', code: 'CONFLICT' }, 409)
    const body = (route.request().postDataJSON() ?? {}) as { marks?: unknown; comment?: unknown }
    let marks: number | null = null
    if (body.marks !== null && body.marks !== undefined) {
      const parsed = Number(body.marks)
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > totalPointsOf(test)) {
        return fail(route, `Enter a whole number of marks between 0 and ${totalPointsOf(test)}`)
      }
      marks = parsed
    }
    record.marks = marks
    record.comment = String(body.comment ?? '')
    return json(route, { message: 'Review saved', data: reviewBody(test, member) })
  })

  /* ------------------------------------------------------------------- monitor */

  await page.route('**/api/monitor/*/flags', (route) => {
    const email = requireAuth(route)
    if (!email) return
    const test = findTest(secondToLastSegment(route), state)
    if (!test) return notFound(route, 'Test not found')
    if (route.request().method() === 'POST') {
      const body = (route.request().postDataJSON() ?? {}) as { flagType?: string; metadata?: Record<string, unknown> }
      if (!['TAB_SWITCH', 'DEVTOOLS_OPEN', 'PASTE_ATTEMPT', 'FULLSCREEN_EXIT'].includes(String(body.flagType))) {
        return fail(route, 'That request is not valid.')
      }
      state.monitorEvents.push({ testId: test.id, uid: email, flagType: body.flagType, at: new Date().toISOString(), ...(body.metadata ?? {}) })
      return json(route, { message: 'Flag recorded' }, 201)
    }
    if (route.request().method() !== 'GET') return methodNotAllowed(route, 'GET, POST')
    if (!requireTeacher(route, email)) return
    const byStudent = new Map<string, Record<string, unknown>[]>()
    for (const event of state.monitorEvents) {
      if (event.testId !== test.id) continue
      const list = byStudent.get(String(event.uid)) ?? []
      list.push(event)
      byStudent.set(String(event.uid), list)
    }
    const students = [...byStudent.entries()].map(([studentEmail, events]) => {
      const member = state.roster.find((m) => m.classroomId === test.classroomId && m.email === studentEmail)
      const counts: Record<string, number> = {}
      for (const event of events) counts[String(event.flagType)] = (counts[String(event.flagType)] ?? 0) + 1
      return {
        studentId: member?.uid ?? `uid-${studentEmail}`,
        studentName: member?.displayName || studentEmail,
        studentEmail,
        total: events.length,
        counts,
        flags: events.map(({ testId: _t, uid: _u, flagType, at, ...metadata }) => ({ flagType, at: at ?? null, metadata })),
      }
    })
    students.sort((a, b) => b.total - a.total)
    return json(route, { data: { testId: test.id, students } })
  })

  /* -------------------------------------------------------------- plagiarism */

  // A stand-in for the AST engine: same response shape, with a crude
  // similarity (shared tokens) so the page has realistic data.
  const plagiarism = new Map<string, Record<string, unknown>>()
  const tokens = (code: string) => code.split(/[^A-Za-z0-9_]+/).filter(Boolean)
  const jaccard = (a: string[], b: string[]) => {
    const x = new Set(a)
    const y = new Set(b)
    const shared = [...x].filter((t) => y.has(t)).length
    const union = new Set([...x, ...y]).size
    return union === 0 ? 0 : shared / union
  }

  await page.route('**/api/plagiarism/*/check', (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (!requireTeacher(route, email)) return
    if (route.request().method() !== 'POST') return methodNotAllowed(route, 'POST')
    const test = findTest(secondToLastSegment(route), state)
    if (!test) return notFound(route, 'Test not found')
    const submitted = state.roster
      .filter((m) => m.classroomId === test.classroomId)
      .map((m) => ({ member: m, record: state.reviews[`${test.id}:${m.email}`] }))
      .filter((entry) => entry.record)
    const pairs: Record<string, unknown>[] = []
    for (let i = 0; i < submitted.length; i++) {
      for (let j = i + 1; j < submitted.length; j++) {
        const a = submitted[i]
        const b = submitted[j]
        const score = jaccard(tokens(a.record!.code), tokens(b.record!.code))
        pairs.push({
          submissionA: `${test.id}_${a.member.uid}`,
          submissionB: `${test.id}_${b.member.uid}`,
          studentA: { id: a.member.uid, name: a.member.displayName, email: a.member.email },
          studentB: { id: b.member.uid, name: b.member.displayName, email: b.member.email },
          metrics: {
            cosine_similarity: score,
            ted_score: Math.max(0, score - 0.05),
            identifier_overlap: score,
            operator_overlap: Math.min(1, score + 0.1),
            combined_score: score,
          },
          flagLevel: score >= 0.8 ? 'high' : score >= 0.7 ? 'medium' : score >= 0.5 ? 'low' : 'none',
        })
      }
    }
    const flagged = pairs.filter((p) => p.flagLevel !== 'none')
    plagiarism.set(test.id, {
      status: 'COMPLETED',
      pairs,
      flagged,
      summary: { totalSubmissions: submitted.length, totalPairs: pairs.length, flaggedPairs: flagged.length, processingTimeMs: 42 },
      skipped: {},
      updatedAt: new Date().toISOString(),
    })
    return json(route, { message: 'Plagiarism check queued' }, 202)
  })

  await page.route('**/api/plagiarism/*/status', (route) => {
    const email = requireAuth(route)
    if (!email) return
    if (!requireTeacher(route, email)) return
    const result = plagiarism.get(secondToLastSegment(route))
    if (!result) return json(route, { error: 'Plagiarism result not found' }, 404)
    return json(route, result)
  })

  /* ------------------------------------------------------------------ judge0 */

  // Code execution answers 503 until a Judge0 server is configured, as the backend does.
  await page.route('**/api/judge0/run', (route) =>
    json(route, { message: 'Code execution is not configured on this server yet' }, 503),
  )

  return state
}
