import { http as mswHttp, HttpResponse, delay, type HttpHandler } from 'msw'
import type { UserRole } from '@/shared/types'
import type {
  ClassroomStudent,
  ExamLanguage,
  Question,
  Submission,
  TestDetail,
  TestSummary,
} from '@/shared/types/classroom'
import {
  COLLEGE_ID,
  OTHER_COLLEGE_ID,
  STUDENT_UID,
  TEACHER_UID,
  resolveFixtures,
  type ResolvedFixtures,
  type ReviewSeed,
} from '@/tests/msw/fixtures'

/**
 * In-memory implementation of the classroom/exam contract the frontend expects.
 *
 * This is not a passive stub. It enforces the same server-side rules the real
 * backend must: the role comes from the token, never from the request body;
 * classroom reads are filtered by the caller's college; a foreign college's
 * classroom is a 404, not a 403, so existence is not leaked; joining needs both
 * the code and a matching `collegeId`; the test window is checked on submit; and
 * an `idempotencyKey` is de-duplicated server-side. Tests that assert on those
 * behaviours are testing the contract, not the mock.
 *
 * @see features/classrooms/classroomApi.ts for the route documentation.
 */

const TEACHER_ROLES: readonly UserRole[] = ['TEACHER', 'ADMIN']

/**
 * A submitted student's row in the mock's review store. Mirrors the server side
 * of the review contract: the case states are kept, but the case *content* is
 * only ever sent for a public case (see `buildReviewDetail`).
 */
interface ReviewRecord {
  testId: string
  uid: string
  state: 'SUBMITTED' | 'LATE'
  code: string
  submittedAt: string
  caseStates: ('PASS' | 'FAIL')[]
  marks: number | null
  comment: string
}

/** A `[key, record]` pair for the review store, keyed `${testId}:${uid}`. */
function reviewEntry(testId: string, seed: ReviewSeed): [string, ReviewRecord] {
  return [
    `${testId}:${seed.uid}`,
    {
      testId,
      uid: seed.uid,
      state: seed.state,
      code: seed.code,
      submittedAt: seed.submittedAt,
      caseStates: seed.caseStates,
      marks: seed.marks,
      comment: seed.comment,
    },
  ]
}

export interface MockBackendOptions {
  /** Pins "now", so window-relative fixtures are stable. */
  nowMs?: number
  latencyMs?: number
  /** Role per email. Mirrors the backend: a new account defaults to STUDENT. */
  roles?: Record<string, UserRole>
  /** false to simulate a backend without the proctoring route. */
  monitorEndpoint?: boolean
  /** Force every classroom/test route to 500. */
  failAll?: boolean
}

export interface MockBackendStore {
  fixtures: ResolvedFixtures
  submissions: Submission[]
  monitorEvents: unknown[]
  joinCodeSeq: number
  testSeq: number
  /** Counts a submit request that reached the handler, duplicates included. */
  submitAttempts: number
  /**
   * Attempt start times, keyed `${testId}:${uid}`. Latched on the first lobby
   * read that happens while the window is open, and never rewritten, so a
   * reload or a second visit cannot hand a student a fresh clock.
   */
  startedAt: Map<string, string>
  /** Graded submissions, keyed `${testId}:${uid}`. Absence means "not submitted". */
  reviews: Map<string, ReviewRecord>
  /** testId -> ISO time results were released, which locks further gradings. */
  releasedAt: Map<string, string>
}

export interface MockBackend {
  handlers: HttpHandler[]
  store: MockBackendStore
}

function unauthorized() {
  return HttpResponse.json({ message: 'Sign in to continue.', code: 'MISSING_TOKEN' }, { status: 401 })
}

function notFound(message = 'That record could not be found.') {
  return HttpResponse.json({ message, code: 'NOT_FOUND' }, { status: 404 })
}

function forbidden(message = "You don't have permission to do that.") {
  return HttpResponse.json({ message, code: 'FORBIDDEN' }, { status: 403 })
}

function conflict(message: string) {
  return HttpResponse.json({ message, code: 'CONFLICT' }, { status: 409 })
}

/**
 * Identity from the bearer token. The fake auth driver mints
 * `fake-id-token.<uid>.<counter>`, so the uid is recoverable without a real
 * Firebase. The role is looked up from the fixture table, never taken from the
 * token or the body, which is the property that keeps the frontend honest.
 */
function identityFrom(
  authorization: string | null,
  roles: Record<string, UserRole>,
  fixtures: ResolvedFixtures,
): { uid: string; role: UserRole; email: string; displayName: string } | null {
  if (!authorization?.startsWith('Bearer ')) return null
  const token = authorization.slice('Bearer '.length)
  const uid = token.split('.')[1] ?? ''
  if (uid.length === 0) return null

  const byUid: { uid: string; email: string; displayName: string }[] = [
    fixtures.teacher,
    fixtures.student,
    fixtures.otherStudent,
  ]
  const found = byUid.find((candidate) => candidate.uid === uid)
  const email = found?.email ?? `${uid}@mit.ac.in`
  const displayName = found?.displayName ?? 'Test Student'
  return { uid, email, displayName, role: roles[email] ?? 'STUDENT' }
}

