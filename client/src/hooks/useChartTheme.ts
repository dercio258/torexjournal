import { useMemo } from 'react';
import { useTheme } from '../context/ThemeContext';

/**
 * Neutral chart colors resolved from the design tokens of the current theme.
 * Use for axes, grids, labels and tooltips; keep data colors (P&L green/red,
 * series hues) as they are.
 *
 * Canvas libraries (chart.js, lightweight-charts) can't read CSS variables,
 * so values are resolved to concrete rgb() strings and recomputed on theme change.
 */
export interface ChartTheme {
    /** Axis tick / legend text. */
    tick: string;
    /** Prominent labels (radar point labels, titles). */
    label: string;
    /** Subtle grid lines. */
    grid: string;
    /** Stronger grid lines / axis borders. */
    gridStrong: string;
    tooltipBg: string;
    tooltipBorder: string;
    tooltipTitle: string;
    tooltipBody: string;
    /** Chart background (for libs that paint their own). */
    background: string;
    isDark: boolean;
}

const read = (name: string, fallback: string) => {
    if (typeof window === 'undefined') return fallback;
    const v = getComputedStyle(document.documentElement).getPropertyValue(`--ds-${name}`).trim();
    return v || fallback;
};

const rgb = (channels: string, alpha = 1) => `rgba(${channels.split(/\s+/).join(', ')}, ${alpha})`;

export const resolveChartTheme = (isDark: boolean): ChartTheme => {
    const fg = read('fg', isDark ? '243 244 246' : '15 23 42');
    const muted = read('fg-muted', isDark ? '156 163 175' : '71 85 105');
    const subtle = read('fg-subtle', isDark ? '107 114 128' : '100 116 139');
    const line = read('line', isDark ? '255 255 255' : '15 23 42');
    const raised = read('raised', isDark ? '14 16 23' : '255 255 255');
    const surface = read('surface', isDark ? '17 19 25' : '255 255 255');

    return {
        tick: rgb(subtle),
        label: rgb(muted),
        grid: rgb(line, isDark ? 0.06 : 0.07),
        gridStrong: rgb(line, isDark ? 0.12 : 0.14),
        tooltipBg: rgb(raised, 0.96),
        tooltipBorder: rgb(line, 0.14),
        tooltipTitle: rgb(fg),
        tooltipBody: rgb(muted),
        background: rgb(surface),
        isDark,
    };
};

export const useChartTheme = (): ChartTheme => {
    const { theme } = useTheme();
    // ThemeProvider applies the html class in an effect; tokens on :root/html.light
    // resolve immediately from the class, so recompute when the theme value changes.
    return useMemo(() => resolveChartTheme(theme === 'dark'), [theme]);
};
