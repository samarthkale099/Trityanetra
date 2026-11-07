import type { UserRole } from '@/shared/types'

/**
 * Where each role lands after signing in, and what an anonymous visitor is sent to.
 *
 * Teachers land on their dashboard (`/app/dashboard`, an overview across every
 * classroom); students land on their test area. For a student the same
 * `/app/dashboard` path is their account page.
 */
export const ROLE_HOME: Readonly<Record<UserRole, string>> = {
  STUDENT: '/app/student',
  TEACHER: '/app/dashboard',
  ADMIN: '/app/dashboard',
}

export const ROLE_LABELS: Readonly<Record<UserRole, string>> = {
  STUDENT: 'Student',
  TEACHER: 'Teacher',
  ADMIN: 'Administrator',
}

/** Roles that may open teacher-only areas. */
export const TEACHER_ROLES: readonly UserRole[] = ['TEACHER', 'ADMIN'] as const

/**
 * Roles that may open student-only areas.
 *
 * ADMIN is deliberately absent. An administrator manages classrooms, not other
 * people's attempts, so it gets no access to the take-test surfaces; it is
 * neither redirected as a stranger nor granted a student identity.
 */
export const STUDENT_ROLES: readonly UserRole[] = ['STUDENT'] as const

export function roleHomePath(role: UserRole | null | undefined): string {
  return role ? ROLE_HOME[role] : '/login'
}

export function isTeacherRole(role: UserRole | null | undefined): boolean {
  return role !== null && role !== undefined && TEACHER_ROLES.includes(role)
}

export function isStudentRole(role: UserRole | null | undefined): boolean {
  return role !== null && role !== undefined && STUDENT_ROLES.includes(role)
}

export function roleLabel(role: UserRole | null | undefined): string {
  return role ? ROLE_LABELS[role] : 'Guest'
}
