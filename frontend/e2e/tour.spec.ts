import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, type Page, type Route } from '@playwright/test'

import {
  SEEDED_CLASSROOM_ID,
  SEEDED_LIVE_TEST_ID,
  SEEDED_RESULT_TEST_ID,
  SEEDED_REVIEW_TEST_ID,
  SEEDED_UPCOMING_TEST_ID,
  stubTestBackend,
} from './testBackend'

/**
 * A screen-by-screen tour for design review: walks every page a student and a
 * teacher can reach (plus dialogs, tabs and states) and saves one picture each,
 * in order, with a caption. Nothing is asserted; a step that cannot be reached
 * is recorded as skipped and the tour carries on.
 *
 * Skipped unless TOUR is set:
 *   TOUR=1 PW_CHANNEL=msedge npx playwright test e2e/tour.spec.ts --project=chromium
 *
 * Output: test-results/tour/*.jpg and manifest.json.
 */

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-results', 'tour')
const PASSWORD = 'Phase1-Secret-42'
const DESKTOP = { width: 1440, height: 900 }
const MOBILE = { width: 390, height: 844 }

const STUDENT = { email: 'riya.student@mit.ac.in', name: 'Riya Sharma', role: 'STUDENT' as const }
const TEACHER = { email: 'aditya.teacher@mit.ac.in', name: 'Aditya Rao', role: 'TEACHER' as const }
type Account = typeof STUDENT | typeof TEACHER

interface Entry {
  file: string | null
  group: string
  title: string
  note?: string
}

test.skip(!process.env.TOUR, 'Set TOUR=1 to run the screen tour.')
test.describe.configure({ mode: 'serial' })

async function stubAuth(page: Page, account: Account): Promise<void> {
  const profile = {
    uid: `uid-${account.email}`,
    email: account.email,
    displayName: account.name,
    role: account.role,
    collegeId: 'college-mit',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
  const signedIn = (route: Route) => (route.request().headers().authorization ?? '').startsWith('Bearer ')
  await page.route('**/api/auth/me', (route) =>
    signedIn(route)
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: profile }) })
      : route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
  )
  await page.route('**/api/auth/session', (route) =>
    signedIn(route)
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: profile }) })
      : route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
  )
  await page.route('**/api/auth/logout', (route) => route.fulfill({ status: 204, body: '' }))
}

async function seedAccount(page: Page, account: Account): Promise<void> {
  await page.addInitScript(
    ([email, name, password]) => {
      window.localStorage.setItem(
        'e2e.auth.accounts',
        JSON.stringify([{ uid: `uid-${email}`, email, password, displayName: name }]),
      )
    },
    [account.email, account.name, PASSWORD] as const,
  )
}

/** Collects pictures in order; each step is soft so one miss never ends the tour. */
function tour(page: Page, prefix: string) {
  const entries: Entry[] = []
  // Each click or wait gives up after 2 minutes, so one unreachable step is skipped
  // instead of stalling the whole tour.
  page.setDefaultTimeout(120_000)
  let n = 0
  let group = ''

  const settle = async () => {
    // Wait out the app's own loading screens before taking the picture.
    await page
      .waitForFunction(
        () => !document.body.innerText.includes('Preparing your classroom') && !document.querySelector('[aria-busy="true"]'),
        null,
        { timeout: 120_000 },
      )
      .catch(() => {})
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(900) // let entrance animations finish
  }

  return {
    entries,
    section(name: string) {
      group = name
    },
    async shot(title: string, action?: () => Promise<void>, note?: string) {
      n += 1
      const file = `${prefix}-${String(n).padStart(2, '0')}.jpg`
      try {
        if (action) await action()
        await settle()
        await page.screenshot({ path: path.join(OUT_DIR, file), type: 'jpeg', quality: 82, fullPage: true })
        entries.push({ file, group, title, note })
      } catch (error) {
        const reason = error instanceof Error ? error.message.split('\n')[0] : String(error)
        entries.push({ file: null, group, title, note: `Skipped: ${reason}` })
      }
    },
  }
}

