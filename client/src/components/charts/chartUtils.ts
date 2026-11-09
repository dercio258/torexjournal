import { useCallback, useEffect, useRef, useState } from 'react';

/** Signed money, e.g. +$1,234.50 / -$80.00 / $0.00 */
export const formatMoney = (v: number, opts: { sign?: boolean; decimals?: number } = {}) => {
    const { sign = true, decimals = 2 } = opts;
    const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    if (Math.abs(v) < 1e-9) return `$${abs}`;
    return `${v < 0 ? '-' : sign ? '+' : ''}$${abs}`;
};

/** Compact axis label: $0 / $500 / $1.5K / -$2K / $1.2M (one style per axis). */
export const formatMoneyCompact = (v: number) => {
    const abs = Math.abs(v);
    const s = v < 0 ? '-' : '';
    if (abs < 1e-9) return '$0';
    if (abs >= 1e6) return `${s}$${+(abs / 1e6).toFixed(1)}M`;
    if (abs >= 1e4) return `${s}$${+(abs / 1e3).toFixed(0)}K`;
    if (abs >= 1e3) return `${s}$${+(abs / 1e3).toFixed(1)}K`;
    return `${s}$${+abs.toFixed(abs < 10 ? 1 : 0)}`;
};

/** Round step (1/2/5 × 10^n) so a range splits into ~`count` intervals. */
const niceStep = (range: number, count: number) => {
    const raw = range / Math.max(count, 1);
    const pow = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const f = raw / pow;
    return (f >= 5 ? 10 : f >= 2 ? 5 : f >= 1 ? 2 : 1) * pow;
};

/**
 * Clean ticks covering [min, max] and always including 0 (P&L charts are
 * anchored to the zero line). Returns the padded domain too.
 */
export const niceDomain = (min: number, max: number, count = 4) => {
    const lo = Math.min(0, min);
    const hi = Math.max(0, max);
    const span = hi - lo || Math.max(Math.abs(hi), 10);
    const step = niceStep(span, count);
    const dMin = Math.floor(lo / step) * step;
    const dMax = Math.ceil(hi / step) * step || step;
    const ticks: number[] = [];
    for (let v = dMin; v <= dMax + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
    return { min: dMin, max: dMax, ticks };
};

/** Observed content width of an element (for crisp, undistorted SVG). */
export const useElementWidth = <T extends HTMLElement>() => {
    const observer = useRef<ResizeObserver | null>(null);
    const [width, setWidth] = useState(0);

    // Callback ref: re-observes whenever the element mounts/unmounts
    // (e.g. after toggling from table view or from an empty state).
    const ref = useCallback((el: T | null) => {
        observer.current?.disconnect();
        observer.current = null;
        if (!el) return;
        const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
        ro.observe(el);
        observer.current = ro;
        setWidth(Math.floor(el.getBoundingClientRect().width));
    }, []);

    useEffect(() => () => observer.current?.disconnect(), []);
    return [ref, width] as const;
};

/** Pick ~`target` evenly spaced indices (always first & last) for x-axis labels. */
export const pickLabelIndices = (count: number, target: number) => {
    if (count <= target) return Array.from({ length: count }, (_, i) => i);
    const out = new Set<number>([0, count - 1]);
    const step = (count - 1) / (target - 1);
    for (let i = 1; i < target - 1; i++) out.add(Math.round(i * step));
    return [...out].sort((a, b) => a - b);
};
