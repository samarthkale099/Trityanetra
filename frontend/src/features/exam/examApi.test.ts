import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { answersPayload, examApi } from './examApi'
import {
  clearMonitorQueue,
  enqueueMonitorEvent,
  flushMonitorQueue,
  queuedMonitorEventCount,
} from './monitorApi'
import { createMockBackend, type MockBackend } from '@/tests/msw/classroomHandlers'
import { server } from '@/tests/msw/server'
import { configureHttpClient } from '@/shared/lib/httpClient'
import { STUDENT_UID, TEACHER_UID } from '@/tests/msw/fixtures'

/**
 * Contract tests for the attempt lifecycle.
 *
 * These run against the in-memory backend in `classroomHandlers`, which enforces
 * the rules the real server must: identity from the token, college scoping, the
 * test window checked server-side, a latched attempt start, and server-side
 * idempotency. Asserting on them is asserting on the contract, not on the mock.
 */

/** The fake auth driver mints `fake-id-token.<uid>.<counter>`. */
function asUser(uid: string) {
  configureHttpClient({ getToken: () => `fake-id-token.${uid}.1` })
}

describe('examApi against the mock contract', () => {
  let backend: MockBackend

  beforeEach(() => {
    backend = createMockBackend()
    server.use(...backend.handlers)
  })

  afterEach(() => {
    configureHttpClient({ getToken: () => null })
  })

  describe('lobby', () => {
    it('is readable without starting the attempt', async () => {
      asUser(STUDENT_UID)
      const lobby = await examApi.getLobby('test-live-1')

      expect(lobby.startedAt).toBeNull()
      // Reading the lobby must not consume the student's allowance.
      expect(backend.store.startedAt.size).toBe(0)
      expect(lobby.submission).toBeNull()
    })

    it('returns the server clock so a wrong device clock cannot gate entry', async () => {
      asUser(STUDENT_UID)
      const lobby = await examApi.getLobby('test-live-1')
      expect(Number.isFinite(Date.parse(lobby.serverTime))).toBe(true)
    })

    it('never sends hidden test cases to a student', async () => {
      asUser(STUDENT_UID)
      const lobby = await examApi.getLobby('test-live-1')
      for (const question of lobby.test.questions) {
        expect(question.testCases.some((testCase) => testCase.hidden)).toBe(false)
      }
    })

    it('hides hidden cases from the direct test read too', async () => {
      asUser(STUDENT_UID)
      const detail = await examApi.getTest('test-live-1')
      for (const question of detail.questions) {
        expect(question.testCases.some((testCase) => testCase.hidden)).toBe(false)
      }
    })

    it('refuses a student who is not enrolled', async () => {
      asUser('u-student-999')
      await expect(examApi.getLobby('test-live-1')).rejects.toMatchObject({ status: 403 })
    })

    it('404s an unknown test rather than leaking that it exists', async () => {
      asUser(STUDENT_UID)
      await expect(examApi.getLobby('test-nope')).rejects.toMatchObject({ status: 404 })
    })
  })

  describe('starting an attempt', () => {
    it('latches startedAt on the server', async () => {
      asUser(STUDENT_UID)
      const lobby = await examApi.startAttempt('test-live-1')
      expect(lobby.startedAt).not.toBeNull()
      expect(backend.store.startedAt.get(`test-live-1:${STUDENT_UID}`)).toBe(lobby.startedAt)
    })

    it('is idempotent, so a reload cannot buy a second allowance', async () => {
      asUser(STUDENT_UID)
      const first = await examApi.startAttempt('test-live-1')
      const second = await examApi.startAttempt('test-live-1')
      expect(second.startedAt).toBe(first.startedAt)
      expect(backend.store.startedAt.size).toBe(1)
    })

    it('refuses a test that has not opened', async () => {
      asUser(STUDENT_UID)
      await expect(examApi.startAttempt('test-upcoming-1')).rejects.toMatchObject({ status: 403 })
      expect(backend.store.startedAt.size).toBe(0)
    })

    it('refuses a test that has closed', async () => {
      asUser(STUDENT_UID)
      await expect(examApi.startAttempt('test-ended-1')).rejects.toMatchObject({ status: 403 })
    })

    it('refuses a student who has already submitted', async () => {
      asUser(STUDENT_UID)
      await examApi.submit('test-live-1', { code: 'done', language: 'javascript', idempotencyKey: 'key-1' })
      await expect(examApi.startAttempt('test-live-1')).rejects.toMatchObject({ status: 409 })
    })
  })

  describe('submitting', () => {
    it('records a submission and reports it back on the next lobby read', async () => {
      asUser(STUDENT_UID)
      await examApi.startAttempt('test-live-1')
      const submission = await examApi.submit('test-live-1', {
        code: 'function quicksort() {}',
        language: 'javascript',
        idempotencyKey: 'key-abc',
      })

      // The server stores it under the student's own uid, with the exact code;
      // the next lobby read reports the test as submitted.
      expect(submission.testId).toBe('test-live-1')
      expect(submission.code).toBe('function quicksort() {}')
      const stored = backend.store.submissions.find((s) => s.testId === 'test-live-1')
      expect(stored).toMatchObject({ uid: STUDENT_UID, code: 'function quicksort() {}' })

      const lobby = await examApi.getLobby('test-live-1')
      expect(lobby.submission).not.toBeNull()
    })

    /*
     * The backend keeps exactly one submission per test+student and locks it:
     * a double-click or a retry after a dropped connection reaches the lock
     * (403 "locked"), which the client treats as "already submitted" -- one
     * stored submission, and no error shown to the student.
     */
    it('stores one submission however many times submit is sent', async () => {
      asUser(STUDENT_UID)
      await examApi.startAttempt('test-live-1')
      const first = await examApi.submit('test-live-1', { code: 'a', language: 'javascript', idempotencyKey: 'same' })
      const second = await examApi.submit('test-live-1', { code: 'a', language: 'javascript', idempotencyKey: 'same' })

      expect(second.id).toBe(first.id)
      expect(backend.store.submissions).toHaveLength(1)
      expect(backend.store.submitAttempts).toBe(2)
    })

    it('refuses to save a draft over a submitted exam', async () => {
      asUser(STUDENT_UID)
      await examApi.startAttempt('test-live-1')
      await examApi.submit('test-live-1', { code: 'final', language: 'javascript', idempotencyKey: 'k' })
      await expect(examApi.saveDraft('test-live-1', { code: 'edit', language: 'javascript' })).rejects.toMatchObject({
        status: 403,
      })
    })

    it('re-checks the window server-side, so a fast device clock buys nothing', async () => {
      asUser(STUDENT_UID)
      await expect(
        examApi.submit('test-ended-1', { code: 'late', language: 'javascript', idempotencyKey: 'late-key' }),
      ).rejects.toMatchObject({ status: 403 })
    })
  })

  describe('listing', () => {
    it('gives a student only the tests in their enrolled classrooms', async () => {
      asUser(STUDENT_UID)
      const tests = await examApi.listForStudent()
      expect(tests.map((test) => test.id).sort()).toEqual([
        'test-ended-1',
        'test-live-1',
        'test-review-1',
        'test-upcoming-1',
      ])
      // A summary is metadata only: it must not carry the questions.
      expect(tests[0]).not.toHaveProperty('questions')
    })

    it('counts submissions per test', async () => {
      asUser(STUDENT_UID)
      const before = (await examApi.listForStudent()).find((test) => test.id === 'test-live-1')
      await examApi.submit('test-live-1', { code: 'x', language: 'javascript', idempotencyKey: 'count-1' })
      const after = (await examApi.listForStudent()).find((test) => test.id === 'test-live-1')
      expect(after?.submittedCount).toBe((before?.submittedCount ?? 0) + 1)
    })

    it("flags the caller's own submitted tests with a submission id, and only those", async () => {
      asUser(STUDENT_UID)
      const tests = await examApi.listForStudent()
      const byId = (id: string) => tests.find((test) => test.id === id)

      // The seeded grading on the ended test belongs to this student.
      expect(byId('test-ended-1')?.mySubmissionId).toBeTruthy()
      // A test this student has not sat carries no id, so no result is offered.
      expect(byId('test-upcoming-1')?.mySubmissionId).toBeNull()
    })

    it('rejects an unauthenticated call', async () => {
      asUser(STUDENT_UID)
      configureHttpClient({ getToken: () => null })
      await expect(examApi.listForStudent()).rejects.toMatchObject({ status: 401 })
    })
  })

  describe('teachers', () => {
    it('can read a test in their own college', async () => {
      asUser(TEACHER_UID)
      const detail = await examApi.getTest('test-live-1')
      expect(detail.id).toBe('test-live-1')
    })
  })

  describe('monitoring', () => {
    beforeEach(() => {
      clearMonitorQueue()
    })

    it('delivers a queued batch of proctoring events', async () => {
      asUser(STUDENT_UID)
      enqueueMonitorEvent({ type: 'TAB_HIDDEN', at: '2026-03-01T11:00:00.000Z', meta: { seconds: 4 } })
      enqueueMonitorEvent({ type: 'FULLSCREEN_EXIT', at: '2026-03-01T11:01:00.000Z' })

      const delivered = await flushMonitorQueue({ testId: 'test-live-1', language: 'javascript' })

      expect(delivered).toBe(2)
      expect(backend.store.monitorEvents).toHaveLength(2)
      // The queue is emptied only once the server has taken the batch.
      expect(queuedMonitorEventCount()).toBe(0)
    })

    /*
     * Proctoring telemetry is a deterrent, not a gate. A backend without the
     * route must not cost a student their submission, and the events stay queued
     * rather than being silently dropped.
     */
    it('keeps the events queued when the backend has no monitoring route', async () => {
      const withoutMonitoring = createMockBackend({ monitorEndpoint: false })
      server.use(...withoutMonitoring.handlers)
      asUser(STUDENT_UID)

      enqueueMonitorEvent({ type: 'TAB_HIDDEN', at: '2026-03-01T11:00:00.000Z' })
      const delivered = await flushMonitorQueue({ testId: 'test-live-1', language: 'javascript' })

      expect(delivered).toBe(0)
      expect(queuedMonitorEventCount()).toBe(1)
    })

    it('sends nothing when there is nothing to send', async () => {
      asUser(STUDENT_UID)
      const delivered = await flushMonitorQueue({ testId: 'test-live-1', language: 'javascript' })
      expect(delivered).toBe(0)
    })
  })
})

describe('answersPayload', () => {
  it('sends a one-question exam as a single program, the shape plagiarism compares', () => {
    expect(answersPayload({ language: 'python', code: 'print(1)', answers: { q1: 'print(1)' } })).toEqual({
      language: 'python',
      code: 'print(1)',
    })
  })

  it('sends every question of a multi-question exam, not just the open one', () => {
    expect(
      answersPayload({ language: 'python', code: 'print(2)', answers: { q1: 'print(1)', q2: 'print(2)' } }),
    ).toEqual({
      language: 'python',
      questions: { q1: { code: 'print(1)' }, q2: { code: 'print(2)' } },
    })
  })

  it('falls back to the editor contents when no per-question map is given', () => {
    expect(answersPayload({ language: 'java', code: 'class A {}' })).toEqual({ language: 'java', code: 'class A {}' })
  })
})
