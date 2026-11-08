import React, { useMemo } from 'react';
import { Radar } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    RadialLinearScale,
    PointElement,
    LineElement,
    Filler,
    Tooltip,
    Legend
} from 'chart.js';
import { BarChart2, Clock, Calendar, Activity } from 'lucide-react';
import { ChartTheme, useChartTheme } from '../../../hooks/useChartTheme';

ChartJS.register(
    RadialLinearScale,
    PointElement,
    LineElement,
    Filler,
    Tooltip,
    Legend
);

interface InstrumentItem {
    symbol: string;
    wins: number;
    losses: number;
    total: number;
    pnl?: number;
}

interface SessionItem {
    name: string;
    percent: number;
    pnl: number;
    count?: number;
    active?: boolean;
}

interface OperationalRadarsProps {
    instrumentsData: InstrumentItem[];
    sessionsData: SessionItem[];
    trades?: any[];
    dailyPnL?: Array<{ date: string; pnl?: number; value?: number }>;
}

const getBaseRadarOptions = (ct: ChartTheme, suggestedMax = 100, tooltipCallbacks?: any) => ({
    responsive: true,
    maintainAspectRatio: false,
    layout: {
        padding: { top: 6, bottom: 6, left: 6, right: 6 }
    },
    scales: {
        r: {
            angleLines: { color: ct.grid, lineWidth: 1 },
            grid: { color: ct.grid },
            pointLabels: {
                color: ct.label,
                font: { size: 9.5, family: "'Inter', sans-serif", weight: 500 },
                padding: 6
            },
            ticks: { display: false },
            suggestedMin: 0,
            suggestedMax: suggestedMax
        }
    },
    plugins: {
        legend: { display: false },
        tooltip: {
            backgroundColor: ct.tooltipBg,
            borderColor: ct.tooltipBorder,
            borderWidth: 1,
            titleColor: ct.tooltipTitle,
            bodyColor: ct.tooltipBody,
            titleFont: { family: "'Inter', sans-serif", size: 11, weight: 'bold' as const },
            bodyFont: { family: "'JetBrains Mono', monospace", size: 11 },
            padding: 8,
            boxPadding: 3,
            cornerRadius: 6,
            callbacks: tooltipCallbacks
        }
    }
});

