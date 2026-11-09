import type { KLineData } from 'klinecharts';
import type { ReplayOrder } from './types';

/**
 * Pure replay execution engine — no React, no side effects.
 *
 * Price convention: the chart shows BID prices. BUY fills at ASK (bid + spread)
 * and exits at BID; SELL fills at BID and exits at ASK. P&L is expressed in
 * R multiples of the order's fixed risk amount, minus commission.
 *
 * Order state is always DERIVED by replaying the order's intent over the
 * candles between its opening time and the current replay cutoff, so jumping
 * forward evaluates every skipped bar and rewinding undoes the future.
 */

export interface OrderIntent {
    symbol: string;
    side: 'BUY' | 'SELL';
    orderType: 'MARKET' | 'LIMIT';
    /** Bid price shown at placement (MARKET) or the limit price (LIMIT). */
    price: number;
    slDistance: number;
    rrRatio: number;
    riskAmount: number;
    lots: number;
    spread: number;
    commission: number;
    openedAt: number;
    decimals: number;
}

const round = (v: number, d: number) => Number(v.toFixed(d));

/** Builds a new order from the ticket. Entry/SL/TP are anchored to the real fill price. */
export function createOrder(intent: OrderIntent, id: string): ReplayOrder {
    const { side, orderType, price, slDistance, rrRatio, spread, decimals } = intent;
    // MARKET BUY pays the spread at entry; LIMIT orders fill at their limit price.
    const entry = orderType === 'MARKET' && side === 'BUY' ? price + spread : price;
    const dir = side === 'BUY' ? 1 : -1;
    return {
        id,
        symbol: intent.symbol,
        side,
        orderType,
        entryPrice: round(entry, decimals),
        stopLoss: round(entry - dir * slDistance, decimals),
        takeProfit: round(entry + dir * slDistance * rrRatio, decimals),
        lots: intent.lots,
        riskAmount: intent.riskAmount,
        rrRatio,
        spread,
        commission: intent.commission,
        status: orderType === 'MARKET' ? 'OPEN' : 'PENDING',
        pnl: 0,
        rMultiple: 0,
        openedAt: intent.openedAt,
    };
}

const rOf = (o: ReplayOrder, exit: number) => {
    const dist = Math.max(Math.abs(o.entryPrice - o.stopLoss), 1e-12);
    return ((o.side === 'BUY' ? exit - o.entryPrice : o.entryPrice - exit) / dist);
};

const pnlOf = (o: ReplayOrder, exit: number) => Number((o.riskAmount * rOf(o, exit) - (o.commission || 0)).toFixed(2));

const close = (o: ReplayOrder, exit: number, at: number, reason: 'SL' | 'TP' | 'MANUAL'): ReplayOrder => {
    const pnl = pnlOf(o, exit);
    return {
        ...o,
        status: pnl >= 0 ? 'WIN' : 'LOSS',
        exitPrice: exit,
        exitReason: reason,
        pnl,
        rMultiple: Number(rOf(o, exit).toFixed(2)),
        closedAt: at,
    };
};

/** Resets an order to its just-placed state (keeps the intent and any manual close request). */
const reset = (o: ReplayOrder): ReplayOrder => ({
    ...o,
    status: o.orderType === 'MARKET' ? 'OPEN' : 'PENDING',
    exitPrice: undefined,
    exitReason: undefined,
    closedAt: undefined,
    pnl: 0,
    rMultiple: 0,
});

/**
 * Applies ONE candle. Conservative intrabar rule: if a bar touches both SL and
 * TP, the stop wins. A bar that gaps through the stop exits at its open.
 */
export function stepOrder(o: ReplayOrder, c: KLineData): ReplayOrder {
    if (o.status === 'CLOSED' || o.status === 'WIN' || o.status === 'LOSS') return o;
    const s = o.spread || 0;
    let cur = o;

    if (cur.status === 'PENDING') {
        // BUY limit fills on the ASK, SELL limit on the BID.
        const lo = cur.side === 'BUY' ? c.low + s : c.low;
        const hi = cur.side === 'BUY' ? c.high + s : c.high;
        if (lo <= cur.entryPrice && hi >= cur.entryPrice) cur = { ...cur, status: 'OPEN' };
        else return cur;
    }

    if (cur.side === 'BUY') {
        // Exits on the BID.
        if (c.open <= cur.stopLoss) return close(cur, c.open, c.timestamp, 'SL');
        if (c.low <= cur.stopLoss) return close(cur, cur.stopLoss, c.timestamp, 'SL');
        if (c.high >= cur.takeProfit) return close(cur, cur.takeProfit, c.timestamp, 'TP');
        return { ...cur, pnl: pnlOf(cur, c.close), rMultiple: Number(rOf(cur, c.close).toFixed(2)) };
    }

    // SELL exits on the ASK.
    if (c.open + s >= cur.stopLoss) return close(cur, c.open + s, c.timestamp, 'SL');
    if (c.high + s >= cur.stopLoss) return close(cur, cur.stopLoss, c.timestamp, 'SL');
    if (c.low + s <= cur.takeProfit) return close(cur, cur.takeProfit, c.timestamp, 'TP');
    const mark = c.close + s;
    return { ...cur, pnl: pnlOf(cur, mark), rMultiple: Number(rOf(cur, mark).toFixed(2)) };
}