/**
 * A test summary, with the per-caller fields filled in.
 *
 * `submittedCount` is the class-wide figure. `mySubmissionId` is the one field
 * that depends on who is asking: the id of the caller's own submission, or null.
 * A teacher has no attempt, so it is always null for them.
 */
function asSummary(
  testId: string,
  fixtures: ResolvedFixtures,
  store: MockBackendStore,
  uid: string | null,
): TestSummary | null {
  const found = fixtures.summaries.find((summary) => summary.id === testId)
  if (!found) return null
  const review = uid ? store.reviews.get(`${testId}:${uid}`) : undefined
  const live = uid
    ? store.submissions.find(
        (submission) => submission.testId === testId && submission.uid === uid && submission.status !== 'FAILED',
      )
    : undefined
  return {
    ...found,
    submittedCount:
      store.submissions.filter(
        (submission) => submission.testId === testId && submission.status !== 'FAILED',
      ).length +
      // Seeded/review gradings are submitted attempts too, so the classroom's
      // "n/total submitted" figure counts them rather than reading zero.
      [...store.reviews.values()].filter((r) => r.testId === testId).length,
    mySubmissionId: review ? `sub-${testId}-${uid}` : live ? live.id : null,
  }
}

export function createMockBackend(options: MockBackendOptions = {}): MockBackend {
  const nowMs = options.nowMs ?? Date.now()
  const fixtures = resolveFixtures({ nowMs })
  const roles: Record<string, UserRole> = {
    [fixtures.teacher.email]: 'TEACHER',
    [fixtures.student.email]: 'STUDENT',
    [fixtures.otherStudent.email]: 'STUDENT',
    ...options.roles,
  }

  const store: MockBackendStore = {
    fixtures,
    submissions: [],
    monitorEvents: [],
    joinCodeSeq: 0,
    testSeq: 100,
    submitAttempts: 0,
    startedAt: new Map<string, string>(),
    reviews: new Map<string, ReviewRecord>([
      ...fixtures.reviewSeeds.map((seed) => reviewEntry(fixtures.reviewTestId, seed)),
      // A second seeded grading on an ended test whose results are released, so
      // the student result surface has a released marks panel to render.
      reviewEntry(fixtures.resultTestId, fixtures.resultSeed),
    ]),
    /** testId -> ISO time results were released, which locks further gradings. */
    releasedAt: new Map<string, string>([[fixtures.resultTestId, fixtures.resultReleasedAt]]),
  }

  const wait = async () => {
    if (options.latencyMs) await delay(options.latencyMs)
  }

  /**
   * Resolves the caller, or short-circuits with a 401 response. Returns null and
   * has already written the response when it does.
   */
  async function authenticate(request: Request) {
    await wait()
    if (options.failAll) {
      return new HttpResponse(
        JSON.stringify({ message: 'Something went wrong on our side. Please try again.', code: 'INTERNAL_SERVER_ERROR' }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      )
    }
    const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
    if (!identity) return new HttpResponse(JSON.stringify({ message: 'Sign in to continue.', code: 'MISSING_TOKEN' }), { status: 401, headers: { 'content-type': 'application/json' } })
    return null
  }

  const json = <T,>(data: T, status = 200) =>
    new HttpResponse(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

  const classroomById = (id: string) =>
    [...fixtures.classrooms, fixtures.foreignClassroom].find((classroom) => classroom.id === id)

  const testsFor = (classroomId: string) => fixtures.tests.filter((test) => test.classroomId === classroomId)

  /** A registered fixture account with this email, if any; otherwise the add is a pending invite. */
  const knownAccountByEmail = (email: string) =>
    [fixtures.teacher, fixtures.student, fixtures.otherStudent].find(
      (account) => account.email.toLowerCase() === email.toLowerCase(),
    )

  /** The teacher's view of a classroom: counts, roster and test list. */
  const detailOf = (classroom: NonNullable<ReturnType<typeof classroomById>>, uid: string) => {
    const students = fixtures.roster[classroom.id] ?? []
    return {
      ...classroom,
      studentCount: students.length,
      testCount: testsFor(classroom.id).length,
      students,
      tests: testsFor(classroom.id).map((test) => asSummary(test.id, fixtures, store, uid)!),
    }
  }

  /** The stable id for a student's (possible) submission on a test. */
  const submissionIdFor = (testId: string, uid: string) =>
    `${store.reviews.has(`${testId}:${uid}`) ? 'sub' : 'pending'}-${testId}-${uid}`

  const reviewRosterFor = (test: TestDetail) => fixtures.roster[test.classroomId] ?? []

  const allCasesOf = (test: TestDetail) => test.questions.flatMap((question) => question.testCases)

  function buildReviewList(test: TestDetail) {
    const cases = allCasesOf(test)
    return {
      testId: test.id,
      testTitle: test.title,
      maxMarks: test.totalPoints,
      resultsReleased: store.releasedAt.has(test.id),
      releasedAt: store.releasedAt.get(test.id) ?? null,
      submissions: reviewRosterFor(test).map((member) => {
        const record = store.reviews.get(`${test.id}:${member.uid}`)
        return {
          id: submissionIdFor(test.id, member.uid),
          studentUid: member.uid,
          studentName: member.displayName,
          studentEmail: member.email,
          state: record ? record.state : ('NOT_SUBMITTED' as const),
          passedCases: record ? record.caseStates.filter((value) => value === 'PASS').length : 0,
          totalCases: cases.length,
          submittedAt: record?.submittedAt ?? null,
          marks: record?.marks ?? null,
          maxMarks: test.totalPoints,
        }
      }),
    }
  }

  function buildReviewDetail(test: TestDetail, member: ClassroomStudent) {
    const record = store.reviews.get(`${test.id}:${member.uid}`)
    const cases = allCasesOf(test)
    return {
      id: submissionIdFor(test.id, member.uid),
      testId: test.id,
      testTitle: test.title,
      studentUid: member.uid,
      studentName: member.displayName,
      studentEmail: member.email,
      state: record ? record.state : ('NOT_SUBMITTED' as const),
      language: test.language,
      code: record?.code ?? '',
      submittedAt: record?.submittedAt ?? null,
      cases: record
        ? cases.map((testCase, index) => {
            const state = record.caseStates[index] === 'PASS' ? ('PASS' as const) : ('FAIL' as const)
            return {
              id: testCase.id,
              name: `Test case ${index + 1}`,
              state,
              hidden: testCase.hidden,
              // A hidden case reports only its result. Its input, expected, and
              // actual values are withheld even from the teacher, so the case
              // cannot be leaked by opening this page.
              input: testCase.hidden ? null : testCase.input,
              expected: testCase.hidden ? null : testCase.expected,
              actual: testCase.hidden ? null : state === 'PASS' ? (testCase.expected ?? '') : 'undefined',
            }
          })
        : [],
      passedCases: record ? record.caseStates.filter((value) => value === 'PASS').length : 0,
      totalCases: cases.length,
      marks: record?.marks ?? null,
      maxMarks: test.totalPoints,
      comment: record?.comment ?? '',
      resultsReleased: store.releasedAt.has(test.id),
      releasedAt: store.releasedAt.get(test.id) ?? null,
    }
  }

  /**
   * A student's own result, scoped to the caller.
   *
   * Built from the same store the review surface uses, but stripped of what a
   * student must never see: a hidden case keeps only its state, and the marks and
   * comment stay withheld until the teacher releases them. A live submission
   * (posted through `/submissions`) has no per-case breakdown — the mock cannot
   * execute code — so it grades as passing every case; the seeded result fixtures
   * are what exercise FAIL rows.
   */
  function buildStudentResult(test: TestDetail, uid: string) {
    const record = store.reviews.get(`${test.id}:${uid}`)
    const live = store.submissions.find(
      (submission) =>
        submission.testId === test.id && submission.uid === uid && submission.status !== 'FAILED',
    )
    const cases = allCasesOf(test)
    const caseStates: ('PASS' | 'FAIL')[] = record ? record.caseStates : cases.map(() => 'PASS')
    const released = store.releasedAt.has(test.id)
    const submittedAt = record?.submittedAt ?? live?.submittedAt ?? new Date(nowMs).toISOString()
    // The recorded state wins; for a live submission, lateness is derived by
    // comparing the submission time to the window close.
    const late = Date.parse(submittedAt) >= Date.parse(test.windowEnd)
    return {
      testId: test.id,
      testTitle: test.title,
      language: test.language,
      state: record ? record.state : late ? ('LATE' as const) : ('SUBMITTED' as const),
      submittedAt,
      passedCases: caseStates.filter((value) => value === 'PASS').length,
      totalCases: cases.length,
      cases: cases.map((testCase, index) => {
        const caseState = caseStates[index] === 'PASS' ? ('PASS' as const) : ('FAIL' as const)
        return {
          id: testCase.id,
          name: `Test case ${index + 1}`,
          state: caseState,
          hidden: testCase.hidden,
          // A hidden case reports only its result. Its input, expected, and actual
          // values never travel to the client, so the case cannot be read off the page.
          input: testCase.hidden ? null : testCase.input,
          expected: testCase.hidden ? null : testCase.expected,
          actual: testCase.hidden ? null : caseState === 'PASS' ? (testCase.expected ?? '') : 'undefined',
        }
      }),
      marksReleased: released,
      releasedAt: released ? store.releasedAt.get(test.id) ?? null : null,
      // Withheld, not merely hidden by the UI: until release these are null/''.
      marks: released ? record?.marks ?? null : null,
      maxMarks: test.totalPoints,
      comment: released ? record?.comment ?? '' : '',
    }
  }

  /**
   * Resolves the test and the roster member a submission id names. The student is
   * found by rebuilding each member's id rather than by parsing the param, which
   * would be ambiguous because both ids can contain hyphens.
   */
  function resolveReviewTarget(testId: string, submissionId: string) {
    const test = fixtures.tests.find((candidate) => candidate.id === testId)
    if (!test) return { error: notFound('That test could not be found.') }
    const classroom = classroomById(test.classroomId)
    if (!classroom || classroom.collegeId !== COLLEGE_ID) {
      return { error: notFound('That test could not be found.') }
    }
    const member = reviewRosterFor(test).find(
      (candidate) => submissionIdFor(test.id, candidate.uid) === submissionId,
    )
    if (!member) return { error: notFound('That submission could not be found.') }
    return { test, member }
  }

  const handlers: HttpHandler[] = [
    /* ---------------------------------------------------------------- GET /api/classrooms */
    mswHttp.get('/api/classrooms', async ({ request }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      // A collegeId query parameter is deliberately ignored: scoping is the
      // server's job, derived from the verified token.
      if (TEACHER_ROLES.includes(identity.role)) {
        return json(fixtures.classrooms.filter((classroom) => classroom.collegeId === COLLEGE_ID))
      }
      return json([])
    }),

    /* ------------------------------------------------------- GET /api/classrooms/mine */
    // Declared before `/api/classrooms/:classroomId` so "mine" is never read as
    // an id. MSW matches in order, so this ordering is load-bearing.
    mswHttp.get('/api/classrooms/mine', async ({ request }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      return json(
        fixtures.classrooms.filter(
          (classroom) => classroom.collegeId === COLLEGE_ID && (fixtures.roster[classroom.id] ?? []).some((member) => member.email.toLowerCase() === identity.email.toLowerCase()),
        ),
      )
    }),

    /* -------------------------------------------------- GET /api/classrooms/:classroomId */
    mswHttp.get('/api/classrooms/:classroomId', async ({ request, params }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      const classroom = classroomById(String(params.classroomId))
      // A classroom in another college is reported as missing, not forbidden, so
      // the response does not confirm that it exists.
      if (!classroom || classroom.collegeId !== COLLEGE_ID) return notFound('That classroom could not be found.')
      /*
       * Teacher-only, and this is the rule the mock has to get right: the payload
       * carries `students`, so a 200 here would hand a student every classmate's
       * name and email. Enrolment is checked on the routes a student actually
       * uses (`/api/classrooms/mine`, the test list, the lobby) rather than by
       * letting them read the teacher's view of the room.
       */
      if (!TEACHER_ROLES.includes(identity.role)) {
        return forbidden('Only the teacher who owns this classroom can open it.')
      }
      return json(detailOf(classroom, identity.uid))
    }),

    /* -------------------------------------------------------- POST /api/classrooms */
    mswHttp.post('/api/classrooms', async ({ request }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      if (!TEACHER_ROLES.includes(identity.role)) return forbidden('Only teachers can create classrooms.')

      const body = (await request.json()) as { name?: string; subject?: string; description?: string }
      const name = String(body.name ?? '').trim()
      const subject = String(body.subject ?? '').trim()
      if (name.length === 0) {
        return json({ message: 'Give the classroom a name.', code: 'VALIDATION_ERROR' }, 400)
      }

      store.joinCodeSeq += 1
      const created = {
        id: `room-new-${store.joinCodeSeq}`,
        collegeId: COLLEGE_ID,
        name,
        subject: subject || 'General',
        description: String(body.description ?? '').trim(),
        teacherId: identity.uid,
        teacherName: identity.displayName,
        joinCode: `NEW${String(store.joinCodeSeq).padStart(2, '0')}`,
        studentCount: 0,
        testCount: 0,
        createdAt: new Date(nowMs).toISOString(),
      }
      fixtures.classrooms.push(created)
      fixtures.roster[created.id] = []
      return json(created, 201)
    }),

    /* ------------------------------------ POST /api/classrooms/:classroomId/students */
    // Teacher-only enrolment by email. Unregistered addresses are accepted as
    // `pending`; re-adding an enrolled address is reported, not duplicated.
    mswHttp.post('/api/classrooms/:classroomId/students', async ({ request, params }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      const classroom = classroomById(String(params.classroomId))
      if (!classroom || classroom.collegeId !== COLLEGE_ID) return notFound('That classroom could not be found.')
      if (!TEACHER_ROLES.includes(identity.role)) {
        return forbidden('Only the teacher who owns this classroom can add students.')
      }

      const body = (await request.json()) as { emails?: unknown }
      const emails = Array.isArray(body.emails)
        ? [...new Set(body.emails.map((email) => String(email).trim().toLowerCase()).filter(Boolean))]
        : []
      if (emails.length === 0) {
        return json({ message: 'Enter at least one student email.', code: 'VALIDATION_ERROR' }, 400)
      }
      if (emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
        return json({ message: 'One or more of those emails is not valid.', code: 'VALIDATION_ERROR' }, 400)
      }

      const roster = fixtures.roster[classroom.id] ?? []
      const added: string[] = []
      const alreadyEnrolled: string[] = []
      for (const email of emails) {
        if (roster.some((member) => member.email.toLowerCase() === email)) {
          alreadyEnrolled.push(email)
          continue
        }
        const account = knownAccountByEmail(email)
        roster.push({
          uid: account?.uid ?? '',
          email,
          displayName: account?.displayName ?? '',
          joinedAt: new Date(nowMs).toISOString(),
          pending: !account,
        })
        added.push(email)
      }
      fixtures.roster[classroom.id] = roster
      classroom.studentCount = roster.length
      return json({ classroom: detailOf(classroom, identity.uid), added, alreadyEnrolled }, added.length > 0 ? 201 : 200)
    }),

    /* ----------------------------- DELETE /api/classrooms/:classroomId/students/:email */
    mswHttp.delete('/api/classrooms/:classroomId/students/:email', async ({ request, params }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      const classroom = classroomById(String(params.classroomId))
      if (!classroom || classroom.collegeId !== COLLEGE_ID) return notFound('That classroom could not be found.')
      if (!TEACHER_ROLES.includes(identity.role)) {
        return forbidden('Only the teacher who owns this classroom can remove students.')
      }
      const email = decodeURIComponent(String(params.email)).toLowerCase()
      const roster = fixtures.roster[classroom.id] ?? []
      const next = roster.filter((member) => member.email.toLowerCase() !== email)
      if (next.length === roster.length) return notFound('That student is not in this classroom.')
      fixtures.roster[classroom.id] = next
      classroom.studentCount = next.length
      return json(detailOf(classroom, identity.uid))
    }),

    /* ------------------------------------------- GET /api/classrooms/:classroomId/tests */
    mswHttp.get('/api/classrooms/:classroomId/tests', async ({ request, params }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      const classroom = classroomById(String(params.classroomId))
      if (!classroom || classroom.collegeId !== COLLEGE_ID) return notFound('That classroom could not be found.')
      return json(testsFor(classroom.id).map((test) => asSummary(test.id, fixtures, store, identity.uid)!))
    }),

    /* ---------------------------------------- POST /api/classrooms/:classroomId/tests */
    mswHttp.post('/api/classrooms/:classroomId/tests', async ({ request, params }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      if (!TEACHER_ROLES.includes(identity.role)) return forbidden('Only teachers can create tests.')
      const classroom = classroomById(String(params.classroomId))
      if (!classroom || classroom.collegeId !== COLLEGE_ID) return notFound('That classroom could not be found.')

      const body = (await request.json()) as {
        title?: string
        instructions?: string
        language?: ExamLanguage
        windowStart?: string
        windowEnd?: string
        durationMinutes?: number
        questions?: { prompt?: string; starterCode?: string; points?: number; testCases?: unknown[] }[]
      }
      const title = String(body.title ?? '').trim()
      if (title.length === 0) {
        return json({ message: 'Give the test a title.', code: 'VALIDATION_ERROR' }, 400)
      }
      const start = Date.parse(String(body.windowStart ?? ''))
      const end = Date.parse(String(body.windowEnd ?? ''))
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return json({ message: 'Set a valid start and end for the test window.', code: 'VALIDATION_ERROR' }, 400)
      }
      if (end <= start) {
        return json({ message: 'The window must end after it starts.', code: 'VALIDATION_ERROR' }, 400)
      }
      const questions = (body.questions ?? [])
        .filter((entry) => String(entry.prompt ?? '').trim().length > 0)
        .map(
          (entry, index): Question => ({
            id: `q-new-${store.testSeq}-${index}`,
            prompt: String(entry.prompt).trim(),
            starterCode: String(entry.starterCode ?? ''),
            language: (body.language ?? 'javascript') as ExamLanguage,
            testCases: (entry.testCases ?? []).map((testCase, testIndex) => ({
              id: `tc-${store.testSeq}-${index}-${testIndex}`,
              input: String((testCase as { input?: string }).input ?? ''),
              expected: String((testCase as { expected?: string }).expected ?? ''),
              hidden: Boolean((testCase as { hidden?: boolean }).hidden),
            })),
            points: Number(entry.points ?? 10) || 10,
            order: index,
          }),
        )
      if (questions.length === 0) {
        return json({ message: 'Add at least one question.', code: 'VALIDATION_ERROR' }, 400)
      }

      store.testSeq += 1
      const detail: TestDetail = {
        id: `test-new-${store.testSeq}`,
        classroomId: classroom.id,
        classroomName: classroom.name,
        title,
        instructions: String(body.instructions ?? '').trim(),
        language: (body.language ?? 'javascript') as ExamLanguage,
        windowStart: new Date(start).toISOString(),
        windowEnd: new Date(end).toISOString(),
        durationMinutes: Number(body.durationMinutes ?? 60) || 60,
        questions,
        totalPoints: questions.reduce((total, entry) => total + entry.points, 0),
      }
      fixtures.tests.push(detail)
      fixtures.questions[detail.id] = questions
      fixtures.summaries.push({
        id: detail.id,
        classroomId: classroom.id,
        title: detail.title,
        language: detail.language,
        windowStart: detail.windowStart,
        windowEnd: detail.windowEnd,
        durationMinutes: detail.durationMinutes,
        questionCount: questions.length,
        totalPoints: detail.totalPoints,
        submittedCount: 0,
        mySubmissionId: null,
        createdAt: new Date(nowMs).toISOString(),
      })
      return json(asSummary(detail.id, fixtures, store, identity.uid), 201)
    }),

    /* ------------------------------------------------------------ GET /api/tests */
    // Static path, listed before `/api/tests/:testId` so it is never read as an id.
    mswHttp.get('/api/tests', async ({ request }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      // Only tests in a classroom this student is enrolled in, in their college.
      const enrolled = new Set(
        [...fixtures.classrooms, fixtures.foreignClassroom]
          .filter(
            (classroom) =>
              classroom.collegeId === COLLEGE_ID &&
              (fixtures.roster[classroom.id] ?? []).some((member) => member.email.toLowerCase() === identity.email.toLowerCase()),
          )
          .map((classroom) => classroom.id),
      )
      return json(
        fixtures.tests
          .filter((test) => enrolled.has(test.classroomId))
          .map((test) => asSummary(test.id, fixtures, store, identity.uid)!),
      )
    }),

    /* ------------------------------------------------------------ GET /api/tests/:testId */
    mswHttp.get('/api/tests/:testId', async ({ request, params }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      const test = fixtures.tests.find((candidate) => candidate.id === String(params.testId))
      if (!test) return notFound('That test could not be found.')
      const classroom = classroomById(test.classroomId)
      if (!classroom || classroom.collegeId !== COLLEGE_ID) return notFound('That test could not be found.')
      // Hidden test cases never leave the server.
      return json({ ...test, questions: test.questions.map((q) => ({ ...q, testCases: q.testCases.filter((tc) => !tc.hidden) })) })
    }),

    /* ---------------------------------------------------- GET /api/tests/:testId/lobby */
    mswHttp.get('/api/tests/:testId/lobby', async ({ request, params }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      const test = fixtures.tests.find((candidate) => candidate.id === String(params.testId))
      if (!test) return notFound('That test could not be found.')
      const classroom = classroomById(test.classroomId)
      if (!classroom || classroom.collegeId !== COLLEGE_ID) return notFound('That test could not be found.')
      const enrolled = (fixtures.roster[classroom.id] ?? []).some((member) => member.email.toLowerCase() === identity.email.toLowerCase())
      if (!enrolled && !TEACHER_ROLES.includes(identity.role)) {
        return forbidden('You are not enrolled in this classroom.')
      }
      /*
       * Read-only. The lobby is where a student reads the rules, so it must not
       * start their attempt; only `POST /api/tests/:id/attempts` does that.
       */
      return json({
        test: { ...test, questions: test.questions.map((q) => ({ ...q, testCases: q.testCases.filter((tc) => !tc.hidden) })) },
        // Authoritative clock. The client measures its offset against this.
        serverTime: new Date(nowMs).toISOString(),
        startedAt: store.startedAt.get(`${test.id}:${identity.uid}`) ?? null,
        submission: store.submissions.find(
          (submission) => submission.testId === test.id && submission.uid === identity.uid,
        ) ?? null,
      })
    }),

    /* ------------------------------------------- POST /api/tests/:testId/attempts */
    mswHttp.post('/api/tests/:testId/attempts', async ({ request, params }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      const test = fixtures.tests.find((candidate) => candidate.id === String(params.testId))
      if (!test) return notFound('That test could not be found.')
      const classroom = classroomById(test.classroomId)
      if (!classroom || classroom.collegeId !== COLLEGE_ID) return notFound('That test could not be found.')
      const enrolled = (fixtures.roster[classroom.id] ?? []).some((member) => member.email.toLowerCase() === identity.email.toLowerCase())
      if (!enrolled && !TEACHER_ROLES.includes(identity.role)) {
        return forbidden('You are not enrolled in this classroom.')
      }
      if (store.submissions.some((s) => s.testId === test.id && s.uid === identity.uid)) {
        return conflict('You have already submitted this test.')
      }
      if (nowMs < Date.parse(test.windowStart)) {
        return forbidden('This test has not opened yet.')
      }
      if (nowMs >= Date.parse(test.windowEnd)) {
        return forbidden('This test has closed.')
      }

      /*
       * Latched, not overwritten. A reload, a second tab, or a double-click on
       * "Start" all return the original start time, so the allowance cannot be
       * reset by re-entering the exam.
       */
      const startKey = `${test.id}:${identity.uid}`
      if (!store.startedAt.has(startKey)) {
        store.startedAt.set(startKey, new Date(nowMs).toISOString())
      }
      return json({
        test: { ...test, questions: test.questions.map((q) => ({ ...q, testCases: q.testCases.filter((tc) => !tc.hidden) })) },
        serverTime: new Date(nowMs).toISOString(),
        startedAt: store.startedAt.get(startKey) ?? null,
        submission: null,
      })
    }),

    /* ------------------------------------- GET /api/tests/:testId/submissions/mine */
    mswHttp.get('/api/tests/:testId/submissions/mine', async ({ request, params }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      const test = fixtures.tests.find((candidate) => candidate.id === String(params.testId))
      if (!test) return notFound('That test could not be found.')
      return (
        json(
          store.submissions.find((s) => s.testId === test.id && s.uid === identity.uid) ?? null,
        ) ?? new HttpResponse(null, { status: 204 })
      )
    }),

    /* --------------------------------------- POST /api/tests/:testId/submissions */
    mswHttp.post('/api/tests/:testId/submissions', async ({ request, params }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      const testId = String(params.testId)
      const test = fixtures.tests.find((candidate) => candidate.id === testId)
      if (!test) return notFound('That test could not be found.')

      store.submitAttempts += 1
      const body = (await request.json()) as { code?: string; language?: ExamLanguage; idempotencyKey?: string }
      const idempotencyKey = String(body.idempotencyKey ?? '')
      if (idempotencyKey.length === 0) {
        return json({ message: 'A submission needs an idempotency key.', code: 'VALIDATION_ERROR' }, 400)
      }
      // Server-side de-duplication: the same key from the same student is one
      // submission, however many times it arrives.
      const existing = store.submissions.find(
        (submission) => submission.testId === testId && submission.uid === identity.uid && submission.idempotencyKey === idempotencyKey,
      )
      if (existing) return json(existing, 200)

      // The window is re-checked here: a client clock cannot buy extra time.
      if (nowMs < Date.parse(test.windowStart)) {
        return json({ message: 'This test has not opened yet.', code: 'TEST_NOT_OPEN' }, 409)
      }
      if (nowMs >= Date.parse(test.windowEnd)) {
        return json({ message: 'This test has closed.', code: 'TEST_CLOSED' }, 409)
      }

      const submission: Submission = {
        id: `sub-${testId}-${identity.uid}-${idempotencyKey.slice(0, 8)}`,
        testId,
        uid: identity.uid,
        language: (body.language ?? test.language) as ExamLanguage,
        code: String(body.code ?? ''),
        status: 'GRADED',
        idempotencyKey,
        submittedAt: new Date(nowMs).toISOString(),
        score: 0,
        maxScore: test.totalPoints,
      }
      store.submissions.push(submission)
      return json(submission, 201)
    }),

    /* ------------------------------- POST /api/tests/:testId/monitor-events */
    mswHttp.post('/api/tests/:testId/monitor-events', async ({ request, params }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      if (options.monitorEndpoint === false) return notFound('Unknown route.')
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      const testId = String(params.testId)
      const test = fixtures.tests.find((candidate) => candidate.id === testId)
      if (!test) return notFound('That test could not be found.')
      const body = (await request.json()) as { event?: unknown; events?: unknown[] }
      const incoming = body.events ?? (body.event ? [body.event] : [])
      for (const event of incoming) {
        store.monitorEvents.push({ testId, uid: identity.uid, ...(event as Record<string, unknown>) })
      }
      return new HttpResponse(null, { status: 204 })
    }),

    /* --------------------------------------------- GET /api/tests/:testId/result */
    // The student's own result. Declared before the review routes; it shares no
    // path shape with them, and `:testId` alone never matches the extra segment.
    mswHttp.get('/api/tests/:testId/result', async ({ request, params }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      // Teachers and admins read results through the review screens, not here.
      if (TEACHER_ROLES.includes(identity.role)) {
        return forbidden('Results are viewed through the review screens.')
      }
      const test = fixtures.tests.find((candidate) => candidate.id === String(params.testId))
      if (!test) return notFound('That test could not be found.')
      const classroom = classroomById(test.classroomId)
      if (!classroom || classroom.collegeId !== COLLEGE_ID) return notFound('That test could not be found.')
      // Only the owning student, and only if they actually submitted. A 404
      // rather than a 403, so a peer's submission is not confirmed to exist.
      const submitted =
        store.reviews.has(`${test.id}:${identity.uid}`) ||
        store.submissions.some(
          (submission) =>
            submission.testId === test.id &&
            submission.uid === identity.uid &&
            submission.status !== 'FAILED',
        )
      if (!submitted) return notFound('We could not find a result for this test.')
      return json(buildStudentResult(test, identity.uid))
    }),

    /* -------------------------------------------- GET /api/tests/:testId/submissions */
    mswHttp.get('/api/tests/:testId/submissions', async ({ request, params }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      if (!TEACHER_ROLES.includes(identity.role)) {
        return forbidden('Only a teacher can review submissions.')
      }
      const test = fixtures.tests.find((candidate) => candidate.id === String(params.testId))
      if (!test) return notFound('That test could not be found.')
      const classroom = classroomById(test.classroomId)
      if (!classroom || classroom.collegeId !== COLLEGE_ID) return notFound('That test could not be found.')
      return json(buildReviewList(test))
    }),

    /* -------------------------------- GET /api/tests/:testId/submissions/:submissionId */
    mswHttp.get('/api/tests/:testId/submissions/:submissionId', async ({ request, params }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      if (!TEACHER_ROLES.includes(identity.role)) {
        return forbidden('Only a teacher can review submissions.')
      }
      const target = resolveReviewTarget(String(params.testId), String(params.submissionId))
      if ('error' in target) return target.error
      return json(buildReviewDetail(target.test, target.member))
    }),

    /* ---------------------------- PUT /api/tests/:testId/submissions/:submissionId/review */
    mswHttp.put('/api/tests/:testId/submissions/:submissionId/review', async ({ request, params }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      if (!TEACHER_ROLES.includes(identity.role)) {
        return forbidden('Only a teacher can grade submissions.')
      }
      const target = resolveReviewTarget(String(params.testId), String(params.submissionId))
      if ('error' in target) return target.error
      const { test, member } = target
      // A release freezes the gradings, so a late save cannot contradict what the
      // students have already been told.
      if (store.releasedAt.has(test.id)) {
        return conflict('Results are released, so gradings are locked.')
      }
      const record = store.reviews.get(`${test.id}:${member.uid}`)
      if (!record) return conflict('This student did not submit this test.')

      const body = (await request.json()) as { marks?: unknown; comment?: unknown }
      let marks: number | null = null
      if (body.marks !== null && body.marks !== undefined) {
        const parsed = Number(body.marks)
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > test.totalPoints) {
          return json(
            { message: `Enter a whole number of marks between 0 and ${test.totalPoints}.`, code: 'VALIDATION_ERROR' },
            400,
          )
        }
        marks = parsed
      }
      record.marks = marks
      record.comment = String(body.comment ?? '')
      return json(buildReviewDetail(test, member))
    }),

    /* ------------------------------------------- POST /api/tests/:testId/submissions/release */
    mswHttp.post('/api/tests/:testId/submissions/release', async ({ request, params }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      if (!TEACHER_ROLES.includes(identity.role)) {
        return forbidden('Only a teacher can release results.')
      }
      const test = fixtures.tests.find((candidate) => candidate.id === String(params.testId))
      if (!test) return notFound('That test could not be found.')
      const classroom = classroomById(test.classroomId)
      if (!classroom || classroom.collegeId !== COLLEGE_ID) return notFound('That test could not be found.')
      // Idempotent: releasing twice keeps the original release time, so a
      // double-click cannot rewrite what the students saw first.
      if (!store.releasedAt.has(test.id)) {
        store.releasedAt.set(test.id, new Date(nowMs).toISOString())
      }
      return json(buildReviewList(test))
    }),
  ]

  return { handlers, store }
}

/** Convenience for the common case: a single call seeded from the real clock. */
export function classroomHandlers(options: MockBackendOptions = {}): HttpHandler[] {
  return createMockBackend(options).handlers
}

/** The student whose submissions the store starts empty for. */
export const DEFAULT_STUDENT_UID = STUDENT_UID
export const DEFAULT_TEACHER_UID = TEACHER_UID
export const OTHER_COLLEGE = OTHER_COLLEGE_ID
export const TEACHER_ONLY = TEACHER_ROLES
