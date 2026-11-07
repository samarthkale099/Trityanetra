export type UserRole = 'STUDENT' | 'TEACHER' | 'ADMIN'

export interface UserProfile {
  uid: string
  email: string
  displayName: string
  role: UserRole
  collegeId: string | null
  createdAt: string
  updatedAt: string
}

export interface SessionPayload {
  user: UserProfile
}

export interface ApiErrorBody {
  message?: string
  code?: string
  details?: unknown
}

export const USER_ROLES: readonly UserRole[] = ['STUDENT', 'TEACHER', 'ADMIN'] as const