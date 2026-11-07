import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Browser, type Page } from '@playwright/test'

/**
 * USER ACCEPTANCE TESTS: every feature as each role uses it, against the REAL
 * stack (backend, Firestore emulator, Redis, AST engine). Each check asserts
 * the correct output, and each user action is timed against a budget; the
 * timings are written to test-results/uat/timings.json for the test report.
 *
 * Runs with the full-stack config: `npm run test:fullstack`.
 * Seed (backend/scripts/seed-fullstack.ts): MIT college (mit.ac.in) and VIT
 * (vit.ac.in); root admin, MIT college admin, teachers Aditya and Neha,
 * students Tara and Dev (MIT) and Priya (VIT).
 */
test.describe.configure({ mode: 'serial' })

const PASSWORD = 'Fullstack-Pass-42'
const ROOT_ADMIN = 'admin@trityanetra.local'
const COLLEGE_ADMIN = 'collegeadmin@mit.ac.in'
const TEACHER = 'aditya@mit.ac.in'
const OTHER_TEACHER = 'neha@mit.ac.in'
const TARA = { email: 'tara@mit.ac.in', name: 'Tara Iyer' }
const DEV = { email: 'dev@mit.ac.in', name: 'Dev Patil' }
const VIT_STUDENT = 'priya@vit.ac.in'
const UNREGISTERED = 'newjoiner@mit.ac.in'

const CLASSROOM = 'UAT Algorithms'
const TEST_TITLE = 'UAT Experiment: Sum of two numbers'
const SHORT_TEST_TITLE = 'UAT Timing: one-minute quiz'

/** Generous budgets for a CI machine; a miss is reported, not fatal. */
const BUDGET = { signIn: 8_000, page: 6_000, action: 6_000, submit: 8_000, plagiarism: 90_000, run: 30_000 }

const timings: { step: string; ms: number; budgetMs: number; withinBudget: boolean }[] = []
let testId = ''
let shortTestId = ''
let classroomUrl = ''

/** Times a user action and soft-checks it against its budget. */
async function timed<T>(step: string, budgetMs: number, action: () => Promise<T>): Promise<T> {
  const started = Date.now()
  const result = await action()
  const ms = Date.now() - started
  timings.push({ step, ms, budgetMs, withinBudget: ms <= budgetMs })
  expect.soft(ms, `${step} took ${ms} ms (budget ${budgetMs} ms)`).toBeLessThanOrEqual(budgetMs)
  return result
}

test.afterAll(() => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-results', 'uat')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'timings.json'), JSON.stringify(timings, null, 2))
  console.log('\nUAT timings (ms):')
  for (const t of timings) console.log(`  ${t.withinBudget ? 'OK  ' : 'SLOW'} ${String(t.ms).padStart(6)} / ${t.budgetMs}  ${t.step}`)
})

function istInput(msFromNow: number): string {
  return new Date(Date.now() + msFromNow + 330 * 60_000).toISOString().slice(0, 16)
}

async function newPage(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage()
}

async function signIn(page: Page, email: string, step: string, home: RegExp) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await timed(step, BUDGET.signIn, async () => {
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(home, { timeout: 60_000 })
  })
}

async function typeCode(page: Page, code: string) {
  const editor = page.locator('.monaco-editor').first()
  await expect(editor).toBeVisible({ timeout: 120_000 })
  await editor.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Delete')
  for (const line of code.split('\n')) {
    await page.keyboard.type(line)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Home')
  }
}

