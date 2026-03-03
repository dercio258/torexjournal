
import { useMemo } from 'react';
import { Radar } from 'lucide-react';

interface RadarProps {
    data: {
        consistency: number;
        riskManagement: number;
        discipline: number;
        profitability: number;
        winRate: number;
    };
}

export const PerformanceRadar = ({ data }: RadarProps) => {
    // Configuration
    const size = 300;
    const center = size / 2;
    const radius = 100; // max radius
    const levels = 5; // 20, 40, 60, 80, 100

    const axes = [
        { key: 'consistency', label: 'Consistência' },
        { key: 'riskManagement', label: 'Gestão de Risco' },
        { key: 'discipline', label: 'Disciplina' },
        { key: 'profitability', label: 'Lucratividade' },
        { key: 'winRate', label: 'Taxa de Acerto' },
    ];

    // Helpers to calculate points
    const angleSlice = (Math.PI * 2) / axes.length;

    const getPoint = (value: number, index: number, scale = 1) => {
        const val = (value / 100) * radius * scale;
        // Rotate -90deg to start from top
        const angle = index * angleSlice - Math.PI / 2;
        return {
            x: center + val * Math.cos(angle),
            y: center + val * Math.sin(angle)
        };
    };

    // Construct Grid Background (Concentric Polygons)
    const gridPolygons = useMemo(() => {
        return Array.from({ length: levels }).map((_, i) => {
            const level = i + 1;
            const factor = level / levels;
            const points = axes.map((_, idx) => {
                const { x, y } = getPoint(100, idx, factor);
                return `${x},${y}`;
            }).join(' ');
            return { points };
        });
    }, []);

    // Construct Axis Lines
    const axisLines = useMemo(() => {
        return axes.map((_, i) => {
            return {
                x1: center, y1: center,
                x2: getPoint(100, i).x, y2: getPoint(100, i).y,
                labelPos: getPoint(100, i, 1.35),
                label: axes[i].label
            };
        });
    }, []);

    // Construct Data Polygon
    const dataPoints = axes.map((axis, i) => {
        const val = data ? (data as any)[axis.key] || 0 : 0;
        return getPoint(val, i);
    });

    const dataPath = dataPoints.map(p => `${p.x},${p.y}`).join(' ');

    return (
        <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 relative overflow-hidden flex flex-col h-full shadow-lg hover:border-slate-700 transition-colors duration-500">
            {/* Header */}
            <div className="flex justify-between items-center mb-2 z-10">
                <h3 className="font-bold text-slate-100 flex items-center gap-2 text-sm uppercase tracking-wider">
                    <Radar className="text-emerald-400" size={18} /> Performance Radar
                </h3>
            </div>

            {/* Ambient Glow */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-emerald-500/10 rounded-full blur-[50px] pointer-events-none" />

            {/* SVG Chart */}
            <div className="flex-1 flex items-center justify-center relative z-10 min-h-[300px]">
                <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full max-w-[350px]">
                    {/* Grid Levels */}
                    {gridPolygons.map(({ points }, i) => (
                        <polygon
                            key={`grid-${i}`}
                            points={points}
                            fill="none"
                            stroke="#334155" // slate-700
                            strokeWidth="1"
                            strokeDasharray="4 4"
                            className="opacity-30"
                        />
                    ))}

                    {/* Axis Lines & Labels */}
                    {axisLines.map((line, i) => (
                        <g key={`axis-${i}`}>
                            <line
                                x1={line.x1} y1={line.y1}
                                x2={line.x2} y2={line.y2}
                                stroke="#334155"
                                strokeWidth="1"
                                className="opacity-30"
                            />
                            {/* Labels */}
                            <text
                                x={line.labelPos.x}
                                y={line.labelPos.y}
                                fill="#94a3b8" // slate-400
                                fontSize="10"
                                fontWeight="600"
                                textAnchor="middle"
                                dominantBaseline="middle"
                                className="uppercase tracking-widest"
                            >
                                {line.label}
                            </text>

                            {/* Axis Value Indicators (0, 50, 100) - Optional */}
                        </g>
                    ))}

                    {/* Data Polygon */}
                    <g className="animate-in zoom-in duration-1000 ease-out origin-center">
                        {/* Fill Gradient Def */}
                        <defs>
                            <radialGradient id="radarGradient" cx="0.5" cy="0.5" r="0.5">
                                <stop offset="0%" stopColor="#10b981" stopOpacity="0.4" />
                                <stop offset="100%" stopColor="#10b981" stopOpacity="0.1" />
                            </radialGradient>
                            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                                <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                                <feMerge>
                                    <feMergeNode in="coloredBlur" />
                                    <feMergeNode in="SourceGraphic" />
                                </feMerge>
                            </filter>
                        </defs>

                        <polygon
                            points={dataPath}
                            fill="url(#radarGradient)"
                            stroke="#10b981"
                            strokeWidth="2"
                            filter="url(#glow)"
                            className="drop-shadow-[0_0_10px_rgba(16,185,129,0.5)]"
                        />

                        {/* Data Points (Dots) */}
                        {dataPoints.map((p, i) => (
                            <circle
                                key={`dot-${i}`}
                                cx={p.x}
                                cy={p.y}
                                r="3"
                                fill="#0f172a" // slate-900 background
                                stroke="#10b981"
                                strokeWidth="2"
                                className="hover:r-4 transition-all"
                            />
                        ))}
                    </g>
                </svg>
            </div>

            <div className="text-xs text-center text-slate-500 mt-2">
                Score Geral: <span className="text-emerald-400 font-bold">88/100</span>
            </div>
        </div>
    );
};
