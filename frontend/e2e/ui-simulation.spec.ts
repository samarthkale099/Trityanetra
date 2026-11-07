import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Browser, type Page } from '@playwright/test'

import { copyRings, program } from './simulation.programs'

/**
 * CLASS SIMULATION THROUGH THE WEBSITE: 50 students x 10 experiments, every
 * step done in a real browser exactly as people would, against the REAL
 * stack (backend, Firestore emulator, Redis, AST engine).
 *
 * - The teacher creates the classroom, pastes 50 emails and fills in the
 *   "New test" form ten times.
 * - Students work in waves of 10 at once (10 browser windows): sign in, then
 *   for each experiment click it on the dashboard, open the lobby, start,
 *   enter fullscreen, write the program in the editor and submit.
 * - The teacher opens every experiment, checks all 50 submitted, clicks
 *   "Run check" and reads the plagiarism report off the screen; it is graded
 *   against the planted copy rings. Then grades one student and releases;
 *   that student reads the mark on the result page.
 *
 * Writing code: the program is placed in the editor through Monaco's own API
 * (the same change a student's typing makes); real keystrokes are covered by
 * the walk-through and acceptance tests. Report: test-results/ui-simulation.
 */
test.describe.configure({ mode: 'serial' })

const PASSWORD = 'Fullstack-Pass-42'
const TEACHER = 'aditya@mit.ac.in'
const CLASSROOM = 'Lab Batch B (browser)'
const EXPERIMENTS = 10
const WAVE = 10
const STUDENTS = Array.from({ length: 50 }, (_, i) => {
  const n = String(i + 1).padStart(2, '0')
  return { email: `sim${n}@mit.ac.in`, name: `Student ${n}` }
})
const title = (e: number) => `Lab B Experiment ${e + 1}`
/** "Lab B Experiment 1" must not match "Lab B Experiment 10". */
const titleMatch = (e: number) => new RegExp(`${title(e)}(?!\\d)`)

const timings: Record<string, number[]> = { signIn: [], openLobby: [], examReady: [], submit: [], teacherReport: [] }
const report: Record<string, unknown> = {}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0
}
async function timed<T>(bucket: string, action: () => Promise<T>): Promise<T> {
  const started = Date.now()
  const result = await action()
  timings[bucket].push(Date.now() - started)
  return result
}
function istInput(msFromNow: number): string {
  return new Date(Date.now() + msFromNow + 330 * 60_000).toISOString().slice(0, 16)
}
async function newPage(browser: Browser): Promise<Page> {
  return (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
}
async function signIn(page: Page, email: string, home: RegExp) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(home, { timeout: 90_000 })
}
/** Puts a program in the exam editor through Monaco, which fires the same change as typing. */
async function writeInEditor(page: Page, code: string) {
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 120_000 })
  await page.waitForFunction(() => Boolean((window as any).monaco?.editor?.getEditors?.().length), null, { timeout: 60_000 })
  await page.evaluate((text) => (window as any).monaco.editor.getEditors()[0].setValue(text), code)
}

test.afterAll(() => {
  report.timingsMs = Object.fromEntries(
    Object.entries(timings).map(([k, v]) => [k, { count: v.length, p50: percentile(v, 50), p95: percentile(v, 95), max: v.length ? Math.max(...v) : 0 }]),
  )
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-results', 'ui-simulation')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2))
  console.log('\nBROWSER CLASS SIMULATION REPORT\n' + JSON.stringify(report, null, 2))
})

