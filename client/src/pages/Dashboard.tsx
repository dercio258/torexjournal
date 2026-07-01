import { useState, useMemo, useEffect } from 'react';
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
// import { HeatmapChart } from '../components/dashboard/charts/HeatmapChart';
import { WinrateGauge, InstrumentRow, SessionRow, TraderHealthWidget } from '../components/dashboard/StatsWidgets';
import { useDashboardStats, useSubscriptionStatus, useTradesFallback } from '../hooks/useDashboard';
import { useAuth } from '../context/AuthContext';
import { PlanModal } from '../components/dashboard/PlanModal';
import { DateBoundaryBanner } from '../components/dashboard/DateBoundaryBanner';
import api from '../api';

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
    const [includeToday, setIncludeToday] = useState(() => {
        return localStorage.getItem('trading_cossa_include_today') === 'true';
    });

    // Date Filter State - Defaults to 30 days
    const [dateRange, setDateRange] = useState({ 
        label: 'Últimos 30 Dias', 
        value: '30days', 
        start: '', 
        end: '' 
    });
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');
    const [showRenewalModal, setShowRenewalModal] = useState(false);

    const { user } = useAuth();
    const { data: subStatus } = useSubscriptionStatus();

    const [showDailyExpirationModal, setShowDailyExpirationModal] = useState(false);

    useEffect(() => {
        if (subStatus?.showWarning) {
            setShowDailyExpirationModal(true);
        }
    }, [subStatus]);

    const handleCloseExpirationModal = async () => {
        setShowDailyExpirationModal(false);
        try {
            await api.post('/subscription/warned');
        } catch (error) {
            console.error("Failed to mark warning as shown on server", error);
        }
    };

    // Memoized query start and end date calculation
    const queryDates = useMemo(() => {
        const now = new Date();
        let start = new Date();
        let end = new Date();

        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);

        if (!includeToday) {
            end.setDate(now.getDate() - 1);
            end.setHours(23, 59, 59, 999);
        }

        switch (dateRange.value) {
            case 'today':
                if (!includeToday) {
                    // Show yesterday instead
                    start.setDate(now.getDate() - 1);
                    start.setHours(0, 0, 0, 0);
                } else {
                    start.setHours(0, 0, 0, 0);
                }
                break;
            case 'yesterday':
                start.setDate(now.getDate() - 1);
                start.setHours(0, 0, 0, 0);
                end.setDate(now.getDate() - 1);
                end.setHours(23, 59, 59, 999);
                break;
            case '7days':
                if (!includeToday) {
                    start.setDate(now.getDate() - 7);
                } else {
                    start.setDate(now.getDate() - 6);
                }
                break;
            case '30days':
                if (!includeToday) {
                    start.setDate(now.getDate() - 30);
                } else {
                    start.setDate(now.getDate() - 29);
                }
                break;
            case 'all':
                start = new Date('2020-01-01');
                break;
            case 'custom':
                if (customStart) {
                    start = new Date(customStart);
                    start.setHours(0, 0, 0, 0);
                }
                if (customEnd) {
                    end = new Date(customEnd);
                    end.setHours(23, 59, 59, 999);
                }
                if (!includeToday) {
                    const yesterdayLimit = new Date();
                    yesterdayLimit.setDate(now.getDate() - 1);
                    yesterdayLimit.setHours(23, 59, 59, 999);
                    if (end > yesterdayLimit) {
                        end = yesterdayLimit;
                    }
                }
                break;
        }

        return {
            start: start.toISOString(),
            end: end.toISOString()
        };
    }, [dateRange.value, includeToday, customStart, customEnd]);

    const { data: stats, isLoading: isStatsLoading, refetch: refetchStats } = useDashboardStats(queryDates.start, queryDates.end);
    const { data: tradesFallback } = useTradesFallback();

    const handleDateFilter = (range: string) => {
        let label = 'Hoje';
        if (range === 'yesterday') label = 'Ontem';
        else if (range === '7days') label = '7D';
        else if (range === '30days') label = '30D';
        else if (range === 'all') label = 'Tudo';

        setDateRange({ 
            label, 
            value: range, 
            start: '', 
            end: '' 
        });
    };

    const handleCustomRangeApply = () => {
        if (!customStart) return;

        setDateRange({
            label: 'Personalizado',
            value: 'custom',
            start: '',
            end: ''
        });
        setShowDatePicker(false);
    };

    const handleToggleIncludeToday = () => {
        const nextVal = !includeToday;
        setIncludeToday(nextVal);
        localStorage.setItem('trading_cossa_include_today', String(nextVal));
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
            {/* Account Activation Block overlay */}
            {subStatus && !subStatus.hasActive && (
                <PlanModal type={subStatus.isExpired ? 'PLAN_EXPIRED' : 'NO_ACTIVE_PLAN'} />
            )}

            {/* Daily Expiration Warning Modal */}
            {showDailyExpirationModal && (
                <PlanModal 
                    type="NEAR_EXPIRATION_WARNING" 
                    onClose={handleCloseExpirationModal}
                    daysLeft={subStatus?.daysLeft}
                />
            )}

            {/* Renewal Modal */}
            {showRenewalModal && (
                <PlanModal 
                    type="RENEWAL_CONFIRMATION" 
                    onClose={() => setShowRenewalModal(false)}
                    savedPaymentMethod={(user as any)?.lastPaymentMethod}
                    savedPhoneNumber={(user as any)?.lastPaymentMethod === 'mpesa' ? (user as any)?.preferredMpesa : (user as any)?.preferredEmola}
                    planTier={subStatus?.tier}
                />
            )}

            {/* Renewal Alert */}
            {subStatus?.hasActive && subStatus?.daysLeft <= 5 && (
                <div className="bg-gradient-to-r from-amber-500/10 to-transparent border border-amber-500/20 p-4 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4 animate-in fade-in slide-in-from-top-4 duration-500">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-amber-500/20 rounded-xl text-amber-500">
                            <RefreshCw className="w-6 h-6" />
                        </div>
                        <div>
                            <h3 className="text-white font-bold">Sua assinatura expira em {subStatus.daysLeft} dias!</h3>
                            <p className="text-slate-400 text-sm">Não perca o acesso às suas métricas. Renove agora com um clique.</p>
                        </div>
                    </div>
                    <button
                        onClick={() => setShowRenewalModal(true)}
                        className="w-full md:w-auto px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl transition-all shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2"
                    >
                        Renovar Agora
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
                                onClick={() => setShowDatePicker(true)}
                                className={`p-1.5 rounded-lg transition-colors ${dateRange.value === 'custom' ? 'text-indigo-400 bg-indigo-500/10' : 'text-slate-400 hover:text-white'}`}
                                title="Selecionar Período Personalizado"
                            >
                                <Calendar size={16} />
                            </button>
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

            {/* Date Boundary Indicator */}
            <DateBoundaryBanner 
                includeToday={includeToday} 
                onToggle={handleToggleIncludeToday} 
            />

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

            {/* Heatmap Section - Removida conforme solicitação
            <div className="h-[400px]">
                <HeatmapChart endDate={queryDates.end} />
            </div>
            */}

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

            {/* Custom Date Picker Modal */}
            {showDatePicker && (
                <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
                    <div className="bg-slate-900 border border-slate-800/80 rounded-3xl p-6 shadow-2xl max-w-sm w-full space-y-5 relative overflow-hidden animate-in zoom-in-95 duration-200">
                        {/* Modal Glow */}
                        <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-indigo-500/10 to-transparent rounded-full" />
                        
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 bg-indigo-500/10 text-indigo-400 rounded-xl border border-indigo-500/20">
                                <Calendar size={20} />
                            </div>
                            <div>
                                <h3 className="text-white font-bold text-sm">Filtro Personalizado</h3>
                                <p className="text-xs text-slate-500">Defina o intervalo de datas operacional</p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="text-[10px] uppercase text-slate-400 font-bold tracking-wider block mb-1.5">Data de Início</label>
                                <input
                                    type="date"
                                    value={customStart}
                                    onChange={e => setCustomStart(e.target.value)}
                                    className="w-full bg-slate-950 border border-slate-800 rounded-xl text-xs p-3 text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase text-slate-400 font-bold tracking-wider block mb-1.5">Data de Fim (Opcional)</label>
                                <input
                                    type="date"
                                    value={customEnd}
                                    onChange={e => setCustomEnd(e.target.value)}
                                    className="w-full bg-slate-950 border border-slate-800 rounded-xl text-xs p-3 text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                                />
                            </div>
                        </div>

                        <div className="flex gap-3 pt-2">
                            <button
                                onClick={() => setShowDatePicker(false)}
                                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700/80 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition-colors border border-slate-700/50"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleCustomRangeApply}
                                disabled={!customStart}
                                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-indigo-600/10 active:scale-95"
                            >
                                Aplicar Filtro
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
