import { backendAuthDriver, type AuthDriver, type AuthUser } from '@/shared/lib/authDriver'
import { http } from '@/shared/lib/httpClient'
import type { UserProfile } from '@/shared/types'

export interface SessionResult {
  idToken: string
  profile: UserProfile
  /**
   * True once the backend has answered, i.e. the role and college are the
   * server's and not the client-side placeholder. Callers that navigate on
   * sign-in must wait for this, otherwise they route to a placeholder role
   * home and the guard immediately redirects them somewhere else.
   */
  authoritative: boolean
}

export interface SignUpInput {
  email: string
  password: string
  displayName: string
  /** College email domain, e.g. `mit.ac.in`. Advisory client-side only in Phase 1. */
  collegeDomain: string
}

let driver: AuthDriver = backendAuthDriver

/** Test seam: swap the backend auth driver for an in-memory fake. */
export function setAuthDriver(next: AuthDriver): void {
  driver = next
}

/** Maps Firebase error codes to actionable, human-readable messages. */
export function describeAuthError(error: unknown): string {
  const code =
    error && typeof error === 'object' && 'code' in error && typeof (error as { code: unknown }).code === 'string'
      ? (error as { code: string }).code
      : undefined

  switch (code) {
    case 'auth/email-already-in-use':
      return 'That email is already registered. Sign in instead.'
    case 'auth/invalid-email':
      return 'That email address is not formatted correctly.'
    case 'auth/weak-password':
      return 'Use a password of at least 8 characters.'
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-login-credentials':
      return 'The email or password is incorrect.'
    case 'auth/too-many-requests':
      return 'Too many attempts — please wait a minute and try again.'
    case 'auth/network-request-failed':
      return 'Could not reach the authentication service. Check your connection.'
    case 'auth/operation-not-allowed':
      return error instanceof Error && error.message
        ? error.message
        : 'Email and password sign-in is not enabled for this project yet.'
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact your administrator.'
    case undefined:
      // A plain Error carries the server's own explanation (e.g. "We could not
      // find your college from that email"), which is more useful than a generic line.
      return error instanceof Error && error.message ? error.message : 'Authentication failed. Please try again.'
    default:
      return error instanceof Error && error.message.startsWith('Account created')
        ? error.message
        : 'Authentication failed. Please try again.'
  }
}

/**
 * Builds a profile from the Firebase user alone. Role and college are placeholders:
 * only the backend may assign them, so nothing here is trusted for authorisation.
 */
export function profileFor(user: AuthUser): UserProfile {
  return {
    uid: user.uid,
    email: user.email,
    // Firebase leaves `displayName` null for accounts created before it was
    // requested, and for some provider sign-ins. Falling back to the email
    // local part keeps the shell from greeting the user with a blank name.
    displayName: user.displayName?.trim() || user.email.split('@')[0] || user.email,
    role: 'STUDENT',
    collegeId: null,
    createdAt: '',
    updatedAt: '',
  }
}

/**
 * Session open: read the server-side profile (role, college) for this token.
 * The backend's `GET /api/auth/me` answers `{ user }`; role and college come
 * from the users document, never from the client.
 */
async function openSession(idToken: string): Promise<UserProfile> {
  const payload = await http.get<{ user: Partial<UserProfile> & { uid: string; email: string } }>('/api/auth/me', {
    token: idToken,
    // A 401 here means the token was rejected, not that it merely expired.
    // Retrying would only re-send a credential the server refused.
    retryOnUnauthorized: false,
  })
  const user = payload.user
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName?.trim() || user.email.split('@')[0] || user.email,
    role: user.role ?? 'STUDENT',
    collegeId: user.collegeId ?? null,
    createdAt: user.createdAt ?? '',
    updatedAt: user.updatedAt ?? '',
  }
}

/**
 * Bridges Firebase Auth with the backend. All auth actions run through
 * Firebase on the client; the resulting ID token establishes the backend
 * session on every subsequent request.
 */
