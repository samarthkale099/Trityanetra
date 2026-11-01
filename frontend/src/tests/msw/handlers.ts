import { http as mswHttp, HttpResponse, delay } from 'msw'
import type { UserProfile, UserRole } from '@/shared/types'

/**
 * MSW handlers mirroring the real backend (`backend/src/modules/auth`).
 *
 * These are the contract the frontend is written against, so a shape drift here
 * is a real bug: every assertion in the integration tests is a check that the
 * frontend matches the Express routes exactly.
 */

export const API = {
  session: '/api/auth/session',
  me: '/api/auth/me',
  logout: '/api/auth/logout',
} as const

export const COLLEGE_ID = 'college-mit'

export function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'u-1',
    email: 'riya@mit.ac.in',
    displayName: 'Riya Sharma',
    role: 'STUDENT',
    collegeId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/**
 * Resolves the profile for a bearer token, the way the backend resolves one from
 * a verified ID token.
 *
 * The fake auth driver mints `fake-id-token.<uid>.<counter>`, so the uid is
 * recoverable from the token. The role comes from `profileForEmail`, never from
 * the request: a client that sent its own role would still get the server's,
 * which is the property the role guards depend on.
 */
export interface IdentityLookup {
  profileForEmail: (email: string) => UserProfile
  /** uid -> email, as a real `verifyIdToken` would supply the email claim. */
  emailForUid?: (uid: string) => string | null
}

function uidFromToken(authorization: string | null): string | null {
  if (!authorization?.startsWith('Bearer ')) return null
  const uid = authorization.slice('Bearer '.length).split('.')[1] ?? ''
  return uid.length > 0 ? uid : null
}

function emailFromToken(authorization: string | null, lookup: IdentityLookup): string | null {
  const uid = uidFromToken(authorization)
  if (!uid) return null
  if (lookup.emailForUid) return lookup.emailForUid(uid)
  // Default: the fixtures' own convention, where uid `u-1` is the student.
  return uid === 'u-teacher-1' ? 'aditya.teacher@mit.ac.in' : 'riya@mit.ac.in'
}

export interface HandlerOptions {
  /** Server-assigned profile returned by /session and /me. */
  profile?: UserProfile
  /** Artificial latency, for the slow-network cases. */
  latencyMs?: number
  /** Per-account profiles, so a teacher and a student can coexist in one test. */
  lookup?: Partial<IdentityLookup>
  /** Forces /session and /me to 401, simulating a rejected token. */
  rejectTokens?: boolean
}

export function authHandlers(options: HandlerOptions = {}) {
  const profile = options.profile ?? makeProfile()
  const lookup: IdentityLookup = {
    profileForEmail: (email: string) => (options.profile ? profile : makeProfile({ email })),
    ...options.lookup,
  }
  const wait = async () => {
    if (options.latencyMs) await delay(options.latencyMs)
  }

  const resolve = (request: Request): UserProfile | null => {
    if (options.rejectTokens) return null
    const authorization = request.headers.get('Authorization')
    const email = emailFromToken(authorization, lookup)
    if (!email) return null
    /*
     * The uid always comes from the verified token, never from the profile
     * table. A real `verifyIdToken` supplies it, and if the mock let the table's
     * uid win then every account would answer as `u-1` while the classroom
     * handlers — which parse the same token — saw distinct identities. That
     * mismatch would silently merge two students' localStorage draft namespaces
     * and make roster lookups inconsistent depending on which endpoint was asked.
     */
    const uid = uidFromToken(authorization)
    if (!uid) return null
    return { ...lookup.profileForEmail(email), uid }
  }

  return [
    // POST /api/auth/session — upserts the user doc, returns { user }.
    mswHttp.post(API.session, async ({ request }) => {
      await wait()
      const user = resolve(request)
      if (!user) {
        return HttpResponse.json(
          { message: 'Sign in to continue.', code: 'MISSING_TOKEN' },
          { status: 401 },
        )
      }
      return HttpResponse.json({ user })
    }),

    // GET /api/auth/me — the backend wraps the profile as { user }.
    mswHttp.get(API.me, async ({ request }) => {
      await wait()
      const user = resolve(request)
      if (!user) {
        return HttpResponse.json(
          { message: 'Sign in to continue.', code: 'MISSING_TOKEN' },
          { status: 401 },
        )
      }
      return HttpResponse.json({ user })
    }),

    mswHttp.post(API.logout, () => new HttpResponse(null, { status: 204 })),
  ]
}

/**
 * Per-account profiles keyed by email. Used by the teacher/student integration
 * tests: both roles are present in one document store, and the role each account
 * receives is fixed here rather than chosen by the test at runtime.
 */
export function profileLookup(
  accounts: Record<string, { role: UserRole; displayName: string; collegeId?: string | null }>,
  uidByEmail: Record<string, string>,
): IdentityLookup {
  return {
    profileForEmail: (email) => {
      const entry = accounts[email]
      if (!entry) return makeProfile({ email, role: 'STUDENT', collegeId: null })
      return makeProfile({
        email,
        displayName: entry.displayName,
        role: entry.role,
        collegeId: entry.collegeId === undefined ? null : entry.collegeId,
      })
    },
    emailForUid: (uid) => {
      const found = Object.entries(uidByEmail).find(([, value]) => value === uid)
      return found ? found[0] : null
    },
  }
}

export const errorHandlers = {
  unauthorized: () => [
    mswHttp.get(API.me, () =>
      HttpResponse.json({ message: 'Your session is no longer valid. Please sign in again.', code: 'INVALID_TOKEN' }, { status: 401 }),
    ),
  ],
  serverError: () => [
    mswHttp.get(API.me, () =>
      HttpResponse.json({ message: 'Something went wrong on our side. Please try again.', code: 'INTERNAL_SERVER_ERROR' }, { status: 500 }),
    ),
  ],
  offline: () => [mswHttp.get(API.me, () => HttpResponse.error())],
  slow: (ms: number) => [mswHttp.get(API.me, async () => { await delay(ms); return HttpResponse.json({ user: makeProfile() }) })],
}
