import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Browser, type Page } from '@playwright/test'

/**
 * FULL-STACK integration test: one exam from start to finish against the REAL
 * backend, Firestore emulator, Redis queue and AST engine. Nothing is stubbed.
 * Run with `npm run test:fullstack` (playwright.fullstack.config.ts starts the
 * servers; e2e/fullstack.setup.ts seeds one college, an admin, a teacher and
 * three students).
 *
 * The steps share state (the classroom and test they create), so they run in
 * order and stop at the first failure.
 */
test.describe.configure({ mode: 'serial' })

const PASSWORD = 'Fullstack-Pass-42'
const TEACHER = { email: 'aditya@mit.ac.in', name: 'Aditya Rao' }
const RIYA = { email: 'riya@mit.ac.in', name: 'Riya Sharma' }
const KABIR = { email: 'kabir@mit.ac.in', name: 'Kabir Mehta' }
const OUTSIDER = { email: 'sam@mit.ac.in', name: 'Sam Outsider' }
const ADMIN = { email: 'admin@trityanetra.local', name: 'Root Admin' }
const NEW_STUDENT = { email: 'meera@mit.ac.in', name: 'Meera Nair', password: 'Meera-Pass-2026' }

const CLASSROOM = 'Fullstack Lab'
const TEST_TITLE = 'Experiment 1: Add two numbers'
const BACKEND_LOG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fullstack-backend.log')

let testId = ''

/** The value a `datetime-local` field takes for a moment, in IST (UTC+5:30) as the app expects. */
function istInput(msFromNow: number): string {
  return new Date(Date.now() + msFromNow + 330 * 60_000).toISOString().slice(0, 16)
}

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext()
  return context.newPage()
}

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/app\//, { timeout: 60_000 })
}

/** Types into Monaco. Lines start at column 0, so auto-indent cannot change the program. */
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

async function enterExam(page: Page) {
  await page.goto(`/app/tests/${testId}/lobby`)
  await page.getByRole('button', { name: /Start exam|Resume exam/ }).click()
  await page.waitForURL(/\/exam$/)
  await page.getByRole('button', { name: 'Enter fullscreen' }).click()
}

/** A real visibility change, as when a student switches tabs; the warning is then dismissed. */
async function leaveTabOnce(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.getByRole('button', { name: 'Return to exam' }).click()
  // The monitor spaces flags 2 s apart for the server's rate limit.
  await page.waitForTimeout(2500)
}

async function submitExam(page: Page) {
  await page.getByRole('button', { name: 'Submit exam' }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Submit exam' }).click()
  await expect(page.getByRole('button', { name: 'Submitted' })).toBeDisabled({ timeout: 60_000 })
}

/** Opens the classroom card by name on the teacher's classroom list. */
async function openClassroom(page: Page) {
  await page.goto('/app/classrooms')
  await page.getByRole('listitem').filter({ hasText: CLASSROOM }).getByRole('link').first().click()
  await page.waitForURL(/\/app\/classrooms\/[^/]+$/)
}

test('1. a new student registers, verifies the email and signs in', async ({ browser }) => {
  const page = await newPage(browser)
  await page.goto('/register')
  await page.getByLabel('Full name').fill(NEW_STUDENT.name)
  await page.getByLabel('College email').fill(NEW_STUDENT.email)
  await page.getByLabel('Password', { exact: true }).fill(NEW_STUDENT.password)
  await page.getByRole('checkbox', { name: 'Accept the classroom code of conduct' }).click()
  await page.getByRole('button', { name: 'Create account' }).click()
  // The first request warms up the emulator, which can take half a minute on a slow machine.
  await expect(page.getByText('Check your email')).toBeVisible({ timeout: 120_000 })

  // Signing in before verifying is refused, with a resend option.
  await page.goto('/login')
  await page.getByLabel('Email').fill(NEW_STUDENT.email)
  await page.getByLabel('Password', { exact: true }).fill(NEW_STUDENT.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toContainText(/verify your email first/i)
  await expect(page.getByRole('button', { name: 'Resend verification email' })).toBeVisible()

  // Without SMTP the backend prints the link; open it as the email would.
  let link = ''
  await expect
    .poll(() => {
      const match = readFileSync(BACKEND_LOG, 'utf8').match(/verify-email\?token=([A-Za-z0-9_-]+)/)
      link = match ? `/verify-email?token=${match[1]}` : ''
      return link
    })
    .not.toBe('')
  await page.goto(link)
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible()

  await signIn(page, NEW_STUDENT.email, NEW_STUDENT.password)
  await expect(page).toHaveURL(/\/app\/student$/)
})

test('2. the teacher creates a classroom, adds students by email and sets a test', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, TEACHER.email)
  await expect(page).toHaveURL(/\/app\/dashboard$/)

  await page.goto('/app/classrooms')
  await page.getByRole('button', { name: 'New classroom' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Classroom name').fill(CLASSROOM)
  await dialog.getByLabel('Subject or course code').fill('CS101')
  await dialog.getByRole('button', { name: /create/i }).click()
  await expect(dialog).toBeHidden()
  await openClassroom(page)

  await page.getByLabel('Student emails').fill(`${RIYA.email}\n${KABIR.email}\n${NEW_STUDENT.email}`)
  await page.getByRole('button', { name: 'Add to classroom' }).click()
  await expect(page.getByText(RIYA.email)).toBeVisible()
  await expect(page.getByText(KABIR.email)).toBeVisible()
  await expect(page.getByText(NEW_STUDENT.email)).toBeVisible()

  await page.getByRole('link', { name: /New test/ }).or(page.getByRole('button', { name: /New test/ })).first().click()
  await page.getByLabel('Title').fill(TEST_TITLE)
  await page.getByRole('combobox', { name: 'Language' }).click()
  await page.getByRole('option', { name: 'Python' }).click()
  await page.getByLabel('Opens').fill(istInput(-2 * 60_000))
  await page.getByLabel('Closes').fill(istInput(90 * 60_000))
  await page.getByLabel('Time allowed (minutes)').fill('30')
  await page.getByLabel('Question 1 prompt').fill('Read two integers a and b on one line and print a + b.')
  await page.getByRole('button', { name: 'Create test' }).click()
  await page.waitForURL(/\/tests\/[^/]+$/, { timeout: 60_000 })
  testId = decodeURIComponent(page.url().split('/tests/')[1])
  expect(testId).not.toBe('')
})

test('3. a student in the same college who was not added cannot see or open the test', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, OUTSIDER.email)
  await expect(page.getByText(TEST_TITLE)).toHaveCount(0)
  // Going straight to the address is refused by the server, not just hidden.
  const status = await page.evaluate(async (id) => {
    const token = localStorage.getItem('trityanetra:token')
    const res = await fetch(`/api/tests/${id}/lobby`, { headers: { Authorization: `Bearer ${token}` } })
    return res.status
  }, testId)
  expect(status).toBe(403)
})

