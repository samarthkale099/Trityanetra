import { expect, test, type Browser, type BrowserContext, type Page, type Route } from '@playwright/test'

import {
  stubTestBackend,
  SEEDED_CLASSROOM_ID,
  SEEDED_LIVE_TEST_ID,
  type E2EBackendState,
} from './testBackend'

/**
 * FINAL ACCEPTANCE SUITE
 *
 * One file that checks the finished product end to end, in four parts:
 *
 *   1. Functionality  -- each screen does its job (dashboard, roster, exam).
 *   2. User flow      -- teacher adds a student -> student sees the classroom ->
 *                        sits and submits the exam -> teacher removes them ->
 *                        they lose access.
 *   3. Animation      -- the motion system is wired up, and switches off for
 *                        people who ask their OS for reduced motion.
 *   4. Speed          -- load and navigation timings, layout stability and
 *                        main-thread blocking against explicit budgets.
 *
 * Runs against the same in-memory backend as the other E2E suites, so no real
 * server, database or Firebase project is needed.
 *
 *   npx playwright test e2e/final.spec.ts --project=chromium
 *   (on this machine: $env:PW_CHANNEL="msedge" first, to use the installed Edge)
 *
 * Speed budgets are deliberately generous so a slow laptop does not fail them
 * by accident. Tighten or loosen them all at once with PERF_BUDGET_SCALE, e.g.
 * PERF_BUDGET_SCALE=0.5 for a strict run on a fast machine.
 */

const PASSWORD = 'Final-Check-2026'
const SCALE = Number(process.env.PERF_BUDGET_SCALE ?? '1') || 1

/** Budgets in milliseconds (or unitless for CLS), scaled together. */
const BUDGET = {
  loginDomContentLoaded: 4000 * SCALE,
  loginInteractive: 6000 * SCALE,
  dashboardReadyAfterSignIn: 8000 * SCALE,
  routeChange: 4000 * SCALE,
  totalBlockingTime: 600 * SCALE,
  cumulativeLayoutShift: 0.1,
}

interface Account {
  email: string
  name: string
  role: 'STUDENT' | 'TEACHER'
}

const TEACHER: Account = { email: 'aditya.teacher@mit.ac.in', name: 'Aditya Rao', role: 'TEACHER' }
/** Registered, but on no roster until the teacher adds them. */
const NEW_STUDENT: Account = { email: 'dev.classmate@mit.ac.in', name: 'Dev Classmate', role: 'STUDENT' }
/** Never registers: shows on the roster as an invite. */
const INVITED_EMAIL = 'new.person@mit.ac.in'

/* ------------------------------------------------------------------ helpers */

/** Serves the auth endpoints; identity comes from the bearer token, as the real backend does. */
async function stubAuth(page: Page, account: Account): Promise<void> {
  const profileFor = (route: Route) => {
    const header = route.request().headers().authorization ?? ''
    const email = header.startsWith('Bearer ') ? header.slice('Bearer '.length).split('|')[2] : null
    if (!email) return null
    return {
      uid: `uid-${email}`,
      email,
      displayName: account.name,
      role: account.role,
      collegeId: account.role === 'STUDENT' ? null : 'college-mit',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
  }
  const unauthorized = (route: Route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })
  await page.route('**/api/auth/session', (route) => {
    const user = profileFor(route)
    return user
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user }) })
      : unauthorized(route)
  })
  await page.route('**/api/auth/me', (route) => {
    const user = profileFor(route)
    return user
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) })
      : unauthorized(route)
  })
  await page.route('**/api/auth/logout', (route) => route.fulfill({ status: 204, body: '' }))
}

/**
 * A signed-in page for `account`, in its own browser context so two people can
 * be signed in at once. Pass `state` to share one backend between them -- that
 * is what lets a teacher's change show up for a student.
 */
async function openAs(
  browser: Browser,
  account: Account,
  state?: E2EBackendState,
  contextOptions: Parameters<Browser['newContext']>[0] = {},
): Promise<{ context: BrowserContext; page: Page; state: E2EBackendState }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...contextOptions })
  const page = await context.newPage()
  const shared = await stubTestBackend(page, state)
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
  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(account.role === 'TEACHER' ? /\/app\/dashboard$/ : /\/app\/student$/)
  return { context, page, state: shared }
}

/** Waits until neither the route splash nor any loading skeleton is on screen. */
async function settled(page: Page): Promise<void> {
  await expect(page.getByText(/Preparing your classroom/)).toHaveCount(0, { timeout: 30_000 })
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 })
}

/* ============================================================ 1. FUNCTIONALITY */

