import { defineConfig, devices } from '@playwright/test'

/**
 * The E2E suite runs against a production build made in `--mode e2e`, which
 * swaps the Firebase auth driver for an in-memory one and lets Playwright stub
 * the backend routes. No Firebase project, no credentials, no running server.
 *
 *   npm run e2e -w @trityanetra/frontend
 */
const PORT = 4173

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    // Opt-in: drive an installed browser instead of Playwright's download,
    // e.g. `PW_CHANNEL=msedge` where the browser download is blocked.
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    // A real build, not the dev server: it is the only way to prove the mock
    // driver is absent from a normal bundle and that lazy chunks resolve.
    command: `npx vite build --mode e2e && npx vite preview --mode e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
