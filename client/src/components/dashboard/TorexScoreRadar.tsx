import React, { useState } from 'react';
import { BookOpen, Info } from 'lucide-react';
import { cn } from '../../lib/cn';
import { ChartCard } from '../charts/ChartCard';

export interface TorexRadarMetrics {
    consistency: number;
    riskManagement: number;
    discipline: number;
    profitability: number;
    winRate: number;
    profitFactorScore?: number;
}

export interface TorexRadarMeta {
    usedJournalSignals: boolean;
    annotatedTrades: number;
    annotatedDays: number;
    sources: {
        consistency: 'legacy' | 'blended';
        riskManagement: 'legacy' | 'blended';
        discipline: 'legacy' | 'blended';
    };
    tips: string[];
}

interface TorexScoreRadarProps {
    data: TorexRadarMetrics;
    torexScore?: number;
    meta?: TorexRadarMeta;
    locale?: 'pt' | 'en';
    className?: string;
}

interface RadarAxis {
    key: keyof TorexRadarMetrics;
    labelPt: string;
    labelEn: string;
    angleDeg: number;
}

const AXES: RadarAxis[] = [
    { key: 'profitability', labelPt: 'Lucratividade', labelEn: 'Profitability', angleDeg: -90 },
    { key: 'consistency', labelPt: 'Consistência', labelEn: 'Consistency', angleDeg: -30 },
    { key: 'discipline', labelPt: 'Disciplina', labelEn: 'Discipline', angleDeg: 30 },
    { key: 'winRate', labelPt: 'Taxa de acerto', labelEn: 'Win Rate', angleDeg: 90 },
    { key: 'profitFactorScore', labelPt: 'Fator de lucro', labelEn: 'Profit Factor', angleDeg: 150 },
    { key: 'riskManagement', labelPt: 'Gestão de risco', labelEn: 'Risk Mgmt', angleDeg: -150 },
];

const RINGS = [0.25, 0.5, 0.75, 1];
const TICKS = [0, 20, 40, 60, 80, 100];

const CX = 190;
const CY = 104;
const RADIUS = 64;

const polarToCartesian = (angleDeg: number, radius: number) => {
    const rad = (angleDeg * Math.PI) / 180;
    return {
        x: CX + radius * Math.cos(rad),
        y: CY + radius * Math.sin(rad),
    };
};

const hexagonPoints = (fraction: number) =>
    AXES.map(a => {
        const pt = polarToCartesian(a.angleDeg, RADIUS * fraction);
        return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
    }).join(' ');

