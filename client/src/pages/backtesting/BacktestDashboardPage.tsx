import React, { useId, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BookOpen, ChevronLeft, ChevronRight, HelpCircle, Play, Plus } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Segmented } from '../../components/charts/ChartCard';
import { fmtDuration, fmtMoney, fmtNum, pnlTone } from '../../components/backtesting/primitives';
import {
    aggregateStats,
    BreakdownDimension,
    byEntryHour,
    closedOrders,
    computeBehavior,
    computeBreakdown,
    dailyPoints,
    equitySeries,
    progressSeries,
    rDistribution,
    underwaterSeries,
} from '../../components/backtesting/metrics';
import { useElementWidth, niceDomain } from '../../components/charts/chartUtils';
import { useBacktestWorkspace } from './BacktestWorkspaceContext';
import type { ReplayOrder } from '../../components/kline-replay/types';
import { cn } from '../../lib/cn';
import { useLocale } from '../../context/LocaleContext';

type Period = 'ALL' | '7D' | '30D' | '90D';
const PERIOD_DAYS: Record<Exclude<Period, 'ALL'>, number> = { '7D': 7, '30D': 30, '90D': 90 };

const MONTH_NAMES = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];
const MONTH_NAMES_EN = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];
const DOW_SHORT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const DOW_SHORT_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* --------------------------------------------------------- Card Primitives */

const MetricHint = ({ text }: { text: string }) => (
    <span title={text} className="inline-flex text-fg-subtle/70 hover:text-fg-muted cursor-help">
        <HelpCircle size={12} aria-hidden />
    </span>
);

const DashCard = ({
    title,
    hint,
    subtitle,
    right,
    children,
    className,
}: {
    title: React.ReactNode;
    hint?: string;
    subtitle?: React.ReactNode;
    right?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
}) => (
    <section className={cn('rounded-2xl border border-line bg-surface p-4 sm:p-5 flex flex-col justify-between min-w-0', className)}>
        <header className="flex items-start justify-between gap-2">
            <div className="min-w-0">
                <h3 className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                    <span>{title}</span>
                    {hint && <MetricHint text={hint} />}
                </h3>
                {subtitle && <p className="mt-1 text-[11px] text-fg-subtle leading-relaxed">{subtitle}</p>}
            </div>
            {right && <div className="shrink-0">{right}</div>}
        </header>
        <div className="mt-3 flex-1 flex flex-col justify-end">{children}</div>
    </section>
);

/* -------------------------------------------------------------- Donut Ring */

const WinRateDonut = ({ wins, losses }: { wins: number; losses: number }) => {
    const total = wins + losses;
    const size = 60;
    const stroke = 7;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const winLen = total > 0 ? (wins / total) * c : 0;
    const lossLen = total > 0 ? (losses / total) * c : 0;

    return (
        <div className="relative flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="-rotate-90" aria-hidden>
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-surface-3" />
                {total > 0 && wins > 0 && (
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={r}
                        fill="none"
                        strokeWidth={stroke}
                        strokeDasharray={`${winLen} ${c}`}
                        strokeLinecap="round"
                        className="stroke-emerald-500"
                    />
                )}
                {total > 0 && losses > 0 && (
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={r}
                        fill="none"
                        strokeWidth={stroke}
                        strokeDasharray={`${lossLen} ${c}`}
                        strokeDashoffset={-winLen}
                        className="stroke-rose-500"
                    />
                )}
            </svg>
            <span className="absolute text-[10px] font-semibold tabular-nums text-fg-subtle">
                {total > 0 ? `${Math.round((wins / total) * 100)}%` : '—'}
            </span>
        </div>
    );
};

/* ------------------------------------------------------------ Equity Curve */

