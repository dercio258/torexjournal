import { useQuery } from '@tanstack/react-query';
import api from '../api';

export interface DashboardStats {
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
    /** One point per trading day (UTC), chronological. `date` = dd/mm label, `isoDate` = YYYY-MM-DD. */
    dailyPnL: { date: string; isoDate: string; value: number }[];
    /** Most recent closed trades (max 20), chronological. */
    tradePnL: { date: string; value: number; ticket?: string }[];
    distribution: { wins: number; losses: number; breakeven: number };
    healthScore?: { score: number; details: any };
    bySession?: any[];
    bySymbol?: { symbol: string; count: number; wins: number; losses: number; pnl: number }[];
    /** 0 = Sunday … 6 = Saturday (UTC). */
    byWeekday?: { weekday: number; count: number; wins: number; pnl: number }[];
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

export const useDashboardStats = (startDate: string, endDate: string, accountId?: string) => {
    const normalizedAccountId = (!accountId || accountId === 'all' || accountId === 'undefined') ? undefined : accountId;

    return useQuery<DashboardStats>({
        queryKey: ['dashboard', 'stats', normalizedAccountId || 'all', startDate, endDate],
        queryFn: async () => {
            const params: any = { startDate, endDate };
            if (normalizedAccountId) {
                params.accountId = normalizedAccountId;
            }

            const [perfRes, scoreRes] = await Promise.all([
                api.get('/dashboard/performance', { params }),
                api.get('/alerts/score', { params }).catch(() => ({ data: null }))
            ]);

            const data = perfRes.data;
            
            // Daily buckets come keyed by UTC date (YYYY-MM-DD); format the label in UTC too
            // so a day never shifts across the user's local midnight.
            const dailyPnL = (data.dailyPnL || [])
                .filter((d: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(d.date)))
                .map((d: any) => {
                    const iso = String(d.date);
                    const value = Number(d.value ?? d.pnl);
                    return { isoDate: iso, date: `${iso.slice(8, 10)}/${iso.slice(5, 7)}`, value: Number.isFinite(value) ? value : 0 };
                })
                .sort((a: any, b: any) => a.isoDate.localeCompare(b.isoDate));

            const tradePnL = (data.tradePnL || [])
                .filter((t: any) => t.date)
                .map((t: any) => ({
                    date: new Date(t.date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
                    value: Number(t.value) || 0,
                    ticket: t.ticket,
                }));

            return {
                ...data,
                dailyPnL,
                tradePnL,
                distribution: data.distribution || { wins: 0, losses: 0, breakeven: 0 },
                healthScore: scoreRes?.data
            };
        },
        enabled: !!startDate && !!endDate,
    });
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
