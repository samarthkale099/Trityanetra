import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test'

import { copyRings, program } from './simulation.programs'

/**
 * CLASS-SCALE SIMULATION: a full practical exam for 50 students across 10
 * experiments, against the REAL backend, Firestore emulator, Redis queue and
 * AST engine. Driven through the API (50 browsers would measure the test
 * machine, not the product).
 *
 * Every student signs in at once, and for each experiment all 50 open the
 * lobby, start, save a draft and submit concurrently. Then the teacher runs
 * the plagiarism check on all 10 experiments (10 x 1,225 pairs).
 *
 * The AST report is graded against a planted answer key: in each experiment
 * three rings of students (2, 3 and 4 people) copy one program and disguise it
 * (every name changed, comments added). Everyone else writes a structurally
 * different program. Report: test-results/simulation/report.json.
 */
test.describe.configure({ mode: 'serial' })
test.setTimeout(45 * 60_000)

const API = 'http://127.0.0.1:5001'
const PASSWORD = 'Fullstack-Pass-42'
const STUDENTS = Array.from({ length: 50 }, (_, i) => {
  const n = String(i + 1).padStart(2, '0')
  return { uid: `sim-${n}`, email: `sim${n}@mit.ac.in`, name: `Student ${n}` }
})
const EXPERIMENTS = 10
const PAIRS_PER_EXPERIMENT = (50 * 49) / 2

/* ------------------------------------------------------------- helpers */

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0
}

async function call(api: APIRequestContext, method: 'get' | 'post', url: string, token: string, data?: unknown) {
  const started = Date.now()
  const res = await api[method](url, { headers: { Authorization: `Bearer ${token}` }, ...(data ? { data } : {}) })
  return { status: res.status(), ms: Date.now() - started, body: await res.json().catch(() => ({})) }
}

/* ---------------------------------------------------------- the exam */

const report: Record<string, unknown> = {}
let api: APIRequestContext
let teacherToken = ''
const tokens = new Map<string, string>()
const experimentIds: string[] = []

test.beforeAll(async () => {
  api = await playwrightRequest.newContext({ baseURL: API })
})

test.afterAll(async () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-results', 'simulation')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2))
  console.log('\nCLASS SIMULATION REPORT\n' + JSON.stringify(report, null, 2))
  await api?.dispose()
})

test('C1. the teacher sets up a class of 50 and 10 experiments', async () => {
  const login = await api.post('/api/auth/login', { data: { email: 'aditya@mit.ac.in', password: PASSWORD } })
  expect(login.status()).toBe(200)
  teacherToken = (await login.json()).token

  const room = await call(api, 'post', '/api/classrooms', teacherToken, { name: 'Simulated Lab Batch A', subject: 'CS-LAB' })
  expect(room.status).toBe(201)
  const classroomId = room.body.data.id

  const enrol = await call(api, 'post', `/api/classrooms/${classroomId}/students`, teacherToken, {
    emails: STUDENTS.map((s) => s.email),
  })
  expect(enrol.status).toBeLessThan(300)
  expect(enrol.body.result.added).toHaveLength(50)

  const now = Date.now()
  for (let e = 1; e <= EXPERIMENTS; e++) {
    const created = await call(api, 'post', '/api/tests', teacherToken, {
      classroomId,
      title: `Experiment ${e}`,
      language: 'python',
      startTime: new Date(now - 2 * 60_000).toISOString(),
      endTime: new Date(now + 4 * 60 * 60_000).toISOString(),
      durationMinutes: 180,
      questions: [
        {
          id: 'q1',
          prompt: `Experiment ${e}`,
          points: 10,
          testCases: [{ id: 'c1', input: '3\n1 2 3', expected: '6', hidden: false }],
        },
      ],
    })
    expect(created.status).toBe(201)
    experimentIds.push(created.body.data.id)
  }
  report.setup = { students: 50, experiments: experimentIds.length }
})

