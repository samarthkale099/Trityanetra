import { test, type Page, type Route } from '@playwright/test'

import { stubTestBackend } from './testBackend'

/**
 * Hands-on preview: opens a real browser window on the app, signed in, with
 * the same stubbed backend the E2E suite uses. Nothing is asserted -- the
 * window stays open (paused in the Playwright Inspector) so a person can click
 * through every page with no backend, database or Firebase project running.
 *
 * Skipped unless PREVIEW is set, so it never stalls a normal `npm run e2e`.
 *
 *   PowerShell:
 *     $env:PREVIEW="student"; $env:PW_CHANNEL="msedge"; npx playwright test e2e/preview.spec.ts --project=chromium --headed
 *
 * Use PREVIEW="teacher" for the teacher side. Close the browser window (or
 * press Resume in the Inspector) to stop.
 */

const PASSWORD = 'Phase1-Secret-42'

const ACCOUNTS = {
  student: { email: 'riya.student@mit.ac.in', name: 'Riya Sharma', role: 'STUDENT' as const },
  teacher: { email: 'aditya.teacher@mit.ac.in', name: 'Aditya Rao', role: 'TEACHER' as const },
}

type Account = (typeof ACCOUNTS)[keyof typeof ACCOUNTS]

const choice = (process.env.PREVIEW ?? '').toLowerCase()

/** Serves the auth endpoints; identity comes from the bearer token, as in ui-shots. */
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

  await page.route('**/api/auth/session', (route) => {
    const user = profileFor(route)
    if (!user) return unauthorized(route)
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user }) })
  })
  await page.route('**/api/auth/me', (route) => {
    const user = profileFor(route)
    if (!user) return unauthorized(route)
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) })
  })
  await page.route('**/api/auth/logout', (route) => route.fulfill({ status: 204, body: '' }))
}

test.skip(!(choice in ACCOUNTS), 'Set PREVIEW=student or PREVIEW=teacher to open the hands-on preview')

test('hands-on preview', async ({ page }) => {
  test.setTimeout(0)
  const account = ACCOUNTS[choice as keyof typeof ACCOUNTS]

  await stubTestBackend(page)
  await stubAuth(page, account)
  await page.addInitScript(
    ([email, name, password]) => {
      window.localStorage.setItem(
        'e2e.auth.accounts',
        JSON.stringify([{ uid: `uid-${email}`, email, password, displayName: name }]),
      )
    },
    [account.email, account.name, PASSWORD] as const,
  )

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()

  // Keeps the window (and the stubbed backend) alive until it is closed.
  await page.pause()
})
