import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom'
import { RootRedirect, Protected, GuestOnly, StudentOnly, TeacherOnly } from '@/app/guards'
import { AuthSplash } from '@/app/AuthSplash'

/*
 * Every route component is code-split. The auth screens stay in their own
 * chunks, so the login page ships no classroom code, the exam route keeps
 * Monaco out of every other bundle, and each protected area can grow without
 * inflating the initial bundle.
 */
const AppShell = lazy(() => import('@/pages/app/AppShell').then((m) => ({ default: m.AppShell })))
const DashboardPage = lazy(() => import('@/pages/app/Dashboard').then((m) => ({ default: m.DashboardPage })))
const LoginPage = lazy(() => import('@/pages/auth/Login').then((m) => ({ default: m.LoginPage })))
const RegisterPage = lazy(() => import('@/pages/auth/Register').then((m) => ({ default: m.RegisterPage })))
const NotFoundPage = lazy(() => import('@/pages/NotFound').then((m) => ({ default: m.NotFoundPage })))

/* Teacher area. */
const ClassroomListPage = lazy(() =>
  import('@/pages/teacher/ClassroomList').then((m) => ({ default: m.ClassroomListPage })),
)
const ClassroomDetailPage = lazy(() =>
  import('@/pages/teacher/ClassroomDetail').then((m) => ({ default: m.ClassroomDetailPage })),
)
const TestCreatePage = lazy(() =>
  import('@/pages/teacher/TestCreate').then((m) => ({ default: m.TestCreatePage })),
)
const TestReviewPage = lazy(() =>
  import('@/pages/teacher/TestReview').then((m) => ({ default: m.TestReviewPage })),
)
const SubmissionListPage = lazy(() =>
  import('@/pages/teacher/SubmissionList').then((m) => ({ default: m.SubmissionListPage })),
)
const SubmissionDetailPage = lazy(() =>
  import('@/pages/teacher/SubmissionDetail').then((m) => ({ default: m.SubmissionDetailPage })),
)

/* Student area. */
const StudentDashboardPage = lazy(() =>
  import('@/pages/student/StudentDashboard').then((m) => ({ default: m.StudentDashboardPage })),
)
const TestLobbyPage = lazy(() =>
  import('@/pages/student/TestLobby').then((m) => ({ default: m.TestLobbyPage })),
)
const StudentResultPage = lazy(() =>
  import('@/pages/student/StudentResult').then((m) => ({ default: m.StudentResultPage })),
)
const ExamPage = lazy(() => import('@/pages/student/ExamPage').then((m) => ({ default: m.ExamPage })))

/**
 * Suspense boundary for a lazily loaded chunk. AuthSplash rather than a bare
 * spinner: it matches the auth screens and gives assistive tech real text.
 */
function withSuspense(node: ReactNode) {
  return <Suspense fallback={<AuthSplash />}>{node}</Suspense>
}

export const routes: RouteObject[] = [
  {
    path: '/',
    element: withSuspense(<RootRedirect />),
  },
  {
    path: '/login',
    element: withSuspense(
      <GuestOnly>
        <LoginPage />
      </GuestOnly>,
    ),
  },
  {
    path: '/register',
    element: withSuspense(
      <GuestOnly>
        <RegisterPage />
      </GuestOnly>,
    ),
  },
  {
    path: '/app',
    element: withSuspense(
      <Protected>
        <AppShell />
      </Protected>,
    ),
    children: [
      { index: true, element: <Navigate to="/app/dashboard" replace /> },
      {
        path: 'dashboard',
        element: withSuspense(<DashboardPage />),
      },
      /* ------------------------------------------------------ teacher-only */
      {
        path: 'classrooms',
        element: withSuspense(
          <TeacherOnly>
            <ClassroomListPage />
          </TeacherOnly>,
        ),
      },
      {
        path: 'classrooms/:classroomId',
        element: withSuspense(
          <TeacherOnly>
            <ClassroomDetailPage />
          </TeacherOnly>,
        ),
      },
      {
        path: 'classrooms/:classroomId/tests/new',
        element: withSuspense(
          <TeacherOnly>
            <TestCreatePage />
          </TeacherOnly>,
        ),
      },
      {
        path: 'classrooms/:classroomId/tests/:testId',
        element: withSuspense(
          <TeacherOnly>
            <TestReviewPage />
          </TeacherOnly>,
        ),
      },
      {
        path: 'classrooms/:classroomId/tests/:testId/submissions',
        element: withSuspense(
          <TeacherOnly>
            <SubmissionListPage />
          </TeacherOnly>,
        ),
      },
      {
        path: 'classrooms/:classroomId/tests/:testId/submissions/:submissionId',
        element: withSuspense(
          <TeacherOnly>
            <SubmissionDetailPage />
          </TeacherOnly>,
        ),
      },
      /* ------------------------------------------------------ student-only */
      {
        path: 'student',
        element: withSuspense(
          <StudentOnly>
            <StudentDashboardPage />
          </StudentOnly>,
        ),
      },
      {
        path: 'tests/:testId/lobby',
        element: withSuspense(
          <StudentOnly>
            <TestLobbyPage />
          </StudentOnly>,
        ),
      },
      {
        path: 'tests/:testId/result',
        element: withSuspense(
          <StudentOnly>
            <StudentResultPage />
          </StudentOnly>,
        ),
      },
    ],
  },
  /*
   * The exam is a sibling of `/app`, not a child of it. It supplies its own
   * chrome (fullscreen guard, countdown, blocking overlays) and must not inherit
   * the shell's header, sidebar, or nav, which would both leak distractions
   * into a proctored attempt and double up on the exit confirm dialog.
   */
  {
    path: '/app/tests/:testId/exam',
    element: withSuspense(
      <StudentOnly>
        <ExamPage />
      </StudentOnly>,
    ),
  },
  { path: '*', element: withSuspense(<NotFoundPage />) },
]

/**
 * The config is exported separately from the browser router so the route guards
 * can be driven by a memory router in tests, with no history or URL involved.
 */
export const router = createBrowserRouter(routes)
