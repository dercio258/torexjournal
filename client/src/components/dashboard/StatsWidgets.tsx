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
            badgeLabel: 'Resultado positivo',
            formattedValue: `+$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            trendIcon: ArrowUpRight,
            subtext: 'Lucro líquido acumulado'
        };
    } else if (isLoss) {
        return {
            status: 'loss' as const,
            textClass: 'text-danger-fg',
            glowColor: 'rgba(244, 63, 94, 0.16)',
            badgeBg: 'bg-danger/10 text-danger-fg',
            badgeLabel: 'Resultado negativo',
            formattedValue: `-$${Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            trendIcon: ArrowDownRight,
            subtext: 'Prejuízo líquido no período'
        };
    } else {
        return {
            status: 'neutral' as const,
            textClass: 'text-fg',
            glowColor: 'rgba(148, 163, 184, 0.05)',
            badgeBg: 'bg-surface-2 text-fg-muted',
            badgeLabel: 'Neutro (0.00)',
            formattedValue: '$0.00',
            trendIcon: null,
            subtext: 'Sem variação no período'
        };
    }
};

// --- Donut Circular de Profit Factor (Sem micro-badges redundantes) ---
export const ProfitFactorDonut = ({ profitFactor = 0 }: { profitFactor: number }) => {
    const size = 84;
    const strokeWidth = 7;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;

    const validPF = Math.max(0, Number(profitFactor) || 0);
    const profitRatio = validPF > 0 ? validPF / (validPF + 1) : 0;
    const profitStroke = profitRatio * circumference;

    const isHealthy = validPF >= 1.5;
    const isModerate = validPF >= 1.0 && validPF < 1.5;
    const statusColor = isHealthy
        ? 'text-accent-fg'
        : isModerate
          ? 'text-amber-600 dark:text-amber-400'
          : validPF > 0
            ? 'text-danger-fg'
            : 'text-fg-muted';

    const displayPF = validPF >= 99 ? '99+' : validPF.toFixed(2);

    return (
        <div className="flex items-center justify-between gap-4 w-full py-1">
            <div className="flex flex-col">
                <span className={`text-2xl sm:text-[28px] font-bold tabular-nums tracking-tight leading-none ${statusColor}`}>
                    {displayPF}
                </span>
                <div className="mt-2.5 flex flex-col gap-1 text-xs tabular-nums">
                    <div className="flex items-center gap-1.5 text-fg-muted">
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-data-pos shrink-0" />
                        <span>Ganhos:</span>
                        <span className="font-semibold text-fg">{(profitRatio * 100).toFixed(0)}%</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-fg-muted">
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-data-neg shrink-0" />
                        <span>Perdas:</span>
                        <span className="font-semibold text-fg">{(Math.max(0, 100 - profitRatio * 100)).toFixed(0)}%</span>
                    </div>
                </div>
            </div>

            <div className="relative flex items-center justify-center shrink-0">
                <svg width={size} height={size} className="transform -rotate-90">
                    {/* Base circle (Loss / Track) */}
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        fill="transparent"
                        stroke="currentColor"
                        strokeWidth={strokeWidth}
                        className={`transition-all duration-700 ${validPF > 0 ? 'text-data-neg/80' : 'text-surface-3'}`}
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

                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                        PF
                    </span>
                </div>
            </div>
        </div>
    );
};

// --- Indicador de Taxa de Acerto Limpo e Proporcional ---
export const WinRateGaugeChart = ({
    winRate = 0,
    wins = 0,
    losses = 0,
}: {
    winRate: number;
    wins?: number;
    losses?: number;
}) => {
    const validWinRate = Math.min(Math.max(Number(winRate) || 0, 0), 100);
    const totalDecided = (Number(wins) || 0) + (Number(losses) || 0);

    const isConsistente = validWinRate >= 50;
    const isModerate = validWinRate >= 40 && validWinRate < 50;
    const statusColor = isConsistente
        ? 'text-accent-fg'
        : isModerate
          ? 'text-amber-600 dark:text-amber-400'
          : totalDecided > 0
            ? 'text-danger-fg'
            : 'text-fg';
    const barFill = isConsistente
        ? 'bg-data-pos'
        : isModerate
          ? 'bg-amber-500'
          : 'bg-data-neg';

    return (
        <div className="flex flex-col justify-between w-full gap-3 py-1">
            <div className="flex items-baseline justify-between gap-2">
                <span className={`text-2xl sm:text-[28px] font-bold tabular-nums tracking-tight leading-none ${statusColor}`}>
                    {validWinRate.toFixed(1)}%
                </span>
                <span className="text-xs text-fg-subtle tabular-nums">
                    {wins}W · {losses}L
                </span>
            </div>

            <div className="space-y-1.5">
                <div className="h-2 w-full rounded-full bg-surface-3 overflow-hidden">
                    <div
                        className={`h-full rounded-full transition-all duration-700 ease-out ${barFill}`}
                        style={{ width: `${validWinRate}%` }}
                    />
                </div>
                <div className="flex items-center justify-between text-[11px] text-fg-subtle">
                    <span>Meta: 50%</span>
                    <span className="tabular-nums">
                        {totalDecided > 0 ? `${wins} de ${totalDecided} positivos` : 'Sem trades fechados'}
                    </span>
                </div>
            </div>
        </div>
    );
};

