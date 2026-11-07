import { useEffect, useRef } from 'react'
import { RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { router } from '@/app/router'
import { AuthProvider } from '@/app/providers/AuthProvider'
import { ToastProvider } from '@/app/providers/ToastProvider'
import { ThemeProvider } from '@/app/providers/ThemeProvider'
import { TooltipProvider } from '@/shared/components/ui/tooltip'

/**
 * One client for the app. Retries are off by default: a 4xx will fail again on
 * a second identical attempt, and silently retrying a POST risks duplicate
 * submissions (Phase 3's exam submit). Callers opt in per query.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        const status = (error as { status?: number } | null)?.status
        if (typeof status === 'number' && status >= 400 && status < 500) return false
        return failureCount < 2
      },
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false },
  },
})

/* ------------------------------------------------------------------------ */
/*  Faceted background                                                       */
/* ------------------------------------------------------------------------ */

/** Small deterministic PRNG, so the facet layout is the same on every visit. */
function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

interface FacetPoint {
  /** Rest position (CSS px). */
  x: number
  y: number
  /** Drift radius and angular speed (rad/s): each point orbits its rest spot. */
  ampX: number
  ampY: number
  speed: number
  phase: number
  /** Static "height" that shades the facets around this point. */
  height: number
}

interface FacetEdge {
  a: number
  b: number
  /** About a third of edges carry the gold hairline; the rest are faint seams. */
  gilded: boolean
  phase: number
  /** Gold edges only: how fast a spark of light runs along them (passes/s). */
  travel: number
  /** Gold edges only: rest between sparks, as a fraction of one pass. */
  rest: number
}

/** Frame budget: 30 fps keeps the sparks smooth at half the cost of 60. */
const FRAME_MS = 1000 / 30

/**
 * A living, faceted surface behind every screen: dark low-poly planes that
 * drift and catch a sweeping band of light, with gold hairlines along a third
 * of the edges -- each pulsing, and each with a spark of light that runs along
 * it every few seconds.
 *
 * Drawn on one fixed canvas (no DOM per facet), at most 30 fps and at most
 * 1.5x device pixels; it idles when the tab is hidden (rAF stops), redraws on
 * resize, and holds a single still frame for reduced-motion users. Opaque
 * surfaces (cards, the exam screen, the auth panel) simply sit on top of it,
 * and a radial mask keeps the centre of the page -- where text is -- quieter
 * than the edges.
 */
function FacetBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    // `getContext` can throw or be unimplemented (test DOMs, locked-down
    // browsers); the app then simply has no animated background.
    const getContext = () => {
      try {
        return canvas?.getContext('2d') ?? null
      } catch {
        return null
      }
    }
    const context = getContext()
    if (!canvas || !context) return

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let width = 0
    let height = 0
    let points: FacetPoint[] = []
    let triangles: [number, number, number][] = []
    let edges: FacetEdge[] = []
    let frame = 0
    let lastDraw = 0

    const build = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)

      const random = seededRandom(1445)
      const cell = Math.max(170, Math.min(width, height) / 4)
      const cols = Math.ceil(width / cell) + 2
      const rows = Math.ceil(height / cell) + 2

      points = []
      for (let row = 0; row <= rows; row++) {
        for (let col = 0; col <= cols; col++) {
          points.push({
            x: (col - 1) * cell + (random() - 0.5) * cell * 0.75,
            y: (row - 1) * cell + (random() - 0.5) * cell * 0.75,
            ampX: cell * (0.08 + random() * 0.08),
            ampY: cell * (0.08 + random() * 0.08),
            // One orbit every 14-24 s: clearly alive, never busy.
            speed: (Math.PI * 2) / (14 + random() * 10),
            phase: random() * Math.PI * 2,
            height: random(),
          })
        }
      }

      triangles = []
      const at = (col: number, row: number) => row * (cols + 1) + col
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const tl = at(col, row)
          const tr = at(col + 1, row)
          const bl = at(col, row + 1)
          const br = at(col + 1, row + 1)
          if (random() < 0.5) triangles.push([tl, tr, br], [tl, br, bl])
          else triangles.push([tl, tr, bl], [tr, br, bl])
        }
      }

      const seen = new Set<string>()
      edges = []
      for (const [a, b, c] of triangles) {
        for (const [from, to] of [
          [a, b],
          [b, c],
          [c, a],
        ] as const) {
          const key = from < to ? `${from}:${to}` : `${to}:${from}`
          if (seen.has(key)) continue
          seen.add(key)
          edges.push({
            a: from,
            b: to,
            gilded: random() < 0.33,
            phase: random() * Math.PI * 2,
            // A spark takes 1.6-3 s to cross an edge, then rests 1-4 passes.
            travel: 1 / (1.6 + random() * 1.4),
            rest: 1 + random() * 3,
          })
        }
      }
    }

    const draw = (timeMs: number) => {
      const t = timeMs / 1000
      const dark = document.documentElement.classList.contains('dark')
      const facet = dark ? '255, 248, 230' : '23, 19, 10'
      const gold = dark ? '212, 175, 90' : '168, 130, 47'
      // Noir: facets stay barely-there so the surface reads as black glass and
      // the gold is the only bright thing on it.
      const facetStrength = dark ? 0.032 : 0.035
      const goldStrength = dark ? 0.7 : 0.7
      const sparkColor = dark ? '246, 231, 187' : '138, 106, 34'

      const xs = new Float32Array(points.length)
      const ys = new Float32Array(points.length)
      for (let i = 0; i < points.length; i++) {
        const point = points[i]
        xs[i] = point.x + Math.cos(t * point.speed + point.phase) * point.ampX
        ys[i] = point.y + Math.sin(t * point.speed * 0.8 + point.phase) * point.ampY
      }

      context.clearRect(0, 0, width, height)

      // A broad band of light drifts diagonally across the surface (one pass
      // every ~18 s); facets brighten as it crosses them.
      const band = ((t / 18) % 1) * (width + height) * 1.4 - height * 0.4

      for (const [a, b, c] of triangles) {
        const cx = (xs[a] + xs[b] + xs[c]) / 3
        const cy = (ys[a] + ys[b] + ys[c]) / 3
        const shade = (points[a].height + points[b].height + points[c].height) / 3
        const distance = Math.abs(cx + cy - band)
        const glow = Math.max(0, 1 - distance / (width * 0.45))
        const alpha = facetStrength * (0.25 + shade * 0.75) + glow * facetStrength * 0.9
        context.beginPath()
        context.moveTo(xs[a], ys[a])
        context.lineTo(xs[b], ys[b])
        context.lineTo(xs[c], ys[c])
        context.closePath()
        context.fillStyle = `rgba(${facet}, ${alpha.toFixed(4)})`
        context.fill()
      }

      context.lineWidth = 1
      for (const edge of edges) {
        const x1 = xs[edge.a]
        const y1 = ys[edge.a]
        const x2 = xs[edge.b]
        const y2 = ys[edge.b]
        if (!edge.gilded) {
          context.strokeStyle = `rgba(${facet}, ${dark ? 0.03 : 0.04})`
          context.beginPath()
          context.moveTo(x1, y1)
          context.lineTo(x2, y2)
          context.stroke()
          continue
        }
        // Gold hairline that fades out toward both ends and breathes (~7 s).
        const pulse = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 0.9 + edge.phase))
        const gradient = context.createLinearGradient(x1, y1, x2, y2)
        gradient.addColorStop(0, `rgba(${gold}, 0)`)
        gradient.addColorStop(0.5, `rgba(${gold}, ${(goldStrength * pulse).toFixed(3)})`)
        gradient.addColorStop(1, `rgba(${gold}, 0)`)
        context.lineWidth = 1
        context.strokeStyle = gradient
        context.beginPath()
        context.moveTo(x1, y1)
        context.lineTo(x2, y2)
        context.stroke()

        // The beam: a short streak of light running from one end to the other,
        // then resting. No glowing head -- the streak itself softens at its
        // leading edge, so it reads as light travelling inside the line.
        const cycle = (t * edge.travel + edge.phase) % (1 + edge.rest)
        if (cycle > 1) continue
        const head = cycle
        const tail = Math.max(0, head - 0.28)
        const hx = x1 + (x2 - x1) * head
        const hy = y1 + (y2 - y1) * head
        const tx = x1 + (x2 - x1) * tail
        const ty = y1 + (y2 - y1) * tail
        // Fade in at the start and out at the end of the run.
        const fade = Math.sin(Math.PI * head)
        const peak = (0.9 * fade).toFixed(3)
        const beam = context.createLinearGradient(tx, ty, hx, hy)
        beam.addColorStop(0, `rgba(${sparkColor}, 0)`)
        beam.addColorStop(0.8, `rgba(${sparkColor}, ${peak})`)
        beam.addColorStop(1, `rgba(${sparkColor}, ${(0.9 * fade * 0.35).toFixed(3)})`)
        context.lineWidth = 1.3
        context.strokeStyle = beam
        context.beginPath()
        context.moveTo(tx, ty)
        context.lineTo(hx, hy)
        context.stroke()
      }
    }

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop)
      if (now - lastDraw < FRAME_MS) return
      lastDraw = now
      draw(now)
    }

    const start = () => {
      cancelAnimationFrame(frame)
      if (reduceMotion?.matches) {
        draw(0)
      } else {
        frame = requestAnimationFrame(loop)
      }
    }

    let resizeTimer: number | undefined
    const onResize = () => {
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => {
        build()
        draw(performance.now())
      }, 150)
    }
    // A theme switch needs a repaint even when the loop is idle (reduced motion).
    const themeObserver = new MutationObserver(() => draw(reduceMotion?.matches ? 0 : performance.now()))
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    build()
    start()
    window.addEventListener('resize', onResize)
    reduceMotion?.addEventListener?.('change', start)

    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(resizeTimer)
      window.removeEventListener('resize', onResize)
      reduceMotion?.removeEventListener?.('change', start)
      themeObserver.disconnect()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full [mask-image:radial-gradient(ellipse_70%_60%_at_50%_45%,rgb(0_0_0/0.7),#000_80%)]"
    />
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <FacetBackground />
        <TooltipProvider>
          <AuthProvider>
            <ToastProvider>
              <RouterProvider router={router} />
            </ToastProvider>
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
