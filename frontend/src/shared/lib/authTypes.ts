/**
 * The auth contract, kept free of any Firebase import.
 *
 * Production code depends on these types and on the `AuthDriver` interface only,
 * never on `firebase/auth` directly. The Playwright suite aliases
 * `@/shared/lib/authDriver` to an in-memory implementation in `--mode e2e`, so
 * this file is the one piece both sides share and cannot be aliased away.
 */

export interface AuthUser {
  uid: string
  email: string
  displayName: string
}

export interface SignUpInput {
  email: string
  password: string
  displayName: string
}

/**
 * The seam between the app and Firebase Authentication.
 *
 * The Playwright suite swaps the module for an in-memory fake through a Vite
 * alias in `--mode e2e`, so mock auth is unreachable in a real build rather than
 * merely disabled by a flag.
 */
export interface AuthDriver {
  /** Restores the persisted session before the first `onAuthChange` fires. */
  initialize: () => Promise<void>
  subscribe: (listener: (user: AuthUser | null) => void) => () => void
  signUp: (input: SignUpInput) => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  sendPasswordReset: (email: string) => Promise<void>
  /** Current ID token with a forced refresh — used after a 401. */
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>
}
