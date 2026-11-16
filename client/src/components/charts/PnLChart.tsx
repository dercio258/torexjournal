import React, { useId, useMemo, useState } from 'react';
import { BarChart3, Info, TrendingUp } from 'lucide-react';
import { cn } from '../../lib/cn';
import { ChartCard, ChartEmpty, Segmented } from './ChartCard';
import { formatMoney, formatMoneyCompact, niceDomain, pickLabelIndices, useElementWidth } from './chartUtils';

export interface DailyPoint {
    isoDate: string;
    /** dd/mm label */
    date: string;
    value: number;
    trades?: number;
    winRate?: number;
}

type Mode = 'cumulative' | 'daily';

const HEIGHT = 240;
const COMPACT_HEIGHT = 212;
const M_DEFAULT = { top: 14, right: 16, bottom: 26, left: 54 };
const M_COMPACT = { top: 12, right: 10, bottom: 24, left: 48 };
const BAR_MAX = 32;
const RADIUS = 5;

/** Column path with a rounded data-end and a square baseline end. */
const barPath = (x: number, w: number, y0: number, y1: number) => {
    const up = y1 < y0;
    const h = Math.abs(y1 - y0);
    const r = Math.min(RADIUS, w / 2, h);
    if (h < 0.5) return '';
    if (up) {
        return `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z`;
    }
    return `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 - r} V${y0} Z`;
};

/**
 * Smooth monotone cubic spline through (pts) so that 2, 3, or N points render
 * a balanced, responsive curve without overshooting extrema.
 */
