import { expect, test, type Page, type Route } from '@playwright/test'

import { SEEDED_CLASSROOM_ID, stubTestBackend } from './testBackend'

/**
 * Auth-flow E2E, run entirely against mocks.
 *
 * `vite --mode e2e` replaces the Firebase auth driver with an in-memory
 * implementation (see `vite.config.ts` and `src/tests/e2eAuthDriver.ts`), and
 * the backend routes below are intercepted in the browser. Nothing here needs a
 * Firebase project, a service account, or a running backend, so the suite is
 * reproducible on any machine.
 *
 * The role is decided by the stub, exactly as the real backend decides it: the
 * client only ever renders what the session exchange returns.
 */

const STUDENT = {
  email: 'riya.student@mit.ac.in',
  password: 'Phase1-Secret-42',
  name: 'Riya Sharma',
}

const TEACHER = {
  email: 'aditya.teacher@mit.ac.in',
  password: 'Phase1-Secret-42',
  name: 'Aditya Rao',
}

const PASSWORD = 'Phase1-Secret-42'

/**
 * Role and display name are decided by the stub, never by the page. Unknown
 * addresses fall back to the email local part, which is what a real backend
 * reading the token would see for a freshly registered user.
 */
const ROLES: Record<string, 'STUDENT' | 'TEACHER'> = {
  [TEACHER.email]: 'TEACHER',
}

const NAMES: Record<string, string> = {
  [STUDENT.email]: STUDENT.name,
  [TEACHER.email]: TEACHER.name,
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function profileFor(email: string) {
  const role = ROLES[email] ?? 'STUDENT'
  return {
    uid: `uid-${email}`,
    email,
    displayName: NAMES[email] ?? titleCase(email.split('@')[0]),
    role,
    collegeId: role === 'TEACHER' ? 'college-mit' : null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

/** Recovers the identity from the stub token, the way the backend verifies one. */
function emailFrom(request: import('@playwright/test').Request): string | null {
  const header = request.headers().authorization ?? ''
  if (!header.startsWith('Bearer ')) return null
  const parts = header.slice('Bearer '.length).split('|')
  return parts[2] ?? null
}

function unauthorized(route: Route) {
  return route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'Sign in to continue.', code: 'MISSING_TOKEN' }),
  })
}

/**
 * Stubs the three auth endpoints. The token is only ever read from the
 * `Authorization` header, so a request that omits it is rejected the same way
 * Express rejects it.
 */
async function stubBackend(page: Page): Promise<void> {
  await page.route('**/api/auth/session', async (route: Route) => {
    const email = emailFrom(route.request())
    if (!email) return unauthorized(route)
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: profileFor(email) }),
    })
  })

  await page.route('**/api/auth/me', async (route: Route) => {
    const email = emailFrom(route.request())
    if (!email) return unauthorized(route)
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(profileFor(email)),
    })
  })

  await page.route('**/api/auth/logout', (route) => route.fulfill({ status: 204, body: '' }))
}

/**
 * The in-memory driver derives its token from the signed-in uid, which it does
 * not know from the request alone. This seeds the account so the stub can map
 * the token back to an email, keeping the role assignment server-side.
 */
async function seedAccount(page: Page, email: string, name: string, password: string): Promise<void> {
  await page.addInitScript(
    ([seedEmail, seedName, seedPassword]) => {
      window.localStorage.setItem(
        'e2e.auth.accounts',
        JSON.stringify([{ uid: `uid-${seedEmail}`, email: seedEmail, password: seedPassword, displayName: seedName }]),
      )
    },
    [email, name, password] as const,
  )
}

/**
 * Collects everything the browser complains about during the run.
 *
 * A `requestfailed` entry is folded in as a console error, because a failed
 * subresource is reported to the user as a broken page: a render-blocking font
 * or a missing chunk must fail this test just as loudly as a thrown exception.
 * Third-party hosts are asserted against separately, so the app cannot quietly
 * acquire a runtime dependency on an external origin.
 */
function collectConsoleErrors(page: Page, origin: string): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    const failure = request.failure()
    errors.push(`requestfailed: ${request.url()} (${failure?.errorText ?? 'unknown'})`)
  })
  page.on('request', (request) => {
    const url = request.url()
    if (!/^https?:/.test(url) || url.startsWith(origin)) return
    errors.push(`third-party request: ${url}`)
  })
  return errors
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Sign out' }).click()
}