/** After "Create test" the app returns to the classroom; the new test's id is in its Review link. */
async function testIdFromClassroom(page: Page, title: string): Promise<string> {
  await page.waitForURL(/\/app\/classrooms\/[^/]+$/, { timeout: 60_000 })
  const link = page.getByRole('listitem').filter({ hasText: title }).getByRole('link', { name: 'Review' }).first()
  await expect(link).toBeVisible({ timeout: 30_000 })
  const href = (await link.getAttribute('href')) ?? ''
  return decodeURIComponent(href.split('/tests/')[1]?.split(/[/?#]/)[0] ?? '')
}

async function createTest(page: Page, title: string, minutes: number) {
  await page.goto(`${classroomUrl}/tests/new`)
  await page.getByLabel('Title').fill(title)
  await page.getByRole('combobox', { name: 'Language' }).click()
  await page.getByRole('option', { name: 'Python' }).click()
  await page.getByLabel('Opens').fill(istInput(-2 * 60_000))
  await page.getByLabel('Closes').fill(istInput(120 * 60_000))
  await page.getByLabel('Time allowed (minutes)').fill(String(minutes))
  await page.getByLabel('Question 1 prompt').fill('Read two integers on one line and print their sum.')
  await timed(`Teacher creates the test "${title}"`, BUDGET.action, async () => {
    await page.getByRole('button', { name: 'Create test' }).click()
    await page.waitForURL(/\/app\/classrooms\/[^/]+$/, { timeout: 60_000 })
  })
  return testIdFromClassroom(page, title)
}

/* ======================================================================== */
/*  TEACHER                                                                 */
/* ======================================================================== */

test('T1. teacher signs in to the dashboard', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, TEACHER, 'Teacher sign-in to dashboard', /\/app\/dashboard$/)
  await expect(page.getByRole('link', { name: 'Classrooms' }).first()).toBeVisible()
  // A teacher gets no admin links.
  await expect(page.getByRole('link', { name: 'People' })).toHaveCount(0)
})

test('T2. teacher creates a classroom and enrols students by email (added, invited, refused)', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, TEACHER, 'Teacher sign-in', /\/app\/dashboard$/)
  await page.goto('/app/classrooms')
  await page.getByRole('button', { name: 'New classroom' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Classroom name').fill(CLASSROOM)
  await dialog.getByLabel('Subject or course code').fill('CS201')
  await timed('Teacher creates a classroom', BUDGET.action, async () => {
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(dialog).toBeHidden()
  })
  await page.getByRole('listitem').filter({ hasText: CLASSROOM }).getByRole('link').first().click()
  await page.waitForURL(/\/app\/classrooms\/[^/]+$/)
  classroomUrl = new URL(page.url()).pathname

  await page.getByLabel('Student emails').fill([TARA.email, DEV.email, UNREGISTERED, VIT_STUDENT].join('\n'))
  await timed('Teacher adds 4 students by email', BUDGET.action, async () => {
    await page.getByRole('button', { name: 'Add to classroom' }).click()
    await expect(page.getByText(TARA.email)).toBeVisible({ timeout: 30_000 })
  })
  // Correct output: two registered students added, one invited, the other college refused with a reason.
  await expect(page.getByText(DEV.email)).toBeVisible()
  await expect(page.getByText(UNREGISTERED)).toBeVisible()
  await expect(page.getByText('Invited').first()).toBeVisible()
  await expect(page.getByText(new RegExp(`Not added: ${VIT_STUDENT.replace('.', '\\.')}`)).first()).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: VIT_STUDENT })).toHaveCount(0)

  // Removing the pending invite.
  await timed('Teacher removes an invited student', BUDGET.action, async () => {
    await page.getByRole('button', { name: new RegExp(`Remove ${UNREGISTERED}`) }).click()
    const confirm = page.getByRole('dialog')
    if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button', { name: /remove/i }).click()
    await expect(page.getByText(UNREGISTERED)).toHaveCount(0, { timeout: 30_000 })
  })
})

test('T3. the test form rejects an incomplete test, then creates a valid one', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, TEACHER, 'Teacher sign-in', /\/app\/dashboard$/)
  await page.goto(`${classroomUrl}/tests/new`)
  await page.getByRole('button', { name: 'Create test' }).click()
  // Correct output: it stays on the form and explains what is missing.
  await expect(page).toHaveURL(/\/tests\/new$/)
  await expect(page.getByRole('alert').filter({ hasText: /title|prompt|enter/i }).first()).toBeVisible()

  testId = await createTest(page, TEST_TITLE, 30)
  shortTestId = await createTest(page, SHORT_TEST_TITLE, 1)
  expect(testId).not.toBe(shortTestId)
})

test("T4. another teacher cannot see or open this teacher's classroom", async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, OTHER_TEACHER, 'Second teacher sign-in', /\/app\/dashboard$/)
  await page.goto('/app/classrooms')
  await expect(page.getByText(CLASSROOM)).toHaveCount(0)
  await page.goto(classroomUrl)
  await expect(page.getByText(TARA.email)).toHaveCount(0)
})

