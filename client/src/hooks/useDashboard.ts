import { useQuery } from '@tanstack/react-query';
import api from '../api';
import { formatTradeDateShortTime, getUserTimeZone } from '../utils/timezone';

export type DashboardSessionBucket = 'asia' | 'london' | 'overlap' | 'ny' | 'other';
export type DashboardSideFilter = 'ALL' | 'BUY' | 'SELL';
export type DashboardOutcomeFilter = 'ALL' | 'WIN' | 'LOSS' | 'BE';

export interface DashboardOperationalFilters {
    symbols?: string[];
    side?: DashboardSideFilter;
    sessions?: DashboardSessionBucket[];
    outcome?: DashboardOutcomeFilter;
}

export interface DashboardDailyPnLPoint {
    /** dd/mm label */
    date: string;
    /** YYYY-MM-DD (UTC) */
    isoDate: string;
    value: number;
    pnl: number;
    trades: number;
    wins: number;
    losses: number;
    winRate: number;
    hasNotes: boolean;
}

export interface DashboardRadarMeta {
    usedJournalSignals: boolean;
    annotatedTrades: number;
    annotatedDays: number;
    sources: {
        consistency: 'legacy' | 'blended';
        riskManagement: 'legacy' | 'blended';
        discipline: 'legacy' | 'blended';
    };
    tips: string[];
}

export interface DashboardStats {
    totalPnL: number;
    winRate: number;
    totalTrades: number;
    profitFactor: number;
    avgWin: number;
    avgLoss: number;
    payoffRatio: number;
    torexScore: number;
    radarMetrics: {
        consistency: number;
        riskManagement: number;
        discipline: number;
        profitability: number;
        winRate: number;
        profitFactorScore?: number;
    };
    radarMeta?: DashboardRadarMeta;
    /** One point per trading day (UTC), chronological. `date` = dd/mm label, `isoDate` = YYYY-MM-DD. */
    dailyPnL: DashboardDailyPnLPoint[];
    /** Most recent closed trades (max 20), chronological. */
    tradePnL: { date: string; value: number; ticket?: string }[];
    distribution: { wins: number; losses: number; breakeven: number };
    healthScore?: { score: number; details: any };
    bySession?: any[];
    bySymbol?: { symbol: string; count: number; wins: number; losses: number; pnl: number }[];
    /** 0 = Sunday … 6 = Saturday (UTC). */
    byWeekday?: { weekday: number; count: number; wins: number; pnl: number }[];
    availableSymbols?: string[];
    isConsolidated?: boolean;
    currencies?: string[];
    hasMultipleCurrencies?: boolean;
    accountBreakdown?: any[];
    targetAccount?: any;
    propFirmStatus?: {
        hasRules: boolean;
        profitTarget: number;
        profitTargetProgress: number | null;
        dailyLossLimit: number;
        todayPnL: number;
        dailyLossMargin: number | null;
        maxDrawdownLimit: number;
        maxDrawdownRecorded: number;
    } | null;
}

export const useSubscriptionStatus = () => {
    return useQuery({
        queryKey: ['subscription', 'status'],
        queryFn: async () => {
            const { data } = await api.get('/subscription/status');
            return data;
        },
    });
};

