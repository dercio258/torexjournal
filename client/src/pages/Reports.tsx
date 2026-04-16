import { useEffect, useState, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
} from 'chart.js';
import { TrendingUp, Calendar, Activity, AlertTriangle } from 'lucide-react';
import api from '../api';
import { useAuth } from '../context/AuthContext';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
);

export const Reports = () => {
    const { token } = useAuth();
    const [trades, setTrades] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (token) fetchTrades();
    }, [token]);

    const fetchTrades = async () => {
        try {
            const res = await api.get('/dashboard/trades');
            if (Array.isArray(res.data)) {
                // Sort by close time asc for curve
                const sorted = res.data
                    .map((t: any) => ({
                        ...t,
                        profit: Number(t.profit) + Number(t.commission) + Number(t.swap),
                        closeTime: new Date(t.closeTime)
                    }))
                    .sort((a, b) => a.closeTime.getTime() - b.closeTime.getTime());
                setTrades(sorted);
            }
        } catch (error) {
            console.error("Error fetching trades:", error);
        } finally {
            setLoading(false);
        }
    };

    // --- Analytics Logic ---
    const analytics = useMemo(() => {
        if (!trades.length) return null;

        let cumulative = 0;
        const pnlCurvePoints = trades.map(t => {
            cumulative += t.profit;
            return { x: t.closeTime.toLocaleDateString(), y: cumulative };
        });

        const wins = trades.filter(t => t.profit >= 0);
        const losses = trades.filter(t => t.profit < 0);

        const totalProfit = wins.reduce((acc, t) => acc + t.profit, 0);
        const totalLoss = Math.abs(losses.reduce((acc, t) => acc + t.profit, 0));

        const winRate = (wins.length / trades.length) * 100;
        const profitFactor = totalLoss === 0 ? totalProfit : totalProfit / totalLoss;
        const avgWin = wins.length ? totalProfit / wins.length : 0;
        const avgLoss = losses.length ? totalLoss / losses.length : 0;
        const expectancy = (winRate / 100 * avgWin) - ((1 - winRate / 100) * avgLoss);

        // Max Drawdown
        let peak = -Infinity;
        let maxDD = 0;
        let runningPnL = 0;
        trades.forEach(t => {
            runningPnL += t.profit;
            if (runningPnL > peak) peak = runningPnL;
            const dd = peak - runningPnL;
            if (dd > maxDD) maxDD = dd;
        });

        return {
            pnlCurvePoints,
            totalNet: cumulative,
            winRate,
            profitFactor,
            expectancy,
            maxDrawdown: maxDD,
            totalTrades: trades.length
        };
    }, [trades]);

    // --- Monthly Matrix Logic ---
    const monthlyMatrix = useMemo(() => {
        const matrix: Record<number, Record<number, number>> = {};
        trades.forEach(t => {
            const year = t.closeTime.getFullYear();
            const month = t.closeTime.getMonth(); // 0-11
            if (!matrix[year]) matrix[year] = {};
            if (!matrix[year][month]) matrix[year][month] = 0;
            matrix[year][month] += t.profit;
        });
        return matrix;
    }, [trades]);

    const chartData = {
        labels: analytics?.pnlCurvePoints.map(p => p.x) || [],
        datasets: [
            {
                label: 'Equity Curve',
                data: analytics?.pnlCurvePoints.map(p => p.y) || [],
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                fill: true,
                tension: 0.4,
                pointRadius: 2,
            }
        ]
    };

    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const years = Object.keys(monthlyMatrix).map(Number).sort((a, b) => b - a);

    if (loading) return <div className="p-8 text-slate-400">Carregando dados...</div>;

    return (
        <div className="p-8 space-y-8 animate-fade-in pb-24">
            <header className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Relatório de Performance</h1>
                    <p className="text-slate-400 mt-1">Análise detalhada de consistência e resultados</p>
                </div>
                <div className="bg-slate-900/50 px-4 py-2 rounded-lg border border-slate-800 text-sm font-mono text-emerald-400">
                    Net PnL: {analytics?.totalNet.toFixed(2)} MZN
                </div>
            </header>

            {/* KPI Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KpiCard label="Expectativa (Por Trade)" value={analytics?.expectancy.toFixed(2)} icon={<Activity size={16} />} color="text-indigo-400" />
                <KpiCard label="Profit Factor" value={analytics?.profitFactor.toFixed(2)} icon={<TrendingUp size={16} />} color={analytics?.profitFactor >= 1.5 ? "text-emerald-400" : "text-amber-400"} />
                <KpiCard label="Max Drawdown" value={`-${analytics?.maxDrawdown.toFixed(2)}`} icon={<AlertTriangle size={16} />} color="text-rose-400" />
                <KpiCard label="Trades Totais" value={analytics?.totalTrades} icon={<Calendar size={16} />} color="text-slate-200" />
            </div>

            {/* PnL Chart */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6">
                <h3 className="text-lg font-bold text-slate-200 mb-4">Curva de Capital</h3>
                <div className="h-80 w-full">
                    {trades.length > 0 ? (
                        <Line data={chartData} options={{
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: { legend: { display: false } },
                            scales: {
                                y: { grid: { color: '#1e293b' }, ticks: { color: '#64748b' } },
                                x: { grid: { display: false }, ticks: { display: false } }
                            }
                        }} />
                    ) : (
                        <div className="h-full flex items-center justify-center text-slate-600">Sem dados suficientes</div>
                    )}
                </div>
            </div>

            {/* Monthly Matrix */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 overflow-x-auto">
                <h3 className="text-lg font-bold text-slate-200 mb-6">Matriz Mensal</h3>
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-slate-800">
                            <th className="text-left text-slate-500 font-medium py-3">Ano</th>
                            {months.map(m => <th key={m} className="text-center text-slate-500 font-medium py-3">{m}</th>)}
                            <th className="text-right text-slate-500 font-medium py-3">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {years.map(year => {
                            let yearlyTotal = 0;
                            return (
                                <tr key={year} className="border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors">
                                    <td className="py-4 font-bold text-slate-300">{year}</td>
                                    {months.map((_, idx) => {
                                        const val = monthlyMatrix[year]?.[idx] || 0;
                                        yearlyTotal += val;
                                        return (
                                            <td key={idx} className="text-center py-4">
                                                {val !== 0 ? (
                                                    <span className={`px-2 py-1 rounded ${val >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                                                        {val.toFixed(0)}
                                                    </span>
                                                ) : <span className="text-slate-700">-</span>}
                                            </td>
                                        );
                                    })}
                                    <td className={`text-right py-4 font-bold ${yearlyTotal >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {yearlyTotal.toFixed(2)}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const KpiCard = ({ label, value, icon, color }: any) => (
    <div className="bg-slate-900/40 p-5 rounded-2xl border border-slate-800 flex flex-col justify-between hover:border-slate-700 transition-colors">
        <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase font-bold text-slate-500 tracking-wider">{label}</span>
            <div className={`p-1.5 rounded-lg bg-slate-800/50 ${color}`}>{icon}</div>
        </div>
        <div className="text-2xl font-bold text-white">{value}</div>
    </div>
);