/* ======================================================================== */
/*  STUDENT                                                                 */
/* ======================================================================== */

test('S1. a wrong password is refused with a clear message', async ({ browser }) => {
  const page = await newPage(browser)
  await page.goto('/login')
  await page.getByLabel('Email').fill(TARA.email)
  await page.getByLabel('Password', { exact: true }).fill('not-the-password')
  await timed('Wrong password rejected', BUDGET.signIn, async () => {
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('alert')).toContainText(/email or password is incorrect/i)
  })
  await expect(page).toHaveURL(/\/login$/)
})

test('S2. the student sees the classroom and test, and is kept out of teacher and admin pages', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, TARA.email, 'Student sign-in to dashboard', /\/app\/student$/)
  await expect(page.getByText(TEST_TITLE).first()).toBeVisible()
  await expect(page.getByText(CLASSROOM).first()).toBeVisible()

  for (const blocked of ['/app/classrooms', '/app/admin/people', '/app/admin/colleges']) {
    await page.goto(blocked)
    await expect(page).toHaveURL(/\/app\/student$/)
  }
  // The server refuses too, not just the screen.
  const status = await page.evaluate(async () => {
    const token = localStorage.getItem('trityanetra:token')
    return (await fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } })).status
  })
  expect(status).toBe(403)
})

test('S3. the lobby shows the test without its questions; the exam keeps work across a reload', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, TARA.email, 'Student sign-in', /\/app\/student$/)
  await timed('Student opens the lobby', BUDGET.page, async () => {
    await page.goto(`/app/tests/${testId}/lobby`)
    await expect(page.getByText(TEST_TITLE).first()).toBeVisible()
  })
  await expect(page.getByText('Read two integers on one line')).toHaveCount(0)

  await timed('Student starts the exam', BUDGET.page, async () => {
    await page.getByRole('button', { name: /Start exam|Resume exam/ }).click()
    await page.waitForURL(/\/exam$/)
  })
  await page.getByRole('button', { name: 'Enter fullscreen' }).click()
  await expect(page.getByText('Time left').first()).toBeVisible()
  await expect(page.getByText('Read two integers on one line').first()).toBeVisible()
  await typeCode(page, 'a, b = map(int, input().split())\nprint(a + b)')

  // Autosave: a reload (or crash) must not lose the answer.
  await page.waitForTimeout(2000)
  await page.reload()
  await page.getByRole('button', { name: 'Enter fullscreen' }).click()
  await expect(page.locator('.monaco-editor .view-lines').first()).toContainText('print(a', { timeout: 120_000 })
})

test('S4. Run gives the correct output, a tab switch is flagged, and the exam submits once', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, TARA.email, 'Student sign-in', /\/app\/student$/)
  await page.goto(`/app/tests/${testId}/lobby`)
  await page.getByRole('button', { name: /Start exam|Resume exam/ }).click()
  await page.getByRole('button', { name: 'Enter fullscreen' }).click()
  await expect(page.locator('.monaco-editor .view-lines').first()).toContainText('print(a', { timeout: 120_000 })

  // Correct output from the code runner: 2 + 3 = 5. (An outside service, so soft.)
  await page.getByRole('checkbox', { name: 'Use my own input' }).check()
  await page.getByLabel(/Your input/).fill('2 3')
  await timed('Run code (outside code runner)', BUDGET.run, async () => {
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await expect.soft(page.getByText(/^5$/).first()).toBeVisible({ timeout: 60_000 })
  })

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.getByRole('button', { name: 'Return to exam' }).click()
  await expect(page.getByText(/1 violation/).first()).toBeVisible()
  await page.waitForTimeout(2500)

  await page.getByRole('button', { name: 'Submit exam' }).first().click()
  await timed('Student submits the exam', BUDGET.submit, async () => {
    await page.getByRole('dialog').getByRole('button', { name: 'Submit exam' }).click()
    await expect(page.getByRole('button', { name: 'Submitted' })).toBeDisabled({ timeout: 60_000 })
  })

  // Correct output: a submitted exam cannot be reopened or submitted again.
  await page.goto(`/app/tests/${testId}/exam`)
  await expect(page.getByText(/already submitted/i).first()).toBeVisible()
  const second = await page.evaluate(async (id) => {
    const token = localStorage.getItem('trityanetra:token')
    const res = await fetch('/api/submissions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ testId: id, answers: { language: 'python', code: 'print(1)' } }),
    })
    return res.status
  }, testId)
  expect(second).toBe(403)
})

