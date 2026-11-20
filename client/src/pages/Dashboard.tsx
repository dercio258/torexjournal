import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
    Activity,
    ArrowUpRight,
    ArrowDownRight,
    RefreshCw,
    Plus,
    RotateCcw
} from 'lucide-react';
import {
    Chart as ChartJS,
    ArcElement,
    Tooltip,
    Legend
} from 'chart.js';
import { PnLChart } from '../components/charts/PnLChart';
import { TorexScoreRadar } from '../components/dashboard/TorexScoreRadar';
import { TradingCalendarView } from '../components/reports/TradingCalendarView';
import { RecentTradesSimpleTable } from '../components/dashboard/RecentTradesSimpleTable';
import { OperationalBreakdown, toSessionRows, toSymbolRows, toWeekdayRows } from '../components/dashboard/OperationalBreakdown';
import {
    detectPnLStatus,
    SemiCircleWinRateGauge,
    WinLossAverageWidget,
    ProfitFactorDonut,
} from '../components/dashboard/StatsWidgets';
import { useDashboardStats, useSubscriptionStatus } from '../hooks/useDashboard';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useDashboardFilters } from '../context/DashboardFilterContext';
import { useLocale } from '../context/LocaleContext';
import { PropFirmProgressCard } from '../components/dashboard/PropFirmProgressCard';
import { ConsolidatedDashboardView } from '../components/dashboard/ConsolidatedDashboardView';
import { PlanModal } from '../components/dashboard/PlanModal';
import { IdleAccountWarningBanner } from '../components/dashboard/IdleAccountWarningBanner';
import { DashboardAppInstallCard } from '../components/pwa/DashboardAppInstallCard';
import { TrialCelebrationModal } from '../components/subscription/TrialCelebrationModal';
import { DashboardSkeleton } from '../components/ui/Skeleton';
import { DashboardEn } from './DashboardEn';
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
                        <span className={`inline-flex items-center gap-0.5 text-[10px] tabular-nums font-semibold px-1.5 py-0.5 rounded ${
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
                <div className={`text-xl sm:text-2xl font-bold tabular-nums tracking-tight ${
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

const DashboardPt = () => {
    const [showRenewalModal, setShowRenewalModal] = useState(false);

    const { user } = useAuth();
    const { selectedAccountId, selectedAccount, isConsolidated } = useAccount();
    const {
        queryDates,
        filters,
        activeFilterCount,
        hasActiveFilters,
        resetFilters,
        setAvailableSymbols,
    } = useDashboardFilters();
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
        }
    }, [user]);

    const displayName = user?.name ? user.name.split(' ')[0] : (user?.username || 'Trader');

    const { data: stats, isLoading: isStatsLoading, isFetching: isStatsFetching, refetch: refetchStats } = useDashboardStats(
        queryDates.start,
        queryDates.end,
        selectedAccountId,
        filters
    );

    useEffect(() => {
        if (stats?.availableSymbols) {
            setAvailableSymbols(stats.availableSymbols);
        }
    }, [stats?.availableSymbols, setAvailableSymbols]);

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
        avgWin: 0,
        avgLoss: 0,
        payoffRatio: 0,
        torexScore: 0,
        radarMetrics: { consistency: 0, riskManagement: 0, discipline: 0, profitability: 0, winRate: 0, profitFactorScore: 0 },
        radarMeta: undefined,
        dailyPnL: [],
        tradePnL: [],
        distribution: { wins: 0, losses: 0, breakeven: 0 },
        availableSymbols: [],
        propFirmStatus: undefined,
    };

    if (!stats && isStatsLoading) {
        return <DashboardSkeleton />;
    }

    return (
        <div className="space-y-3 pb-5">
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

            <IdleAccountWarningBanner isEn={false} />

            {/* SUB-HEADER BAR: Saudação 'OLÁ, {NOME}' + Botão '+ TRADE' & Sync */}
            <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-sm sm:text-[15px] font-bold tracking-tight text-fg uppercase">
                        OLÁ, <span className="text-accent-fg">{displayName}</span>!
                    </h2>
                    {hasActiveFilters && (
                        <button
                            type="button"
                            onClick={resetFilters}
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-accent/10 border border-accent/25 text-[10.5px] font-semibold text-accent-fg hover:bg-accent/15 transition-colors cursor-pointer"
                            title="Limpar filtros ativos"
                        >
                            <span>{activeFilterCount} {activeFilterCount === 1 ? 'filtro ativo' : 'filtros ativos'}</span>
                            <RotateCcw size={10} />
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-1.5">
                    <Link
                        to="/add-trades"
                        className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-surface hover:bg-surface-2 border border-line-strong hover:border-accent/50 text-fg font-bold text-xs tracking-wide uppercase transition-all active:scale-95"
                    >
                        <Plus size={14} strokeWidth={2.5} className="text-accent-fg" />
                        <span>TRADE</span>
                    </Link>

                    <button
                        type="button"
                        onClick={() => refetchStats()}
                        className="w-8 h-8 rounded-full bg-surface hover:bg-surface-2 text-fg-muted hover:text-fg transition-all border border-line hover:border-accent/40 flex items-center justify-center active:scale-95 cursor-pointer"
                        title="Sincronizar métricas"
                    >
                        <RefreshCw size={13} className={isStatsLoading || isStatsFetching ? 'animate-spin text-accent-fg' : ''} />
                    </button>
                </div>
            </div>

            <DashboardAppInstallCard locale="pt" />

            {isConsolidated ? (
                <ConsolidatedDashboardView stats={currentStats} />
            ) : (
                <>
                    {/* Prop Firm Rules & Progress (if applicable) */}
                    <PropFirmProgressCard 
                        propFirmStatus={currentStats.propFirmStatus} 
                        currency={selectedAccount?.currency} 
                    />

                    {/* 4 HIGH-PRIORITY KPI CARDS (2x2 em dispositivos móveis · 4 na mesma linha horizontal no desktop) */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
                        {/* 1. Total P&L (Badge de trades no topo para nunca truncar valores grandes) */}
                        {(() => {
                            const pnlInfo = detectPnLStatus(currentStats.totalPnL);
                            return (
                                <div className="bg-surface border border-line hover:border-line-strong rounded-xl px-2.5 py-2.5 sm:px-4 sm:py-3 transition-colors flex flex-col justify-between min-h-[78px] sm:min-h-[82px] min-w-0">
                                    <div className="flex items-center justify-between gap-1.5">
                                        <span className="text-[10px] sm:text-[10.5px] font-bold uppercase tracking-wider text-fg-muted truncate">
                                            Total P&L
                                        </span>
                                        <span className="px-1.5 py-0.5 rounded bg-canvas-subtle border border-line-subtle text-[9.5px] sm:text-[10px] font-mono tabular-nums text-fg-subtle shrink-0">
                                            {currentStats.totalTrades} {currentStats.totalTrades === 1 ? 'trade' : 'trades'}
                                        </span>
                                    </div>
                                    <span
                                        className={`mt-1.5 text-lg sm:text-[22px] font-bold tabular-nums tracking-tight leading-none truncate ${pnlInfo.textClass}`}
                                    >
                                        {pnlInfo.formattedValue}
                                    </span>
                                </div>
                            );
                        })()}

                        {/* 2. Taxa de Acerto (Arco Semicircular Wins / BE / Losses) */}
                        <div className="bg-surface border border-line hover:border-line-strong rounded-xl px-2.5 py-2.5 sm:px-4 sm:py-3 transition-colors flex items-center min-h-[78px] sm:min-h-[82px] min-w-0">
                            <SemiCircleWinRateGauge
                                winRate={currentStats.winRate}
                                wins={currentStats.distribution.wins}
                                breakeven={currentStats.distribution.breakeven}
                                losses={currentStats.distribution.losses}
                            />
                        </div>

                        {/* 3. W/L Average (Payoff + Barra Dupla Ganho Médio vs Perda Média) */}
                        <div className="bg-surface border border-line hover:border-line-strong rounded-xl px-2.5 py-2.5 sm:px-4 sm:py-3 transition-colors flex items-center min-h-[78px] sm:min-h-[82px] min-w-0">
                            <WinLossAverageWidget
                                avgWin={currentStats.avgWin}
                                avgLoss={currentStats.avgLoss}
                                payoffRatio={currentStats.payoffRatio}
                            />
                        </div>

                        {/* 4. Fator de Lucro (Anel Proporcional Limpo) */}
                        <div className="bg-surface border border-line hover:border-line-strong rounded-xl px-2.5 py-2.5 sm:px-4 sm:py-3 transition-colors flex items-center min-h-[78px] sm:min-h-[82px] min-w-0">
                            <ProfitFactorDonut
                                profitFactor={currentStats.profitFactor}
                                totalTrades={currentStats.totalTrades}
                            />
                        </div>
                    </div>

                    {/* MAIN PERFORMANCE ROW: 3 SEPARATE HORIZONTALLY ALIGNED CHARTS (Radar Score · P&L Acumulativo · P&L Diário) */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-stretch">
                        <TorexScoreRadar
                            data={currentStats.radarMetrics}
                            torexScore={currentStats.torexScore}
                            meta={currentStats.radarMeta}
                        />
                        <PnLChart data={currentStats.dailyPnL} fixedMode="cumulative" />
                        <PnLChart data={currentStats.dailyPnL} fixedMode="daily" />
                    </div>

                    {/* COMPACT OPERATIONAL CALENDAR (8 cols) + SIMPLE RECENT TRADES TABLE (4 cols) */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
                        <div className="lg:col-span-8 min-w-0 flex">
                            <TradingCalendarView
                                dailyPnL={currentStats.dailyPnL}
                                accountId={selectedAccountId}
                                filters={filters}
                                queryRange={queryDates}
                            />
                        </div>
                        <div className="lg:col-span-4 min-w-0 flex">
                            <RecentTradesSimpleTable trades={currentStats.tradePnL} />
                        </div>
                    </div>

                    {/* INSTITUTIONAL OPERATIONAL BREAKDOWN */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <h2 className="text-[11px] font-bold uppercase tracking-wider text-fg-muted flex items-center gap-1.5">
                                <Activity size={13} className="text-accent-fg" />
                                Detalhamento Operacional
                            </h2>
                            <span className="text-[10.5px] text-fg-subtle">
                                Ativos, sessões e dias · período selecionado
                            </span>
                        </div>

                        <OperationalBreakdown {...breakdown} />
                    </div>
                </>
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
                    planTier={user?.tier === 'PREMIUM' ? 'PREMIUM' : user?.tier === 'PRO' ? 'PRO' : 'BASIC'}
                    daysLeft={subStatus?.daysLeft}
                />
            )}

            {/* Modal de Aviso de Expiração Diária */}
            {showDailyExpirationModal && (
                <PlanModal
                    type="NEAR_EXPIRATION_WARNING"
                    onClose={handleCloseExpirationModal}
                    planTier={user?.tier === 'PREMIUM' ? 'PREMIUM' : user?.tier === 'PRO' ? 'PRO' : 'BASIC'}
                    daysLeft={subStatus?.daysLeft}
                />
            )}
        </div>
    );
};

export const Dashboard = () => {
    const { locale } = useLocale();
    if (locale === 'en') {
        return <DashboardEn />;
    }
    return <DashboardPt />;
};
