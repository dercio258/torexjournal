import React from 'react';
import { ShieldCheck, ShieldAlert, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { getCurrentLocale } from '../../context/LocaleContext';

export type DashboardWidgetLocale = 'pt' | 'en';

// --- Helper para detecção visual de Win/Loss e temas do PnL Líquido ---
export const detectPnLStatus = (pnl: number, locale: DashboardWidgetLocale = 'pt') => {
    const num = Number(pnl) || 0;
    const isWin = num > 0.001;
    const isLoss = num < -0.001;
    const isEn = locale === 'en';

    if (isWin) {
        return {
            status: 'win' as const,
            textClass: 'text-accent-fg',
            glowColor: 'rgba(16, 185, 129, 0.16)',
            badgeBg: 'bg-accent/10 text-accent-fg',
            badgeLabel: isEn ? 'Net Profit' : 'Resultado positivo',
            formattedValue: `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            trendIcon: ArrowUpRight,
            subtext: isEn ? 'Cumulative net P&L' : 'Lucro líquido acumulado',
        };
    } else if (isLoss) {
        return {
            status: 'loss' as const,
            textClass: 'text-danger-fg',
            glowColor: 'rgba(244, 63, 94, 0.16)',
            badgeBg: 'bg-danger/10 text-danger-fg',
            badgeLabel: isEn ? 'Net Loss' : 'Resultado negativo',
            formattedValue: `-$${Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            trendIcon: ArrowDownRight,
            subtext: isEn ? 'Period net drawdown' : 'Prejuízo líquido no período',
        };
    } else {
        return {
            status: 'neutral' as const,
            textClass: 'text-fg',
            glowColor: 'rgba(148, 163, 184, 0.05)',
            badgeBg: 'bg-surface-2 text-fg-muted',
            badgeLabel: isEn ? 'Flat (0.00)' : 'Neutro (0.00)',
            formattedValue: '$0.00',
            trendIcon: null,
            subtext: isEn ? 'Breakeven in period' : 'Sem variação no período',
        };
    }
};

const formatAvgDollar = (amount: number, negative = false) => {
    const abs = Math.abs(Number(amount) || 0);
    if (abs === 0) return negative ? '-$0' : '$0';
    const formatted =
        abs >= 100
            ? Math.round(abs).toLocaleString('en-US')
            : abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${negative ? '-' : ''}$${formatted}`;
};

// --- Gauge Semicircular de Win Rate / Taxa de Acerto (Wins / BE / Losses + 3 Contadores) ---
export const SemiCircleWinRateGauge = ({
    winRate = 0,
    wins = 0,
    breakeven = 0,
    losses = 0,
    locale = 'pt',
}: {
    winRate: number;
    wins?: number;
    breakeven?: number;
    losses?: number;
    locale?: DashboardWidgetLocale;
}) => {
    const w = Math.max(0, Number(wins) || 0);
    const be = Math.max(0, Number(breakeven) || 0);
    const l = Math.max(0, Number(losses) || 0);
    const total = w + be + l;

    const preciseRate = total > 0 ? (w / total) * 100 : Math.min(Math.max(Number(winRate) || 0, 0), 100);

    // Semicircle path from (9, 46) to (91, 46) with radius R = 41
    const R = 41;
    const arcLen = Math.PI * R; // ~128.805

    const activeSegments = [w > 0, be > 0, l > 0].filter(Boolean).length;
    const gapPx = activeSegments > 1 ? 2.2 : 0;
    const totalGaps = activeSegments > 1 ? (activeSegments - 1) * gapPx : 0;
    const drawableLen = Math.max(0, arcLen - totalGaps);

    const wLen = total > 0 ? (w / total) * drawableLen : 0;
    const beLen = total > 0 ? (be / total) * drawableLen : 0;
    const lLen = total > 0 ? (l / total) * drawableLen : 0;

    const beOffset = wLen + (w > 0 && (be > 0 || l > 0) ? gapPx : 0);
    const lOffset = beOffset + beLen + (be > 0 && l > 0 ? gapPx : 0);

    return (
        <div className="flex items-center justify-between gap-1.5 sm:gap-2.5 w-full min-w-0">
            <div className="flex flex-col justify-between min-w-0">
                <span className="text-[10px] sm:text-[10.5px] font-bold uppercase tracking-wider text-fg-muted truncate">
                    {locale === 'en' ? 'Win Rate' : 'Taxa de Acerto'}
                </span>
                <span className="mt-1.5 text-lg sm:text-[22px] font-bold tabular-nums tracking-tight leading-none text-fg">
                    {preciseRate.toFixed(2)}%
                </span>
            </div>

            <div className="flex flex-col items-center shrink-0">
                <svg viewBox="0 0 100 52" className="w-[68px] h-[35px] sm:w-[88px] sm:h-[45px] overflow-visible" aria-hidden>
                    {/* Base Track */}
                    <path
                        d="M 9 46 A 41 41 0 0 1 91 46"
                        fill="none"
                        strokeWidth={7}
                        strokeLinecap="round"
                        className="stroke-surface-3"
                    />

                    {total > 0 && (
                        <>
                            {wLen > 0 && (
                                <path
                                    d="M 9 46 A 41 41 0 0 1 91 46"
                                    fill="none"
                                    strokeWidth={7}
                                    strokeLinecap={activeSegments === 1 ? 'round' : 'butt'}
                                    strokeDasharray={`${wLen} ${arcLen * 2}`}
                                    strokeDashoffset={0}
                                    className="stroke-data-pos transition-all duration-700 ease-out"
                                />
                            )}
                            {beLen > 0 && (
                                <path
                                    d="M 9 46 A 41 41 0 0 1 91 46"
                                    fill="none"
                                    strokeWidth={7}
                                    strokeLinecap={activeSegments === 1 ? 'round' : 'butt'}
                                    strokeDasharray={`${beLen} ${arcLen * 2}`}
                                    strokeDashoffset={-beOffset}
                                    className="stroke-data-1 transition-all duration-700 ease-out"
                                />
                            )}
                            {lLen > 0 && (
                                <path
                                    d="M 9 46 A 41 41 0 0 1 91 46"
                                    fill="none"
                                    strokeWidth={7}
                                    strokeLinecap={activeSegments === 1 ? 'round' : 'butt'}
                                    strokeDasharray={`${lLen} ${arcLen * 2}`}
                                    strokeDashoffset={-lOffset}
                                    className="stroke-data-neg transition-all duration-700 ease-out"
                                />
                            )}
                        </>
                    )}
                </svg>

                {/* 3 Contadores (Wins · BE · Losses) */}
                <div className="flex items-center justify-between w-[68px] sm:w-[88px] -mt-0.5 px-0.5">
                    <span
                        title={`${w} Wins`}
                        className="min-w-[17px] sm:min-w-[20px] px-1 py-0.5 rounded-full bg-data-pos/15 border border-data-pos/30 text-accent-fg text-[8.5px] sm:text-[9.5px] font-bold tabular-nums text-center leading-none"
                    >
                        {w}
                    </span>
                    <span
                        title={`${be} Breakeven`}
                        className="min-w-[16px] sm:min-w-[18px] px-1 py-0.5 rounded-full bg-data-1/15 border border-data-1/30 text-data-1 text-[8.5px] sm:text-[9.5px] font-bold tabular-nums text-center leading-none"
                    >
                        {be}
                    </span>
                    <span
                        title={`${l} Losses`}
                        className="min-w-[17px] sm:min-w-[20px] px-1 py-0.5 rounded-full bg-data-neg/15 border border-data-neg/30 text-danger-fg text-[8.5px] sm:text-[9.5px] font-bold tabular-nums text-center leading-none"
                    >
                        {l}
                    </span>
                </div>
            </div>
        </div>
    );
};

// --- Card de W/L Average (Payoff + Barra Dupla Avg Win vs Avg Loss) ---
export const WinLossAverageWidget = ({
    avgWin = 0,
    avgLoss = 0,
    payoffRatio = 0,
    locale = 'pt',
}: {
    avgWin: number;
    avgLoss: number;
    payoffRatio: number;
    locale?: DashboardWidgetLocale;
}) => {
    const validWin = Math.max(0, Number(avgWin) || 0);
    const validLoss = Math.max(0, Math.abs(Number(avgLoss) || 0));
    const sum = validWin + validLoss;
    const winPct = sum > 0 ? (validWin / sum) * 100 : 50;
    const lossPct = sum > 0 ? 100 - winPct : 50;

    const validRatio = Math.max(0, Number(payoffRatio) || 0);
    const displayRatio = validRatio >= 99 ? '99+' : validRatio.toFixed(2);
    const isEn = locale === 'en';

    return (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 w-full min-w-0">
            <div className="flex flex-col justify-between shrink-0">
                <span className="text-[10px] sm:text-[10.5px] font-bold uppercase tracking-wider text-fg-muted truncate">
                    {isEn ? 'Avg Win / Loss' : 'W/L Average'}
                </span>
                <span className="mt-1 sm:mt-1.5 text-lg sm:text-[22px] font-bold tabular-nums tracking-tight leading-none text-fg">
                    {displayRatio}
                </span>
            </div>

            <div className="flex-1 w-full sm:max-w-[152px] flex flex-col justify-end sm:pt-2 min-w-0">
                <div className="h-1.5 w-full rounded-full bg-surface-3 overflow-hidden flex gap-[2px]">
                    {sum > 0 ? (
                        <>
                            {winPct > 0 && (
                                <div
                                    className="h-full bg-data-pos rounded-l-full transition-all duration-700 ease-out"
                                    style={{ width: `${winPct}%` }}
                                />
                            )}
                            {lossPct > 0 && (
                                <div
                                    className="h-full bg-data-neg rounded-r-full transition-all duration-700 ease-out"
                                    style={{ width: `${lossPct}%` }}
                                />
                            )}
                        </>
                    ) : (
                        <div className="h-full w-full bg-surface-3" />
                    )}
                </div>

                <div className="mt-1 sm:mt-1.5 flex items-center justify-between gap-1.5 text-[10px] sm:text-[11px] font-semibold tabular-nums">
                    <span
                        className="text-accent-fg truncate"
                        title={isEn ? 'Average winning trade' : 'Ganho médio por trade vencedor'}
                    >
                        {formatAvgDollar(validWin, false)}
                    </span>
                    <span
                        className="text-danger-fg truncate"
                        title={isEn ? 'Average losing trade' : 'Perda média por trade perdedor'}
                    >
                        {formatAvgDollar(validLoss, true)}
                    </span>
                </div>
            </div>
        </div>
    );
};

// --- Donut Circular Limpo de Profit Factor ---
export const ProfitFactorDonut = ({
    profitFactor = 0,
    totalTrades = 0,
    locale = 'pt',
}: {
    profitFactor: number;
    totalTrades?: number;
    locale?: DashboardWidgetLocale;
}) => {
    const size = 48;
    const strokeWidth = 5.5;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;

    const validPF = Math.max(0, Number(profitFactor) || 0);
    const hasActivity = validPF > 0 || totalTrades > 0;
    const profitRatio = validPF > 0 ? Math.min(0.96, validPF / (validPF + 1)) : 0;
    const profitStroke = profitRatio * circumference;

    const displayPF = validPF >= 99 ? '99+' : validPF.toFixed(2);

    return (
        <div className="flex items-center justify-between gap-2 sm:gap-2.5 w-full min-w-0">
            <div className="flex flex-col justify-between min-w-0">
                <span className="text-[10px] sm:text-[10.5px] font-bold uppercase tracking-wider text-fg-muted truncate">
                    {locale === 'en' ? 'Profit Factor' : 'Fator de Lucro'}
                </span>
                <span className="mt-1.5 text-lg sm:text-[22px] font-bold tabular-nums tracking-tight leading-none text-fg">
                    {displayPF}
                </span>
            </div>

            <div className="relative flex items-center justify-center shrink-0">
                <svg
                    viewBox={`0 0 ${size} ${size}`}
                    className="w-10 h-10 sm:w-12 sm:h-12 transform -rotate-90"
                    aria-hidden
                >
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        fill="transparent"
                        stroke="currentColor"
                        strokeWidth={strokeWidth}
                        className={`transition-all duration-700 ${
                            hasActivity ? 'text-data-neg/85' : 'text-surface-3'
                        }`}
                    />

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
            </div>
        </div>
    );
};

// --- Legacy Exports Mantidos por Compatibilidade ---
export const WinRateGaugeChart = ({
    winRate = 0,
    wins = 0,
    losses = 0,
}: {
    winRate: number;
    wins?: number;
    losses?: number;
}) => <SemiCircleWinRateGauge winRate={winRate} wins={wins} losses={losses} breakeven={0} />;

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
                <span className="text-xs text-fg-subtle">{trades === 1 ? 'operação' : 'operações'}</span>
            </div>
            <div className="h-2 w-full rounded-full bg-surface-3 overflow-hidden flex gap-0.5">
                {totalCalculated > 0 ? (
                    <>
                        {winPercent > 0 && <div className="h-full bg-data-pos" style={{ width: `${winPercent}%` }} />}
                        {bePercent > 0 && <div className="h-full bg-warning" style={{ width: `${bePercent}%` }} />}
                        {lossPercent > 0 && <div className="h-full bg-data-neg" style={{ width: `${lossPercent}%` }} />}
                    </>
                ) : (
                    <div className="h-full w-full bg-surface-3" />
                )}
            </div>
        </div>
    );
};

export const InstrumentRow = ({ symbol, wins, losses }: { symbol: string; wins: number; losses: number }) => {
    const total = wins + losses;
    const winPercent = total > 0 ? (wins / total) * 100 : 0;
    return (
        <div className="flex flex-col gap-1 py-1.5 px-2 -mx-2 rounded-lg hover:bg-surface-2/60 transition-colors group">
            <div className="flex justify-between items-center text-xs">
                <div className="flex items-center gap-2">
                    <span className="font-semibold text-fg tracking-tight text-[11px] bg-surface-2 border border-line px-2 py-0.5 rounded text-center min-w-[56px]">
                        {symbol}
                    </span>
                    <span className="text-[11px] text-fg-subtle tabular-nums">
                        {total} {total === 1 ? 'trade' : 'trades'}
                    </span>
                </div>
                <div className="flex items-center gap-2 tabular-nums text-[11px]">
                    <span className={`font-semibold ${winPercent >= 50 ? 'text-accent-fg' : 'text-fg-muted'}`}>
                        {winPercent.toFixed(0)}%
                    </span>
                    <span className="text-fg-subtle">
                        <b className="text-accent-fg font-semibold">{wins}W</b> /{' '}
                        <b className="text-danger-fg font-semibold">{losses}L</b>
                    </span>
                </div>
            </div>
            <div className="h-1.5 w-full bg-canvas rounded-full overflow-hidden flex">
                <div className="h-full bg-data-pos transition-all duration-500" style={{ width: `${winPercent}%` }} />
                <div
                    className="h-full bg-data-neg transition-all duration-500"
                    style={{ width: `${100 - winPercent}%` }}
                />
            </div>
        </div>
    );
};

export const SessionRow = ({
    name,
    percent,
    pnl = 0,
    active = false,
}: {
    name: string;
    percent: number;
    pnl?: number;
    active?: boolean;
}) => (
    <div className="flex flex-col gap-1 py-1.5 px-2 -mx-2 rounded-lg hover:bg-surface-2/60 transition-colors">
        <div className="flex justify-between items-center text-xs">
            <div className="flex items-center gap-1.5">
                {active && <span className="w-1.5 h-1.5 rounded-full bg-data-1 animate-ping inline-block" />}
                <span className={`text-[11px] font-semibold ${active ? 'text-data-1 font-bold' : 'text-fg/80'}`}>
                    {name}
                </span>
            </div>
            <div className="flex items-center gap-2.5 tabular-nums text-[11px]">
                <span className={`font-semibold ${pnl >= 0 ? 'text-accent-fg' : 'text-danger-fg'}`}>
                    {pnl >= 0 ? '+' : ''}$
                    {pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-fg-muted font-medium">{percent.toFixed(1)}%</span>
            </div>
        </div>
        <div className="h-1.5 w-full bg-canvas rounded-full overflow-hidden">
            <div
                className={`h-full transition-all duration-700 ${active ? 'bg-data-1' : 'bg-surface-3'}`}
                style={{ width: `${percent}%` }}
            />
        </div>
    </div>
);

export const StatsContainer = ({ children }: { children: React.ReactNode }) => (
    <div className="bg-surface border border-line rounded-2xl p-5 shadow-panel w-full flex flex-col gap-4 h-full">
        {children}
    </div>
);

export const TraderHealthWidget = ({ score = 100, details = {} as any, locale }: { score?: number; details?: any; locale?: DashboardWidgetLocale }) => {
    const isEn = (locale ?? getCurrentLocale()) === 'en';
    const getScoreColor = (s: number) => {
        if (s >= 80) return 'text-accent-fg';
        if (s >= 50) return 'text-warning';
        return 'text-danger-fg';
    };

    const getScoreBg = (s: number) => {
        if (s >= 80) return 'bg-accent/10';
        if (s >= 50) return 'bg-warning/10';
        return 'bg-danger/10';
    };

    const title = score >= 80
        ? (isEn ? 'Optimal Discipline' : 'Excelente Disciplina')
        : score >= 50
            ? (isEn ? 'Caution Advised' : 'Atenção Necessária')
            : (isEn ? 'Elevated Risk' : 'Risco Elevado');

    return (
        <div className="flex flex-col justify-between gap-3 h-full">
            <div
                className={`p-3.5 rounded-xl flex flex-col gap-2.5 transition-all duration-300 ${getScoreBg(score)} border border-line`}
            >
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        {score >= 80 ? (
                            <ShieldCheck size={16} className="text-accent-fg" />
                        ) : (
                            <ShieldAlert size={16} className={getScoreColor(score)} />
                        )}
                        <span className="text-xs font-bold text-fg">{title}</span>
                    </div>
                    <span className={`text-xl font-bold tabular-nums tracking-tight ${getScoreColor(score)}`}>
                        {score}
                    </span>
                </div>

                <div className="h-1.5 w-full bg-canvas rounded-full overflow-hidden">
                    <div
                        className={`h-full transition-all duration-700 ease-out ${
                            score >= 80 ? 'bg-data-pos' : score >= 50 ? 'bg-warning' : 'bg-data-neg'
                        }`}
                        style={{ width: `${score}%` }}
                    />
                </div>

                <div className="grid grid-cols-2 gap-2 pt-0.5">
                    <div className="bg-canvas-subtle border border-line p-2 rounded-lg">
                        <span className="block text-[9px] text-fg-muted uppercase font-semibold tracking-wider">
                            {isEn ? 'Active Alerts' : 'Alertas Ativos'}
                        </span>
                        <span className="text-xs font-bold tabular-nums text-fg">{details.totalAlerts || 0}</span>
                    </div>
                    <div className="bg-canvas-subtle border border-line p-2 rounded-lg">
                        <span className="block text-[9px] text-fg-muted uppercase font-semibold tracking-wider">
                            {isEn ? 'Severity' : 'Severidade'}
                        </span>
                        <span
                            className={`text-xs font-bold ${
                                details.penalties?.critical > 0 ? 'text-danger-fg' : 'text-accent-fg'
                            }`}
                        >
                            {details.penalties?.critical > 0
                                ? (isEn ? 'Critical' : 'Crítica')
                                : (isEn ? 'Stable' : 'Estável')}
                        </span>
                    </div>
                </div>
            </div>

            <button
                onClick={() => (window.location.href = isEn ? '/en/reports' : '/reports')}
                className="w-full py-2.5 bg-surface-2 hover:bg-surface-3 border border-line hover:border-accent/30 text-fg/80 hover:text-fg text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5 active:scale-95 mt-auto"
            >
                {isEn ? 'View Behavioral Audit' : 'Ver Relatório Comportamental'}
            </button>
        </div>
    );
};