const buildSmoothPath = (pts: { x: number; y: number }[]) => {
    const len = pts.length;
    if (len === 0) return '';
    if (len === 1) return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
    if (len === 2) {
        const [p0, p1] = pts;
        const dx = (p1.x - p0.x) * 0.38;
        return `M${p0.x.toFixed(1)},${p0.y.toFixed(1)} C${(p0.x + dx).toFixed(1)},${p0.y.toFixed(1)} ${(p1.x - dx).toFixed(1)},${p1.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
    }

    const d: string[] = [`M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`];
    for (let i = 0; i < len - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(len - 1, i + 2)];

        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;

        const minY = Math.min(p1.y, p2.y);
        const maxY = Math.max(p1.y, p2.y);
        const rawCp1y = p1.y + (p2.y - p0.y) / 6;
        const rawCp2y = p2.y - (p3.y - p1.y) / 6;
        const cp1y = Math.min(maxY, Math.max(minY, rawCp1y));
        const cp2y = Math.min(maxY, Math.max(minY, rawCp2y));

        d.push(`C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`);
    }
    return d.join(' ');
};

const longDate = (iso: string, locale: 'pt' | 'en' = 'pt') => {
    if (iso === '__anchor__') return locale === 'en' ? 'Period starting balance' : 'Saldo inicial do período';
    return new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale === 'en' ? 'en-US' : 'pt-BR', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        timeZone: 'UTC',
    });
};

interface PlotRow extends DailyPoint {
    cumulative: number;
    isAnchor?: boolean;
}

/**
 * Period result chart.
 * Supports:
 * - Interactive mode toggle (`fixedMode` omitted)
 * - Dedicated single-purpose horizontal cards (`fixedMode="cumulative"` or `fixedMode="daily"`)
 */
export const PnLChart = ({
    data,
    className,
    compact = false,
    fixedMode,
    locale = 'pt',
}: {
    data: DailyPoint[];
    className?: string;
    compact?: boolean;
    fixedMode?: Mode;
    locale?: 'pt' | 'en';
}) => {
    const isEn = locale === 'en';
    const [internalMode, setInternalMode] = useState<Mode>('cumulative');
    const mode: Mode = fixedMode ?? internalMode;
    const isSlim = compact || Boolean(fixedMode);

    const [active, setActive] = useState<number | null>(null);
    const [showTable, setShowTable] = useState(false);
    const [wrapRef, width] = useElementWidth<HTMLDivElement>();
    const clipId = useId().replace(/:/g, '');

    const chartHeight = isSlim ? COMPACT_HEIGHT : HEIGHT;
    const M = isSlim ? M_COMPACT : M_DEFAULT;

    // Aggregate same-day entries if backend sends duplicate dates
    const rows = useMemo(() => {
        const byDate = new Map<string, DailyPoint>();
        for (const d of data) {
            const key = d.isoDate || d.date;
            const prev = byDate.get(key);
            if (prev) {
                prev.value = Math.round((prev.value + d.value) * 100) / 100;
                prev.trades = (prev.trades || 0) + (d.trades || 0);
            } else {
                byDate.set(key, { ...d, value: Math.round((Number(d.value) || 0) * 100) / 100 });
            }
        }
        let acc = 0;
        return Array.from(byDate.values()).map((d) => {
            acc += d.value;
            return { ...d, cumulative: Math.round(acc * 100) / 100 };
        });
    }, [data]);

    // In cumulative mode, prepend a $0.00 origin anchor so 1 or 2 days always form a complete equity curve
    const plotRows: PlotRow[] = useMemo(() => {
        if (rows.length === 0) return [];
        if (mode === 'cumulative') {
            return [
                { isoDate: '__anchor__', date: isEn ? 'Start' : 'Início', value: 0, cumulative: 0, isAnchor: true },
                ...rows,
            ];
        }
        return rows;
    }, [rows, mode, isEn]);

    const summary = useMemo(() => {
        const vals = rows.map((r) => r.value);
        const net = vals.reduce((a, b) => a + b, 0);
        const best = rows.reduce<(typeof rows)[number] | null>((b, r) => (!b || r.value > b.value ? r : b), null);
        const worst = rows.reduce<(typeof rows)[number] | null>((b, r) => (!b || r.value < b.value ? r : b), null);
        const green = vals.filter((v) => v > 0).length;
        const red = vals.filter((v) => v < 0).length;
        return { net, best, worst, green, red, days: vals.length };
    }, [rows]);

    const plotW = Math.max(0, width - M.left - M.right);
    const plotH = chartHeight - M.top - M.bottom;

    const series = plotRows.map((r) => (mode === 'cumulative' ? r.cumulative : r.value));
    const domain = useMemo(
        () => niceDomain(Math.min(...series, 0), Math.max(...series, 0), 4),
        [series.join(',')] // eslint-disable-line react-hooks/exhaustive-deps
    );

    const y = (v: number) => M.top + plotH - ((v - domain.min) / (domain.max - domain.min || 1)) * plotH;
    const zeroY = y(0);
    const n = plotRows.length;
    const band = n > 0 ? plotW / n : 0;

    const xCenter = (i: number) => {
        if (mode === 'daily' || n === 1) {
            return M.left + band * (i + 0.5);
        }
        const inset = n <= 3 ? Math.min(20, plotW * 0.05) : 0;
        const usableW = Math.max(0, plotW - inset * 2);
        return M.left + inset + (i / (n - 1)) * usableW;
    };

    const points = useMemo(
        () => series.map((v, i) => ({ x: xCenter(i), y: y(v), v })),
        [mode, series.join(','), plotW, domain.min, domain.max] // eslint-disable-line react-hooks/exhaustive-deps
    );

    const linePath = useMemo(() => {
        if (mode !== 'cumulative' || points.length < 2) return '';
        return buildSmoothPath(points);
    }, [mode, points]);

    const areaPath = useMemo(() => {
        if (!linePath || points.length < 2) return '';
        return `${linePath} L${points[points.length - 1].x.toFixed(1)},${zeroY.toFixed(1)} L${points[0].x.toFixed(1)},${zeroY.toFixed(1)} Z`;
    }, [linePath, points, zeroY]);

    // Deduplicate X-axis labels so the same date string is never drawn twice
    const labelIdx = useMemo(() => {
        const maxTicks = Math.max(2, Math.min(isSlim ? 5 : 7, Math.floor(plotW / 68)));
        const rawIdx = pickLabelIndices(n, maxTicks);
        const seen = new Set<string>();
        return rawIdx.filter((i) => {
            const lbl = plotRows[i]?.date;
            if (!lbl || seen.has(lbl)) return false;
            seen.add(lbl);
            return true;
        });
    }, [n, plotW, plotRows, isSlim]);

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (!n) return;
        if (e.key === 'ArrowRight') setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
        else if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? n) - 1));
        else if (e.key === 'Escape') setActive(null);
        else return;
        e.preventDefault();
    };

    const activeRow = active !== null ? plotRows[active] : null;
    const halfTip = 88;
    const tipLeft =
        active !== null ? Math.max(halfTip, Math.min(xCenter(active), Math.max(halfTip, width - halfTip))) : 0;

    const netTone = summary.net > 0 ? 'text-accent-fg' : summary.net < 0 ? 'text-danger-fg' : 'text-fg';

    const resolvedTitle =
        fixedMode === 'cumulative'
            ? isEn
                ? 'Cumulative Net P&L'
                : 'P&L Líquido Acumulativo'
            : fixedMode === 'daily'
              ? isEn
                  ? 'Daily Net P&L'
                  : 'P&L Líquido Diário'
              : compact
                ? isEn
                    ? 'Daily Net P&L'
                    : 'P&L Líquido Diário'
                : isEn
                  ? 'Period Performance'
                  : 'Resultado do período';

    const resolvedTooltip =
        fixedMode === 'cumulative'
            ? isEn
                ? 'Cumulative closed net P&L (UTC) across the selected period.'
                : 'Evolução acumulada do resultado líquido fechado (UTC) ao longo do período selecionado.'
            : fixedMode === 'daily'
              ? isEn
                  ? 'Day-by-day closed net P&L (UTC) above and below the zero baseline.'
                  : 'Resultado líquido fechado dia a dia (UTC) acima e abaixo da linha zero.'
              : isEn
                ? 'Closed net equity curve by day (UTC). Toggle between Cumulative and Daily.'
                : 'Curva líquida de operações fechadas por dia (UTC). Alterne entre Acumulativo e Diário.';

    const headerActions = (() => {
        if (rows.length === 0) return null;

        if (fixedMode === 'cumulative') {
            return (
                <span
                    className={cn(
                        'px-2 py-0.5 rounded-md border border-line bg-canvas-subtle text-[11px] font-bold tabular-nums',
                        netTone
                    )}
                >
                    {formatMoney(summary.net)}
                </span>
            );
        }

        if (fixedMode === 'daily') {
            return (
                <span className="px-2 py-0.5 rounded-md border border-line bg-canvas-subtle text-[11px] font-semibold tabular-nums text-fg-muted">
                    <span className="text-accent-fg">{summary.green}W</span>
                    <span className="mx-1 text-fg-subtle">·</span>
                    <span className="text-danger-fg">{summary.red}L</span>
                </span>
            );
        }

        return (
            <>
                <Segmented
                    label={isEn ? 'Chart mode' : 'Modo do gráfico'}
                    value={mode}
                    onChange={(m) => {
                        setInternalMode(m);
                        setActive(null);
                    }}
                    options={[
                        { value: 'cumulative', label: isEn ? 'Cumulative' : compact ? 'Acumulativo' : 'Acumulado' },
                        { value: 'daily', label: isEn ? 'Daily' : 'Diário' },
                    ]}
                />
                {!compact && (
                    <button
                        type="button"
                        onClick={() => setShowTable((s) => !s)}
                        aria-pressed={showTable}
                        className="rounded-md px-2 py-1 text-[11px] font-semibold text-fg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                    >
                        {showTable ? (isEn ? 'Chart' : 'Gráfico') : isEn ? 'Table' : 'Tabela'}
                    </button>
                )}
            </>
        );
    })();

    return (
        <ChartCard
            className={cn('h-full justify-between hover:border-line-strong transition-colors', className)}
            title={resolvedTitle}
            icon={
                isSlim ? (
                    <span title={resolvedTooltip} className="inline-flex cursor-help text-fg-subtle hover:text-fg">
                        <Info size={13} />
                    </span>
                ) : mode === 'daily' ? (
                    <BarChart3 size={14} />
                ) : (
                    <TrendingUp size={14} />
                )
            }
            subtitle={
                isSlim
                    ? undefined
                    : rows.length
                      ? isEn
                          ? `${rows.length} ${rows.length === 1 ? 'trading day' : 'trading days'} · UTC close`
                          : `${rows.length} ${rows.length === 1 ? 'dia operado' : 'dias operados'} · fechamento em UTC`
                      : undefined
            }
            actions={headerActions}
        >
            {rows.length === 0 ? (
                <ChartEmpty
                    message={isEn ? 'No closed trades in this period' : 'Nenhuma operação fechada no período'}
                    hint={isEn ? 'Sync your account or log trades to visualize your equity curve.' : 'Sincronize a conta ou adicione trades para visualizar.'}
                    className={isSlim ? 'min-h-[250px]' : 'min-h-[252px]'}
                />
            ) : (
                <>
                    {!isSlim && (
                        <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4 border-b border-line pb-3">
                            <div>
                                <dt className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">{isEn ? 'Net' : 'Líquido'}</dt>
                                <dd className={cn('text-base sm:text-lg font-bold tabular-nums', netTone)}>{formatMoney(summary.net)}</dd>
                            </div>
                            <div>
                                <dt className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">{isEn ? 'Winning days' : 'Dias positivos'}</dt>
                                <dd className="text-base sm:text-lg font-bold text-fg tabular-nums">
                                    {summary.green}
                                    <span className="text-xs font-medium text-fg-subtle">/{summary.days}</span>
                                </dd>
                            </div>
                            <div>
                                <dt className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">{isEn ? 'Best day' : 'Melhor dia'}</dt>
                                <dd className="text-xs sm:text-sm font-semibold text-fg tabular-nums mt-0.5">
                                    {summary.best && summary.best.value > 0 ? (
                                        <span>
                                            <span className="text-accent-fg">{formatMoney(summary.best.value)}</span>
                                            <span className="text-fg-subtle font-normal"> · {summary.best.date}</span>
                                        </span>
                                    ) : (
                                        '—'
                                    )}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">{isEn ? 'Worst day' : 'Pior dia'}</dt>
                                <dd className="text-xs sm:text-sm font-semibold text-fg tabular-nums mt-0.5">
                                    {summary.worst && summary.worst.value < 0 ? (
                                        <span>
                                            <span className="text-danger-fg">{formatMoney(summary.worst.value)}</span>
                                            <span className="text-fg-subtle font-normal"> · {summary.worst.date}</span>
                                        </span>
                                    ) : (
                                        '—'
                                    )}
                                </dd>
                            </div>
                        </dl>
                    )}

                    {showTable && !isSlim ? (
                        <div className="max-h-[252px] overflow-auto rounded-lg border border-line">
                            <table className="w-full text-xs">
                                <caption className="sr-only">{isEn ? 'Daily and cumulative P&L' : 'Resultado diário e acumulado'}</caption>
                                <thead className="sticky top-0 bg-surface-2 text-fg-muted">
                                    <tr>
                                        <th scope="col" className="px-3 py-2 text-left font-semibold">{isEn ? 'Day' : 'Dia'}</th>
                                        <th scope="col" className="px-3 py-2 text-right font-semibold">{isEn ? 'Net P&L' : 'Resultado'}</th>
                                        <th scope="col" className="px-3 py-2 text-right font-semibold">{isEn ? 'Cumulative' : 'Acumulado'}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-line tabular-nums">
                                    {rows.map((r) => (
                                        <tr key={r.isoDate}>
                                            <td className="px-3 py-1.5 text-fg-muted">{longDate(r.isoDate, locale)}</td>
                                            <td className={cn('px-3 py-1.5 text-right font-semibold', r.value > 0 ? 'text-accent-fg' : r.value < 0 ? 'text-danger-fg' : 'text-fg')}>
                                                {formatMoney(r.value)}
                                            </td>
                                            <td className="px-3 py-1.5 text-right text-fg">{formatMoney(r.cumulative)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div
                            ref={wrapRef}
                            className="relative w-full my-auto rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                            style={{ height: chartHeight }}
                            tabIndex={0}
                            role="img"
                            aria-label={
                                isEn
                                    ? `${mode === 'cumulative' ? 'Cumulative P&L' : 'Daily P&L'}: ${rows.length} days, net ${formatMoney(summary.net)}. Use arrow keys to step through days.`
                                    : `${mode === 'cumulative' ? 'Resultado acumulado' : 'Resultado diário'}: ${rows.length} dias, líquido ${formatMoney(summary.net)}. Use as setas para percorrer os dias.`
                            }
                            onKeyDown={onKeyDown}
                            onBlur={() => setActive(null)}
                            onMouseLeave={() => setActive(null)}
                        >
                            {width > 0 && (
                                <svg width={width} height={chartHeight} className="block overflow-visible" aria-hidden>
                                    <defs>
                                        <clipPath id={`${clipId}-above`}>
                                            <rect x={M.left} y={0} width={plotW} height={Math.max(0, zeroY)} />
                                        </clipPath>
                                        <clipPath id={`${clipId}-below`}>
                                            <rect x={M.left} y={zeroY} width={plotW} height={Math.max(0, chartHeight - zeroY)} />
                                        </clipPath>
                                        <linearGradient id={`${clipId}-grad-pos`} x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="rgb(var(--ds-data-pos))" stopOpacity="0.36" />
                                            <stop offset="100%" stopColor="rgb(var(--ds-data-pos))" stopOpacity="0.03" />
                                        </linearGradient>
                                        <linearGradient id={`${clipId}-grad-neg`} x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="rgb(var(--ds-data-neg))" stopOpacity="0.03" />
                                            <stop offset="100%" stopColor="rgb(var(--ds-data-neg))" stopOpacity="0.36" />
                                        </linearGradient>
                                    </defs>

                                    {/* Horizontal Grid Lines */}
                                    {domain.ticks.map((t) => (
                                        <g key={t}>
                                            <line
                                                x1={M.left}
                                                x2={M.left + plotW}
                                                y1={y(t)}
                                                y2={y(t)}
                                                className={t === 0 ? 'stroke-fg-subtle/50' : 'stroke-line'}
                                                strokeDasharray={t === 0 ? undefined : '3 3'}
                                                strokeWidth={1}
                                                shapeRendering="crispEdges"
                                            />
                                            <text
                                                x={M.left - 8}
                                                y={y(t)}
                                                dy="0.32em"
                                                textAnchor="end"
                                                className="fill-fg-subtle text-[10.5px] tabular-nums font-medium"
                                            >
                                                {formatMoneyCompact(t)}
                                            </text>
                                        </g>
                                    ))}

                                    {/* X-axis Labels (Deduplicated) */}
                                    {labelIdx.map((i, k) => (
                                        <text
                                            key={i}
                                            x={xCenter(i)}
                                            y={chartHeight - 5}
                                            textAnchor={
                                                mode === 'cumulative' && n > 1
                                                    ? k === 0
                                                        ? 'start'
                                                        : k === labelIdx.length - 1
                                                          ? 'end'
                                                          : 'middle'
                                                    : 'middle'
                                            }
                                            className="fill-fg-subtle text-[10.5px] tabular-nums font-medium"
                                        >
                                            {plotRows[i].date}
                                        </text>
                                    ))}

                                    {/* Daily Mode: Columns */}
                                    {mode === 'daily' &&
                                        plotRows.map((r, i) => {
                                            const w = Math.max(4, Math.min(BAR_MAX, band - 3, band * 0.65));
                                            const x = xCenter(i) - w / 2;
                                            return (
                                                <g key={r.isoDate}>
                                                    {n <= 7 && (
                                                        <line
                                                            x1={xCenter(i)}
                                                            x2={xCenter(i)}
                                                            y1={M.top}
                                                            y2={M.top + plotH}
                                                            className="stroke-line-strong"
                                                            strokeWidth={1}
                                                        />
                                                    )}
                                                    <path
                                                        d={barPath(x, w, zeroY, y(r.value))}
                                                        className={cn(
                                                            'transition-opacity duration-150',
                                                            r.value >= 0 ? 'fill-data-pos' : 'fill-data-neg',
                                                            active !== null && active !== i && 'opacity-40'
                                                        )}
                                                    />
                                                </g>
                                            );
                                        })}

                                    {/* Cumulative Mode: Smooth Area + Curve + Adaptive Nodes */}
                                    {mode === 'cumulative' && points.length >= 2 && (
                                        <>
                                            <path d={areaPath} clipPath={`url(#${clipId}-above)`} fill={`url(#${clipId}-grad-pos)`} />
                                            <path d={areaPath} clipPath={`url(#${clipId}-below)`} fill={`url(#${clipId}-grad-neg)`} />
                                            <path
                                                d={linePath}
                                                clipPath={`url(#${clipId}-above)`}
                                                fill="none"
                                                strokeWidth={2.25}
                                                strokeLinejoin="round"
                                                strokeLinecap="round"
                                                className="stroke-data-pos"
                                            />
                                            <path
                                                d={linePath}
                                                clipPath={`url(#${clipId}-below)`}
                                                fill="none"
                                                strokeWidth={2.25}
                                                strokeLinejoin="round"
                                                strokeLinecap="round"
                                                className="stroke-data-neg"
                                            />

                                            {points.map((pt, i) => {
                                                const isLast = i === points.length - 1;
                                                const isAnchor = plotRows[i]?.isAnchor;
                                                const showDot = points.length <= 12 || isLast || i === 0;
                                                if (!showDot) return null;

                                                return (
                                                    <circle
                                                        key={i}
                                                        cx={pt.x}
                                                        cy={pt.y}
                                                        r={isLast ? 4 : isAnchor ? 2.8 : 3.2}
                                                        strokeWidth={2}
                                                        className={cn(
                                                            'stroke-surface transition-transform duration-150',
                                                            isAnchor
                                                                ? 'fill-fg-subtle'
                                                                : pt.v >= 0
                                                                  ? 'fill-data-pos'
                                                                  : 'fill-data-neg'
                                                        )}
                                                    />
                                                );
                                            })}
                                        </>
                                    )}

                                    {/* Active Crosshair & Highlight Node */}
                                    {active !== null && points[active] && (
                                        <g pointerEvents="none">
                                            <line
                                                x1={points[active].x}
                                                x2={points[active].x}
                                                y1={M.top}
                                                y2={M.top + plotH}
                                                className="stroke-fg-subtle/50"
                                                strokeDasharray="3 3"
                                                strokeWidth={1}
                                            />
                                            {mode === 'cumulative' && (
                                                <circle
                                                    cx={points[active].x}
                                                    cy={points[active].y}
                                                    r={5}
                                                    strokeWidth={2}
                                                    className={cn(
                                                        'stroke-surface',
                                                        plotRows[active]?.isAnchor
                                                            ? 'fill-fg-muted'
                                                            : points[active].v >= 0
                                                              ? 'fill-data-pos'
                                                              : 'fill-data-neg'
                                                    )}
                                                />
                                            )}
                                        </g>
                                    )}

                                    {/* Interactive Hit Bands */}
                                    {plotRows.map((r, i) => {
                                        const hw = mode === 'daily' || n === 1 ? band : plotW / Math.max(1, n - 1);
                                        return (
                                            <rect
                                                key={`${r.isoDate}-${i}`}
                                                x={xCenter(i) - hw / 2}
                                                y={M.top}
                                                width={Math.max(hw, 12)}
                                                height={plotH}
                                                fill="transparent"
                                                onMouseEnter={() => setActive(i)}
                                            />
                                        );
                                    })}
                                </svg>
                            )}

                            {activeRow && (
                                <div
                                    className="pointer-events-none absolute top-1 z-10 w-[176px] -translate-x-1/2 rounded-lg border border-line-strong bg-raised/95 backdrop-blur-md px-3 py-2 shadow-panel"
                                    style={{ left: tipLeft }}
                                >
                                    <p className="text-[11px] font-medium capitalize text-fg-subtle">{longDate(activeRow.isoDate, locale)}</p>
                                    {!activeRow.isAnchor && (
                                        <p className="mt-0.5 flex items-center justify-between text-xs">
                                            <span className="text-fg-muted">{isEn ? 'Daily P&L' : 'No dia'}</span>
                                            <span
                                                className={cn(
                                                    'font-semibold tabular-nums',
                                                    activeRow.value > 0 ? 'text-accent-fg' : activeRow.value < 0 ? 'text-danger-fg' : 'text-fg'
                                                )}
                                            >
                                                {formatMoney(activeRow.value)}
                                            </span>
                                        </p>
                                    )}
                                    <p className="flex items-center justify-between text-xs mt-0.5">
                                        <span className="text-fg-muted">{isEn ? 'Cumulative' : 'Acumulado'}</span>
                                        <span className="font-semibold tabular-nums text-fg">{formatMoney(activeRow.cumulative)}</span>
                                    </p>
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}
        </ChartCard>
    );
};