test('4. Riya sits the exam, runs her code, leaves the tab once and submits', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, RIYA.email)
  await expect(page.getByText(TEST_TITLE).first()).toBeVisible()

  await enterExam(page)
  await typeCode(page, 'a, b = map(int, input().split())\nprint(a + b)')

  // Run through the backend's code runner (Paiza by default here). It is an
  // outside service, so a failure is reported but does not stop the run.
  await page.getByRole('checkbox', { name: 'Use my own input' }).check()
  await page.getByLabel(/Your input/).fill('2 3')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect.soft(page.getByText(/^5$/).first(), 'code runner returned 5').toBeVisible({ timeout: 60_000 })

  await leaveTabOnce(page)
  await submitExam(page)
})

test('5. Kabir submits nearly the same program', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, KABIR.email)
  await enterExam(page)
  await typeCode(page, 'x, y = map(int, input().split())\nprint(x + y)')
  await submitExam(page)
})

test('6. the teacher sees the flag, runs plagiarism, grades and releases', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, TEACHER.email)
  await openClassroom(page)
  await page.getByRole('link', { name: 'Review' }).first().click()
  await page.waitForURL(/\/tests\/[^/]+$/)

  await page.getByRole('tab', { name: 'Integrity' }).click()
  await expect(page.getByRole('tabpanel')).toContainText(RIYA.name)

  // The real pipeline: queue in Redis -> worker -> AST engine -> stored result.
  await page.getByRole('tab', { name: 'Plagiarism' }).click()
  await page.getByRole('button', { name: /Run check|Run again/ }).click()
  await expect(page.getByRole('tabpanel')).toContainText(/Riya Sharma\s*↔\s*Kabir Mehta|Kabir Mehta\s*↔\s*Riya Sharma/, {
    timeout: 180_000,
  })

  await page.getByRole('link', { name: 'View submissions' }).click()
  await page.getByRole('link', { name: `Grade ${RIYA.name}` }).click()
  await page.getByLabel(/Marks out of/).fill('8')
  await page.getByLabel('Comment for the student').fill('Correct and clear.')
  await page.getByRole('button', { name: 'Save grades' }).click()
  await expect(page.getByText('Grades saved').first()).toBeVisible()

  await page.getByRole('link', { name: 'Back to submissions' }).click()
  await page.getByRole('button', { name: 'Release results' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Release results' }).click()
  await expect(page.locator('#main-content').getByText('Results released')).toBeVisible()
})

test('7. Riya sees her released marks', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, RIYA.email)
  await page.goto(`/app/tests/${testId}/result`)
  await expect(page.getByText(/\b8\s*\/\s*10\b|8 out of 10/).first()).toBeVisible()
  await expect(page.getByText('Correct and clear.')).toBeVisible()
})

test('8. the admin makes the new student a teacher', async ({ browser }) => {
  const page = await newPage(browser)
  await signIn(page, ADMIN.email)
  await page.getByRole('link', { name: 'People' }).first().click()
  await page.getByLabel('Find by email').fill(NEW_STUDENT.email)
  await page.getByRole('button', { name: 'Search' }).click()
  await page.getByRole('button', { name: `Change role for ${NEW_STUDENT.name}` }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('combobox', { name: 'Role' }).click()
  await page.getByRole('option', { name: 'Teacher' }).click()
  await dialog.getByRole('button', { name: 'Save role' }).click()
  await expect(page.getByText('Role updated').first()).toBeVisible()

  // The new role applies at the next sign-in.
  const teacherPage = await newPage(browser)
  await signIn(teacherPage, NEW_STUDENT.email, NEW_STUDENT.password)
  await expect(teacherPage).toHaveURL(/\/app\/dashboard$/)
})
