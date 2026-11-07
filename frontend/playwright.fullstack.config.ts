import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Full-stack integration run: the REAL backend, Firestore (emulator), AST
 * engine, Redis and the frontend together, with no stubbed API. Run it with
 * `npm run test:fullstack` (see docs/testing.md). Redis must already be up on
 * 6379, e.g. `docker run -d --name trityanetra-redis -p 6379:6379 redis:7-alpine`.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
const backendDir = path.join(repo, 'backend')
const astDir = path.join(repo, 'ast-engine')

export const FULLSTACK = {
  project: 'demo-fullstack',
  firestore: '127.0.0.1:8081',
  backendPort: 5001,
  frontendPort: 5173,
  astSecret: 'fullstack-ast-secret',
  backendLog: path.join(repo, 'fullstack-backend.log'),
} as const

// Java 21 for the emulator: JAVA_HOME if set, else the portable copy in .tools/.
const portableJdk = path.join(repo, '.tools', 'jdk21')
const javaHome = process.env.JAVA_HOME || (existsSync(portableJdk) ? portableJdk : '')

/** Copies the environment with PATH under one key (Windows has "Path"), prefixed with Java. */
function envWith(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  let pathValue = ''
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (key.toLowerCase() === 'path') pathValue = value
    else env[key] = value
  }
  env.PATH = javaHome ? `${path.join(javaHome, 'bin')}${path.delimiter}${pathValue}` : pathValue
  if (javaHome) env.JAVA_HOME = javaHome
  return { ...env, ...extra }
}

// The AST engine's Python: AST_PYTHON if given, else its local .venv, else `python` on PATH (CI).
const venvPython = path.join(astDir, '.venv', process.platform === 'win32' ? 'Scripts\\python.exe' : 'bin/python')
const python = process.env.AST_PYTHON || (existsSync(venvPython) ? `"${venvPython}"` : 'python')

export default defineConfig({
  testDir: './e2e',
  // The exam walk-through, the user-acceptance checks, then the 50-student class simulation
  // (same seeded database, run in that order).
  testMatch: ['fullstack.spec.ts', 'uat.spec.ts', 'simulation.spec.ts', 'ui-simulation.spec.ts'],
  workers: 1,
  retries: 0,
  timeout: 10 * 60_000,
  // One browser at a time: the steps build on each other.
  fullyParallel: false,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  globalSetup: './e2e/fullstack.setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${FULLSTACK.frontendPort}`,
    trace: 'retain-on-failure',
    // No click or page load may wait forever; a stuck step fails and is reported.
    actionTimeout: 60_000,
    navigationTimeout: 90_000,
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  },
  projects: [{ name: 'fullstack', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Firestore emulator: a fresh, empty database for every run.
      command: `npx firebase emulators:start --only firestore --project ${FULLSTACK.project}`,
      cwd: backendDir,
      // A capped JVM heap keeps the emulator usable on low-memory laptops.
      env: envWith({ JAVA_TOOL_OPTIONS: process.env.JAVA_TOOL_OPTIONS || '-Xmx512m' }),
      url: `http://${FULLSTACK.firestore}`,
      timeout: 240_000,
      reuseExistingServer: false,
    },
    {
      command: `${python} -m uvicorn app:app --host 127.0.0.1 --port 8000`,
      cwd: astDir,
      env: envWith({ AST_ENGINE_INTERNAL_SECRET: FULLSTACK.astSecret }),
      url: 'http://127.0.0.1:8000/health',
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      // Output goes to a file so the test can read the dev verification link.
      command: `npx ts-node --transpile-only src/server.ts > "${FULLSTACK.backendLog}" 2>&1`,
      cwd: backendDir,
      env: envWith({
        NODE_ENV: 'development',
        PORT: String(FULLSTACK.backendPort),
        JWT_SECRET: 'fullstack-jwt-secret-not-for-production',
        REDIS_URL: 'redis://127.0.0.1:6379',
        AST_ENGINE_URL: 'http://127.0.0.1:8000',
        AST_ENGINE_SECRET: FULLSTACK.astSecret,
        FIRESTORE_EMULATOR_HOST: FULLSTACK.firestore,
        GCLOUD_PROJECT: FULLSTACK.project,
        GOOGLE_CLOUD_PROJECT: FULLSTACK.project,
        CODE_EXECUTION_PROVIDER: process.env.CODE_EXECUTION_PROVIDER || 'paiza',
        APP_BASE_URL: `http://127.0.0.1:${FULLSTACK.frontendPort}`,
        SMTP_URL: '',
      }),
      // 401 counts as "up": the route exists and needs a token.
      url: `http://127.0.0.1:${FULLSTACK.backendPort}/api/auth/me`,
      timeout: 180_000,
      reuseExistingServer: false,
    },
    {
      command: `npx vite --port ${FULLSTACK.frontendPort} --strictPort --host 127.0.0.1`,
      cwd: here,
      env: envWith({ BACKEND_URL: `http://127.0.0.1:${FULLSTACK.backendPort}` }),
      url: `http://127.0.0.1:${FULLSTACK.frontendPort}`,
      timeout: 180_000,
      reuseExistingServer: false,
    },
  ],
})