export const useDashboardStats = (
    startDate: string,
    endDate: string,
    accountId?: string,
    filters?: DashboardOperationalFilters
) => {
    const normalizedAccountId = (!accountId || accountId === 'all' || accountId === 'undefined') ? undefined : accountId;

    const symbolsParam = filters?.symbols && filters.symbols.length > 0
        ? [...filters.symbols].map(s => s.trim()).filter(Boolean).sort().join(',')
        : undefined;
    const sideParam = filters?.side && filters.side !== 'ALL' ? filters.side : undefined;
    const sessionsParam = filters?.sessions && filters.sessions.length > 0
        ? [...filters.sessions].sort().join(',')
        : undefined;
    const outcomeParam = filters?.outcome && filters.outcome !== 'ALL' ? filters.outcome : undefined;

    const healthScoreQuery = useQuery({
        queryKey: ['alerts', 'score', normalizedAccountId || 'all', startDate, endDate],
        queryFn: async () => {
            const scoreParams: Record<string, string> = { startDate, endDate };
            if (normalizedAccountId) scoreParams.accountId = normalizedAccountId;
            const res = await api.get('/alerts/score', { params: scoreParams }).catch(() => ({ data: null }));
            return res.data;
        },
        enabled: !!startDate && !!endDate,
        staleTime: 2 * 60_000,
    });

    const userTz = getUserTimeZone();
    const perfQuery = useQuery<DashboardStats>({
        queryKey: [
            'dashboard',
            'stats',
            normalizedAccountId || 'all',
            startDate,
            endDate,
            symbolsParam || 'all',
            sideParam || 'ALL',
            sessionsParam || 'all',
            outcomeParam || 'ALL',
            userTz,
        ],
        queryFn: async () => {
            const params: any = { startDate, endDate, tz: userTz };
            if (normalizedAccountId) params.accountId = normalizedAccountId;
            if (symbolsParam) params.symbols = symbolsParam;
            if (sideParam) params.side = sideParam;
            if (sessionsParam) params.sessions = sessionsParam;
            if (outcomeParam) params.outcome = outcomeParam;

            const perfRes = await api.get('/dashboard/performance', { params });
            const data = perfRes.data;

            // Daily buckets come keyed by user's local timezone date (YYYY-MM-DD)
            const dailyPnL: DashboardDailyPnLPoint[] = (data.dailyPnL || [])
                .filter((d: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(d.date)))
                .map((d: any) => {
                    const iso = String(d.date);
                    const rawVal = Number(d.value ?? d.pnl);
                    const value = Number.isFinite(rawVal) ? rawVal : 0;
                    const trades = Number.isFinite(Number(d.trades ?? d.count)) ? Number(d.trades ?? d.count) : (value !== 0 ? 1 : 0);
                    const wins = Number.isFinite(Number(d.wins)) ? Number(d.wins) : (value > 0 ? trades : 0);
                    const losses = Number.isFinite(Number(d.losses)) ? Number(d.losses) : (value < 0 ? trades : 0);
                    const winRate = Number.isFinite(Number(d.winRate))
                        ? Number(d.winRate)
                        : (trades > 0 ? Number(((wins / trades) * 100).toFixed(1)) : 0);

                    return {
                        isoDate: iso,
                        date: `${iso.slice(8, 10)}/${iso.slice(5, 7)}`,
                        value,
                        pnl: value,
                        trades,
                        wins,
                        losses,
                        winRate,
                        hasNotes: Boolean(d.hasNotes),
                    };
                })
                .sort((a: DashboardDailyPnLPoint, b: DashboardDailyPnLPoint) => a.isoDate.localeCompare(b.isoDate));

            const tradePnL = (data.tradePnL || []).map((t: any, idx: number) => ({
                date: t.date ? formatTradeDateShortTime(t.date) : '',
                value: Number(t.value) || 0,
                ticket: t.ticket ? String(t.ticket) : `T-${idx + 1}`,
            }));

            return {
                ...data,
                avgWin: Number(data.avgWin) || 0,
                avgLoss: Number(data.avgLoss) || 0,
                payoffRatio: Number(data.payoffRatio) || 0,
                torexScore: Number(data.torexScore) || 0,
                radarMetrics: {
                    consistency: Number(data.radarMetrics?.consistency) || 0,
                    riskManagement: Number(data.radarMetrics?.riskManagement) || 0,
                    discipline: Number(data.radarMetrics?.discipline) || 0,
                    profitability: Number(data.radarMetrics?.profitability) || 0,
                    winRate: Number(data.radarMetrics?.winRate) || 0,
                    profitFactorScore: Number(data.radarMetrics?.profitFactorScore ?? data.radarMetrics?.profitability) || 0,
                },
                dailyPnL,
                tradePnL,
                distribution: data.distribution || { wins: 0, losses: 0, breakeven: 0 },
                availableSymbols: Array.isArray(data.availableSymbols) ? data.availableSymbols : [],
            };
        },
        enabled: !!startDate && !!endDate,
    });

    return {
        ...perfQuery,
        data: perfQuery.data
            ? {
                  ...perfQuery.data,
                  healthScore: healthScoreQuery.data ?? perfQuery.data.healthScore,
              }
            : undefined,
    };
};

export const useTradesFallback = (accountId?: string) => {
    const normalizedAccountId = (!accountId || accountId === 'all' || accountId === 'undefined') ? undefined : accountId;

    return useQuery({
        queryKey: ['trades', normalizedAccountId || 'all'],
        queryFn: async () => {
            const params: any = {};
            if (normalizedAccountId) params.accountId = normalizedAccountId;
            const { data } = await api.get('/dashboard/trades', { params });
            return data;
        },
    });
};
