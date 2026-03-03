import { TrendingUp, Target, Activity } from 'lucide-react';
import { Card } from '../ui/Card';
import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { DashboardStats } from '../../types';

ChartJS.register(ArcElement, Tooltip, Legend);

interface StatsCardsProps {
    stats: DashboardStats | null;
    isLoading: boolean;
}

export const StatsCards = ({ stats, isLoading }: StatsCardsProps) => {
    if (isLoading || !stats) {
        return (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => (
                    <Card key={i} className="h-40 animate-pulse bg-slate-800/50" />
                ))}
            </div>
        );
    }

    const { totalPnL, winRate, totalTrades, totalWins, totalLosses } = stats;

    // Win/Loss Chart Data
    const winLossData = {
        labels: ['Ganhos', 'Perdas'],
        datasets: [{
            data: [totalWins, totalLosses],
            backgroundColor: ['#10b981', '#f43f5e'],
            borderWidth: 0,
        }]
    };

    const winLossOptions = {
        cutout: '75%',
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        maintainAspectRatio: false
    };

    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Net P&L */}
            <Card className="relative overflow-hidden p-4">
                <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-500/5 rounded-full -mr-10 -mt-10" />
                <div className="flex items-center justify-between mb-3 relative z-10">
                    <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center">
                        <TrendingUp className="w-5 h-5 text-emerald-400" />
                    </div>
                    <span className="text-[10px] text-emerald-400 font-semibold px-2 py-0.5 bg-emerald-500/10 rounded-full">TOTAL</span>
                </div>
                <div className="text-xs text-slate-400 font-medium relative z-10">Lucro Líquido</div>
                <div className={`text-2xl font-bold mt-0.5 relative z-10 ${totalPnL >= 0 ? 'text-slate-100' : 'text-rose-400'}`}>
                    ${totalPnL.toFixed(2)}
                </div>
            </Card>

            {/* Win Rate */}
            <Card className="relative overflow-hidden p-4">
                <div className="absolute top-0 right-0 w-20 h-20 bg-blue-500/5 rounded-full -mr-10 -mt-10" />
                <div className="flex items-center justify-between mb-3 relative z-10">
                    <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center">
                        <Target className="w-5 h-5 text-blue-400" />
                    </div>
                </div>
                <div className="text-xs text-slate-400 font-medium relative z-10">Taxa de Acerto</div>
                <div className="text-2xl font-bold text-blue-400 mt-0.5 relative z-10">{winRate.toFixed(1)}%</div>
            </Card>

            {/* Risk Monitor (Replaces Total Trades) */}
            <Card className="relative overflow-hidden p-4">
                <div className="absolute top-0 right-0 w-20 h-20 bg-orange-500/5 rounded-full -mr-10 -mt-10" />

                {stats.accountHealth ? (
                    <>
                        <div className="flex items-center justify-between mb-2 relative z-10">
                            <div className="flex items-center gap-2">
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${stats.accountHealth.marginLevel < 100 ? 'bg-rose-500/10 text-rose-400' :
                                        stats.accountHealth.marginLevel < 500 ? 'bg-yellow-500/10 text-yellow-400' :
                                            'bg-emerald-500/10 text-emerald-400'
                                    }`}>
                                    <Activity className="w-5 h-5" />
                                </div>
                                <div>
                                    <div className="text-xs text-slate-400 font-medium">Saúde da Conta</div>
                                    <div className={`text-lg font-bold ${stats.accountHealth.marginLevel < 100 ? 'text-rose-400' :
                                            stats.accountHealth.marginLevel < 500 ? 'text-yellow-400' :
                                                'text-emerald-400'
                                        }`}>
                                        {stats.accountHealth.marginLevel.toFixed(0)}%
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-1 relative z-10">
                            {/* Health Bar */}
                            <div className="w-full bg-slate-700/50 rounded-full h-1.5 mb-2">
                                <div
                                    className={`h-1.5 rounded-full transition-all duration-500 ${stats.accountHealth.marginLevel < 100 ? 'bg-rose-500' :
                                            stats.accountHealth.marginLevel < 500 ? 'bg-yellow-500' :
                                                'bg-emerald-500'
                                        }`}
                                    style={{ width: `${Math.min(stats.accountHealth.marginLevel / 10, 100)}%` }}
                                ></div>
                            </div>

                            <div className="flex justify-between text-[10px] text-slate-500">
                                <span>Free: <span className="text-slate-300 font-mono">${stats.accountHealth.marginFree.toFixed(0)}</span></span>
                                <span>Lev: <span className="text-slate-300 font-mono">1:{stats.accountHealth.leverage}</span></span>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-500 text-xs">
                        <Activity className="w-6 h-6 mb-1 opacity-50" />
                        <span>Sem dados de risco</span>
                    </div>
                )}
            </Card>

            {/* Distribution */}
            <Card className="relative overflow-hidden p-4 flex flex-col justify-between">
                <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-500/5 rounded-full -mr-10 -mt-10" />
                <div className="flex items-center justify-between mb-1 relative z-10">
                    <div className="text-xs text-slate-400 font-medium lowercase tracking-tight">Distribuição</div>
                    <div className="text-[10px] font-bold text-emerald-400">{winRate.toFixed(1)}% Win</div>
                </div>
                <div className="relative flex-1 flex items-center justify-center py-1 z-10 h-16">
                    <div className="w-16 h-16">
                        <Doughnut data={winLossData} options={winLossOptions} />
                    </div>
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1 relative z-10">
                    <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> {totalWins} Wins</span>
                    <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span> {totalLosses} Loss</span>
                </div>
            </Card>
        </div>
    );
};
