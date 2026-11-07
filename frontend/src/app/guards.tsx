import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/app/providers/AuthProvider'
import { AuthSplash } from '@/app/AuthSplash'
import { roleHomePath, STUDENT_ROLES, TEACHER_ROLES, ADMIN_ROLES } from '@/shared/lib/roles'
import type { UserRole } from '@/shared/types'

/** Sends a guest to the login page, keeping the intended destination. */
function LoginRedirect() {
  const location = useLocation()
  const from = `${location.pathname}${location.search}`
  return <Navigate to={{ pathname: '/login', search: from === '/' ? '' : `?from=${encodeURIComponent(from)}` }} replace />
}

/** Requires an authenticated session. */
export function Protected({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  if (status === 'loading') return <AuthSplash />
  if (status !== 'authenticated') return <LoginRedirect />
  return <>{children}</>
}

/** Keeps a signed-in user off the login/register pages. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { status, isAuthenticated, role } = useAuth()
  if (status === 'loading') return <AuthSplash />
  if (isAuthenticated) return <Navigate to={roleHomePath(role)} replace />
  return <>{children}</>
}

/**
 * Restricts a subtree to specific roles.
 *
 * A signed-in user of the wrong role is sent to their own home rather than shown
 * a dead end. The server remains the real authority — this only keeps the UI
 * honest, and every guarded route re-checks the role server-side.
 */
export function RequireRole({ allow, children }: { allow: readonly UserRole[]; children: ReactNode }) {
  const { status, role } = useAuth()
  if (status === 'loading') return <AuthSplash />
  if (status !== 'authenticated') return <LoginRedirect />
  if (role === null || !allow.includes(role)) return <Navigate to={roleHomePath(role)} replace />
  return <>{children}</>
}

/**
 * Teacher-and-above gate for the classroom area.
 *
 * Implemented as a thin wrapper over `RequireRole` so the redirect behaviour is
 * defined in exactly one place.
 */
export function TeacherOnly({ children }: { children: ReactNode }) {
  return <RequireRole allow={TEACHER_ROLES}>{children}</RequireRole>
}

/**
 * Student-only gate for the test area (dashboard, lobby, exam).
 *
 * A teacher who follows a student link is sent to their own classrooms rather
 * than shown a page whose actions would all fail server-side.
 */
export function StudentOnly({ children }: { children: ReactNode }) {
  return <RequireRole allow={STUDENT_ROLES}>{children}</RequireRole>
}

/** Admin-only gate for colleges and role management. The server re-checks every call. */
export function AdminOnly({ children }: { children: ReactNode }) {
  return <RequireRole allow={ADMIN_ROLES}>{children}</RequireRole>
}

/** `/` resolves to the right surface for the current session. */
export function RootRedirect() {
  const { status, role } = useAuth()
  if (status === 'loading') return <AuthSplash />
  return <Navigate to={status === 'authenticated' ? roleHomePath(role) : '/login'} replace />
}