export interface RecomputeContext {
    symbol: string;
    /** Full loaded history for `symbol`, ascending. */
    candles: KLineData[];
    /** Last visible bar timestamp (replay cutoff, or last bar when live). */
    uptoTs: number;
    /** True when the cutoff moved backwards on the same symbol/timeframe. */
    rewind: boolean;
}

/**
 * Re-derives every order of `ctx.symbol` from its intent. Orders on other
 * symbols, or opened before the loaded history starts, are left untouched.
 * On rewind, orders placed after the cutoff are removed (they haven't happened)
 * and manual closes after the cutoff are undone.
 */
export function recomputeOrders(orders: ReplayOrder[], ctx: RecomputeContext): ReplayOrder[] {
    const { candles, uptoTs, symbol, rewind } = ctx;
    if (candles.length === 0) return orders;
    const first = candles[0].timestamp;
    let changed = false;

    const next: ReplayOrder[] = [];
    for (const o of orders) {
        // Other symbols and legacy closed orders without an intent trail stay frozen.
        if (o.symbol !== symbol || (o.status === 'CLOSED' && o.cancelledAt === undefined)) {
            next.push(o);
            continue;
        }
        if (o.openedAt > uptoTs) {
            if (rewind) { changed = true; continue; }
            next.push(o); // e.g. coarser timeframe: bar containing the order not visible yet
            continue;
        }
        if (o.openedAt < first) {
            next.push(o); // history doesn't cover it: keep last known state
            continue;
        }

        let manualAt = o.manualCloseAt;
        let manualPrice = o.manualClosePrice;
        let cancelledAt = o.cancelledAt;
        if (rewind && manualAt !== undefined && manualAt > uptoTs) { manualAt = undefined; manualPrice = undefined; }
        if (rewind && cancelledAt !== undefined && cancelledAt > uptoTs) cancelledAt = undefined;

        let cur: ReplayOrder = { ...reset(o), manualCloseAt: manualAt, manualClosePrice: manualPrice, cancelledAt };
        for (const c of candles) {
            if (c.timestamp <= o.openedAt) continue;
            if (c.timestamp > uptoTs) break;
            if (cancelledAt !== undefined && c.timestamp > cancelledAt) break;
            if (manualAt !== undefined && c.timestamp > manualAt) break;
            cur = stepOrder(cur, c);
            if (cur.status === 'WIN' || cur.status === 'LOSS') break;
        }

        if (cur.status === 'PENDING' && cancelledAt !== undefined) {
            cur = { ...cur, status: 'CLOSED', closedAt: cancelledAt };
        } else if (cur.status === 'OPEN' && manualAt !== undefined && manualPrice !== undefined) {
            const exit = cur.side === 'BUY' ? manualPrice : manualPrice + (cur.spread || 0);
            cur = close(cur, exit, manualAt, 'MANUAL');
        }

        if (!sameState(cur, o)) changed = true;
        next.push(cur);
    }
    return changed || next.length !== orders.length ? next : orders;
}

const sameState = (a: ReplayOrder, b: ReplayOrder) =>
    a.status === b.status && a.pnl === b.pnl && a.exitPrice === b.exitPrice && a.closedAt === b.closedAt &&
    a.manualCloseAt === b.manualCloseAt && a.cancelledAt === b.cancelledAt;

export interface ReplayStats {
    trades: number;
    wins: number;
    losses: number;
    winRate: number;
    grossProfit: number;
    grossLoss: number;
    /** null when there are no losing trades. */
    profitFactor: number | null;
    netProfit: number;
    expectancy: number;
    avgR: number;
    maxDrawdown: number;
    maxDrawdownPct: number;
    realizedBalance: number;
}

const isClosed = (o: ReplayOrder) => o.status === 'WIN' || o.status === 'LOSS';

export function computeStats(orders: ReplayOrder[], initialBalance: number): ReplayStats {
    const closed = orders.filter(isClosed).sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));
    const wins = closed.filter(o => o.pnl > 0);
    const losses = closed.filter(o => o.pnl < 0);
    const grossProfit = wins.reduce((s, o) => s + o.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, o) => s + o.pnl, 0));
    const netProfit = grossProfit - grossLoss;

    let equity = initialBalance;
    let peak = initialBalance;
    let maxDd = 0;
    let maxDdPct = 0;
    for (const o of closed) {
        equity += o.pnl;
        peak = Math.max(peak, equity);
        const dd = peak - equity;
        if (dd > maxDd) {
            maxDd = dd;
            maxDdPct = peak > 0 ? (dd / peak) * 100 : 0;
        }
    }

    const r2 = (v: number) => Number(v.toFixed(2));
    return {
        trades: closed.length,
        wins: wins.length,
        losses: losses.length,
        winRate: closed.length ? Number(((wins.length / closed.length) * 100).toFixed(1)) : 0,
        grossProfit: r2(grossProfit),
        grossLoss: r2(grossLoss),
        profitFactor: grossLoss > 0 ? r2(grossProfit / grossLoss) : null,
        netProfit: r2(netProfit),
        expectancy: closed.length ? r2(netProfit / closed.length) : 0,
        avgR: closed.length ? r2(closed.reduce((s, o) => s + (o.rMultiple ?? 0), 0) / closed.length) : 0,
        maxDrawdown: r2(maxDd),
        maxDrawdownPct: r2(maxDdPct),
        realizedBalance: r2(initialBalance + netProfit),
    };
}
