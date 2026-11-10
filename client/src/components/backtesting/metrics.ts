import { computeStats, ReplayStats } from '../kline-replay/engine';
import type { ReplayOrder } from '../kline-replay/types';
import type { DailyPoint } from '../charts/PnLChart';
import type { BacktestReplaySession } from '../../services/backtestWorkspaceStore';

/**
 * Every figure shown in the backtesting pages is derived from the session
 * orders with the same engine the replay terminal uses, so the hub and the
 * terminal can never disagree.
 */

export const closedOrders = (orders: ReplayOrder[] = []) =>
    orders.filter((o) => o.status === 'WIN' || o.status === 'LOSS').sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));

export const sessionStats = (s: BacktestReplaySession): ReplayStats => computeStats(s.orders || [], s.startingCapital || 0);

/** Aggregate over many sessions (each keeps its own capital). */
export const aggregateStats = (sessions: BacktestReplaySession[]) => {
    const all = sessions.flatMap((s) => s.orders || []);
    const capital = sessions.reduce((a, s) => a + (s.startingCapital || 0), 0);
    const stats = computeStats(all, capital);
    const perSession = sessions.map(sessionStats);
    return {
        ...stats,
        // Drawdown is meaningful per account: report the worst session.
        maxDrawdown: perSession.reduce((m, s) => Math.max(m, s.maxDrawdown), 0),
        maxDrawdownPct: perSession.reduce((m, s) => Math.max(m, s.maxDrawdownPct), 0),
        bestSession: perSession.reduce((m, s) => Math.max(m, s.netProfit), 0),
        worstSession: perSession.reduce((m, s) => Math.min(m, s.netProfit), 0),
        capital,
    };
};

const dayKey = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/** Daily P&L by the MARKET date the trade closed (replay time), ascending. */
export const dailyPoints = (orders: ReplayOrder[]): DailyPoint[] => {
    const map = new Map<string, number>();
    closedOrders(orders).forEach((o) => {
        if (!o.closedAt) return;
        const k = dayKey(o.closedAt);
        map.set(k, (map.get(k) || 0) + o.pnl);
    });
    return [...map.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([iso, v]) => ({ isoDate: iso, date: `${iso.slice(8, 10)}/${iso.slice(5, 7)}`, value: Math.round(v * 100) / 100 }));
};

export interface SymbolRow {
    symbol: string;
    trades: number;
    wins: number;
    pnl: number;
    avgR: number;
}

export const bySymbol = (orders: ReplayOrder[]): SymbolRow[] => {
    const map = new Map<string, SymbolRow>();
    closedOrders(orders).forEach((o) => {
        const r = map.get(o.symbol) || { symbol: o.symbol, trades: 0, wins: 0, pnl: 0, avgR: 0 };
        r.trades += 1;
        if (o.pnl > 0) r.wins += 1;
        r.pnl += o.pnl;
        r.avgR += o.rMultiple ?? 0;
        map.set(o.symbol, r);
    });
    return [...map.values()]
        .map((r) => ({ ...r, pnl: Math.round(r.pnl * 100) / 100, avgR: r.trades ? Math.round((r.avgR / r.trades) * 100) / 100 : 0 }))
        .sort((a, b) => b.pnl - a.pnl);
};

export type FundedState = 'passed' | 'failed' | 'running';

export interface FundedProgress {
    state: FundedState;
    profitPct: number;
    targetPct: number;
    worstDayPct: number;
    maxDailyPct: number;
    totalDdPct: number;
    maxTotalPct: number;
    breach?: string;
}

/**
 * Prop-firm rules measured against the starting capital: profit target,
 * worst single (market) day loss and deepest drop below the starting balance.
 */
export const fundedProgress = (s: BacktestReplaySession): FundedProgress | null => {
    if (!s.fundedMode?.enabled || !s.startingCapital) return null;
    const cap = s.startingCapital;
    const closed = closedOrders(s.orders);
    let equity = cap;
    let lowest = cap;
    const days = new Map<string, number>();
    closed.forEach((o) => {
        equity += o.pnl;
        lowest = Math.min(lowest, equity);
        if (o.closedAt) days.set(dayKey(o.closedAt), (days.get(dayKey(o.closedAt)) || 0) + o.pnl);
    });
    const worstDay = Math.min(0, ...days.values());
    const r1 = (v: number) => Math.round(v * 100) / 100;
    const profitPct = r1(((equity - cap) / cap) * 100);
    const worstDayPct = r1((-worstDay / cap) * 100);
    const totalDdPct = r1(((cap - lowest) / cap) * 100);
    const { profitTargetPct, maxDailyLossPct, maxTotalLossPct } = s.fundedMode;

    let breach: string | undefined;
    if (worstDayPct >= maxDailyLossPct) breach = `Perda diária de ${worstDayPct}% atingiu o limite de ${maxDailyLossPct}%`;
    else if (totalDdPct >= maxTotalLossPct) breach = `Queda de ${totalDdPct}% abaixo do capital atingiu o limite de ${maxTotalLossPct}%`;

    return {
        state: breach ? 'failed' : profitPct >= profitTargetPct ? 'passed' : 'running',
        profitPct,
        targetPct: profitTargetPct,
        worstDayPct,
        maxDailyPct: maxDailyLossPct,
        totalDdPct,
        maxTotalPct: maxTotalLossPct,
        breach,
    };
};

export const openOrders = (orders: ReplayOrder[] = []) => orders.filter((o) => o.status === 'OPEN' || o.status === 'PENDING');