const EquityCurveCard = ({
    orders,
    initialCapital,
    currency,
    isEn,
}: {
    orders: ReplayOrder[];
    initialCapital: number;
    currency: string;
    isEn: boolean;
}) => {
    const [mode, setMode] = useState<'trades' | 'days'>('trades');
    const [hoverIdx, setHoverIdx] = useState<number | null>(null);
    const [wrapRef, width] = useElementWidth<HTMLDivElement>();
    const gradId = useId().replace(/:/g, '');

    const pts = useMemo(() => equitySeries(orders, initialCapital, mode), [orders, initialCapital, mode]);
    const H = 220;
    const M = { top: 16, right: 16, bottom: 26, left: 64 };
    const plotW = Math.max(0, width - M.left - M.right);
    const plotH = H - M.top - M.bottom;

    const domain = useMemo(() => {
        if (pts.length < 2) {
            const step = Math.max(500, Math.round(initialCapital * 0.02));
            return {
                min: initialCapital - step,
                max: initialCapital + step,
                ticks: [initialCapital - step, initialCapital, initialCapital + step],
            };
        }
        const vals = pts.map((p) => p.balance);
        return niceDomain(Math.min(...vals, initialCapital), Math.max(...vals, initialCapital), 4);
    }, [pts, initialCapital]);

    const y = (v: number) => M.top + plotH - ((v - domain.min) / (domain.max - domain.min || 1)) * plotH;
    const x = (i: number) => (pts.length <= 1 ? M.left : M.left + (i / (pts.length - 1)) * plotW);

    const pathD = useMemo(() => {
        if (pts.length < 2 || plotW <= 0) return '';
        return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(' ');
    }, [pts, plotW, domain]); // eslint-disable-line react-hooks/exhaustive-deps

    const areaD = useMemo(() => {
        if (!pathD || pts.length < 2) return '';
        const base = y(domain.min);
        return `${pathD} L${x(pts.length - 1).toFixed(1)},${base.toFixed(1)} L${x(0).toFixed(1)},${base.toFixed(1)} Z`;
    }, [pathD, pts, domain]); // eslint-disable-line react-hooks/exhaustive-deps

    const endPositive = pts.length < 2 || pts[pts.length - 1].balance >= initialCapital;
    const activePt = hoverIdx !== null ? pts[hoverIdx] : null;

    return (
        <DashCard
            title={isEn ? 'Equity Curve' : 'Curva de capital'}
            hint={
                isEn
                    ? 'Account balance progression trade-by-trade or day-by-day.'
                    : 'Evolução do saldo da estratégia operação a operação ou dia a dia.'
            }
            right={
                <Segmented
                    label={isEn ? 'Curve axis' : 'Eixo da curva'}
                    value={mode}
                    onChange={(m) => {
                        setMode(m);
                        setHoverIdx(null);
                    }}
                    options={[
                        { value: 'trades', label: 'Trades' },
                        { value: 'days', label: isEn ? 'Days' : 'Dias' },
                    ]}
                />
            }
        >
            <div ref={wrapRef} className="relative w-full" style={{ height: H }} onMouseLeave={() => setHoverIdx(null)}>
                {width > 0 && (
                    <svg width={width} height={H} className="block overflow-visible" aria-hidden>
                        <defs>
                            <linearGradient id={`${gradId}-eq`} x1="0" y1="0" x2="0" y2="1">
                                <stop
                                    offset="0%"
                                    stopColor={endPositive ? 'rgb(var(--ds-data-pos))' : 'rgb(var(--ds-data-neg))'}
                                    stopOpacity="0.22"
                                />
                                <stop
                                    offset="100%"
                                    stopColor={endPositive ? 'rgb(var(--ds-data-pos))' : 'rgb(var(--ds-data-neg))'}
                                    stopOpacity="0.0"
                                />
                            </linearGradient>
                        </defs>

                        {domain.ticks.map((t) => (
                            <g key={t}>
                                <line
                                    x1={M.left}
                                    x2={M.left + plotW}
                                    y1={y(t)}
                                    y2={y(t)}
                                    className="stroke-line"
                                    strokeDasharray={t === initialCapital ? undefined : '3 3'}
                                    strokeWidth={1}
                                />
                                <text
                                    x={M.left - 8}
                                    y={y(t)}
                                    dy="0.32em"
                                    textAnchor="end"
                                    className="fill-fg-subtle text-[10px] tabular-nums"
                                >
                                    {fmtMoney(t, { decimals: 0, currency })}
                                </text>
                            </g>
                        ))}

                        {pts.length >= 2 && (
                            <>
                                <path d={areaD} fill={`url(#${gradId}-eq)`} />
                                <path
                                    d={pathD}
                                    fill="none"
                                    strokeWidth={2.25}
                                    strokeLinejoin="round"
                                    strokeLinecap="round"
                                    className={endPositive ? 'stroke-data-pos' : 'stroke-data-neg'}
                                />
                                {pts.map((p, i) => {
                                    const showLbl =
                                        i === 0 ||
                                        i === pts.length - 1 ||
                                        (pts.length > 4 && i === Math.floor(pts.length / 2));
                                    return (
                                        <g key={i}>
                                            {showLbl && (
                                                <text
                                                    x={x(i)}
                                                    y={H - 6}
                                                    textAnchor={i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}
                                                    className="fill-fg-subtle text-[10px] tabular-nums"
                                                >
                                                    {p.label}
                                                </text>
                                            )}
                                            <rect
                                                x={x(i) - Math.max(8, plotW / Math.max(1, pts.length) / 2)}
                                                y={M.top}
                                                width={Math.max(16, plotW / Math.max(1, pts.length))}
                                                height={plotH}
                                                fill="transparent"
                                                onMouseEnter={() => setHoverIdx(i)}
                                            />
                                        </g>
                                    );
                                })}
                                {hoverIdx !== null && pts[hoverIdx] && (
                                    <circle
                                        cx={x(hoverIdx)}
                                        cy={y(pts[hoverIdx].balance)}
                                        r={4.5}
                                        strokeWidth={2}
                                        className={cn(
                                            'stroke-surface',
                                            endPositive ? 'fill-data-pos' : 'fill-data-neg'
                                        )}
                                    />
                                )}
                            </>
                        )}
                    </svg>
                )}

                {pts.length < 2 && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <span className="rounded-lg bg-surface/90 px-3 py-1.5 text-xs text-fg-subtle">
                            {isEn ? 'Close trades in replay to plot the equity curve.' : 'Feche operações no replay para traçar a curva de capital.'}
                        </span>
                    </div>
                )}

                {activePt && hoverIdx !== null && (
                    <div
                        className="pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded-lg border border-line bg-raised/95 px-3 py-1.5 shadow-lg backdrop-blur-sm"
                        style={{ left: Math.min(Math.max(x(hoverIdx), 80), width - 80) }}
                    >
                        <p className="text-[10px] text-fg-subtle">
                            {activePt.label} {activePt.sublabel ? `· ${activePt.sublabel}` : ''}
                        </p>
                        <p className="text-xs font-bold tabular-nums text-fg">
                            {fmtMoney(activePt.balance, { currency })}
                        </p>
                    </div>
                )}
            </div>
        </DashCard>
    );
};

/* ------------------------------------------------------- Behavior Pentagon */

const BehaviorCard = ({ orders, isEn }: { orders: ReplayOrder[]; isEn: boolean }) => {
    const b = useMemo(() => computeBehavior(orders), [orders]);
    const size = 196;
    const cx = size / 2;
    const cy = size / 2 + 6;
    const R = 64;

    const ptAt = (idx: number, pct: number) => {
        const angle = -Math.PI / 2 + (idx * 2 * Math.PI) / 5;
        const r = (pct / 100) * R;
        return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    };

    const ringPolygon = (pct: number) =>
        [0, 1, 2, 3, 4]
            .map((i) => {
                const p = ptAt(i, pct);
                return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
            })
            .join(' ');

    const dataPolygon = b.axes
        .map((a, i) => {
            const p = ptAt(i, b.ready ? Math.max(8, a.value) : 25);
            return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
        })
        .join(' ');

    return (
        <DashCard
            title={isEn ? 'Behavior' : 'Comportamento'}
            hint={
                isEn
                    ? 'Evaluates stop discipline, playbook adherence, risk stability, consistency, and expectancy.'
                    : 'Avalia disciplina de stop, execução do plano, estabilidade de risco, consistência e resultados.'
            }
            right={
                <span className="text-xs tabular-nums text-fg-muted">
                    <strong className="font-bold text-fg">{b.overall ?? '—'}</strong> {isEn ? 'of 100' : 'de 100'}
                </span>
            }
        >
            <div className="flex flex-col items-center justify-between gap-2">
                <svg width={size} height={size} className="overflow-visible" aria-hidden>
                    {[100, 66, 33].map((lvl) => (
                        <polygon
                            key={lvl}
                            points={ringPolygon(lvl)}
                            fill={lvl === 100 ? 'rgb(var(--ds-surface-2) / 0.5)' : 'none'}
                            className="stroke-line"
                            strokeWidth={1}
                        />
                    ))}
                    {[0, 1, 2, 3, 4].map((i) => {
                        const p = ptAt(i, 100);
                        return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} className="stroke-line" strokeWidth={1} />;
                    })}
                    <polygon
                        points={dataPolygon}
                        className={cn(
                            b.ready
                                ? 'fill-emerald-500/20 stroke-emerald-500'
                                : 'fill-fg-subtle/15 stroke-fg-subtle/40'
                        )}
                        strokeWidth={1.75}
                    />
                    {b.axes.map((a, i) => {
                        const lbl = ptAt(i, 124);
                        return (
                            <text
                                key={a.key}
                                x={lbl.x}
                                y={lbl.y}
                                dy="0.35em"
                                textAnchor="middle"
                                className="fill-fg-muted text-[10px] font-medium"
                            >
                                {a.label}
                            </text>
                        );
                    })}
                </svg>

                <p className="text-center text-[11px] text-fg-subtle">
                    {b.ready
                        ? isEn
                            ? `Based on ${b.sampleSize} closed trades.`
                            : `Baseado em ${b.sampleSize} operações fechadas.`
                        : isEn
                          ? `Minimum sample of 3 closed trades (${b.sampleSize}/3).`
                          : `Amostra mínima de 3 trades fechadas (${b.sampleSize}/3).`}
                </p>
            </div>
        </DashCard>
    );
};

