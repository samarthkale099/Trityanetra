import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http as mswHttp, HttpResponse } from 'msw'
import { server } from '@/tests/msw/server'
import { API, makeProfile } from '@/tests/msw/handlers'
import { installFakeAuth, restoreRealAuthDriver } from '@/tests/fakeAuthDriver'
import { authApi, describeAuthError, profileFor, setAuthDriver } from '@/features/auth/authApi'
import { configureHttpClient } from '@/shared/lib/httpClient'

const ACCOUNT = {
  uid: 'u-1',
  email: 'riya@mit.ac.in',
  password: 'secret123',
  displayName: 'Riya Sharma',
}

function configureForToken(token: string | null) {
  configureHttpClient({
    getToken: () => token,
    refreshToken: () => authApi.refreshIdToken(),
  })
}

/** Lets the fake driver's queued microtask (which emits the auth change) run. */
async function flushAuth() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('authApi (Firebase driver bridge)', () => {
  beforeEach(() => {
    configureForToken(null)
  })

  afterEach(() => {
    restoreRealAuthDriver()
  })

  describe('describeAuthError', () => {
    it.each([
      ['auth/email-already-in-use', /already registered/i],
      ['auth/invalid-email', /not formatted correctly/i],
      ['auth/weak-password', /at least 8 characters/i],
      ['auth/invalid-credential', /email or password is incorrect/i],
      ['auth/wrong-password', /email or password is incorrect/i],
      ['auth/user-not-found', /email or password is incorrect/i],
      ['auth/invalid-login-credentials', /email or password is incorrect/i],
      ['auth/too-many-requests', /wait 15 minutes/i],
      ['auth/network-request-failed', /could not reach the authentication service/i],
      ['auth/operation-not-allowed', /not enabled for this project/i],
      ['auth/user-disabled', /disabled/i],
    ])('maps %s to a readable message', (code, pattern) => {
      expect(describeAuthError({ code })).toMatch(pattern)
    })

    it('falls back to a generic message for an unknown code', () => {
      expect(describeAuthError({ code: 'auth/something-new' })).toMatch(/Authentication failed/i)
    })

    it('falls back for a value that is not an error object at all', () => {
      expect(describeAuthError(undefined)).toMatch(/Authentication failed/i)
      expect(describeAuthError('a string')).toMatch(/Authentication failed/i)
    })

    it('surfaces the display-name failure raised by the driver', () => {
      expect(describeAuthError(new Error('Account created, but your display name could not be saved.'))).toMatch(
        /display name could not be saved/,
      )
    })
  })

  describe('profileFor', () => {
    it('never invents a role or college: the backend owns both', () => {
      const profile = profileFor({ uid: 'u-1', email: 'riya@mit.ac.in', displayName: 'Riya Sharma' })
      expect(profile.role).toBe('STUDENT')
      expect(profile.collegeId).toBeNull()
    })

    it('falls back to the email local part when Firebase has no display name', () => {
      expect(profileFor({ uid: 'u-1', email: 'riya@mit.ac.in', displayName: '' }).displayName).toBe('riya')
    })
  })

  describe('subscribe', () => {
    it('emits an optimistic session, then refines it with the server profile', async () => {
      const teacher = makeProfile({ role: 'TEACHER', collegeId: 'c-1' })
      server.use(mswHttp.get(API.me, () => HttpResponse.json({ user: teacher })))
      const handle = installFakeAuth({ accounts: [ACCOUNT] })
      setAuthDriver(handle.driver)

      const seen: Array<{ role: string; collegeId: string | null; authoritative: boolean } | null> = []
      const unsubscribe = authApi.subscribe((session) => {
        seen.push(
          session
            ? { role: session.profile.role, collegeId: session.profile.collegeId, authoritative: session.authoritative }
            : null,
        )
      })

      await handle.driver.signIn(ACCOUNT.email, ACCOUNT.password)
      await flushAuth()
      await vi.waitFor(() => expect(seen.some((s) => s?.authoritative === true)).toBe(true))

      // Anonymous on subscribe, then optimistic so routing never blocks, then
      // the server's role.
      expect(seen).toEqual([
        null,
        { role: 'STUDENT', collegeId: null, authoritative: false },
        { role: 'TEACHER', collegeId: 'c-1', authoritative: true },
      ])
      unsubscribe()
    })

    it('emits null when the user signs out', async () => {
      const handle = installFakeAuth({ accounts: [ACCOUNT] })
      setAuthDriver(handle.driver)
      const seen: unknown[] = []
      const unsubscribe = authApi.subscribe((session) => seen.push(session))

      await handle.driver.signIn(ACCOUNT.email, ACCOUNT.password)
      await flushAuth()
      await handle.driver.signOut()
      await flushAuth()

      expect(seen[seen.length - 1]).toBeNull()
      unsubscribe()
    })

    it('never settles on a guessed role when the backend stays unreachable', async () => {
      server.use(mswHttp.get(API.me, () => HttpResponse.error()))
      const handle = installFakeAuth({ accounts: [ACCOUNT] })
      setAuthDriver(handle.driver)

      const seen: Array<{ role: string } | null> = []
      const unsubscribe = authApi.subscribe((session) => seen.push(session ? { role: session.profile.role } : null))

      await handle.driver.signIn(ACCOUNT.email, ACCOUNT.password)
      await flushAuth()
      // After the retries the result is "no session", not the placeholder:
      // its STUDENT role is a guess and would show a teacher the wrong app.
      await vi.waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(3), { timeout: 5000 })

      // The middle entry is the optimistic placeholder, which AuthProvider
      // never renders (it is not authoritative).
      expect(seen).toEqual([null, { role: 'STUDENT' }, null])
      unsubscribe()
    })

    it('emits null when the ID token cannot be obtained', async () => {
      const handle = installFakeAuth({ accounts: [ACCOUNT], tokenFailures: 1 })
      setAuthDriver(handle.driver)

      const seen: unknown[] = []
      const unsubscribe = authApi.subscribe((session) => seen.push(session))

      await handle.driver.signIn(ACCOUNT.email, ACCOUNT.password)
      await flushAuth()

      // Never a session: a token that cannot be minted is a signed-out state,
      // not an optimistic placeholder.
      expect(seen).not.toContainEqual(expect.objectContaining({ profile: expect.anything() }))
      expect(seen[seen.length - 1]).toBeNull()
      unsubscribe()
    })

    it('stops delivering after unsubscribe', async () => {
      const handle = installFakeAuth({ accounts: [ACCOUNT] })
      setAuthDriver(handle.driver)
      const seen: unknown[] = []
      const unsubscribe = authApi.subscribe((session) => seen.push(session))
      unsubscribe()

      await handle.driver.signIn(ACCOUNT.email, ACCOUNT.password)
      await flushAuth()

      expect(seen).toEqual([])
    })
  })

  describe('session exchange', () => {
    it('sends the token in the Authorization header, never in the body', async () => {
      let body: unknown = 'not-called'
      server.use(
        mswHttp.get(API.me, async ({ request }) => {
          body = await request.text()
          expect(request.headers.get('Authorization')).toMatch(/^Bearer fake-id-token\./)
          return HttpResponse.json({ user: makeProfile() })
        }),
      )
      const handle = installFakeAuth()
      setAuthDriver(handle.driver)

      // Subscribe first: the driver only emits on sign-up, not on subscribe.
      const unsubscribe = authApi.subscribe(() => {})
      await authApi.signUp({
        email: ACCOUNT.email,
        password: ACCOUNT.password,
        displayName: ACCOUNT.displayName,
        collegeDomain: 'mit.ac.in',
      })
      await flushAuth()
      await vi.waitFor(() => expect(body).not.toBe('not-called'))
      unsubscribe()

      // No body at all: a token in a payload is far likelier to be logged.
      expect(body).toBe('')
    })

    it('returns the server profile from fetchProfile', async () => {
      const teacher = makeProfile({ role: 'TEACHER' })
      server.use(mswHttp.get(API.me, () => HttpResponse.json(teacher)))
      await expect(authApi.fetchProfile('tok')).resolves.toMatchObject({ role: 'TEACHER' })
    })

    it('propagates a normalised ApiError from fetchProfile', async () => {
      server.use(mswHttp.get(API.me, () => HttpResponse.json({ message: 'Nope.' }, { status: 500 })))
      await expect(authApi.fetchProfile('tok')).rejects.toMatchObject({ status: 500, message: 'Nope.' })
    })

    it('supports cancelling a profile fetch', async () => {
      server.use(
        mswHttp.get(API.me, async () => {
          await new Promise((resolve) => setTimeout(resolve, 50))
          return HttpResponse.json(makeProfile())
        }),
      )
      const controller = new AbortController()
      const pending = authApi.fetchProfileWithSignal('tok', controller.signal).catch((e: unknown) => e)
      controller.abort()
      const error = (await pending) as { isAborted: boolean }
      expect(error.isAborted).toBe(true)
    })
  })

  describe('actions delegate to the driver', () => {
    it('signs up, signs in, signs out, and sends a reset email', async () => {
      const handle = installFakeAuth()
      setAuthDriver(handle.driver)

      const newAccount = {
        email: 'newcomer@mit.ac.in',
        password: 'freshpass1',
        displayName: 'New Comer',
      }
      await authApi.signUp({ ...newAccount, collegeDomain: 'mit.ac.in' })
      // A brand-new account, so the uid is freshly minted.
      expect(handle.state.current?.email).toBe(newAccount.email)
      expect(handle.state.current?.displayName).toBe(newAccount.displayName)
      expect(handle.state.current?.uid).toBeTruthy()

      await authApi.signOut()
      expect(handle.state.current).toBeNull()

      await authApi.signIn(newAccount.email, newAccount.password)
      expect(handle.state.current?.email).toBe(newAccount.email)

      await expect(authApi.resetPassword(newAccount.email)).resolves.toBeUndefined()
    })

    it('surfaces a duplicate-registration error from the driver', async () => {
      const handle = installFakeAuth({ accounts: [ACCOUNT] })
      setAuthDriver(handle.driver)
      await expect(
        authApi.signUp({
          email: ACCOUNT.email,
          password: ACCOUNT.password,
          displayName: 'Riya Sharma',
          collegeDomain: 'mit.ac.in',
        }),
      ).rejects.toMatchObject({ code: 'auth/email-already-in-use' })
    })

    it('restores a persisted session on initialize', async () => {
      const handle = installFakeAuth({
        accounts: [ACCOUNT],
        persisted: { uid: 'u-1', email: ACCOUNT.email, displayName: ACCOUNT.displayName },
      })
      setAuthDriver(handle.driver)
      const seen: unknown[] = []
      const unsubscribe = authApi.subscribe((session) => seen.push(session))

      // Subscribe fires immediately with no user, exactly like onAuthStateChanged.
      await flushAuth()
      expect(seen[0]).toBeNull()

      await handle.driver.initialize()
      await flushAuth()

      expect(seen[seen.length - 1]).toMatchObject({ profile: { uid: 'u-1' } })
      unsubscribe()
    })
  })
})
