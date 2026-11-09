import React, { useId, useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { cn } from '../../lib/cn';
import { ChartCard, ChartEmpty, Segmented } from './ChartCard';
import { formatMoney, formatMoneyCompact, niceDomain, pickLabelIndices, useElementWidth } from './chartUtils';

export interface DailyPoint {
    isoDate: string;
    /** dd/mm label */
    date: string;
    value: number;
}

type Mode = 'cumulative' | 'daily';

const HEIGHT = 240;
const M = { top: 14, right: 14, bottom: 26, left: 56 };
const BAR_MAX = 24;
const RADIUS = 4;

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

const longDate = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });

/**
 * Period result chart. "Acumulado" = running net P&L (equity curve from 0);
 * "Diário" = one column per trading day around the zero line.
 * Polarity is encoded by side of the zero line AND color AND sign — never color alone.
 */
export const PnLChart = ({ data, className }: { data: DailyPoint[]; className?: string }) => {
    const [mode, setMode] = useState<Mode>('cumulative');
    const [active, setActive] = useState<number | null>(null);
    const [showTable, setShowTable] = useState(false);
    const [wrapRef, width] = useElementWidth<HTMLDivElement>();
    const clipId = useId().replace(/:/g, '');

    const rows = useMemo(() => {
        let acc = 0;
        return data.map((d) => {
            acc += d.value;
            return { ...d, cumulative: Math.round(acc * 100) / 100 };
        });
    }, [data]);

    const summary = useMemo(() => {
        const vals = rows.map((r) => r.value);
        const net = vals.reduce((a, b) => a + b, 0);
        const best = rows.reduce<(typeof rows)[number] | null>((b, r) => (!b || r.value > b.value ? r : b), null);
        const worst = rows.reduce<(typeof rows)[number] | null>((b, r) => (!b || r.value < b.value ? r : b), null);
        return { net, best, worst, green: vals.filter((v) => v > 0).length, days: vals.length };
    }, [rows]);

    const plotW = Math.max(0, width - M.left - M.right);
    const plotH = HEIGHT - M.top - M.bottom;

    const series = rows.map((r) => (mode === 'cumulative' ? r.cumulative : r.value));
    const domain = useMemo(() => niceDomain(Math.min(...series, 0), Math.max(...series, 0), 4), [series.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

    const y = (v: number) => M.top + plotH - ((v - domain.min) / (domain.max - domain.min || 1)) * plotH;
    const zeroY = y(0);
    const n = rows.length;
    const band = n > 0 ? plotW / n : 0;
    const xCenter = (i: number) => (mode === 'daily' || n === 1 ? M.left + band * (i + 0.5) : M.left + (i / (n - 1)) * plotW);

    const linePath = useMemo(() => {
        if (mode !== 'cumulative' || n < 2) return '';
        return series.map((v, i) => `${i ? 'L' : 'M'}${xCenter(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    }, [mode, series.join(','), plotW, domain.min, domain.max]); // eslint-disable-line react-hooks/exhaustive-deps
    const areaPath = linePath ? `${linePath} L${xCenter(n - 1).toFixed(1)},${zeroY} L${xCenter(0).toFixed(1)},${zeroY} Z` : '';

    const labelIdx = pickLabelIndices(n, Math.max(2, Math.min(7, Math.floor(plotW / 70))));

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (!n) return;
        if (e.key === 'ArrowRight') setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
        else if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? n) - 1));
        else if (e.key === 'Escape') setActive(null);
        else return;
        e.preventDefault();
    };

    const activeRow = active !== null ? rows[active] : null;
    const tipLeft = active !== null ? Math.min(Math.max(xCenter(active), 90), width - 90) : 0;

    const netTone = summary.net > 0 ? 'text-accent-fg' : summary.net < 0 ? 'text-danger-fg' : 'text-fg';

    return (
        <ChartCard
            className={className}
            title="Resultado do período"
            icon={<TrendingUp size={14} />}
            subtitle={n ? `${n} ${n === 1 ? 'dia operado' : 'dias operados'} · fechamento em UTC` : undefined}
            actions={
                n > 0 && (
                    <>
                        <Segmented
                            label="Modo do gráfico"
                            value={mode}
                            onChange={(m) => {
                                setMode(m);
                                setActive(null);
                            }}
                            options={[
                                { value: 'cumulative', label: 'Acumulado' },
                                { value: 'daily', label: 'Diário' },
                            ]}
                        />
                        <button
                            type="button"
                            onClick={() => setShowTable((s) => !s)}
                            aria-pressed={showTable}
                            className="rounded-md px-2 py-1 text-[11px] font-semibold text-fg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                        >
                            {showTable ? 'Gráfico' : 'Tabela'}
                        </button>
                    </>
                )
            }
        >
            {n === 0 ? (
                <ChartEmpty message="Nenhuma operação fechada no período" hint="Sincronize a conta ou adicione trades para ver a curva de resultado." className="min-h-[240px]" />
            ) : (
                <>
                    <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                        <div>
                            <dt className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Líquido</dt>
                            <dd className={cn('text-lg font-bold', netTone)}>{formatMoney(summary.net)}</dd>
                        </div>
                        <div>
                            <dt className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Dias positivos</dt>
                            <dd className="text-lg font-bold text-fg">
                                {summary.green}
                                <span className="text-xs font-medium text-fg-subtle">/{summary.days}</span>
                            </dd>
                        </div>
                        <div>
                            <dt className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Melhor dia</dt>
                            <dd className="text-sm font-semibold text-fg">
                                {summary.best && summary.best.value > 0 ? `${formatMoney(summary.best.value)} · ${summary.best.date}` : '—'}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Pior dia</dt>
                            <dd className="text-sm font-semibold text-fg">
                                {summary.worst && summary.worst.value < 0 ? `${formatMoney(summary.worst.value)} · ${summary.worst.date}` : '—'}
                            </dd>
                        </div>
                    </dl>

                    {showTable ? (
                        <div className="max-h-[260px] overflow-auto rounded-lg border border-line">
                            <table className="w-full text-xs">
                                <caption className="sr-only">Resultado diário e acumulado</caption>
                                <thead className="sticky top-0 bg-surface-2 text-fg-muted">
                                    <tr>
                                        <th scope="col" className="px-3 py-2 text-left font-semibold">Dia</th>
                                        <th scope="col" className="px-3 py-2 text-right font-semibold">Resultado</th>
                                        <th scope="col" className="px-3 py-2 text-right font-semibold">Acumulado</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-line tabular-nums">
                                    {rows.map((r) => (
                                        <tr key={r.isoDate}>
                                            <td className="px-3 py-1.5 text-fg-muted">{longDate(r.isoDate)}</td>
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
                            className="relative w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                            style={{ height: HEIGHT }}
                            tabIndex={0}
                            role="img"
                            aria-label={`${mode === 'cumulative' ? 'Resultado acumulado' : 'Resultado diário'}: ${n} dias, líquido ${formatMoney(summary.net)}. Use as setas para percorrer os dias.`}
                            onKeyDown={onKeyDown}
                            onBlur={() => setActive(null)}
                            onMouseLeave={() => setActive(null)}
                        >
                            {width > 0 && (
                                <svg width={width} height={HEIGHT} className="block overflow-visible" aria-hidden>
                                    <defs>
                                        <clipPath id={`${clipId}-above`}>
                                            <rect x={M.left} y={0} width={plotW} height={Math.max(0, zeroY)} />
                                        </clipPath>
                                        <clipPath id={`${clipId}-below`}>
                                            <rect x={M.left} y={zeroY} width={plotW} height={Math.max(0, HEIGHT - zeroY)} />
                                        </clipPath>
                                    </defs>

                                    {/* Grid: solid hairlines; zero line slightly stronger */}
                                    {domain.ticks.map((t) => (
                                        <g key={t}>
                                            <line
                                                x1={M.left}
                                                x2={M.left + plotW}
                                                y1={y(t)}
                                                y2={y(t)}
                                                className={t === 0 ? 'stroke-fg-subtle/60' : 'stroke-line'}
                                                strokeWidth={1}
                                                shapeRendering="crispEdges"
                                            />
                                            <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-fg-subtle text-[10.5px] tabular-nums">
                                                {formatMoneyCompact(t)}
                                            </text>
                                        </g>
                                    ))}

                                    {labelIdx.map((i, k) => (
                                        <text
                                            key={i}
                                            x={xCenter(i)}
                                            y={HEIGHT - 6}
                                            textAnchor={mode === 'cumulative' && n > 1 ? (k === 0 ? 'start' : k === labelIdx.length - 1 ? 'end' : 'middle') : 'middle'}
                                            className="fill-fg-subtle text-[10.5px] tabular-nums"
                                        >
                                            {rows[i].date}
                                        </text>
                                    ))}

                                    {mode === 'daily' &&
                                        rows.map((r, i) => {
                                            const w = Math.max(2, Math.min(BAR_MAX, band - 2, band * 0.7));
                                            const x = M.left + band * i + (band - w) / 2;
                                            return (
                                                <path
                                                    key={r.isoDate}
                                                    d={barPath(x, w, zeroY, y(r.value))}
                                                    className={cn(
                                                        r.value >= 0 ? 'fill-data-pos' : 'fill-data-neg',
                                                        active !== null && active !== i && 'opacity-40'
                                                    )}
                                                />
                                            );
                                        })}

                                    {mode === 'cumulative' && n >= 2 && (
                                        <>
                                            <path d={areaPath} clipPath={`url(#${clipId}-above)`} className="fill-data-pos/10" />
                                            <path d={areaPath} clipPath={`url(#${clipId}-below)`} className="fill-data-neg/10" />
                                            <path d={linePath} clipPath={`url(#${clipId}-above)`} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="stroke-data-pos" />
                                            <path d={linePath} clipPath={`url(#${clipId}-below)`} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="stroke-data-neg" />
                                            {/* Selective direct label: the end value */}
                                            <circle cx={xCenter(n - 1)} cy={y(series[n - 1])} r={4} strokeWidth={2} className={cn('stroke-surface', series[n - 1] >= 0 ? 'fill-data-pos' : 'fill-data-neg')} />
                                        </>
                                    )}
                                    {mode === 'cumulative' && n === 1 && (
                                        <circle cx={xCenter(0)} cy={y(series[0])} r={5} strokeWidth={2} className={cn('stroke-surface', series[0] >= 0 ? 'fill-data-pos' : 'fill-data-neg')} />
                                    )}

                                    {active !== null && (
                                        <g pointerEvents="none">
                                            <line x1={xCenter(active)} x2={xCenter(active)} y1={M.top} y2={M.top + plotH} className="stroke-fg-subtle/50" strokeWidth={1} />
                                            {mode === 'cumulative' && (
                                                <circle cx={xCenter(active)} cy={y(series[active])} r={5} strokeWidth={2} className={cn('stroke-surface', series[active] >= 0 ? 'fill-data-pos' : 'fill-data-neg')} />
                                            )}
                                        </g>
                                    )}

                                    {/* Hit areas: full-height bands, larger than the marks */}
                                    {rows.map((r, i) => {
                                        const hw = mode === 'daily' || n === 1 ? band : plotW / Math.max(1, n - 1);
                                        return (
                                            <rect
                                                key={r.isoDate}
                                                x={xCenter(i) - hw / 2}
                                                y={M.top}
                                                width={Math.max(hw, 8)}
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
                                    className="pointer-events-none absolute top-1 z-10 w-[168px] -translate-x-1/2 rounded-lg border border-line-strong bg-raised px-3 py-2 shadow-panel"
                                    style={{ left: tipLeft }}
                                >
                                    <p className="text-[11px] capitalize text-fg-subtle">{longDate(activeRow.isoDate)}</p>
                                    <p className="mt-0.5 flex items-center justify-between text-xs">
                                        <span className="text-fg-muted">Dia</span>
                                        <span className={cn('font-semibold tabular-nums', activeRow.value > 0 ? 'text-accent-fg' : activeRow.value < 0 ? 'text-danger-fg' : 'text-fg')}>
                                            {formatMoney(activeRow.value)}
                                        </span>
                                    </p>
                                    <p className="flex items-center justify-between text-xs">
                                        <span className="text-fg-muted">Acumulado</span>
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
