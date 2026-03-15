import { useState, useMemo } from 'react';
import {
    Activity,
    DollarSign,
    Calendar,
    BarChart3,
    ArrowUpRight,
    ArrowDownRight,
    RefreshCw,
    Globe
} from 'lucide-react';
import {
    Chart as ChartJS,
    ArcElement,
    Tooltip,
    Legend
} from 'chart.js';
import { PerformanceRadar } from '../components/dashboard/charts/PerformanceRadar';
import { DailyPnLChart } from '../components/dashboard/charts/DailyPnLChart';
import { WinrateGauge, InstrumentRow, SessionRow, TraderHealthWidget } from '../components/dashboard/StatsWidgets';
import api from '../api';
import { useDashboardStats, useSubscriptionStatus, useTradesFallback } from '../hooks/useDashboard';

// Register ChartJS
ChartJS.register(
    ArcElement,
    Tooltip,
    Legend
);

// --- COMPONENTS ---

const StatCard = ({ title, value, subtext, icon: Icon, trend, trendValue }: any) => (
    <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 p-6 rounded-2xl relative overflow-hidden group hover:border-slate-700 transition-all shadow-lg">
        {/* Ambient Glow */}
        <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-emerald-500/10 to-transparent rounded-full -mr-8 -mt-8 group-hover:from-emerald-500/20 transition-all" />

        <div className="flex justify-between items-start mb-4 relative z-10">
            <div className={`p-3 rounded-xl ${trend === 'up' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
                <Icon size={24} />
            </div>
            {trend && (
                <div className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${trend === 'up' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                    {trend === 'up' ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                    {trendValue}
                </div>
            )}
        </div>

        <div className="relative z-10">
            <h3 className="text-slate-400 text-sm font-medium mb-1">{title}</h3>
            <div className="text-2xl font-bold text-white">{value}</div>
            {subtext && <p className="text-xs text-slate-500 mt-1">{subtext}</p>}
        </div>
    </div>
);

export const Dashboard = () => {
    // Date Filter State
    const [dateRange, setDateRange] = useState({ label: 'Hoje', value: 'today', start: new Date(new Date().setHours(0,0,0,0)).toISOString(), end: new Date(new Date().setHours(23,59,59,999)).toISOString() });
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');
    const [isRenewing, setIsRenewing] = useState(false);

    const { data: subStatus } = useSubscriptionStatus();
    const { data: stats, isLoading: isStatsLoading, refetch: refetchStats } = useDashboardStats(dateRange.start, dateRange.end);
    const { data: tradesFallback } = useTradesFallback();

    const handleRenew = async () => {
        setIsRenewing(true);
        try {
            await api.post('/subscription/renew');
            alert("Pedido de renovação lançado! Confirme no seu telemóvel.");
        } catch (error: any) {
            console.error("Renewal error", error);
            alert(error.response?.data?.message || "Erro ao renovar. Verifique se tem um contacto salvo.");
        } finally {
            setIsRenewing(false);
        }
    };

    const handleDateFilter = (range: string) => {
        const now = new Date();
        let start = new Date();
        let end = new Date();

        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);

        let label = 'Hoje';

        switch (range) {
            case 'today':
                break;
            case 'yesterday':
                start.setDate(now.getDate() - 1);
                end.setDate(now.getDate() - 1);
                end.setHours(23, 59, 59, 999);
                label = 'Ontem';
                break;
            case '7days':
                start.setDate(now.getDate() - 7);
                label = 'Últimos 7 Dias';
                break;
            case '30days':
                start.setDate(now.getDate() - 30);
                label = 'Últimos 30 Dias';
                break;
            case 'all':
                start = new Date('2020-01-01');
                label = 'Todo Período';
                break;
            case 'custom':
                return;
        }

        setDateRange({ 
            label, 
            value: range, 
            start: start.toISOString(), 
            end: end.toISOString() 
        });
    };

    const handleCustomRangeApply = () => {
        if (!customStart) return;

        const start = new Date(customStart);
        start.setHours(0, 0, 0, 0);

        const end = customEnd ? new Date(customEnd) : new Date(customStart);
        end.setHours(23, 59, 59, 999);

        setDateRange({
            label: customEnd ? `${new Date(customStart).toLocaleDateString()} - ${new Date(end).toLocaleDateString()}` : new Date(customStart).toLocaleDateString(),
            value: 'custom',
            start: start.toISOString(),
            end: end.toISOString()
        });
        setShowDatePicker(false);
    };

    // --- Memoized Calculations ---
    const sessionsData = useMemo(() => {
        if (!stats?.bySession) return [];

        const rawSessions = stats.bySession;
        const currentHour = new Date().getUTCHours();
        const isLondon = currentHour >= 8 && currentHour < 17;
        const isNY = currentHour >= 13 && currentHour < 22;
        const isAsian = currentHour >= 0 && currentHour < 9;

        const standardSessions = ['London', 'New York', 'Asian'];
        const existingSessions = rawSessions.map((s: any) => s.session);

        const mergedSessions = [...rawSessions];
        standardSessions.forEach(s => {
            if (!existingSessions.some((es: string) => es.includes(s))) {
                mergedSessions.push({ session: s, count: 0, pnl: 0 });
            }
        });

        const totalSessionTrades = mergedSessions.reduce((acc: number, s: any) => acc + s.count, 0);

        return mergedSessions
            .sort((a: any, b: any) => Math.abs(b.pnl) - Math.abs(a.pnl))
            .map((s: any) => {
                const name = s.session === 'Asian' ? 'Ásia' :
                    s.session === 'London' ? 'Londres' :
                        s.session === 'New York' ? 'Nova Iorque' : s.session;

                return {
                    name,
                    percent: totalSessionTrades ? (s.count / totalSessionTrades) * 100 : 0,
                    pnl: s.pnl || 0,
                    active: (s.session.includes('London') && isLondon) ||
                        (s.session.includes('New York') && isNY) ||
                        ((s.session.includes('Tokyo') || s.session.includes('Sydney') || s.session.includes('Asia') || s.session.includes('Asian')) && isAsian)
                };
            });
    }, [stats?.bySession]);

    const instrumentsData = useMemo(() => {
        if (stats?.bySymbol) {
            return stats.bySymbol
                .map((s: any) => ({ symbol: s.symbol, wins: s.wins || 0, losses: s.losses || 0, total: (s.wins || 0) + (s.losses || 0) }))
                .sort((a: any, b: any) => b.total - a.total)
                .slice(0, 5);
        }

        if (Array.isArray(tradesFallback)) {
            const instrumentMap = new Map<string, { wins: number, losses: number }>();
            tradesFallback.forEach((t: any) => {
                const profit = Number(t.profit) + Number(t.commission) + Number(t.swap);
                const symbol = t.symbol.replace(/m$/, '');
                if (!instrumentMap.has(symbol)) instrumentMap.set(symbol, { wins: 0, losses: 0 });
                const inst = instrumentMap.get(symbol)!;
                if (profit > 0.1) inst.wins++;
                else if (profit < -0.1) inst.losses++;
            });
            return Array.from(instrumentMap.entries())
                .map(([symbol, data]) => ({ symbol, ...data, total: data.wins + data.losses }))
                .sort((a, b) => b.total - a.total)
                .slice(0, 5);
        }

        return [];
    }, [stats?.bySymbol, tradesFallback]);

    if (!stats && isStatsLoading) {
        return (
            <div className="flex items-center justify-center h-screen bg-slate-950">
                <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
            </div>
        );
    }

    const currentStats = stats || {
        totalPnL: 0,
        winRate: 0,
        totalTrades: 0,
        profitFactor: 0,
        radarMetrics: { consistency: 0, riskManagement: 0, discipline: 0, profitability: 0, winRate: 0 },
        dailyPnL: [],
        distribution: { wins: 0, losses: 0, breakeven: 0 }
    };

    return (
        <div className="p-6 space-y-6">
            {/* Renewal Alert */}
            {subStatus?.hasActive && subStatus?.daysLeft <= 5 && (
                <div className="bg-gradient-to-r from-amber-500/10 to-transparent border border-amber-500/20 p-4 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4 animate-in fade-in slide-in-from-top-4 duration-500">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-amber-500/20 rounded-xl text-amber-500">
                            <RefreshCw className={`w-6 h-6 ${isRenewing ? 'animate-spin' : ''}`} />
                        </div>
                        <div>
                            <h3 className="text-white font-bold">Sua assinatura expira em {subStatus.daysLeft} dias!</h3>
                            <p className="text-slate-400 text-sm">Não perca o acesso às suas métricas. Renove agora com um clique.</p>
                        </div>
                    </div>
                    <button
                        onClick={handleRenew}
                        disabled={isRenewing}
                        className="w-full md:w-auto px-6 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold rounded-xl transition-all shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2"
                    >
                        {isRenewing ? (
                            <>
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                Processando...
                            </>
                        ) : (
                            'Renovar Agora'
                        )}
                    </button>
                </div>
            )}

            {/* Header */}
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-white mb-2">Visão Geral</h1>
                    <p className="text-slate-400 flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${isStatsLoading ? 'bg-yellow-500' : 'bg-emerald-500'} animate-pulse`}></span>
                        {isStatsLoading ? 'Sincronizando...' : 'Dados atualizados em tempo real'}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                    <div className="flex bg-slate-800 p-1 rounded-xl border border-slate-700 overflow-x-auto no-scrollbar max-w-full">
                        {[
                            { label: 'Hoje', val: 'today' },
                            { label: 'Ontem', val: 'yesterday' },
                            { label: '7D', val: '7days' },
                            { label: '30D', val: '30days' },
                            { label: 'Tudo', val: 'all' },
                        ].map(opt => (
                            <button
                                key={opt.val}
                                onClick={() => handleDateFilter(opt.val)}
                                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${dateRange.value === opt.val ? 'bg-slate-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'}`}
                            >
                                {opt.label}
                            </button>
                        ))}

                        <div className="border-l border-slate-700 mx-1 pl-2 relative">
                            <button
                                onClick={() => setShowDatePicker(!showDatePicker)}
                                className={`p-1.5 rounded-lg transition-colors ${showDatePicker || dateRange.value === 'custom' ? 'text-indigo-400 bg-indigo-500/10' : 'text-slate-400 hover:text-white'}`}
                                title="Selecionar Período Personalizado"
                            >
                                <Calendar size={16} />
                            </button>

                            {showDatePicker && (
                                <div className="absolute top-full right-0 mt-2 p-4 bg-slate-900 border border-slate-700 rounded-xl shadow-xl z-50 w-64">
                                    <h4 className="text-xs font-bold text-white mb-3">Selecionar Período</h4>
                                    <div className="space-y-3">
                                        <div>
                                            <label className="text-[10px] uppercase text-slate-500 font-bold block mb-1">Início</label>
                                            <input
                                                type="date"
                                                value={customStart}
                                                onChange={e => setCustomStart(e.target.value)}
                                                className="w-full bg-slate-800 border-slate-700 rounded-lg text-xs p-2 text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] uppercase text-slate-500 font-bold block mb-1">Fim (Opcional)</label>
                                            <input
                                                type="date"
                                                value={customEnd}
                                                onChange={e => setCustomEnd(e.target.value)}
                                                className="w-full bg-slate-800 border-slate-700 rounded-lg text-xs p-2 text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                                            />
                                        </div>
                                        <button
                                            onClick={handleCustomRangeApply}
                                            className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-colors"
                                        >
                                            Aplicar Filtro
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <button onClick={() => refetchStats()} className="p-2 bg-slate-800 text-slate-300 rounded-xl hover:text-white hover:bg-slate-700 transition-all border border-slate-700">
                        <RefreshCw size={18} className={isStatsLoading ? 'animate-spin' : ''} />
                    </button>
                    <button className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-500 transition-all shadow-lg shadow-emerald-900/20">
                        Novo Trade Manual
                    </button>
                </div>
            </header>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard
                    title="Lucro Líquido"
                    value={`$${currentStats.totalPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
                    subtext="Total acumulado"
                    icon={DollarSign}
                    trend={currentStats.totalPnL >= 0 ? "up" : "down"}
                    trendValue={currentStats.totalPnL >= 0 ? "+ Profit" : "- Loss"}
                />

                <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col items-center justify-center relative overflow-hidden group hover:border-slate-700 transition-all">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-emerald-500/5 to-transparent rounded-full -mr-8 -mt-8" />
                    <h3 className="text-slate-400 text-sm font-medium mb-2 z-10 w-full text-left">Distribuição de Trades</h3>
                    <div className="z-10 scale-90 origin-top">
                        <WinrateGauge
                            wins={currentStats.distribution.wins}
                            losses={currentStats.distribution.losses}
                            breakeven={currentStats.distribution.breakeven}
                            trades={currentStats.totalTrades}
                        />
                    </div>
                </div>

                <StatCard
                    title="Profit Factor"
                    value={currentStats.profitFactor.toFixed(2)}
                    subtext="Rel. Risco/Retorno"
                    icon={Activity}
                    trend={currentStats.profitFactor > 1.5 ? "up" : "down"}
                    trendValue={currentStats.profitFactor > 1.5 ? "Bom" : "Check"}
                />
                <StatCard
                    title="Taxa de Acerto"
                    value={`${currentStats.winRate.toFixed(1)}%`}
                    subtext="Consistência Geral"
                    icon={BarChart3}
                    trend={currentStats.winRate > 50 ? "up" : "down"}
                    trendValue={currentStats.winRate > 50 ? "Alta" : "Foco"}
                />
            </div>

            {/* Main Performance Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 h-[450px]">
                    <DailyPnLChart data={currentStats.dailyPnL} />
                </div>
                <div className="lg:col-span-1 h-[450px]">
                    <PerformanceRadar data={currentStats.radarMetrics} />
                </div>
            </div>

            {/* Detailed Stats Section */}
            <div>
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <Activity size={20} className="text-indigo-500" />
                    Detalhamento Operacional
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div className="bg-[#0b0e14] border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-10">
                            <BarChart3 size={100} className="text-blue-500" />
                        </div>
                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-4 relative z-10">Top Instrumentos</h3>
                        <div className="flex flex-col gap-2 relative z-10">
                            {instrumentsData.map((item: any, idx: number) => (
                                <InstrumentRow key={idx} {...item} />
                            ))}
                            {instrumentsData.length === 0 && <span className="text-xs text-slate-600 text-center py-4">Sem dados de instrumentos</span>}
                        </div>
                    </div>

                    <div className="bg-[#0b0e14] border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-10">
                            <Globe size={100} className="text-purple-500" />
                        </div>
                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-4 relative z-10">Sessões Ativas</h3>
                        <div className="flex flex-col gap-2 relative z-10">
                            {sessionsData.map((session: any, idx: number) => (
                                <SessionRow key={idx} {...session} />
                            ))}
                        </div>
                    </div>

                    <div className="bg-[#0b0e14] border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden flex flex-col justify-center">
                        <div className="absolute top-0 right-0 p-3 opacity-10">
                            <Activity size={80} className="text-blue-500" />
                        </div>
                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-1 relative z-10 text-center">Saúde & Disciplina</h3>
                        <TraderHealthWidget
                            score={currentStats.healthScore?.score}
                            details={currentStats.healthScore?.details}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};
