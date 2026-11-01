import type { AuthDriver, AuthUser, SignUpInput } from '@/shared/lib/authDriver'
import { firebaseAuthDriver } from '@/shared/lib/authDriver'
import { setAuthDriver } from '@/features/auth/authApi'

/**
 * In-memory `AuthDriver` for tests and the E2E suite.
 *
 * It replaces the whole Firebase surface — sign-up, sign-in, sign-out, token
 * refresh — so the auth flow can be exercised end to end with no network, no
 * project, and no credentials. Errors carry real Firebase-style `code` values
 * so `describeAuthError` is covered by the same branches as production.
 */

export interface FakeAccount {
  uid: string
  email: string
  password: string
  displayName: string
}

export interface FakeAuthState {
  accounts: FakeAccount[]
  current: AuthUser | null
  /** Forces the next `getIdToken` to reject, simulating a revoked session. */
  tokenFailures: number
  /** Persisted session, standing in for Firebase's IndexedDB store. */
  persisted: AuthUser | null
  initialized: boolean
}

export class FakeAuthError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.name = 'FirebaseError'
    this.code = code
  }
}

let uidCounter = 0

export function createFakeAuthDriver(seed: Partial<FakeAuthState> = {}) {
  const state: FakeAuthState = {
    accounts: seed.accounts ?? [],
    current: seed.current ?? null,
    tokenFailures: seed.tokenFailures ?? 0,
    persisted: seed.persisted ?? null,
    initialized: false,
  }

  const listeners = new Set<(user: AuthUser | null) => void>()
  let tokenCounter = 0
  /**
   * The current ID token, cached the way Firebase caches it.
   *
   * Firebase keeps handing back the same token until it is explicitly refreshed
   * or actually expires. Minting a fresh one on every call would be a quieter
   * but more damaging lie: the app would look like it had a new credential each
   * time it asked, and any code that keys behaviour off token identity - such as
   * deciding whether a session still needs exchanging - would never converge.
   */
  let currentToken: string | null = null
  /** The uid `currentToken` was minted for; null when there is no token. */
  let tokenUid: string | null = null

  const mintToken = (uid: string) => {
    tokenCounter += 1
    currentToken = `fake-id-token.${uid}.${tokenCounter}`
    tokenUid = uid
    return currentToken
  }

  /** Drops the cached token, so the next read mints a new one. */
  const forgetToken = () => {
    currentToken = null
    tokenUid = null
  }

  const emit = () => {
    for (const listener of listeners) listener(state.current)
  }

  const findAccount = (email: string) =>
    state.accounts.find((account) => account.email === email.trim().toLowerCase())

  const driver: AuthDriver = {
    initialize: async () => {
      state.initialized = true
      // Restores the persisted session, exactly like Firebase's persistence.
      if (state.current === null && state.persisted !== null) {
        state.current = state.persisted
        queueMicrotask(emit)
      }
    },

    subscribe: (listener) => {
      listeners.add(listener)
      // `onAuthStateChanged` always fires once on registration, with the user
      // that was current at that moment. Without that initial event AuthProvider
      // would sit in `loading` forever, so the fake has to reproduce it — and
      // it must snapshot the value now, not read it when the callback runs.
      const snapshot = state.current
      queueMicrotask(() => {
        if (listeners.has(listener)) listener(snapshot)
      })
      return () => {
        listeners.delete(listener)
      }
    },

    signUp: async ({ email, password, displayName }: SignUpInput) => {
      const normalized = email.trim().toLowerCase()
      if (findAccount(normalized)) throw new FakeAuthError('auth/email-already-in-use')
      if (password.length < 8) throw new FakeAuthError('auth/weak-password')
      uidCounter += 1
      const account: FakeAccount = { uid: `u-${uidCounter}`, email: normalized, password, displayName }
      state.accounts.push(account)
      state.current = { uid: account.uid, email: account.email, displayName: account.displayName }
      state.persisted = state.current
      forgetToken()
      queueMicrotask(emit)
    },

    signIn: async (email, password) => {
      const account = findAccount(email)
      if (!account || account.password !== password) throw new FakeAuthError('auth/invalid-credential')
      state.current = { uid: account.uid, email: account.email, displayName: account.displayName }
      state.persisted = state.current
      forgetToken()
      queueMicrotask(emit)
    },

    signOut: async () => {
      state.current = null
      state.persisted = null
      forgetToken()
      queueMicrotask(emit)
    },

    sendPasswordReset: async (email) => {
      if (!findAccount(email)) throw new FakeAuthError('auth/user-not-found')
    },

    getIdToken: async (forceRefresh = false) => {
      if (state.tokenFailures > 0) {
        state.tokenFailures -= 1
        throw new FakeAuthError('auth/user-token-expired')
      }
      if (!state.current) {
        forgetToken()
        return null
      }
      // A different user, or an explicit refresh, is what issues a new token.
      if (forceRefresh || currentToken === null || tokenUid !== state.current.uid) {
        return mintToken(state.current.uid)
      }
      return currentToken
    },
  }

  return { driver, state }
}

export type FakeAuthDriverHandle = ReturnType<typeof createFakeAuthDriver>

/**
 * Swaps the real Firebase driver for a fake for the rest of the file.
 * Vitest isolates the module registry per test file, so no reset is needed
 * between files and no real credential is ever touched.
 */
export function installFakeAuth(seed: Partial<FakeAuthState> = {}): FakeAuthDriverHandle {
  const handle = createFakeAuthDriver(seed)
  setAuthDriver(handle.driver)
  return handle
}

export function restoreRealAuthDriver(): void {
  setAuthDriver(firebaseAuthDriver)
}
