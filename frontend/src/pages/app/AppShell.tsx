import { useMemo, useState, type ReactNode } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { BookOpen, GraduationCap, LayoutDashboard, Menu, X } from 'lucide-react'
import { Logo } from '@/shared/components/brand/Logo'
import { ThemeToggle } from '@/shared/components/ThemeToggle'
import { useAuth } from '@/app/providers/AuthProvider'
import { isTeacherRole } from '@/shared/lib/roles'
import { cn } from '@/shared/lib/cn'
import {
  Sidebar,
  SidebarItem,
  SidebarLogoutButton,
} from '@/shared/components/ui/sidebar'
import { Button } from '@/shared/components/ui/button'
import { AccountMenu, SignOutDialog } from '@/features/auth/AccountMenu'

/** Route prefix -> header crumb. Ordered longest-first so nested paths resolve. */
const LOCATION_AREAS = [
  ['/app/classrooms', 'Classrooms'],
  ['/app/student', 'My tests'],
  ['/app/dashboard', 'Account'],
] as const

const AREA_LABELS: Record<string, string> = {
  Classrooms: 'Classrooms',
  'My tests': 'My tests',
  Account: 'Account',
  Dashboard: 'Dashboard',
}

interface NavItem {
  readonly to: string
  readonly label: string
  readonly icon: ReactNode
}

/**
 * Every destination the signed-in shell links to, grouped by the layout it
 * belongs to.
 *
 * A role only ever sees links it can open. The rail used to advertise the
 * *other* role's destination as an inert "Teacher only" / "Student only" row,
 * plus an "Integrity" row marked "coming soon", on the theory that showing the
 * roadmap was better than hiding it. In practice a nav is a promise: a row you
 * cannot follow is noise, it made the rail read as half-broken, and the role
 * chip on a locked row looked like a label about the viewer rather than about
 * the destination. The guards would have bounced the click anyway, so the rows
 * are gone for every role. Integrity stays absent for teachers too, until there
 * is a page behind it.
 *
 * The old rail also ellipsised its labels. The cause was a status chip sharing
 * the row inside a 14rem rail, so removing the chips is the whole fix; the label
 * itself must never truncate.
 */
const AREA_NAV: Record<'student' | 'staff', readonly NavItem[]> = {
  student: [
    {
      to: '/app/student',
      label: 'My tests',
      icon: <GraduationCap className="h-4 w-4" aria-hidden="true" />,
    },
  ],
  staff: [
    {
      to: '/app/classrooms',
      label: 'Classrooms',
      icon: <BookOpen className="h-4 w-4" aria-hidden="true" />,
    },
  ],
}

const ACCOUNT_ITEM: NavItem = {
  to: '/app/dashboard',
  label: 'Account',
  icon: <LayoutDashboard className="h-4 w-4" aria-hidden="true" />,
}

/** For staff the same `/app/dashboard` route is their overview, so it leads the rail. */
const DASHBOARD_ITEM: NavItem = { ...ACCOUNT_ITEM, label: 'Dashboard' }

function navItemsFor(teacher: boolean): readonly NavItem[] {
  return teacher ? [DASHBOARD_ITEM, ...AREA_NAV.staff] : [...AREA_NAV.student, ACCOUNT_ITEM]
}

/**
 * The vertical nav used by the teacher rail and by the mobile drawer. It carries
 * the sign-out control and the confirm dialog as well, because on the rail the
 * bottom of the rail is the natural home for "leave", and the drawer reuses the
 * same block.
 */
function NavContent({
  items,
  teacher,
  closeDrawer,
}: {
  items: readonly NavItem[]
  teacher: boolean
  closeDrawer?: () => void
}) {
  const [signOutOpen, setSignOutOpen] = useState(false)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-6 flex items-center gap-2.5 px-4">
        <Logo size={28} withWordmark />
      </div>
      <nav className="flex flex-col gap-1" aria-label="Primary">
        {items.map((item) => (
          <SidebarItem
            key={item.to}
            to={item.to}
            icon={item.icon}
            label={item.label}
            onNavigate={closeDrawer}
          />
        ))}
      </nav>
      {teacher ? (
        <div className="mt-auto border-t border-line px-4 pt-3">
          <SidebarLogoutButton
            onLogout={() => {
              closeDrawer?.()
              setSignOutOpen(true)
            }}
          />
        </div>
      ) : null}
      <SignOutDialog
        open={signOutOpen}
        onOpenChange={(open) => {
          setSignOutOpen(open)
          if (!open) closeDrawer?.()
        }}
      />
    </div>
  )
}

/**
 * One entry in the student's horizontal top bar. Same active rule and the same
 * never-truncate rule as the rail, laid out sideways.
 */
