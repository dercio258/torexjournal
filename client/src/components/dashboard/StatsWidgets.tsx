import React from 'react';
import { ShieldCheck, ShieldAlert, ArrowUpRight, ArrowDownRight } from 'lucide-react';

// --- Helper para detecção visual de Win/Loss e temas do PnL Líquido ---
export const detectPnLStatus = (pnl: number) => {
    const num = Number(pnl) || 0;
    const isWin = num > 0.001;
    const isLoss = num < -0.001;

    if (isWin) {
        return {
            status: 'win' as const,
            textClass: 'text-accent-fg',
            glowColor: 'rgba(16, 185, 129, 0.16)',
            badgeBg: 'bg-accent/10 text-accent-fg',
            badgeLabel: '+ Profit',
            formattedValue: `+$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            trendIcon: ArrowUpRight,
            subtext: ''
        };
    } else if (isLoss) {
        return {
            status: 'loss' as const,
            textClass: 'text-danger-fg',
            glowColor: 'rgba(244, 63, 94, 0.16)',
            badgeBg: 'bg-danger/10 text-danger-fg',
            badgeLabel: '- Loss',
            formattedValue: `-$${Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            trendIcon: ArrowDownRight,
            subtext: ''
        };
    } else {
        return {
            status: 'neutral' as const,
            textClass: 'text-fg',
            glowColor: 'rgba(148, 163, 184, 0.05)',
            badgeBg: 'bg-surface-2 text-fg-muted',
            badgeLabel: '0.00 BE',
            formattedValue: '$0.00',
            trendIcon: null,
            subtext: ''
        };
    }
};

// --- Donut Circular de Profit Factor ---
export const ProfitFactorDonut = ({ profitFactor = 0 }: { profitFactor: number }) => {
    const size = 92;
    const strokeWidth = 7;
    const radius = (size - strokeWidth) / 2; // (92 - 7) / 2 = 42.5
    const circumference = 2 * Math.PI * radius; // ~267.035
    
    // PF = GrossProfit / GrossLoss
    // ratio = PF / (PF + 1). Se PF = 2.0 -> 2/3 = 66.7%. Se PF = 0.58 -> 36.7%. Se PF = 0 -> 0%
    const validPF = Math.max(0, Number(profitFactor) || 0);
    const profitRatio = validPF > 0 ? validPF / (validPF + 1) : 0;
    const profitStroke = profitRatio * circumference;

    const isHealthy = validPF >= 1.5;
    const isModerate = validPF >= 1.0 && validPF < 1.5;
    const statusColor = isHealthy ? 'text-accent-fg' : isModerate ? 'text-amber-600 dark:text-amber-400' : validPF > 0 ? 'text-danger-fg' : 'text-fg-muted';
    const statusText = validPF >= 1.75 ? 'Excelente' : validPF >= 1.3 ? 'Consistente' : validPF >= 1.0 ? 'Moderado' : validPF > 0 ? 'Atenção' : 'Sem dados';

    return (
        <div className="flex items-center justify-center gap-3 py-0.5">
            <div className="relative flex items-center justify-center">
                <svg width={size} height={size} className="transform -rotate-90">

                    {/* Base circle (Loss / Track) */}
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        fill="transparent"
                        stroke="currentColor"
                        strokeWidth={strokeWidth}
                        className={`transition-all duration-700 ${validPF > 0 ? 'text-data-neg' : 'text-surface-3'}`}
                    />

                    {/* Profit segment */}
                    {validPF > 0 && (
                        <circle
                            cx={size / 2}
                            cy={size / 2}
                            r={radius}
                            fill="transparent"
                            stroke="currentColor"
                            strokeWidth={strokeWidth}
                            strokeDasharray={`${profitStroke} ${circumference}`}
                            strokeDashoffset={0}
                            strokeLinecap="round"
                            className="text-data-pos transition-all duration-1000 ease-out"
                        />
                    )}
                </svg>

                {/* Center text */}
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className={`text-base sm:text-lg font-black font-mono leading-none tracking-tight ${statusColor}`}>
                        {validPF.toFixed(2)}
                    </span>
                    <span className="text-[9px] text-fg-subtle uppercase font-semibold mt-0.5">
                        PF
                    </span>
                </div>
            </div>

            {/* Side legend */}
            <div className="flex flex-col gap-1 font-mono text-[10px]">
                <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span className="flex items-center gap-1 text-fg-subtle"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-data-pos" />Ganhos:</span>
                    <span className="font-bold text-fg tabular-nums">{(profitRatio * 100).toFixed(0)}%</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                    <span className="flex items-center gap-1 text-fg-subtle"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-data-neg" />Perdas:</span>
                    <span className="font-bold text-fg tabular-nums">{(Math.max(0, 100 - profitRatio * 100)).toFixed(0)}%</span>
                </div>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded w-fit ${
                    isHealthy ? 'bg-accent/10 text-accent-fg' : isModerate ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' : 'bg-danger/10 text-danger-fg'
                }`}>
                    {statusText}
                </span>
            </div>
        </div>
    );
};

// --- Gauge Semicircular de Taxa de Acerto ---
export const WinRateGaugeChart = ({ winRate = 0 }: { winRate: number; wins?: number; losses?: number }) => {
    const width = 126;
    const height = 66;
    const strokeWidth = 9;
    const radius = 46;
    const circumference = Math.PI * radius; // ~144.51 (semi-circle)
    
    const validWinRate = Math.min(Math.max(Number(winRate) || 0, 0), 100);
    const progressStroke = (validWinRate / 100) * circumference;

    const isConsistente = validWinRate >= 50;
    const isModerate = validWinRate >= 40 && validWinRate < 50;
    const statusColor = isConsistente ? 'text-accent-fg' : isModerate ? 'text-amber-600 dark:text-amber-400' : 'text-danger-fg';
    const strokeClass = isConsistente ? 'text-data-pos' : isModerate ? 'text-amber-500' : 'text-data-neg';

    return (
        <div className="flex flex-col items-center justify-center relative py-1">
            <svg width={width} height={height} className="overflow-visible">

                {/* Base Track Arc */}
                <path
                    d="M 17 60 A 46 46 0 0 1 109 60"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    className="text-surface-3"
                />

                {/* Progress Arc */}
                <path
                    d="M 17 60 A 46 46 0 0 1 109 60"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={strokeWidth}
                    strokeDasharray={`${progressStroke} ${circumference}`}
                    strokeLinecap="round"
                    className={`transition-all duration-1000 ease-out ${strokeClass}`}
                />
            </svg>

            {/* Value Perfectly Centered Inside Gauge Arc */}
            <div className="absolute inset-0 flex items-center justify-center pt-2">
                <span className={`text-lg sm:text-xl font-bold font-mono leading-none tracking-tight ${statusColor}`}>
                    {validWinRate.toFixed(1)}%
                </span>
            </div>
        </div>
    );
};


// --- Gauge de Proporção Profit vs Loss vs BE ---
export const WinrateGauge = ({ wins = 0, losses = 0, breakeven = 0, trades = 0 }) => {
    const radius = 80;
    const stroke = 14;
    const normalizedRadius = radius - stroke;
    const circumference = normalizedRadius * Math.PI;

    const totalCalculated = wins + losses + breakeven;
    const effectiveTotal = totalCalculated || 1; // Avoid div by zero

    const winPercent = (wins / effectiveTotal);
    const bePercent = (breakeven / effectiveTotal);

    const winStroke = winPercent * circumference;
    const beStroke = bePercent * circumference;

    return (
        <div className="flex flex-col items-center justify-center relative py-3">
            <svg height={radius + 10} width={radius * 2} className="overflow-visible">
                {/* Base de LOSS / Neutro se 0 trades */}
                <path
                    d={`M ${stroke},${radius} A ${normalizedRadius},${normalizedRadius} 0 0 1 ${radius * 2 - stroke},${radius}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={stroke}
                    strokeLinecap="round"
                    className={totalCalculated === 0 ? "text-surface-3" : "text-data-neg"}
                />
                {/* Camada de BE (Amarelo) */}
                {totalCalculated > 0 && beStroke > 0 && (
                    <path
                        d={`M ${stroke},${radius} A ${normalizedRadius},${normalizedRadius} 0 0 1 ${radius * 2 - stroke},${radius}`}
                        fill="none"
                        stroke="currentColor"
                        className="text-amber-500"
                        strokeWidth={stroke}
                        strokeDasharray={`${(winStroke + beStroke)} ${circumference}`}
                        strokeLinecap="round"
                        style={{ transition: 'stroke-dasharray 1s ease-in-out' }}
                    />
                )}
                {/* Sobreposição de PROFIT (Verde) */}
                {totalCalculated > 0 && winStroke > 0 && (
                    <path
                        d={`M ${stroke},${radius} A ${normalizedRadius},${normalizedRadius} 0 0 1 ${radius * 2 - stroke},${radius}`}
                        fill="none"
                        stroke="currentColor"
                        className="text-data-pos"
                        strokeWidth={stroke}
                        strokeDasharray={`${winStroke} ${circumference}`}
                        strokeLinecap="round"
                        style={{ transition: 'stroke-dasharray 1s ease-in-out' }}
                    />
                )}
            </svg>
            <div className="absolute top-11 flex flex-col items-center">
                <span className="text-3xl font-bold text-fg leading-none tracking-tight">{trades}</span>
                <span className="text-[9px] text-fg-subtle uppercase tracking-[0.2em] font-bold mt-1">Trades</span>
                <div className="mt-2 flex items-center gap-2">
                    <div className="text-center">
                        <span className="text-[11px] text-fg font-bold block leading-none tabular-nums">{(winPercent * 100).toFixed(0)}%</span>
                        <span className="mt-0.5 flex items-center justify-center gap-1 text-[9px] text-fg-subtle uppercase"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-data-pos" />Win</span>
                    </div>
                    <div className="w-px h-4 bg-line-strong" />
                    <div className="text-center">
                        <span className="text-[11px] text-fg font-bold block leading-none tabular-nums">{(bePercent * 100).toFixed(0)}%</span>
                        <span className="mt-0.5 flex items-center justify-center gap-1 text-[9px] text-fg-subtle uppercase"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" />BE</span>
                    </div>
                    <div className="w-px h-4 bg-line-strong" />
                    <div className="text-center">
                        <span className="text-[11px] text-fg font-bold block leading-none tabular-nums">{(Math.max(0, 100 - (winPercent * 100) - (bePercent * 100))).toFixed(0)}%</span>
                        <span className="mt-0.5 flex items-center justify-center gap-1 text-[9px] text-fg-subtle uppercase"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-data-neg" />Loss</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- Barra de Performance de Ativo ---
export const InstrumentRow = ({ symbol, wins, losses }: { symbol: string, wins: number, losses: number }) => {
    const total = wins + losses;
    const winPercent = total > 0 ? (wins / total) * 100 : 0;
    return (
        <div className="flex flex-col gap-1 py-1.5 px-2 -mx-2 rounded-lg hover:bg-surface-2/60 transition-colors group">
            <div className="flex justify-between items-center text-xs">
                <div className="flex items-center gap-2">
                    <span className="font-bold text-fg tracking-tight font-mono text-[11px] bg-surface-2 border border-line px-2 py-0.5 rounded text-center min-w-[56px]">{symbol}</span>
                    <span className="text-[10px] text-fg-subtle font-mono">{total} {total === 1 ? 'trade' : 'trades'}</span>
                </div>
                <div className="flex items-center gap-2 font-mono text-[10px]">
                    <span className={`font-bold ${winPercent >= 50 ? 'text-accent-fg' : 'text-fg-muted'}`}>
                        {winPercent.toFixed(0)}%
                    </span>
                    <span className="text-fg-subtle">
                        <b className="text-accent-fg font-semibold">{wins}W</b> / <b className="text-danger-fg font-semibold">{losses}L</b>
                    </span>
                </div>
            </div>
            <div className="h-1.5 w-full bg-canvas rounded-full overflow-hidden flex">
                <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${winPercent}%` }} />
                <div className="h-full bg-rose-500 transition-all duration-500" style={{ width: `${100 - winPercent}%` }} />
            </div>
        </div>
    );
};

// --- Barra de Sessão ---
export const SessionRow = ({ name, percent, pnl = 0, active = false }: { name: string, percent: number, pnl?: number, active?: boolean }) => (
    <div className="flex flex-col gap-1 py-1.5 px-2 -mx-2 rounded-lg hover:bg-surface-2/60 transition-colors">
        <div className="flex justify-between items-center text-xs">
            <div className="flex items-center gap-1.5">
                {active && (
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping inline-block" />
                )}
                <span className={`text-[11px] font-semibold ${active ? "text-blue-400 font-bold" : "text-fg/80"}`}>
                    {name}
                </span>
                {active && (
                    <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-blue-500/10 text-blue-400">Ativa</span>
                )}
            </div>
            <div className="flex items-center gap-2.5 font-mono text-[10px]">
                <span className={`font-bold ${pnl >= 0 ? 'text-accent-fg' : 'text-danger-fg'}`}>
                    {pnl >= 0 ? '+' : ''}${pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-fg-muted font-medium">{percent.toFixed(1)}%</span>
            </div>
        </div>
        <div className="h-1.5 w-full bg-canvas rounded-full overflow-hidden">
            <div
                className={`h-full transition-all duration-700 ${active ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.4)]' : 'bg-slate-600'}`}
                style={{ width: `${percent}%` }}
            />
        </div>
    </div>
);

export const StatsContainer = ({ children }: { children: React.ReactNode }) => (
    <div className="bg-surface border border-line rounded-2xl p-5 shadow-xl w-full flex flex-col gap-4 h-full">
        {children}
    </div>
);

export const TraderHealthWidget = ({ score = 100, details = {} as any }) => {
    const getScoreColor = (s: number) => {
        if (s >= 80) return 'text-accent-fg';
        if (s >= 50) return 'text-amber-400';
        return 'text-danger-fg';
    };

    const getScoreBg = (s: number) => {
        if (s >= 80) return 'bg-emerald-500/10';
        if (s >= 50) return 'bg-amber-500/10';
        return 'bg-rose-500/10';
    };

    const titles = {
        high: "Excelente Disciplina",
        med: "Atenção Necessária",
        low: "Risco Elevado"
    };

    const title = score >= 80 ? titles.high : score >= 50 ? titles.med : titles.low;

    return (
        <div className="flex flex-col justify-between gap-3 h-full">
            <div className={`p-3.5 rounded-xl flex flex-col gap-2.5 transition-all duration-300 ${getScoreBg(score)} border border-line`}>
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        {score >= 80 ? <ShieldCheck size={16} className="text-accent-fg" /> : <ShieldAlert size={16} className={getScoreColor(score)} />}
                        <span className="text-xs font-bold text-fg">{title}</span>
                    </div>
                    <span className={`text-xl font-black font-mono tracking-tight ${getScoreColor(score)}`}>{score}</span>
                </div>

                <div className="flex flex-col gap-1">
                    <div className="h-1.5 w-full bg-canvas rounded-full overflow-hidden">
                        <div
                            className={`h-full transition-all duration-700 ease-out ${score >= 80 ? 'bg-emerald-400' : score >= 50 ? 'bg-amber-400' : 'bg-rose-400'}`}
                            style={{ width: `${score}%` }}
                        />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-0.5">
                    <div className="bg-canvas-subtle border border-line p-2 rounded-lg">
                        <span className="block text-[9px] text-fg-muted uppercase font-semibold tracking-wider">Alertas Ativos</span>
                        <span className="text-xs font-bold font-mono text-fg">{details.totalAlerts || 0}</span>
                    </div>
                    <div className="bg-canvas-subtle border border-line p-2 rounded-lg">
                        <span className="block text-[9px] text-fg-muted uppercase font-semibold tracking-wider">Severidade</span>
                        <span className={`text-xs font-bold font-mono ${details.penalties?.critical > 0 ? 'text-danger-fg' : 'text-accent-fg'}`}>
                            {details.penalties?.critical > 0 ? 'Crítica' : 'Estável'}
                        </span>
                    </div>
                </div>
            </div>

            <button
                onClick={() => window.location.href = '/reports'}
                className="w-full py-2.5 bg-surface-2 hover:bg-surface-3 border border-line hover:border-[rgba(16,185,129,0.3)] text-fg/80 hover:text-fg text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5 active:scale-95 mt-auto"
            >
                Ver Relatório Comportamental
            </button>
        </div>
    );
};

