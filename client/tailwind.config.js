/** @type {import('tailwindcss').Config} */

// Semantic color backed by an RGB-channel CSS variable (see src/index.css).
// Supports Tailwind opacity modifiers, e.g. `bg-surface/80`.
const token = (name) => `rgb(var(--ds-${name}) / <alpha-value>)`;

export default {
    darkMode: 'class',
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                // ---- Design system v2 (semantic, theme-aware) ----
                canvas: {
                    DEFAULT: token('canvas'),
                    subtle: token('canvas-subtle'),
                },
                surface: {
                    DEFAULT: token('surface'),
                    2: token('surface-2'),
                    3: token('surface-3'),
                },
                raised: token('raised'),
                fg: {
                    DEFAULT: token('fg'),
                    muted: token('fg-muted'),
                    subtle: token('fg-subtle'),
                    disabled: token('fg-disabled'),
                },
                line: {
                    DEFAULT: 'rgb(var(--ds-line) / 0.08)',
                    strong: 'rgb(var(--ds-line) / 0.14)',
                },
                accent: {
                    DEFAULT: token('accent'),
                    hover: token('accent-hover'),
                    fg: token('accent-fg'),
                    on: token('on-accent'),
                    // legacy keys
                    2: '#34D399',
                    glow: 'rgba(16, 185, 129, 0.18)',
                    'glow-strong': 'rgba(16, 185, 129, 0.30)',
                },
                danger: {
                    DEFAULT: token('danger'),
                    fg: token('danger-fg'),
                },

                // ---- Legacy v1 (hex, dark-only) — do not use in new code ----
                background: {
                    DEFAULT: '#08090C',
                    secondary: '#0C0D12',
                },
                positive: {
                    DEFAULT: '#10B981',
                    light: '#34D399',
                    dim: 'rgba(16, 185, 129, 0.15)',
                    subtle: 'rgba(16, 185, 129, 0.08)',
                },
                negative: {
                    DEFAULT: '#F43F5E',
                    light: '#FB7185',
                    dim: 'rgba(244, 63, 94, 0.14)',
                },
                warning: {
                    DEFAULT: '#F59E0B',
                    dim: 'rgba(245, 158, 11, 0.14)',
                },
                purple: {
                    DEFAULT: '#8B5CF6',
                    light: '#A78BFA',
                    dim: 'rgba(139, 92, 246, 0.15)',
                },
                brandText: {
                    primary: '#F3F4F6',
                    secondary: '#9CA3AF',
                    muted: '#6B7280',
                    disabled: '#4B5563',
                },
                brandBorder: {
                    DEFAULT: 'rgba(255, 255, 255, 0.08)',
                    light: 'rgba(255, 255, 255, 0.12)',
                    hover: 'rgba(16, 185, 129, 0.40)',
                    active: 'rgba(16, 185, 129, 0.60)',
                },
            },
            borderRadius: {
                sm: '4px',
                md: '6px',
                lg: '8px',
                card: '12px',
                control: '12px',
                hero: '14px',
                xl: '16px',
                panel: '24px',
                pill: '999px',
            },
            boxShadow: {
                glow: '0 0 24px rgb(var(--ds-accent) / 0.30)',
                'focus-accent': '0 0 0 3px rgb(var(--ds-accent) / 0.18)',
                'focus-danger': '0 0 0 3px rgb(var(--ds-danger) / 0.18)',
                panel: '0 24px 64px -16px rgb(0 0 0 / 0.55)',
            },
            keyframes: {
                'fade-in-up': {
                    from: { opacity: '0', transform: 'translateY(4px)' },
                    to: { opacity: '1', transform: 'translateY(0)' },
                },
            },
            animation: {
                'fade-in-up': 'fade-in-up 180ms ease-out both',
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
                mono: ["'JetBrains Mono'", 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
            },
        },
    },
    plugins: [],
}
