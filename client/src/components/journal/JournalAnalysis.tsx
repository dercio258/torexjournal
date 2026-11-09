import React, { useMemo } from 'react';
import { Doughnut, Bar } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    ArcElement,
    Tooltip,
    Legend,
    CategoryScale,
    LinearScale,
    BarElement,
    Title
} from 'chart.js';
import { Activity } from 'lucide-react';
import { useChartTheme } from '../../hooks/useChartTheme';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title);

interface JournalAnalysisProps {
    trades: any[];
}

export const JournalAnalysis: React.FC<JournalAnalysisProps> = ({ trades }) => {
    const ct = useChartTheme();

    // Stats Calculation
    const stats = useMemo(() => {
        if (!trades.length) return null;

        const totalTrades = trades.length;
        const wins = trades.filter(t => t.profit >= 0).length;
        const losses = totalTrades - wins;
        const winRate = (wins / totalTrades) * 100;

        const totalProfit = trades.reduce((acc, t) => acc + (t.profit > 0 ? t.profit : 0), 0);
        const totalLoss = trades.reduce((acc, t) => acc + (t.profit < 0 ? Math.abs(t.profit) : 0), 0);
        const profitFactor = totalLoss === 0 ? totalProfit : totalProfit / totalLoss;

        return {
            totalTrades,
            wins,
            losses,
            winRate,
            profitFactor,
            totalProfit,
            totalLoss
        };
    }, [trades]);

    // Data for Doughnut (Win/Loss)
    const winLossData = {
        labels: ['Wins', 'Losses'],
        datasets: [
            {
                data: [stats?.wins || 0, stats?.losses || 0],
                backgroundColor: [ct.pos, ct.neg],
                borderColor: ct.background,
                borderWidth: 2,
            },
        ],
    };

    // Data for Bar (Day of Week Performance)
    const dayPerformance = useMemo(() => {
        const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
        const pnlByDay = new Array(7).fill(0);

        trades.forEach(t => {
            const day = new Date(t.close_time).getUTCDay(); // UTC, like the backend
            pnlByDay[day] += t.profit;
        });

        return {
            labels: days,
            datasets: [
                {
                    label: 'PnL',
                    data: pnlByDay,
                    backgroundColor: pnlByDay.map(v => v >= 0 ? ct.pos : ct.neg),
                    borderRadius: 4,
                    maxBarThickness: 24,
                }
            ]
        };
    }, [trades, ct]);

    if (!stats) {
        return (
            <div className="flex items-center justify-center h-64 text-fg-subtle">
                <p>Nenhum dado para análise.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <h3 className="text-xl font-bold text-fg flex items-center gap-2">
                <Activity className="text-indigo-400" /> Análise de Performance
            </h3>

            {/* Quick Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-surface/40 p-4 rounded-2xl border border-line">
                    <div className="text-fg-muted text-xs uppercase font-bold mb-1">Win Rate</div>
                    <div className={`text-2xl font-bold ${stats.winRate >= 50 ? 'text-accent-fg' : 'text-danger-fg'}`}>
                        {stats.winRate.toFixed(1)}%
                    </div>
                </div>
                <div className="bg-surface/40 p-4 rounded-2xl border border-line">
                    <div className="text-fg-muted text-xs uppercase font-bold mb-1">Profit Factor</div>
                    <div className={`text-2xl font-bold ${stats.profitFactor >= 1.5 ? 'text-accent-fg' : 'text-fg'}`}>
                        {stats.profitFactor.toFixed(2)}
                    </div>
                </div>
                <div className="bg-surface/40 p-4 rounded-2xl border border-line">
                    <div className="text-fg-muted text-xs uppercase font-bold mb-1">Total Trades</div>
                    <div className="text-2xl font-bold text-fg">
                        {stats.totalTrades}
                    </div>
                </div>
                <div className="bg-surface/40 p-4 rounded-2xl border border-line">
                    <div className="text-fg-muted text-xs uppercase font-bold mb-1">Net PnL</div>
                    <div className={`text-2xl font-bold ${stats.totalProfit - stats.totalLoss >= 0 ? 'text-accent-fg' : 'text-danger-fg'}`}>
                        {(stats.totalProfit - stats.totalLoss).toFixed(2)}
                    </div>
                </div>
            </div>

            {/* Charts Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Win/Loss Ratio */}
                <div className="bg-surface/40 p-6 rounded-3xl border border-line flex flex-col items-center">
                    <h4 className="text-sm font-bold text-fg/80 mb-4 w-full">Taxa de Acerto</h4>
                    <div className="w-48 h-48 relative">
                        <Doughnut
                            data={winLossData}
                            options={{
                                plugins: { legend: { display: false } },
                                cutout: '70%'
                            }}
                        />
                        <div className="absolute inset-0 flex items-center justify-center flex-col pointer-events-none">
                            <span className="text-2xl font-bold text-fg">{stats.winRate.toFixed(0)}%</span>
                            <span className="text-[10px] text-fg-subtle uppercase">Win Rate</span>
                        </div>
                    </div>
                </div>

                {/* Day of Week Performance */}
                <div className="bg-surface/40 p-6 rounded-3xl border border-line">
                    <h4 className="text-sm font-bold text-fg/80 mb-4">Performance por Dia</h4>
                    <div className="h-48">
                        <Bar
                            data={dayPerformance}
                            options={{
                                responsive: true,
                                maintainAspectRatio: false,
                                plugins: { legend: { display: false } },
                                scales: {
                                    y: {
                                        grid: { color: ct.grid },
                                        ticks: { color: ct.tick, font: { size: 10 } }
                                    },
                                    x: {
                                        grid: { display: false },
                                        ticks: { color: ct.label, font: { size: 10 } }
                                    }
                                }
                            }}
                        />
                    </div>
                </div>

            </div>
        </div>
    );
};