function TopNavLink({ item }: { item: NavItem }) {
  const { pathname } = useLocation()
  const isActive = pathname === item.to || pathname.startsWith(`${item.to}/`)
  return (
    <Link
      to={item.to}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'relative flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition-all duration-250 ease-out',
        isActive
          ? 'bg-brand-soft text-brand-text shadow-[inset_0_0_0_1px_rgb(var(--glow)/0.18)]'
          : 'text-ink hover:bg-canvas-sunken/70 hover:text-ink-strong',
      )}
    >
      <span className="shrink-0">{item.icon}</span>
      <span className="whitespace-nowrap">{item.label}</span>
    </Link>
  )
}

export function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [triggerRef, setTriggerRef] = useState<HTMLButtonElement | null>(null)
  const location = useLocation()
  const { role } = useAuth()

  const teacher = isTeacherRole(role)
  const items = navItemsFor(teacher)

  /*
   * The header crumb follows the route rather than being hard-coded to
   * "Overview", which was wrong on every page except the dashboard. Longest
   * prefix first, so `/app/classrooms/:id` reads as "Classrooms". It is a
   * teacher-only affordance: a student's header carries their nav instead.
   */
  const activeArea = useMemo(() => {
    const match = LOCATION_AREAS.find(([prefix]) => location.pathname.startsWith(prefix))
    const area = match ? match[1] : 'Account'
    // Staff see `/app/dashboard` as their Dashboard, not an account page.
    return teacher && area === 'Account' ? 'Dashboard' : area
  }, [location.pathname, teacher])

  const closeDrawer = () => {
    setMobileNavOpen(false)
    // Return focus to the control that opened the drawer, otherwise focus lands
    // on <body> and a keyboard user has to tab from the top of the page again.
    triggerRef?.focus()
  }

  return (
    <div className="flex min-h-dvh">
      {/*
        Only staff get the persistent rail. A student has one destination, and a
        fixed rail for a single link cost a 14rem column of every page for
        nothing; they get a top bar instead, and their mobile drawer still offers
        the same links. The rail is teacher-only, so the drawer below is the only
        nav a student ever sees on a narrow screen.
      */}
      {teacher ? (
        <Sidebar className="hidden md:flex">
          <NavContent items={items} teacher />
        </Sidebar>
      ) : null}

      <AnimatePresence>
        {mobileNavOpen ? (
          <>
            <motion.div
              key="scrim"
              role="presentation"
              className="fixed inset-0 z-40 bg-canvas-sunken/70 backdrop-blur-sm md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              onClick={closeDrawer}
            />
            <motion.aside
              key="drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
              className="fixed inset-y-0 left-0 z-50 flex w-64 border-r border-line bg-surface-raised shadow-overlay md:hidden"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="w-full pt-12">
                <NavContent items={items} teacher={teacher} closeDrawer={closeDrawer} />
              </div>
              <button
                type="button"
                aria-label="Close navigation"
                onClick={closeDrawer}
                className="absolute right-3 top-4 rounded-md p-1.5 text-ink-faint hover:bg-canvas-sunken hover:text-ink-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-line px-4 lg:px-8">
          <Button
            ref={setTriggerRef}
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Open navigation"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </Button>

          {teacher ? (
            <span className="truncate text-sm text-ink">
              Trityanetra{' '}
              <span aria-hidden="true" className="mx-1 text-ink-faint">
                /
              </span>{' '}
              <span className="font-medium text-ink-strong">{AREA_LABELS[activeArea]}</span>
            </span>
          ) : (
            <>
              <Logo size={26} withWordmark />
              <nav aria-label="Primary" className="ml-2 hidden items-center gap-1 md:flex">
                {items.map((item) => (
                  <TopNavLink key={item.to} item={item} />
                ))}
              </nav>
            </>
          )}

          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <AccountMenu />
          </div>
        </header>
        {/*
          `page-enter` runs on mount. Every route renders its own page component,
          so a real navigation mounts a new one and the rise replays, while a
          param-only change (`/classrooms/a` -> `/classrooms/b`, same
          `ClassroomDetail`) deliberately does not re-animate. Keying this on
          `location.pathname` would force a full remount of the Outlet subtree on
          every navigation and throw away component state to buy an effect each
          page already gets for free.
        */}
        {/*
          Route progress: a hairline of gold that runs across the top of the
          content on every navigation. Keyed on the path so it replays per page;
          it is purely decorative and finishes on its own.
        */}
        <div key={location.pathname} aria-hidden="true" className="route-progress" />
        <main id="main-content" className="page-enter flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
