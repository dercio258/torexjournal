import { useEffect, useState } from 'react';
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

// Register ChartJS
ChartJS.register(
    ArcElement,
    Tooltip,
    Legend
);

// --- TYPES ---
interface DashboardStats {
    totalPnL: number;
    winRate: number;
    totalTrades: number;
    profitFactor: number;
    radarMetrics: {
        consistency: number;
        riskManagement: number;
        discipline: number;
        profitability: number;
        winRate: number;
    };
    dailyPnL: { date: string; value: number }[]; // Mapped from backend {date, pnl}
    distribution: { wins: number; losses: number; breakeven: number }; // We might need to calc this or get from backend
    healthScore?: { score: number; details: any };
}



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
    // const { userEmail } = useAuth(); // Unused
    const [isLoading, setIsLoading] = useState(true);
    const [stats, setStats] = useState<DashboardStats>({
        totalPnL: 0,
        winRate: 0,
        totalTrades: 0,
        profitFactor: 0,
        radarMetrics: { consistency: 0, riskManagement: 0, discipline: 0, profitability: 0, winRate: 0 },
        dailyPnL: [],
        distribution: { wins: 0, losses: 0, breakeven: 0 }
    });


    const [calculatedStats, setCalculatedStats] = useState({
        instruments: [] as { symbol: string, wins: number, losses: number }[],
        sessions: [] as { name: string, percent: number, active: boolean, pnl: number }[]
    });

    // Date Filter State
    const [dateRange, setDateRange] = useState({ label: 'Hoje', value: 'today', start: '', end: '' });
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');

    useEffect(() => {
        // Initialize default dates (Today)
        handleDateFilter('today');
    }, []);

    const handleDateFilter = (range: string) => {
        const now = new Date();
        let start = new Date();
        let end = new Date();

        // Reset hours to cover full days correctly
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);

        let label = 'Hoje';

        switch (range) {
            case 'today':
                // start and end are already today
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
                start = new Date('2020-01-01'); // Way back
                label = 'Todo Período';
                break;
            case 'custom':
                // Custom date will be set by the picker
                return;
        }

        const startStr = start.toISOString();
        const endStr = end.toISOString();

        setDateRange({ label, value: range, start: startStr, end: endStr });
        fetchDashboardData(startStr, endStr);
    };


    const handleCustomRangeApply = () => {
        if (!customStart) return;

        const start = new Date(customStart);
        start.setHours(0, 0, 0, 0);

        const end = customEnd ? new Date(customEnd) : new Date(customStart); // Default to single day if no end
        end.setHours(23, 59, 59, 999);

        const startStr = start.toISOString();
        const endStr = end.toISOString();

        setDateRange({
            label: customEnd ? `${new Date(customStart).toLocaleDateString()} - ${new Date(end).toLocaleDateString()}` : new Date(customStart).toLocaleDateString(),
            value: 'custom',
            start: startStr,
            end: endStr
        });

        fetchDashboardData(startStr, endStr);
        setShowDatePicker(false);
    };

    const fetchDashboardData = async (start = dateRange.start, end = dateRange.end) => {
        setIsLoading(true);
        try {
            // Fetch Performance with Filters
            const params = { startDate: start, endDate: end };
            const [perfRes, scoreRes] = await Promise.all([
                api.get('/performance', { params }),
                api.get('/alerts/score')
            ]);

            if (perfRes.data) {
                // Map backend response to our state structure
                // Backend dailyPnL is {date, pnl}, chart expects {date, value}
                const mappedDaily = perfRes.data.dailyPnL.map((d: any) => ({
                    date: new Date(d.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
                    value: isNaN(Number(d.pnl)) ? 0 : Number(d.pnl)
                }));

                // Calculate distribution (rough approx if backend doesn't send exact counts)
                // Backend sends winRate & totalTrades.
                const total = perfRes.data.totalTrades || 0;
                const wins = Math.round((perfRes.data.winRate / 100) * total);
                const losses = total - wins; // Assuming 0 BE for now or simple logic

                console.log('Dashboard Performance Data:', perfRes.data);
                console.log('Mapped Daily PnL:', mappedDaily);

                setStats({
                    ...perfRes.data,
                    dailyPnL: perfRes.data.tradePnL ? perfRes.data.tradePnL.map((t: any) => ({
                        date: new Date(t.date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
                        value: Number(t.value) || 0,
                        ticket: t.ticket
                    })).reverse() : mappedDaily, // Use trade PnL if available, otherwise daily
                    distribution: { wins, losses, breakeven: 0 },
                    healthScore: scoreRes.data
                });

                // Update sessions from performance data
                const rawSessions = perfRes.data.bySession || [];
                const currentHour = new Date().getUTCHours();
                const isLondon = currentHour >= 8 && currentHour < 17;
                const isNY = currentHour >= 13 && currentHour < 22;
                const isAsian = currentHour >= 0 && currentHour < 9;

                // Ensure standard sessions are always present
                const standardSessions = ['London', 'New York', 'Asian'];
                const existingSessions = rawSessions.map((s: any) => s.session);

                const mergedSessions = [...rawSessions];
                standardSessions.forEach(s => {
                    if (!existingSessions.some((es: string) => es.includes(s))) {
                        mergedSessions.push({ session: s, count: 0, pnl: 0 });
                    }
                });

                const totalSessionTrades = mergedSessions.reduce((acc: number, s: any) => acc + s.count, 0);

                const sessionsData = mergedSessions
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

                setCalculatedStats(prev => ({
                    ...prev,
                    sessions: sessionsData
                }));
            }

            // Re-fetch Trades for detailed stats calculation
            const tradesRes = await api.get('/trades');
            if (Array.isArray(tradesRes.data)) {
                const trades = tradesRes.data;
                const instrumentMap = new Map<string, { wins: number, losses: number }>();
                const sessionCounts = { 'London': 0, 'New York': 0, 'Asian': 0, 'Sydney': 0 };
                let totalSessionTrades = 0;

                trades.forEach((t: any) => {
                    const profit = Number(t.profit) + Number(t.commission) + Number(t.swap);
                    const symbol = t.symbol.replace(/m$/, '');

                    if (!instrumentMap.has(symbol)) instrumentMap.set(symbol, { wins: 0, losses: 0 });
                    const inst = instrumentMap.get(symbol)!;
                    if (profit >= 0) inst.wins++; else inst.losses++;

                    const sess = t.session || 'Unknown';
                    if (sess.includes('London')) sessionCounts['London']++;
                    if (sess.includes('New York')) sessionCounts['New York']++;
                    if (sess.includes('Tokyo') || sess.includes('Sydney') || sess.includes('Asia')) sessionCounts['Asian']++;
                    if (t.session && t.session !== '-') totalSessionTrades++;
                });

                const sortedInstruments = Array.from(instrumentMap.entries())
                    .map(([symbol, data]) => ({ symbol, ...data, total: data.wins + data.losses }))
                    .sort((a, b) => b.total - a.total)
                    .slice(0, 5);

                setCalculatedStats(prev => ({
                    ...prev,
                    instruments: sortedInstruments
                }));
            }



        } catch (err) {
            console.error('Failed to fetch dashboard data', err);
        } finally {
            setIsLoading(false);
        }
    };

    // Derived Data for Charts


    return (
        <div className="p-6 space-y-6">
            {/* Header */}
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-white mb-2">Visão Geral</h1>
                    <p className="text-slate-400 flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${isLoading ? 'bg-yellow-500' : 'bg-emerald-500'} animate-pulse`}></span>
                        {isLoading ? 'Sincronizando...' : 'Dados atualizados em tempo real'}
                    </p>
                </div>
                <div className="flex gap-3">
                    <div className="flex bg-slate-800 p-1 rounded-xl border border-slate-700">
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

                        {/* Custom Date Picker Trigger */}
                        <div className="border-l border-slate-700 mx-1 pl-2 relative">
                            <button
                                onClick={() => setShowDatePicker(!showDatePicker)}
                                className={`p-1.5 rounded-lg transition-colors ${showDatePicker || dateRange.value === 'custom' ? 'text-indigo-400 bg-indigo-500/10' : 'text-slate-400 hover:text-white'}`}
                                title="Selecionar Período Personalizado"
                            >
                                <Calendar size={16} />
                            </button>

                            {/* Date Picker Popover */}
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

                    <button onClick={() => fetchDashboardData()} className="p-2 bg-slate-800 text-slate-300 rounded-xl hover:text-white hover:bg-slate-700 transition-all border border-slate-700">
                        <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
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
                    value={`$${stats.totalPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
                    subtext="Total acumulado"
                    icon={DollarSign}
                    trend={stats.totalPnL >= 0 ? "up" : "down"}
                    trendValue={stats.totalPnL >= 0 ? "+ Profit" : "- Loss"}
                />
                <StatCard
                    title="Taxa de Acerto"
                    value={`${stats.winRate.toFixed(1)}%`}
                    subtext={`${stats.totalTrades} trades totais`}
                    icon={Activity} // Using Activity as Target might be shadowed
                    trend={stats.winRate > 50 ? "up" : "down"}
                    trendValue={stats.winRate > 50 ? "Positive" : "Negative"}
                />
                <StatCard
                    title="Profit Factor"
                    value={stats.profitFactor.toFixed(2)}
                    subtext="Rel. Risco/Retorno"
                    icon={Activity}
                    trend={stats.profitFactor > 1.5 ? "up" : "down"}
                    trendValue={stats.profitFactor > 1.5 ? "Bom" : "Check"}
                />    {/* Distribution Card (Replaces Sequence) */}

            </div>

            {/* Main Performance Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Advanced PnL Chart (2/3 width) */}
                <div className="lg:col-span-2 h-[450px]">
                    <DailyPnLChart data={stats.dailyPnL} />
                </div>

                {/* Performance Radar (1/3 width) */}
                <div className="lg:col-span-1 h-[450px]">
                    <PerformanceRadar data={stats.radarMetrics} />
                </div>
            </div>

            {/* Detailed Stats Section (New Section) */}
            <div>
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <Activity size={20} className="text-indigo-500" />
                    Detalhamento Operacional
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {/* Winrate Gauge Card */}
                    <div className="bg-[#0b0e14] border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col items-center justify-center relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-10">
                            <Activity size={100} className="text-emerald-500" />
                        </div>
                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-4 z-10">Winrate Geral</h3>
                        <div className="z-10">
                            <WinrateGauge winrate={stats.winRate} trades={stats.totalTrades} />
                        </div>
                    </div>

                    {/* Instruments Card */}
                    <div className="bg-[#0b0e14] border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-10">
                            <BarChart3 size={100} className="text-blue-500" />
                        </div>
                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-4 relative z-10">Top Instrumentos</h3>
                        <div className="flex flex-col gap-2 relative z-10">
                            {calculatedStats.instruments.map((item, idx) => (
                                <InstrumentRow key={idx} {...item} />
                            ))}
                            {calculatedStats.instruments.length === 0 && <span className="text-xs text-slate-600 text-center py-4">Sem dados de instrumentos</span>}
                        </div>
                    </div>

                    {/* Sessions Card */}
                    <div className="bg-[#0b0e14] border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-10">
                            <Globe size={100} className="text-purple-500" />
                        </div>
                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-4 relative z-10">Sessões Ativas</h3>
                        <div className="flex flex-col gap-2 relative z-10">
                            {calculatedStats.sessions.map((session, idx) => (
                                <SessionRow key={idx} {...session} />
                            ))}
                        </div>
                    </div>

                    {/* Trader Health Card (New) */}
                    <div className="bg-[#0b0e14] border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden flex flex-col justify-center">
                        <div className="absolute top-0 right-0 p-3 opacity-10">
                            <Activity size={80} className="text-blue-500" />
                        </div>
                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-1 relative z-10 text-center">Saúde & Disciplina</h3>
                        <TraderHealthWidget
                            score={stats.healthScore?.score}
                            details={stats.healthScore?.details}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

// Internal Target Icon replacement (since Lucide Target might conflict if not careful, I used Lucide Target above)

