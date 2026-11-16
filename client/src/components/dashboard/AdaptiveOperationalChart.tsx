import React, { useMemo, useState } from 'react';
import { Hexagon, AlignLeft, PieChart, Sparkles } from 'lucide-react';
import { cn } from '../../lib/cn';
import { ChartCard, ChartEmpty } from '../charts/ChartCard';
import { BreakdownRow } from '../charts/BreakdownBars';

export type OperationalCategoryType = 'symbol' | 'session' | 'weekday';
export type FixedOperationalView = 'polygon' | 'bars' | 'donut';
type ViewMode = 'auto' | FixedOperationalView;
type MetricMode = 'pnl' | 'winRate' | 'trades';
type ResolvedShape = 'empty' | 'spotlight' | 'dual' | 'polygon' | 'bars' | 'donut';

interface AdaptiveOperationalChartProps {
    title: string;
    subtitle?: string;
    icon?: React.ReactNode;
    rows: BreakdownRow[];
    categoryType: OperationalCategoryType;
    /** Locks the card to a dedicated visualization ('donut' | 'bars' | 'polygon') */
    fixedView?: FixedOperationalView;
    locale?: 'pt' | 'en';
    className?: string;
}

const formatCompactCurrency = (val: number) => {
    const abs = Math.abs(val);
    const sign = val > 0.001 ? '+' : val < -0.001 ? '-' : '';
    if (abs === 0) return '$0';
    if (abs >= 100000) return `${sign}$${(abs / 1000).toFixed(0)}K`;
    if (abs >= 1000) {
        const k = abs / 1000;
        return `${sign}$${parseFloat(k.toFixed(k >= 10 ? 1 : 2))}K`;
    }
    if (abs >= 100) return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
    return `${sign}$${parseFloat(abs.toFixed(2))}`;
};

const shortVertexLabel = (rawLabel: string, categoryType: OperationalCategoryType, locale: 'pt' | 'en' = 'pt'): string => {
    const base = rawLabel.split(' · ')[0].trim();
    if (categoryType === 'session') {
        if (/london\s*\+\s*new york|londres\s*\+\s*nova iorque/i.test(base)) return 'Lon + NY';
        if (/asia|ásia|sydney|tokyo|tóquio/i.test(base)) return locale === 'en' ? 'Asia' : 'Ásia';
        if (/new york|nova iorque/i.test(base)) return locale === 'en' ? 'New York' : 'Nova Iorque';
        if (/london|londres/i.test(base)) return locale === 'en' ? 'London' : 'Londres';
        if (/off-session|sem sessão/i.test(base)) return locale === 'en' ? 'Other' : 'Outras';
    }
    if (base.length > 13) return `${base.slice(0, 12)}…`;
    return base;
};

const foldTopRows = (rows: BreakdownRow[], maxItems: number, locale: 'pt' | 'en' = 'pt'): BreakdownRow[] => {
    if (rows.length <= maxItems) return rows;
    const head = rows.slice(0, maxItems - 1);
    const tail = rows.slice(maxItems - 1);
    const totalCount = tail.reduce((acc, r) => acc + r.count, 0);
    const weightedWins = tail.reduce((acc, r) => acc + ((r.winRate ?? 0) / 100) * r.count, 0);
    const totalPnl = Math.round(tail.reduce((acc, r) => acc + r.pnl, 0) * 100) / 100;

    return [
        ...head,
        {
            key: '__folded_others',
            label: locale === 'en' ? `Others (+${tail.length})` : `Outros (+${tail.length})`,
            pnl: totalPnl,
            count: totalCount,
            winRate: totalCount > 0 ? Math.round((weightedWins / totalCount) * 100) : 0,
        },
    ];
};

const CATEGORY_COPY_PT: Record<
    OperationalCategoryType,
    { bestLabel: string; worstLabel: string; singular: string }
> = {
    symbol: { bestLabel: 'Melhor Ativo', worstLabel: 'Pior Ativo', singular: 'ativo' },
    session: { bestLabel: 'Melhor Sessão', worstLabel: 'Pior Sessão', singular: 'sessão' },
    weekday: { bestLabel: 'Melhor Dia', worstLabel: 'Pior Dia', singular: 'dia' },
};

const CATEGORY_COPY_EN: Record<
    OperationalCategoryType,
    { bestLabel: string; worstLabel: string; singular: string }
> = {
    symbol: { bestLabel: 'Top Instrument', worstLabel: 'Weakest Instrument', singular: 'instrument' },
    session: { bestLabel: 'Best Session', worstLabel: 'Weakest Session', singular: 'session' },
    weekday: { bestLabel: 'Best Day', worstLabel: 'Weakest Day', singular: 'day' },
};

const DONUT_RING_CLASSES = [
    'stroke-data-pos',
    'stroke-data-radar',
    'stroke-data-1',
    'stroke-warning',
    'stroke-data-neg',
    'stroke-fg-muted',
];

const DONUT_DOT_CLASSES = [
    'bg-data-pos',
    'bg-data-radar',
    'bg-data-1',
    'bg-warning',
    'bg-data-neg',
    'bg-fg-muted',
];

