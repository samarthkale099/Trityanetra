import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page, type Route } from '@playwright/test'

import {
  stubTestBackend,
  SEEDED_CLASSROOM_ID,
  SEEDED_RESULT_TEST_ID,
  SEEDED_REVIEW_TEST_ID,
} from './testBackend'

/**
 * Screenshots of the signed-in shell: both roles, desktop and mobile, light and
 * dark.
 *
 * A capture harness, not a behavior suite. The shell's defects were things you
 * have to *look* at -- a rail that stopped halfway down the page, labels clipped
 * to "Clas...", a student's page carrying a teacher-only rail and an "Integrity /
 * coming soon" row. Those are already covered by unit assertions; these images
 * exist so the layout can be reviewed as an artifact instead of taken on trust.
 *
 * Output goes to `test-results/ui-shots/`. Playwright empties `test-results` when
 * a run starts and these are written during the run, so they survive the run that
 * produced them.
 *
 * Chromium only, deliberately: every viewport is chosen per shot, so running the
 * same captures under the `mobile` project would write each file twice.
 */

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-results', 'ui-shots')
const THEME_KEY = 'trityanetra:theme'
const PASSWORD = 'Phase1-Secret-42'

const STUDENT = {
  email: 'riya.student@mit.ac.in',
  name: 'Riya Sharma',
  role: 'STUDENT' as const,
}

const TEACHER = {
  email: 'aditya.teacher@mit.ac.in',
  name: 'Aditya Rao',
  role: 'TEACHER' as const,
}

type Account = typeof STUDENT | typeof TEACHER

/**
 * Serves the auth endpoints in `testBackend`'s style: identity comes from the
 * bearer token, and the role it reports is what decides the layout.
 *
 * Registered *after* `stubTestBackend` on purpose -- newest-handler-wins, and the
 * backend's catch-all would otherwise answer the session exchange with a 501 and
 * silently degrade every role to STUDENT.
 */
async function stubAuth(page: Page, account: Account): Promise<void> {
  const profile = {
    uid: `uid-${account.email}`,
    email: account.email,
    displayName: account.name,
    role: account.role,
    collegeId: account.role === 'STUDENT' ? null : 'college-mit',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  const profileFor = (route: Route) => {
    const header = route.request().headers().authorization ?? ''
    const email = header.startsWith('Bearer ') ? header.slice('Bearer '.length).split('|')[2] : null
    return email ? { ...profile, email } : null
  }
  const unauthorized = (route: Route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })

  // The session exchange unwraps `{ user }`; `GET /me` returns the profile bare.
  await page.route('**/api/auth/session', (route) => {
    const user = profileFor(route)
    if (!user) return unauthorized(route)
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user }),
    })
  })
  await page.route('**/api/auth/me', (route) => {
    const user = profileFor(route)
    if (!user) return unauthorized(route)
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) })
  })
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

interface Shot {
  readonly label: string
  readonly width: number
  readonly height: number
  readonly theme: 'light' | 'dark'
}

/**
 * Desktop is tall (1000px) and the pages are short, so the strip beside the rail
 * is mostly empty -- which is exactly where the old rail ran out of height.
 */
const SHOTS: readonly Shot[] = [
  { label: 'desktop-light', width: 1440, height: 1000, theme: 'light' },
  { label: 'desktop-dark', width: 1440, height: 1000, theme: 'dark' },
  { label: 'mobile-light', width: 390, height: 844, theme: 'light' },
  { label: 'mobile-dark', width: 390, height: 844, theme: 'dark' },
]

async function capture(page: Page, account: Account, pathname: string): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true })

  // Only seed a theme if nothing is stored, so the later `evaluate` writes that
  // pick dark survive this script re-running on each reload.
  await page.addInitScript(([key]) => {
    if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, 'light')
  }, [THEME_KEY] as const)

  await stubTestBackend(page)
  await stubAuth(page, account)
  await seedAccount(page, account)

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(new RegExp(`${pathname}$`))

  for (const shot of SHOTS) {
    await page.setViewportSize({ width: shot.width, height: shot.height })
    await page.evaluate(
      ([key, theme]) => window.localStorage.setItem(key, theme),
      [THEME_KEY, shot.theme] as const,
    )
    await page.reload()

    // The shell first paints on a placeholder STUDENT profile, so wait for a
    // landmark only the final layout has rather than screenshotting the flap.
    // CSS selectors, not role queries: the top bar is `display:none` below `md`,
    // and a role query skips hidden elements, which would fail the mobile shots.
    if (account.role === 'TEACHER') {
      await expect(page.locator('aside')).toBeAttached()
    } else {
      await expect(page.locator('nav[aria-label="Primary"]')).toBeAttached()
    }
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible()
    // The page itself, not just the shell: the lazy route's splash and any
    // fetch skeleton must be gone, or the shot shows chrome around a loader.
    await expect(page.getByText(/Preparing your classroom/)).toHaveCount(0, { timeout: 30_000 })
    await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 })

    await page.screenshot({
      path: path.join(OUT_DIR, `${account.role.toLowerCase()}-${shot.label}.png`),
      animations: 'disabled',
    })
  }
}

/**
 * The review pages get the same treat. The grading table and the locked detail
 * panel are the part of the teacher area *students* have never seen, and layout
 * mistakes there (a clipped marks column, a cell that wraps to three lines)
 * are only legible from a screenshot.
 *
 * Navigation is a full `page.goto` per shot so each shot gets one clean paint,
 * and theme is written before navigating so the reload-free route already uses
 * it.
 */
