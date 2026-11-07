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
      (candidate) => candidate.uid === submissionId || submissionIdFor(test.id, candidate.uid) === submissionId,
    )
    if (!member) return { error: notFound('That submission could not be found.') }
    return { test, member }
  }

  /* ------------------------------------------------------------------------ */
  /*  Backend-shaped views (the real API wraps payloads as { data })          */
  /* ------------------------------------------------------------------------ */

  const isEnrolled = (classroomId: string, email: string) =>
    (fixtures.roster[classroomId] ?? []).some((member) => member.email.toLowerCase() === email.toLowerCase())

  /** Hidden cases keep their id but never their content, as the backend's entry route sends them. */
  const maskQuestions = (test: TestDetail) =>
    test.questions.map((q) => ({
      ...q,
      testCases: q.testCases.map((tc) => (tc.hidden ? { id: tc.id, hidden: true, input: null, expected: null } : tc)),
    }))

  const findTest = (testId: string) => {
    const test = fixtures.tests.find((candidate) => candidate.id === testId)
    if (!test) return null
    const classroom = classroomById(test.classroomId)
    if (!classroom || classroom.collegeId !== COLLEGE_ID) return null
    return { test, classroom }
  }

  /** A `GET /api/tests` row: summary fields plus the backend's own names. */
  const testRow = (testId: string, uid: string, teacher: boolean) => {
    const summary = asSummary(testId, fixtures, store, uid)!
    const test = fixtures.tests.find((candidate) => candidate.id === testId)!
    return {
      ...summary,
      startTime: summary.windowStart,
      endTime: summary.windowEnd,
      mySubmissionStatus: summary.mySubmissionId ? 'SUBMITTED' : null,
      // The owner's list carries the full document; a student's never does.
      ...(teacher ? { questions: test.questions, instructions: test.instructions } : {}),
    }
  }

  const submissionStatusFor = (testId: string, uid: string) => {
    const submitted =
      store.reviews.has(`${testId}:${uid}`) ||
      store.submissions.some((s) => s.testId === testId && s.uid === uid && s.status !== 'FAILED')
    if (!submitted) return null
    const live = store.submissions.find((s) => s.testId === testId && s.uid === uid)
    return { status: 'SUBMITTED', submittedAt: live?.submittedAt ?? new Date(nowMs).toISOString() }
  }

  const backendReviewList = (test: TestDetail) => {
    const list = buildReviewList(test)
    return {
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
        flags: flagCountsFor(test.id, row.studentUid),
      })),
    }
  }

  const backendReviewDetail = (test: TestDetail, member: { uid: string; email: string; displayName: string }) => {
    const detail = buildReviewDetail(test, member as never)
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
      flags: flagCountsFor(test.id, member.uid),
    }
  }

  const flagCountsFor = (testId: string, uid: string) => {
    const counts: Record<string, number> = {}
    for (const raw of store.monitorEvents) {
      const event = raw as Record<string, unknown>
      if (event.testId !== testId || event.uid !== uid) continue
      const type = String((event as { flagType?: unknown }).flagType ?? '')
      if (type) counts[type] = (counts[type] ?? 0) + 1
    }
    return counts
  }

  const handlers: HttpHandler[] = [
    /* ---------------------------------------------------------------- GET /api/classrooms */
    // One route for both roles, scoped by the token: a teacher gets their
    // classrooms with counts, a student only the ones they were added to --
    // and never the roster.
    mswHttp.get('/api/classrooms', async ({ request }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      const inCollege = fixtures.classrooms.filter((classroom) => classroom.collegeId === COLLEGE_ID)
      if (TEACHER_ROLES.includes(identity.role)) {
        return json({
          data: inCollege.map((classroom) => {
            const roster = fixtures.roster[classroom.id] ?? []
            return {
              ...classroom,
              students: roster.filter((m) => !m.pending).map((m) => m.uid),
              invitedEmails: roster.filter((m) => m.pending).map((m) => m.email),
              studentCount: roster.filter((m) => !m.pending).length,
              invitedCount: roster.filter((m) => m.pending).length,
              testCount: testsFor(classroom.id).length,
            }
          }),
        })
      }
      return json({
        data: inCollege
          .filter((classroom) => isEnrolled(classroom.id, identity.email))
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
    }),

    /* -------------------------------------------------- GET /api/classrooms/:classroomId */
    mswHttp.get('/api/classrooms/:classroomId', async ({ request, params }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      // Teacher-only: the payload carries the roster.
      if (!TEACHER_ROLES.includes(identity.role)) {
        return forbidden('Forbidden: Insufficient permissions')
      }
      const classroom = classroomById(String(params.classroomId))
      // Another college's classroom is reported as missing, not forbidden.
      if (!classroom || classroom.collegeId !== COLLEGE_ID) return notFound('Classroom not found')
      return json({ data: detailOf(classroom, identity.uid) })
    }),

    /* -------------------------------------------------------- POST /api/classrooms */
    mswHttp.post('/api/classrooms', async ({ request }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      if (!TEACHER_ROLES.includes(identity.role)) return forbidden('Forbidden: Insufficient permissions')

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
        studentCount: 0,
        testCount: 0,
        createdAt: new Date(nowMs).toISOString(),
      }
      fixtures.classrooms.push(created)
      fixtures.roster[created.id] = []
      return json({ message: 'Classroom created successfully', data: { id: created.id } }, 201)
    }),

    /* ------------------------------------ POST /api/classrooms/:classroomId/students */
    // Enrolment by email. Registered students are added, unregistered emails are
    // kept as invites; re-adding is reported, not duplicated.
    mswHttp.post('/api/classrooms/:classroomId/students', async ({ request, params }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      if (!TEACHER_ROLES.includes(identity.role)) {
        return forbidden('Forbidden: Insufficient permissions')
      }
      const classroom = classroomById(String(params.classroomId))
      if (!classroom || classroom.collegeId !== COLLEGE_ID) return notFound('Classroom not found')

      const body = (await request.json()) as { emails?: unknown }
      const emails = Array.isArray(body.emails)
        ? [...new Set(body.emails.map((email) => String(email).trim().toLowerCase()).filter(Boolean))]
        : []
      if (emails.length === 0) {
        return json({ message: 'Enter at least one student email', code: 'VALIDATION_ERROR' }, 400)
      }

      const roster = fixtures.roster[classroom.id] ?? []
      const result = {
        added: [] as string[],
        invited: [] as string[],
        alreadyEnrolled: [] as string[],
        rejected: [] as { email: string; reason: string }[],
      }
      for (const email of emails) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          result.rejected.push({ email, reason: 'Not a valid email address' })
          continue
        }
        if (roster.some((member) => member.email.toLowerCase() === email)) {
          result.alreadyEnrolled.push(email)
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
        if (account) result.added.push(email)
        else result.invited.push(email)
      }
      fixtures.roster[classroom.id] = roster
      classroom.studentCount = roster.length
      const changed = result.added.length + result.invited.length > 0
      return json(
        { message: 'Students updated', result, data: detailOf(classroom, identity.uid) },
        changed ? 201 : 200,
      )
    }),

    /* ----------------------------- DELETE /api/classrooms/:classroomId/students/:email */
    mswHttp.delete('/api/classrooms/:classroomId/students/:email', async ({ request, params }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      if (!TEACHER_ROLES.includes(identity.role)) {
        return forbidden('Forbidden: Insufficient permissions')
      }
      const classroom = classroomById(String(params.classroomId))
      if (!classroom || classroom.collegeId !== COLLEGE_ID) return notFound('Classroom not found')
      const email = decodeURIComponent(String(params.email)).toLowerCase()
      const roster = fixtures.roster[classroom.id] ?? []
      const next = roster.filter((member) => member.email.toLowerCase() !== email)
      if (next.length === roster.length) return notFound('That student is not in this classroom')
      fixtures.roster[classroom.id] = next
      classroom.studentCount = next.length
      return json({ message: 'Student removed', data: detailOf(classroom, identity.uid) })
    }),

    /* ------------------------------------------------------------ POST /api/tests */
    mswHttp.post('/api/tests', async ({ request }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      if (!TEACHER_ROLES.includes(identity.role)) return forbidden('Forbidden: Insufficient permissions')

      const body = (await request.json()) as {
        classroomId?: string
        title?: string
        instructions?: string
        language?: ExamLanguage
        startTime?: string
        endTime?: string
        durationMinutes?: number
        questions?: { id?: string; prompt?: string; starterCode?: string; points?: number; testCases?: unknown[] }[]
      }
      const classroom = classroomById(String(body.classroomId ?? ''))
      if (!classroom || classroom.collegeId !== COLLEGE_ID) return notFound('Classroom not found')
      const title = String(body.title ?? '').trim()
      if (title.length === 0) {
        return json({ message: 'Give the test a title.', code: 'VALIDATION_ERROR' }, 400)
      }
      const start = Date.parse(String(body.startTime ?? ''))
      const end = Date.parse(String(body.endTime ?? ''))
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return json({ message: 'endTime must be after startTime', code: 'VALIDATION_ERROR' }, 400)
      }
      store.testSeq += 1
      const questions = (body.questions ?? [])
        .filter((entry) => String(entry.prompt ?? '').trim().length > 0)
        .map(
          (entry, index): Question => ({
            id: String(entry.id ?? `q${index + 1}`),
            prompt: String(entry.prompt).trim(),
            starterCode: String(entry.starterCode ?? ''),
            language: (body.language ?? 'python') as ExamLanguage,
            testCases: (entry.testCases ?? []).map((testCase, testIndex) => ({
              id: String((testCase as { id?: string }).id ?? `c${testIndex + 1}`),
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
      const detail: TestDetail = {
        id: `test-new-${store.testSeq}`,
        classroomId: classroom.id,
        classroomName: classroom.name,
        title,
        instructions: String(body.instructions ?? '').trim(),
        language: (body.language ?? 'python') as ExamLanguage,
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
      return json({ message: 'Test created successfully', data: { id: detail.id } }, 201)
    }),

    /* ------------------------------------------------------------ GET /api/tests */
    mswHttp.get('/api/tests', async ({ request }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      const teacher = TEACHER_ROLES.includes(identity.role)
      const visible = fixtures.tests.filter((test) => {
        const classroom = classroomById(test.classroomId)
        if (!classroom || classroom.collegeId !== COLLEGE_ID) return false
        // A student sees only tests of classrooms they were added to.
        return teacher || isEnrolled(classroom.id, identity.email)
      })
      return json({ data: visible.map((test) => testRow(test.id, identity.uid, teacher)) })
    }),

    /* ---------------------------------------------------- GET /api/tests/:testId/lobby */
    // Details, server clock and own status -- no questions, and no timer start.
    mswHttp.get('/api/tests/:testId/lobby', async ({ request, params }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      const found = findTest(String(params.testId))
      if (!found) return notFound('Test not found')
      const { test, classroom } = found
      if (!isEnrolled(classroom.id, identity.email) && !TEACHER_ROLES.includes(identity.role)) {
        return forbidden("Forbidden: You are not a member of this test's classroom")
      }
      const startedAt = store.startedAt.get(`${test.id}:${identity.uid}`) ?? null
      return json({
        data: {
          test: {
            id: test.id,
            title: test.title,
            classroomId: test.classroomId,
            classroomName: test.classroomName,
            instructions: test.instructions,
            language: test.language,
            windowStart: test.windowStart,
            windowEnd: test.windowEnd,
            durationMinutes: test.durationMinutes,
            questionCount: test.questions.length,
            totalPoints: test.totalPoints,
          },
          serverTime: new Date(nowMs).toISOString(),
          startedAt,
          deadline: null,
          submission: submissionStatusFor(test.id, identity.uid),
        },
      })
    }),

    /* ---------------------------------------------------- GET /api/tests/:testId/entry */
    // Starts the attempt: the first call latches `startedAt`, never rewritten.
    mswHttp.get('/api/tests/:testId/entry', async ({ request, params }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      const found = findTest(String(params.testId))
      if (!found) return notFound('Test not found')
      const { test, classroom } = found
      if (!isEnrolled(classroom.id, identity.email)) {
        return forbidden("Forbidden: You are not a member of this test's classroom")
      }
      if (nowMs < Date.parse(test.windowStart)) return forbidden('Forbidden: Test has not started yet')
      if (nowMs > Date.parse(test.windowEnd)) return forbidden('Forbidden: Test has already ended')

      const startKey = `${test.id}:${identity.uid}`
      if (!store.startedAt.has(startKey)) store.startedAt.set(startKey, new Date(nowMs).toISOString())
      const masked = { ...test, questions: maskQuestions(test) }
      return json({
        message: 'Entered exam successfully',
        data: {
          ...masked,
          test: masked,
          serverTime: new Date(nowMs).toISOString(),
          startedAt: store.startedAt.get(startKey) ?? null,
          submission: submissionStatusFor(test.id, identity.uid),
        },
      })
    }),

    /* ------------------------------------------------------ POST /api/submissions/save */
    mswHttp.post('/api/submissions/save', async ({ request }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      const body = (await request.json()) as { testId?: string }
      if (submissionStatusFor(String(body.testId ?? ''), identity.uid)) {
        return forbidden('Forbidden: Submission is locked and cannot be modified')
      }
      return json({ message: 'Answers saved successfully' })
    }),

    /* ----------------------------------------------------------- POST /api/submissions */
    // One submission per test+student; a repeat is answered idempotently.
    mswHttp.post('/api/submissions', async ({ request }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      const body = (await request.json()) as { testId?: string; answers?: { code?: string; language?: ExamLanguage } }
      const found = findTest(String(body.testId ?? ''))
      if (!found) return notFound('Test not found')
      const { test, classroom } = found
      if (!isEnrolled(classroom.id, identity.email)) {
        return forbidden("Forbidden: You are not a member of this test's classroom")
      }

      store.submitAttempts += 1
      // Same order as the backend's middleware: membership, then the window
      // (server time -- a client clock cannot buy extra time), then the lock.
      if (nowMs < Date.parse(test.windowStart)) return forbidden('Forbidden: Test has not started yet')
      if (nowMs > Date.parse(test.windowEnd)) return forbidden('Forbidden: Test has already ended')
      if (submissionStatusFor(test.id, identity.uid)) {
        return forbidden('Forbidden: Submission is locked and cannot be modified')
      }

      const submission: Submission = {
        id: `${test.id}_${identity.uid}`,
        testId: test.id,
        uid: identity.uid,
        language: (body.answers?.language ?? test.language) as ExamLanguage,
        code: String(body.answers?.code ?? ''),
        status: 'GRADED',
        idempotencyKey: '',
        submittedAt: new Date(nowMs).toISOString(),
        score: 0,
        maxScore: test.totalPoints,
      }
      store.submissions.push(submission)
      return json({ message: 'Exam submitted successfully' })
    }),

    /* ---------------------------------------------- POST /api/monitor/:testId/flags */
    mswHttp.post('/api/monitor/:testId/flags', async ({ request, params }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      if (options.monitorEndpoint === false) return notFound('Unknown route.')
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      const testId = String(params.testId)
      if (!findTest(testId)) return notFound('Test not found')
      const body = (await request.json()) as { flagType?: string; metadata?: Record<string, unknown> }
      const allowed = ['TAB_SWITCH', 'DEVTOOLS_OPEN', 'PASTE_ATTEMPT', 'FULLSCREEN_EXIT']
      if (!body.flagType || !allowed.includes(body.flagType)) {
        return json({ message: 'That request is not valid.', code: 'VALIDATION_ERROR' }, 400)
      }
      store.monitorEvents.push({ testId, uid: identity.uid, flagType: body.flagType, ...(body.metadata ?? {}) })
      return json({ message: 'Flag recorded' }, 201)
    }),

    /* ---------------------------------------------- GET /api/monitor/:testId/flags */
    mswHttp.get('/api/monitor/:testId/flags', async ({ request, params }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      if (!TEACHER_ROLES.includes(identity.role)) return forbidden('Forbidden: Insufficient permissions')
      const found = findTest(String(params.testId))
      if (!found) return notFound('Test not found')
      const byStudent = new Map<string, { flagType: string; at: string | null; metadata: Record<string, unknown> }[]>()
      for (const raw of store.monitorEvents) {
        const event = raw as Record<string, unknown>
        if (event.testId !== found.test.id) continue
        const { testId: _t, uid, flagType, at, ...metadata } = event
        const list = byStudent.get(String(uid)) ?? []
        list.push({ flagType: String(flagType), at: typeof at === 'string' ? at : null, metadata })
        byStudent.set(String(uid), list)
      }
      const students = [...byStudent.entries()].map(([studentId, flags]) => {
        const member = reviewRosterFor(found.test).find((m) => m.uid === studentId)
        const counts: Record<string, number> = {}
        for (const flag of flags) counts[flag.flagType] = (counts[flag.flagType] ?? 0) + 1
        return {
          studentId,
          studentName: member?.displayName || member?.email || studentId,
          studentEmail: member?.email ?? '',
          total: flags.length,
          counts,
          flags,
        }
      })
      students.sort((a, b) => b.total - a.total)
      return json({ data: { testId: found.test.id, students } })
    }),

    /* --------------------------------------------- GET /api/tests/:testId/result */
    mswHttp.get('/api/tests/:testId/result', async ({ request, params }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      if (TEACHER_ROLES.includes(identity.role)) {
        return forbidden('Results are viewed through the review screens')
      }
      const found = findTest(String(params.testId))
      if (!found) return notFound('Test not found')
      // Only the owning student, and only if they submitted: 404 otherwise, so a
      // peer's submission is not confirmed to exist.
      if (!submissionStatusFor(found.test.id, identity.uid)) {
        return notFound('We could not find a result for this test')
      }
      const result = buildStudentResult(found.test, identity.uid)
      return json({
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
    }),

    /* ------------------------------------------ GET /api/submissions/test/:testId */
    mswHttp.get('/api/submissions/test/:testId', async ({ request, params }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      if (!TEACHER_ROLES.includes(identity.role)) return forbidden('Forbidden: Insufficient permissions')
      const found = findTest(String(params.testId))
      if (!found) return notFound('Test not found')
      return json({ data: backendReviewList(found.test) })
    }),

    /* ------------------------------- GET /api/submissions/test/:testId/:studentId */
    mswHttp.get('/api/submissions/test/:testId/:studentId', async ({ request, params }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      if (!TEACHER_ROLES.includes(identity.role)) return forbidden('Forbidden: Insufficient permissions')
      const target = resolveReviewTarget(String(params.testId), String(params.studentId))
      if ('error' in target) return target.error
      return json({ data: backendReviewDetail(target.test, target.member) })
    }),

    /* ------------------------ PUT /api/submissions/test/:testId/:studentId/review */
    mswHttp.put('/api/submissions/test/:testId/:studentId/review', async ({ request, params }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      if (!TEACHER_ROLES.includes(identity.role)) return forbidden('Forbidden: Insufficient permissions')
      const target = resolveReviewTarget(String(params.testId), String(params.studentId))
      if ('error' in target) return target.error
      const { test, member } = target
      // A release freezes grading, so a late save cannot contradict the students.
      if (store.releasedAt.has(test.id)) return conflict('Results are released, so grades are locked')
      const record = store.reviews.get(`${test.id}:${member.uid}`)
      if (!record) return conflict('This student has not submitted this test')

      const body = (await request.json()) as { marks?: unknown; comment?: unknown }
      let marks: number | null = null
      if (body.marks !== null && body.marks !== undefined) {
        const parsed = Number(body.marks)
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > test.totalPoints) {
          return json(
            { message: `Enter a whole number of marks between 0 and ${test.totalPoints}`, code: 'VALIDATION_ERROR' },
            400,
          )
        }
        marks = parsed
      }
      record.marks = marks
      record.comment = String(body.comment ?? '')
      return json({ message: 'Review saved', data: backendReviewDetail(test, member) })
    }),

    /* -------------------------------------------- POST /api/tests/:testId/release */
    mswHttp.post('/api/tests/:testId/release', async ({ request, params }) => {
      const failure = await authenticate(request)
      if (failure) return failure
      const identity = identityFrom(request.headers.get('Authorization'), roles, fixtures)
      if (!identity) return unauthorized()
      if (!TEACHER_ROLES.includes(identity.role)) return forbidden('Forbidden: Insufficient permissions')
      const found = findTest(String(params.testId))
      if (!found) return notFound('Test not found')
      // Idempotent: the first release time is kept.
      if (!store.releasedAt.has(found.test.id)) store.releasedAt.set(found.test.id, new Date(nowMs).toISOString())
      return json({
        message: 'Results released',
        data: { testId: found.test.id, resultsReleasedAt: store.releasedAt.get(found.test.id) },
      })
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