test('U1. the teacher sets up the class and 10 experiments through the website', async ({ browser }) => {
  test.setTimeout(20 * 60_000)
  const page = await newPage(browser)
  await signIn(page, TEACHER, /\/app\/dashboard$/)

  await page.goto('/app/classrooms')
  await page.getByRole('button', { name: 'New classroom' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Classroom name').fill(CLASSROOM)
  await dialog.getByLabel('Subject or course code').fill('CS-LAB-B')
  await dialog.getByRole('button', { name: /create/i }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('listitem').filter({ hasText: CLASSROOM }).getByRole('link').first().click()
  await page.waitForURL(/\/app\/classrooms\/[^/]+$/)
  const classroomPath = new URL(page.url()).pathname
  report.classroomPath = classroomPath

  await page.getByLabel('Student emails').fill(STUDENTS.map((s) => s.email).join('\n'))
  await page.getByRole('button', { name: 'Add to classroom' }).click()
  await expect(page.getByText('50 students added').first()).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(STUDENTS[49].email)).toBeVisible()

  for (let e = 0; e < EXPERIMENTS; e++) {
    await page.goto(`${classroomPath}/tests/new`)
    await page.getByLabel('Title').fill(title(e))
    await page.getByRole('combobox', { name: 'Language' }).click()
    await page.getByRole('option', { name: 'Python' }).click()
    await page.getByLabel('Opens').fill(istInput(-2 * 60_000))
    await page.getByLabel('Closes').fill(istInput(5 * 60 * 60_000))
    await page.getByLabel('Time allowed (minutes)').fill('180')
    await page.getByLabel('Question 1 prompt').fill(`Experiment ${e + 1}: read n and n integers, print the answer.`)
    await page.getByRole('button', { name: 'Create test' }).click()
    await page.waitForURL(/\/app\/classrooms\/[^/]+$/, { timeout: 60_000 })
    await expect(page.getByRole('listitem').filter({ hasText: titleMatch(e) })).toBeVisible()
  }
})

test('U2. 50 students, 10 at a time, sit all 10 experiments through the website', async ({ browser }) => {
  test.setTimeout(150 * 60_000)
  const failures: string[] = []
  const runSamples: Array<{ student: string; output: string }> = []

  const student = async (index: number) => {
    const s = STUDENTS[index]
    const page = await newPage(browser)
    try {
      await timed('signIn', () => signIn(page, s.email, /\/app\/student$/))
      for (let e = 0; e < EXPERIMENTS; e++) {
        try {
          // From the dashboard, like a student: click the experiment.
          if (!/\/app\/student$/.test(page.url())) {
            await page.getByRole('link', { name: 'My tests' }).first().click()
            await page.waitForURL(/\/app\/student$/, { timeout: 60_000 })
          }
          await timed('openLobby', async () => {
            await page.getByRole('listitem').filter({ hasText: titleMatch(e) }).getByRole('link').first().click()
            await page.waitForURL(/\/lobby$/, { timeout: 60_000 })
          })
          await page.getByRole('button', { name: /Start exam|Resume exam/ }).click()
          await page.waitForURL(/\/exam$/, { timeout: 60_000 })
          await page.getByRole('button', { name: 'Enter fullscreen' }).click()
          await timed('examReady', () => expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 120_000 }))

          // A few students try their code with Run first (the code runner is a free public service).
          if (e === 0 && index < 5) {
            await writeInEditor(page, 'n = int(input())\nprint(sum(map(int, input().split())))\n')
            await page.getByRole('checkbox', { name: 'Use my own input' }).check()
            await page.getByLabel(/Your input/).fill('3\n1 2 3')
            await page.getByRole('button', { name: 'Run', exact: true }).click()
            const ok = await expect(page.getByText(/^6$/).first())
              .toBeVisible({ timeout: 60_000 })
              .then(() => true)
              .catch(() => false)
            runSamples.push({ student: s.email, output: ok ? '6' : 'no output (runner unavailable?)' })
          }

          const rings = copyRings(100 + e)
          const victim = rings.find((ring) => ring.includes(index))?.[0]
          const code = program(e, 7_000 + 1_000 * e + (victim ?? index), 80_000 + 1_000 * e + index, victim !== undefined && victim !== index)
          await writeInEditor(page, code)

          await page.getByRole('button', { name: 'Submit exam' }).first().click()
          await timed('submit', async () => {
            await page.getByRole('dialog').getByRole('button', { name: 'Submit exam' }).click()
            await expect(page.getByRole('button', { name: 'Submitted' })).toBeDisabled({ timeout: 60_000 })
          })
          await page.getByRole('button', { name: 'Back to the lobby' }).click()
          await page.waitForURL(/\/lobby$/, { timeout: 60_000 })
        } catch (error) {
          failures.push(`${s.email} ${title(e)}: ${(error as Error).message.split('\n')[0]}`)
        }
      }
    } catch (error) {
      failures.push(`${s.email} sign-in: ${(error as Error).message.split('\n')[0]}`)
    } finally {
      await page.context().close()
    }
  }

  for (let start = 0; start < STUDENTS.length; start += WAVE) {
    await Promise.all(Array.from({ length: Math.min(WAVE, STUDENTS.length - start) }, (_, k) => student(start + k)))
  }
  report.students = { sittings: STUDENTS.length * EXPERIMENTS, failures: failures.length, firstFailures: failures.slice(0, 10) }
  report.codeRuns = runSamples
  expect(failures).toEqual([])
  for (const r of runSamples) expect.soft(r.output, `Run output for ${r.student}`).toBe('6')
})

