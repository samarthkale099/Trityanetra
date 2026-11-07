import type {
  Classroom,
  ClassroomStudent,
  ExamLanguage,
  Question,
  Submission,
  TestDetail,
  TestSummary,
} from '@/shared/types/classroom'

/**
 * Seed data for the in-memory mock backend.
 *
 * Window times are expressed as offsets from "now" rather than fixed dates, so a
 * fixture never silently drifts into the past and turns every lobby test into a
 * "window already closed" test. `resolveFixtures` pins them to concrete
 * ISO strings at call time.
 */

export const COLLEGE_ID = 'college-mit'
export const TEACHER_UID = 'u-teacher-1'
export const STUDENT_UID = 'u-student-1'
export const OTHER_COLLEGE_ID = 'college-other'

export interface FixtureOptions {
  /** Where "now" is. Defaults to the real clock. */
  nowMs?: number
}

const HOUR = 3_600_000
const MINUTE = 60_000

function iso(offsetMs: number, from: number): string {
  return new Date(from + offsetMs).toISOString()
}

/** A submitted student's graded result, seeded into the mock's review store. */
export interface ReviewSeed {
  uid: string
  state: 'SUBMITTED' | 'LATE'
  code: string
  submittedAt: string
  /** One entry per test case, in the test's own case order. */
  caseStates: ('PASS' | 'FAIL')[]
  marks: number | null
  comment: string
}

export interface ResolvedFixtures {
  collegeId: string
  teacher: { uid: string; email: string; displayName: string }
  student: { uid: string; email: string; displayName: string }
  otherStudent: { uid: string; email: string; displayName: string }
  classrooms: Classroom[]
  /** Classroom in a different college, used to prove scoping. */
  foreignClassroom: Classroom
  roster: Record<string, ClassroomStudent[]>
  tests: TestDetail[]
  summaries: TestSummary[]
  questions: Record<string, Question[]>
  /** The test the review fixtures are seeded against, for a stable test id. */
  reviewTestId: string
  /** Graded submissions for `reviewTestId`; a student absent here did not submit. */
  reviewSeeds: ReviewSeed[]
  /**
   * A second seeded grading, on an already-ended test whose results have been
   * released. The student surface uses it to render a released marks panel, and
   * its one hidden case fails, so a result screen can be checked for withholding
   * hidden content that is genuinely failing.
   */
  resultTestId: string
  resultSeed: ReviewSeed
  resultReleasedAt: string
}

function question(
  id: string,
  prompt: string,
  order: number,
  language: ExamLanguage = 'javascript',
): Question {
  return {
    id,
    prompt,
    starterCode: '// write your solution here\n',
    language,
    testCases: [
      { id: `${id}-tc1`, input: '2\n3', expected: '5', hidden: false },
      { id: `${id}-tc2`, input: '10\n-4', expected: '6', hidden: true },
    ],
    points: 10,
    order,
  }
}

