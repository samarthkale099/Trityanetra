import { expect, test, type Page, type Route } from '@playwright/test'

import { stubTestBackend } from './testBackend'

/**
 * The admin area in a real browser, against a stubbed API: who can reach it,
 * and the role change round trip. (The full-stack run covers it against the
 * real backend.)
 */

const PASSWORD = 'Phase1-Secret-42'
const ADMIN = { email: 'root@trityanetra.local', name: 'Root Admin', role: 'ADMIN', collegeId: null as string | null }
const TEACHER = { email: 'aditya.teacher@mit.ac.in', name: 'Aditya Rao', role: 'TEACHER', collegeId: 'college-mit' }
type Account = typeof ADMIN | typeof TEACHER

async function signInAs(page: Page, account: Account) {
  // Backend stub first, auth last: newest handler wins.
  await stubTestBackend(page)
  const profile = {
    uid: `uid-${account.email}`,
    email: account.email,
    displayName: account.name,
    role: account.role,
    collegeId: account.collegeId,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
  const authed = (route: Route) => (route.request().headers().authorization ?? '').startsWith('Bearer ')
  for (const pattern of ['**/api/auth/me', '**/api/auth/session']) {
    await page.route(pattern, (route) =>
      authed(route)
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: profile }) })
        : route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
    )
  }
  await page.addInitScript(
    ([email, name, password]) => {
      window.localStorage.setItem(
        'e2e.auth.accounts',
        JSON.stringify([{ uid: `uid-${email}`, email, password, displayName: name }]),
      )
    },
    [account.email, account.name, PASSWORD] as const,
  )
  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/app\/dashboard$/)
}

/** In-memory colleges and users for the admin endpoints. */
async function stubAdminApi(page: Page) {
  const colleges = [{ id: 'college-mit', name: 'MIT', code: 'MIT', emailDomain: 'mit.ac.in' }]
  const users = [
    { uid: 'u-meera', email: 'meera@mit.ac.in', displayName: 'Meera Nair', role: 'STUDENT', collegeId: 'college-mit', emailVerified: true, createdAt: null },
  ]
  const assigned: unknown[] = []
  await page.route('**/api/colleges', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: colleges }) }),
  )
  await page.route('**/api/users**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: users }) }),
  )
  await page.route('**/api/auth/assign-role', async (route) => {
    const body = route.request().postDataJSON() as { targetUid: string; role: string; collegeId: string | null }
    assigned.push(body)
    const user = users.find((u) => u.uid === body.targetUid)
    if (user) user.role = body.role
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"message":"ok"}' })
  })
  return { assigned }
}

test.describe('admin area', () => {
  test('an admin sees People and Colleges and can make a student a teacher', async ({ page }) => {
    await signInAs(page, ADMIN)
    const api = await stubAdminApi(page)

    await page.getByRole('link', { name: 'Colleges' }).first().click()
    await expect(page.getByRole('heading', { name: 'Colleges', level: 1 })).toBeVisible()
    await expect(page.getByText('@mit.ac.in')).toBeVisible()

    await page.getByRole('link', { name: 'People' }).first().click()
    await expect(page.getByText('meera@mit.ac.in')).toBeVisible()
    await page.getByRole('button', { name: 'Change role for Meera Nair' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('combobox', { name: 'Role' }).click()
    await page.getByRole('option', { name: 'Teacher' }).click()
    await dialog.getByRole('button', { name: 'Save role' }).click()

    await expect.poll(() => api.assigned).toEqual([{ targetUid: 'u-meera', role: 'TEACHER', collegeId: 'college-mit' }])
  })

  test('a teacher sees no admin links and is sent away from the admin pages', async ({ page }) => {
    await signInAs(page, TEACHER)
    await expect(page.getByRole('link', { name: 'People' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Colleges' })).toHaveCount(0)

    await page.goto('/app/admin/people')
    await expect(page).toHaveURL(/\/app\/dashboard$/)
  })
})