export const TorexScoreRadar: React.FC<TorexScoreRadarProps> = ({
    data,
    torexScore,
    meta,
    locale = 'pt',
    className,
}) => {
    const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
    const isEn = locale === 'en';

    const isAxisBlended = (key: keyof TorexRadarMetrics) => {
        if (!meta?.usedJournalSignals || !meta?.sources) return false;
        if (key === 'consistency') return meta.sources.consistency === 'blended';
        if (key === 'riskManagement') return meta.sources.riskManagement === 'blended';
        if (key === 'discipline') return meta.sources.discipline === 'blended';
        return false;
    };

    const values = AXES.map(axis => {
        const raw =
            axis.key === 'profitFactorScore'
                ? data?.profitFactorScore ?? data?.profitability ?? 0
                : data?.[axis.key] ?? 0;
        return Math.max(0, Math.min(100, Math.round(Number(raw) || 0)));
    });

    const computedFallbackScore =
        values[0] * 0.2 +
        values[1] * 0.2 +
        values[5] * 0.2 +
        values[2] * 0.15 +
        values[3] * 0.125 +
        values[4] * 0.125;

    const finalScore =
        torexScore !== undefined && Number.isFinite(Number(torexScore)) && Number(torexScore) > 0
            ? Math.max(0, Math.min(100, Number(torexScore)))
            : Math.max(0, Math.min(100, computedFallbackScore));

    const hasAnyValue = values.some(v => v > 0);

    const scoreStatus =
        finalScore >= 70
            ? { label: isEn ? 'Consistent' : 'Consistente', tone: 'text-accent-fg' }
            : finalScore >= 45
              ? { label: isEn ? 'Moderate' : 'Moderado', tone: 'text-warning' }
              : { label: isEn ? 'Developing' : 'Em evolução', tone: 'text-fg-muted' };

    const dataVertices = AXES.map((axis, idx) => {
        const ratio = hasAnyValue ? Math.max(0.06, values[idx] / 100) : 0.05;
        return polarToCartesian(axis.angleDeg, RADIUS * ratio);
    });

    const polygonPoints = dataVertices.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

    return (
        <ChartCard
            className={cn('h-full justify-between hover:border-line-strong transition-colors', className)}
            title={isEn ? 'Torex Edge Score' : 'Score Operacional'}
            icon={
                <span
                    title={
                        isEn
                            ? meta?.usedJournalSignals
                                ? 'Composite edge index (0–100) blending trade execution history with real Journal annotations.'
                                : 'Composite edge index weighting Profitability, Consistency, Risk Management, Discipline, Win Rate, and Profit Factor (0–100).'
                            : meta?.usedJournalSignals
                              ? 'Índice composto (0–100) combinando histórico de trades com sinais reais preenchidos no Diário. Campos ausentes nunca assumem zero e preservam o cálculo clássico.'
                              : 'Índice composto ponderando Lucratividade, Consistência, Gestão de Risco, Disciplina, Taxa de Acerto e Fator de Lucro (0–100).'
                    }
                    className="inline-flex cursor-help text-fg-subtle hover:text-fg"
                >
                    <Info size={13} />
                </span>
            }
            actions={
                <div className="flex items-center gap-1.5">
                    {meta?.usedJournalSignals && (
                        <span
                            title={
                                isEn
                                    ? `Enriched with Journal notes (${meta.annotatedTrades} trade(s), ${meta.annotatedDays} day(s)).`
                                    : meta.tips && meta.tips.length > 0
                                      ? meta.tips.join(' • ')
                                      : `Enriquecido com anotações do Diário (${meta.annotatedTrades} trade(s), ${meta.annotatedDays} dia(s)).`
                            }
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-accent/25 bg-accent/10 text-[10px] font-semibold text-accent-fg cursor-help"
                        >
                            <BookOpen size={10} />
                            <span>{isEn ? 'Journal' : 'Diário'}</span>
                        </span>
                    )}
                    <span
                        className={cn(
                            'px-2 py-0.5 rounded-md border border-line bg-canvas-subtle text-[11px] font-semibold',
                            scoreStatus.tone
                        )}
                    >
                        {scoreStatus.label}
                    </span>
                </div>
            }
        >
            <div className="flex flex-1 flex-col justify-between min-h-[212px]">
                {/* Hexagonal 6-Axis Radar */}
                <div className="relative flex flex-1 items-center justify-center w-full">
                    <svg
                        viewBox="0 0 380 204"
                        className="w-full max-w-[340px] h-[170px] select-none overflow-visible"
                        role="img"
                        aria-label={
                            isEn
                                ? `Torex Journal Edge Radar: overall score ${finalScore.toFixed(2)} out of 100`
                                : `Radar Torex Journal: pontuação geral ${finalScore.toFixed(2)} de 100`
                        }
                    >
                        {/* Concentric Hexagonal Web Rings */}
                        {RINGS.slice()
                            .reverse()
                            .map((r, i) => (
                                <polygon
                                    key={r}
                                    points={hexagonPoints(r)}
                                    className={cn(
                                        i === 0 ? 'fill-canvas-subtle/75 stroke-line-strong' : 'fill-none stroke-line'
                                    )}
                                    strokeWidth={1}
                                />
                            ))}

                        {/* Radial Spokes */}
                        {AXES.map(axis => {
                            const outer = polarToCartesian(axis.angleDeg, RADIUS);
                            return (
                                <line
                                    key={axis.key}
                                    x1={CX}
                                    y1={CY}
                                    x2={outer.x}
                                    y2={outer.y}
                                    className="stroke-line"
                                    strokeWidth={1}
                                />
                            );
                        })}

                        {/* Data Polygon */}
                        <polygon
                            points={polygonPoints}
                            className="fill-data-radar/30 stroke-data-radar transition-all duration-500"
                            strokeWidth={2}
                            strokeLinejoin="round"
                        />

                        {/* Vertex Markers + Outer Labels */}
                        {AXES.map((axis, idx) => {
                            const pt = dataVertices[idx];
                            const labelPos = polarToCartesian(axis.angleDeg, RADIUS + 13);
                            const isTop = axis.angleDeg === -90;
                            const isBottom = axis.angleDeg === 90;
                            const isRight = axis.angleDeg === -30 || axis.angleDeg === 30;
                            const textAnchor = isTop || isBottom ? 'middle' : isRight ? 'start' : 'end';
                            const isHovered = hoveredIdx === idx;
                            const val = values[idx];
                            const blended = isAxisBlended(axis.key);
                            const axisLabel = isEn ? axis.labelEn : axis.labelPt;

                            const labelY = isTop ? labelPos.y - 8 : isBottom ? labelPos.y + 3 : labelPos.y - 3;

                            return (
                                <g
                                    key={axis.key}
                                    className="cursor-pointer"
                                    onMouseEnter={() => setHoveredIdx(idx)}
                                    onMouseLeave={() => setHoveredIdx(null)}
                                >
                                    <title>
                                        {isEn
                                            ? `${axisLabel}: ${val}/100 (${blended ? 'Execution + Journal' : 'Execution Metrics'})`
                                            : `${axisLabel}: ${val}/100 (${blended ? 'Histórico + Diário' : 'Cálculo operacional clássico'})`}
                                    </title>
                                    <circle cx={pt.x} cy={pt.y} r={14} fill="transparent" />

                                    <circle
                                        cx={pt.x}
                                        cy={pt.y}
                                        r={isHovered ? 4.6 : 3}
                                        strokeWidth={2}
                                        className={cn(
                                            'stroke-surface transition-all duration-150',
                                            isHovered ? 'fill-accent-fg' : 'fill-data-radar'
                                        )}
                                    />

                                    <text
                                        x={labelPos.x}
                                        y={labelY}
                                        textAnchor={textAnchor}
                                        className={cn(
                                            'text-[10px] font-semibold transition-colors',
                                            isHovered ? 'fill-fg' : 'fill-fg-muted'
                                        )}
                                    >
                                        {axisLabel}
                                    </text>
                                    <text
                                        x={labelPos.x}
                                        y={labelY + 11.5}
                                        textAnchor={textAnchor}
                                        className={cn(
                                            'text-[9.5px] font-mono tabular-nums font-semibold transition-colors',
                                            isHovered ? 'fill-accent-fg' : 'fill-fg-subtle'
                                        )}
                                    >
                                        {val}/100
                                    </text>
                                </g>
                            );
                        })}
                    </svg>
                </div>

                {/* Footer: TOREX JOURNAL Score + 0..100 Spectral Scale */}
                <div className="pt-2 border-t border-line space-y-1.5">
                    <div className="flex items-center justify-between gap-3">
                        <div className="shrink-0">
                            <span className="block text-[9.5px] font-bold uppercase tracking-wider text-fg-muted leading-none">
                                Torex Journal
                            </span>
                            <span className="mt-0.5 block text-lg sm:text-xl font-bold tabular-nums tracking-tight text-fg leading-none">
                                {finalScore.toFixed(2)}
                            </span>
                        </div>

                        <div className="flex-1 max-w-[215px]">
                            <div className="relative h-2 w-full rounded-full bg-surface-3">
                                <div
                                    className="absolute inset-0 rounded-full opacity-90"
                                    style={{
                                        background:
                                            'linear-gradient(90deg, rgb(var(--ds-data-neg)) 0%, rgb(var(--ds-warning)) 48%, rgb(var(--ds-data-pos)) 100%)',
                                    }}
                                />
                                <span
                                    aria-hidden
                                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-fg border-2 border-surface shadow-md transition-all duration-500"
                                    style={{ left: `${finalScore}%` }}
                                />
                            </div>

                            <div className="mt-1 flex items-center justify-between text-[9px] font-mono tabular-nums text-fg-subtle">
                                {TICKS.map(tick => (
                                    <span key={tick}>{tick}</span>
                                ))}
                            </div>
                        </div>
                    </div>

                    {!isEn && meta?.usedJournalSignals && meta.tips && meta.tips.length > 0 && (
                        <p className="text-[10.5px] text-fg-subtle truncate" title={meta.tips.join(' • ')}>
                            {meta.tips[0]}
                        </p>
                    )}
                </div>
            </div>
        </ChartCard>
    );
};
