import React, { useState, useMemo } from 'react';
import { TrendingUp, AlertCircle } from 'lucide-react';

interface PnLChartProps {
    data: { date: string; value: number; ticket?: number | string }[];
}

export const DailyPnLChart: React.FC<PnLChartProps> = ({ data = [] }) => {
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

    // Chart Dimensions & Padding
    const width = 800;
    const height = 340;
    const padding = { top: 30, right: 35, bottom: 42, left: 78 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Prepared Data (minimum 2 points to draw line if single point)
    const chartData = useMemo(() => {
        if (!Array.isArray(data) || data.length === 0) return [];
        if (data.length === 1) {
            return [
                { date: data[0].date, value: 0, ticket: undefined },
                data[0]
            ];
        }
        return data;
    }, [data]);

    // KPI Metrics for Header
    const summaryMetrics = useMemo(() => {
        if (!data || data.length === 0) {
            return { total: 0, maxWin: 0, maxLoss: 0, count: 0 };
        }
        let total = 0;
        let maxWin = 0;
        let maxLoss = 0;

        data.forEach(d => {
            const v = Number(d.value) || 0;
            total += v;
            if (v > maxWin) maxWin = v;
            if (v < maxLoss) maxLoss = v;
        });

        return { total, maxWin, maxLoss, count: data.length };
    }, [data]);

    // Scales & Round Y-Axis Ticks (Strictly Symmetric Zero-Centered Scale)
    const { scaleMin, scaleMax, yTicks, zeroY } = useMemo(() => {
        const centerZeroY = padding.top + chartHeight / 2;

        if (chartData.length === 0) {
            return {
                scaleMin: -100,
                scaleMax: 100,
                yTicks: [-100, -50, 0, 50, 100],
                zeroY: centerZeroY
            };
        }

        const values = chartData.map(d => Number(d.value) || 0);
        const maxAbs = Math.max(...values.map(v => Math.abs(v)), 5);

        // Add 15% headroom above the highest absolute peak/trough
        const targetLimit = Math.max(maxAbs * 1.15, 10);

        // Target clean steps with 5 to 7 total ticks (2 to 3 steps each side of zero)
        const rawStep = targetLimit / 2.2;
        const power = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
        const fraction = rawStep / power;

        let niceStep = power;
        if (fraction >= 7.0) niceStep = 10 * power;
        else if (fraction >= 3.0) niceStep = 5 * power;
        else if (fraction >= 1.5) niceStep = 2 * power;
        else niceStep = power;

        const numSteps = Math.max(Math.ceil(targetLimit / niceStep), 2);
        const limit = numSteps * niceStep;

        // Generate ticks symmetrically from -limit to +limit
        const ticks: number[] = [];
        for (let v = -limit; v <= limit + 1e-6; v += niceStep) {
            ticks.push(Math.round(v * 100) / 100);
        }

        return {
            scaleMin: -limit,
            scaleMax: limit,
            yTicks: ticks,
            zeroY: centerZeroY
        };
    }, [chartData, padding.top, chartHeight]);

    // Coordinate Mapping (Symmetric around zeroY = padding.top + chartHeight / 2)
    const getY = (value: number) => {
        const pct = (value - scaleMin) / (scaleMax - scaleMin || 1);
        return padding.top + chartHeight - (pct * chartHeight);
    };

    const getX = (index: number) => {
        const count = chartData.length;
        if (count <= 1) return padding.left + chartWidth / 2;
        return padding.left + (index / (count - 1)) * chartWidth;
    };

    // Calculate Points
    const points = useMemo(() => {
        return chartData.map((d, i) => ({
            x: getX(i),
            y: getY(d.value),
            value: Number(d.value) || 0,
            date: d.date,
            ticket: d.ticket
        }));
    }, [chartData, scaleMax, scaleMin]);

    // Path Line (Polyline)
    const pathD = useMemo(() => {
        if (points.length <= 1) return '';
        return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
    }, [points]);

    // Area Fill (Closed to Zero Line)
    const areaD = useMemo(() => {
        if (points.length <= 1) return '';
        const first = points[0];
        const last = points[points.length - 1];
        return `${pathD} L ${last.x.toFixed(2)},${zeroY.toFixed(2)} L ${first.x.toFixed(2)},${zeroY.toFixed(2)} Z`;
    }, [pathD, points, zeroY]);

    // Formatters
    const formatYTick = (val: number) => {
        if (Math.abs(val) < 1e-6) return '$0.00';
        const abs = Math.abs(val);
        const prefix = val < 0 ? '-$' : '+$';
        if (abs >= 1000000) return `${prefix}${(abs / 1000000).toFixed(1)}M`;
        if (abs >= 1000) return `${prefix}${(abs / 1000).toFixed(abs % 1000 === 0 ? 0 : 1)}k`;
        return `${prefix}${abs.toFixed(0)}`;
    };

    const formatDateLabel = (str: string) => {
        if (!str) return '';
        // If string contains space (e.g. "14/06 14:30"), grab date part
        const parts = str.split(' ');
        return parts[0];
    };

    // Selected X-Axis Milestones to avoid label overlapping
    const xMilestoneIndices = useMemo(() => {
        const count = points.length;
        if (count <= 1) return [0];
        if (count <= 6) return points.map((_, i) => i);

        const targetCount = 6;
        const step = (count - 1) / (targetCount - 1);
        const indices = new Set<number>();
        indices.add(0);
        for (let i = 1; i < targetCount - 1; i++) {
            indices.add(Math.round(i * step));
        }
        indices.add(count - 1);
        return Array.from(indices).sort((a, b) => a - b);
    }, [points]);

    // Empty State Check
    if (!data || data.length === 0) {
        return (
            <div className="bg-transparent w-full h-full flex flex-col justify-between font-sans">
                <div className="flex justify-between items-center mb-3">
                    <h3 className="font-semibold text-fg flex items-center gap-2 text-xs tracking-wider uppercase font-mono">
                        <TrendingUp className="text-accent-fg" size={15} /> Performance Diária de PnL
                    </h3>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border border-dashed border-line rounded-xl my-2">
                    <AlertCircle className="w-8 h-8 text-slate-600 mb-2" />
                    <p className="text-xs text-fg-muted font-mono">Nenhuma operação registrada no período selecionado</p>
                    <p className="text-[11px] text-slate-600 mt-1">Sincronize sua conta ou adicione trades para visualizar a curva de resultado.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-transparent w-full relative overflow-hidden flex flex-col h-full font-sans justify-between select-none">
            {/* Header: Title, Net Period PnL & High-contrast Badges */}
            <div className="flex flex-wrap justify-between items-center gap-2 mb-2">
                <div className="flex items-center gap-2.5">
                    <h3 className="font-semibold text-fg flex items-center gap-2 text-xs tracking-wider uppercase font-sans">
                        <TrendingUp className="text-accent-fg" size={15} /> Performance Diária de PnL
                    </h3>
                    <span className={`text-xs font-mono tabular-nums font-bold px-2.5 py-0.5 rounded border ${
                        summaryMetrics.total >= 0
                            ? 'bg-emerald-500/10 text-accent-fg border-emerald-500/20'
                            : 'bg-rose-500/10 text-danger-fg border-rose-500/20'
                    }`}>
                        Total: {summaryMetrics.total >= 0 ? '+' : '-'}${Math.abs(summaryMetrics.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                </div>

                {/* KPI Badges & Clean Legend */}
                <div className="flex items-center gap-3 text-[11px] font-sans">
                    {summaryMetrics.maxWin > 0 && (
                        <span className="text-fg-muted hidden sm:inline">
                            Máx Win: <strong className="text-accent-fg font-mono tabular-nums font-semibold">+${summaryMetrics.maxWin.toFixed(2)}</strong>
                        </span>
                    )}
                    {summaryMetrics.maxLoss < 0 && (
                        <span className="text-fg-muted hidden sm:inline">
                            Máx Loss: <strong className="text-danger-fg font-mono tabular-nums font-semibold">-${Math.abs(summaryMetrics.maxLoss).toFixed(2)}</strong>
                        </span>
                    )}
                    <div className="flex items-center gap-2 pl-1 border-l border-line">
                        <span className="flex items-center gap-1 text-accent-fg font-medium font-sans">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Lucro
                        </span>
                        <span className="flex items-center gap-1 text-danger-fg font-medium font-sans">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" /> Prejuízo
                        </span>
                    </div>
                </div>
            </div>

            {/* Main Chart Canvas */}
            <div className="flex-1 w-full relative min-h-[240px]">
                <svg
                    viewBox={`0 0 ${width} ${height}`}
                    className="w-full h-full overflow-visible"
                    preserveAspectRatio="none"
                >
                    <defs>
                        {/* Clip rect strictly above the zero line (Positive Performance Zone) */}
                        <clipPath id="clipAboveZero">
                            <rect
                                x={padding.left}
                                y={0}
                                width={width - padding.left}
                                height={zeroY}
                            />
                        </clipPath>

                        {/* Clip rect strictly below the zero line (Negative Drawdown Zone) */}
                        <clipPath id="clipBelowZero">
                            <rect
                                x={padding.left}
                                y={zeroY}
                                width={width - padding.left}
                                height={height - zeroY}
                            />
                        </clipPath>

                        {/* Pure Green Area Gradient for Above Zero */}
                        <linearGradient
                            id="greenAreaGradient"
                            x1="0"
                            y1={padding.top}
                            x2="0"
                            y2={zeroY}
                            gradientUnits="userSpaceOnUse"
                        >
                            <stop offset="0%" stopColor="#10b981" stopOpacity="0.26" />
                            <stop offset="85%" stopColor="#10b981" stopOpacity="0.04" />
                            <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                        </linearGradient>

                        {/* Pure Red Area Gradient for Below Zero */}
                        <linearGradient
                            id="redAreaGradient"
                            x1="0"
                            y1={zeroY}
                            x2="0"
                            y2={padding.top + chartHeight}
                            gradientUnits="userSpaceOnUse"
                        >
                            <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.0" />
                            <stop offset="15%" stopColor="#f43f5e" stopOpacity="0.04" />
                            <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.26" />
                        </linearGradient>

                        {/* Stroke Gradient in User Space: strictly emerald above zero, rose below zero */}
                        <linearGradient
                            id="pnlStrokeGradient"
                            x1="0"
                            y1={padding.top}
                            x2="0"
                            y2={padding.top + chartHeight}
                            gradientUnits="userSpaceOnUse"
                        >
                            <stop offset="0%" stopColor="#10b981" />
                            <stop offset="49.8%" stopColor="#10b981" />
                            <stop offset="50.2%" stopColor="#f43f5e" />
                            <stop offset="100%" stopColor="#f43f5e" />
                        </linearGradient>
                    </defs>

                    {/* Horizontal Grid Lines (Only for non-zero ticks) */}
                    {yTicks.map((tickVal) => {
                        const isZero = Math.abs(tickVal) < 1e-6;
                        if (isZero) return null;
                        const y = getY(tickVal);

                        return (
                            <line
                                key={tickVal}
                                x1={padding.left}
                                y1={y}
                                x2={width - padding.right}
                                y2={y}
                                stroke="rgba(255, 255, 255, 0.06)"
                                strokeWidth="1"
                                strokeDasharray="3 3"
                            />
                        );
                    })}

                    {/* Area Fills: Guaranteed Emerald Above Zero, Rose Red Below Zero */}
                    {areaD && (
                        <>
                            <g clipPath="url(#clipAboveZero)">
                                <path
                                    d={areaD}
                                    fill="url(#greenAreaGradient)"
                                />
                            </g>
                            <g clipPath="url(#clipBelowZero)">
                                <path
                                    d={areaD}
                                    fill="url(#redAreaGradient)"
                                />
                            </g>
                        </>
                    )}

                    {/* Central Zero Baseline Reference Line */}
                    <line
                        x1={padding.left}
                        y1={zeroY}
                        x2={width - padding.right}
                        y2={zeroY}
                        stroke="rgba(255, 255, 255, 0.38)"
                        strokeWidth="1.75"
                    />

                    {/* Main Line Stroke */}
                    {pathD && (
                        <path
                            d={pathD}
                            fill="none"
                            stroke="url(#pnlStrokeGradient)"
                            strokeWidth="2.25"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    )}

                    {/* Bottom Axis Baseline Line */}
                    <line
                        x1={padding.left}
                        y1={height - padding.bottom}
                        x2={width - padding.right}
                        y2={height - padding.bottom}
                        stroke="rgba(255, 255, 255, 0.12)"
                        strokeWidth="1"
                    />

                    {/* Y-Axis Labels */}
                    {yTicks.map((tickVal) => {
                        const y = getY(tickVal);
                        const isZero = Math.abs(tickVal) < 1e-6;

                        return (
                            <text
                                key={tickVal}
                                x={padding.left - 12}
                                y={y}
                                fill={isZero ? "#ffffff" : "#cbd5e1"}
                                fontSize={isZero ? "12.5" : "11.5"}
                                fontWeight={isZero ? "700" : "500"}
                                textAnchor="end"
                                dominantBaseline="middle"
                                className="font-mono tabular-nums tracking-tight"
                            >
                                {formatYTick(tickVal)}
                            </text>
                        );
                    })}

                    {/* X-Axis Date Labels & Ticks (Strictly aligned with point coordinates) */}
                    {xMilestoneIndices.map((idx, posIndex) => {
                        const p = points[idx];
                        if (!p) return null;

                        let textAnchor: "start" | "end" | "middle" = "middle";
                        if (posIndex === 0) textAnchor = "start";
                        else if (posIndex === xMilestoneIndices.length - 1) textAnchor = "end";

                        return (
                            <g key={idx}>
                                {/* Tick notch */}
                                <line
                                    x1={p.x}
                                    y1={height - padding.bottom}
                                    x2={p.x}
                                    y2={height - padding.bottom + 5}
                                    stroke="rgba(255, 255, 255, 0.2)"
                                    strokeWidth="1"
                                />

                                {/* Date text */}
                                <text
                                    x={p.x}
                                    y={height - padding.bottom + 20}
                                    fill="#cbd5e1"
                                    fontSize="11.5"
                                    fontWeight="500"
                                    textAnchor={textAnchor}
                                    className="font-mono tabular-nums tracking-tight"
                                >
                                    {formatDateLabel(p.date)}
                                </text>
                            </g>
                        );
                    })}

                    {/* Hover Crosshairs (Vertical & Horizontal) */}
                    {hoveredIndex !== null && points[hoveredIndex] && (
                        <g pointerEvents="none">
                            {/* Vertical Crosshair */}
                            <line
                                x1={points[hoveredIndex].x}
                                y1={padding.top}
                                x2={points[hoveredIndex].x}
                                y2={height - padding.bottom}
                                stroke="rgba(255, 255, 255, 0.25)"
                                strokeWidth="1"
                                strokeDasharray="3 3"
                            />

                            {/* Horizontal Guideline to Axis */}
                            <line
                                x1={padding.left}
                                y1={points[hoveredIndex].y}
                                x2={points[hoveredIndex].x}
                                y2={points[hoveredIndex].y}
                                stroke="rgba(255, 255, 255, 0.18)"
                                strokeWidth="1"
                                strokeDasharray="2 2"
                            />
                        </g>
                    )}

                    {/* Interactive Points Hit Boxes */}
                    {points.map((p, i) => {
                        const isWin = p.value > 0;
                        const isLoss = p.value < 0;
                        const pointColor = isWin ? '#10b981' : isLoss ? '#f43f5e' : '#cbd5e1';

                        return (
                            <g
                                key={i}
                                onMouseEnter={() => setHoveredIndex(i)}
                                onMouseLeave={() => setHoveredIndex(null)}
                            >
                                {/* Broad transparent hit area */}
                                <rect
                                    x={p.x - Math.max(chartWidth / (points.length * 2), 6)}
                                    y={padding.top}
                                    width={Math.max(chartWidth / points.length, 12)}
                                    height={chartHeight}
                                    fill="transparent"
                                    className="cursor-crosshair"
                                />

                                {/* Active Point Highlight */}
                                {hoveredIndex === i ? (
                                    <g pointerEvents="none">
                                        <circle
                                            cx={p.x}
                                            cy={p.y}
                                            r={6}
                                            fill="#08090C"
                                            stroke={pointColor}
                                            strokeWidth="2.5"
                                        />
                                        <circle
                                            cx={p.x}
                                            cy={p.y}
                                            r={2.5}
                                            fill={pointColor}
                                        />
                                    </g>
                                ) : (
                                    <circle
                                        cx={p.x}
                                        cy={p.y}
                                        r={2.25}
                                        fill={pointColor}
                                        opacity={0.85}
                                    />
                                )}
                            </g>
                        );
                    })}

                    {/* Tooltip Card (Clamped within SVG bounds) */}
                    {hoveredIndex !== null && points[hoveredIndex] && (() => {
                        const p = points[hoveredIndex];
                        const isWin = p.value > 0;
                        const isLoss = p.value < 0;
                        const statusText = isWin ? "LUCRO" : isLoss ? "PREJUÍZO" : "NEUTRO";
                        const statusColor = isWin ? "#34d399" : isLoss ? "#fb7185" : "#cbd5e1";
                        const borderColor = isWin ? "rgba(16, 185, 129, 0.55)" : isLoss ? "rgba(244, 63, 94, 0.55)" : "rgba(255, 255, 255, 0.3)";
                        const tipWidth = 175;
                        const tipHeight = 60;

                        // Position clamping
                        const tipX = p.x > width - tipWidth - 30 ? p.x - tipWidth - 12 : p.x + 12;
                        const tipY = Math.max(padding.top + 2, Math.min(p.y - tipHeight / 2, height - padding.bottom - tipHeight - 2));

                        return (
                            <g transform={`translate(${tipX}, ${tipY})`} pointerEvents="none">
                                {/* Tooltip Container */}
                                <rect
                                    x="0"
                                    y="0"
                                    width={tipWidth}
                                    height={tipHeight}
                                    rx="8"
                                    fill="#090b10"
                                    stroke={borderColor}
                                    strokeWidth="1.25"
                                    className="shadow-2xl"
                                />

                                {/* Row 1: Date & Status Badge */}
                                <text
                                    x="12"
                                    y="20"
                                    fill="#cbd5e1"
                                    fontSize="11"
                                    fontWeight="500"
                                    className="font-mono tabular-nums"
                                >
                                    {p.date}
                                </text>

                                <text
                                    x={tipWidth - 12}
                                    y="20"
                                    fill={statusColor}
                                    fontSize="10"
                                    fontWeight="700"
                                    textAnchor="end"
                                    className="font-sans uppercase tracking-wider"
                                >
                                    {statusText}
                                </text>

                                {/* Row 2: Formatted Value */}
                                <text
                                    x="12"
                                    y="46"
                                    fill="#f8fafc"
                                    fontSize="17"
                                    fontWeight="700"
                                    className="font-mono tabular-nums tracking-tight"
                                >
                                    {p.value > 0 ? '+' : p.value < 0 ? '-' : ''}${Math.abs(p.value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </text>

                                {/* Row 2 Right: Ticket (if available) */}
                                {p.ticket && (
                                    <text
                                        x={tipWidth - 12}
                                        y="46"
                                        fill="#94a3b8"
                                        fontSize="10"
                                        fontWeight="500"
                                        textAnchor="end"
                                        className="font-mono tabular-nums"
                                    >
                                        #{p.ticket}
                                    </text>
                                )}
                            </g>
                        );
                    })()}
                </svg>
            </div>
        </div>
    );
};