test('C2. all 50 students sign in at the same moment', async () => {
  const results = await Promise.all(
    STUDENTS.map(async (s) => {
      const started = Date.now()
      const res = await api.post('/api/auth/login', { data: { email: s.email, password: PASSWORD } })
      const body = await res.json().catch(() => ({}))
      if (res.status() === 200) tokens.set(s.uid, body.token)
      return { status: res.status(), ms: Date.now() - started }
    }),
  )
  const failed = results.filter((r) => r.status !== 200)
  const ms = results.map((r) => r.ms)
  report.signIn = { concurrent: 50, failed: failed.length, p50Ms: percentile(ms, 50), p95Ms: percentile(ms, 95), maxMs: Math.max(...ms) }
  expect(failed).toEqual([])
  expect.soft(percentile(ms, 95), 'p95 sign-in under 10 s with 50 at once').toBeLessThan(10_000)
})

test('C3. every student sits all 10 experiments; each experiment is submitted by all 50 at once', async () => {
  const perStep: Record<string, number[]> = { lobby: [], start: [], saveDraft: [], submit: [] }
  const failures: string[] = []
  for (let e = 0; e < EXPERIMENTS; e++) {
    const testId = experimentIds[e]
    const rings = copyRings(e)
    const victimOf = new Map<number, number>()
    for (const ring of rings) for (const member of ring) victimOf.set(member, ring[0])

    await Promise.all(
      STUDENTS.map(async (s, i) => {
        const token = tokens.get(s.uid)!
        const structureSeed = 1_000 * (e + 1) + (victimOf.get(i) ?? i)
        const code = program(e, structureSeed, 50_000 + 1_000 * e + i, victimOf.has(i) && victimOf.get(i) !== i)
        const steps: Array<[string, 'get' | 'post', string, unknown?]> = [
          ['lobby', 'get', `/api/tests/${testId}/lobby`],
          ['start', 'get', `/api/tests/${testId}/entry`],
          ['saveDraft', 'post', '/api/submissions/save', { testId, answers: { language: 'python', code } }],
          ['submit', 'post', '/api/submissions', { testId, answers: { language: 'python', code } }],
        ]
        for (const [step, method, url, data] of steps) {
          const r = await call(api, method, url, token, data)
          perStep[step].push(r.ms)
          if (r.status >= 300) failures.push(`exp ${e + 1} ${s.email} ${step}: ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`)
        }
      }),
    )
  }
  report.examLoad = {
    requests: Object.values(perStep).reduce((n, list) => n + list.length, 0),
    failures: failures.length,
    firstFailures: failures.slice(0, 5),
    latencyMs: Object.fromEntries(
      Object.entries(perStep).map(([step, list]) => [step, { p50: percentile(list, 50), p95: percentile(list, 95), max: Math.max(...list) }]),
    ),
  }
  expect(failures).toEqual([])
  expect.soft(percentile(perStep.submit, 95), 'p95 submit under 8 s with 50 at once').toBeLessThan(8_000)

  // Correct output: the teacher sees 50 submissions in every experiment.
  for (const testId of experimentIds) {
    const list = await call(api, 'get', `/api/submissions/test/${testId}`, teacherToken)
    const rows: Array<{ state: string }> = list.body.data?.submissions ?? []
    expect(rows.filter((row) => row.state === 'SUBMITTED' || row.state === 'LATE')).toHaveLength(50)
  }
})

test('C4. a sample of students run their programs and get the right answer', async () => {
  // Five runs only: the code runner is a free public service and must not be flooded.
  const sum = 'n = int(input())\nprint(sum(map(int, input().split())))\n'
  const outcomes: Array<{ status: number; output: string; ms: number }> = []
  for (const s of STUDENTS.slice(0, 5)) {
    const r = await call(api, 'post', `/api/judge0/tests/${experimentIds[0]}/run`, tokens.get(s.uid)!, {
      code: sum,
      languageId: 71,
      stdin: '3\n1 2 3',
    })
    outcomes.push({ status: r.status, output: String(r.body?.data?.result?.stdout ?? '').trim(), ms: r.ms })
  }
  report.codeRuns = outcomes
  for (const o of outcomes) {
    expect.soft(o.status, 'code runner reachable').toBe(200)
    if (o.status === 200) expect(o.output).toBe('6')
  }
})