// --- Indicador de Distribuição de Trades (Win / BE / Loss) ---
export const WinrateGauge = ({ wins = 0, losses = 0, breakeven = 0, trades = 0 }) => {
    const totalCalculated = wins + losses + breakeven;
    const effectiveTotal = totalCalculated || 1;

    const winPercent = (wins / effectiveTotal) * 100;
    const bePercent = (breakeven / effectiveTotal) * 100;
    const lossPercent = Math.max(0, 100 - winPercent - bePercent);

    return (
        <div className="flex flex-col justify-between w-full gap-3 py-1">
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-2xl sm:text-[28px] font-bold text-fg tabular-nums tracking-tight leading-none">
                    {trades}
                </span>
                <span className="text-xs text-fg-subtle">
                    {trades === 1 ? 'operação' : 'operações'}
                </span>
            </div>

            <div className="space-y-2">
                {/* Barra horizontal segmentada proporcional */}
                <div className="h-2 w-full rounded-full bg-surface-3 overflow-hidden flex gap-0.5">
                    {totalCalculated > 0 ? (
                        <>
                            {winPercent > 0 && (
                                <div
                                    className="h-full bg-data-pos transition-all duration-700"
                                    style={{ width: `${winPercent}%` }}
                                />
                            )}
                            {bePercent > 0 && (
                                <div
                                    className="h-full bg-amber-500 transition-all duration-700"
                                    style={{ width: `${bePercent}%` }}
                                />
                            )}
                            {lossPercent > 0 && (
                                <div
                                    className="h-full bg-data-neg transition-all duration-700"
                                    style={{ width: `${lossPercent}%` }}
                                />
                            )}
                        </>
                    ) : (
                        <div className="h-full w-full bg-surface-3" />
                    )}
                </div>

                {/* Legenda compacta sem poluição */}
                <div className="flex items-center justify-between text-[11px] text-fg-muted tabular-nums">
                    <span className="inline-flex items-center gap-1">
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-data-pos" />
                        <strong className="font-semibold text-fg">{winPercent.toFixed(0)}%</strong> Win
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        <strong className="font-semibold text-fg">{bePercent.toFixed(0)}%</strong> BE
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-data-neg" />
                        <strong className="font-semibold text-fg">{lossPercent.toFixed(0)}%</strong> Loss
                    </span>
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
                    <span className="font-semibold text-fg tracking-tight text-[11px] bg-surface-2 border border-line px-2 py-0.5 rounded text-center min-w-[56px]">{symbol}</span>
                    <span className="text-[11px] text-fg-subtle tabular-nums">{total} {total === 1 ? 'trade' : 'trades'}</span>
                </div>
                <div className="flex items-center gap-2 tabular-nums text-[11px]">
                    <span className={`font-semibold ${winPercent >= 50 ? 'text-accent-fg' : 'text-fg-muted'}`}>
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
            </div>
            <div className="flex items-center gap-2.5 tabular-nums text-[11px]">
                <span className={`font-semibold ${pnl >= 0 ? 'text-accent-fg' : 'text-danger-fg'}`}>
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
                    <span className={`text-xl font-bold tabular-nums tracking-tight ${getScoreColor(score)}`}>{score}</span>
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
                        <span className="text-xs font-bold tabular-nums text-fg">{details.totalAlerts || 0}</span>
                    </div>
                    <div className="bg-canvas-subtle border border-line p-2 rounded-lg">
                        <span className="block text-[9px] text-fg-muted uppercase font-semibold tracking-wider">Severidade</span>
                        <span className={`text-xs font-bold ${details.penalties?.critical > 0 ? 'text-danger-fg' : 'text-accent-fg'}`}>
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
