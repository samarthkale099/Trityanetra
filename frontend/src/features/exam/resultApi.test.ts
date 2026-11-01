import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resultApi } from './resultApi'
import { reviewApi } from '@/features/classrooms/reviewApi'
import { createMockBackend, type MockBackend } from '@/tests/msw/classroomHandlers'
import { server } from '@/tests/msw/server'
import { configureHttpClient } from '@/shared/lib/httpClient'
import { STUDENT_UID, TEACHER_UID } from '@/tests/msw/fixtures'

/**
 * Contract tests for the student result surface.
 *
 * The rules that matter most are withholding and scoping: a hidden case's
 * content never travels to the client, marks and the comment stay withheld until
 * the teacher releases, and only the owning student can read the result — anyone
 * else gets a 404 rather than a confirmation that a submission exists.
 */

const RELEASED_TEST = 'test-ended-1' // seeded as ended and released
const UNRELEASED_TEST = 'test-review-1' // submitted, marks not released
const DEV = 'u-student-5' // enrolled, never submitted

function asUser(uid: string) {
  configureHttpClient({ getToken: () => `fake-id-token.${uid}.1` })
}

describe('resultApi against the mock contract', () => {
  let backend: MockBackend

  beforeEach(() => {
    backend = createMockBackend()
    server.use(...backend.handlers)
  })

  afterEach(() => {
    configureHttpClient({ getToken: () => null })
  })

  it('returns the student their own result, with visible content and hidden state only', async () => {
    asUser(STUDENT_UID)
    const result = await resultApi.getResult(RELEASED_TEST)

    expect(result.testId).toBe(RELEASED_TEST)
    expect(result.testTitle).toBe('Quiz 1: Complexity')
    expect(result.totalCases).toBe(2)
    expect(result.passedCases).toBe(1)
    expect(result.state).toBe('SUBMITTED')

    const visible = result.cases.find((testCase) => !testCase.hidden)
    expect(visible).toMatchObject({ state: 'PASS', input: '2\n3', expected: '5' })

    const hidden = result.cases.find((testCase) => testCase.hidden)
    expect(hidden?.state).toBe('FAIL')
    // A hidden case reports only its result; nothing about its content travels.
    expect(hidden).toMatchObject({ input: null, expected: null, actual: null })
  })

  it('withholds marks and the comment until the teacher releases them', async () => {
    asUser(STUDENT_UID)
    const result = await resultApi.getResult(UNRELEASED_TEST)

    expect(result.marksReleased).toBe(false)
    expect(result.releasedAt).toBeNull()
    // Withheld for real: not a zero, not an empty string, but absent.
    expect(result.marks).toBeNull()
    expect(result.comment).toBe('')
  })

  it('never sends a hidden case`s content, even when it is failing', async () => {
    asUser(STUDENT_UID)
    const result = await resultApi.getResult(RELEASED_TEST)
    const serialized = JSON.stringify(result)

    // This student genuinely fails the hidden case on the ended test...
    expect(result.cases.some((testCase) => testCase.hidden && testCase.state === 'FAIL')).toBe(true)
    // ...yet none of the hidden case's real input/expected appears in the payload.
    expect(serialized).not.toContain('"input":"10')
    expect(serialized).not.toContain('"expected":"6"')
  })

  it('serves marks and the comment once the teacher has released them', async () => {
    asUser(TEACHER_UID)
    await reviewApi.saveReview(UNRELEASED_TEST, `sub-${UNRELEASED_TEST}-${STUDENT_UID}`, {
      marks: 6,
      comment: 'Solid work.',
    })
    await reviewApi.releaseResults(UNRELEASED_TEST)

    asUser(STUDENT_UID)
    const result = await resultApi.getResult(UNRELEASED_TEST)
    expect(result.marksReleased).toBe(true)
    expect(result.releasedAt).toBeTruthy()
    expect(result.marks).toBe(6)
    expect(result.comment).toBe('Solid work.')
  })

  it('404s a student who never submitted, rather than confirming a peer did', async () => {
    asUser(DEV)
    await expect(resultApi.getResult(UNRELEASED_TEST)).rejects.toMatchObject({ status: 404 })
  })

  it('404s an unknown test', async () => {
    asUser(STUDENT_UID)
    await expect(resultApi.getResult('test-nope')).rejects.toMatchObject({ status: 404 })
  })

  it('refuses a teacher, who reads results through the review screens', async () => {
    asUser(TEACHER_UID)
    await expect(resultApi.getResult(UNRELEASED_TEST)).rejects.toMatchObject({ status: 403 })
  })

  it('rejects an unauthenticated call', async () => {
    configureHttpClient({ getToken: () => null })
    await expect(resultApi.getResult(RELEASED_TEST)).rejects.toMatchObject({ status: 401 })
  })
})