export const AdaptiveOperationalChart: React.FC<AdaptiveOperationalChartProps> = ({
    title,
    subtitle,
    icon,
    rows,
    categoryType,
    fixedView,
    locale = 'pt',
    className,
}) => {
    const isEn = locale === 'en';
    const [viewMode, setViewMode] = useState<ViewMode>(fixedView ?? 'auto');
    const [metric, setMetric] = useState<MetricMode>('pnl');
    const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
    const [hoveredDonutIdx, setHoveredDonutIdx] = useState<number | null>(null);

    const activeRows = useMemo(
        () => rows.filter(r => r.count > 0 || Math.abs(r.pnl) > 0.0001),
        [rows]
    );

    const rankedActiveByPnl = useMemo(
        () => [...activeRows].sort((a, b) => b.pnl - a.pnl),
        [activeRows]
    );

    const bestRow = rankedActiveByPnl.length > 0 ? rankedActiveByPnl[0] : null;
    const worstRow =
        rankedActiveByPnl.length >= 2 ? rankedActiveByPnl[rankedActiveByPnl.length - 1] : null;

    // Candidate axes for Polygon view:
    // - Symbols: rank by metric and cap at 6 vertices
    // - Structural categories (Weekdays / Sessions): always keep structural axes (5-7 weekdays or 4-5 sessions)
    const polygonItems = useMemo(() => {
        if (categoryType === 'symbol') {
            const base = [...activeRows].sort((a, b) => {
                if (metric === 'trades') return b.count - a.count;
                if (metric === 'winRate') return (b.winRate ?? 0) - (a.winRate ?? 0);
                return Math.abs(b.pnl) - Math.abs(a.pnl);
            });
            return foldTopRows(base, 6, locale);
        }
        return rows.length <= 7 ? rows : foldTopRows(rows, 7, locale);
    }, [categoryType, activeRows, rows, metric, locale]);

    const canRenderPolygon = polygonItems.length >= 3;

    const effectiveMode: ViewMode = fixedView ?? viewMode;

    const resolvedShape: ResolvedShape = useMemo(() => {
        if (activeRows.length === 0) return 'empty';

        if (effectiveMode === 'bars') return 'bars';
        if (effectiveMode === 'donut') return 'donut';
        if (effectiveMode === 'polygon') {
            if (canRenderPolygon) return 'polygon';
            return activeRows.length === 1 ? 'spotlight' : 'dual';
        }

        // AUTO fallback when fixedView is omitted
        const n = activeRows.length;
        if (n === 1) return 'spotlight';
        if (n === 2) return 'dual';
        if (categoryType === 'symbol' && n > 10) return 'bars';
        if (canRenderPolygon) return 'polygon';
        return 'bars';
    }, [activeRows.length, effectiveMode, canRenderPolygon, categoryType]);

    const copy = isEn ? CATEGORY_COPY_EN[categoryType] : CATEGORY_COPY_PT[categoryType];

    const formatMetricValue = (row: BreakdownRow) => {
        if (metric === 'winRate') return `${Math.round(row.winRate ?? 0)}%`;
        if (metric === 'trades') return `${row.count} ${row.count === 1 ? 'tr' : 'trs'}`;
        return formatCompactCurrency(row.pnl);
    };

    // --- 1. SPOTLIGHT RADIAL GAUGE (Fallback when N = 1 in auto mode) ---
    const renderSpotlight = () => {
        const item = activeRows[0];
        if (!item) return null;
        const winPct = Math.max(0, Math.min(100, item.winRate ?? (item.pnl > 0 ? 100 : 0)));
        const radius = 58;
        const circumference = 2 * Math.PI * radius;
        const winDash = (winPct / 100) * circumference;
        const lossDash = Math.max(0, circumference - winDash);

        return (
            <div className="flex flex-1 flex-col items-center justify-center py-2 min-h-[218px]">
                <div className="relative flex items-center justify-center">
                    <svg viewBox="0 0 148 148" className="w-[146px] h-[146px] -rotate-90">
                        <circle
                            cx={74}
                            cy={74}
                            r={radius}
                            fill="none"
                            strokeWidth={11}
                            className="stroke-surface-3"
                        />
                        {lossDash > 0 && (
                            <circle
                                cx={74}
                                cy={74}
                                r={radius}
                                fill="none"
                                strokeWidth={11}
                                strokeDasharray={`${lossDash} ${circumference}`}
                                strokeDashoffset={-winDash}
                                className="stroke-data-neg/75 transition-all duration-500"
                            />
                        )}
                        {winDash > 0 && (
                            <circle
                                cx={74}
                                cy={74}
                                r={radius}
                                fill="none"
                                strokeWidth={11}
                                strokeLinecap="round"
                                strokeDasharray={`${winDash} ${circumference}`}
                                className="stroke-data-pos transition-all duration-500"
                            />
                        )}
                    </svg>

                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-3">
                        <span className="text-[10.5px] font-bold uppercase tracking-wider text-fg-muted truncate max-w-[105px]">
                            {shortVertexLabel(item.label, categoryType, locale)}
                        </span>
                        <span
                            className={cn(
                                'mt-0.5 text-lg font-bold tabular-nums tracking-tight leading-tight',
                                item.pnl > 0.001
                                    ? 'text-accent-fg'
                                    : item.pnl < -0.001
                                      ? 'text-danger-fg'
                                      : 'text-fg'
                            )}
                        >
                            {formatCompactCurrency(item.pnl)}
                        </span>
                        <span className="mt-0.5 text-[10px] font-mono tabular-nums text-fg-subtle">
                            {winPct}% {isEn ? 'win' : 'acerto'} · {item.count} {item.count === 1 ? 'trade' : 'trades'}
                        </span>
                    </div>
                </div>
            </div>
        );
    };

    // --- 2. HEAD-TO-HEAD DUAL COMPARISON (Fallback when N = 2 in auto mode) ---
    const renderDualComparison = () => {
        const [first, second] = rankedActiveByPnl;
        if (!first || !second) return null;
        const totalTrades = Math.max(1, first.count + second.count);
        const firstShare = Math.round((first.count / totalTrades) * 100);
        const secondShare = 100 - firstShare;
        const maxAbsPnl = Math.max(Math.abs(first.pnl), Math.abs(second.pnl), 1);

        return (
            <div className="flex flex-1 flex-col justify-center gap-3.5 py-2 min-h-[218px]">
                <div>
                    <div className="flex items-center justify-between text-[10.5px] font-semibold text-fg-muted mb-1">
                        <span>{shortVertexLabel(first.label, categoryType, locale)} ({firstShare}%)</span>
                        <span>{shortVertexLabel(second.label, categoryType, locale)} ({secondShare}%)</span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-surface-3 overflow-hidden flex gap-0.5">
                        <div
                            className="h-full bg-data-radar rounded-l-full transition-all duration-500"
                            style={{ width: `${Math.max(8, firstShare)}%` }}
                        />
                        <div className="h-full bg-data-1 rounded-r-full transition-all duration-500 flex-1" />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                    {[first, second].map(item => {
                        const barWidth = Math.max(10, Math.round((Math.abs(item.pnl) / maxAbsPnl) * 100));
                        const isPos = item.pnl > 0.001;
                        const isNeg = item.pnl < -0.001;
                        return (
                            <div
                                key={item.key}
                                className="rounded-lg border border-line bg-canvas-subtle/75 p-3 flex flex-col justify-between gap-2"
                            >
                                <div>
                                    <span className="block text-xs font-bold text-fg truncate" title={item.label}>
                                        {shortVertexLabel(item.label, categoryType, locale)}
                                    </span>
                                    <span
                                        className={cn(
                                            'mt-1 block text-base font-bold tabular-nums tracking-tight',
                                            isPos ? 'text-accent-fg' : isNeg ? 'text-danger-fg' : 'text-fg'
                                        )}
                                    >
                                        {formatCompactCurrency(item.pnl)}
                                    </span>
                                </div>

                                <div className="space-y-1">
                                    <div className="h-1.5 w-full rounded-full bg-surface-3 overflow-hidden">
                                        <div
                                            className={cn(
                                                'h-full rounded-full transition-all duration-500',
                                                isPos ? 'bg-data-pos' : isNeg ? 'bg-data-neg' : 'bg-fg-subtle'
                                            )}
                                            style={{ width: `${barWidth}%` }}
                                        />
                                    </div>
                                    <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-fg-subtle">
                                        <span>{item.count} {item.count === 1 ? 'trade' : 'trades'}</span>
                                        <span>{item.winRate ?? 0}% W</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    // --- 3. RADAR POLIGONAL (Dedicated for Operação por Dias) ---
    const renderPolygon = () => {
        const items = polygonItems;
        const n = items.length;
        const cx = 190;
        const cy = 108;
        const radius = 64;
        const stepDeg = 360 / n;

        const polar = (idx: number, r: number) => {
            const angleDeg = -90 + idx * stepDeg;
            const rad = (angleDeg * Math.PI) / 180;
            return {
                angleDeg,
                x: cx + r * Math.cos(rad),
                y: cy + r * Math.sin(rad),
            };
        };

        const ringPoints = (fraction: number) =>
            items
                .map((_, idx) => {
                    const pt = polar(idx, radius * fraction);
                    return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
                })
                .join(' ');

        const hasNegativePnl = metric === 'pnl' && items.some(i => i.pnl < -0.001);
        const maxPnlAbs = Math.max(...items.map(i => Math.abs(i.pnl)), 1);
        const maxPositivePnl = Math.max(...items.map(i => Math.max(0, i.pnl)), 1);
        const maxTrades = Math.max(...items.map(i => i.count), 1);

        const zeroRingFraction = 0.44;

        const getFraction = (item: BreakdownRow): number => {
            if (metric === 'winRate') {
                return item.count > 0 ? Math.max(0.08, Math.min(1, (item.winRate ?? 0) / 100)) : 0.06;
            }
            if (metric === 'trades') {
                return item.count > 0 ? Math.max(0.08, Math.min(1, item.count / maxTrades)) : 0.06;
            }
            if (hasNegativePnl) {
                if (Math.abs(item.pnl) <= 0.001) return zeroRingFraction;
                if (item.pnl > 0) {
                    return zeroRingFraction + (1 - zeroRingFraction) * (item.pnl / maxPnlAbs);
                }
                return Math.max(0.12, zeroRingFraction - 0.32 * (Math.abs(item.pnl) / maxPnlAbs));
            }
            if (item.pnl <= 0.001) return 0.08;
            return Math.max(0.12, Math.min(1, item.pnl / maxPositivePnl));
        };

        const vertices = items.map((item, idx) => polar(idx, radius * getFraction(item)));
        const dataPolygonStr = vertices.map(v => `${v.x.toFixed(1)},${v.y.toFixed(1)}`).join(' ');
        const hoveredItem = hoveredIdx !== null ? items[hoveredIdx] : null;

        return (
            <div className="relative flex flex-1 flex-col items-center justify-center min-h-[218px]">
                <svg
                    viewBox="0 0 380 216"
                    className="w-full max-w-[368px] h-[206px] select-none overflow-visible"
                    role="img"
                    aria-label={`${title}: radar de ${n} eixos`}
                >
                    {[1, 0.75, 0.5, 0.25].map((r, ringIdx) => (
                        <polygon
                            key={r}
                            points={ringPoints(r)}
                            className={cn(
                                ringIdx === 0
                                    ? 'fill-canvas-subtle/75 stroke-line-strong'
                                    : 'fill-none stroke-line'
                            )}
                            strokeWidth={1}
                        />
                    ))}

                    {hasNegativePnl && (
                        <polygon
                            points={ringPoints(zeroRingFraction)}
                            className="fill-none stroke-fg-subtle/50"
                            strokeWidth={1}
                            strokeDasharray="3 3"
                        />
                    )}

                    {items.map((item, idx) => {
                        const outer = polar(idx, radius);
                        return (
                            <line
                                key={item.key}
                                x1={cx}
                                y1={cy}
                                x2={outer.x}
                                y2={outer.y}
                                className="stroke-line"
                                strokeWidth={1}
                            />
                        );
                    })}

                    <polygon
                        points={dataPolygonStr}
                        className="fill-data-radar/30 stroke-data-radar transition-all duration-500"
                        strokeWidth={2}
                        strokeLinejoin="round"
                    />

                    {items.map((item, idx) => {
                        const v = vertices[idx];
                        const labelPos = polar(idx, radius + 13);
                        const cos = Math.cos((labelPos.angleDeg * Math.PI) / 180);
                        const sin = Math.sin((labelPos.angleDeg * Math.PI) / 180);
                        const textAnchor =
                            Math.abs(cos) < 0.22 ? 'middle' : cos > 0 ? 'start' : 'end';
                        const baseY =
                            sin < -0.7 ? labelPos.y - 8 : sin > 0.7 ? labelPos.y + 3 : labelPos.y - 3;

                        const isHovered = hoveredIdx === idx;
                        const isPos = item.pnl > 0.001;
                        const isNeg = item.pnl < -0.001;

                        const dotFill =
                            metric === 'pnl'
                                ? isPos
                                    ? 'fill-data-pos'
                                    : isNeg
                                      ? 'fill-data-neg'
                                      : 'fill-fg-subtle'
                                : 'fill-data-radar';

                        const subTone =
                            metric === 'pnl'
                                ? isPos
                                    ? 'fill-accent-fg'
                                    : isNeg
                                      ? 'fill-danger-fg'
                                      : 'fill-fg-subtle'
                                : 'fill-fg-subtle';

                        return (
                            <g
                                key={item.key}
                                className="cursor-pointer"
                                onMouseEnter={() => setHoveredIdx(idx)}
                                onMouseLeave={() => setHoveredIdx(null)}
                            >
                                <circle cx={v.x} cy={v.y} r={14} fill="transparent" />
                                <circle
                                    cx={v.x}
                                    cy={v.y}
                                    r={isHovered ? 4.6 : 3.1}
                                    strokeWidth={2}
                                    className={cn('stroke-surface transition-all duration-150', dotFill)}
                                />

                                <text
                                    x={labelPos.x}
                                    y={baseY}
                                    textAnchor={textAnchor}
                                    className={cn(
                                        'text-[10px] font-semibold uppercase tracking-tight transition-colors',
                                        isHovered ? 'fill-fg' : 'fill-fg-muted'
                                    )}
                                >
                                    {shortVertexLabel(item.label, categoryType, locale)}
                                </text>
                                <text
                                    x={labelPos.x}
                                    y={baseY + 11.5}
                                    textAnchor={textAnchor}
                                    className={cn(
                                        'text-[9.5px] font-mono font-bold tabular-nums transition-colors',
                                        subTone
                                    )}
                                >
                                    {item.count === 0 && metric === 'pnl' ? '$0' : formatMetricValue(item)}
                                </text>
                            </g>
                        );
                    })}
                </svg>

                {hoveredItem && (
                    <div className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 rounded-full border border-line-strong bg-raised/95 px-3 py-1 text-[10.5px] font-medium text-fg shadow-md whitespace-nowrap z-20">
                        <span className="font-bold">{hoveredItem.label.split(' · ')[0]}</span>
                        {' · '}
                        <span
                            className={
                                hoveredItem.pnl > 0.001
                                    ? 'text-accent-fg font-semibold'
                                    : hoveredItem.pnl < -0.001
                                      ? 'text-danger-fg font-semibold'
                                      : 'text-fg-muted'
                            }
                        >
                            {formatCompactCurrency(hoveredItem.pnl)}
                        </span>
                        {' · '}
                        <span className="text-fg-muted tabular-nums">
                            {hoveredItem.count} {hoveredItem.count === 1 ? 'trade' : 'trades'}
                            {hoveredItem.winRate !== undefined ? ` (${hoveredItem.winRate}% W)` : ''}
                        </span>
                    </div>
                )}
            </div>
        );
    };

    // --- 4. DIVERGING HORIZONTAL BARS (Dedicated for Desempenho por Sessões) ---
    const renderBars = () => {
        const list =
            categoryType === 'symbol'
                ? [...activeRows].sort((a, b) => {
                      if (metric === 'trades') return b.count - a.count;
                      if (metric === 'winRate') return (b.winRate ?? 0) - (a.winRate ?? 0);
                      return b.pnl - a.pnl;
                  })
                : rows;

        const maxAbsPnl = Math.max(...list.map(r => Math.abs(r.pnl)), 1);
        const maxTrades = Math.max(...list.map(r => r.count), 1);
        // True centered diverging axis (50% = $0) for P&L so losses always diverge left and profits diverge right
        const isDivergingPnl = metric === 'pnl';
        const zeroPct = isDivergingPnl ? 50 : 0;
        const spanPct = isDivergingPnl ? 50 : 100;

        return (
            <div className="flex flex-1 flex-col justify-center min-h-[218px] max-h-[234px] overflow-y-auto pr-0.5 space-y-2 py-1">
                {list.map(r => {
                    const empty = r.count === 0;
                    const isPos = r.pnl >= 0;
                    const [mainName, subWindow] = r.label.split(' · ');

                    let barPct = 0;
                    if (!empty) {
                        if (metric === 'winRate') barPct = Math.max(4, r.winRate ?? 0);
                        else if (metric === 'trades') barPct = Math.max(4, (r.count / maxTrades) * 100);
                        else barPct = Math.max(2.5, (Math.abs(r.pnl) / maxAbsPnl) * spanPct);
                    }

                    return (
                        <div
                            key={r.key}
                            className="rounded-lg px-2 py-1.5 hover:bg-surface-2/65 transition-colors"
                        >
                            <div className="flex items-baseline justify-between gap-2 text-xs">
                                <div className="flex items-baseline gap-1.5 min-w-0 truncate">
                                    <span
                                        className={cn(
                                            'font-semibold truncate',
                                            empty ? 'text-fg-subtle' : 'text-fg'
                                        )}
                                    >
                                        {shortVertexLabel(mainName, categoryType, locale)}
                                    </span>
                                    {subWindow && (
                                        <span className="text-[10px] font-mono text-fg-subtle hidden sm:inline truncate">
                                            {subWindow.replace(' UTC', '')}
                                        </span>
                                    )}
                                </div>
                                <span
                                    className={cn(
                                        'font-mono font-bold tabular-nums shrink-0',
                                        empty
                                            ? 'text-fg-subtle'
                                            : metric === 'pnl'
                                              ? r.pnl > 0.001
                                                  ? 'text-accent-fg'
                                                  : r.pnl < -0.001
                                                    ? 'text-danger-fg'
                                                    : 'text-fg-muted'
                                              : 'text-fg'
                                    )}
                                >
                                    {empty ? '$0' : formatMetricValue(r)}
                                </span>
                            </div>

                            {/* Diverging Bar Track with Centered $0 Axis */}
                            <div className="relative mt-1.5 h-2 w-full rounded-full bg-surface-3 overflow-hidden">
                                {isDivergingPnl && (
                                    <span
                                        className="absolute inset-y-0 w-px bg-line-strong z-10"
                                        style={{ left: `${zeroPct}%` }}
                                    />
                                )}
                                {!empty && Math.abs(r.pnl) > 0.0001 && isDivergingPnl && (
                                    <span
                                        className={cn(
                                            'absolute inset-y-0 transition-all duration-500',
                                            isPos
                                                ? 'rounded-r-full bg-data-pos'
                                                : 'rounded-l-full bg-data-neg'
                                        )}
                                        style={
                                            isPos
                                                ? { left: `${zeroPct}%`, width: `${barPct}%` }
                                                : { right: `${100 - zeroPct}%`, width: `${barPct}%` }
                                        }
                                    />
                                )}
                                {!empty && !isDivergingPnl && (
                                    <span
                                        className="absolute inset-y-0 left-0 rounded-full bg-data-radar transition-all duration-500"
                                        style={{ width: `${barPct}%` }}
                                    />
                                )}
                            </div>

                            <div className="mt-1 flex items-center justify-between text-[10px] font-mono tabular-nums text-fg-subtle">
                                <span>{empty ? (isEn ? 'No trades' : 'Sem operações') : `${r.count} ${r.count === 1 ? 'trade' : 'trades'}`}</span>
                                {!empty && r.winRate !== undefined && <span>{r.winRate}% {isEn ? 'win' : 'acerto'}</span>}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    // --- 5. PROPORTIONAL DONUT DISTRIBUTION (Dedicated for Desempenho por Ativos) ---
    const renderDonut = () => {
        const sorted = [...activeRows].sort((a, b) => {
            if (metric === 'trades') return b.count - a.count;
            if (metric === 'winRate') return (b.winRate ?? 0) - (a.winRate ?? 0);
            return Math.abs(b.pnl) - Math.abs(a.pnl);
        });
        const slices = foldTopRows(sorted, 6, locale);
        const weights = slices.map(s => {
            if (metric === 'trades') return Math.max(1, s.count);
            if (metric === 'winRate') return Math.max(1, s.winRate ?? 0);
            return Math.max(0.01, Math.abs(s.pnl));
        });
        const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
        const totalTradesAll = activeRows.reduce((a, r) => a + r.count, 0);
        const netTotalPnl = activeRows.reduce((a, r) => a + r.pnl, 0);

        const radius = 53;
        const circumference = 2 * Math.PI * radius;
        const sliceGap = slices.length > 1 ? 2.5 : 0;
        let cumulativeOffset = 0;

        const focusedSlice = hoveredDonutIdx !== null ? slices[hoveredDonutIdx] : null;
        const focusedShare =
            hoveredDonutIdx !== null
                ? Math.round((weights[hoveredDonutIdx] / totalWeight) * 100)
                : null;

        return (
            <div className="flex flex-1 items-center justify-between gap-3.5 py-2 min-h-[218px]">
                {/* Interactive Donut SVG */}
                <div className="relative shrink-0 flex items-center justify-center">
                    <svg viewBox="0 0 140 140" className="w-[138px] h-[138px] -rotate-90">
                        <circle
                            cx={70}
                            cy={70}
                            r={radius}
                            fill="none"
                            strokeWidth={14}
                            className="stroke-surface-3"
                        />
                        {slices.map((slice, i) => {
                            const frac = weights[i] / totalWeight;
                            const rawArc = frac * circumference;
                            const dash = Math.max(1.5, rawArc - sliceGap);
                            const offset = cumulativeOffset;
                            cumulativeOffset += rawArc;
                            const isHovered = hoveredDonutIdx === i;
                            const isDimmed = hoveredDonutIdx !== null && !isHovered;

                            return (
                                <circle
                                    key={slice.key}
                                    cx={70}
                                    cy={70}
                                    r={radius}
                                    fill="none"
                                    strokeWidth={isHovered ? 16.5 : 14}
                                    strokeDasharray={`${dash} ${circumference}`}
                                    strokeDashoffset={-offset}
                                    onMouseEnter={() => setHoveredDonutIdx(i)}
                                    onMouseLeave={() => setHoveredDonutIdx(null)}
                                    className={cn(
                                        'transition-all duration-200 cursor-pointer',
                                        DONUT_RING_CLASSES[i % DONUT_RING_CLASSES.length],
                                        isDimmed && 'opacity-35'
                                    )}
                                />
                            );
                        })}
                    </svg>

                    {/* Center Dynamic Readout */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-3">
                        {focusedSlice ? (
                            <>
                                <span className="text-[9.5px] font-bold uppercase tracking-wider text-fg-muted truncate max-w-[84px]">
                                    {shortVertexLabel(focusedSlice.label, categoryType, locale)}
                                </span>
                                <span
                                    className={cn(
                                        'mt-0.5 text-sm font-bold tabular-nums leading-tight',
                                        focusedSlice.pnl > 0.001
                                            ? 'text-accent-fg'
                                            : focusedSlice.pnl < -0.001
                                              ? 'text-danger-fg'
                                              : 'text-fg'
                                    )}
                                >
                                    {formatMetricValue(focusedSlice)}
                                </span>
                                <span className="text-[9.5px] font-mono tabular-nums text-fg-subtle">
                                    {focusedShare}% · {focusedSlice.count} tr
                                </span>
                            </>
                        ) : (
                            <>
                                <span className="text-[9.5px] font-bold uppercase tracking-wider text-fg-subtle">
                                    {metric === 'trades' ? 'Volume' : isEn ? 'Net P&L' : 'Resultado'}
                                </span>
                                <span
                                    className={cn(
                                        'mt-0.5 text-sm font-bold tabular-nums leading-tight',
                                        metric === 'trades'
                                            ? 'text-fg'
                                            : netTotalPnl > 0.001
                                              ? 'text-accent-fg'
                                              : netTotalPnl < -0.001
                                                ? 'text-danger-fg'
                                                : 'text-fg'
                                    )}
                                >
                                    {metric === 'trades'
                                        ? `${totalTradesAll}`
                                        : formatCompactCurrency(netTotalPnl)}
                                </span>
                                <span className="text-[9.5px] font-mono tabular-nums text-fg-muted">
                                    {totalTradesAll} {totalTradesAll === 1 ? 'trade' : 'trades'}
                                </span>
                            </>
                        )}
                    </div>
                </div>

                {/* Interactive Asset Legend */}
                <div className="flex-1 min-w-0 space-y-1.5">
                    {slices.map((slice, i) => {
                        const pct = Math.round((weights[i] / totalWeight) * 100);
                        const isHovered = hoveredDonutIdx === i;
                        return (
                            <div
                                key={slice.key}
                                onMouseEnter={() => setHoveredDonutIdx(i)}
                                onMouseLeave={() => setHoveredDonutIdx(null)}
                                className={cn(
                                    'flex items-center justify-between gap-2 text-xs px-1.5 py-1 rounded-md transition-colors cursor-pointer',
                                    isHovered ? 'bg-surface-2' : 'hover:bg-surface-2/60'
                                )}
                            >
                                <div className="flex items-center gap-1.5 min-w-0">
                                    <span
                                        className={cn(
                                            'w-2.5 h-2.5 rounded-full shrink-0',
                                            DONUT_DOT_CLASSES[i % DONUT_DOT_CLASSES.length]
                                        )}
                                    />
                                    <span
                                        className={cn(
                                            'truncate font-semibold transition-colors',
                                            isHovered ? 'text-fg' : 'text-fg-muted'
                                        )}
                                        title={slice.label}
                                    >
                                        {shortVertexLabel(slice.label, categoryType, locale)}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0 font-mono text-[11px] tabular-nums">
                                    <span
                                        className={
                                            metric === 'pnl'
                                                ? slice.pnl > 0.001
                                                    ? 'text-accent-fg font-bold'
                                                    : slice.pnl < -0.001
                                                      ? 'text-danger-fg font-bold'
                                                      : 'text-fg-muted'
                                                : 'text-fg font-semibold'
                                        }
                                    >
                                        {formatMetricValue(slice)}
                                    </span>
                                    <span className="text-fg-subtle text-[10px]">({pct}%)</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    return (
        <ChartCard
            className={cn('h-full justify-between hover:border-line-strong transition-colors', className)}
            title={title}
            icon={icon}
            subtitle={subtitle}
            actions={
                <div className="flex items-center gap-1">
                    {/* Metric Toggle: P&L | W% | Vol */}
                    <div
                        role="radiogroup"
                        aria-label={locale === 'en' ? 'Operational metric' : 'Métrica operacional'}
                        className="flex items-center rounded-lg border border-line bg-canvas p-0.5"
                    >
                        {(
                            [
                                { id: 'pnl', label: 'P&L' },
                                { id: 'winRate', label: 'W%' },
                                { id: 'trades', label: 'Vol' },
                            ] as { id: MetricMode; label: string }[]
                        ).map(m => (
                            <button
                                key={m.id}
                                type="button"
                                onClick={() => setMetric(m.id)}
                                className={cn(
                                    'px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors cursor-pointer',
                                    metric === m.id
                                        ? 'bg-surface-2 text-fg shadow-xs'
                                        : 'text-fg-subtle hover:text-fg'
                                )}
                            >
                                {m.label}
                            </button>
                        ))}
                    </div>

                    {/* Visual Shape Switcher is only shown when fixedView is not locked */}
                    {!fixedView && (
                        <div
                            role="radiogroup"
                            aria-label={locale === 'en' ? 'Chart shape' : 'Forma do gráfico'}
                            className="flex items-center rounded-lg border border-line bg-canvas p-0.5"
                        >
                            <button
                                type="button"
                                onClick={() => setViewMode('auto')}
                                title={locale === 'en' ? 'Smart Adaptive View' : 'Modo Adaptativo Inteligente'}
                                className={cn(
                                    'p-1 rounded transition-colors cursor-pointer',
                                    viewMode === 'auto'
                                        ? 'bg-surface-2 text-accent-fg shadow-xs'
                                        : 'text-fg-subtle hover:text-fg'
                                )}
                            >
                                <Sparkles size={12} />
                            </button>
                            <button
                                type="button"
                                disabled={!canRenderPolygon}
                                onClick={() => setViewMode('polygon')}
                                title={locale === 'en' ? 'Radar Polygon' : 'Radar Poligonal'}
                                className={cn(
                                    'p-1 rounded transition-colors',
                                    !canRenderPolygon
                                        ? 'opacity-30 cursor-not-allowed text-fg-subtle'
                                        : viewMode === 'polygon'
                                          ? 'bg-surface-2 text-fg shadow-xs cursor-pointer'
                                          : 'text-fg-subtle hover:text-fg cursor-pointer'
                                )}
                            >
                                <Hexagon size={12} />
                            </button>
                            <button
                                type="button"
                                onClick={() => setViewMode('bars')}
                                title={locale === 'en' ? 'Diverging Bars' : 'Barras Divergentes'}
                                className={cn(
                                    'p-1 rounded transition-colors cursor-pointer',
                                    viewMode === 'bars'
                                        ? 'bg-surface-2 text-fg shadow-xs'
                                        : 'text-fg-subtle hover:text-fg'
                                )}
                            >
                                <AlignLeft size={12} />
                            </button>
                            <button
                                type="button"
                                onClick={() => setViewMode('donut')}
                                title={locale === 'en' ? 'Donut Distribution' : 'Distribuição em Rosca'}
                                className={cn(
                                    'p-1 rounded transition-colors cursor-pointer',
                                    viewMode === 'donut'
                                        ? 'bg-surface-2 text-fg shadow-xs'
                                        : 'text-fg-subtle hover:text-fg'
                                )}
                            >
                                <PieChart size={12} />
                            </button>
                        </div>
                    )}
                </div>
            }
        >
            <div className="flex flex-1 flex-col justify-between gap-3">
                {resolvedShape === 'empty' && (
                    <ChartEmpty
                        message={isEn ? 'No trades in this period' : 'Sem operações no período'}
                        hint={isEn ? 'Adjust filters or date range to inspect performance.' : 'Ajuste os filtros ou datas para visualizar.'}
                        className="min-h-[218px]"
                    />
                )}
                {resolvedShape === 'spotlight' && renderSpotlight()}
                {resolvedShape === 'dual' && renderDualComparison()}
                {resolvedShape === 'polygon' && renderPolygon()}
                {resolvedShape === 'bars' && renderBars()}
                {resolvedShape === 'donut' && renderDonut()}

                {/* Comparative Footer: MELHOR vs PIOR */}
                <div className="pt-3 border-t border-line grid grid-cols-2 gap-3">
                    <div className="min-w-0">
                        <span className="block text-[10px] font-bold uppercase tracking-wider text-fg-subtle leading-none">
                            {copy.bestLabel}
                        </span>
                        {bestRow ? (
                            <>
                                <div className="mt-1.5 flex items-baseline gap-1.5 min-w-0">
                                    <span
                                        className="text-xs font-bold text-fg truncate"
                                        title={bestRow.label}
                                    >
                                        {shortVertexLabel(bestRow.label, categoryType, locale)}
                                    </span>
                                    <span
                                        className={cn(
                                            'text-xs font-mono font-bold tabular-nums shrink-0',
                                            bestRow.pnl > 0.001
                                                ? 'text-accent-fg'
                                                : bestRow.pnl < -0.001
                                                  ? 'text-danger-fg'
                                                  : 'text-fg-muted'
                                        )}
                                    >
                                        {formatCompactCurrency(bestRow.pnl)}
                                    </span>
                                </div>
                                <span className="mt-0.5 block text-[10.5px] font-mono tabular-nums text-fg-muted">
                                    {bestRow.count} {bestRow.count === 1 ? 'trade' : 'trades'}
                                    {bestRow.winRate !== undefined ? ` · ${bestRow.winRate}% W` : ''}
                                </span>
                            </>
                        ) : (
                            <span className="mt-1.5 block text-xs text-fg-subtle">—</span>
                        )}
                    </div>

                    <div className="min-w-0 border-l border-line pl-3">
                        <span className="block text-[10px] font-bold uppercase tracking-wider text-fg-subtle leading-none">
                            {copy.worstLabel}
                        </span>
                        {worstRow ? (
                            <>
                                <div className="mt-1.5 flex items-baseline gap-1.5 min-w-0">
                                    <span
                                        className="text-xs font-bold text-fg truncate"
                                        title={worstRow.label}
                                    >
                                        {shortVertexLabel(worstRow.label, categoryType, locale)}
                                    </span>
                                    <span
                                        className={cn(
                                            'text-xs font-mono font-bold tabular-nums shrink-0',
                                            worstRow.pnl < -0.001
                                                ? 'text-danger-fg'
                                                : worstRow.pnl > 0.001
                                                  ? 'text-accent-fg'
                                                  : 'text-fg-muted'
                                        )}
                                    >
                                        {formatCompactCurrency(worstRow.pnl)}
                                    </span>
                                </div>
                                <span className="mt-0.5 block text-[10.5px] font-mono tabular-nums text-fg-muted">
                                    {worstRow.count} {worstRow.count === 1 ? 'trade' : 'trades'}
                                    {worstRow.winRate !== undefined ? ` · ${worstRow.winRate}% W` : ''}
                                </span>
                            </>
                        ) : (
                            <span className="mt-1.5 block text-[11px] text-fg-subtle">
                                {bestRow ? (isEn ? `Only 1 ${copy.singular}` : `Apenas 1 ${copy.singular}`) : '—'}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </ChartCard>
    );
};
