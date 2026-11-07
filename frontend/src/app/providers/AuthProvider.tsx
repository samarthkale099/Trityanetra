import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { authApi, type SignUpInput } from '@/features/auth/authApi'
import { configureHttpClient, ApiError } from '@/shared/lib/httpClient'
import { roleHomePath } from '@/shared/lib/roles'
import type { UserProfile, UserRole } from '@/shared/types'

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

export interface AuthContextValue {
  user: UserProfile | null
  /** Server-assigned role. Null until the backend profile has been fetched. */
  role: UserRole | null
  /** Server-assigned college. Null for an unassigned account. */
  collegeId: string | null
  token: string | null
  status: AuthStatus
  isAuthenticated: boolean
  isLoading: boolean
  /** Path this role belongs in after signing in. */
  homePath: string
  /**
   * Resolves once the backend has confirmed the role, or with null if that
   * never happens. `signIn` must not settle on the optimistic session, or a
   * caller that navigates immediately would route on a placeholder role and the
   * guard would bounce it straight back to /login.
   */
  signUp: (input: SignUpInput) => Promise<UserProfile | null>
  signIn: (email: string, password: string) => Promise<UserProfile | null>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** How long a sign-in may wait for the session before navigating anyway. */
const SESSION_WAIT_MS = 4000

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')
  // Read by the httpClient outside React's render cycle, so it needs a ref.
  const tokenRef = useRef<string | null>(null)

  /**
   * Resolvers for callers waiting on the session that a sign-in just triggered.
   *
   * `signIn` must not resolve before the server has answered, or a component
   * that navigates straight afterwards would race the route guard: the guard
   * still sees the anonymous/placeholder state and bounces the user to /login.
   */
  const sessionWaiters = useRef<Set<(profile: UserProfile | null) => void>>(new Set())

  const releaseSessionWaiters = useCallback((profile: UserProfile | null) => {
    const waiters = sessionWaiters.current
    sessionWaiters.current = new Set()
    for (const resolve of waiters) resolve(profile)
  }, [])

  /**
   * Registers a one-shot wait for the authoritative session. Resolves null if it
   * never arrives, so a stuck provider cannot leave a submit button spinning.
   */
  const awaitAuthoritativeSession = useCallback(() => {
    let settle: (profile: UserProfile | null) => void = () => {}
    const promise = new Promise<UserProfile | null>((resolve) => {
      settle = resolve
    })
    const waiter = (profile: UserProfile | null) => {
      clearTimeout(timer)
      sessionWaiters.current.delete(waiter)
      settle(profile)
    }
    const timer = setTimeout(() => waiter(null), SESSION_WAIT_MS)
    // Registered before the driver call: `onAuthStateChanged` can fire before
    // the sign-in promise even resolves.
    sessionWaiters.current.add(waiter)
    return { promise, cancel: () => waiter(null) }
  }, [])

  // Wires auth into the shared http client. Effects run child-first, but the
  // client is only used on user-initiated requests, never during this mount.
  useEffect(() => {
    configureHttpClient({
      getToken: () => tokenRef.current,
      refreshToken: () => authApi.refreshIdToken(),
      onUnauthorized: () => {
        // A refresh did not rescue the session: drop it. Firebase is the only
        // source of truth for sign-out, and it is also a local operation, so a
        // network failure here cannot strand the user in a half-signed-in state.
        void authApi.signOut().catch(() => {
          tokenRef.current = null
          setToken(null)
          setUser(null)
          setStatus('anonymous')
        })
      },
    })
  }, [])

  useEffect(() => {
    let mounted = true

    // Persistent login: restore the stored session before listening, otherwise
    // a page refresh flashes the login screen.
    const boot = async () => {
      try {
        await authApi.initialize()
      } catch {
        // Firebase unavailable (not configured, offline). Fall through: the
        // subscription below will report anonymous and the login page will
        // explain the problem.
      }
      if (!mounted) return

      const unsubscribe = authApi.subscribe((session) => {
        if (!mounted) return
        // The optimistic placeholder carries a guessed role. Rendering it let
        // the route guards act on "STUDENT" and send a reloading teacher to
        // the student home before the real role arrived. Keep the current
        // screen (the splash while restoring) until the server confirms.
        if (session && !session.authoritative) return
        if (session) {
          tokenRef.current = session.idToken
          setToken(session.idToken)
          setUser(session.profile)
          setStatus('authenticated')
          // Only a server-confirmed role is safe to navigate on.
          if (session.authoritative) releaseSessionWaiters(session.profile)
        } else {
          tokenRef.current = null
          setToken(null)
          setUser(null)
          setStatus('anonymous')
          releaseSessionWaiters(null)
        }
      })
      return unsubscribe
    }

    let unsubscribe: (() => void) | undefined
    let cancelled = false
    void boot().then((fn) => {
      if (cancelled) {
        fn?.()
        return
      }
      unsubscribe = fn
    })

  return () => {
    cancelled = true
    mounted = false
    unsubscribe?.()
    // Never leave a pending sign-in hanging on an unmounted provider.
    releaseSessionWaiters(null)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [])

  const signUp = useCallback(
    async (input: SignUpInput): Promise<UserProfile | null> => {
      const wait = awaitAuthoritativeSession()
      try {
        await authApi.signUp(input)
      } catch (error) {
        wait.cancel()
        throw error
      }
      return wait.promise
    },
    [awaitAuthoritativeSession],
  )

  const signIn = useCallback(
    async (email: string, password: string): Promise<UserProfile | null> => {
      const wait = awaitAuthoritativeSession()
      try {
        await authApi.signIn(email, password)
      } catch (error) {
        wait.cancel()
        throw error
      }
      return wait.promise
    },
    [awaitAuthoritativeSession],
  )

  const signOut = useCallback(async () => {
    try {
      await authApi.signOut()
    } finally {
      // Clear locally even if the provider throws, so the UI can never be left
      // showing a signed-in shell the backend will reject.
      tokenRef.current = null
      setToken(null)
      setUser(null)
      setStatus('anonymous')
    }
  }, [])

  const resetPassword = useCallback(async (email: string) => {
    await authApi.resetPassword(email)
  }, [])

  const value = useMemo<AuthContextValue>(() => {
    const role = user?.role ?? null
    return {
      user,
      role,
      collegeId: user?.collegeId ?? null,
      token,
      status,
      isAuthenticated: status === 'authenticated',
      isLoading: status === 'loading',
      homePath: roleHomePath(role),
      signUp,
      signIn,
      signOut,
      resetPassword,
    }
  }, [user, token, status, signUp, signIn, signOut, resetPassword])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider')
  }
  return context
}

export { ApiError }
