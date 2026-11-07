/**
 * Runtime configuration read from Vite env vars.
 *
 * Only `VITE_*` values reach the browser bundle, and none of them are secrets:
 * the Firebase *web* config is a public identifier, and the API base URL is a
 * host. Service-account credentials live only on the backend.
 */

const RAW_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').trim()
const RAW_API_TIMEOUT_MS = (import.meta.env.VITE_API_TIMEOUT_MS ?? '').trim()
const RAW_DEV_MODE = (import.meta.env.VITE_DEV_MODE ?? '').trim()

/**
 * Prefix for every API call. Empty by default so requests are same-origin and
 * the Vite dev proxy (or a reverse proxy in production) handles `/api`.
 */
export const API_BASE_URL = RAW_API_BASE_URL.replace(/\/+$/, '')

/** Abort a request after this many milliseconds. 15s is well past a healthy API round trip. */
export const API_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(RAW_API_TIMEOUT_MS, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15_000
})()

/**
 * Opt-in mock mode used by the Playwright suite so E2E can run without live
 * Firebase or a backend. Enabled per `vite --mode e2e`, never in a real deploy:
 * `npm run build` runs in `production` mode where this is always false.
 */
export const DEV_MODE = RAW_DEV_MODE === 'true' && import.meta.env.DEV

/** Joins the configured base URL with a path, tolerating leading/trailing slashes. */
export function apiUrl(path: string): string {
  if (!path.startsWith('/')) return `${API_BASE_URL}/${path}`
  return `${API_BASE_URL}${path}`
}
