import { http } from '@/shared/lib/httpClient'
import { sanitizeText } from '@/shared/lib/sanitize'
import type { UserRole } from '@/shared/types'

/**
 * Admin HTTP surface: colleges and user roles.
 *
 * - `GET   /api/colleges`                      every college (root admin) or your own
 * - `POST  /api/colleges`                      root admin only
 * - `PATCH /api/colleges/:id/email-domain`     set or clear (null) a college's domain
 * - `GET   /api/users?email=&role=&collegeId=` look users up (scoped to your college)
 * - `POST  /api/auth/assign-role`              change a user's role and college
 *
 * The server decides who may do what; these calls only shape the requests.
 */

export interface College {
  id: string
  name: string
  code: string
  /** Students with an email on this domain (or a subdomain) join this college automatically. */
  emailDomain: string | null
}

export interface AdminUser {
  uid: string
  email: string
  displayName: string
  role: UserRole
  collegeId: string | null
  emailVerified: boolean
  createdAt: string | null
}

export interface CreateCollegeInput {
  name: string
  code: string
  emailDomain?: string
}

export interface UserSearch {
  email?: string
  role?: UserRole
  collegeId?: string
}

/** Unwraps `{ data }`, the backend's success envelope. */
const unwrap = <T>(payload: { data: T }): T => payload.data

function toCollege(raw: any): College {
  return {
    id: String(raw?.id ?? ''),
    name: String(raw?.name ?? ''),
    code: String(raw?.code ?? ''),
    emailDomain: typeof raw?.emailDomain === 'string' && raw.emailDomain ? raw.emailDomain : null,
  }
}

function toAdminUser(raw: any): AdminUser {
  return {
    uid: String(raw?.uid ?? ''),
    email: String(raw?.email ?? ''),
    displayName: String(raw?.displayName ?? raw?.email ?? ''),
    role: raw?.role === 'TEACHER' || raw?.role === 'ADMIN' ? raw.role : 'STUDENT',
    collegeId: typeof raw?.collegeId === 'string' && raw.collegeId ? raw.collegeId : null,
    emailVerified: raw?.emailVerified !== false,
    createdAt: typeof raw?.createdAt === 'string' ? raw.createdAt : null,
  }
}

export const collegeApi = {
  list: async (signal?: AbortSignal): Promise<College[]> => {
    const payload = await http.get<{ data: any[] }>('/api/colleges', signal ? { signal } : {})
    return (unwrap(payload) ?? []).map(toCollege).sort((a, b) => a.name.localeCompare(b.name))
  },

  create: async (input: CreateCollegeInput): Promise<College> => {
    const domain = input.emailDomain?.trim()
    const payload = await http.post<{ data: any }>('/api/colleges', {
      body: {
        name: sanitizeText(input.name, 120),
        code: sanitizeText(input.code, 20),
        ...(domain ? { emailDomain: domain } : {}),
      },
    })
    return toCollege(unwrap(payload))
  },

  /** `null` clears the domain, so students need an explicit collegeId again. */
  setEmailDomain: async (collegeId: string, emailDomain: string | null): Promise<College> => {
    const payload = await http.patch<{ data: any }>(`/api/colleges/${encodeURIComponent(collegeId)}/email-domain`, {
      body: { emailDomain: emailDomain?.trim() || null },
    })
    return toCollege(unwrap(payload))
  },
}

export const userAdminApi = {
  search: async (query: UserSearch, signal?: AbortSignal): Promise<AdminUser[]> => {
    const params = new URLSearchParams()
    if (query.email?.trim()) params.set('email', query.email.trim())
    if (query.role) params.set('role', query.role)
    if (query.collegeId) params.set('collegeId', query.collegeId)
    const suffix = params.toString() ? `?${params.toString()}` : ''
    const payload = await http.get<{ data: any[] }>(`/api/users${suffix}`, signal ? { signal } : {})
    return (unwrap(payload) ?? []).map(toAdminUser)
  },

  /**
   * Changes a user's role. A root admin may pass `collegeId: null` with ADMIN to
   * make another root admin. Takes effect the next time that person signs in.
   */
  assignRole: async (targetUid: string, role: UserRole, collegeId: string | null): Promise<void> => {
    await http.post('/api/auth/assign-role', { body: { targetUid, role, collegeId } })
  },
}
