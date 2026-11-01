import { expect, test, type Page } from '@playwright/test'

import {
  SEEDED_CLASSROOM_ID,
  SEEDED_REVIEW_TEST_ID,
  stubTestBackend,
} from './testBackend'

/**
 * The teacher's review flow, against the in-memory backend in `testBackend`.
 *
 * The two rules this suite pins are the ones that matter to the product:
 * grading happens privately and stays hidden until the teacher releases it
 * (after which the page locks), and a student can never reach the review routes
 * at all.
 */

const TEACHER = {
  email: 'aditya.teacher@mit.ac.in',
  password: 'Phase1-Secret-42',
  name: 'Aditya Rao',
}

const STUDENT = {
  email: 'riya.student@mit.ac.in',
  password: 'Phase1-Secret-42',
  name: 'Riya Sharma',
}

const REVIEW_URL = `/app/classrooms/${SEEDED_CLASSROOM_ID}/tests/${SEEDED_REVIEW_TEST_ID}/submissions`
const RIYA_SUBMISSION = `uid-${STUDENT.email}`

/** Mirrors the role and college the backend decides for the caller. */
async function stubAuth(page: Page, role: 'TEACHER' | 'STUDENT', email: string, name: string): Promise<void> {
  const profile = {
    uid: `uid-${email}`,
    email,
    displayName: name,
    role,
    collegeId: role === 'STUDENT' ? null : 'college-mit',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  const emailFrom = (request: { headers(): Record<string, string> }) => {
    const header = request.headers().authorization ?? ''
    return header.startsWith('Bearer ') ? header.slice('Bearer '.length).split('|')[2] : null
  }
  await page.route('**/api/auth/session', (route) => {
    const actual = emailFrom(route.request())
    if (!actual) return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: { ...profile } }),
    })
  })
  await page.route('**/api/auth/me', (route) => {
    const actual = emailFrom(route.request())
    if (!actual) return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...profile }),
    })
  })
  await page.route('**/api/auth/logout', (route) => route.fulfill({ status: 204, body: '' }))
}

async function seedAccount(page: Page, account: { email: string; name: string; password: string }) {
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

async function signIn(page: Page, account: { email: string; name: string; password: string }, home: RegExp) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(home)
}

test.describe('teacher review flow', () => {
  test.beforeEach(async ({ page }) => {
    // Auth last: it must stay the newest handler, or the catch-all 501s the
    // session exchange and every role silently degrades to STUDENT.
    await stubTestBackend(page)
    await stubAuth(page, 'TEACHER', TEACHER.email, TEACHER.name)
    await seedAccount(page, TEACHER)
  })

  test('reaches the submissions list from the test page and sees the roster', async ({ page }) => {
    await signIn(page, TEACHER, /\/app\/dashboard$/)

    await page.goto(`/app/classrooms/${SEEDED_CLASSROOM_ID}/tests/${SEEDED_REVIEW_TEST_ID}`)
    // "View submissions" is a styled Link, so it is a link role, not a button.
    await page.getByRole('link', { name: 'View submissions' }).click()

    await expect(page).toHaveURL(new RegExp(`/submissions$`))
    await expect(page.getByRole('heading', { name: 'Submissions' })).toBeVisible()
    // Every enrolled student, roster order, no matter who submitted.
    await expect(page.getByText('Riya Sharma')).toBeVisible()
    await expect(page.getByText('Meera Nair')).toBeVisible()
    await expect(page.getByText('Not submitted')).toBeVisible()
    // A student who never submitted gets no grading entry point.
    await expect(page.getByText('No submission')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Grade Meera Nair' })).toHaveCount(0)
    // The already-graded student shows their saved marks.
    await expect(page.getByText('8/10')).toBeVisible()
    await expect(page.getByText('Late')).toBeVisible()
  })

  test('grades a student, releases the results, and locks the grading', async ({ page }) => {
    await signIn(page, TEACHER, /\/app\/dashboard$/)
    await page.goto(REVIEW_URL)

    await page.getByRole('link', { name: 'Grade Riya Sharma' }).click()
    // The id is URL-encoded on the way through (`@` -> `%40`), so assert against
    // the encoded form and let the detail page's own heading prove it rendered.
    await expect(page).toHaveURL(new RegExp(`submissions/${encodeURIComponent(RIYA_SUBMISSION)}$`))
    await expect(page.getByRole('heading', { name: 'Riya Sharma' })).toBeVisible()
    // The submitted code is painted inside the real Monaco editor, not merely
    // mounted as an empty container.
    await expect(page.locator('.monaco-editor .view-lines')).toContainText('indexOf')

    // A graded save is private: the student sees nothing until release.
    await page.getByLabel('Marks out of 10').fill('4')
    await page.getByLabel('Comment for the student').fill('Short-circuits early, so case 2 fails.')
    await page.getByRole('button', { name: 'Save grades' }).click()
    await expect(page.getByText('Grades saved')).toBeVisible()

    await page.getByRole('link', { name: 'Back to submissions' }).click()
    await expect(page.getByText('4/10')).toBeVisible()

    await page.getByRole('button', { name: 'Release results' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Release results?' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Release results' }).click()
    // The badge on the list and the confirmation toast both say this; the test
    // wants the list itself, not the toast.
    await expect(page.locator('#main-content').getByText('Results released')).toBeVisible()

    // Once released the grading freezes: the form is dead.
    await page.getByRole('link', { name: 'Grade Riya Sharma' }).click()
    await expect(page.getByText('Results are released')).toBeVisible()
    await expect(page.getByLabel('Marks out of 10')).toBeDisabled()
    await expect(page.getByLabel('Comment for the student')).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Save grades' })).toBeDisabled()
  })

  test('keeps a student out of the review pages entirely', async ({ page }) => {
    // Student session, not the teacher beforeEach one.
    await page.unrouteAll()
    await stubTestBackend(page)
    await stubAuth(page, 'STUDENT', STUDENT.email, STUDENT.name)
    await seedAccount(page, STUDENT)
    await signIn(page, STUDENT, /\/app\/student$/)

    await page.goto(REVIEW_URL)
    await expect(page).toHaveURL(/\/app\/student$/)
  })
})