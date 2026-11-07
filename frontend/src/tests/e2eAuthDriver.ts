import type { AuthDriver, AuthUser } from '@/shared/lib/authTypes'

/**
 * In-memory auth driver, aliased in for `@/shared/lib/authDriver` by
 * `vite --mode e2e`.
 *
 * A Vite alias is used rather than a runtime flag so the Firebase SDK is not
 * merely skipped but is not part of the E2E bundle at all: the suite cannot
 * accidentally reach a real project, and a real build can never ship the fake.
 * Accounts live in `localStorage` so that "refresh the page and stay signed in"
 * is exercised for real, the same way Firebase persistence is.
 *
 * The backend is still mocked by Playwright, not here, so the app talks to a
 * stubbed HTTP surface exactly as it would to Express.
 */

interface StoredAccount {
  uid: string
  email: string
  password: string
  displayName: string
}

const ACCOUNTS_KEY = 'e2e.auth.accounts'
const SESSION_KEY = 'e2e.auth.session'

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // A blocked storage API just means the session does not survive a reload,
    // which is a valid state for the app to handle.
  }
}

function remove(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // See above.
  }
}

/** Firebase-style errors, so `describeAuthError` is exercised for real. */
class FakeAuthError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.name = 'FirebaseError'
    this.code = code
  }
}

const listeners = new Set<(user: AuthUser | null) => void>()
let uidCounter = 0

const accounts = (): StoredAccount[] => read<StoredAccount[]>(ACCOUNTS_KEY, [])
const session = (): AuthUser | null => read<AuthUser | null>(SESSION_KEY, null)
const toUser = (account: StoredAccount): AuthUser => ({
  uid: account.uid,
  email: account.email,
  displayName: account.displayName,
})

function emit(): void {
  const current = session()
  for (const listener of [...listeners]) listener(current)
}

function findAccount(email: string): StoredAccount | undefined {
  const normalized = email.trim().toLowerCase()
  return accounts().find((account) => account.email === normalized)
}

export const backendAuthDriver: AuthDriver = {
  initialize: async () => {
    // Nothing to negotiate: the session is already in localStorage.
  },

  subscribe: (listener) => {
    listeners.add(listener)
    // `onAuthStateChanged` always fires once on registration, with the session
    // that was current at that moment.
    const snapshot = session()
    queueMicrotask(() => {
      if (listeners.has(listener)) listener(snapshot)
    })
    return () => {
      listeners.delete(listener)
    }
  },

  signUp: async ({ email, password, displayName }) => {
    const normalized = email.trim().toLowerCase()
    if (findAccount(normalized)) throw new FakeAuthError('auth/email-already-in-use')
    if (password.length < 8) throw new FakeAuthError('auth/weak-password')
    uidCounter += 1
    const account: StoredAccount = { uid: `e2e-u-${uidCounter}`, email: normalized, password, displayName }
    write(ACCOUNTS_KEY, [...accounts(), account])
    write(SESSION_KEY, toUser(account))
    queueMicrotask(emit)
  },

  signIn: async (email, password) => {
    const account = findAccount(email)
    if (!account || account.password !== password) throw new FakeAuthError('auth/invalid-credential')
    write(SESSION_KEY, toUser(account))
    queueMicrotask(emit)
  },

  signOut: async () => {
    remove(SESSION_KEY)
    queueMicrotask(emit)
  },

  sendPasswordReset: async (email) => {
    if (!findAccount(email)) throw new FakeAuthError('auth/user-not-found')
  },

  getIdToken: async () => {
    const current = session()
    if (!current) return null
    // Carries the email so the Playwright stub can resolve the identity the way
    // the real backend does: by verifying the token, never from the request body.
    return `e2e-id-token|${current.uid}|${current.email}`
  },
}
