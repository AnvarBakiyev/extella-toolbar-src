import type { Config } from 'tailwindcss';

/**
 * Tailwind v3 config — every color / spacing / radius / font-size token resolves
 * through CSS variables defined in `src/styles/tokens.css`. Theme switching is
 * therefore a single attribute change on <html> (`data-theme="light|dark"`) and
 * never requires a Tailwind rebuild.
 *
 * The set of `colors.*` keys mirrors the variables enumerated in tokens.css
 * (light + dark blocks) so utilities like `bg-bgCard` or `text-accent` map 1:1
 * to the design tokens.
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    container: { center: true, padding: '1.5rem', screens: { '2xl': '1400px' } },
    extend: {
      colors: {
        // base surfaces
        bg: 'var(--ap-bg)',
        bgInset: 'var(--ap-bg-inset)',
        bg2: 'var(--ap-bg-2)',
        bg3: 'var(--ap-bg-3)',
        bgCard: 'var(--ap-bg-card)',
        overlay: 'var(--ap-overlay)',

        // borders / dividers
        border: 'var(--ap-border)',
        borderStrong: 'var(--ap-border-strong)',
        divider: 'var(--ap-divider)',

        // text
        text: 'var(--ap-text)',
        textMuted: 'var(--ap-text-muted)',
        textFaint: 'var(--ap-text-faint)',
        textOnFill: 'var(--ap-text-on-fill)',

        // iconography
        icon: 'var(--ap-icon)',
        iconMuted: 'var(--ap-icon-muted)',

        // semantic
        success: 'var(--ap-success)',
        successSoft: 'var(--ap-success-soft)',
        warning: 'var(--ap-warning)',
        warningSoft: 'var(--ap-warning-soft)',
        danger: 'var(--ap-danger)',
        dangerSoft: 'var(--ap-danger-soft)',
        info: 'var(--ap-info)',
        infoSoft: 'var(--ap-info-soft)',

        // accent system
        accent: 'var(--ap-accent)',
        accentFg: 'var(--ap-accent-fg)',
        accentSoft: 'var(--ap-accent-soft)',
        accentSoftStrong: 'var(--ap-accent-soft-strong)',
        accentBg: 'var(--ap-accent-bg)',
        accentBorder: 'var(--ap-accent-border)',

        // monochrome fill button (used for confirm CTAs in design)
        fillBtn: 'var(--ap-fill-btn)',
        fillBtnFg: 'var(--ap-fill-btn-fg)',
      },
      spacing: {
        s1: 'var(--ap-s-1)',
        s2: 'var(--ap-s-2)',
        s3: 'var(--ap-s-3)',
        s4: 'var(--ap-s-4)',
        s5: 'var(--ap-s-5)',
        s6: 'var(--ap-s-6)',
        s7: 'var(--ap-s-7)',
        s8: 'var(--ap-s-8)',
      },
      borderRadius: {
        xs: 'var(--ap-r-xs)',
        sm: 'var(--ap-r-sm)',
        md: 'var(--ap-r-md)',
        lg: 'var(--ap-r-lg)',
        xl: 'var(--ap-r-xl)',
        pill: 'var(--ap-r-pill)',
      },
      fontSize: {
        xs: 'var(--ap-fs-xs)',
        sm: 'var(--ap-fs-sm)',
        md: 'var(--ap-fs-md)',
        base: 'var(--ap-fs-base)',
        lg: 'var(--ap-fs-lg)',
        xl: 'var(--ap-fs-xl)',
        '2xl': 'var(--ap-fs-2xl)',
      },
      lineHeight: {
        tight: 'var(--ap-lh-tight)',
        normal: 'var(--ap-lh-normal)',
        loose: 'var(--ap-lh-loose)',
      },
      fontFamily: {
        sans: ['var(--ap-font)'],
        mono: ['var(--ap-font-mono)'],
      },
      boxShadow: {
        pop: 'var(--ap-shadow-pop)',
        card: 'var(--ap-shadow-card)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-out': { from: { opacity: '1' }, to: { opacity: '0' } },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'slide-out-right': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(100%)' },
        },
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'fade-out': 'fade-out 150ms ease-out',
        'slide-in-right': 'slide-in-right 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-out-right': 'slide-out-right 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        'accordion-down': 'accordion-down 200ms ease-out',
        'accordion-up': 'accordion-up 200ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
