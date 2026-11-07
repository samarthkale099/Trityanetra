import { apiUrl } from '@/shared/lib/env'
import type { AuthDriver, AuthUser } from '@/shared/lib/authTypes'

export type { AuthDriver, AuthUser, SignUpInput } from '@/shared/lib/authTypes'

/**
 * Sign-in against the Trityanetra backend's own auth (`/api/auth/login`,
 * `/api/auth/register`), which issues a signed JWT valid for one day.
 *
 * The token is kept in localStorage so a session survives a reload, exactly as
 * the previous Firebase persistence did. It is only ever *read* here to know
 * who is signed in and when it expires -- the backend verifies its signature on
 * every request, so nothing the browser does to it can grant access.
 *
 * Errors carry Firebase-style `code`s (`auth/invalid-credential`, ...) so the
 * existing `describeAuthError` messages keep working unchanged.
 */

const TOKEN_KEY = 'trityanetra:token'

interface TokenClaims {
  uid?: string
  email?: string
  displayName?: string
  exp?: number
}

function decodeClaims(token: string): TokenClaims | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')
    const json = decodeURIComponent(
      Array.from(atob(base64), (char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''),
    )
    return JSON.parse(json) as TokenClaims
  } catch {
    return null
  }
}

/** A token is usable until 30 s before its `exp`, so a request never lands just after expiry. */
function isUsable(token: string | null): token is string {
  if (!token) return false
  const claims = decodeClaims(token)
  if (!claims?.uid) return false
  return typeof claims.exp !== 'number' || claims.exp * 1000 - 30_000 > Date.now()
}

function readToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function writeToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token)
    else window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Storage blocked: the session lasts for this page only.
  }
}

let current: string | null = null
const listeners = new Set<(user: AuthUser | null) => void>()

function userFrom(token: string | null): AuthUser | null {
  if (!isUsable(token)) return null
  const claims = decodeClaims(token)!
  const email = claims.email ?? ''
  return {
    uid: claims.uid!,
    email,
    displayName: claims.displayName?.trim() || email.split('@')[0] || 'Student',
  }
}

function setToken(token: string | null) {
  current = isUsable(token) ? token : null
  writeToken(current)
  const user = userFrom(current)
  for (const listener of listeners) listener(user)
}

/** An Error with a Firebase-style `code`, for `describeAuthError`. */
function authError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

async function postJson(path: string, body: unknown): Promise<{ status: number; data: any }> {
  let response: Response
  try {
    response = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw authError('auth/network-request-failed', 'Could not reach the server.')
  }
  const data = await response.json().catch(() => ({}))
  return { status: response.status, data }
}

export const backendAuthDriver: AuthDriver = {
  initialize: async () => {
    current = isUsable(readToken()) ? readToken() : null
    if (!current) writeToken(null)
  },

  subscribe: (listener) => {
    listeners.add(listener)
    // Like Firebase's onAuthStateChanged: report the current state immediately.
    queueMicrotask(() => {
      if (listeners.has(listener)) listener(userFrom(current))
    })
    return () => {
      listeners.delete(listener)
    }
  },

  signUp: async ({ email, password, displayName }) => {
    // Self-registration always creates a STUDENT; the backend refuses anything
    // else. The college is resolved server-side from the email's domain.
    const { status, data } = await postJson('/api/auth/register', {
      email,
      password,
      displayName,
      role: 'STUDENT',
    })
    if (status === 201) {
      try {
        await backendAuthDriver.signIn(email, password)
      } catch (error) {
        // The usual case: the account must confirm its email before it can
        // sign in. That is not a failure, so it gets its own code.
        if ((error as { code?: string }).code === 'auth/email-not-verified') {
          throw authError('auth/verification-sent', String(data?.message ?? 'Check your email.'))
        }
        throw error
      }
      return
    }
    const message = String(data?.error ?? data?.message ?? '')
    if (/already registered/i.test(message)) throw authError('auth/email-already-in-use', message)
    if (status === 400 && message) throw new Error(message)
    throw authError('auth/unknown', message || 'Registration failed.')
  },

  signIn: async (email, password) => {
    const { status, data } = await postJson('/api/auth/login', { email, password })
    if (status === 200 && typeof data?.token === 'string') {
      setToken(data.token)
      if (!current) throw authError('auth/invalid-credential', 'The server returned an unusable session.')
      return
    }
    if (status === 401 || status === 400) throw authError('auth/invalid-credential', 'Invalid credentials')
    if (status === 403 && data?.code === 'EMAIL_NOT_VERIFIED') {
      throw authError('auth/email-not-verified', String(data?.error ?? 'Please verify your email first.'))
    }
    if (status === 429) throw authError('auth/too-many-requests', 'Too many attempts')
    throw authError('auth/unknown', String(data?.error ?? 'Sign-in failed.'))
  },

  signOut: async () => {
    setToken(null)
  },

  sendPasswordReset: async () => {
    // The backend has no self-service reset yet; an administrator resets passwords.
    throw authError(
      'auth/operation-not-allowed',
      'Password reset is not available yet. Ask your administrator to reset it.',
    )
  },

  getIdToken: async () => {
    // A JWT cannot be refreshed client-side: once it expires the user signs in again.
    if (!isUsable(current)) {
      if (current) setToken(null)
      return null
    }
    return current
  },
}

/** @deprecated Firebase auth was replaced by the backend's own login; kept as an alias. */
export const firebaseAuthDriver = backendAuthDriver
