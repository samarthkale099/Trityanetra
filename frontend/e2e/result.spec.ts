import { expect, test, type Page } from '@playwright/test'

import {
  SEEDED_LIVE_TEST_ID,
  SEEDED_RESULT_TEST_ID,
  SEEDED_REVIEW_TEST_ID,
  stubTestBackend,
} from './testBackend'

/**
 * The student result screen, end to end against the in-memory backend.
 *
 * The rules worth pinning here are the withholding rules: a released test shows
 * the marks and comment, an unreleased one shows neither, and a student who did
 * not submit cannot open a classmate's result at all.
 */

const STUDENT = {
  email: 'riya.student@mit.ac.in',
  password: 'Phase1-Secret-42',
  name: 'Riya Sharma',
}

/** Enrolled in the classroom but never submitted the result test. */
const CLASSMATE = {
  email: 'meera.student@mit.ac.in',
  password: 'Phase1-Secret-42',
  name: 'Meera Nair',
}

async function stubAuth(page: Page, account: { email: string; name: string }): Promise<void> {
  const profile = {
    uid: `uid-${account.email}`,
    email: account.email,
    displayName: account.name,
    role: 'STUDENT',
    collegeId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  const emailFrom = (request: { headers(): Record<string, string> }) => {
    const header = request.headers().authorization ?? ''
    return header.startsWith('Bearer ') ? header.slice('Bearer '.length).split('|')[2] : null
  }
  const respond = (route: { request(): { headers(): Record<string, string> } }) => {
    const actual = emailFrom(route.request())
    if (!actual) return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...profile, email: actual }),
    })
  }
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: { ...profile, email: emailFrom(route.request()) } }),
    }),
  )
  await page.route('**/api/auth/me', respond)
  await page.route('**/api/auth/logout', (route) => route.fulfill({ status: 204, body: '' }))
}

async function seedAccount(
  page: Page,
  account: { email: string; name: string; password: string },
): Promise<void> {
  await page.addInitScript(
    ([email, name, password]) => {
      window.localStorage.setItem(
        'e2e.auth.accounts',
        JSON.stringify([{ uid: `uid-${email}`, email, password, displayName: name }]),
      )
    },
    [account.email, account.name, account.password] as const,
  )
}

async function signIn(
  page: Page,
  account: { email: string; name: string; password: string },
): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/app\/student$/)
}

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

test.describe('student result flow', () => {
  test.beforeEach(async ({ page }) => {
    // Auth last: it must stay the newest handler, or the catch-all 501s the
    // session exchange and every role silently degrades to STUDENT.
    await stubTestBackend(page)
    await stubAuth(page, STUDENT)
    await seedAccount(page, STUDENT)
    await stubFullscreen(page)
  })

  test('offers "View result" only for a test the student sat, and shows the breakdown', async ({
    page,
  }) => {
    await signIn(page, STUDENT)

    // A live test is a Start action, not a result: the gate is the server's flag.
    const liveRow = page.getByRole('listitem').filter({ hasText: 'Sorting and searching' })
    await expect(liveRow.getByRole('link', { name: 'Start exam' })).toBeVisible()
    await expect(liveRow.getByRole('link', { name: 'View result' })).toHaveCount(0)

    const row = page.getByRole('listitem').filter({ hasText: 'Lab 5: Complexity results' })
    await row.getByRole('link', { name: 'View result' }).click()

    await expect(page).toHaveURL(new RegExp(`/app/tests/${SEEDED_RESULT_TEST_ID}/result$`))
    await expect(page.getByRole('heading', { name: 'Lab 5: Complexity results' })).toBeVisible()

    // The pass count is offered as text to assistive tech, not only as a bar.
    const bar = page.getByRole('progressbar', { name: 'Test cases passed' })
    await expect(bar).toHaveAttribute('aria-valuenow', '1')
    await expect(bar).toHaveAttribute('aria-valuemax', '3')

    // A visible pass, two fails (one visible, one hidden) shown as state only.
    await expect(page.getByText('Passed', { exact: true })).toHaveCount(1)
    await expect(page.getByText('Failed', { exact: true })).toHaveCount(2)
    await expect(
      page.getByText('This is a hidden test case. Only its result is shown.'),
    ).toBeVisible()
    await expect(page.getByText('Input', { exact: true })).toHaveCount(2)

    // The released marks and comment are shown.
    await expect(page.getByText('7 / 10')).toBeVisible()
    await expect(
      page.getByText('Watch the hidden edge case before the next lab.'),
    ).toBeVisible()
  })

  test('withholds the marks panel until the teacher releases results', async ({ page }) => {
    await signIn(page, STUDENT)
    await page.goto(`/app/tests/${SEEDED_REVIEW_TEST_ID}/result`)

    await expect(page.getByRole('heading', { name: 'Lab 4: Binary search' })).toBeVisible()
    await expect(page.getByText('Your teacher has not released marks yet.')).toBeVisible()
    // Withheld for real: the marks row is not rendered at all.
    await expect(page.getByText('Not graded')).toHaveCount(0)

    // Three visible cases carry content; the two hidden ones leak nothing.
    await expect(page.getByText('Input', { exact: true })).toHaveCount(3)
    await expect(page.getByText(/2,4,6,8/)).toHaveCount(0)
  })

  test('does not reveal a classmate`s result', async ({ page }) => {
    await page.unrouteAll()
    await stubTestBackend(page)
    await stubAuth(page, CLASSMATE)
    await seedAccount(page, CLASSMATE)

    await page.goto('/login')
    await page.getByLabel('Email').fill(CLASSMATE.email)
    await page.getByLabel('Password', { exact: true }).fill(CLASSMATE.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/app\/student$/)

    await page.goto(`/app/tests/${SEEDED_RESULT_TEST_ID}/result`)
    await expect(page.getByText("We couldn't find that result")).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to my tests' })).toBeVisible()
  })

  test('reaches the result from the lobby once the work is submitted', async ({ page }) => {
    await signIn(page, STUDENT)

    // Submit the live test through the real exam flow, then return to the lobby.
    await page.goto(`/app/tests/${SEEDED_LIVE_TEST_ID}/lobby`)
    await page.getByRole('button', { name: 'Start exam' }).click()
    await page.getByRole('button', { name: 'Enter fullscreen' }).click()
    await page.getByRole('button', { name: 'Submit exam' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Submit exam' }).click()
    await expect(page.getByRole('button', { name: 'Submitted' })).toBeDisabled()

    await page.getByRole('button', { name: 'Back to the lobby' }).click()
    await expect(page).toHaveURL(new RegExp(`/app/tests/${SEEDED_LIVE_TEST_ID}/lobby$`))
    await page.getByRole('button', { name: 'View result' }).click()

    await expect(page).toHaveURL(new RegExp(`/app/tests/${SEEDED_LIVE_TEST_ID}/result$`))
    await expect(page.getByText('Your submission')).toBeVisible()
  })
})
