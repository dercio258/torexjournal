import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
    Activity,
    DollarSign,
    Calendar,
    BarChart3,
    ArrowUpRight,
    ArrowDownRight,
    RefreshCw,
    Plus,
    TrendingUp
} from 'lucide-react';
import {
    Chart as ChartJS,
    ArcElement,
    Tooltip,
    Legend
} from 'chart.js';
import { PnLChart } from '../components/charts/PnLChart';
import { PerformanceScores } from '../components/dashboard/PerformanceScores';
import { OperationalBreakdown, toSessionRows, toSymbolRows, toWeekdayRows } from '../components/dashboard/OperationalBreakdown';
import { detectPnLStatus, WinrateGauge, WinRateGaugeChart, ProfitFactorDonut } from '../components/dashboard/StatsWidgets';
import { useDashboardStats, useSubscriptionStatus } from '../hooks/useDashboard';
import { buttonVariants } from '../components/ui/Button';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { PropFirmProgressCard } from '../components/dashboard/PropFirmProgressCard';
import { ConsolidatedDashboardView } from '../components/dashboard/ConsolidatedDashboardView';
import { PlanModal } from '../components/dashboard/PlanModal';
import { TrialCelebrationModal } from '../components/subscription/TrialCelebrationModal';
import api from '../api';

// Register ChartJS
ChartJS.register(
    ArcElement,
    Tooltip,
    Legend
);

// --- INSTITUTIONAL STAT CARD COMPONENT ---
interface StatCardProps {
    title: string;
    value: string;
    subtext?: string;
    icon: any;
    trend?: 'up' | 'down' | 'neutral';
    trendValue?: string;
}