test('C5. the AST report for all 10 experiments is complete and catches every planted copy', async () => {
  const studentIndex = new Map(STUDENTS.map((s, i) => [s.uid, i]))
  const perExperiment: unknown[] = []
  let caught = 0
  let planted = 0
  let honestPairs = 0
  let honestHigh = 0
  let honestMedium = 0

  for (let e = 0; e < EXPERIMENTS; e++) {
    const testId = experimentIds[e]
    const started = Date.now()
    const trigger = await call(api, 'post', `/api/plagiarism/${testId}/check`, teacherToken)
    expect(trigger.status).toBeLessThan(300)

    let status: any = {}
    await expect
      .poll(
        async () => {
          status = (await call(api, 'get', `/api/plagiarism/${testId}/status`, teacherToken)).body
          return status.status
        },
        { timeout: 10 * 60_000, intervals: [2_000] },
      )
      .toMatch(/COMPLETED|FAILED/)
    const seconds = Math.round((Date.now() - started) / 100) / 10
    expect(status.status, status.error ?? status.message).toBe('COMPLETED')

    // Complete: every one of the 1,225 pairs compared, nothing skipped.
    expect(status.summary.totalSubmissions).toBe(50)
    expect(status.summary.totalPairs).toBe(PAIRS_PER_EXPERIMENT)
    expect(status.pairs).toHaveLength(PAIRS_PER_EXPERIMENT)
    expect(status.skipped ?? []).toEqual([])

    const copyPairs = new Set<string>()
    for (const ring of copyRings(e))
      for (let a = 0; a < ring.length; a++)
        for (let b = a + 1; b < ring.length; b++) copyPairs.add([ring[a], ring[b]].sort((x, y) => x - y).join('-'))

    let expCaught = 0
    let expHonestHigh = 0
    const missed: string[] = []
    for (const pair of status.pairs as any[]) {
      // Correct names: the student on each side matches the submission's owner.
      const uidA = String(pair.submissionA).slice(testId.length + 1)
      const uidB = String(pair.submissionB).slice(testId.length + 1)
      expect(pair.studentA?.id).toBe(uidA)
      expect(pair.studentB?.id).toBe(uidB)
      expect(pair.studentA?.email).toBe(STUDENTS[studentIndex.get(uidA)!].email)

      const key = [studentIndex.get(uidA)!, studentIndex.get(uidB)!].sort((x, y) => x - y).join('-')
      if (copyPairs.has(key)) {
        if (pair.flagLevel === 'high' || pair.flagLevel === 'medium') expCaught++
        else missed.push(`${key} scored ${pair.metrics.combined_score} (${pair.flagLevel})`)
      } else {
        honestPairs++
        if (pair.flagLevel === 'high') {
          honestHigh++
          expHonestHigh++
        } else if (pair.flagLevel === 'medium') honestMedium++
      }
    }
    caught += expCaught
    planted += copyPairs.size
    perExperiment.push({
      experiment: e + 1,
      seconds,
      pairsCompared: status.pairs.length,
      plantedCopyPairs: copyPairs.size,
      caught: expCaught,
      missed,
      honestPairsFlaggedHigh: expHonestHigh,
    })
  }

  report.plagiarism = {
    experiments: perExperiment,
    totals: {
      pairsCompared: EXPERIMENTS * PAIRS_PER_EXPERIMENT,
      plantedCopyPairs: planted,
      caught,
      recall: planted ? Math.round((caught / planted) * 1000) / 10 + '%' : 'n/a',
      honestPairs,
      honestFlaggedHigh: honestHigh,
      honestFlaggedMedium: honestMedium,
      falseHighRate: Math.round((honestHigh / Math.max(1, honestPairs)) * 10000) / 100 + '%',
    },
  }

  // Every disguised copy must be caught.
  expect(caught, 'planted copy pairs caught').toBe(planted)
  // Honest work wrongly called a likely copy: kept rare.
  expect.soft(honestHigh / Math.max(1, honestPairs), 'false "high" rate on honest pairs').toBeLessThan(0.02)
})
