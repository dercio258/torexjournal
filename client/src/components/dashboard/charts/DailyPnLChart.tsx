import { useState, useMemo } from 'react';
import { TrendingUp } from 'lucide-react';

interface PnLChartProps {
    data: { date: string; value: number; ticket?: number }[];
}

export const DailyPnLChart = ({ data }: PnLChartProps) => {
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

    // Config
    const width = 800; // Increased resolution
    const height = 400; // Increased resolution
    const padding = { top: 40, right: 30, bottom: 40, left: 60 }; // More padding for labels
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Scales - Dynamic (Flexible)
    const values = data.map(d => d.value);
    const dataMax = Math.max(...values, 0);
    const dataMin = Math.min(...values, 0);

    // Add 10% padding
    const range = dataMax - dataMin;
    const maxVal = dataMax + (range * 0.1) || 100; // Default to 100 if range is 0
    const minVal = dataMin - (range * 0.1);

    // Zero Line Y - calculation must happen before points are derived
    const getY = (value: number) => {
        // Map minVal...maxVal to height...0
        const percentage = (value - minVal) / (maxVal - minVal);
        return padding.top + chartHeight - (percentage * chartHeight);
    };
    const zeroY = getY(0);

    // Path Construction (Area & Line)
    const chartData = useMemo(() => {
        // If only one data point, add a "start" point at 0 to draw a line
        if (data.length === 1) {
            return [
                { date: 'Inicio', value: 0 },
                data[0]
            ];
        }
        return data;
    }, [data]);

    const getX = (index: number) => {
        const count = chartData.length;
        if (count <= 1) return padding.left + chartWidth / 2;
        return padding.left + (index / (count - 1)) * chartWidth;
    };

    const points = useMemo(() => {
        return chartData.map((d, i) => ({
            x: getX(i),
            y: getY(d.value),
            value: d.value,
            date: d.date,
            ticket: d.ticket
        }));
    }, [chartData, maxVal, minVal]);

    const pathD = useMemo(() => {
        if (points.length === 0) return '';
        if (points.length === 1) {
            return '';
        }
        const d = points.map((p, i) => {
            // Rigid/Polyline style (L commands)
            return `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`;
        }).join(' ');
        return d;
    }, [points]);

    // Area Path
    const areaD = useMemo(() => {
        if (points.length <= 1) return '';
        const first = points[0];
        const last = points[points.length - 1];

        return `${pathD} L ${last.x},${zeroY} L ${first.x},${zeroY} Z`;
    }, [pathD, points, zeroY]);

    // Gradient Offset Calculation
    const gradientOffset = () => {
        if (maxVal <= 0) return 0;
        if (minVal >= 0) return 1;
        return maxVal / (maxVal - minVal);
    };

    const off = gradientOffset();

    return (
        <div className="bg-[#080a0c] border border-slate-800 rounded-lg p-6 relative overflow-hidden flex flex-col h-full shadow-lg hover:border-slate-700 transition-colors duration-500 group font-mono uppercase tracking-widest">
            {/* Header */}
            <div className="flex justify-between items-center mb-6">
                <h3 className="font-bold text-slate-100 flex items-center gap-2 text-xs tracking-widest">
                    <TrendingUp className="text-emerald-500" size={16} /> P&L TRACKER
                </h3>
                <div className="flex gap-4">
                     <div className="flex items-center gap-1.5 text-[10px] text-emerald-500 font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> PROFIT
                    </div>
                     <div className="flex items-center gap-1.5 text-[10px] text-rose-500 font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span> LOSS
                    </div>
                </div>
            </div>

            {/* Chart */}
            <div className="flex-1 w-full relative min-h-[250px] cursor-crosshair">
                <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
                    <defs>
                        <linearGradient id="splitGradient" x1="0" y1="0" x2="0" y2="1">
                            {/* Profit Area (Green) */}
                            <stop offset={0} stopColor="#10b981" stopOpacity="0.15" />
                            <stop offset={off} stopColor="#10b981" stopOpacity="0" />
                            
                            {/* Loss Area (Red) */}
                            <stop offset={off} stopColor="#f43f5e" stopOpacity="0" />
                            <stop offset={1} stopColor="#f43f5e" stopOpacity="0.15" />
                        </linearGradient>
                         <linearGradient id="splitStroke" x1="0" y1="0" x2="0" y2="1">
                            <stop offset={0} stopColor="#10b981" stopOpacity="1" />
                            <stop offset={off} stopColor="#10b981" stopOpacity="1" />
                            <stop offset={off} stopColor="#f43f5e" stopOpacity="1" />
                            <stop offset={1} stopColor="#f43f5e" stopOpacity="1" />
                        </linearGradient>
                    </defs>

                    {/* Grid Lines (Rigid/Technical) */}
                    {[0, 0.25, 0.5, 0.75, 1].map(t => {
                        const y = padding.top + t * chartHeight;
                        return (
                            <line
                                key={t}
                                x1={padding.left} y1={y} x2={width - padding.right} y2={y}
                                stroke="#1e293b" strokeWidth="1" strokeDasharray="2 2" strokeOpacity="0.4"
                            />
                        );
                    })}

                    {/* Zero Line - Highlighted */}
                    <line
                        x1={padding.left} y1={zeroY} x2={width - padding.right} y2={zeroY}
                        stroke="#475569" strokeWidth="1" strokeDasharray="4 4" strokeOpacity="0.6"
                    />

                    {/* Left Axis Labels - HFT Style */}
                    {[maxVal, maxVal * 0.75, (maxVal + minVal) / 2, minVal * 0.75, minVal].map((val, i) => (
                        <text
                            key={i}
                            x={padding.left - 15}
                            y={getY(val)}
                            fill="#64748b"
                            fontSize="9"
                            textAnchor="end"
                            dominantBaseline="middle"
                            className="font-mono tracking-tighter"
                        >
                            {Math.abs(val) >= 1000 ? `${(val / 1000).toFixed(1)}k` : val.toFixed(0)}
                        </text>
                    ))}

                    {/* Area Fill */}
                    <path
                        d={areaD}
                        fill="url(#splitGradient)"
                        className="animate-in fade-in duration-1000"
                    />

                    {/* Line Stroke - Polyline Style (Rigid) */}
                    <path
                        d={pathD}
                        fill="none"
                        stroke="url(#splitStroke)"
                        strokeWidth="1.5"
                        strokeLinecap="square"
                        strokeLinejoin="miter"
                        className="drop-shadow-[0_0_8px_rgba(16,185,129,0.1)]"
                    />

                    {/* Interactive Points - High Density Optimization */}
                    {points.map((p, i) => (
                        <g key={i}
                            onMouseEnter={() => setHoveredIndex(i)}
                            onMouseLeave={() => setHoveredIndex(null)}
                        >
                            {/* Hit Area (Larger Rect for interaction) */}
                            <rect 
                                x={p.x - 6} y={padding.top} 
                                width="12" height={height - padding.bottom - padding.top} 
                                fill="transparent" 
                                className="cursor-crosshair"
                            />
                            
                            {/* Visible Square Dot (HFT/Technical feel) */}
                            <rect
                                x={p.x - (hoveredIndex === i ? 3 : 1.5)}
                                y={p.y - (hoveredIndex === i ? 3 : 1.5)}
                                width={hoveredIndex === i ? 6 : 3}
                                height={hoveredIndex === i ? 6 : 3}
                                fill={p.value >= 0 ? '#10b981' : '#f43f5e'}
                                className={`transition-all duration-75 ${hoveredIndex === i ? 'opacity-100' : 'opacity-80'}`}
                            />

                            {/* Vertical Crosshair Line on Hover */}
                            {hoveredIndex === i && (
                                <line 
                                    x1={p.x} y1={padding.top} 
                                    x2={p.x} y2={height - padding.bottom} 
                                    stroke="#334155" strokeWidth="1" strokeDasharray="2 2"
                                />
                            )}
                        </g>
                    ))}

                    {/* Binary Tooltip - Industrial Style */}
                    {hoveredIndex !== null && (
                        <g transform={`translate(${Math.min(points[hoveredIndex].x, width - 150)}, ${Math.max(padding.top, Math.min(points[hoveredIndex].y - 50, height - 80))})`}>
                            {/* Tooltip Bg - Sharp corners */}
                            <rect
                                x="0" y="0" width="140" height="55"
                                fill="#0f172a" 
                                stroke={points[hoveredIndex].value >= 0 ? "#10b981" : "#f43f5e"} 
                                strokeWidth="1"
                                className="drop-shadow-2xl opacity-95"
                            />
                            
                            {/* Status Label */}
                            <text
                                x="10" y="18"
                                fill={points[hoveredIndex].value >= 0 ? "#10b981" : "#f43f5e"}
                                fontSize="9"
                                fontWeight="bold"
                                className="tracking-widest uppercase font-mono"
                            >
                                {points[hoveredIndex].value >= 0 ? "PROFIT STATUS" : "LOSS STATUS"}
                            </text>

                            {/* Value */}
                            <text
                                x="10" y="40"
                                fill="#e2e8f0"
                                fontSize="16"
                                fontWeight="bold"
                                className="tracking-widest font-mono"
                            >
                                ${points[hoveredIndex].value.toFixed(2)}
                            </text>

                             {/* Ticket */}
                             <text
                                x="130" y="18"
                                fill="#64748b"
                                fontSize="9"
                                textAnchor="end"
                                className="font-mono"
                            >
                                #{points[hoveredIndex].ticket}
                            </text>
                            
                            {/* Date */}
                             <text
                                x="130" y="40"
                                fill="#475569"
                                fontSize="9"
                                textAnchor="end"
                                className="font-mono"
                            >
                                {points[hoveredIndex].date.split(' ')[1] || points[hoveredIndex].date}
                            </text>
                        </g>
                    )}
                </svg>

                {/* X Axis Labels - Technical/Minimal */}
                <div className="absolute bottom-0 left-[60px] right-[30px] flex justify-between text-[9px] text-slate-600 font-mono pt-2 border-t border-slate-800/50 uppercase tracking-wider">
                    {data.filter((_, i) => i === 0 || i === data.length - 1 || i % Math.ceil(data.length / 5) === 0).map((d, i) => (
                        <span key={i}>{d.date.split(' ')[0]}</span>
                    ))}
                </div>
            </div>
        </div>
    );
};
