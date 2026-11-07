import type { Config } from 'tailwindcss'

/**
 * Token colours are hex CSS variables, which Tailwind cannot split into
 * channels -- so `bg-surface/70` used to compile to nothing at all. Routing each
 * token through `color-mix` with Tailwind's `<alpha-value>` placeholder makes
 * every opacity modifier work against a variable, in both schemes.
 */
const token = (name: string) => `color-mix(in srgb, var(--${name}) calc(<alpha-value> * 100%), transparent)`

export default {
  // `.dark` is toggled on <html> by ThemeProvider so the OS preference is only a
  // default, never an override of the user's explicit choice.
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: token('canvas'),
        'canvas-sunken': token('canvas-sunken'),
        surface: token('surface'),
        'surface-raised': token('surface-raised'),
        line: token('line'),
        'line-strong': token('line-strong'),
        ink: {
          DEFAULT: token('ink'),
          strong: token('ink-strong'),
          faint: token('ink-faint'),
        },
        brand: {
          /*
           * The full ramp. `DEFAULT` is the contrast-guaranteed white-on-fill
           * action colour, so anything that fills a button with `bg-brand` and
           * white text keeps AA. Decoration can reach for any other step.
           */
          50: token('brand-50'),
          100: token('brand-100'),
          200: token('brand-200'),
          300: token('brand-300'),
          400: token('brand-400'),
          DEFAULT: token('brand-500'),
          500: token('brand-500'),
          600: token('brand-600'),
          // Ink panels (sidebar, auth split).
          700: token('brand-700'),
          800: token('brand-800'),
          900: token('brand-900'),
          hover: token('brand-600'),
          // Soft surface tint.
          soft: token('brand-50'),
          // Text, links, icons, focus rings: readable on canvas in both schemes.
          text: token('brand-text'),
          // Logo tile fill; white glyphs sit on it.
          mark: token('brand-mark'),
        },
        accent: token('accent'),
        // Text/icons that sit on a brand fill (ivory on black, black on gold).
        'on-brand': token('on-brand'),
        success: {
          DEFAULT: token('success'),
          soft: token('success-soft'),
        },
        warning: {
          DEFAULT: token('warning'),
          soft: token('warning-soft'),
        },
        danger: {
          DEFAULT: token('danger'),
          soft: token('danger-soft'),
        },
        info: {
          DEFAULT: token('info'),
          soft: token('info-soft'),
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        // Editorial serif for titles and hero numerals; never for body text.
        serif: ['"Fraunces Variable"', 'Georgia', 'ui-serif', 'serif'],
      },
      fontSize: {
        xs: 'var(--text-xs)',
        sm: 'var(--text-sm)',
        md: 'var(--text-md)',
        lg: 'var(--text-lg)',
        xl: 'var(--text-xl)',
        '2xl': 'var(--text-2xl)',
        '3xl': 'var(--text-3xl)',
        '4xl': 'var(--text-4xl)',
        '5xl': 'var(--text-5xl)',
      },
      spacing: {
        1.5: '6px',
        3.5: '14px',
        18: '72px',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        lift: 'var(--shadow-lift)',
        float: 'var(--shadow-float)',
        overlay: 'var(--shadow-overlay)',
        // Coloured halos for primary actions and focused fields.
        // Soft gold halos: wide and low-opacity, so they read as light, not neon.
        glow: '0 10px 30px -10px rgb(var(--glow) / 0.45), 0 2px 6px -2px rgb(var(--glow) / 0.25)',
        'glow-sm': '0 4px 14px -6px rgb(var(--glow) / 0.4)',
      },
      backgroundImage: {
        'brand-gradient': 'var(--gradient-brand)',
        'glow-gradient': 'var(--gradient-glow)',
      },
      transitionTimingFunction: {
        // One deceleration curve for the whole app, so every entrance, hover
        // and state change decelerates the same way.
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        silk: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
      },
      transitionDuration: {
        250: '250ms',
        400: '400ms',
        600: '600ms',
      },
      keyframes: {
        'fade-rise': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'gradient-pan': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        'violation-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
      },
      animation: {
        'fade-rise': 'fade-rise 420ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'gradient-pan': 'gradient-pan 6s ease-in-out infinite',
        float: 'float 6s ease-in-out infinite',
        // Slow enough to read as "live" rather than as a flashing error, and
        // decorative only: the violation count is also written out in text.
        'violation-pulse': 'violation-pulse 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config