async function captureReview(
  page: Page,
  pathname: string,
  readyHeading: RegExp,
  options: { fullPage?: boolean; editorText?: string } = {},
): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true })

  await page.addInitScript(([key]) => {
    if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, 'light')
  }, [THEME_KEY] as const)

  await stubTestBackend(page)
  await stubAuth(page, TEACHER)
  await seedAccount(page, TEACHER)

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/login')
  await page.getByLabel('Email').fill(TEACHER.email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/app\/dashboard$/)

  for (const shot of SHOTS) {
    await page.setViewportSize({ width: shot.width, height: shot.height })
    await page.evaluate(
      ([key, theme]) => window.localStorage.setItem(key, theme),
      [THEME_KEY, shot.theme] as const,
    )
    await page.goto(pathname)

    await expect(page.locator('aside')).toBeAttached()
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible()
    await expect(page.getByRole('heading', { name: readyHeading })).toBeVisible()

    // The auth bootstrap splash and every skeleton/loader must be gone before
    // the shot: capturing early caught "Preparing your classroom..." on the
    // shell and "Loading editor..." where the answer should be. `aria-busy`
    // covers both the page skeletons and the editor's own loading state.
    await expect(page.getByText(/Preparing your classroom/)).toHaveCount(0)
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)

    // When a page shows code, wait for the text itself to have painted inside
    // the editor, so the shot proves the submission is visible rather than an
    // empty Monaco container.
    if (options.editorText) {
      await expect(page.locator('.monaco-editor .view-lines')).toContainText(options.editorText)
    }

    await page.screenshot({
      path: path.join(OUT_DIR, `${pathname.split('/').pop()}-${shot.label}.png`),
      animations: 'disabled',
      fullPage: Boolean(options.fullPage),
    })
  }
}

const REVIEW_BASE = `/app/classrooms/${SEEDED_CLASSROOM_ID}/tests/${SEEDED_REVIEW_TEST_ID}/submissions`

/**
 * The student's own result page, in its two telling states: released (marks and
 * comment shown) and unreleased (the withheld panel). The result page is long, so
 * these are full-page captures, and the file name carries a distinguishing label
 * because both routes end in `/result`.
 */
async function captureResult(
  page: Page,
  name: string,
  pathname: string,
  readyHeading: RegExp,
): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true })

  await page.addInitScript(([key]) => {
    if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, 'light')
  }, [THEME_KEY] as const)

  await stubTestBackend(page)
  await stubAuth(page, STUDENT)
  await seedAccount(page, STUDENT)

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/login')
  await page.getByLabel('Email').fill(STUDENT.email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/app\/student$/)

  for (const shot of SHOTS) {
    await page.setViewportSize({ width: shot.width, height: shot.height })
    await page.evaluate(
      ([key, theme]) => window.localStorage.setItem(key, theme),
      [THEME_KEY, shot.theme] as const,
    )
    await page.goto(pathname)

    // The student shell's landmark: a role query would skip the top bar below
    // `md`, so the capture asserts on a CSS selector instead.
    await expect(page.locator('nav[aria-label="Primary"]')).toBeAttached()
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible()
    await expect(page.getByRole('heading', { name: readyHeading })).toBeVisible()

    // `aria-busy` covers the fetch skeleton, so the shot never catches the page
    // mid-load with placeholder bars where the breakdown should be.
    await expect(page.getByText(/Preparing your classroom/)).toHaveCount(0)
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)

    await page.screenshot({
      path: path.join(OUT_DIR, `result-${name}-${shot.label}.png`),
      animations: 'disabled',
      fullPage: true,
    })
  }
}

/**
 * The captures pick their own viewport, so they run once, on chromium -- running
 * them under the `mobile` project too would write every file twice.
 */
function chromiumOnly(): void {
  test.skip(test.info().project.name !== 'chromium', 'Viewports are chosen per shot.')
}

test.describe('signed-in shell screenshots', () => {
  test('a student', async ({ page }) => {
    chromiumOnly()
    await capture(page, STUDENT, '/app/student')
  })

  test('a teacher', async ({ page }) => {
    chromiumOnly()
    await capture(page, TEACHER, '/app/dashboard')
  })
})

test.describe('review page screenshots', () => {
  test('the submissions list', async ({ page }) => {
    chromiumOnly()
    await captureReview(page, REVIEW_BASE, /^Submissions$/)
  })

  test('a submission grading page', async ({ page }) => {
    chromiumOnly()
    await captureReview(
      page,
      `${REVIEW_BASE}/sub-${SEEDED_REVIEW_TEST_ID}-uid-${STUDENT.email}`,
      /^Riya Sharma$/,
      { fullPage: true, editorText: 'indexOf' },
    )
  })
})

test.describe('result page screenshots', () => {
  test('a released result', async ({ page }) => {
    chromiumOnly()
    await captureResult(
      page,
      'released',
      `/app/tests/${SEEDED_RESULT_TEST_ID}/result`,
      /^Lab 5: Complexity results$/,
    )
  })

  test('an unreleased result', async ({ page }) => {
    chromiumOnly()
    await captureResult(
      page,
      'unreleased',
      `/app/tests/${SEEDED_REVIEW_TEST_ID}/result`,
      /^Lab 4: Binary search$/,
    )
  })
})
