import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Seeds the emulator once all four servers are up (Playwright starts webServers before globalSetup). */
export default function globalSetup() {
  const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend')
  execSync('npx ts-node --transpile-only scripts/seed-fullstack.ts', {
    cwd: backendDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8081',
      GCLOUD_PROJECT: 'demo-fullstack',
      GOOGLE_CLOUD_PROJECT: 'demo-fullstack',
    },
  })
}
