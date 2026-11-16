import { useMemo, useState } from 'react';
import { useChartTheme } from '../../hooks/useChartTheme';
import { useLocale } from '../../context/LocaleContext';
import { formatMoney, formatMoneyCompact, niceDomain, pickLabelIndices, useElementWidth } from '../charts/chartUtils';
import { ChartEmpty } from '../charts/ChartCard';

export interface ComparisonPoint {
    label: string;
    a: number;
    b: number;
}

const H = 240;
const M = { top: 14, right: 16, bottom: 26, left: 56 };

/**
 * Two cumulative-P&L lines on one axis: a neutral baseline (A) and the
 * highlighted scenario (B). Legend + direct end labels so identity is never
 * colour alone; hover shows both values for the bar under the pointer.
 */
export const ComparisonChart = ({
    data,
    labelA,
    labelB,
    caption,
}: {
    data: ComparisonPoint[];
    labelA: string;
    labelB: string;
    caption?: string;
}) => {
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const ct = useChartTheme();
    const [ref, width] = useElementWidth<HTMLDivElement>();
    const [hover, setHover] = useState<number | null>(null);

    const geo = useMemo(() => {
        if (data.length < 2 || width < 50) return null;
        const vals = data.flatMap((d) => [d.a, d.b]);
        const dom = niceDomain(Math.min(...vals), Math.max(...vals), 4);
        const iw = width - M.left - M.right;
        const ih = H - M.top - M.bottom;
        const x = (i: number) => M.left + (i / (data.length - 1)) * iw;
        const y = (v: number) => M.top + (1 - (v - dom.min) / (dom.max - dom.min || 1)) * ih;
        const path = (k: 'a' | 'b') => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join('');
        return { dom, x, y, pathA: path('a'), pathB: path('b'), iw };
    }, [data, width]);

    const last = data[data.length - 1];
    const labels = pickLabelIndices(data.length, Math.max(2, Math.floor((width || 300) / 110)));

    return (
        <figure className="space-y-2">
            <div className="flex flex-wrap items-center gap-4 text-xs" aria-hidden>
                <span className="inline-flex items-center gap-1.5 text-fg-muted">
                    <span className="h-0.5 w-4 rounded" style={{ background: ct.tick }} /> {labelA}
                </span>
                <span className="inline-flex items-center gap-1.5 text-fg">
                    <span className="h-0.5 w-4 rounded" style={{ background: ct.series1 }} /> {labelB}
                </span>
            </div>
            <div ref={ref} className="relative w-full" style={{ height: H }}>
                {!geo ? (
                    <ChartEmpty
                        message={isEn ? 'Insufficient data for comparison curve' : 'Dados insuficientes para a curva'}
                        hint={isEn ? 'At least 2 executions are required.' : 'São precisos pelo menos 2 trades.'}
                        className="h-full"
                    />
                ) : (
                    <svg
                        width={width}
                        height={H}
                        role="img"
                        aria-label={`${labelA}: ${formatMoney(last.a)}; ${labelB}: ${formatMoney(last.b)}`}
                        onMouseLeave={() => setHover(null)}
                        onMouseMove={(e) => {
                            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
                            const i = Math.round(((e.clientX - r.left - M.left) / geo.iw) * (data.length - 1));
                            setHover(Math.max(0, Math.min(data.length - 1, i)));
                        }}
                    >
                        {geo.dom.ticks.map((t) => (
                            <g key={t}>
                                <line x1={M.left} x2={width - M.right} y1={geo.y(t)} y2={geo.y(t)} stroke={t === 0 ? ct.gridStrong : ct.grid} />
                                <text x={M.left - 8} y={geo.y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={ct.tick}>
                                    {formatMoneyCompact(t)}
                                </text>
                            </g>
                        ))}
                        {labels.map((i, k) => (
                            <text key={i} x={geo.x(i)} y={H - 8} fontSize={11} fill={ct.tick} textAnchor={k === 0 ? 'start' : k === labels.length - 1 ? 'end' : 'middle'}>
                                {data[i].label}
                            </text>
                        ))}
                        <path d={geo.pathA} fill="none" stroke={ct.tick} strokeWidth={2} strokeLinejoin="round" />
                        <path d={geo.pathB} fill="none" stroke={ct.series1} strokeWidth={2} strokeLinejoin="round" />
                        {hover !== null && (
                            <g>
                                <line x1={geo.x(hover)} x2={geo.x(hover)} y1={M.top} y2={H - M.bottom} stroke={ct.gridStrong} />
                                <circle cx={geo.x(hover)} cy={geo.y(data[hover].a)} r={4} fill={ct.tick} stroke={ct.background} strokeWidth={2} />
                                <circle cx={geo.x(hover)} cy={geo.y(data[hover].b)} r={4} fill={ct.series1} stroke={ct.background} strokeWidth={2} />
                            </g>
                        )}
                    </svg>
                )}
                {geo && hover !== null && (
                    <div
                        className="pointer-events-none absolute top-2 z-10 rounded-lg border border-line bg-raised px-3 py-2 text-xs shadow-lg"
                        style={geo.x(hover) > width / 2 ? { right: width - geo.x(hover) + 12 } : { left: geo.x(hover) + 12 }}
                    >
                        <p className="mb-1 font-semibold text-fg">{data[hover].label}</p>
                        <p className="flex justify-between gap-4 text-fg-muted">
                            {labelA} <span className="tabular-nums text-fg">{formatMoney(data[hover].a)}</span>
                        </p>
                        <p className="flex justify-between gap-4 text-fg-muted">
                            {labelB} <span className="tabular-nums text-fg">{formatMoney(data[hover].b)}</span>
                        </p>
                    </div>
                )}
            </div>
            {caption && <figcaption className="text-[11px] text-fg-subtle">{caption}</figcaption>}
        </figure>
    );
};