async function signIn(page: Page, account: Account): Promise<void> {
  await goto(page, '/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/app\//, { timeout: 30_000 })
}


/**
 * Navigates inside the running app (like clicking a link) once it is loaded, so
 * each screen does not re-download the whole app. Only the first visit is a real
 * page load.
 */
async function goto(page: Page, url: string): Promise<void> {
  if (page.url().startsWith('http')) {
    await page.evaluate((target) => {
      window.history.pushState({}, '', target)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, url)
  } else {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
  }
}

test.beforeAll(() => mkdirSync(OUT_DIR, { recursive: true }))
// One list per section, written as soon as that section ends, so an interrupted
// run keeps what it already captured.
const save = (prefix: string, entries: Entry[]) =>
  writeFileSync(path.join(OUT_DIR, `manifest-${prefix}.json`), JSON.stringify(entries, null, 2))

test('signed-out screens', async ({ page }) => {
  test.setTimeout(0)
  await page.setViewportSize(DESKTOP)
  await stubTestBackend(page)
  await stubAuth(page, STUDENT)
  const t = tour(page, 'a')

  t.section('Before signing in')
  await t.shot('Landing page', () => goto(page, '/').then(() => undefined))
  await t.shot('Sign in', () => goto(page, '/login').then(() => undefined))
  await t.shot('Sign in: empty form submitted', () => page.getByRole('button', { name: 'Sign in' }).click())
  await t.shot('Sign in: wrong password', async () => {
    await goto(page, '/login')
    await page.getByLabel('Email').fill('nobody@mit.ac.in')
    await page.getByLabel('Password', { exact: true }).fill('wrong-password-1')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForTimeout(1500)
  })
  await t.shot('Create account', () => goto(page, '/register').then(() => undefined))
  await t.shot('Create account: empty form submitted', () =>
    page.getByRole('button', { name: 'Create account' }).click(),
  )
  await t.shot('Page not found', () => goto(page, '/this-page-does-not-exist').then(() => undefined))
  await t.shot('Sign in (phone)', async () => {
    await page.setViewportSize(MOBILE)
    await goto(page, '/login')
  })
  save('a', t.entries)
})

test('student screens', async ({ page, context }) => {
  test.setTimeout(0)
  await context.grantPermissions([])
  await page.setViewportSize(DESKTOP)
  await stubTestBackend(page)
  await stubAuth(page, STUDENT)
  await seedAccount(page, STUDENT)
  const t = tour(page, 'b')
  const live = `/app/tests/${SEEDED_LIVE_TEST_ID}`

  t.section('Student')
  await t.shot('Student home: my classrooms and tests', () => signIn(page, STUDENT))
  await t.shot('Lobby: a test that has not opened yet', () =>
    goto(page, `/app/tests/${SEEDED_UPCOMING_TEST_ID}/lobby`).then(() => undefined),
  )
  await t.shot('Lobby: a test that is open now', () => goto(page, `${live}/lobby`).then(() => undefined))
  await t.shot('Exam: asks for fullscreen first', async () => {
    await page.getByRole('button', { name: /Start exam|Resume exam/ }).click()
    await page.waitForURL(/\/exam$/)
  })
  await t.shot('Exam: question and code editor', async () => {
    await page.getByRole('button', { name: 'Enter fullscreen' }).click()
    await page.waitForTimeout(1500)
  })
  await t.shot('Exam: typing an answer', async () => {
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.type('def solve(nums):\n    return sorted(nums)\n')
  })
  await t.shot('Exam: output panel opened', () =>
    page.getByRole('button', { name: /^Output/ }).click(),
  )
  await t.shot(
    'Exam: Run pressed (sample test cases)',
    () => page.getByRole('button', { name: 'Run', exact: true }).click(),
    'This is the message students see while Judge0 is not connected.',
  )
  await t.shot(
    'Exam: warning after leaving the tab',
    async () => {
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
        document.dispatchEvent(new Event('visibilitychange'))
      })
    },
    'Simulated tab switch. The flag goes to the teacher’s Integrity tab.',
  )
  await t.shot('Exam: confirm submit', async () => {
    // Dismiss the tab-switch warning first if it is still open.
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Submit exam' }).first().click()
  })
  await t.shot('Exam: submitted', async () => {
    await page.getByRole('dialog').getByRole('button', { name: 'Submit exam' }).click()
    await page.waitForTimeout(1500)
  })
  await t.shot('Lobby after submitting', () => goto(page, `${live}/lobby`).then(() => undefined))
  await t.shot('Reopening a submitted exam', () => goto(page, `${live}/exam`).then(() => undefined))
  await t.shot('Result: marks not released yet', () =>
    goto(page, `/app/tests/${SEEDED_REVIEW_TEST_ID}/result`).then(() => undefined),
  )
  await t.shot('Result: marks released', () =>
    goto(page, `/app/tests/${SEEDED_RESULT_TEST_ID}/result`).then(() => undefined),
  )
  await t.shot(
    'Student tries a teacher page',
    () => goto(page, '/app/classrooms').then(() => undefined),
    'Sent back to their own home.',
  )
  await t.shot('Account menu', async () => {
    await goto(page, '/app/student')
    await page.getByRole('button', { name: new RegExp(STUDENT.name.split(' ')[0]) }).first().click()
  })
  await t.shot('Student home in light theme', async () => {
    await page.keyboard.press('Escape')
    await page.evaluate(() => window.localStorage.setItem('trityanetra:theme', 'light'))
    await page.reload()
  })
  await t.shot('Student home (phone)', async () => {
    await page.evaluate(() => window.localStorage.setItem('trityanetra:theme', 'dark'))
    await page.setViewportSize(MOBILE)
    await page.reload()
  })
  save('b', t.entries)
})