test.describe('1. Functionality', () => {
  test('teacher dashboard shows the overview, schedule, grading queue and classrooms', async ({ browser }) => {
    const { context, page } = await openAs(browser, TEACHER)
    await settled(page)

    await expect(page.getByRole('heading', { level: 1, name: /Good (morning|afternoon|evening), Aditya/ })).toBeVisible()
    for (const label of ['Classrooms', 'Students', 'Live now', 'Submissions']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
    }
    await expect(page.getByRole('heading', { name: 'Live and upcoming' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Ready to grade' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Your classrooms' })).toBeVisible()
    // The seeded live test is on the schedule with its next action.
    await expect(page.getByRole('heading', { name: 'Sorting and searching' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Watch submissions/ }).first()).toBeVisible()
    // Navigation: the rail leads with Dashboard for staff.
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Dashboard' })).toBeVisible()

    await context.close()
  })

  test('the classroom page has no join code, and the roster shows joined and invited students', async ({ browser }) => {
    const { context, page } = await openAs(browser, TEACHER)
    await page.goto(`/app/classrooms/${SEEDED_CLASSROOM_ID}`)
    await settled(page)

    await expect(page.getByText('ALGO-204')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Add students' })).toBeVisible()
    await expect(page.getByText('Riya Sharma')).toBeVisible()
    await expect(page.getByText('Joined').first()).toBeVisible()

    // Validation: malformed input is caught before any request is sent.
    await page.getByLabel('Student emails').fill('not-an-email')
    await page.getByRole('button', { name: 'Add to classroom' }).click()
    await expect(page.getByText(/not a valid email/i)).toBeVisible()

    await context.close()
  })

  test('a student has no join box, and is told their teacher adds them', async ({ browser }) => {
    const { context, page } = await openAs(browser, NEW_STUDENT)
    await settled(page)

    await expect(page.getByRole('heading', { level: 1, name: /Hello, Dev/ })).toBeVisible()
    await expect(page.getByText('How you join a class')).toBeVisible()
    await expect(page.getByLabel('Join code')).toHaveCount(0)
    // Not enrolled anywhere yet, so no classroom and no tests.
    await expect(page.getByText(/not in a classroom yet/i)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sorting and searching' })).toHaveCount(0)

    await context.close()
  })
})

/* ============================================================== 2. USER FLOW */

test.describe('2. User flow: teacher adds a student, student sits the exam', () => {
  test.describe.configure({ mode: 'serial' })

  test('end to end, across two signed-in people', async ({ browser }) => {
    test.setTimeout(240_000)

    // --- Teacher adds one registered student and one not-yet-registered email.
    const teacher = await openAs(browser, TEACHER)
    await teacher.page.goto(`/app/classrooms/${SEEDED_CLASSROOM_ID}`)
    await settled(teacher.page)

    await teacher.page.getByLabel('Student emails').fill(`${NEW_STUDENT.email}\n${INVITED_EMAIL}`)
    await teacher.page.getByRole('button', { name: 'Add to classroom' }).click()
    await expect(teacher.page.getByText('2 students added')).toBeVisible()
    await expect(teacher.page.getByText('Dev Classmate')).toBeVisible()
    await expect(teacher.page.getByText(INVITED_EMAIL)).toBeVisible()
    // The badge on that roster row (the stats strip also has an "Invited" label).
    await expect(
      teacher.page.getByRole('listitem').filter({ hasText: INVITED_EMAIL }).getByText('Invited', { exact: true }),
    ).toBeVisible()

    // Adding the same email again is reported, not duplicated.
    await teacher.page.getByLabel('Student emails').fill(NEW_STUDENT.email)
    await teacher.page.getByRole('button', { name: 'Add to classroom' }).click()
    await expect(teacher.page.getByText(/already in this classroom/)).toBeVisible()
    await expect(teacher.page.getByText('Dev Classmate')).toHaveCount(1)

    // --- The student now sees the classroom and its tests.
    const student = await openAs(browser, NEW_STUDENT, teacher.state)
    await settled(student.page)
    await expect(student.page.getByText('CS 204 Algorithms')).toBeVisible()
    await expect(student.page.getByRole('heading', { name: 'Live now' })).toBeVisible()
    await expect(student.page.getByRole('heading', { name: 'Sorting and searching' })).toBeVisible()

    // --- Sits and submits the live exam.
    await student.page.goto(`/app/tests/${SEEDED_LIVE_TEST_ID}/lobby`)
    await student.page.getByRole('button', { name: 'Start exam' }).click()
    await expect(student.page).toHaveURL(new RegExp(`/app/tests/${SEEDED_LIVE_TEST_ID}/exam$`))
    await student.page.getByRole('button', { name: 'Enter fullscreen' }).click()

    // The action bar is reachable without scrolling.
    const submit = student.page.getByRole('button', { name: 'Submit exam' })
    await expect(submit).toBeInViewport()
    await expect(student.page.getByRole('button', { name: 'Next' })).toBeInViewport()

    await submit.click()
    const dialog = student.page.getByRole('dialog')
    await expect(dialog.getByText('Submit your exam?')).toBeVisible()
    await dialog.getByRole('button', { name: 'Submit exam' }).click()
    await expect(student.page.getByRole('button', { name: 'Submitted' })).toBeDisabled()

    // --- Teacher removes the invite and the student, confirming each time.
    for (const name of [INVITED_EMAIL, 'Dev Classmate']) {
      await teacher.page.getByRole('button', { name: `Remove ${name}` }).click()
      await teacher.page.getByRole('dialog').getByRole('button', { name: 'Remove student' }).click()
      await expect(teacher.page.getByRole('dialog')).toHaveCount(0)
    }
    await expect(teacher.page.getByText('Dev Classmate')).toHaveCount(0)
    await expect(teacher.page.getByText(INVITED_EMAIL)).toHaveCount(0)

    // --- The removed student no longer sees the classroom.
    await student.page.goto('/app/student')
    await settled(student.page)
    await expect(student.page.getByText(/not in a classroom yet/i)).toBeVisible()

    await student.context.close()
    await teacher.context.close()
  })
})

/* =============================================================== 3. ANIMATION */

test.describe('3. Animation', () => {
  test('page entrance, route progress, stagger and primary-button sheen are wired up', async ({ browser }) => {
    const { context, page } = await openAs(browser, TEACHER)
    await settled(page)

    const main = page.locator('#main-content')
    await expect(main).toHaveClass(/page-enter/)
    expect(await main.evaluate((el) => getComputedStyle(el).animationName)).toBe('page-enter')

    // Grids and lists cascade in.
    const staggered = page.locator('.stagger > *').first()
    expect(await staggered.evaluate((el) => getComputedStyle(el).animationName)).toBe('rise-in')

    // A navigation replays the gold progress hairline.
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Classrooms' }).click()
    const progress = page.locator('.route-progress')
    await expect(progress).toHaveCount(1)
    expect(await progress.evaluate((el) => getComputedStyle(el).animationName)).toBe('route-progress')

    // The primary action carries the gradient fill and the hover light sweep.
    const primary = page.getByRole('button', { name: /New classroom/ }).first()
    await expect(primary).toHaveClass(/sheen-sweep/)
    expect(await primary.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('gradient')

    await context.close()
  })

  test('interactive cards lean toward the pointer (3D tilt) and settle back', async ({ browser }) => {
    const { context, page } = await openAs(browser, TEACHER)
    await page.goto('/app/classrooms')
    await settled(page)

    const card = page.locator('.tilt').first()
    await expect(card).toBeVisible()
    const box = (await card.boundingBox())!
    // Pointer in the top-right corner: the card should rotate on both axes.
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.1)
    await page.mouse.move(box.x + box.width * 0.92, box.y + box.height * 0.12)
    const tilted = await card.evaluate((el) => ({
      rx: el.style.getPropertyValue('--rx'),
      ry: el.style.getPropertyValue('--ry'),
    }))
    expect(tilted.rx).not.toBe('0deg')
    expect(tilted.ry).not.toBe('0deg')
    // Capped at a few degrees: weight, not spin.
    expect(Math.abs(parseFloat(tilted.rx))).toBeLessThanOrEqual(3)
    expect(Math.abs(parseFloat(tilted.ry))).toBeLessThanOrEqual(3)

    await page.mouse.move(2, 2)
    await expect
      .poll(() => card.evaluate((el) => el.style.getPropertyValue('--rx')))
      .toBe('0deg')

    await context.close()
  })

  test('reduced motion: entrances, ambient light and tilt are all switched off', async ({ browser }) => {
    const { context, page } = await openAs(browser, TEACHER, undefined, { reducedMotion: 'reduce' })
    await settled(page)

    expect(await page.locator('#main-content').evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
    expect(
      await page.evaluate(() => getComputedStyle(document.body, '::before').animationName),
    ).toBe('none')
    const staggered = page.locator('.stagger > *').first()
    expect(await staggered.evaluate((el) => getComputedStyle(el).animationName)).toBe('none')

    await page.goto('/app/classrooms')
    await settled(page)
    const card = page.locator('.tilt').first()
    const box = (await card.boundingBox())!
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.1)
    expect(await card.evaluate((el) => getComputedStyle(el).transform)).toBe('none')

    await context.close()
  })

  test('both themes render their own palette (noir by default, ivory on toggle)', async ({ browser }) => {
    const { context, page } = await openAs(browser, TEACHER)
    await settled(page)

    const canvas = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    const darkCanvas = await canvas()
    await page.getByRole('button', { name: 'Switch to light mode' }).click()
    await expect.poll(canvas).not.toBe(darkCanvas)
    await page.getByRole('button', { name: 'Switch to dark mode' }).click()
    await expect.poll(canvas).toBe(darkCanvas)

    await context.close()
  })
})

/* =================================================================== 4. SPEED */

test.describe('4. Speed', () => {
  test('the login page loads and becomes usable within budget', async ({ page }) => {
    await stubTestBackend(page)
    const started = Date.now()
    await page.goto('/login')
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled()
    const interactiveMs = Date.now() - started

    const domContentLoaded = await page.evaluate(() => {
      const [nav] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]
      return nav ? nav.domContentLoadedEventEnd - nav.startTime : Number.NaN
    })

    test.info().annotations.push(
      { type: 'login DOMContentLoaded (ms)', description: domContentLoaded.toFixed(0) },
      { type: 'login interactive (ms)', description: String(interactiveMs) },
    )
    expect(domContentLoaded).toBeLessThan(BUDGET.loginDomContentLoaded)
    expect(interactiveMs).toBeLessThan(BUDGET.loginInteractive)
  })

  test('sign-in to a fully loaded teacher dashboard is within budget', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    await stubTestBackend(page)
    await stubAuth(page, TEACHER)
    await page.addInitScript(
      ([email, name, password]) => {
        window.localStorage.setItem(
          'e2e.auth.accounts',
          JSON.stringify([{ uid: `uid-${email}`, email, password, displayName: name }]),
        )
      },
      [TEACHER.email, TEACHER.name, PASSWORD] as const,
    )
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEACHER.email)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)

    const started = Date.now()
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { name: 'Live and upcoming' })).toBeVisible({ timeout: 30_000 })
    await settled(page)
    const readyMs = Date.now() - started

    test.info().annotations.push({ type: 'sign-in to dashboard ready (ms)', description: String(readyMs) })
    expect(readyMs).toBeLessThan(BUDGET.dashboardReadyAfterSignIn)
    await context.close()
  })

  test('in-app navigation between pages is within budget', async ({ browser }) => {
    const { context, page } = await openAs(browser, TEACHER)
    await settled(page)
    const nav = page.getByRole('navigation', { name: 'Primary' })

    const timings: Record<string, number> = {}
    for (const [label, heading] of [
      ['Classrooms', 'Classrooms'],
      ['Dashboard', 'Live and upcoming'],
    ] as const) {
      const started = Date.now()
      await nav.getByRole('link', { name: label }).click()
      await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible()
      await settled(page)
      timings[label] = Date.now() - started
    }

    for (const [label, ms] of Object.entries(timings)) {
      test.info().annotations.push({ type: `navigate to ${label} (ms)`, description: String(ms) })
      expect(ms).toBeLessThan(BUDGET.routeChange)
    }
    await context.close()
  })

  test('the dashboard is visually stable and does not block the main thread', async ({ browser }) => {
    const { context, page } = await openAs(browser, TEACHER)

    // Observe from the next navigation onwards.
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number; __tbt: number }
      w.__cls = 0
      w.__tbt = 0
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
          if (!entry.hadRecentInput) w.__cls += entry.value
        }
      }).observe({ type: 'layout-shift', buffered: true })
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) w.__tbt += Math.max(0, entry.duration - 50)
      }).observe({ type: 'longtask', buffered: true })
    })
    await page.reload()
    await settled(page)
    await page.waitForTimeout(1500) // let entrance animations finish

    const { cls, tbt } = await page.evaluate(() => {
      const w = window as unknown as { __cls: number; __tbt: number }
      return { cls: w.__cls, tbt: w.__tbt }
    })
    test.info().annotations.push(
      { type: 'cumulative layout shift', description: cls.toFixed(3) },
      { type: 'total blocking time (ms)', description: tbt.toFixed(0) },
    )
    expect(cls).toBeLessThan(BUDGET.cumulativeLayoutShift)
    expect(tbt).toBeLessThan(BUDGET.totalBlockingTime)
    await context.close()
  })
})
