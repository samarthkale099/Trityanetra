import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { classroomApi, filterClassroomsByTerm } from './classroomApi'
import { createMockBackend, type MockBackend } from '@/tests/msw/classroomHandlers'
import { server } from '@/tests/msw/server'
import { configureHttpClient } from '@/shared/lib/httpClient'
import { COLLEGE_ID, OTHER_COLLEGE_ID, STUDENT_UID, TEACHER_UID } from '@/tests/msw/fixtures'

/**
 * Contract tests for the classroom surface.
 *
 * The two rules worth defending hardest are scoping and privilege: a teacher sees
 * only their own college's classrooms, a student cannot read a roster or a
 * classroom they are not in, and a role is taken from the token rather than from
 * anything the client sends.
 */

function asUser(uid: string) {
  configureHttpClient({ getToken: () => `fake-id-token.${uid}.1` })
}

const LIVE_TEST = {
  title: 'Mid-term: Sorting',
  language: 'javascript' as const,
  windowStart: new Date(Date.now() + 60_000).toISOString(),
  windowEnd: new Date(Date.now() + 86_400_000).toISOString(),
  durationMinutes: 60,
  questions: [
    {
      prompt: 'Implement quicksort.',
      starterCode: 'function q(xs) {}',
      points: 10,
      testCases: [{ input: '2 3', expected: '3 2', hidden: false }],
    },
  ],
}