test('S5. Dev submits a completely different program', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, DEV.email, 'Student sign-in', /\/app\/student$/)
  await page.goto(`/app/tests/${testId}/lobby`)
  await page.getByRole('button', { name: /Start exam|Resume exam/ }).click()
  await page.getByRole('button', { name: 'Enter fullscreen' }).click()
  await typeCode(page, 'print(sum(map(int, open(0).read().split())))')
  await page.getByRole('button', { name: 'Submit exam' }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Submit exam' }).click()
  await expect(page.getByRole('button', { name: 'Submitted' })).toBeDisabled({ timeout: 60_000 })
})

test('S6. marks stay hidden until the teacher releases them', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, TARA.email, 'Student sign-in', /\/app\/student$/)
  await page.goto(`/app/tests/${testId}/result`)
  await expect(page.getByText('Your teacher has not released marks yet.')).toBeVisible()
})

test('S7. the time limit is enforced by the server, not just the screen', async ({ browser }) => {
  test.setTimeout(6 * 60_000)
  const page = await newPage(browser)
  await signIn(page, TARA.email, 'Student sign-in', /\/app\/student$/)
  await page.goto(`/app/tests/${shortTestId}/lobby`)
  await page.getByRole('button', { name: /Start exam|Resume exam/ }).click()
  await page.waitForURL(/\/exam$/)
  // One minute allowed plus the 30 s grace, then a little more.
  await page.waitForTimeout(100_000)
  const late = await page.evaluate(async (id) => {
    const token = localStorage.getItem('trityanetra:token')
    const res = await fetch('/api/submissions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ testId: id, answers: { language: 'python', code: 'print(1)' } }),
    })
    return { status: res.status, body: await res.text() }
  }, shortTestId)
  expect(late.status).toBe(403)
  expect(late.body).toMatch(/time for this test is over/i)
})

/* ======================================================================== */
/*  TEACHER: review                                                         */
/* ======================================================================== */

test('T5. teacher reviews: correct states, the integrity flag, a correct plagiarism verdict', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, TEACHER, 'Teacher sign-in', /\/app\/dashboard$/)
  await timed('Teacher opens the test review page', BUDGET.page, async () => {
    await page.goto(`${classroomUrl}/tests/${testId}`)
    await expect(page.getByRole('tab', { name: 'Integrity' })).toBeVisible()
  })

  await page.getByRole('tab', { name: 'Integrity' }).click()
  await expect(page.getByRole('tabpanel')).toContainText(TARA.name)

  // Two DIFFERENT programs: the check must not call them high-risk copies.
  await page.getByRole('tab', { name: 'Plagiarism' }).click()
  await timed('Plagiarism check (queue + AST engine)', BUDGET.plagiarism, async () => {
    await page.getByRole('button', { name: /Run check|Run again/ }).click()
    await expect(page.getByRole('tabpanel')).toContainText('Pairs compared', { timeout: 180_000 })
  })
  await expect(page.getByRole('tabpanel')).not.toContainText(/\bHigh\b/)

  await page.getByRole('link', { name: 'View submissions' }).click()
  await expect(page.getByText(TARA.name).first()).toBeVisible()
  await expect(page.getByText(DEV.name).first()).toBeVisible()
})

test('T6. teacher grades, releases, and grading locks', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, TEACHER, 'Teacher sign-in', /\/app\/dashboard$/)
  await page.goto(`${classroomUrl}/tests/${testId}/submissions`)
  await page.getByRole('link', { name: `Grade ${TARA.name}` }).click()
  await page.getByLabel(/Marks out of/).fill('7')
  await page.getByLabel('Comment for the student').fill('Correct; handle negative numbers too.')
  await timed('Teacher saves a grade', BUDGET.action, async () => {
    await page.getByRole('button', { name: 'Save grades' }).click()
    await expect(page.getByText('Grades saved').first()).toBeVisible()
  })

  await page.getByRole('link', { name: 'Back to submissions' }).click()
  await expect(page.getByText('7/10').first()).toBeVisible()
  await page.getByRole('button', { name: 'Release results' }).click()
  await timed('Teacher releases results', BUDGET.action, async () => {
    await page.getByRole('dialog').getByRole('button', { name: 'Release results' }).click()
    await expect(page.locator('#main-content').getByText('Results released')).toBeVisible()
  })
  await page.getByRole('link', { name: `Grade ${TARA.name}` }).click()
  await expect(page.getByLabel(/Marks out of/)).toBeDisabled()
})