/* ------------------------------------------------- Strategy Month Calendar */

const StrategyCalendarCard = ({ orders, currency, isEn }: { orders: ReplayOrder[]; currency: string; isEn: boolean }) => {
    const closed = useMemo(() => closedOrders(orders), [orders]);
    const [monthDate, setMonthDate] = useState(() => {
        if (closed.length > 0) {
            const last = closed[closed.length - 1];
            if (last.closedAt) {
                const d = new Date(last.closedAt);
                return new Date(d.getFullYear(), d.getMonth(), 1);
            }
        }
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1);
    });

    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();

    const byDay = useMemo(() => {
        const m = new Map<string, { pnl: number; count: number }>();
        closed.forEach((o) => {
            if (!o.closedAt) return;
            const k = new Date(o.closedAt).toISOString().slice(0, 10);
            const cur = m.get(k) || { pnl: 0, count: 0 };
            cur.pnl = Number((cur.pnl + o.pnl).toFixed(2));
            cur.count += 1;
            m.set(k, cur);
        });
        return m;
    }, [closed]);

    const weeks = useMemo(() => {
        // Monday-first grid (0 = Seg .. 6 = Dom)
        const rawFirst = new Date(year, month, 1).getDay();
        const firstOffset = (rawFirst + 6) % 7;
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        const rows: {
            weekNum: number;
            weekPnl: number;
            weekTrades: number;
            cells: { day: number | null; iso: string; pnl: number; count: number }[];
        }[] = [];

        let dayCounter = 1;
        for (let w = 0; w < 6; w++) {
            const cells: { day: number | null; iso: string; pnl: number; count: number }[] = [];
            let weekPnl = 0;
            let weekTrades = 0;

            for (let d = 0; d < 7; d++) {
                const idx = w * 7 + d;
                if (idx < firstOffset || dayCounter > daysInMonth) {
                    cells.push({ day: null, iso: '', pnl: 0, count: 0 });
                } else {
                    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayCounter).padStart(2, '0')}`;
                    const stat = byDay.get(iso);
                    const pnl = stat?.pnl || 0;
                    const count = stat?.count || 0;
                    weekPnl += pnl;
                    weekTrades += count;
                    cells.push({ day: dayCounter, iso, pnl, count });
                    dayCounter += 1;
                }
            }
            rows.push({ weekNum: w + 1, weekPnl: Number(weekPnl.toFixed(2)), weekTrades, cells });
            if (dayCounter > daysInMonth) break;
        }
        return rows;
    }, [year, month, byDay]);

    return (
        <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5 space-y-3">
            <header className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-medium text-fg-muted">{isEn ? 'Monthly calendar' : 'Calendário mensal'}</h3>
                <div className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface-2/50 p-0.5">
                    <button
                        type="button"
                        onClick={() => setMonthDate(new Date(year, month - 1, 1))}
                        aria-label={isEn ? 'Previous month' : 'Mês anterior'}
                        className="rounded p-1 text-fg-subtle hover:bg-surface hover:text-fg transition-colors"
                    >
                        <ChevronLeft size={14} />
                    </button>
                    <span className="min-w-[116px] text-center text-xs font-semibold text-fg">
                        {(isEn ? MONTH_NAMES_EN : MONTH_NAMES)[month]} {year}
                    </span>
                    <button
                        type="button"
                        onClick={() => setMonthDate(new Date(year, month + 1, 1))}
                        aria-label={isEn ? 'Next month' : 'Próximo mês'}
                        className="rounded p-1 text-fg-subtle hover:bg-surface hover:text-fg transition-colors"
                    >
                        <ChevronRight size={14} />
                    </button>
                </div>
            </header>

            <div className="overflow-x-auto">
                <div className="min-w-[640px] space-y-1.5">
                    <div className="grid grid-cols-8 gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                        <div className="px-2 py-1">{isEn ? 'Week' : 'Semana'}</div>
                        {(isEn ? DOW_SHORT_EN : DOW_SHORT).map((d) => (
                            <div key={d} className="px-2 py-1 text-right">
                                {d}
                            </div>
                        ))}
                    </div>

                    {weeks.map((w) => (
                        <div key={w.weekNum} className="grid grid-cols-8 gap-1.5">
                            <div className="rounded-lg bg-surface-2/60 border border-line-subtle px-2.5 py-1.5 flex flex-col justify-between min-h-[48px]">
                                <span className="text-[10px] font-medium text-fg-subtle">
                                    {isEn ? `Week ${w.weekNum}` : `Semana ${w.weekNum}`}
                                </span>
                                <span
                                    className={cn(
                                        'text-xs font-bold tabular-nums',
                                        w.weekTrades > 0 ? pnlTone(w.weekPnl) : 'text-fg-subtle'
                                    )}
                                >
                                    {w.weekTrades > 0
                                        ? fmtMoney(w.weekPnl, { sign: true, decimals: 0, currency })
                                        : '—'}
                                </span>
                            </div>

                            {w.cells.map((c, idx) => (
                                <div
                                    key={idx}
                                    className={cn(
                                        'rounded-lg border px-2.5 py-1.5 min-h-[48px] flex flex-col justify-between transition-colors',
                                        c.day === null
                                            ? 'border-transparent bg-surface-2/20 opacity-40'
                                            : c.count === 0
                                              ? 'border-line-subtle bg-surface-2/35'
                                              : c.pnl >= 0
                                                ? 'border-emerald-500/25 bg-emerald-500/[0.08]'
                                                : 'border-rose-500/25 bg-rose-500/[0.08]'
                                    )}
                                >
                                    <span className="text-right text-[10px] tabular-nums text-fg-subtle">
                                        {c.day ?? ''}
                                    </span>
                                    {c.day !== null && c.count > 0 && (
                                        <div className="text-right">
                                            <span className={cn('block text-xs font-bold tabular-nums', pnlTone(c.pnl))}>
                                                {fmtMoney(c.pnl, { sign: true, decimals: 0, currency })}
                                            </span>
                                            <span className="block text-[9px] text-fg-subtle">
                                                {c.count} {c.count === 1 ? 'trade' : 'trades'}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

/* ----------------------------------------------------- Underwater Drawdown */

const UnderwaterCard = ({ orders, initialCapital, isEn }: { orders: ReplayOrder[]; initialCapital: number; isEn: boolean }) => {
    const [wrapRef, width] = useElementWidth<HTMLDivElement>();
    const pts = useMemo(() => underwaterSeries(orders, initialCapital), [orders, initialCapital]);
    const H = 175;
    const M = { top: 18, right: 16, bottom: 20, left: 42 };
    const plotW = Math.max(0, width - M.left - M.right);
    const plotH = H - M.top - M.bottom;

    const minPct = Math.min(-2, ...pts.map((p) => p.ddPct));
    const y = (v: number) => M.top + ((0 - v) / Math.abs(minPct || 1)) * plotH;
    const x = (i: number) => (pts.length <= 1 ? M.left : M.left + (i / (pts.length - 1)) * plotW);

    const lineD = pts.length >= 2 ? pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.ddPct).toFixed(1)}`).join(' ') : '';
    const areaD = lineD ? `${lineD} L${x(pts.length - 1).toFixed(1)},${M.top} L${x(0).toFixed(1)},${M.top} Z` : '';

    return (
        <DashCard
            title="Underwater"
            hint={
                isEn
                    ? 'Percentage drawdown below the high-water mark equity peak.'
                    : 'Distância percentual abaixo do pico máximo do saldo.'
            }
            subtitle={
                isEn
                    ? 'How far below your equity peak you stood across executions.'
                    : 'Quão abaixo do seu melhor saldo você esteve ao longo dos trades.'
            }
        >
            <div ref={wrapRef} className="relative w-full" style={{ height: H }}>
                {width > 0 && (
                    <svg width={width} height={H} className="block" aria-hidden>
                        <line
                            x1={M.left}
                            x2={M.left + plotW}
                            y1={M.top}
                            y2={M.top}
                            className="stroke-line"
                            strokeDasharray="3 3"
                        />
                        <text x={M.left + plotW} y={M.top - 5} textAnchor="end" className="fill-fg-subtle text-[10px]">
                            {isEn ? 'high-water mark (0%)' : 'no topo (0%)'}
                        </text>
                        <text x={M.left - 6} y={M.top + 3} textAnchor="end" className="fill-fg-subtle text-[10px] tabular-nums">
                            0%
                        </text>
                        <text x={M.left - 6} y={M.top + plotH} textAnchor="end" className="fill-fg-subtle text-[10px] tabular-nums">
                            {fmtNum(minPct, 1)}%
                        </text>

                        {pts.length >= 2 && (
                            <>
                                <path d={areaD} className="fill-rose-500/15" />
                                <path d={lineD} fill="none" strokeWidth={2} className="stroke-rose-500" />
                            </>
                        )}
                    </svg>
                )}
            </div>
        </DashCard>
    );
};

/* ---------------------------------------------------------- R Distribution */

const RDistributionCard = ({ orders, isEn }: { orders: ReplayOrder[]; isEn: boolean }) => {
    const buckets = useMemo(() => rDistribution(orders), [orders]);
    const maxCount = Math.max(1, ...buckets.map((b) => b.count));
    const total = buckets.reduce((s, b) => s + b.count, 0);

    return (
        <DashCard
            title={isEn ? 'R Distribution' : 'Distribuição de R'}
            hint={isEn ? 'Histogram of realized R-multiples.' : 'Histograma dos múltiplos de risco realizados.'}
            subtitle={
                isEn
                    ? 'Closed executions with a defined Stop Loss only.'
                    : 'Apenas operações encerradas com Stop Loss definido.'
            }
        >
            <div className="flex h-[175px] flex-col justify-end gap-2 pt-3">
                <div className="flex flex-1 items-end gap-2 border-b border-line pb-1">
                    {buckets.map((b) => {
                        const hPct = total > 0 ? Math.max(b.count > 0 ? 8 : 0, (b.count / maxCount) * 100) : 0;
                        return (
                            <div key={b.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                                {b.count > 0 && (
                                    <span className="text-[10px] font-semibold tabular-nums text-fg-muted">
                                        {b.count}
                                    </span>
                                )}
                                <div
                                    className={cn(
                                        'w-full max-w-[34px] rounded-t-md transition-all',
                                        b.positive ? 'bg-data-pos' : 'bg-data-neg'
                                    )}
                                    style={{ height: `${hPct}%` }}
                                />
                            </div>
                        );
                    })}
                </div>
                <div className="grid grid-cols-7 gap-1 text-center text-[9px] tabular-nums text-fg-subtle">
                    {buckets.map((b) => (
                        <span key={b.label} className="truncate" title={b.label}>
                            {b.label}
                        </span>
                    ))}
                </div>
            </div>
        </DashCard>
    );
};

/* ----------------------------------------------------------- Your Progress */

const ProgressCard = ({ orders, isEn }: { orders: ReplayOrder[]; isEn: boolean }) => {
    const [wrapRef, width] = useElementWidth<HTMLDivElement>();
    const pts = useMemo(() => progressSeries(orders), [orders]);
    const H = 185;
    const M = { top: 14, right: 42, bottom: 26, left: 36 };
    const plotW = Math.max(0, width - M.left - M.right);
    const plotH = H - M.top - M.bottom;

    const rVals = pts.map((p) => p.avgR);
    const rMin = Math.min(0, ...rVals);
    const rMax = Math.max(0.4, ...rVals);

    const x = (i: number) => (pts.length <= 1 ? M.left : M.left + (i / (pts.length - 1)) * plotW);
    const yWr = (v: number) => M.top + plotH - (v / 100) * plotH;
    const yR = (v: number) => M.top + plotH - ((v - rMin) / (rMax - rMin || 1)) * plotH;

    const wrPath = pts.length >= 2 ? pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${yWr(p.winRate).toFixed(1)}`).join(' ') : '';
    const rPath = pts.length >= 2 ? pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${yR(p.avgR).toFixed(1)}`).join(' ') : '';

    return (
        <DashCard
            title={isEn ? 'Your Progress' : 'Seu progresso'}
            hint={
                isEn
                    ? 'Cumulative win rate and average R trajectory.'
                    : 'Evolução acumulada da taxa de acerto e do R médio.'
            }
            subtitle={
                isEn
                    ? 'Cumulative win rate and expectancy (R), trade by trade.'
                    : 'Taxa de acerto acumulada e R médio, trade a trade.'
            }
        >
            <div ref={wrapRef} className="w-full" style={{ height: H }}>
                {width > 0 && (
                    <svg width={width} height={H} className="block" aria-hidden>
                        {[0, 50, 100].map((tick) => (
                            <g key={tick}>
                                <line x1={M.left} x2={M.left + plotW} y1={yWr(tick)} y2={yWr(tick)} className="stroke-line" strokeDasharray="3 3" />
                                <text x={M.left - 6} y={yWr(tick)} dy="0.32em" textAnchor="end" className="fill-fg-subtle text-[10px] tabular-nums">
                                    {tick}%
                                </text>
                            </g>
                        ))}
                        {[rMin, (rMin + rMax) / 2, rMax].map((rt, idx) => (
                            <text key={idx} x={M.left + plotW + 6} y={yR(rt)} dy="0.32em" className="fill-fg-subtle text-[10px] tabular-nums">
                                {rt >= 0 ? `+${rt.toFixed(1)}R` : `${rt.toFixed(1)}R`}
                            </text>
                        ))}

                        {pts.length >= 2 && (
                            <>
                                <path d={wrPath} fill="none" strokeWidth={2} className="stroke-blue-500" />
                                <path d={rPath} fill="none" strokeWidth={2} className="stroke-amber-500" />
                            </>
                        )}
                    </svg>
                )}
            </div>
            <div className="mt-1 flex items-center gap-4 text-[11px] text-fg-muted">
                <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-blue-500" /> {isEn ? 'Win rate' : 'Taxa de acerto'}
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-amber-500" /> {isEn ? 'Avg R' : 'R médio'}
                </span>
            </div>
        </DashCard>
    );
};

/* ----------------------------------------------------------- By Entry Hour */

const EntryHourCard = ({ orders, currency, isEn }: { orders: ReplayOrder[]; currency: string; isEn: boolean }) => {
    const hours = useMemo(() => byEntryHour(orders), [orders]);
    const maxAbs = Math.max(1, ...hours.map((h) => Math.abs(h.pnl)));
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local';

    return (
        <DashCard
            title={isEn ? 'By Entry Hour' : 'Por hora de entrada'}
            hint={
                isEn
                    ? 'Net P&L grouped by execution entry hour.'
                    : 'Resultado líquido agrupado pela hora de abertura da operação.'
            }
            subtitle={isEn ? `In your timezone (${tz}).` : `No seu fuso horário (${tz}).`}
        >
            <div className="flex h-[185px] flex-col justify-end gap-2 pt-2">
                <div className="relative flex flex-1 items-center gap-1">
                    <div className="absolute inset-x-0 top-1/2 border-t border-line" />
                    {hours.map((h) => {
                        const pct = (Math.abs(h.pnl) / maxAbs) * 46;
                        const up = h.pnl >= 0;
                        return (
                            <div
                                key={h.hour}
                                title={`${h.label}: ${fmtMoney(h.pnl, { sign: true, currency })} (${h.trades} trades)`}
                                className="relative h-full flex-1"
                            >
                                {h.trades > 0 && (
                                    <div
                                        className={cn(
                                            'absolute inset-x-0 mx-auto w-full max-w-[10px] rounded-sm',
                                            up ? 'bottom-1/2 bg-data-pos' : 'top-1/2 bg-data-neg'
                                        )}
                                        style={{ height: `${Math.max(4, pct)}%` }}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>
                <div className="flex justify-between text-[9px] tabular-nums text-fg-subtle">
                    <span>00h</span>
                    <span>06h</span>
                    <span>12h</span>
                    <span>18h</span>
                    <span>23h</span>
                </div>
            </div>
        </DashCard>
    );
};

/* -------------------------------------------------------------------- Page */

export const BacktestDashboardPage = () => {
    const navigate = useNavigate();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const [params, setParams] = useSearchParams();
    const { sessions, strategies } = useBacktestWorkspace();

    const urlStrategy = params.get('strategy') || params.get('estrategia');
    const selectedStrategyId =
        urlStrategy === 'ALL'
            ? 'ALL'
            : strategies.find((s) => s.id === urlStrategy)?.id || strategies[0]?.id || 'ALL';

    const activeStrategy = strategies.find((s) => s.id === selectedStrategyId);
    const currency = activeStrategy?.currency || 'USD';

    const [period, setPeriod] = useState<Period>('ALL');
    const [breakdownDim, setBreakdownDim] = useState<BreakdownDimension>('none');

    const scopedSessions = useMemo(() => {
        const cutoff = period === 'ALL' ? 0 : Date.now() - PERIOD_DAYS[period] * 86400000;
        return sessions.filter(
            (s) =>
                (selectedStrategyId === 'ALL' || s.strategyId === selectedStrategyId) &&
                new Date(s.updatedAt || s.createdAt).getTime() >= cutoff
        );
    }, [sessions, selectedStrategyId, period]);

    const baseCapital = activeStrategy ? activeStrategy.startingCapital : undefined;
    const st = useMemo(() => aggregateStats(scopedSessions, baseCapital), [scopedSessions, baseCapital]);
    const allOrders = useMemo(() => scopedSessions.flatMap((s) => s.orders || []), [scopedSessions]);
    const seconds = useMemo(
        () => scopedSessions.reduce((a, s) => a + (s.timeInvestedSeconds || 0), 0),
        [scopedSessions]
    );
    const breakdownRows = useMemo(
        () => computeBreakdown(scopedSessions, breakdownDim),
        [scopedSessions, breakdownDim]
    );

    // Keep dailyPoints import warm if needed for consistency
    useMemo(() => dailyPoints(allOrders), [allOrders]);

    const none = st.closedTrades === 0;
    const balancePositive = st.currentBalance >= st.capital;
    const returnPct = st.capital > 0 ? ((st.currentBalance - st.capital) / st.capital) * 100 : 0;
    const winLossTotal = st.avgWin + st.avgLoss;
    const avgWinWidth = winLossTotal > 0 ? Math.round((st.avgWin / winLossTotal) * 100) : 50;

    const handleStrategyChange = (id: string) => {
        setParams(id === 'ALL' ? { strategy: 'ALL' } : { strategy: id }, { replace: true });
    };

    return (
        <div className="space-y-4">
            {/* Compact Strategy & Period Toolbar */}
            <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2.5">
                    <label htmlFor="dash-strategy-select" className="text-xs font-semibold text-fg-subtle">
                        {isEn ? 'Strategy' : 'Estratégia'}
                    </label>
                    <select
                        id="dash-strategy-select"
                        value={selectedStrategyId}
                        onChange={(e) => handleStrategyChange(e.target.value)}
                        className="rounded-xl border border-line bg-surface-2 px-3 py-1.5 text-xs font-bold text-fg focus:border-accent focus:outline-none"
                    >
                        {strategies.map((s) => (
                            <option key={s.id} value={s.id}>
                                {s.name} ({s.currency || 'USD'} {(s.startingCapital || 100000).toLocaleString('en-US')})
                            </option>
                        ))}
                        {strategies.length > 1 && <option value="ALL">{isEn ? 'All strategies' : 'Todas as estratégias'}</option>}
                    </select>

                    {activeStrategy && (
                        <Button
                            variant="outline"
                            size="sm"
                            icon={<BookOpen size={13} />}
                            onClick={() => navigate(`/backtesting/journal?strategy=${activeStrategy.id}`)}
                        >
                            {isEn ? 'Journal' : 'Diário'}
                        </Button>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <Segmented
                        label={isEn ? 'Period' : 'Período'}
                        value={period}
                        onChange={setPeriod}
                        options={[
                            { value: 'ALL', label: isEn ? 'All' : 'Tudo' },
                            { value: '7D', label: '7d' },
                            { value: '30D', label: '30d' },
                            { value: '90D', label: '90d' },
                        ]}
                    />
                    {activeStrategy && (
                        <Button
                            variant="brand"
                            size="sm"
                            icon={<Plus size={13} />}
                            onClick={() => navigate(`/backtesting/sessions/new?strategy=${activeStrategy.id}`)}
                        >
                            {isEn ? 'New session' : 'Nova sessão'}
                        </Button>
                    )}
                </div>
            </div>

            {/* Row 1: Performance Balance & Time Invested */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <section
                    className={cn(
                        'rounded-2xl border p-5 sm:p-6 flex flex-col justify-between min-h-[148px]',
                        balancePositive
                            ? 'border-emerald-500/25 bg-emerald-500/[0.06]'
                            : 'border-rose-500/25 bg-rose-500/[0.06]'
                    )}
                >
                    <div className="flex items-center justify-between gap-2">
                        <p className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                            <span>Performance</span>
                            <MetricHint
                                text={
                                    isEn
                                        ? 'Current realized balance versus starting strategy capital.'
                                        : 'Saldo realizado atual face ao capital inicial da estratégia.'
                                }
                            />
                            <span className="text-fg-subtle">
                                {isEn ? 'of' : 'de'} {fmtMoney(st.capital, { decimals: 0, currency })}
                            </span>
                        </p>
                        {!none && (
                            <span
                                className={cn(
                                    'rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums',
                                    returnPct >= 0
                                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                        : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                                )}
                            >
                                {returnPct >= 0 ? '+' : ''}
                                {fmtNum(returnPct, 2)}%
                            </span>
                        )}
                    </div>

                    <div className="mt-3">
                        <p className="text-3xl sm:text-4xl font-extrabold tracking-tight tabular-nums text-fg">
                            {fmtMoney(st.currentBalance, { currency })}
                        </p>
                        <p className="mt-1 text-xs text-fg-muted">
                            {scopedSessions.length}{' '}
                            {isEn
                                ? scopedSessions.length === 1
                                    ? 'session'
                                    : 'sessions'
                                : scopedSessions.length === 1
                                  ? 'sessão'
                                  : 'sessões'}{' '}
                            · {st.totalTrades} {st.totalTrades === 1 ? 'trade' : 'trades'} ({st.closedTrades}{' '}
                            {isEn
                                ? 'closed'
                                : st.closedTrades === 1
                                  ? 'fechada'
                                  : 'fechadas'}
                            )
                        </p>
                    </div>
                </section>

                <DashCard
                    title={isEn ? 'Time invested · full strategy' : 'Tempo investido · estratégia completa'}
                    hint={
                        isEn
                            ? 'Total active terminal time logged across replay sessions in this strategy.'
                            : 'Soma do tempo em que esteve com o terminal de replay ativo nas sessões desta estratégia.'
                    }
                    className="min-h-[148px]"
                >
                    <div>
                        <p className="text-2xl sm:text-3xl font-bold tabular-nums text-fg">
                            {seconds > 0 ? fmtDuration(seconds) : '—'}
                        </p>
                        <p className="mt-1.5 text-xs text-fg-subtle">
                            {seconds > 0
                                ? isEn
                                    ? `Across ${scopedSessions.length} replay ${scopedSessions.length === 1 ? 'session' : 'sessions'}.`
                                    : `Distribuído por ${scopedSessions.length} ${scopedSessions.length === 1 ? 'sessão' : 'sessões'} de replay.`
                                : isEn
                                  ? 'Not tracked yet. Accumulates active replay terminal time for this strategy.'
                                  : 'Ainda não medido. Contabiliza o tempo dedicado ao replay desta estratégia.'}
                        </p>
                    </div>
                </DashCard>
            </div>

            {/* Row 2 & 3: 8 Essential KPI Cards */}
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                {/* 1. Cumulative Net P&L */}
                <DashCard
                    title={isEn ? 'Cumulative Net P&L' : 'P&L líquido acumulado'}
                    hint={
                        isEn
                            ? 'Sum of realized profits and losses across all closed trades.'
                            : 'Soma de todos os ganhos e perdas das trades fechadas.'
                    }
                >
                    <p className={cn('text-2xl font-bold tabular-nums', none ? 'text-fg' : pnlTone(st.netProfit))}>
                        {none ? '—' : fmtMoney(st.netProfit, { sign: true, currency })}
                    </p>
                    <p className="mt-1 text-[11px] text-fg-subtle">
                        {none
                            ? isEn
                                ? 'No closed trades yet.'
                                : 'Ainda não fechou nenhuma trade.'
                            : isEn
                              ? `${st.closedTrades} closed executions`
                              : `${st.closedTrades} operações encerradas`}
                    </p>
                </DashCard>

                {/* 2. Average R */}
                <DashCard
                    title={isEn ? 'Avg R-Multiple' : 'R médio'}
                    hint={
                        isEn
                            ? 'Average return expressed in multiples of planned initial risk.'
                            : 'Média de retorno em múltiplos do risco planeado por operação.'
                    }
                >
                    <p
                        className={cn(
                            'text-2xl font-bold tabular-nums',
                            st.avgRWithPlan === null ? 'text-fg' : pnlTone(st.avgRWithPlan)
                        )}
                    >
                        {st.avgRWithPlan === null ? '—' : `${st.avgRWithPlan > 0 ? '+' : ''}${fmtNum(st.avgRWithPlan)}R`}
                    </p>
                    <p className="mt-1 text-[11px] text-fg-subtle">
                        {st.avgRWithPlan === null
                            ? isEn
                                ? 'No trades have a defined risk plan.'
                                : 'Nenhuma trade possui plano de risco.'
                            : isEn
                              ? `Across ${st.rTradesCount} trades with Stop Loss`
                              : `Em ${st.rTradesCount} trades com Stop Loss`}
                    </p>
                </DashCard>

                {/* 3. Win Rate + Donut */}
                <DashCard
                    title={isEn ? 'Win Rate' : 'Taxa de acerto'}
                    hint={
                        isEn
                            ? 'Percentage of closed executions ending in net profit.'
                            : 'Percentagem de trades fechadas com resultado positivo.'
                    }
                >
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-2xl font-bold tabular-nums text-fg">
                                {none ? '—' : `${fmtNum(st.winRate, 1)}%`}
                            </p>
                            <div className="mt-1 space-y-0.5 text-[11px] tabular-nums">
                                <p className="text-emerald-600 dark:text-emerald-400">
                                    {st.wins} {isEn ? 'wins' : 'ganhos'}
                                </p>
                                <p className="text-rose-600 dark:text-rose-400">
                                    {st.losses} {isEn ? 'losses' : 'perdas'}
                                </p>
                            </div>
                        </div>
                        <WinRateDonut wins={st.wins} losses={st.losses} />
                    </div>
                </DashCard>

                {/* 4. Average Win / Loss */}
                <DashCard
                    title={isEn ? 'Avg Win / Loss' : 'Média ganho / perda'}
                    hint={
                        isEn
                            ? 'Ratio of average winning trade to average losing trade.'
                            : 'Relação entre o ganho médio e a perda média por operação.'
                    }
                >
                    <div className="space-y-2">
                        <p className="text-2xl font-bold tabular-nums text-fg">
                            {st.avgWin > 0 && st.avgLoss > 0 ? fmtNum(st.avgWin / st.avgLoss, 2) : '—'}
                        </p>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3 flex">
                            {!none && (
                                <>
                                    <div className="bg-emerald-500 h-full" style={{ width: `${avgWinWidth}%` }} />
                                    <div className="bg-rose-500 h-full flex-1" />
                                </>
                            )}
                        </div>
                        <div className="flex justify-between text-[11px] tabular-nums">
                            <span className="text-emerald-600 dark:text-emerald-400">
                                {st.wins > 0 ? fmtMoney(st.avgWin, { sign: true, decimals: 0, currency }) : '—'}
                            </span>
                            <span className="text-rose-600 dark:text-rose-400">
                                {st.losses > 0 ? fmtMoney(-st.avgLoss, { sign: true, decimals: 0, currency }) : '—'}
                            </span>
                        </div>
                    </div>
                </DashCard>

                {/* 5. Profit Factor */}
                <DashCard
                    title="Profit factor"
                    hint={isEn ? 'Gross profit divided by gross loss.' : 'Lucro bruto dividido pela perda bruta.'}
                >
                    <p className="text-2xl font-bold tabular-nums text-fg">
                        {none ? '—' : st.profitFactor === null ? '∞' : fmtNum(st.profitFactor)}
                    </p>
                </DashCard>

                {/* 6. Expectancy per trade */}
                <DashCard
                    title={isEn ? 'Expectancy per trade' : 'Expectativa por trade'}
                    hint={isEn ? 'Expected average return per closed trade.' : 'Valor médio esperado por cada trade fechada.'}
                >
                    <p className={cn('text-2xl font-bold tabular-nums', none ? 'text-fg' : pnlTone(st.expectancy))}>
                        {none ? '—' : fmtMoney(st.expectancy, { sign: true, currency })}
                    </p>
                </DashCard>

                {/* 7. Best day */}
                <DashCard
                    title={isEn ? 'Best day' : 'Melhor dia'}
                    hint={
                        isEn
                            ? 'Highest net positive P&L achieved in a single session day.'
                            : 'Maior resultado líquido positivo alcançado num único dia.'
                    }
                >
                    <p
                        className={cn(
                            'text-2xl font-bold tabular-nums',
                            st.bestDay && st.bestDay.value > 0 ? 'text-accent-fg' : 'text-fg'
                        )}
                    >
                        {st.bestDay ? fmtMoney(st.bestDay.value, { sign: true, currency }) : '—'}
                    </p>
                    {st.bestDay && <p className="mt-1 text-[11px] text-fg-subtle">{st.bestDay.date}</p>}
                </DashCard>

                {/* 8. Maximum Drawdown */}
                <DashCard
                    title={isEn ? 'Max Drawdown' : 'Drawdown máximo'}
                    hint={
                        isEn
                            ? 'Largest cumulative peak-to-trough decline in equity.'
                            : 'Maior queda acumulada a partir de um pico do saldo.'
                    }
                >
                    <p className={cn('text-2xl font-bold tabular-nums', st.maxDrawdown > 0 ? 'text-danger-fg' : 'text-fg')}>
                        {none ? '—' : st.maxDrawdown > 0 ? fmtMoney(-st.maxDrawdown, { currency }) : fmtMoney(0, { currency })}
                    </p>
                    {!none && st.maxDrawdownPct > 0 && (
                        <p className="mt-1 text-[11px] text-fg-subtle">
                            −{fmtNum(st.maxDrawdownPct, 2)}% {isEn ? 'from peak' : 'do pico'}
                        </p>
                    )}
                </DashCard>
            </div>

            {/* Row 4: Equity Curve + Behavior Pentagon */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
                <EquityCurveCard orders={allOrders} initialCapital={st.capital} currency={currency} isEn={isEn} />
                <BehaviorCard orders={allOrders} isEn={isEn} />
            </div>

            {/* Row 5: Calendar with Weekly Breakdown */}
            <StrategyCalendarCard orders={allOrders} currency={currency} isEn={isEn} />

            {/* Row 6: Underwater + R Distribution */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <UnderwaterCard orders={allOrders} initialCapital={st.capital} isEn={isEn} />
                <RDistributionCard orders={allOrders} isEn={isEn} />
            </div>

            {/* Row 7: Your Progress + By Entry Hour */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <ProgressCard orders={allOrders} isEn={isEn} />
                <EntryHourCard orders={allOrders} currency={currency} isEn={isEn} />
            </div>

            {/* Row 8: Multi-Dimension Breakdown */}
            <section className="rounded-2xl border border-line bg-surface overflow-hidden">
                <header className="flex flex-col gap-3 border-b border-line p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                            <span>{isEn ? 'Performance Breakdown' : 'Decomposição (Breakdown)'}</span>
                            <MetricHint
                                text={
                                    isEn
                                        ? 'Same metrics computed per cohort; cohort totals sum to overall performance.'
                                        : 'As mesmas métricas calculadas por subconjunto; os valores somam o total.'
                                }
                            />
                        </h3>
                        <p className="mt-0.5 text-xs text-fg-muted">
                            {isEn
                                ? 'Compare execution edge across day of week, session hour, side, symbol, or session.'
                                : 'Compare o desempenho por dia, horário, direção, ativo ou sessão.'}
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                        {(
                            [
                                { id: 'none', label: isEn ? 'Overall' : 'Geral' },
                                { id: 'dow', label: isEn ? 'Day of Week' : 'Dia da semana' },
                                { id: 'hour', label: isEn ? 'Hour' : 'Horário' },
                                { id: 'side', label: isEn ? 'Long / Short' : 'Compra / Venda' },
                                { id: 'symbol', label: isEn ? 'Symbol' : 'Ativo' },
                                { id: 'session', label: isEn ? 'Session' : 'Sessão' },
                            ] as { id: BreakdownDimension; label: string }[]
                        ).map((opt) => (
                            <button
                                key={opt.id}
                                type="button"
                                onClick={() => setBreakdownDim(opt.id)}
                                className={cn(
                                    'rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors',
                                    breakdownDim === opt.id
                                        ? 'bg-fg text-canvas'
                                        : 'bg-surface-2 text-fg-muted hover:text-fg'
                                )}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </header>

                {breakdownRows.length === 0 ? (
                    <div className="px-5 py-10 text-center text-xs text-fg-muted">
                        {isEn
                            ? 'No closed trades available to decompose in this period.'
                            : 'Sem operações fechadas para decompor neste período.'}
                        {scopedSessions[0] && (
                            <div className="mt-3">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    icon={<Play size={12} fill="currentColor" />}
                                    onClick={() => navigate(`/backtesting/replay/${scopedSessions[0].id}`)}
                                >
                                    {isEn ? 'Go to replay' : 'Ir para o replay'}
                                </Button>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[600px] text-sm">
                            <thead>
                                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-fg-subtle">
                                    <th className="px-5 py-2.5 font-semibold">{isEn ? 'Cohort' : 'Grupo'}</th>
                                    <th className="px-3 py-2.5 text-right font-semibold">Trades</th>
                                    <th className="px-3 py-2.5 text-right font-semibold">{isEn ? 'Win Rate' : 'Acerto'}</th>
                                    <th className="px-3 py-2.5 text-right font-semibold">Profit factor</th>
                                    <th className="px-3 py-2.5 text-right font-semibold">{isEn ? 'Avg R' : 'R médio'}</th>
                                    <th className="px-5 py-2.5 text-right font-semibold">{isEn ? 'Net P&L' : 'P&L líquido'}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                                {breakdownRows.map((r) => (
                                    <tr key={r.id} className="hover:bg-surface-2/50 transition-colors">
                                        <td className="px-5 py-3 font-semibold text-fg">
                                            {r.href ? (
                                                <Link to={r.href} className="hover:text-accent-fg hover:underline">
                                                    {r.label}
                                                </Link>
                                            ) : (
                                                r.label
                                            )}
                                        </td>
                                        <td className="px-3 py-3 text-right tabular-nums">{r.trades}</td>
                                        <td className="px-3 py-3 text-right tabular-nums">
                                            {r.trades ? `${fmtNum(r.winRate, 1)}%` : '—'}
                                        </td>
                                        <td className="px-3 py-3 text-right tabular-nums">
                                            {r.trades ? (r.profitFactor === null ? '∞' : fmtNum(r.profitFactor)) : '—'}
                                        </td>
                                        <td className={cn('px-3 py-3 text-right tabular-nums', r.trades ? pnlTone(r.avgR) : '')}>
                                            {r.trades ? `${r.avgR > 0 ? '+' : ''}${fmtNum(r.avgR)}R` : '—'}
                                        </td>
                                        <td
                                            className={cn(
                                                'px-5 py-3 text-right font-bold tabular-nums',
                                                r.trades ? pnlTone(r.pnl) : 'text-fg-subtle'
                                            )}
                                        >
                                            {r.trades ? fmtMoney(r.pnl, { sign: true, currency }) : '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </div>
    );
};