export const OperationalRadars: React.FC<OperationalRadarsProps> = ({
    instrumentsData = [],
    sessionsData = [],
    trades = [],
    dailyPnL = []
}) => {
    const ct = useChartTheme();

    // --- 1. RADAR DE ATIVOS ---
    const assetRadarData = useMemo(() => {
        if (!instrumentsData || instrumentsData.length === 0) return null;

        const labels = instrumentsData.map(item => {
            const sym = item.symbol.replace(/\s*Index$/i, '');
            return sym.length > 15 ? sym.substring(0, 13) + '…' : sym;
        });

        const winRates = instrumentsData.map(item => {
            const total = item.wins + item.losses;
            return total > 0 ? Math.round((item.wins / total) * 100) : 0;
        });

        return {
            labels,
            winRates,
            chartData: {
                labels,
                datasets: [{
                    label: 'Win Rate (%)',
                    data: winRates,
                    backgroundColor: 'rgba(16, 185, 129, 0.20)',
                    borderColor: '#10b981',
                    borderWidth: 1.75,
                    pointBackgroundColor: '#10b981',
                    pointBorderColor: '#111319',
                    pointBorderWidth: 1.5,
                    pointRadius: 3.5,
                    pointHoverRadius: 5.5
                }]
            }
        };
    }, [instrumentsData]);

    const assetRadarOptions = useMemo(() => {
        if (!assetRadarData) return getBaseRadarOptions(ct, 100);
        const maxRate = Math.max(...assetRadarData.winRates, 50);
        return getBaseRadarOptions(ct, Math.min(100, maxRate + 5), {
            label: (context: any) => {
                const idx = context.dataIndex;
                const asset = instrumentsData[idx];
                if (!asset) return ` Win Rate: ${context.raw}%`;
                const total = asset.wins + asset.losses;
                return [
                    ` Win Rate: ${context.raw}%`,
                    ` (${asset.wins}W / ${asset.losses}L - ${total} trades)`
                ];
            }
        });
    }, [assetRadarData, instrumentsData, ct]);

    // --- 2. RADAR DE SESSÕES OPERACIONAIS ---
    const standardSessions = useMemo(() => ['Nova Iorque', 'Sydney', 'Londres', 'Ásia'], []);

    const sessionRadarData = useMemo(() => {
        const mapped = standardSessions.map(sessName => {
            const found = sessionsData.find(s => {
                const n = (s.name || '').toLowerCase();
                if (sessName === 'Ásia') return n.includes('ásia') || n.includes('asia') || n.includes('tokyo');
                if (sessName === 'Nova Iorque') return n.includes('nova iorque') || n.includes('new york') || n.includes('ny');
                if (sessName === 'Londres') return n.includes('londres') || n.includes('london');
                if (sessName === 'Sydney') return n.includes('sydney');
                return n === sessName.toLowerCase();
            });

            return {
                name: sessName,
                percent: found ? Math.round(found.percent * 10) / 10 : 0,
                pnl: found ? found.pnl : 0
            };
        });

        const labels = mapped.map(s => s.name);
        const values = mapped.map(s => s.percent);

        return {
            mapped,
            chartData: {
                labels,
                datasets: [{
                    label: 'Atividade (%)',
                    data: values,
                    backgroundColor: 'rgba(168, 85, 247, 0.20)',
                    borderColor: '#a855f7',
                    borderWidth: 1.75,
                    pointBackgroundColor: '#a855f7',
                    pointBorderColor: '#111319',
                    pointBorderWidth: 1.5,
                    pointRadius: 3.5,
                    pointHoverRadius: 5.5
                }]
            }
        };
    }, [sessionsData, standardSessions]);

    const sessionRadarOptions = useMemo(() => {
        return getBaseRadarOptions(ct, 100, {
            label: (context: any) => {
                const item = sessionRadarData.mapped[context.dataIndex];
                const pnl = item?.pnl ?? 0;
                const pnlFormatted = `${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                return [
                    ` Atividade: ${context.raw}% do volume`,
                    ` PnL: ${pnlFormatted}`
                ];
            }
        });
    }, [sessionRadarData, ct]);

    // --- 3. RADAR DE OPERAÇÃO POR DIAS DA SEMANA (SEG - SEX) ---
    const weekdayData = useMemo(() => {
        const days = [
            { day: 'Segunda-feira', dayNum: 1, trades: 0, pnl: 0 },
            { day: 'Terça-feira', dayNum: 2, trades: 0, pnl: 0 },
            { day: 'Quarta-feira', dayNum: 3, trades: 0, pnl: 0 },
            { day: 'Quinta-feira', dayNum: 4, trades: 0, pnl: 0 },
            { day: 'Sexta-feira', dayNum: 5, trades: 0, pnl: 0 },
        ];

        if (Array.isArray(trades) && trades.length > 0) {
            trades.forEach(t => {
                const dateVal = t.closeTime || t.openTime || t.date;
                if (!dateVal) return;
                const d = new Date(dateVal);
                const dayOfWeek = d.getDay();
                const matched = days.find(item => item.dayNum === dayOfWeek);
                if (matched) {
                    matched.trades += 1;
                    const net = (Number(t.profit) || 0) + (Number(t.commission) || 0) + (Number(t.swap) || 0);
                    matched.pnl += net;
                }
            });
        } else if (Array.isArray(dailyPnL) && dailyPnL.length > 0) {
            dailyPnL.forEach(dp => {
                const d = new Date(dp.date);
                const dayOfWeek = d.getDay();
                const matched = days.find(item => item.dayNum === dayOfWeek);
                if (matched) {
                    matched.trades += 1;
                    matched.pnl += Number(dp.pnl ?? dp.value) || 0;
                }
            });
        }

        return days;
    }, [trades, dailyPnL]);

    const weekdayRadarData = useMemo(() => {
        const labels = weekdayData.map(d => d.day);
        const tradeCounts = weekdayData.map(d => d.trades);

        return {
            tradeCounts,
            chartData: {
                labels,
                datasets: [{
                    label: 'Trades',
                    data: tradeCounts,
                    backgroundColor: 'rgba(6, 182, 212, 0.20)',
                    borderColor: '#06b6d4',
                    borderWidth: 1.75,
                    pointBackgroundColor: '#06b6d4',
                    pointBorderColor: '#111319',
                    pointBorderWidth: 1.5,
                    pointRadius: 3.5,
                    pointHoverRadius: 5.5
                }]
            }
        };
    }, [weekdayData]);

    const weekdayRadarOptions = useMemo(() => {
        const maxTrades = Math.max(...weekdayRadarData.tradeCounts, 10);
        return getBaseRadarOptions(ct, maxTrades + 2, {
            label: (context: any) => {
                const dayInfo = weekdayData[context.dataIndex];
                const pnl = dayInfo?.pnl ?? 0;
                const pnlFormatted = `${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                return [
                    ` Trades: ${context.raw}`,
                    ` PnL: ${pnlFormatted}`
                ];
            }
        });
    }, [weekdayRadarData, weekdayData, ct]);

    // --- 4. INSIGHTS DE MELHOR E PIOR (CONCISOS / NÃO VERBOSOS) ---
    const assetInsight = useMemo(() => {
        if (!instrumentsData || instrumentsData.length === 0) {
            return { best: null, worst: null };
        }

        const symbolPnlMap = new Map<string, number>();
        if (Array.isArray(trades) && trades.length > 0) {
            trades.forEach(t => {
                const sym = (t.symbol || '').replace(/\s*Index$/i, '').replace(/m$/, '');
                const net = (Number(t.profit) || 0) + (Number(t.commission) || 0) + (Number(t.swap) || 0);
                symbolPnlMap.set(sym, (symbolPnlMap.get(sym) || 0) + net);
            });
        }

        const items = instrumentsData.map(item => {
            const cleanSym = item.symbol.replace(/\s*Index$/i, '').replace(/m$/, '');
            const shortName = cleanSym.length > 12 ? cleanSym.substring(0, 11) + '…' : cleanSym;
            const total = item.wins + item.losses;
            const wr = total > 0 ? Math.round((item.wins / total) * 100) : 0;
            const pnl = symbolPnlMap.has(cleanSym) ? symbolPnlMap.get(cleanSym)! : (item.pnl ?? null);
            return {
                symbol: shortName,
                total,
                winRate: wr,
                pnl
            };
        }).filter(item => item.total > 0 || (item.pnl !== null && item.pnl !== 0));

        if (items.length === 0) return { best: null, worst: null };

        const hasPnl = items.some(i => i.pnl !== null && i.pnl !== 0);
        const sorted = [...items].sort((a, b) => {
            if (hasPnl && a.pnl !== null && b.pnl !== null && a.pnl !== b.pnl) {
                return b.pnl - a.pnl;
            }
            return b.winRate - a.winRate;
        });

        const formatVal = (item: typeof items[0]) => {
            if (item.pnl !== null && item.pnl !== undefined && item.pnl !== 0) {
                const sign = item.pnl >= 0 ? '+' : '-';
                return `${sign}$${Math.abs(item.pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            }
            return `${item.winRate}%`;
        };

        const best = sorted[0] ? { label: sorted[0].symbol, value: formatVal(sorted[0]) } : null;
        const worst = sorted.length > 1 ? { label: sorted[sorted.length - 1].symbol, value: formatVal(sorted[sorted.length - 1]) } : null;

        return { best, worst };
    }, [instrumentsData, trades]);

    const sessionInsight = useMemo(() => {
        if (!sessionsData || sessionsData.length === 0) {
            return { best: null, worst: null };
        }

        const activeSessions = sessionRadarData.mapped.filter(s => s.percent > 0 || s.pnl !== 0);
        if (activeSessions.length === 0) {
            return { best: null, worst: null };
        }

        const hasPnl = activeSessions.some(s => s.pnl !== 0);
        const sorted = [...activeSessions].sort((a, b) => {
            if (hasPnl && a.pnl !== b.pnl) return b.pnl - a.pnl;
            return b.percent - a.percent;
        });

        const formatVal = (item: typeof activeSessions[0]) => {
            if (item.pnl !== 0) {
                const sign = item.pnl >= 0 ? '+' : '-';
                return `${sign}$${Math.abs(item.pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            }
            return `${item.percent}%`;
        };

        const best = sorted[0] ? { label: sorted[0].name, value: formatVal(sorted[0]) } : null;
        const worst = sorted.length > 1 ? { label: sorted[sorted.length - 1].name, value: formatVal(sorted[sorted.length - 1]) } : null;

        return { best, worst };
    }, [sessionsData, sessionRadarData]);

    const weekdayInsight = useMemo(() => {
        const activeDays = weekdayData.filter(d => d.trades > 0 || d.pnl !== 0);
        if (activeDays.length === 0) {
            return { best: null, worst: null };
        }

        const hasPnl = activeDays.some(d => d.pnl !== 0);
        const sorted = [...activeDays].sort((a, b) => {
            if (hasPnl && a.pnl !== b.pnl) return b.pnl - a.pnl;
            return b.trades - a.trades;
        });

        const formatVal = (item: typeof activeDays[0]) => {
            if (item.pnl !== 0) {
                const sign = item.pnl >= 0 ? '+' : '-';
                return `${sign}$${Math.abs(item.pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            }
            return `${item.trades} trades`;
        };

        const cleanDay = (name: string) => name.replace('-feira', '');

        const best = sorted[0] ? { label: cleanDay(sorted[0].day), value: formatVal(sorted[0]) } : null;
        const worst = sorted.length > 1 ? { label: cleanDay(sorted[sorted.length - 1].day), value: formatVal(sorted[sorted.length - 1]) } : null;

        return { best, worst };
    }, [weekdayData]);

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 items-stretch">
            {/* CARD 1: RADAR DE ATIVOS */}
            <div className="bg-surface border border-line hover:border-line-strong rounded-xl p-3.5 sm:p-4 card-hover flex flex-col justify-between h-[330px] sm:h-[350px]">
                <div className="flex items-center justify-between pb-2 mb-1 border-b border-line">
                    <span className="text-xs font-semibold text-fg uppercase tracking-wider flex items-center gap-1.5">
                        <BarChart2 size={13} className="text-accent-fg" />
                        Desempenho por Ativo
                    </span>
                    <span className="text-[10px] font-mono text-fg-subtle">
                        {instrumentsData.length} {instrumentsData.length === 1 ? 'ativo' : 'ativos'}
                    </span>
                </div>

                <div className="relative flex-1 flex justify-center items-center w-full h-full min-h-[200px]">
                    {assetRadarData ? (
                        <Radar data={assetRadarData.chartData} options={assetRadarOptions as any} />
                    ) : (
                        <div className="flex flex-col items-center justify-center text-center p-3">
                            <div className="w-9 h-9 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-1.5">
                                <Activity size={16} className="text-accent-fg" />
                            </div>
                            <span className="text-xs font-medium text-fg/80">Nenhum trade no período</span>
                            <span className="text-[10px] text-fg-subtle mt-0.5">Aguardando operações</span>
                        </div>
                    )}
                </div>

                {/* Insight Footer */}
                <div className="pt-2 mt-auto border-t border-line flex items-center justify-between text-[11px] font-mono">
                    {assetInsight.best ? (
                        <div className="flex items-center justify-between w-full gap-2 overflow-hidden">
                            <div className="flex items-center gap-1.5 min-w-0">
                                <span className="inline-flex items-center gap-1 text-accent-fg font-bold shrink-0 text-[10px] uppercase">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                    Melhor:
                                </span>
                                <span className="text-fg font-semibold truncate text-xs">{assetInsight.best.label}</span>
                                <span className="text-accent-fg font-bold shrink-0">{assetInsight.best.value}</span>
                            </div>
                            {assetInsight.worst && (
                                <div className="flex items-center gap-1.5 min-w-0 pl-2">
                                    <span className="inline-flex items-center gap-1 text-danger-fg font-bold shrink-0 text-[10px] uppercase">
                                        <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                                        Pior:
                                    </span>
                                    <span className="text-fg font-semibold truncate text-xs">{assetInsight.worst.label}</span>
                                    <span className="text-danger-fg font-bold shrink-0">{assetInsight.worst.value}</span>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-center justify-center w-full">
                            <span className="text-[10px] text-fg-subtle font-mono">Sem dados suficientes</span>
                        </div>
                    )}
                </div>
            </div>

            {/* CARD 2: RADAR DE SESSÕES OPERACIONAIS */}
            <div className="bg-surface border border-line hover:border-line-strong rounded-xl p-3.5 sm:p-4 card-hover flex flex-col justify-between h-[330px] sm:h-[350px]">
                <div className="flex items-center justify-between pb-2 mb-1 border-b border-line">
                    <span className="text-xs font-semibold text-fg uppercase tracking-wider flex items-center gap-1.5">
                        <Clock size={13} className="text-purple-400" />
                        Sessões Operacionais
                    </span>
                    <span className="text-[10px] font-mono text-fg-subtle">
                        Volume / PnL
                    </span>
                </div>

                <div className="relative flex-1 flex justify-center items-center w-full h-full min-h-[200px]">
                    <Radar data={sessionRadarData.chartData} options={sessionRadarOptions as any} />
                </div>

                {/* Insight Footer */}
                <div className="pt-2 mt-auto border-t border-line flex items-center justify-between text-[11px] font-mono">
                    {sessionInsight.best ? (
                        <div className="flex items-center justify-between w-full gap-2 overflow-hidden">
                            <div className="flex items-center gap-1.5 min-w-0">
                                <span className="inline-flex items-center gap-1 text-accent-fg font-bold shrink-0 text-[10px] uppercase">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                    Melhor:
                                </span>
                                <span className="text-fg font-semibold truncate text-xs">{sessionInsight.best.label}</span>
                                <span className="text-accent-fg font-bold shrink-0">{sessionInsight.best.value}</span>
                            </div>
                            {sessionInsight.worst && (
                                <div className="flex items-center gap-1.5 min-w-0 pl-2">
                                    <span className="inline-flex items-center gap-1 text-danger-fg font-bold shrink-0 text-[10px] uppercase">
                                        <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                                        Pior:
                                    </span>
                                    <span className="text-fg font-semibold truncate text-xs">{sessionInsight.worst.label}</span>
                                    <span className="text-danger-fg font-bold shrink-0">{sessionInsight.worst.value}</span>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-center justify-center w-full">
                            <span className="text-[10px] text-fg-subtle font-mono">Sem dados suficientes</span>
                        </div>
                    )}
                </div>
            </div>

            {/* CARD 3: RADAR DE OPERAÇÃO POR DIAS DA SEMANA */}
            <div className="bg-surface border border-line hover:border-line-strong rounded-xl p-3.5 sm:p-4 card-hover flex flex-col justify-between h-[330px] sm:h-[350px]">
                <div className="flex items-center justify-between pb-2 mb-1 border-b border-line">
                    <span className="text-xs font-semibold text-fg uppercase tracking-wider flex items-center gap-1.5">
                        <Calendar size={13} className="text-cyan-400" />
                        Operação por Dias
                    </span>
                    <span className="text-[10px] font-mono text-fg-subtle">
                        Seg — Sex
                    </span>
                </div>

                <div className="relative flex-1 flex justify-center items-center w-full h-full min-h-[200px]">
                    <Radar data={weekdayRadarData.chartData} options={weekdayRadarOptions as any} />
                </div>

                {/* Insight Footer */}
                <div className="pt-2 mt-auto border-t border-line flex items-center justify-between text-[11px] font-mono">
                    {weekdayInsight.best ? (
                        <div className="flex items-center justify-between w-full gap-2 overflow-hidden">
                            <div className="flex items-center gap-1.5 min-w-0">
                                <span className="inline-flex items-center gap-1 text-accent-fg font-bold shrink-0 text-[10px] uppercase">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                    Melhor:
                                </span>
                                <span className="text-fg font-semibold truncate text-xs">{weekdayInsight.best.label}</span>
                                <span className="text-accent-fg font-bold shrink-0">{weekdayInsight.best.value}</span>
                            </div>
                            {weekdayInsight.worst && (
                                <div className="flex items-center gap-1.5 min-w-0 pl-2">
                                    <span className="inline-flex items-center gap-1 text-danger-fg font-bold shrink-0 text-[10px] uppercase">
                                        <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                                        Pior:
                                    </span>
                                    <span className="text-fg font-semibold truncate text-xs">{weekdayInsight.worst.label}</span>
                                    <span className="text-danger-fg font-bold shrink-0">{weekdayInsight.worst.value}</span>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-center justify-center w-full">
                            <span className="text-[10px] text-fg-subtle font-mono">Sem dados suficientes</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