export function resolveFixtures({ nowMs = Date.now() }: FixtureOptions = {}): ResolvedFixtures {
  const teacher = {
    uid: TEACHER_UID,
    email: 'aditya.teacher@mit.ac.in',
    displayName: 'Aditya Rao',
  }
  const student = { uid: STUDENT_UID, email: 'riya@mit.ac.in', displayName: 'Riya Sharma' }
  const otherStudent = {
    uid: 'u-student-2',
    email: 'kabir@mit.ac.in',
    displayName: 'Kabir Mehta',
  }
  // Extra enrolled students, so the review fixtures have a class rather than a
  // single name: one more who submitted, one who submitted late, one who did not.
  const lateStudent = { uid: 'u-student-3', email: 'aarav@mit.ac.in', displayName: 'Aarav Iyer' }
  const hiddenFailStudent = { uid: 'u-student-4', email: 'meera@mit.ac.in', displayName: 'Meera Nair' }
  const missingStudent = { uid: 'u-student-5', email: 'dev@mit.ac.in', displayName: 'Dev Patel' }

  const algorithms: TestDetail = {
    id: 'test-live-1',
    classroomId: 'room-algorithms',
    classroomName: 'Data Structures',
    title: 'Mid-term: Sorting',
    instructions: 'Implement quicksort. Do not use the built-in sort.',
    language: 'javascript',
    windowStart: iso(-30 * MINUTE, nowMs),
    windowEnd: iso(90 * MINUTE, nowMs),
    durationMinutes: 60,
    questions: [question('q-sort-1', 'Implement quicksort on an array of integers.', 0)],
    totalPoints: 10,
  }

  const upcoming: TestDetail = {
    id: 'test-upcoming-1',
    classroomId: 'room-algorithms',
    classroomName: 'Data Structures',
    title: 'Unit 3: Linked Lists',
    instructions: 'Answer all questions.',
    language: 'python',
    windowStart: iso(2 * HOUR, nowMs),
    windowEnd: iso(3 * HOUR, nowMs),
    durationMinutes: 45,
    questions: [question('q-ll-1', 'Reverse a singly linked list.', 0, 'python')],
    totalPoints: 10,
  }

  const ended: TestDetail = {
    id: 'test-ended-1',
    classroomId: 'room-algorithms',
    classroomName: 'Data Structures',
    title: 'Quiz 1: Complexity',
    instructions: 'Quick quiz.',
    language: 'javascript',
    windowStart: iso(-3 * HOUR, nowMs),
    windowEnd: iso(-2 * HOUR, nowMs),
    durationMinutes: 30,
    questions: [question('q-cx-1', 'State the time complexity of quicksort.', 0)],
    totalPoints: 10,
  }

  const reviewQuestion: Question = {
    id: 'q-review-1',
    prompt: 'Return the index of the target in the sorted array, or -1 when it is absent.',
    starterCode: 'function search(xs, target) {\n  // your code here\n}\n',
    language: 'javascript',
    testCases: [
      { id: 'tc-review-1', input: '[1,2,3]\n2', expected: '1', hidden: false },
      { id: 'tc-review-2', input: '[1,2,3]\n5', expected: '-1', hidden: false },
      { id: 'tc-review-3', input: '[]\n0', expected: '-1', hidden: false },
      // These two never travel to the client: only their PASS/FAIL state does.
      { id: 'tc-review-4', input: '[2,4,6,8]\n8', expected: '3', hidden: true },
      { id: 'tc-review-5', input: '[1]\n1', expected: '0', hidden: true },
    ],
    points: 10,
    order: 0,
  }

  const review: TestDetail = {
    id: 'test-review-1',
    classroomId: 'room-algorithms',
    classroomName: 'Data Structures',
    title: 'Lab 4: Binary search',
    instructions: 'Return the index, or -1 when the target is absent.',
    language: 'javascript',
    windowStart: iso(-3 * HOUR, nowMs),
    windowEnd: iso(-2 * HOUR, nowMs),
    durationMinutes: 45,
    questions: [reviewQuestion],
    totalPoints: 10,
  }

  /*
   * Graded submissions for `review`. `missingStudent` is deliberately absent: a
   * student with no entry is one who never submitted, which the list derives from
   * the roster rather than from a stored record.
   */
  const reviewSeeds: ReviewSeed[] = [
    {
      uid: student.uid,
      state: 'SUBMITTED',
      code: 'function search(xs, target) {\n  return xs.indexOf(target)\n}\n',
      submittedAt: iso(-115 * MINUTE, nowMs),
      // The short-circuit version lies about "absent" and fails case 2.
      caseStates: ['PASS', 'FAIL', 'PASS', 'PASS', 'PASS'],
      marks: null,
      comment: '',
    },
    {
      uid: otherStudent.uid,
      state: 'SUBMITTED',
      code: 'function search(xs, target) {\n  let lo = 0\n  let hi = xs.length - 1\n  while (lo <= hi) {\n    const mid = (lo + hi) >> 1\n    if (xs[mid] === target) return mid\n    if (xs[mid] < target) lo = mid + 1\n    else hi = mid - 1\n  }\n  return -1\n}\n',
      submittedAt: iso(-110 * MINUTE, nowMs),
      caseStates: ['PASS', 'PASS', 'PASS', 'PASS', 'PASS'],
      marks: 8,
      comment: 'Clean binary search. Watch the empty-array early return.',
    },
    {
      uid: lateStudent.uid,
      state: 'LATE',
      code: 'function search(xs, target) {\n  for (let i = 0; i < xs.length; i++) {\n    if (xs[i] === target) return i\n  }\n  return 0\n}\n',
      submittedAt: iso(-95 * MINUTE, nowMs),
      // Returns 0 instead of -1 for an absent target, so two cases fail.
      caseStates: ['PASS', 'FAIL', 'FAIL', 'PASS', 'PASS'],
      marks: null,
      comment: '',
    },
    {
      uid: hiddenFailStudent.uid,
      state: 'SUBMITTED',
      code: 'function search(xs, target) {\n  return xs.indexOf(target)\n}\n',
      submittedAt: iso(-130 * MINUTE, nowMs),
      // Fails a visible case and, separately, a hidden one.
      caseStates: ['PASS', 'FAIL', 'PASS', 'FAIL', 'PASS'],
      marks: null,
      comment: '',
    },
  ]

  /*
   * A released result. `ended` is the host test so no new test is introduced and
   * the student's test list stays exactly what other specs already assert. The
   * student passes the visible case and fails the hidden one, which is the pair
   * the result screen must distinguish: content for the first, state only for the
   * second.
   */
  const resultSeed: ReviewSeed = {
    uid: student.uid,
    state: 'SUBMITTED',
    code: 'function complexity(n) {\n  return n * n\n}\n',
    submittedAt: iso(-160 * MINUTE, nowMs),
    caseStates: ['PASS', 'FAIL'],
    marks: 7,
    comment: 'Good start. Watch the hidden edge case before the next one.',
  }
  const resultReleasedAt = iso(-90 * MINUTE, nowMs)

  const questions: Record<string, Question[]> = {}
  const summaries: TestSummary[] = []
  for (const test of [algorithms, upcoming, ended, review]) {
    questions[test.id] = test.questions
    summaries.push({
      id: test.id,
      classroomId: test.classroomId,
      title: test.title,
      language: test.language,
      windowStart: test.windowStart,
      windowEnd: test.windowEnd,
      durationMinutes: test.durationMinutes,
      questionCount: test.questions.length,
      totalPoints: test.totalPoints,
      submittedCount:
        test.id === review.id
          ? reviewSeeds.length
          : test.id === ended.id
            ? 2
            : test.id === algorithms.id
              ? 1
              : 0,
      // The per-student flag is filled by the handler from the caller's token;
      // the static value is a placeholder and is never served as-is.
      mySubmissionId: null,
      createdAt: iso(-7 * HOUR, nowMs),
    })
  }

  return {
    collegeId: COLLEGE_ID,
    teacher,
    student,
    otherStudent,
    classrooms: [
      {
        id: 'room-algorithms',
        collegeId: COLLEGE_ID,
        name: 'Data Structures 2026',
        subject: 'CS201',
        description: 'Arrays, trees, graphs and the analysis that goes with them.',
        teacherId: teacher.uid,
        teacherName: teacher.displayName,
        joinCode: 'MITDS26',
        studentCount: 5,
        testCount: 4,
        createdAt: iso(-30 * 24 * HOUR, nowMs),
      },
      {
        id: 'room-networks',
        collegeId: COLLEGE_ID,
        name: 'Computer Networks',
        subject: 'CS305',
        description: 'Layered protocols from Ethernet to HTTP.',
        teacherId: teacher.uid,
        teacherName: teacher.displayName,
        joinCode: 'MITCN26',
        studentCount: 0,
        testCount: 0,
        createdAt: iso(-10 * 24 * HOUR, nowMs),
      },
    ],
    foreignClassroom: {
      id: 'room-foreign',
      collegeId: OTHER_COLLEGE_ID,
      name: 'Foreign College Networks',
      subject: 'XX100',
      description: 'Belongs to another college.',
      teacherId: 'u-teacher-other',
      teacherName: 'Other Teacher',
      joinCode: 'OTHER1',
      studentCount: 1,
      testCount: 0,
      createdAt: iso(-5 * 24 * HOUR, nowMs),
    },
    roster: {
      'room-algorithms': [
        { uid: student.uid, email: student.email, displayName: student.displayName, joinedAt: iso(-20 * 24 * HOUR, nowMs), pending: false },
        { uid: otherStudent.uid, email: otherStudent.email, displayName: otherStudent.displayName, joinedAt: iso(-19 * 24 * HOUR, nowMs), pending: false },
        { uid: lateStudent.uid, email: lateStudent.email, displayName: lateStudent.displayName, joinedAt: iso(-18 * 24 * HOUR, nowMs), pending: false },
        { uid: hiddenFailStudent.uid, email: hiddenFailStudent.email, displayName: hiddenFailStudent.displayName, joinedAt: iso(-17 * 24 * HOUR, nowMs), pending: false },
        { uid: missingStudent.uid, email: missingStudent.email, displayName: missingStudent.displayName, joinedAt: iso(-16 * 24 * HOUR, nowMs), pending: false },
      ],
      'room-networks': [],
    },
    tests: [algorithms, upcoming, ended, review],
    summaries,
    questions,
    reviewTestId: review.id,
    reviewSeeds,
    resultTestId: ended.id,
    resultSeed,
    resultReleasedAt,
  }
}

export function emptySubmission(testId: string, uid: string, nowMs: number): Submission {
  return {
    id: `sub-${testId}-${uid}`,
    testId,
    uid,
    language: 'javascript',
    code: '',
    status: 'GRADED',
    idempotencyKey: 'seed',
    submittedAt: iso(-2 * HOUR, nowMs),
    score: 8,
    maxScore: 10,
  }
}