test('teacher screens', async ({ page }) => {
  test.setTimeout(0)
  await page.setViewportSize(DESKTOP)
  await stubTestBackend(page)
  await stubAuth(page, TEACHER)
  await seedAccount(page, TEACHER)
  const t = tour(page, 'c')
  const classroom = `/app/classrooms/${SEEDED_CLASSROOM_ID}`
  const review = `${classroom}/tests/${SEEDED_REVIEW_TEST_ID}`

  t.section('Teacher')
  await t.shot('Teacher dashboard', () => signIn(page, TEACHER))
  await t.shot('Classrooms', () => goto(page, '/app/classrooms').then(() => undefined))
  await t.shot('New classroom form', () => page.getByRole('button', { name: 'New classroom' }).first().click())
  await t.shot('Classroom: roster and tests', async () => {
    await page.keyboard.press('Escape')
    await goto(page, classroom)
  })
  await t.shot('Add students by email', () => page.getByRole('button', { name: 'Add students' }).first().click())
  await t.shot(
    'Add students: result',
    async () => {
      const dialog = page.getByRole('dialog')
      await dialog.locator('textarea').fill('meera.student@mit.ac.in\nnew.person@mit.ac.in\nsomeone@gmail.com')
      await dialog.getByRole('button', { name: 'Add to classroom' }).click()
      await page.waitForTimeout(1500)
    },
    'One already enrolled, one invited (not registered yet), one rejected (other college).',
  )
  await t.shot('Classroom after adding', async () => {
    await page.keyboard.press('Escape')
    await page.reload()
  })
  await t.shot('New test form', () => goto(page, `${classroom}/tests/new`).then(() => undefined))
  await t.shot('New test: errors when empty', () => page.getByRole('button', { name: 'Create test' }).first().click())
  await t.shot('New test: student preview', () => page.getByRole('button', { name: 'Preview' }).first().click())
  await t.shot('Test page: upcoming test', () =>
    goto(page, `${classroom}/tests/${SEEDED_UPCOMING_TEST_ID}`).then(() => undefined),
  )
  await t.shot('Test page: questions', () => goto(page, review).then(() => undefined))
  await t.shot('Test page: integrity flags', () => page.getByRole('tab', { name: 'Integrity' }).click())
  await t.shot('Test page: plagiarism (before a check)', () => page.getByRole('tab', { name: 'Plagiarism' }).click())
  await t.shot('Test page: plagiarism results', async () => {
    await page.getByRole('button', { name: /Run check|Run again/ }).click()
    await page.waitForTimeout(4000)
  })
  await t.shot('Plagiarism: code side by side', () =>
    page.getByRole('button', { name: 'Compare code side by side' }).first().click(),
  )
  await t.shot('Submissions list', async () => {
    await page.keyboard.press('Escape')
    await goto(page, `${review}/submissions`)
  })
  await t.shot('Grading a student', () =>
    page.getByRole('link', { name: /^Grade / }).first().click(),
  )
  await t.shot('Grading: saved', async () => {
    await page.getByLabel(/Marks out of/).fill('7')
    await page.getByLabel('Comment for the student').fill('Good approach; misses the empty-list case.')
    await page.getByRole('button', { name: 'Save grades' }).click()
    await page.waitForTimeout(1200)
  })
  await t.shot('Release results: confirm', async () => {
    await goto(page, `${review}/submissions`)
    await page.getByRole('button', { name: 'Release results' }).click()
  })
  await t.shot('Results released', async () => {
    await page.getByRole('dialog').getByRole('button', { name: 'Release results' }).click()
    await page.waitForTimeout(1500)
  })
  await t.shot('Grading locked after release', () =>
    page.getByRole('link', { name: /^Grade / }).first().click(),
  )
  await t.shot('Live test (teacher view, read-only)', () =>
    goto(page, `${classroom}/tests/${SEEDED_LIVE_TEST_ID}`).then(() => undefined),
  )
  await t.shot('Teacher dashboard in light theme', async () => {
    await page.evaluate(() => window.localStorage.setItem('trityanetra:theme', 'light'))
    await goto(page, '/app/dashboard')
  })
  await t.shot('Teacher dashboard (phone)', async () => {
    await page.evaluate(() => window.localStorage.setItem('trityanetra:theme', 'dark'))
    await page.setViewportSize(MOBILE)
    await page.reload()
  })
  await t.shot('Phone navigation menu', () =>
    page.getByRole('button', { name: /menu|navigation/i }).first().click(),
  )
  save('c', t.entries)
})
