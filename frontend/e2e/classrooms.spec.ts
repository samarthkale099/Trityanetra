import { expect, test, type Page } from '@playwright/test'

import { SEEDED_CLASSROOM_ID, stubTestBackend } from './testBackend'

/**
 * Teacher flows, run entirely against the in-memory backend in `testBackend`.
 *
 * The auth stub lives in `auth.spec.ts`; the profile it serves decides the role,
 * so registering the classroom routes first and the auth routes second keeps
 * Playwright's newest-handler-wins matching pointed at the right place.
 */

const TEACHER = {
  email: 'aditya.teacher@mit.ac.in',
  password: 'Phase1-Secret-42',
  name: 'Aditya Rao',
}

/**
 * Mirrors the role and college the backend decides for the teacher. The client
 * never chooses its own role, so the stub is the only place it is stated.
 */
async function stubAuth(page: Page): Promise<void> {
  const profile = {
    uid: `uid-${TEACHER.email}`,
    email: TEACHER.email,
    displayName: TEACHER.name,
    role: 'TEACHER',
    collegeId: 'college-mit',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  const emailFrom = (request: { headers(): Record<string, string> }) => {
    const header = request.headers().authorization ?? ''
    return header.startsWith('Bearer ') ? header.slice('Bearer '.length).split('|')[2] : null
  }
  await page.route('**/api/auth/session', (route) => {
    const email = emailFrom(route.request())
    if (!email) return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: { ...profile, email } }),
    })
  })
  await page.route('**/api/auth/me', (route) => {
    const email = emailFrom(route.request())
    if (!email) return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...profile, email }),
    })
  })
  await page.route('**/api/auth/logout', (route) => route.fulfill({ status: 204, body: '' }))
}

async function seedTeacher(page: Page) {
  await page.addInitScript(
    ([email, name, password]) => {
      window.localStorage.setItem(
        'e2e.auth.accounts',
        JSON.stringify([{ uid: `uid-${email}`, email, password, displayName: name }]),
      )
    },
    [TEACHER.email, TEACHER.name, TEACHER.password] as const,
  )
}

async function signInAsTeacher(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(TEACHER.email)
  await page.getByLabel('Password', { exact: true }).fill(TEACHER.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  // Teachers land on their dashboard; these tests start from the classroom list.
  await expect(page).toHaveURL(/\/app\/dashboard$/)
  await page.goto('/app/classrooms')
  await expect(page).toHaveURL(/\/app\/classrooms$/)
}

test.describe('teacher classroom flow', () => {
  test.beforeEach(async ({ page }) => {
    // Auth last: it must stay the newest handler, or the catch-all 501s the
    // session exchange and every role silently degrades to STUDENT.
    await stubTestBackend(page)
    await stubAuth(page)
    await seedTeacher(page)
  })

  test('lists classrooms with their student and test counts', async ({ page }) => {
    await signInAsTeacher(page)

    await expect(page.getByRole('heading', { name: 'Classrooms' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'CS 204 Algorithms' })).toBeVisible()
    await expect(page.getByText('4 students')).toBeVisible()
    // Enrolment is teacher-only now, so no join code is shown anywhere.
    await expect(page.getByText('ALGO-204')).toHaveCount(0)
  })

  test('searches the classroom list client-side', async ({ page }) => {
    await signInAsTeacher(page)

    const search = page.getByPlaceholder('Search by name or subject')
    await search.fill('no-such-classroom')
    await expect(page.getByText(/no classroom matches/i)).toBeVisible()

    await search.fill('algorithms')
    await expect(page.getByRole('heading', { name: 'CS 204 Algorithms' })).toBeVisible()
  })

  test('creates a classroom and sees it in the list', async ({ page }) => {
    await signInAsTeacher(page)

    await page.getByRole('button', { name: /new classroom/i }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'New classroom' })).toBeVisible()
    await dialog.getByLabel(/name/i).fill('Operating Systems')
    await dialog.getByLabel(/subject/i).fill('CS350')
    await dialog.getByRole('button', { name: /^create/i }).click()

    await expect(page.getByRole('heading', { name: 'Operating Systems' })).toBeVisible()
  })

  test('opens a classroom and sees the roster and its tests', async ({ page }) => {
    await signInAsTeacher(page)

    await page.getByRole('link', { name: /open/i }).first().click()
    await expect(page).toHaveURL(new RegExp(`/app/classrooms/${SEEDED_CLASSROOM_ID}$`))

    // The roster is the teacher's view of who is enrolled.
    await expect(page.getByText('Riya Sharma')).toBeVisible()
    await expect(page.getByText('riya.student@mit.ac.in')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sorting and searching' })).toBeVisible()
  })

  test('stays on the teacher page after a reload, not the student home', async ({ page }) => {
    await signInAsTeacher(page)
    await page.goto(`/app/classrooms/${SEEDED_CLASSROOM_ID}`)
    await expect(page.getByRole('heading', { name: 'CS 204 Algorithms' })).toBeVisible()

    // Regression: the restored session briefly carried a placeholder STUDENT
    // role, and the route guard sent the teacher to /app/student for good.
    // A slow profile answer gives the guard time to act on that placeholder.
    await page.route('**/api/auth/me', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await route.fallback()
    })
    await page.reload()
    await expect(page.getByRole('heading', { name: 'CS 204 Algorithms' })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/app/classrooms/${SEEDED_CLASSROOM_ID}$`))
  })

  test('builds a test and finds it on the classroom page', async ({ page }) => {
    await signInAsTeacher(page)
    await page.goto(`/app/classrooms/${SEEDED_CLASSROOM_ID}/tests/new`)

    await expect(page.getByRole('heading', { name: 'Create a test' })).toBeVisible()
    await page.getByLabel('Title').fill('Hash maps in practice')
    await page.getByLabel('Instructions (optional)').fill('One question only.')
    await page.getByLabel(/^question 1/i).fill('Implement a hash map.')

    await page.getByRole('button', { name: 'Create test' }).click()

    await expect(page).toHaveURL(new RegExp(`/app/classrooms/${SEEDED_CLASSROOM_ID}$`))
    await expect(page.getByRole('heading', { name: 'Hash maps in practice' })).toBeVisible()
  })

  test('reports validation without leaving the form', async ({ page }) => {
    await signInAsTeacher(page)
    await page.goto(`/app/classrooms/${SEEDED_CLASSROOM_ID}/tests/new`)

    // No title and no question prompt. The client validates first, so the server is
    // never called, and the teacher must stay on the form with the reason shown.
    await page.getByRole('button', { name: 'Create test' }).click()

    await expect(page.getByText('Give the test a title.')).toBeVisible()
    await expect(page.getByText('Write the question prompt.')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/tests/new$`))
  })

  test('reviews a test read-only rather than sitting it', async ({ page }) => {
    await signInAsTeacher(page)
    await page.goto(`/app/classrooms/${SEEDED_CLASSROOM_ID}`)
    await page.getByRole('link', { name: 'Review' }).first().click()

    await expect(page).toHaveURL(new RegExp(`/app/classrooms/${SEEDED_CLASSROOM_ID}/tests/test-`))
    // A teacher previews, so this must not land on the student exam route.
    await expect(page).not.toHaveURL(/\/exam$/)
  })
})
