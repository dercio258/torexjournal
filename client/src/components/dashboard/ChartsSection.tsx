import { Radar, Line, Bar } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    RadialLinearScale,
    PointElement,
    LineElement,
    Filler,
    Tooltip,
    Legend,
    CategoryScale,
    LinearScale
} from 'chart.js';
import { Radar as RadarIcon, TrendingUp } from 'lucide-react';
import { Card } from '../ui/Card';
import { DashboardStats } from '../../types';

ChartJS.register(
    RadialLinearScale,
    PointElement,
    LineElement,
    Filler,
    Tooltip,
    Legend,
    CategoryScale,
    LinearScale
);

interface ChartsSectionProps {
    stats: DashboardStats | null;
    isLoading: boolean;
}

export const ChartsSection = ({ stats, isLoading }: ChartsSectionProps) => {
    if (isLoading || !stats) {
        return (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="h-80 animate-pulse bg-slate-800/50" />
                <Card className="h-80 animate-pulse bg-slate-800/50" />
            </div>
        );
    }

    const { radarMetrics, dailyPnL } = stats;

    const radarData = {
        labels: ['Consistência', 'Gestão de Risco', 'Disciplina', 'Lucratividade', 'Taxa de Acerto'],
        datasets: [{
            label: 'Performance',
            data: [
                radarMetrics?.consistency || 0,
                radarMetrics?.riskManagement || 0,
                radarMetrics?.discipline || 0,
                radarMetrics?.profitability || 0,
                radarMetrics?.winRate || 0
            ],
            backgroundColor: 'rgba(52, 211, 153, 0.2)',
            borderColor: '#10b981',
            borderWidth: 2,
            pointBackgroundColor: '#10b981',
            pointBorderColor: '#fff',
        }]
    };

    const radarOptions = {
        scales: {
            r: {
                beginAtZero: true,
                max: 100,
                ticks: { display: false },
                grid: { color: 'rgba(148, 163, 184, 0.1)' },
                pointLabels: { color: '#cbd5e1', font: { size: 12 } }
            }
        },
        plugins: { legend: { display: false } },
        maintainAspectRatio: false
    };

    const sortedPnL = [...(dailyPnL || [])].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).slice(-30);

    const pnlData = {
        labels: sortedPnL.map(d => new Date(d.date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })),
        datasets: [{
            label: 'P&L USD',
            data: sortedPnL.map(d => d.pnl),
            fill: true,
            borderColor: '#10b981', // Simplified single color for now, custom gradient plugin needs more setup
            backgroundColor: (context: any) => {
                const ctx = context.chart.ctx;
                const gradient = ctx.createLinearGradient(0, 0, 0, 300);
                gradient.addColorStop(0, 'rgba(16, 185, 129, 0.4)');
                gradient.addColorStop(1, 'rgba(16, 185, 129, 0)');
                return gradient;
            },
            tension: 0.3,
            borderWidth: 2,
            pointRadius: 2
        }]
    };

    const pnlOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
            y: {
                grid: { color: 'rgba(148, 163, 184, 0.05)' },
                ticks: { color: '#64748b' }
            },
            x: {
                grid: { display: false },
                ticks: { color: '#64748b' }
            }
        }
    };

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Card className="lg:col-span-1 p-6 h-[400px] flex flex-col">
                    <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <RadarIcon className="w-4 h-4 text-emerald-400" /> Performance
                    </h2>
                    <div className="flex-1 min-h-0 relative">
                        <Radar data={radarData} options={radarOptions} />
                    </div>
                </Card>

                <Card className="lg:col-span-2 p-6 h-[400px] flex flex-col">
                    <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-emerald-400" /> Curva de P&L
                    </h2>
                    <div className="flex-1 min-h-0 relative">
                        <Line data={pnlData} options={pnlOptions} />
                    </div>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="p-6 h-80 flex flex-col">
                    <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-purple-400" /> P&L por Humor
                    </h2>
                    <div className="flex-1 min-h-0">
                        <Bar
                            data={{
                                labels: (stats.byMood || []).map(m => m.mood || 'N/A'),
                                datasets: [{
                                    label: 'P&L',
                                    data: (stats.byMood || []).map(m => m.pnl),
                                    backgroundColor: (stats.byMood || []).map(m => m.pnl >= 0 ? 'rgba(16, 185, 129, 0.5)' : 'rgba(244, 63, 94, 0.5)'),
                                    borderColor: (stats.byMood || []).map(m => m.pnl >= 0 ? '#10b981' : '#f43f5e'),
                                    borderWidth: 1
                                }]
                            }}
                            options={{
                                responsive: true,
                                maintainAspectRatio: false,
                                plugins: { legend: { display: false } },
                                scales: {
                                    y: { grid: { color: 'rgba(148, 163, 184, 0.05)' }, ticks: { color: '#64748b' } },
                                    x: { grid: { display: false }, ticks: { color: '#64748b' } }
                                }
                            }}
                        />
                    </div>
                </Card>

                <Card className="p-6 h-80 flex flex-col">
                    <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-blue-400" /> P&L por Setup
                    </h2>
                    <div className="flex-1 min-h-0">
                        <Bar
                            data={{
                                labels: (stats.bySetup || []).map(s => s.setup || 'N/A'),
                                datasets: [{
                                    label: 'P&L',
                                    data: (stats.bySetup || []).map(s => s.pnl),
                                    backgroundColor: (stats.bySetup || []).map(s => s.pnl >= 0 ? 'rgba(59, 130, 246, 0.5)' : 'rgba(244, 63, 94, 0.5)'),
                                    borderColor: (stats.bySetup || []).map(s => s.pnl >= 0 ? '#3b82f6' : '#f43f5e'),
                                    borderWidth: 1
                                }]
                            }}
                            options={{
                                responsive: true,
                                maintainAspectRatio: false,
                                plugins: { legend: { display: false } },
                                scales: {
                                    y: { grid: { color: 'rgba(148, 163, 184, 0.05)' }, ticks: { color: '#64748b' } },
                                    x: { grid: { display: false }, ticks: { color: '#64748b' } }
                                }
                            }}
                        />
                    </div>
                </Card>
            </div>
        </div>
    );
};