describe('classroomApi against the mock contract', () => {
  let backend: MockBackend

  beforeEach(() => {
    backend = createMockBackend()
    server.use(...backend.handlers)
  })

  afterEach(() => {
    configureHttpClient({ getToken: () => null })
  })

  describe('reading', () => {
    it('lists a teacher classrooms from their own college', async () => {
      asUser(TEACHER_UID)
      const classrooms = await classroomApi.listMine()
      expect(classrooms.length).toBeGreaterThan(0)
      expect(classrooms.every((classroom) => classroom.collegeId === COLLEGE_ID)).toBe(true)
    })

    it('never includes a classroom from another college', async () => {
      asUser(TEACHER_UID)
      const classrooms = await classroomApi.listMine()
      expect(classrooms.some((classroom) => classroom.collegeId === OTHER_COLLEGE_ID)).toBe(false)
    })

    it('404s a foreign classroom instead of 403, so existence is not leaked', async () => {
      asUser(TEACHER_UID)
      // A 403 would confirm the room exists; a 404 tells the caller nothing.
      await expect(classroomApi.get('room-foreign')).rejects.toMatchObject({ status: 404 })
    })

    it('refuses to let a student read a roster, even one they are enrolled in', async () => {
      asUser(STUDENT_UID)
      // The payload carries `students`, so a 200 here would leak every classmate's
      // name and email to a student.
      await expect(classroomApi.get('room-algorithms')).rejects.toMatchObject({ status: 403 })
    })

    it('lists only the classrooms a student has joined', async () => {
      asUser(STUDENT_UID)
      const joined = await classroomApi.listJoined()
      expect(joined.map((classroom) => classroom.id)).toEqual(['room-algorithms'])
    })

    it('gives an unenrolled student an empty list rather than an error', async () => {
      asUser('u-student-777')
      await expect(classroomApi.listJoined()).resolves.toEqual([])
    })
  })

  describe('enrolment (teacher adds students)', () => {
    it('adds an unregistered email as a pending invite', async () => {
      asUser(TEACHER_UID)
      const result = await classroomApi.addStudents('room-networks', ['New.Student@MIT.ac.in'])
      expect(result.added).toEqual(['new.student@mit.ac.in'])
      const invited = result.classroom.students.find((student) => student.email === 'new.student@mit.ac.in')
      expect(invited).toMatchObject({ pending: true, uid: '' })
    })

    it('shows the classroom to an invited student on their first sign-in', async () => {
      asUser(TEACHER_UID)
      // The fixture identity for an unknown uid is `<uid>@mit.ac.in`.
      await classroomApi.addStudents('room-networks', ['u-student-555@mit.ac.in'])
      asUser('u-student-555')
      const joined = await classroomApi.listJoined()
      expect(joined.map((classroom) => classroom.id)).toContain('room-networks')
    })

    it('is idempotent: re-adding an enrolled email reports it rather than duplicating', async () => {
      asUser(TEACHER_UID)
      await classroomApi.addStudents('room-networks', ['twice@mit.ac.in'])
      const second = await classroomApi.addStudents('room-networks', ['twice@mit.ac.in'])
      expect(second.added).toEqual([])
      expect(second.alreadyEnrolled).toEqual(['twice@mit.ac.in'])
      expect(second.classroom.students.filter((student) => student.email === 'twice@mit.ac.in')).toHaveLength(1)
    })

    it('refuses to let a student add anyone', async () => {
      asUser(STUDENT_UID)
      await expect(classroomApi.addStudents('room-algorithms', ['friend@mit.ac.in'])).rejects.toMatchObject({
        status: 403,
      })
    })

    it('removes a student, who then no longer sees the classroom', async () => {
      asUser(TEACHER_UID)
      await classroomApi.addStudents('room-networks', ['u-student-556@mit.ac.in'])
      const after = await classroomApi.removeStudent('room-networks', 'u-student-556@mit.ac.in')
      expect(after.students.some((student) => student.email === 'u-student-556@mit.ac.in')).toBe(false)
      asUser('u-student-556')
      const joined = await classroomApi.listJoined()
      expect(joined.map((classroom) => classroom.id)).not.toContain('room-networks')
    })

    it('404s removing someone who is not on the roster', async () => {
      asUser(TEACHER_UID)
      await expect(classroomApi.removeStudent('room-networks', 'nobody@mit.ac.in')).rejects.toMatchObject({
        status: 404,
      })
    })
  })

  describe('creating a classroom', () => {
    it('creates a classroom owned by the caller', async () => {
      asUser(TEACHER_UID)
      const created = await classroomApi.create({
        name: 'Operating Systems',
        subject: 'CS350',
        description: 'Processes and threads.',
      })
      expect(created.name).toBe('Operating Systems')
      expect(created.teacherId).toBe(TEACHER_UID)
      expect(created.collegeId).toBe(COLLEGE_ID)
    })

    it('refuses to let a student create a classroom', async () => {
      asUser(STUDENT_UID)
      await expect(classroomApi.create({ name: 'Rogue', subject: 'X' })).rejects.toMatchObject({ status: 403 })
    })
  })

  describe('creating a test', () => {
    it('creates a test with its questions and returns a summary', async () => {
      asUser(TEACHER_UID)
      const summary = await classroomApi.createTest('room-algorithms', LIVE_TEST)
      expect(summary.classroomId).toBe('room-algorithms')
      expect(summary.questionCount).toBe(1)
      expect(summary.totalPoints).toBe(10)
      // The response is metadata only, so the grader's cases never come back.
      expect(summary).not.toHaveProperty('questions')
    })

    it('appears in the classroom test list', async () => {
      asUser(TEACHER_UID)
      await classroomApi.createTest('room-algorithms', LIVE_TEST)
      const tests = await classroomApi.listTests('room-algorithms')
      expect(tests.some((test) => test.title === LIVE_TEST.title)).toBe(true)
    })

    it('refuses to let a student create a test', async () => {
      asUser(STUDENT_UID)
      await expect(classroomApi.createTest('room-algorithms', LIVE_TEST)).rejects.toMatchObject({ status: 403 })
    })

    /*
     * Everything a teacher types goes over the wire, so it is capped and stripped
     * before it leaves the browser. That is defence in depth, not a substitute for
     * the server validating the same fields.
     */
    it('strips control characters and caps length before sending', async () => {
      asUser(TEACHER_UID)
      // Built with fromCharCode so no raw control byte ends up in this file.
      const nul = String.fromCharCode(0)
      const summary = await classroomApi.createTest('room-algorithms', {
        ...LIVE_TEST,
        title: 'A'.repeat(200) + nul,
        instructions: 'line one' + nul + 'line two',
      })
      expect(summary.title.length).toBeLessThanOrEqual(120)
      expect(summary.title).not.toContain(nul)
    })
  })

  describe('filterClassroomsByTerm', () => {
    const classrooms = [
      { name: 'Data Structures', subject: 'CS201', joinCode: 'MITDS26', teacherName: 'Aditya Rao' },
      { name: 'Computer Networks', subject: 'CS305', joinCode: 'MITCN26', teacherName: 'Aditya Rao' },
    ] as never

    it('matches across name, subject and teacher', () => {
      expect(filterClassroomsByTerm(classrooms, 'network')).toHaveLength(1)
      expect(filterClassroomsByTerm(classrooms, 'cs201')).toHaveLength(1)
      expect(filterClassroomsByTerm(classrooms, 'aditya')).toHaveLength(2)
    })

    it('no longer matches the retired join code', () => {
      expect(filterClassroomsByTerm(classrooms, 'MITCN26')).toHaveLength(0)
    })

    it('is case insensitive', () => {
      expect(filterClassroomsByTerm(classrooms, 'DATA structures')).toHaveLength(1)
    })

    it('returns everything for an empty or blank term', () => {
      expect(filterClassroomsByTerm(classrooms, '')).toHaveLength(2)
      expect(filterClassroomsByTerm(classrooms, '   ')).toHaveLength(2)
    })

    it('returns nothing for a term that matches no field', () => {
      expect(filterClassroomsByTerm(classrooms, 'quantum')).toHaveLength(0)
    })
  })
})