test.describe('auth flow', () => {
  test.beforeEach(async ({ page }) => {
    /*
     * Order matters. Playwright matches the most recently registered handler
     * first, and `stubTestBackend` ends with a catch-all that reports any
     * unmodelled `/api/**` request. Registering the auth routes afterwards makes
     * them the newest, so `/api/auth/session` is answered rather than 501'd --
     * a swallowed profile fetch silently downgrades every role to STUDENT.
     *
     * The classroom contract is stubbed here too, because a signed-in student is
     * sent straight to the student dashboard, which fetches classrooms and tests
     * on arrival.
     */
    await stubTestBackend(page)
    await stubBackend(page)
  })

  test('signs in, reaches the dashboard, signs out, and signs back in', async ({ page, baseURL }) => {
    const consoleErrors = collectConsoleErrors(page, baseURL ?? '')
    await seedAccount(page, STUDENT.email, STUDENT.name, STUDENT.password)

    await signIn(page, STUDENT.email, STUDENT.password)

    await expect(page).toHaveURL(/\/app\/student$/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Riya')
    // The name and email both came from the stubbed backend, not a client guess:
    // the header avatar is the driver's own local session, the dropdown profile
    // is the `/api/auth/me` response.
    await page.getByRole('button', { name: 'Account menu' }).click()
    await expect(page.getByRole('menu').getByText(STUDENT.email)).toBeVisible()
    await page.keyboard.press('Escape')

    await signOut(page)
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()

    await signIn(page, STUDENT.email, STUDENT.password)
    await expect(page).toHaveURL(/\/app\/student$/)

    expect(consoleErrors).toEqual([])
  })

  test('registers a new account from just a college email and lands on the dashboard', async ({ page }) => {
    await page.goto('/register')
    await page.getByLabel('Full name').fill('Kabir Mehta')
    // There is no domain field: the address alone decides it.
    await expect(page.getByText('Use your college email address.')).toBeVisible()
    await page.getByLabel('College email', { exact: true }).fill('kabir@mit.ac.in')
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.getByRole('checkbox', { name: 'Accept the classroom code of conduct' }).check()
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page).toHaveURL(/\/app\/student$/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Kabir')
  })

  test('blocks registration when the derived domain is not a college host', async ({ page }) => {
    await page.goto('/register')
    await page.getByLabel('Full name').fill('Kabir Mehta')
    await page.getByLabel('College email', { exact: true }).fill('kabir@my_college.edu')
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.getByRole('checkbox', { name: 'Accept the classroom code of conduct' }).check()
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page).toHaveURL(/\/register$/)
    await expect(page.getByText(/don't recognise that email domain/i)).toBeVisible()
    // What was typed is still there, so it can be corrected in place.
    await expect(page.getByLabel('College email', { exact: true })).toHaveValue('kabir@my_college.edu')
  })

  test('blocks registration when the email address itself is invalid', async ({ page }) => {
    await page.goto('/register')
    await page.getByLabel('Full name').fill('Kabir Mehta')
    await page.getByLabel('College email', { exact: true }).fill('kabir@not-an-email')
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.getByRole('checkbox', { name: 'Accept the classroom code of conduct' }).check()
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page).toHaveURL(/\/register$/)
    await expect(page.getByText(/not formatted correctly/i)).toBeVisible()
    await expect(page.getByLabel('College email', { exact: true })).toHaveValue('kabir@not-an-email')
  })

  test('keeps the intended destination when a signed-out visitor opens a protected route', async ({ page }) => {
    await page.goto('/app/classrooms')
    await expect(page).toHaveURL(/\/login\?from=%2Fapp%2Fclassrooms$/)
  })

  test('redirects a student away from the teacher area', async ({ page }) => {
    await seedAccount(page, STUDENT.email, STUDENT.name, STUDENT.password)
    await signIn(page, STUDENT.email, STUDENT.password)
    await expect(page).toHaveURL(/\/app\/student$/)

    await page.goto('/app/classrooms')
    await expect(page).toHaveURL(/\/app\/student$/)
  })

  test('lets a teacher open the teacher area', async ({ page }) => {
    await seedAccount(page, TEACHER.email, TEACHER.name, TEACHER.password)
    await signIn(page, TEACHER.email, TEACHER.password)
    // A teacher is sent straight to their dashboard, not to the student home.
    await expect(page).toHaveURL(/\/app\/dashboard$/)

    await page.goto(`/app/classrooms/${SEEDED_CLASSROOM_ID}`)
    await expect(page).toHaveURL(new RegExp(`/app/classrooms/${SEEDED_CLASSROOM_ID}$`))
    await expect(page.getByText('Riya Sharma')).toBeVisible()
  })

  test('restores the session across a full page reload', async ({ page }) => {
    await seedAccount(page, STUDENT.email, STUDENT.name, STUDENT.password)
    await signIn(page, STUDENT.email, STUDENT.password)
    await expect(page).toHaveURL(/\/app\/student$/)

    await page.reload()

    // Straight back into the app, not the login screen.
    await expect(page).toHaveURL(/\/app\/student$/)
    await page.getByRole('button', { name: 'Account menu' }).click()
    await expect(page.getByRole('menu').getByText(STUDENT.email)).toBeVisible()
  })

  test('sends a signed-in user away from the login and register pages', async ({ page }) => {
    await seedAccount(page, STUDENT.email, STUDENT.name, STUDENT.password)
    await signIn(page, STUDENT.email, STUDENT.password)
    await expect(page).toHaveURL(/\/app\/student$/)

    await page.goto('/login')
    await expect(page).toHaveURL(/\/app\/student$/)

    await page.goto('/register')
    await expect(page).toHaveURL(/\/app\/student$/)
  })

  test('shows a readable error for a wrong password and stays on the page', async ({ page }) => {
    await seedAccount(page, STUDENT.email, STUDENT.name, STUDENT.password)
    await signIn(page, STUDENT.email, 'not-the-password')

    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('alert')).toContainText(/email or password is incorrect/i)
  })

  test('keeps the password field masked and toggleable', async ({ page }) => {
    await page.goto('/login')
    const password = page.getByLabel('Password', { exact: true })
    await expect(password).toHaveAttribute('type', 'password')

    await page.getByRole('button', { name: 'Show password' }).click()
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text')
    await page.getByRole('button', { name: 'Hide password' }).click()
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password')
  })

  test('remembers the theme choice across a reload', async ({ page }) => {
    await page.goto('/login')
    const initial = await page.evaluate(() => document.documentElement.classList.contains('dark'))

    await page.getByRole('button', { name: /theme|dark|light/i }).first().click()
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(!initial)

    await page.reload()
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(!initial)
  })

  test('shows the not-found page for an unknown address', async ({ page }) => {
    await page.goto('/definitely-not-a-route')
    await expect(page.getByText(/isn.t here/i)).toBeVisible()
  })
})