test('S8. the student sees the released marks and comment', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, TARA.email, 'Student sign-in', /\/app\/student$/)
  await timed('Student opens the released result', BUDGET.page, async () => {
    await page.goto(`/app/tests/${testId}/result`)
    await expect(page.getByText('Correct; handle negative numbers too.')).toBeVisible()
  })
  await expect(page.getByText('/ 10').first()).toBeVisible()
  await expect(page.getByText('7', { exact: true }).first()).toBeVisible()
})

/* ======================================================================== */
/*  ADMIN                                                                   */
/* ======================================================================== */

test('A1. root admin sees every college and can add one', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, ROOT_ADMIN, 'Root admin sign-in', /\/app\/dashboard$/)
  await timed('Admin opens Colleges', BUDGET.page, async () => {
    await page.getByRole('link', { name: 'Colleges' }).first().click()
    await expect(page.getByText('@vit.ac.in')).toBeVisible()
  })
  await expect(page.getByText('@mit.ac.in')).toBeVisible()

  await page.getByRole('button', { name: 'Add college' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('College name').fill('Pune Institute of Computer Technology')
  await dialog.getByLabel('Short code').fill('PICT')
  await dialog.getByLabel('Email domain (optional)').fill('pict.edu')
  await timed('Admin adds a college', BUDGET.action, async () => {
    await dialog.getByRole('button', { name: 'Add college' }).click()
    await expect(page.getByText('@pict.edu')).toBeVisible({ timeout: 30_000 })
  })
})

test('A2. root admin finds people across colleges and makes a student a teacher', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, ROOT_ADMIN, 'Root admin sign-in', /\/app\/dashboard$/)
  await page.getByRole('link', { name: 'People' }).first().click()
  await expect(page.getByText(VIT_STUDENT)).toBeVisible()
  await expect(page.getByRole('button', { name: /Change role for Root Admin/ })).toBeDisabled()

  await page.getByLabel('Find by email').fill(DEV.email)
  await timed('Admin searches a person by email', BUDGET.action, async () => {
    await page.getByRole('button', { name: 'Search' }).click()
    await expect(page.getByText(VIT_STUDENT)).toHaveCount(0)
  })
  await page.getByRole('button', { name: `Change role for ${DEV.name}` }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('combobox', { name: 'Role' }).click()
  await page.getByRole('option', { name: 'Teacher' }).click()
  await timed('Admin changes a role', BUDGET.action, async () => {
    await dialog.getByRole('button', { name: 'Save role' }).click()
    await expect(page.getByText('Role updated').first()).toBeVisible()
  })

  // Correct output: Dev signs in as a teacher next time.
  const devPage = await newPage(browser)
  await signIn(devPage, DEV.email, 'Promoted user sign-in', /\/app\/dashboard$/)
  await expect(devPage.getByRole('link', { name: 'Classrooms' }).first()).toBeVisible()
})

test('A3. a college admin sees only their own college and cannot create colleges or admins', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, COLLEGE_ADMIN, 'College admin sign-in', /\/app\/dashboard$/)
  await page.getByRole('link', { name: 'People' }).first().click()
  await expect(page.getByText(TARA.email)).toBeVisible()
  await expect(page.getByText(VIT_STUDENT)).toHaveCount(0)

  await page.getByRole('button', { name: `Change role for ${TARA.name}` }).click()
  await page.getByRole('dialog').getByRole('combobox', { name: 'Role' }).click()
  await expect(page.getByRole('option', { name: 'Teacher' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Administrator' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  await page.getByRole('link', { name: 'Colleges' }).first().click()
  await expect(page.getByText('@mit.ac.in')).toBeVisible()
  await expect(page.getByText('@vit.ac.in')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add college' })).toHaveCount(0)
})
