import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { filterSubmissionsByStudent, reviewApi, type SubmissionSummary } from './reviewApi'
import { createMockBackend } from '@/tests/msw/classroomHandlers'
import { server } from '@/tests/msw/server'
import { configureHttpClient } from '@/shared/lib/httpClient'
import { STUDENT_UID, TEACHER_UID } from '@/tests/msw/fixtures'

/**
 * Contract tests for the review surface.
 *
 * Two rules matter more than the rest: the roster is the source of truth (a
 * student who never submitted still appears, as NOT_SUBMITTED, and the student id
 * is derived server-side, never taken from the client), and a hidden test case's
 * content never travels to the teacher — only its PASS/FAIL state.
 */

const REVIEW_TEST = 'test-review-1'
const RIYA = 'u-student-1'
const KABIR = 'u-student-2'
const AARAV = 'u-student-3'
const MEERA = 'u-student-4'
const DEV = 'u-student-5'

function asUser(uid: string) {
  configureHttpClient({ getToken: () => `fake-id-token.${uid}.1` })
}

describe('reviewApi against the mock contract', () => {
  let backend: ReturnType<typeof createMockBackend>

  beforeEach(() => {
    backend = createMockBackend()
    server.use(...backend.handlers)
  })

  afterEach(() => {
    configureHttpClient({ getToken: () => null })
  })

  describe('listSubmissions', () => {
    it('returns the review test with one roster-backed row per enrolled student', async () => {
      asUser(TEACHER_UID)
      const list = await reviewApi.listSubmissions(REVIEW_TEST)

      expect(list.testId).toBe(REVIEW_TEST)
      expect(list.testTitle).toBe('Lab 4: Binary search')
      expect(list.maxMarks).toBe(10)
      expect(list.resultsReleased).toBe(false)
      expect(list.releasedAt).toBeNull()

      expect(list.submissions).toHaveLength(5)
      expect(list.submissions.map((s) => s.studentName)).toEqual([
        'Riya Sharma',
        'Kabir Mehta',
        'Aarav Iyer',
        'Meera Nair',
        'Dev Patel',
      ])
    })

    it('marks a student who never submitted as NOT_SUBMITTED with no cases', async () => {
      asUser(TEACHER_UID)
      const list = await reviewApi.listSubmissions(REVIEW_TEST)
      const dev = list.submissions.find((s) => s.studentUid === DEV)
      expect(dev).toMatchObject({
        id: DEV,
        state: 'NOT_SUBMITTED',
        passedCases: 0,
        totalCases: 5,
        submittedAt: null,
        marks: null,
      })
    })

    it('reports the late student distinctly and the seeded grades', async () => {
      asUser(TEACHER_UID)
      const list = await reviewApi.listSubmissions(REVIEW_TEST)
      expect(list.submissions.find((s) => s.studentUid === AARAV)?.state).toBe('LATE')
      expect(list.submissions.find((s) => s.studentUid === KABIR)).toMatchObject({
        id: KABIR,
        state: 'SUBMITTED',
        marks: 8,
      })
    })

    it('refuses a student, even one enrolled in the classroom', async () => {
      asUser(STUDENT_UID)
      await expect(reviewApi.listSubmissions(REVIEW_TEST)).rejects.toMatchObject({ status: 403 })
    })

    it('404s an unknown test so its existence is not leaked', async () => {
      asUser(TEACHER_UID)
      await expect(reviewApi.listSubmissions('test-nope')).rejects.toMatchObject({ status: 404 })
    })
  })

  describe('getSubmission', () => {
    it('returns a submitted student code and every case result', async () => {
      asUser(TEACHER_UID)
      const detail = await reviewApi.getSubmission(REVIEW_TEST, RIYA)

      expect(detail.id).toBe(RIYA)
      expect(detail.studentName).toBe('Riya Sharma')
      expect(detail.state).toBe('SUBMITTED')
      expect(detail.code).toContain('indexOf')
      expect(detail.cases).toHaveLength(5)
      expect(detail.passedCases).toBe(4)
      expect(detail.resultsReleased).toBe(false)
    })

    it('shows visible case content but withholds hidden content from the teacher', async () => {
      asUser(TEACHER_UID)
      // Meera fails a hidden case, so the withheld row is observable.
      const detail = await reviewApi.getSubmission(REVIEW_TEST, MEERA)

      const visible = detail.cases.find((c) => c.id === 'tc-review-1')
      expect(visible).toMatchObject({
        hidden: false,
        input: '[1,2,3]\n2',
        expected: '1',
        actual: '1',
      })

      const hidden = detail.cases.find((c) => c.id === 'tc-review-4')
      expect(hidden?.state).toBe('FAIL')
      expect(hidden?.hidden).toBe(true)
      // The content never leaves the server for a case students must not see.
      expect(hidden).toMatchObject({ input: null, expected: null, actual: null })
    })

    it('returns an empty shell for a student who never submitted', async () => {
      asUser(TEACHER_UID)
      const detail = await reviewApi.getSubmission(REVIEW_TEST, DEV)

      expect(detail).toMatchObject({
        studentName: 'Dev Patel',
        state: 'NOT_SUBMITTED',
        code: '',
        submittedAt: null,
        cases: [],
        passedCases: 0,
        marks: null,
        comment: '',
      })
    })

    it('404s an unknown submission id', async () => {
      asUser(TEACHER_UID)
      await expect(
        reviewApi.getSubmission(REVIEW_TEST, `sub-${REVIEW_TEST}-not-a-student`),
      ).rejects.toMatchObject({ status: 404 })
    })

    it('refuses a student reading a peer submission', async () => {
      asUser(STUDENT_UID)
      await expect(reviewApi.getSubmission(REVIEW_TEST, RIYA)).rejects.toMatchObject({
        status: 403,
      })
    })
  })

  describe('saveReview', () => {
    it('saves marks and a comment, and the list reflects them', async () => {
      asUser(TEACHER_UID)
      const saved = await reviewApi.saveReview(REVIEW_TEST, RIYA, {
        marks: 4,
        comment: 'Short-circuit stops early.',
      })

      expect(saved.marks).toBe(4)
      expect(saved.comment).toBe('Short-circuit stops early.')

      const list = await reviewApi.listSubmissions(REVIEW_TEST)
      expect(list.submissions.find((s) => s.studentUid === RIYA)?.marks).toBe(4)
    })

    it('refuses to grade a student who did not submit', async () => {
      asUser(TEACHER_UID)
      await expect(
        reviewApi.saveReview(REVIEW_TEST, DEV, { marks: 0, comment: '' }),
      ).rejects.toMatchObject({ status: 409 })
    })

    it('rejects marks outside the range', async () => {
      asUser(TEACHER_UID)
      await expect(
        reviewApi.saveReview(REVIEW_TEST, RIYA, { marks: 11, comment: '' }),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('clears a saved mark with null', async () => {
      asUser(TEACHER_UID)
      await reviewApi.saveReview(REVIEW_TEST, KABIR, { marks: null, comment: '' })
      const list = await reviewApi.listSubmissions(REVIEW_TEST)
      expect(list.submissions.find((s) => s.studentUid === KABIR)?.marks).toBeNull()
    })
  })

  describe('releaseResults and the freeze', () => {
    it('releases the results, stamping the first release time', async () => {
      asUser(TEACHER_UID)
      const released = await reviewApi.releaseResults(REVIEW_TEST)
      expect(released.resultsReleased).toBe(true)
      expect(released.releasedAt).toBeTruthy()

      // Idempotent: a repeat keeps the original timestamp so a double-click
      // cannot rewrite what the students first saw.
      const again = await reviewApi.releaseResults(REVIEW_TEST)
      expect(again.releasedAt).toBe(released.releasedAt)
    })

    it('rejects a save after release as a 409 conflict', async () => {
      asUser(TEACHER_UID)
      await reviewApi.releaseResults(REVIEW_TEST)
      await expect(
        reviewApi.saveReview(REVIEW_TEST, RIYA, { marks: 9, comment: 'too late' }),
      ).rejects.toMatchObject({ status: 409 })
    })

    it('reports released state on the detail page', async () => {
      asUser(TEACHER_UID)
      await reviewApi.releaseResults(REVIEW_TEST)
      const detail = await reviewApi.getSubmission(REVIEW_TEST, RIYA)
      expect(detail.resultsReleased).toBe(true)
      expect(detail.releasedAt).toBeTruthy()
    })
  })

  describe('filterSubmissionsByStudent', () => {
    function row(name: string, email: string): SubmissionSummary {
      return {
        id: 'sub-test-1-u-1',
        studentUid: 'u-1',
        studentName: name,
        studentEmail: email,
        state: 'SUBMITTED',
        passedCases: 3,
        totalCases: 5,
        submittedAt: '2026-01-01T00:00:00.000Z',
        marks: null,
        maxMarks: 10,
      }
    }

    const rows = [row('Riya Sharma', 'riya@mit.ac.in'), row('Aarav Iyer', 'aarav@mit.ac.in')]

    it('matches across names and emails, case-insensitively', () => {
      expect(filterSubmissionsByStudent(rows, 'RIYA')).toHaveLength(1)
      expect(filterSubmissionsByStudent(rows, 'aarav@MIT.ac.in')).toHaveLength(1)
    })

    it('returns everything for a blank query and nothing for a miss', () => {
      expect(filterSubmissionsByStudent(rows, '   ')).toHaveLength(2)
      expect(filterSubmissionsByStudent(rows, 'dev')).toHaveLength(0)
    })
  })
})