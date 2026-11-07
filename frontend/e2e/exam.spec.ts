import { expect, test, type Page } from '@playwright/test'

import { SEEDED_LIVE_TEST_ID, SEEDED_UPCOMING_TEST_ID, stubTestBackend } from './testBackend'

/**
 * The student take-a-test journey, end to end against the mock backend.
 *
 * This is the path where the app's own rules matter most: previewing a lobby must
 * not consume the student's time, entering the exam must latch the attempt on the
 * server rather than in the browser, and a reload must not hand back a fresh
 * clock.
 */

const STUDENT = {
  email: 'riya.student@mit.ac.in',
  password: 'Phase1-Secret-42',
  name: 'Riya Sharma',
}

async function stubAuth(page: Page): Promise<void> {
  const profile = {
    uid: `uid-${STUDENT.email}`,
    email: STUDENT.email,
    displayName: STUDENT.name,
    role: 'STUDENT',
    collegeId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  const emailFrom = (request: { headers(): Record<string, string> }) => {
    const header = request.headers().authorization ?? ''
    return header.startsWith('Bearer ') ? header.slice('Bearer '.length).split('|')[2] : null
  }
  const serve = (route: { request(): { headers(): Record<string, string> } }) => {
    const email = emailFrom(route.request())
    if (!email) {
      return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...profile, email }),
    })
  }
  await page.route('**/api/auth/session', serve)
  await page.route('**/api/auth/me', serve)
  await page.route('**/api/auth/logout', (route) => route.fulfill({ status: 204, body: '' }))
}

async function signInAsStudent(page: Page) {
  await page.addInitScript(
    ([email, name, password]) => {
      window.localStorage.setItem(
        'e2e.auth.accounts',
        JSON.stringify([{ uid: `uid-${email}`, email, password, displayName: name }]),
      )
    },
    [STUDENT.email, STUDENT.name, STUDENT.password] as const,
  )
  await page.goto('/login')
  await page.getByLabel('Email').fill(STUDENT.email)
  await page.getByLabel('Password', { exact: true }).fill(STUDENT.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/app\/student$/)
}

/**
 * Makes the Fullscreen API deterministic.
 *
 * `FullscreenGuard` polls `document.fullscreenElement` and only renders the exam
 * once it reads the document itself, because a headless browser will not grant a
 * real fullscreen request. Faking the element (and the event) exercises the real
 * guard logic -- the transition, the latch, the exit report -- without a headed
 * browser. This is the one part of the exam that is stubbed rather than driven.
 */
async function stubFullscreen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let active = false
    Object.defineProperty(Document.prototype, 'fullscreenElement', {
      configurable: true,
      get: () => (active ? document.documentElement : null),
    })
    Element.prototype.requestFullscreen = function requestFullscreen() {
      active = true
      document.dispatchEvent(new Event('fullscreenchange'))
      return Promise.resolve()
    }
    document.exitFullscreen = function exitFullscreen() {
      active = false
      document.dispatchEvent(new Event('fullscreenchange'))
      return Promise.resolve()
    }
  })
}

test.describe('student exam flow', () => {
  test.beforeEach(async ({ page }) => {
    // Auth last, so it stays the newest handler and the catch-all cannot 501 it.
    await stubTestBackend(page)
    await stubAuth(page)
    await stubFullscreen(page)
  })

  test('groups tests by status on the student dashboard', async ({ page }) => {
    await signInAsStudent(page)

    await expect(page.getByRole('heading', { name: /hello, riya/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Live now' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sorting and searching' })).toBeVisible()
    // An upcoming test is visible but not yet startable.
    await expect(page.getByRole('heading', { name: 'Graph traversal' })).toBeVisible()
  })

  test('opens a lobby without starting the attempt', async ({ page }) => {
    await signInAsStudent(page)
    await page.goto(`/app/tests/${SEEDED_LIVE_TEST_ID}/lobby`)

    await expect(page.getByRole('heading', { name: 'Sorting and searching' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start exam' })).toBeEnabled()

    // Reading the rules must cost no time, so the button still says "Start" and
    // the server has latched nothing yet.
    await page.reload()
    await expect(page.getByRole('button', { name: 'Start exam' })).toBeEnabled()
  })

  test('offers no start button for a test that has not opened', async ({ page }) => {
    await signInAsStudent(page)
    await page.goto(`/app/tests/${SEEDED_UPCOMING_TEST_ID}/lobby`)

    await expect(page.getByRole('heading', { name: 'Graph traversal' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start exam' })).toBeDisabled()
  })

  test('reaches the exam, enters fullscreen, and submits', async ({ page }) => {
    await signInAsStudent(page)
    await page.goto(`/app/tests/${SEEDED_LIVE_TEST_ID}/lobby`)
    await page.getByRole('button', { name: 'Start exam' }).click()

    await expect(page).toHaveURL(new RegExp(`/app/tests/${SEEDED_LIVE_TEST_ID}/exam$`))
    // The exam owns its own chrome: no app sidebar, no account menu.
    await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0)

    // Fullscreen needs a user gesture, so the app asks for one.
    await page.getByRole('button', { name: 'Enter fullscreen' }).click()

    await page.getByRole('button', { name: 'Submit exam' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Submit your exam?')).toBeVisible()
    await dialog.getByRole('button', { name: 'Submit exam' }).click()

    await expect(page.getByRole('button', { name: 'Submitted' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Back to the lobby' })).toBeVisible()
  })

  test('shows a submitted exam as already done, not as a fresh editor', async ({ page }) => {
    await signInAsStudent(page)
    await page.goto(`/app/tests/${SEEDED_LIVE_TEST_ID}/lobby`)
    await page.getByRole('button', { name: 'Start exam' }).click()
    await page.getByRole('button', { name: 'Enter fullscreen' }).click()
    await page.getByRole('button', { name: 'Submit exam' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Submit exam' }).click()
    await expect(page.getByRole('button', { name: 'Submitted' })).toBeDisabled()

    // Straight back into the URL: the server still knows the attempt is finished.
    await page.goto(`/app/tests/${SEEDED_LIVE_TEST_ID}/exam`)
    await expect(page.getByText(/already submitted/i).first()).toBeVisible()
  })

  test('keeps the attempt latched across a reload, so time cannot be reset', async ({ page }) => {
    await signInAsStudent(page)
    await page.goto(`/app/tests/${SEEDED_LIVE_TEST_ID}/lobby`)
    await page.getByRole('button', { name: 'Start exam' }).click()
    await expect(page).toHaveURL(new RegExp(`/exam$`))

    await page.goto(`/app/tests/${SEEDED_LIVE_TEST_ID}/lobby`)

    // Now that an attempt exists, the lobby offers to resume it rather than
    // presenting a brand new allowance.
    await expect(page.getByRole('button', { name: 'Resume exam' })).toBeVisible()
  })

  test('keeps a student out of the teacher area', async ({ page }) => {
    await signInAsStudent(page)
    await page.goto('/app/classrooms')
    await expect(page).toHaveURL(/\/app\/student$/)
  })
})
