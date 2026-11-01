import type { ReactNode } from 'react'
import { Eye, ShieldCheck, Sparkles } from 'lucide-react'
import { LogoMark } from '@/shared/components/brand/Logo'
import { ThemeToggle } from '@/shared/components/ThemeToggle'

interface AuthScaffoldProps {
  eyebrow: string
  title: string
  subtitle: string
  children: ReactNode
}

const HIGHLIGHTS = [
  { icon: Eye, label: 'Live invigilation' },
  { icon: ShieldCheck, label: 'Integrity review' },
  { icon: Sparkles, label: 'Instant results' },
] as const

/**
 * The frame every signed-out screen shares.
 *
 * Login is the first thing anyone sees, so it carries the full brand moment:
 * the ink panel with its orbiting light, a gradient headline, and a frosted
 * form card that floats over the aurora. Everything enters in a short,
 * staggered cascade. The cascade is pure CSS (`.rise` in index.css) so it runs
 * on the compositor, never waits on JavaScript, and is switched off wholesale
 * for reduced-motion users.
 */
export function AuthScaffold({ eyebrow, title, subtitle, children }: AuthScaffoldProps) {
  const rise = (delay: number) => ({ style: { animationDelay: `${delay}s` } })

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="panel-ink hidden flex-col justify-between overflow-hidden px-12 py-10 lg:flex">
        <div {...rise(0)} className="rise flex items-center gap-3">
          <LogoMark size={40} />
          <span className="font-display text-lg font-semibold tracking-tight text-[#f6f2e8]">Trityanetra</span>
        </div>

        <div className="max-w-md">
          <div
            {...rise(0.1)}
            aria-hidden="true"
            className="rise mb-7 h-1 w-16 rounded-full bg-glow-gradient shadow-[0_0_20px_rgb(212_175_90/0.45)]"
          />
          <p
            {...rise(0.18)}
            className="rise font-serif text-5xl font-medium leading-[1.06] tracking-[-0.02em] [font-variation-settings:'opsz'_144] text-[#f6f2e8]"
          >
            Exams are where code meets its{' '}
            <span className="text-gradient">owner.</span>
          </p>
          <p {...rise(0.28)} className="rise mt-6 max-w-sm text-md leading-relaxed text-[#f6f2e8]/65">
            The coding classroom — tests, invigilation, and academic-integrity review in one place.
          </p>

          <ul className="mt-9 flex flex-wrap gap-2.5">
            {HIGHLIGHTS.map(({ icon: Icon, label }, index) => (
              <li
                key={label}
                {...rise(0.38 + index * 0.08)}
                className="rise flex items-center gap-2 rounded-full border border-[#d4af5a]/15 bg-white/[0.04] px-3.5 py-1.5 text-xs font-medium text-[#f6f2e8]/85 backdrop-blur-md"
              >
                <Icon className="h-3.5 w-3.5 text-[#d4af5a]" aria-hidden="true" />
                {label}
              </li>
            ))}
          </ul>
        </div>

        <p {...rise(0.6)} className="rise text-xs text-[#f6f2e8]/40">
          Est. for students, teachers, and college administrators.
        </p>
      </aside>

      <main className="relative flex min-h-dvh flex-col px-4 py-8 sm:px-8">
        <div className="flex items-start justify-between gap-4">
          <div className="mb-10 flex items-center gap-2.5 lg:hidden">
            <LogoMark size={32} />
            <span className="font-display text-lg font-semibold tracking-tight text-ink-strong">
              Trityanetra
            </span>
          </div>
          {/* Reachable before signing in: these are the first screens a user sees. */}
          <ThemeToggle className="-mt-1 ml-auto shrink-0" />
        </div>

        <div className="m-auto w-full max-w-[440px] py-4">
          <div
            {...rise(0.12)}
            className="rise-card glass glow-border rounded-2xl border border-line p-6 shadow-lift sm:p-9"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-text">{eyebrow}</p>
            <h1 className="mt-2.5 font-serif text-3xl font-medium tracking-[-0.01em] text-ink-strong">{title}</h1>
            <p className="mt-2.5 text-sm leading-relaxed text-ink">{subtitle}</p>
            <div className="mt-8">{children}</div>
          </div>
        </div>
      </main>
    </div>
  )
}
