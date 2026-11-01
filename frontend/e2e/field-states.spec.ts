import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

/**
 * Field border states on Login and Register: screenshots, plus a real browser
 * check that the border follows the design tokens.
 *
 * The bug this guards was a selector, not a style: `aria-[invalid]` compiles to
 * the *presence* selector `[aria-invalid]`, and a valid field still carries
 * `aria-invalid="false"`, so every field wore the danger border from first paint.
 * jsdom has no CSS, so the regression can only be observed here, where
 * `getComputedStyle` sees the compiled stylesheet.
 *
 * Output: `test-results/ui-shots/`. Playwright empties `test-results` when a run
 * starts; these are written during the run, so they survive it.
 *
 * Chromium only: the theme and viewport are chosen here, so running the same
 * capture under the `mobile` project would write each file twice.
 */

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-results', 'ui-shots')
const THEME_KEY = 'trityanetra:theme'

interface FieldCase {
  readonly label: 'login' | 'register'
  readonly path: string
  readonly field: string
  readonly submit: string
  readonly errorText: RegExp
}

const PAGES: readonly FieldCase[] = [
  { label: 'login', path: '/login', field: 'Email', submit: 'Sign in', errorText: /enter your email address/i },
  {
    label: 'register',
    path: '/register',
    field: 'Full name',
    submit: 'Create account',
    errorText: /enter your full name/i,
  },
]

/** Resolves a design token to the rgb() string `getComputedStyle` reports. */
function tokenColor(page: Page, cssVar: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${name})`
    document.body.appendChild(probe)
    const value = getComputedStyle(probe).color
    probe.remove()
    return value
  }, cssVar)
}

function borderColor(page: Page, label: string): Promise<string> {
  return page
    .getByLabel(label, { exact: true })
    .evaluate((el) => getComputedStyle(el).borderTopColor)
}

/** The theme is persisted, so a reload after seeding it is deterministic. */
async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [THEME_KEY, theme] as const)
  await page.reload()
}

function chromiumOnly(): void {
  test.skip(test.info().project.name !== 'chromium', 'Theme and viewport are chosen here.')
}

test.describe('field border states', () => {
  for (const pageCase of PAGES) {
    test(`${pageCase.label}: neutral empty, brand focused, danger only on error`, async ({ page }) => {
      chromiumOnly()
      mkdirSync(OUT_DIR, { recursive: true })

      await page.setViewportSize({ width: 1100, height: 900 })
      await page.goto(pageCase.path)

      for (const theme of ['light', 'dark'] as const) {
        await setTheme(page, theme)
        await expect(page.getByLabel(pageCase.field, { exact: true })).toBeVisible()

        const neutral = await tokenColor(page, '--line')
        const brand = await tokenColor(page, '--brand-text')
        const danger = await tokenColor(page, '--danger')

        // The border is `transition-[border-color] duration-150`, so a state
        // change has to be polled until it settles rather than read once.
        const settledBorder = () => expect.poll(() => borderColor(page, pageCase.field))

        // Empty and untouched: the neutral token, never the error colour.
        await settledBorder().toBe(neutral)
        await page.screenshot({
          path: path.join(OUT_DIR, `${pageCase.label}-empty-${theme}.png`),
          animations: 'disabled',
        })

        // Focused: the brand blue, with the ring from `--brand-text`.
        await page.getByLabel(pageCase.field, { exact: true }).focus()
        await settledBorder().toBe(brand)
        await page.screenshot({
          path: path.join(OUT_DIR, `${pageCase.label}-focused-${theme}.png`),
          animations: 'disabled',
        })

        // Error: only now does the border take the danger token.
        await page.getByRole('button', { name: pageCase.submit }).click()
        await expect(page.getByText(pageCase.errorText)).toBeVisible()
        await settledBorder().toBe(danger)
        await page.screenshot({
          path: path.join(OUT_DIR, `${pageCase.label}-error-${theme}.png`),
          animations: 'disabled',
        })
      }
    })
  }
})
