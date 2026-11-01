/**
 * Trityanetra design tokens — the source of record for the visual system.
 *
 * The CSS custom properties in `src/index.css` mirror these values. When you
 * change a token, change it here first, then update the matching `--var` in
 * `src/index.css` so Tailwind utilities and the primitives stay in sync.
 *
 * Full rationale: docs/design-system.md
 */

export const colors = {
  /*
   * NOIR & GOLD. Three materials in a fixed order of priority: ink (black) for
   * structure, ivory (white) for light, gold only as signal -- the primary
   * action, the active item, focus, a title rule. Neutrals are warm so all
   * three read as one family. Full rationale at the top of `src/index.css`.
   *
   * The hexes below are the LIGHT scheme. `.dark` (noir, the default) remaps
   * the same names; notably `500` -- the primary fill -- is black in light and
   * gold in noir, with `onBrand` flipping alongside it.
   */
  brand: {
    50: '#FBF8F0',
    100: '#F5EEDB',
    200: '#EBDCB4',
    300: '#DCC285',
    /** Decorative gold. */
    400: '#B8913B',
    /** Primary fill (noir: #D4AF5A). */
    500: '#15130F',
    600: '#2A2620',
    700: '#1C1A16',
    800: '#12110E',
    900: '#0A0908',
    /** Gold legible as text on ivory (noir: #E3C67F). */
    text: '#8A6A22',
    mark: '#15130F',
  },
  /** Text on a brand fill (noir: #14110A). */
  onBrand: '#FAF7EF',
  /** Champagne; decorative only. */
  accent: '#C9A24A',
  /** Gold metal ramp: highlight -> body -> antique shadow. */
  gold: {
    champagne: '#F0DDA6',
    highlight: '#F6E7BB',
    body: '#D4AF5A',
    deep: '#B08A3A',
    antique: '#8A6A22',
  },
  canvas: '#FAF9F6',
  canvasSunken: '#F2F0EA',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  surfaceGlass: 'rgba(255, 255, 255, 0.74)',
  line: '#E9E5DB',
  lineStrong: '#D5CFC0',
  ink: {
    strong: '#0D0C0A',
    DEFAULT: '#39362F',
    faint: '#696457',
  },
  /** Muted, so gold stays the only warm accent on screen. */
  semantic: {
    success: '#2F6B4F',
    warning: '#96501C',
    danger: '#A3302A',
    info: '#3D5A85',
  },
  semanticSoft: {
    success: '#E7F1EA',
    warning: '#F8EBDF',
    danger: '#F9E6E3',
    info: '#E8EEF6',
  },
} as const

export const fontFamily = {
  sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
  display: ['"Space Grotesk"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
  mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
  /** Editorial serif for titles and hero numerals; never body text. */
  serif: ['"Fraunces Variable"', 'Georgia', 'ui-serif', 'serif'],
} as const

/**
 * Body grows gently; the display steps open up so a page title has real
 * presence. Tracking tightens as size grows (see `h1..h6` in index.css), which
 * is what stops large display type from looking loose.
 */
export const typeScale = {
  xs: 11.5,
  sm: 13.5,
  md: 15,
  lg: 17,
  xl: 20,
  '2xl': 24,
  '3xl': 31,
  '4xl': 40,
  '5xl': 50,
} as const

/** 4px rhythm */
export const spacing = {
  0: 0,
  1: 4,
  1.5: 6,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const

export const radius = {
  none: 0,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  '2xl': 26,
  full: 9999,
} as const

/**
 * Elevation.
 *
 * `card` and `lift` are deliberately near-invisible in light mode: the system
 * wants borders, not shadows, to define resting content, so they exist only to
 * let a *lifted* element separate without a hard edge. On the dark canvas
 * shadows barely register, so those two carry the separation there instead --
 * which is exactly where it is needed.
 */
export const shadow = {
  card: '0 1px 2px rgb(23 19 10 / 0.04), 0 6px 20px -10px rgb(23 19 10 / 0.1)',
  lift: '0 2px 6px rgb(23 19 10 / 0.05), 0 22px 44px -18px rgb(23 19 10 / 0.22)',
  /** Menus, dropdowns, toasts. */
  float: '0 12px 32px -10px rgb(23 19 10 / 0.2)',
  /** Modal dialogs. */
  overlay: '0 32px 80px -24px rgb(23 19 10 / 0.34)',
  /** Soft gold halo for primary actions. */
  glow: '0 10px 30px -10px rgb(184 145 59 / 0.45), 0 2px 6px -2px rgb(184 145 59 / 0.25)',
} as const

/** One decelerate curve for everything, plus a gentle overshoot for toggles. */
export const motion = {
  easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  /** Even, unhurried; for ambient loops and hover follow-through. */
  silk: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  durations: { fast: 150, base: 250, slow: 500, entrance: 680 },
  /** Max 3D lean for interactive cards, in degrees. */
  tilt: 3,
} as const

/** One ring for the whole app, so the keyboard experience is auditable in one place. */
export const focusRing = {
  color: 'var(--ring)',
  width: 2,
  offset: 2,
} as const

export const breakpoints = {
  mobile: 375,
  tablet: 768,
  desktop: 1280,
} as const