export const StatCard = ({ title, value, subtext, icon: Icon, trend, trendValue }: StatCardProps) => {
    const isUp = trend === 'up';

    return (
        <div className="bg-surface/80 backdrop-blur-md border border-line hover:border-line-strong rounded-xl p-3.5 sm:p-4 transition-all duration-200 shadow-sm flex flex-col justify-between group">
            <div className="flex justify-between items-center mb-2">
                <span className="text-xs sm:text-[13px] font-bold text-fg uppercase tracking-wide">{title}</span>
                <div className="flex items-center gap-1.5">
                    {trend && (
                        <span className={`inline-flex items-center gap-0.5 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                            isUp 
                                ? 'bg-accent/10 text-accent-fg' 
                                : 'bg-rose-500/10 text-danger-fg'
                        }`}>
                            {isUp ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                            {trendValue}
                        </span>
                    )}
                    <div className="p-1 rounded-md bg-surface-2 text-fg-muted">
                        <Icon size={14} />
                    </div>
                </div>
            </div>

            <div>
                <div className={`text-xl sm:text-2xl font-black font-mono tracking-tight ${
                    title.includes('Lucro') 
                        ? (value.includes('-') ? 'text-danger-fg' : 'text-accent-fg')
                        : 'text-fg'
                }`}>
                    {value}
                </div>
                {subtext && (
                    <p className="text-[11px] text-fg-subtle mt-0.5 font-medium truncate">
                        {subtext}
                    </p>
                )}
            </div>
        </div>
    );
};

export const Dashboard = () => {
    // Date Filter State - Defaults to all time ('all') so existing trade history is immediately visible
    const [dateRange, setDateRange] = useState(() => {
        const saved = localStorage.getItem('torex_dashboard_date_range');
        if (saved) {
            try { 
                const parsed = JSON.parse(saved);
                if (['all', 'yesterday', '7days', '30days', 'custom'].includes(parsed.value)) {
                    return parsed;
                }
            } catch (e) {}
        }
        return { 
            label: 'Tudo', 
            value: 'all', 
            start: '', 
            end: '' 
        };
    });
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');
    const [showRenewalModal, setShowRenewalModal] = useState(false);

    const { user } = useAuth();
    const { selectedAccountId, selectedAccount, isConsolidated } = useAccount();
    const { data: subStatus } = useSubscriptionStatus();

    const [showDailyExpirationModal, setShowDailyExpirationModal] = useState(false);

    useEffect(() => {
        const warnedThisSession = sessionStorage.getItem('torex_expiration_warned');
        if (subStatus?.showWarning && !warnedThisSession) {
            setShowDailyExpirationModal(true);
        }
    }, [subStatus]);

    const handleCloseExpirationModal = async () => {
        setShowDailyExpirationModal(false);
        sessionStorage.setItem('torex_expiration_warned', 'true');
        try {
            await api.post('/subscription/warned');
        } catch (error) {
            console.error("Failed to mark warning as shown on server", error);
        }
    };

    const [showTrialModal, setShowTrialModal] = useState(false);

    useEffect(() => {
        const seen = localStorage.getItem('torex_trial_modal_seen');
        if (user?.trialJustGranted && !seen) {
            setShowTrialModal(true);
        } else if (user?.hasUsedTrial && !seen && user?.tier === 'PREMIUM') {
            setShowTrialModal(true);
        }
    }, [user]);

    const greeting = useMemo(() => {
        const hour = new Date().getHours();
        if (hour >= 5 && hour < 12) return 'Bom dia';
        if (hour >= 12 && hour < 18) return 'Boa tarde';
        return 'Boa noite';
    }, []);

    const displayName = user?.name ? user.name.split(' ')[0] : (user?.username || 'Trader');

    // Memoized query start and end date calculation (always includes current/today data naturally)
    const queryDates = useMemo(() => {
        const now = new Date();
        let start = new Date();
        let end = new Date();

        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);

        switch (dateRange.value) {
            case 'today':
                start.setHours(0, 0, 0, 0);
                break;
            case 'yesterday':
                start.setDate(now.getDate() - 1);
                start.setHours(0, 0, 0, 0);
                end.setDate(now.getDate() - 1);
                end.setHours(23, 59, 59, 999);
                break;
            case '7days':
                start.setDate(now.getDate() - 7);
                start.setHours(0, 0, 0, 0);
                break;
            case '30days':
                start.setDate(now.getDate() - 30);
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
                break;
        }

        return {
            start: start.toISOString(),
            end: end.toISOString()
        };
    }, [dateRange.value, customStart, customEnd]);

    const { data: stats, isLoading: isStatsLoading, refetch: refetchStats } = useDashboardStats(queryDates.start, queryDates.end, selectedAccountId);

    const handleDateFilter = (range: string) => {
        let label = 'Tudo';
        if (range === 'today') label = 'Hoje';
        else if (range === 'yesterday') label = 'Ontem';
        else if (range === '7days') label = '7D';
        else if (range === '30days') label = '30D';
        else if (range === 'all') label = 'Tudo';

        const newRange = { 
            label, 
            value: range, 
            start: '', 
            end: '' 
        };
        setDateRange(newRange);
        localStorage.setItem('torex_dashboard_date_range', JSON.stringify(newRange));
    };

    const handleCustomRangeApply = () => {
        if (!customStart) return;

        const newRange = {
            label: 'Personalizado',
            value: 'custom',
            start: customStart,
            end: customEnd
        };
        setDateRange(newRange);
        localStorage.setItem('torex_dashboard_date_range', JSON.stringify(newRange));
        setShowDatePicker(false);
    };

    // Breakdowns come from the same filtered, closed trades as every other dashboard number.
    const breakdown = useMemo(
        () => ({
            symbols: toSymbolRows(stats?.bySymbol),
            sessions: toSessionRows(stats?.bySession),
            weekdays: toWeekdayRows(stats?.byWeekday),
        }),
        [stats?.bySymbol, stats?.bySession, stats?.byWeekday]
    );

    const currentStats = stats || {
        totalPnL: 0,
        winRate: 0,
        totalTrades: 0,
        profitFactor: 0,
        radarMetrics: { consistency: 0, riskManagement: 0, discipline: 0, profitability: 0, winRate: 0 },
        dailyPnL: [],
        tradePnL: [],
        distribution: { wins: 0, losses: 0, breakeven: 0 }
    };

    if (!stats && isStatsLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] bg-canvas gap-3">
                <RefreshCw className="w-8 h-8 text-accent-fg animate-spin" />
                <p className="text-xs text-fg-muted font-mono">Sincronizando métricas operacionais...</p>
            </div>
        );
    }

    return (
        <div className="space-y-4 pb-6">
            {/* Subscription Expiration Alert Banner */}
            {subStatus && subStatus.daysLeft !== undefined && subStatus.daysLeft <= 5 && subStatus.daysLeft > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/20 p-3.5 rounded-xl flex flex-col md:flex-row items-center justify-between gap-3 animate-in fade-in duration-300">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-500/20 rounded-lg text-amber-600 dark:text-amber-400">
                            <RefreshCw className="w-4 h-4" />
                        </div>
                        <div>
                            <h3 className="text-fg font-bold text-xs sm:text-sm">Sua assinatura expira em {subStatus.daysLeft} dias!</h3>
                            <p className="text-fg-muted text-xs">Renove com um clique para manter seu histórico sincronizado.</p>
                        </div>
                    </div>
                    <button
                        onClick={() => setShowRenewalModal(true)}
                        className="w-full md:w-auto px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg transition-all shadow-sm active:scale-95"
                    >
                        Renovar Agora
                    </button>
                </div>
            )}

            {/* COMPACT TOOLBAR BAR: Segmented Pills + Refresh + Add Trade */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-0.5">
                <div className="flex items-center gap-1.5 text-sm font-medium text-fg-muted ">
                    <span>{greeting}, <strong className="font-semibold text-fg ">{displayName}</strong></span>
                </div>

                {/* Toolbar: Segmented Filters + Refresh + Add Trade */}
                <div className="flex flex-wrap items-center gap-2">
                    {/* Segmented Date Pills */}
                    <div className="flex bg-surface p-1 rounded-lg border border-line overflow-x-auto no-scrollbar gap-1">
                        {[
                            { label: 'Tudo', val: 'all' },
                            { label: 'Ontem', val: 'yesterday' },
                            { label: '7D', val: '7days' },
                            { label: '30D', val: '30days' },
                        ].map(opt => (
                            <button
                                key={opt.val}
                                onClick={() => handleDateFilter(opt.val)}
                                className={`px-3 py-1 text-xs rounded-md transition-all cursor-pointer ${
 dateRange.value === opt.val 
 ? 'bg-accent/10 border border-accent/40 text-accent-fg font-semibold' 
 : 'text-fg-muted hover:text-fg hover:bg-surface-2 border border-transparent'
 }`}
                            >
                                {opt.label}
                            </button>
                        ))}

                        <div className="border-l border-line mx-0.5 pl-0.5 flex items-center">
                            <button
                                onClick={() => setShowDatePicker(true)}
                                className={`p-1.5 rounded-md transition-colors cursor-pointer ${
 dateRange.value === 'custom' 
 ? 'text-accent-fg bg-accent/10 border border-accent/40' 
 : 'text-fg-muted hover:text-fg hover:bg-surface-2 '
 }`}
                                title="Selecionar Período Personalizado"
                            >
                                <Calendar size={13} />
                            </button>
                        </div>
                    </div>

                    {/* Refresh Button */}
                    <button 
                        onClick={() => refetchStats()} 
                        className="p-2 bg-surface hover:bg-surface-2 text-fg-muted hover:text-fg rounded-lg transition-all border border-line hover:border-accent/40 active:scale-95 cursor-pointer"
                        title="Atualizar Métricas"
                    >
                        <RefreshCw size={14} className={isStatsLoading ? 'animate-spin text-accent-fg' : ''} />
                    </button>

                    {/* Add Trade Link Button */}
                    <Link 
                        to="/add-trades"
                        className={buttonVariants({ variant: 'brand', size: 'sm', pill: true, className: 'px-3.5' })}
                    >
                        <Plus size={14} strokeWidth={2.5} />
                        <span>Novo Trade</span>
                    </Link>
                </div>
            </div>

            {isConsolidated ? (
                <ConsolidatedDashboardView stats={currentStats} />
            ) : (
                <>
                    {/* Prop Firm Rules & Progress (if applicable) */}
                    <PropFirmProgressCard 
                        propFirmStatus={currentStats.propFirmStatus} 
                        currency={selectedAccount?.currency} 
                    />

                    {/* 4 HIGH-PRIORITY METRIC CARDS IN A ROW ON DESKTOP */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {/* 1. Total P&L */}
                        {(() => {
                            const pnlInfo = detectPnLStatus(currentStats.totalPnL);
                            const TrendIcon = pnlInfo.trendIcon;

                            return (
                                <div className="relative bg-surface border border-line rounded-xl p-4 sm:p-5 hover:border-line-strong transition-colors flex flex-col justify-between min-h-[195px] overflow-hidden group">

                                    {/* Header / Label */}
                                    <div className="flex justify-between items-center w-full">
                                        <span className="text-[11px] font-semibold text-fg-muted uppercase tracking-[0.05em]">
                                            TOTAL P&L
                                        </span>
                                        <div className="p-1.5 rounded-lg bg-canvas border border-line text-fg-subtle group-hover:text-accent-fg transition-colors">
                                            <DollarSign size={14} />
                                        </div>
                                    </div>

                                    {/* Value - Centered */}
                                    <div className="my-auto py-2 flex flex-col items-center justify-center text-center">
                                        <span className={`text-2xl sm:text-[30px] font-bold font-mono tracking-tight leading-none ${pnlInfo.textClass}`}>
                                            {pnlInfo.formattedValue}
                                        </span>
                                    </div>

                                    {/* Context / Badge - Centered */}
                                    <div className="flex items-center justify-center w-full">
                                        <span className={`inline-flex items-center gap-1 text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-full ${pnlInfo.badgeBg}`}>
                                            {TrendIcon && <TrendIcon size={11} />}
                                            {pnlInfo.badgeLabel}
                                        </span>
                                    </div>
                                </div>
                            );
                        })()}

                        {/* 2. Total Trades with WinrateGauge Chart */}
                        <div className="relative bg-surface border border-line rounded-xl p-4 sm:p-5 hover:border-line-strong transition-colors flex flex-col justify-between min-h-[195px] overflow-hidden group">

                            {/* Header / Label */}
                            <div className="flex justify-between items-center w-full">
                                <span className="text-[11px] font-semibold text-fg-muted uppercase tracking-[0.05em]">
                                    TOTAL TRADES
                                </span>
                                <div className="p-1.5 rounded-lg bg-canvas border border-line text-fg-subtle group-hover:text-fg transition-colors">
                                    <Activity size={14} />
                                </div>
                            </div>

                            {/* Gauge Chart - Centered */}
                            <div className="my-auto flex flex-col items-center justify-center">
                                <WinrateGauge 
                                    wins={currentStats.distribution.wins} 
                                    losses={currentStats.distribution.losses} 
                                    breakeven={currentStats.distribution.breakeven} 
                                    trades={currentStats.totalTrades} 
                                />
                            </div>
                        </div>

                        {/* 3. Win Rate with WinRateGaugeChart */}
                        <div className="relative bg-surface border border-line rounded-xl p-4 sm:p-5 hover:border-line-strong transition-colors flex flex-col justify-between min-h-[195px] overflow-hidden group">

                            {/* Header / Label */}
                            <div className="flex justify-between items-center w-full">
                                <span className="text-[11px] font-semibold text-fg-muted uppercase tracking-[0.05em]">
                                    TAXA DE ACERTO
                                </span>
                                <div className="p-1.5 rounded-lg bg-canvas border border-line text-fg-subtle group-hover:text-accent-fg transition-colors">
                                    <TrendingUp size={14} />
                                </div>
                            </div>

                            {/* Gauge Chart - Centered */}
                            <div className="my-auto flex flex-col items-center justify-center py-1">
                                <WinRateGaugeChart 
                                    winRate={currentStats.winRate} 
                                    wins={currentStats.distribution.wins} 
                                    losses={currentStats.distribution.losses} 
                                />
                            </div>

                            {/* Context / Badge - Centered */}
                            <div className="flex items-center justify-center w-full">
                                <span className={`text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full ${
                                    currentStats.winRate >= 50 
                                        ? 'bg-accent/10 text-accent-fg border border-accent/20' 
                                        : 'bg-danger/10 text-danger-fg border border-danger/20'
                                }`}>
                                    {currentStats.winRate >= 50 ? 'Consistente' : 'Ajustar'}
                                </span>
                            </div>
                        </div>

                        {/* 4. Profit Factor with ProfitFactorDonut */}
                        <div className="relative bg-surface border border-line rounded-xl p-4 sm:p-5 hover:border-line-strong transition-colors flex flex-col justify-between min-h-[195px] overflow-hidden group">

                            {/* Header / Label */}
                            <div className="flex justify-between items-center w-full">
                                <span className="text-[11px] font-semibold text-fg-muted uppercase tracking-[0.05em]">
                                    FATOR DE LUCRO
                                </span>
                                <div className="p-1.5 rounded-lg bg-canvas border border-line text-fg-subtle group-hover:text-fg transition-colors">
                                    <BarChart3 size={14} />
                                </div>
                            </div>

                            {/* Donut Chart - Centered */}
                            <div className="my-auto flex flex-col items-center justify-center py-1">
                                <ProfitFactorDonut profitFactor={currentStats.profitFactor} />
                            </div>

                            {/* Context / Badge - Centered */}
                            <div className="flex items-center justify-center w-full">
                                <span className={`text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full ${
                                    currentStats.profitFactor >= 1.5
                                        ? 'bg-accent/10 text-accent-fg border border-accent/20'
                                        : currentStats.profitFactor >= 1.0
                                        ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20'
                                        : 'bg-danger/10 text-danger-fg border border-danger/20'
                                }`}>
                                    {currentStats.profitFactor >= 1.75 ? 'Excelente' : currentStats.profitFactor >= 1.3 ? 'Consistente' : currentStats.profitFactor >= 1.0 ? 'Moderado' : 'Atenção'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* MAIN PERFORMANCE SECTION (CHARTS) */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5 items-stretch">
                        <PnLChart data={currentStats.dailyPnL} className="lg:col-span-2" />
                        <PerformanceScores data={currentStats.radarMetrics} />
                    </div>

                    {/* INSTITUTIONAL OPERATIONAL BREAKDOWN (3 RADAR CARDS) */}
                    <div className="space-y-2.5">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xs font-bold uppercase tracking-wider text-fg flex items-center gap-1.5 font-mono">
                                <Activity size={14} className="text-accent-fg" />
                                Detalhamento Operacional
                            </h2>
                            <span className="text-[10px] text-fg-subtle">
                                Resultado por ativo, sessão e dia · período selecionado
                            </span>
                        </div>

                        <OperationalBreakdown {...breakdown} />
                    </div>
                </>
            )}

            {/* CUSTOM DATE PICKER MODAL */}
            {showDatePicker && (
                <div className="fixed inset-0 bg-canvas/85 backdrop-blur-md z-[100] flex items-center justify-center p-4">
                    <div className="bg-surface border border-line rounded-2xl p-5 shadow-2xl max-w-sm w-full space-y-4">
                        <div className="flex items-center gap-2.5">
                            <div className="p-2 bg-accent/10 text-accent-fg rounded-lg">
                                <Calendar size={18} />
                            </div>
                            <div>
                                <h3 className="text-fg font-bold text-sm">Filtro Personalizado</h3>
                                <p className="text-[11px] text-fg-muted">Defina o intervalo operacional</p>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <div>
                                <label className="text-[10px] uppercase text-fg-muted font-bold tracking-wider block mb-1">Data de Início</label>
                                <input
                                    type="date"
                                    value={customStart}
                                    onChange={e => setCustomStart(e.target.value)}
                                    className="w-full bg-canvas border border-line rounded-lg text-xs p-2.5 text-fg focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all font-mono"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase text-fg-muted font-bold tracking-wider block mb-1">Data de Fim (Opcional)</label>
                                <input
                                    type="date"
                                    value={customEnd}
                                    onChange={e => setCustomEnd(e.target.value)}
                                    className="w-full bg-canvas border border-line rounded-lg text-xs p-2.5 text-fg focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all font-mono"
                                />
                            </div>
                        </div>

                        <div className="flex gap-2.5 pt-1">
                            <button
                                onClick={() => setShowDatePicker(false)}
                                className="flex-1 py-2 bg-surface-2 hover:bg-surface-3 text-fg/80 hover:text-fg rounded-lg text-xs font-semibold transition-colors border border-line"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleCustomRangeApply}
                                disabled={!customStart}
                                className={buttonVariants({ variant: 'brand', size: 'sm', className: 'flex-1 h-auto py-2' })}
                            >
                                Aplicar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal de Celebração de 30 Dias de Plano Premium (Trial) */}
            <TrialCelebrationModal
                isOpen={showTrialModal}
                onClose={() => setShowTrialModal(false)}
                days={user?.trialDays || 30}
            />

            {/* Modal de Renovação Manual */}
            {showRenewalModal && (
                <PlanModal
                    type="RENEWAL_CONFIRMATION"
                    onClose={() => setShowRenewalModal(false)}
                    planTier={user?.tier === 'PREMIUM' ? 'PRO' : 'BASIC'}
                    daysLeft={subStatus?.daysLeft}
                />
            )}

            {/* Modal de Aviso de Expiração Diária */}
            {showDailyExpirationModal && (
                <PlanModal
                    type="NEAR_EXPIRATION_WARNING"
                    onClose={handleCloseExpirationModal}
                    planTier={user?.tier === 'PREMIUM' ? 'PRO' : 'BASIC'}
                    daysLeft={subStatus?.daysLeft}
                />
            )}
        </div>
    );
};
