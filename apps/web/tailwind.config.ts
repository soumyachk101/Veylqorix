import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        'surface-2': 'var(--color-surface-2)',
        screen: 'var(--color-screen)',
        'screen-2': 'var(--color-screen-2)',
        'screen-ink': 'var(--color-screen-ink)',
        'screen-dim': 'var(--color-screen-dim)',
        navy: 'var(--color-navy)',
        line: 'var(--color-line)',
        'line-soft': 'var(--color-line-soft)',
        teal: 'var(--color-teal)',
        'teal-deep': 'var(--color-teal-deep)',
        mint: 'var(--color-mint)',
        gold: 'var(--color-gold)',
        coral: 'var(--color-coral)',
        ink: 'var(--color-ink)',
        'ink-dim': 'var(--color-ink-dim)',
        'ink-faint': 'var(--color-ink-faint)',
        'gold-faint': 'var(--color-gold-faint)',
        'coral-faint': 'var(--color-coral-faint)',
      },
      fontFamily: {
        pixel: ['var(--font-pixel)', 'monospace'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      boxShadow: {
        pixel: '4px 4px 0 rgba(15, 44, 64, 0.16)',
        'pixel-sm': '2px 2px 0 rgba(15, 44, 64, 0.16)',
        'pixel-teal': '4px 4px 0 rgba(12, 138, 134, 0.4)',
      },
    },
  },
  plugins: [],
};

export default config;