export const authApi = {
  initialize: () => driver.initialize(),

  subscribe: (onChange: (session: SessionResult | null) => void): (() => void) => {
    let active = true

    /**
     * One session exchange per ID token, for the life of this subscription.
     *
     * A single sign-in does not necessarily produce a single auth event. Firebase
     * fires `onAuthStateChanged` and `onIdTokenChanged` separately, and calling
     * `getIdToken(true)` above can provoke a token change of its own. Every one
     * of those events used to start its own `POST /api/auth/session`, so one
     * sign-in could send two or three identical exchanges, race each other to set
     * the profile, and multiply the work the backend has to do per sign-in.
     *
     * Deduplicating on the token is safe rather than merely convenient: an ID
     * token is immutable for its lifetime, so the same token always maps to the
     * same session. A genuine refresh issues a different token and still gets its
     * own exchange.
     *
     * The cache is scoped to the subscription, not the module, so it dies with the
     * provider. That keeps a remount (and a new test) from serving a stale profile
     * for a token it has already exchanged.
     */
    const exchanged = new Map<string, Promise<UserProfile | null>>()

    const unsubscribe = driver.subscribe((user) => {
      if (!active) return
      if (!user) {
        exchanged.clear()
        onChange(null)
        return
      }
      // The cached token, deliberately not a forced refresh. An auth event says
      // "the current user may have changed"; it is not a reason to spend a
      // network round trip minting a new ID token. Forcing one here gave every
      // event a brand-new token, which defeated the dedupe below and started a
      // fresh session exchange each time. A refresh belongs where staleness is
      // actually known - `refreshIdToken`, called by the httpClient after a 401.
      void driver
        .getIdToken(false)
        .then(async (idToken) => {
          if (!active) return
          if (!idToken) {
            onChange(null)
            return
          }

          let exchange = exchanged.get(idToken)
          if (!exchange) {
            exchange = openSession(idToken).catch(() => null)
            exchanged.set(idToken, exchange)
            // Only the current token is worth remembering; older ones can never
            // be handed out again, so there is no reason to grow the map.
            if (exchanged.size > 1) {
              for (const seen of exchanged.keys()) {
                if (seen !== idToken) exchanged.delete(seen)
              }
            }
          }

          // Optimistic session first so a restored session renders without
          // waiting on the network, but flagged non-authoritative.
          onChange({ idToken, profile: profileFor(user), authoritative: false })
          const profile = await exchange
          if (!active) return
          // If the exchange failed, the placeholder stands but is marked
          // authoritative anyway: waiting for a profile that is never coming
          // would leave the sign-in button spinning until it times out.
          onChange({ idToken, profile: profile ?? profileFor(user), authoritative: true })
        })
        .catch(() => {
          if (active) onChange(null)
        })
    })
    return () => {
      active = false
      unsubscribe()
    }
  },

  signUp: async (input: SignUpInput): Promise<void> => {
    await driver.signUp({ email: input.email, password: input.password, displayName: input.displayName })
  },

  signIn: async (email: string, password: string): Promise<void> => {
    await driver.signIn(email, password)
  },

  signOut: async (): Promise<void> => {
    await driver.signOut()
  },

  resetPassword: async (email: string): Promise<void> => {
    await driver.sendPasswordReset(email)
  },

  /** Forces a token refresh; the httpClient calls this after a 401. */
  refreshIdToken: (): Promise<string | null> => driver.getIdToken(true),

  getIdToken: (): Promise<string | null> => driver.getIdToken(false),

  fetchProfile: async (idToken: string): Promise<UserProfile> => {
    return http.get<UserProfile>('/api/auth/me', { token: idToken })
  },

  /** Same as `fetchProfile` but cancellable — used by TanStack Query so a
   *  superseded or unmounted request does not keep the connection open. */
  fetchProfileWithSignal: async (idToken: string, signal: AbortSignal): Promise<UserProfile> => {
    return http.get<UserProfile>('/api/auth/me', { token: idToken, signal })
  },

  profileFor,
}
