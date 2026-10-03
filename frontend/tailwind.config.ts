import type { Config } from 'tailwindcss'

/** `rgb(var(--token) / alpha)` so every semantic colour supports `/opacity` and dark mode. */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`

/**
 * Design system: semantic tokens (canvas, surface, line, ink, brand, lime, aqua
 * and soft status tones) are CSS variables defined per theme in index.css.
 * The legacy navy/teal/pastel scales remain for charts and older call sites.
 */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: token('canvas'),
        surface: { DEFAULT: token('surface'), 2: token('surface-2'), 3: token('surface-3') },
        line: { DEFAULT: token('line'), strong: token('line-strong') },
        ink: { DEFAULT: token('ink'), 2: token('ink-2'), 3: token('ink-3') },
        brand: { DEFAULT: token('brand'), fg: token('brand-fg'), hover: token('brand-hover'), soft: token('brand-soft') },
        lime: { DEFAULT: token('lime'), fg: token('lime-fg') },
        aqua: { DEFAULT: token('aqua'), fg: token('aqua-fg'), soft: token('aqua-soft') },
        tone: {
          'success-bg': token('success-bg'),
          'success-fg': token('success-fg'),
          'success-line': token('success-line'),
          'warning-bg': token('warning-bg'),
          'warning-fg': token('warning-fg'),
          'warning-line': token('warning-line'),
          'danger-bg': token('danger-bg'),
          'danger-fg': token('danger-fg'),
          'danger-line': token('danger-line'),
          'info-bg': token('info-bg'),
          'info-fg': token('info-fg'),
          'info-line': token('info-line'),
          'violet-bg': token('violet-bg'),
          'violet-fg': token('violet-fg'),
          'violet-line': token('violet-line'),
          'neutral-bg': token('neutral-bg'),
          'neutral-fg': token('neutral-fg'),
          'neutral-line': token('neutral-line'),
        },
        navy: {
          50: '#f2f6fa',
          100: '#e2eaf3',
          200: '#c3d3e5',
          300: '#94b1cf',
          400: '#5d86b1',
          500: '#3c6795',
          600: '#2c507a',
          700: '#254163',
          800: '#1c3350',
          900: '#132339',
          950: '#0b1726',
        },
        teal: {
          50: '#effcf9',
          100: '#c7f5ec',
          200: '#94e9dc',
          300: '#5bd6c7',
          400: '#2fbcae',
          500: '#159f94',
          600: '#0d8078',
          700: '#0f6660',
          800: '#10514e',
          900: '#114341',
        },
        pastel: {
          mint: '#D8ECE5',
          mintText: '#134E4A',
          mintBorder: '#BCE1D6',
          rose: '#FCE1E8',
          roseText: '#831843',
          roseBorder: '#F9C8D4',
          butter: '#FEF0C3',
          butterText: '#78350F',
          butterBorder: '#FDE68A',
          lavender: '#E5DEFA',
          lavenderText: '#4C1D95',
          lavenderBorder: '#DDD6FE',
          sky: '#D9EDF8',
          skyText: '#0369A1',
          skyBorder: '#BAE6FD',
          canvas: '#EDF2F6',
          dark: '#18181B',
        },
        role: {
          doctor: '#0f766e',
          patient: '#0284c7',
          nurse: '#7c3aed',
          staff: '#b45309',
          background: '#64748b',
          unknown: '#94a3b8',
        },
        state: {
          live: '#e11d48',
          processing: '#d97706',
          ai: '#0d9488',
          review: '#b45309',
          approved: '#15803d',
          error: '#dc2626',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans Variable"', '"Plus Jakarta Sans"', 'Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        tamil: ['"Nirmala UI"', 'Latha', '"Noto Sans Tamil"', '"Tamil MN"', 'ui-sans-serif', 'sans-serif'],
        hindi: ['"Nirmala UI"', 'Mangal', '"Noto Sans Devanagari"', 'ui-sans-serif', 'sans-serif'],
        mono: ['ui-monospace', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        display: ['2.25rem', { lineHeight: '2.6rem', letterSpacing: '-0.025em', fontWeight: '600' }],
        title: ['1.625rem', { lineHeight: '2rem', letterSpacing: '-0.02em', fontWeight: '600' }],
      },
      borderRadius: {
        card: '1.5rem',
        tile: '1.125rem',
        control: '0.875rem',
      },
      boxShadow: {
        panel: '0 1px 2px rgb(16 24 40 / 0.04)',
        raised: '0 18px 40px -16px rgb(16 24 40 / 0.22)',
        card: '0 1px 2px rgb(16 24 40 / 0.04), 0 1px 1px rgb(16 24 40 / 0.02)',
        float: '0 24px 48px -20px rgb(16 24 40 / 0.28)',
        '2xs': '0 1px 1px rgb(16 24 40 / 0.04)',
        xs: '0 1px 2px rgb(16 24 40 / 0.06)',
      },
      spacing: {
        18: '4.5rem',
      },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.25' },
        },
        'slide-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in-down': {
          '0%': { opacity: '0', transform: 'translateY(-8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'tab-slide': {
          '0%': { opacity: '0', transform: 'translateX(8px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'scale-spring': {
          '0%': { opacity: '0', transform: 'scale(0.97)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'glow-pulse': {
          '0%, 100%': {
            boxShadow: '0 0 15px -3px rgba(20, 184, 166, 0.4), 0 0 6px -2px rgba(20, 184, 166, 0.2)',
          },
          '50%': {
            boxShadow: '0 0 25px 2px rgba(20, 184, 166, 0.6), 0 0 12px 0px rgba(20, 184, 166, 0.3)',
          },
        },
        'ecg-draw': {
          '0%': { strokeDashoffset: '200' },
          '100%': { strokeDashoffset: '0' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'equalizer': {
          '0%, 100%': { height: '4px' },
          '50%': { height: '18px' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'ring-out': {
          '0%': { opacity: '0.55', transform: 'scale(1)' },
          '100%': { opacity: '0', transform: 'scale(1.9)' },
        },
        'flow-dot': {
          '0%': { left: '0%', opacity: '0' },
          '15%': { opacity: '1' },
          '85%': { opacity: '1' },
          '100%': { left: '100%', opacity: '0' },
        },
        reveal: {
          '0%': { opacity: '0', transform: 'translateY(10px)', filter: 'blur(2px)' },
          '100%': { opacity: '1', transform: 'translateY(0)', filter: 'blur(0)' },
        },
        'soft-bounce': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-3px)' },
        },
      },
      animation: {
        'pulse-dot': 'pulse-dot 1.4s ease-in-out infinite',
        'slide-in': 'slide-in 180ms ease-out',
        'fade-in-up': 'fade-in-up 240ms cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in-down': 'fade-in-down 240ms cubic-bezier(0.16, 1, 0.3, 1)',
        'tab-slide': 'tab-slide 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-spring': 'scale-spring 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        'glow-pulse': 'glow-pulse 2.5s ease-in-out infinite',
        'ecg-draw': 'ecg-draw 1.8s linear infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'equalizer-1': 'equalizer 0.8s ease-in-out infinite 0.1s',
        'equalizer-2': 'equalizer 0.8s ease-in-out infinite 0.3s',
        'equalizer-3': 'equalizer 0.8s ease-in-out infinite 0.15s',
        'equalizer-4': 'equalizer 0.8s ease-in-out infinite 0.4s',
        'fade-in': 'fade-in 160ms ease-out',
        'ring-out': 'ring-out 2.4s cubic-bezier(0.2, 0.6, 0.3, 1) infinite',
        'flow-dot': 'flow-dot 1.6s ease-in-out infinite',
        reveal: 'reveal 420ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'soft-bounce': 'soft-bounce 1.4s ease-in-out infinite',
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
} satisfies Config