test('U3. the teacher sees 50 submissions per experiment and the plagiarism report catches every copy', async ({ browser }) => {
  test.setTimeout(60 * 60_000)
  const page = await newPage(browser)
  await signIn(page, TEACHER, /\/app\/dashboard$/)
  const classroomPath = String(report.classroomPath)
  const byName = new Map(STUDENTS.map((s, i) => [s.name, i]))
  const perExperiment: unknown[] = []
  let planted = 0
  let caught = 0
  let honestHigh = 0
  let honestShown = 0

  for (let e = 0; e < EXPERIMENTS; e++) {
    await page.goto(classroomPath)
    await page.getByRole('listitem').filter({ hasText: titleMatch(e) }).getByRole('link', { name: 'Review' }).click()
    await page.waitForURL(/\/tests\/[^/]+$/)
    const testPath = new URL(page.url()).pathname

    // Correct output: all 50 submitted.
    await page.goto(`${testPath}/submissions`)
    await expect(page.getByRole('link', { name: /^Grade Student \d\d$/ })).toHaveCount(50, { timeout: 60_000 })

    await page.goto(testPath)
    await page.getByRole('tab', { name: 'Plagiarism' }).click()
    await timed('teacherReport', async () => {
      await page.getByRole('button', { name: /Run check|Run again/ }).click()
      await expect(page.getByRole('tabpanel')).toContainText('Pairs compared', { timeout: 10 * 60_000 })
    })

    // Read every pair the screen lists: "Student 03 ↔ Student 17" with its level badge.
    const shown: Array<{ a: string; b: string; level: string }> = await page.getByRole('tabpanel').locator('li').evaluateAll((items) =>
      items
        .map((li) => {
          const text = li.textContent ?? ''
          const names = text.match(/Student \d\d\s*↔\s*Student \d\d/)
          const level = text.match(/\b(High|Medium|Low)\b/)
          if (!names || !level) return null
          const [a, b] = names[0].split('↔').map((part) => part.trim())
          return { a, b, level: level[1] }
        })
        .filter((x): x is { a: string; b: string; level: string } => x !== null),
    )

    const copyPairs = new Set<string>()
    for (const ring of copyRings(100 + e))
      for (let x = 0; x < ring.length; x++)
        for (let y = x + 1; y < ring.length; y++) copyPairs.add([ring[x], ring[y]].sort((p, q) => p - q).join('-'))
    const found = new Map(shown.map((p) => [[byName.get(p.a)!, byName.get(p.b)!].sort((x, y) => x - y).join('-'), p.level]))

    const missed = [...copyPairs].filter((k) => !['High', 'Medium'].includes(found.get(k) ?? ''))
    const expHonestHigh = [...found].filter(([k, level]) => !copyPairs.has(k) && level === 'High').length
    planted += copyPairs.size
    caught += copyPairs.size - missed.length
    honestHigh += expHonestHigh
    honestShown += [...found.keys()].filter((k) => !copyPairs.has(k)).length
    perExperiment.push({ experiment: e + 1, pairsShownOnScreen: shown.length, plantedCopyPairs: copyPairs.size, missed, honestShownAsHigh: expHonestHigh })
  }

  report.plagiarismOnScreen = {
    experiments: perExperiment,
    totals: { plantedCopyPairs: planted, caughtOnScreen: caught, honestPairsShown: honestShown, honestShownAsHigh: honestHigh },
  }
  expect(caught, 'every planted copy shown as High or Medium').toBe(planted)
  expect.soft(honestHigh, 'honest pairs shown as High').toBeLessThanOrEqual(Math.ceil(0.02 * EXPERIMENTS * 1225))
})

test('U4. the teacher grades and releases through the website, and the student reads the mark', async ({ browser }) => {
  test.setTimeout(15 * 60_000)
  const teacher = await newPage(browser)
  await signIn(teacher, TEACHER, /\/app\/dashboard$/)
  await teacher.goto(String(report.classroomPath))
  await teacher.getByRole('listitem').filter({ hasText: titleMatch(0) }).getByRole('link', { name: 'Review' }).click()
  await teacher.getByRole('link', { name: 'View submissions' }).click()
  await teacher.getByRole('link', { name: 'Grade Student 01' }).click()
  await teacher.getByLabel(/Marks out of/).fill('9')
  await teacher.getByLabel('Comment for the student').fill('Well structured.')
  await teacher.getByRole('button', { name: 'Save grades' }).click()
  await expect(teacher.getByText('Grades saved').first()).toBeVisible()
  await teacher.getByRole('link', { name: 'Back to submissions' }).click()
  await teacher.getByRole('button', { name: 'Release results' }).click()
  await teacher.getByRole('dialog').getByRole('button', { name: 'Release results' }).click()
  await expect(teacher.locator('#main-content').getByText('Results released')).toBeVisible()

  const student = await newPage(browser)
  await signIn(student, STUDENTS[0].email, /\/app\/student$/)
  await student.getByRole('listitem').filter({ hasText: titleMatch(0) }).getByRole('link').first().click()
  await student.waitForURL(/\/(lobby|result)$/)
  if (/lobby$/.test(student.url())) await student.getByRole('link', { name: /result/i }).first().click()
  await expect(student.getByText('Well structured.')).toBeVisible({ timeout: 60_000 })
  await expect(student.getByText('/ 10').first()).toBeVisible()
  await expect(student.getByText('9', { exact: true }).first()).toBeVisible()
})
