import type { KLineData } from 'klinecharts';
import type { ReplayOrder } from './types';
import {
    calculateLotBasedPnl,
    isCrossedImmediateOrder,
    roundHalfUp,
    roundMoney,
} from '../../schemas/backtestContracts';

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
    orderType: 'MARKET' | 'LIMIT' | 'STOP';
    /** Bid price shown at placement (MARKET) or target pending price (LIMIT/STOP). */
    price: number;
    /** Optional current Bid at placement so pending orders above/below market auto-resolve LIMIT vs STOP. */
    referenceBid?: number;
    slDistance: number;
    rrRatio: number;
    riskAmount: number;
    lots: number;
    spread: number;
    commission: number;
    openedAt: number;
    decimals: number;
}

const round = (v: number, d: number) => roundHalfUp(v, d);

/** Builds a new order from the ticket. Preserves orderType ('LIMIT'/'STOP') while filling crossed orders immediately at market. */
export function createOrder(intent: OrderIntent, id: string): ReplayOrder {
    const { side, orderType, price, referenceBid, slDistance, rrRatio, spread, decimals } = intent;
    const safeSpread = Math.max(0, spread || 0);
    const fillNow =
        orderType === 'MARKET' ||
        (typeof referenceBid === 'number' &&
            Number.isFinite(referenceBid) &&
            isCrossedImmediateOrder(side, orderType, price, referenceBid, safeSpread));

    const bidRef = typeof referenceBid === 'number' && Number.isFinite(referenceBid) ? referenceBid : price;
    const rawEntry =
        orderType === 'MARKET'
            ? side === 'BUY'
                ? price + safeSpread
                : price
            : fillNow
              ? side === 'BUY'
                  ? bidRef + safeSpread
                  : bidRef
              : price;

    const entry = round(rawEntry, decimals);
    const dir = side === 'BUY' ? 1 : -1;
    const slPrice = slDistance > 0 ? round(entry - dir * slDistance, decimals) : 0;
    const tpPrice = slDistance > 0 && rrRatio > 0 ? round(entry + dir * slDistance * rrRatio, decimals) : 0;
    const order: ReplayOrder = {
        id,
        symbol: intent.symbol,
        side,
        orderType,
        entryPrice: entry,
        stopLoss: slPrice,
        initialStopLoss: slPrice,
        takeProfit: tpPrice,
        lots: intent.lots,
        riskAmount: roundMoney(intent.riskAmount),
        rrRatio,
        spread: safeSpread,
        commission: roundMoney(intent.commission || 0),
        status: fillNow ? 'OPEN' : 'PENDING',
        pnl: 0,
        rMultiple: 0,
        mfe: 0,
        mae: 0,
        openedAt: intent.openedAt,
        filledAt: fillNow ? intent.openedAt : undefined,
    };
    if (fillNow) {
        const markExit = side === 'BUY' ? bidRef : bidRef + safeSpread;
        order.pnl = pnlOf(order, markExit);
        order.rMultiple = roundMoney(rOf(order, markExit));
    }
    return order;
}

const rOf = (o: ReplayOrder, exit: number) => {
    const baseSl = o.initialStopLoss !== undefined ? o.initialStopLoss : o.stopLoss;
    const rawDist = baseSl > 0 ? Math.abs(o.entryPrice - baseSl) : Math.max(o.entryPrice * 0.005, 1e-6);
    const dist = Math.max(rawDist, 1e-6);
    return (o.side === 'BUY' ? exit - o.entryPrice : o.entryPrice - exit) / dist;
};

const pnlOf = (o: ReplayOrder, exit: number) =>
    o.lots > 0
        ? calculateLotBasedPnl(o.symbol, o.side, o.entryPrice, exit, o.lots, o.commission || 0)
        : roundMoney(o.riskAmount * rOf(o, exit) - (o.commission || 0));

const updateExcursions = (o: ReplayOrder, c: KLineData): { mfe: number; mae: number } => {
    const s = o.spread || 0;
    // BUY marks exits on BID (high/low); SELL marks exits on ASK (low+s / high+s).
    const favPrice = o.side === 'BUY' ? c.high : c.low + s;
    const advPrice = o.side === 'BUY' ? c.low : c.high + s;
    let favUsd = 0;
    let advUsd = 0;
    if (o.lots > 0) {
        favUsd = Math.max(0, calculateLotBasedPnl(o.symbol, o.side, o.entryPrice, favPrice, o.lots, 0));
        advUsd = Math.max(0, -calculateLotBasedPnl(o.symbol, o.side, o.entryPrice, advPrice, o.lots, 0));
    } else {
        favUsd = Math.max(0, o.riskAmount * Math.max(0, rOf(o, favPrice)));
        advUsd = Math.max(0, o.riskAmount * Math.max(0, -rOf(o, advPrice)));
    }
    return {
        mfe: roundMoney(Math.max(Math.abs(o.mfe ?? 0), favUsd)),
        mae: roundMoney(Math.max(Math.abs(o.mae ?? 0), advUsd)),
    };
};

const close = (o: ReplayOrder, exit: number, at: number, reason: 'SL' | 'TP' | 'MANUAL'): ReplayOrder => {
    const pnl = pnlOf(o, exit);
    return {
        ...o,
        status: pnl >= 0 ? 'WIN' : 'LOSS',
        exitPrice: exit,
        exitReason: reason,
        pnl,
        rMultiple: roundMoney(rOf(o, exit)),
        closedAt: at,
    };
};

/** Resets an order to its just-placed state (keeps the intent, journal annotations, and any manual close request). */
const reset = (o: ReplayOrder): ReplayOrder => {
    const immediatelyFilled = o.orderType === 'MARKET' || o.filledAt === o.openedAt;
    const next: ReplayOrder = {
        ...o,
        status: immediatelyFilled ? 'OPEN' : 'PENDING',
        pnl: 0,
        rMultiple: 0,
        mfe: 0,
        mae: 0,
    };
    if (immediatelyFilled) {
        next.filledAt = o.openedAt;
    } else {
        delete next.filledAt;
    }
    delete next.exitPrice;
    delete next.exitReason;
    delete next.closedAt;
    return next;
};

/**
 * Applies ONE candle. Conservative intrabar rule: if a bar touches both SL and
 * TP, the stop wins. A bar that gaps through the stop exits at its open.
 */
export function stepOrder(o: ReplayOrder, c: KLineData): ReplayOrder {
    if (o.status === 'CLOSED' || o.status === 'WIN' || o.status === 'LOSS' || o.status === 'CANCELLED') return o;
    const s = o.spread || 0;
    let cur = o;
    let justFilled = false;

    if (cur.status === 'PENDING') {
        // BUY pending triggers on the ASK, SELL pending on the BID.
        const lo = cur.side === 'BUY' ? c.low + s : c.low;
        const hi = cur.side === 'BUY' ? c.high + s : c.high;
        const openQuote = cur.side === 'BUY' ? c.open + s : c.open;

        let triggered = false;
        if (cur.orderType === 'STOP') {
            triggered = cur.side === 'BUY' ? hi >= cur.entryPrice || openQuote >= cur.entryPrice : lo <= cur.entryPrice || openQuote <= cur.entryPrice;
        } else {
            // LIMIT order
            triggered = cur.side === 'BUY' ? lo <= cur.entryPrice || openQuote <= cur.entryPrice : hi >= cur.entryPrice || openQuote >= cur.entryPrice;
        }

        if (triggered) {
            cur = { ...cur, status: 'OPEN', filledAt: c.timestamp };
            justFilled = true;
        } else {
            return cur;
        }
    }

    const exc = updateExcursions(cur, c);
    cur = { ...cur, mfe: exc.mfe, mae: exc.mae };

    if (cur.side === 'BUY') {
        // Exits on the BID.
        if (!justFilled && cur.stopLoss > 0 && c.open <= cur.stopLoss) return close(cur, c.open, c.timestamp, 'SL');
        if (cur.stopLoss > 0 && c.low <= cur.stopLoss) return close(cur, cur.stopLoss, c.timestamp, 'SL');
        if (cur.takeProfit > 0 && c.high >= cur.takeProfit) return close(cur, cur.takeProfit, c.timestamp, 'TP');
        return { ...cur, pnl: pnlOf(cur, c.close), rMultiple: roundMoney(rOf(cur, c.close)) };
    }

    // SELL exits on the ASK.
    if (!justFilled && cur.stopLoss > 0 && c.open + s >= cur.stopLoss) return close(cur, c.open + s, c.timestamp, 'SL');
    if (cur.stopLoss > 0 && c.high + s >= cur.stopLoss) return close(cur, cur.stopLoss, c.timestamp, 'SL');
    if (cur.takeProfit > 0 && c.low + s <= cur.takeProfit) return close(cur, cur.takeProfit, c.timestamp, 'TP');
    const mark = c.close + s;
    return { ...cur, pnl: pnlOf(cur, mark), rMultiple: roundMoney(rOf(cur, mark)) };
}

export interface RecomputeContext {
    symbol: string;
    /** Full loaded history for `symbol`, ascending. */
    candles: KLineData[];
    /** Last visible bar timestamp (replay cutoff, or last bar when live). */
    uptoTs: number;
    /** True when the cutoff moved backwards on the same symbol/timeframe. */
    rewind: boolean;
    /** Previous cutoff timestamp; when moving forward without rewind, enables O(activeOrders) incremental step. */
    prevUptoTs?: number;
}

/** Binary search for the first candle index whose `timestamp > targetTs` in ascending candles. */
function lowerBoundGreaterThan(candles: KLineData[], targetTs: number): number {
    let lo = 0;
    let hi = candles.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (candles[mid].timestamp <= targetTs) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    return lo;
}

/**
 * Re-derives every order of `ctx.symbol` from its intent. Orders on other
 * symbols, or opened before the loaded history starts, are left untouched.
 * On rewind, orders placed after the cutoff are removed (they haven't happened)
 * and manual closes after the cutoff are undone.
 * When advancing forward (`!rewind && prevUptoTs < uptoTs`), runs an incremental
 * O(activeOrders × deltaCandles) pass whose output matches full replay identically.
 */
export function recomputeOrders(orders: ReplayOrder[], ctx: RecomputeContext): ReplayOrder[] {
    const { candles, uptoTs, symbol, rewind, prevUptoTs } = ctx;
    if (candles.length === 0) return orders;
    const first = candles[0].timestamp;
    const last = candles[candles.length - 1].timestamp;
    const isAscending = first <= last;
    const canIncremental =
        !rewind &&
        prevUptoTs !== undefined &&
        Number.isFinite(prevUptoTs) &&
        uptoTs > prevUptoTs &&
        isAscending;

    const deltaStartIdx = canIncremental ? lowerBoundGreaterThan(candles, prevUptoTs!) : 0;

    let changed = false;
    const next: ReplayOrder[] = [];

    for (const o of orders) {
        // Realized partial-close legs stay frozen up to their close time; on rewind past close, undo the leg.
        if (o.isPartialClose) {
            if (rewind && o.closedAt !== undefined && o.closedAt > uptoTs) {
                changed = true;
                continue;
            }
            next.push(o);
            continue;
        }
        // Other symbols and legacy closed orders without an intent trail stay frozen.
        if (o.symbol !== symbol || (o.status === 'CLOSED' && o.cancelledAt === undefined)) {
            next.push(o);
            continue;
        }

        const isImported =
            Boolean(o.isImportedTrade) ||
            String(o.id || '').startsWith('mt5_') ||
            String(o.id || '').startsWith('sync-');

        if (isImported) {
            const histCloseAt = o.historicalClosedAt ?? o.closedAt;
            const histExit = o.historicalExitPrice ?? o.exitPrice ?? o.entryPrice;
            const histPnl = o.historicalPnl !== undefined ? o.historicalPnl : o.pnl;
            const histReason = o.historicalExitReason ?? o.exitReason ?? (histPnl >= 0 ? 'TP' : 'SL');
            const baseImported: ReplayOrder = {
                ...o,
                isImportedTrade: true,
                historicalClosedAt: histCloseAt,
                historicalExitPrice: histExit,
                historicalPnl: histPnl,
                historicalExitReason: histReason,
            };

            // Before the imported trade's open time: keep it safely in pre-entry state (never delete on rewind!)
            if (uptoTs < o.openedAt) {
                const preEntry: ReplayOrder = {
                    ...baseImported,
                    status: 'PENDING',
                    filledAt: undefined,
                    closedAt: undefined,
                    exitPrice: undefined,
                    pnl: 0,
                    rMultiple: 0,
                };
                if (!sameState(preEntry, o)) changed = true;
                next.push(preEntry);
                continue;
            }

            // Compute MFE/MAE across loaded candles in [o.openedAt, min(uptoTs, histCloseAt)]
            // Incremental fast-path only appends candles after prevUptoTs if trade was already active/closed before prevUptoTs.
            let impCur: ReplayOrder = { ...baseImported, mfe: o.mfe ?? 0, mae: o.mae ?? 0 };
            let lastMarkCandle: KLineData | null = null;
            const capTs = histCloseAt !== undefined ? Math.min(uptoTs, histCloseAt) : uptoTs;

            if (canIncremental && prevUptoTs! >= o.openedAt && (o.status === 'WIN' || o.status === 'LOSS') && histCloseAt !== undefined && histCloseAt <= prevUptoTs!) {
                next.push(o);
                continue;
            }

            const startScanIdx =
                canIncremental && prevUptoTs! >= o.openedAt
                    ? deltaStartIdx
                    : 0;
            if (startScanIdx === 0) {
                impCur = { ...impCur, mfe: 0, mae: 0 };
            }
            for (let i = startScanIdx; i < candles.length; i++) {
                const c = candles[i];
                if (c.timestamp < o.openedAt) continue;
                if (c.timestamp > capTs) break;
                const exc = updateExcursions(impCur, c);
                impCur = { ...impCur, mfe: exc.mfe, mae: exc.mae };
                lastMarkCandle = c;
            }

            // Between openTime and closeTime: live floating P&L during bar-by-bar replay
            if (histCloseAt !== undefined && uptoTs < histCloseAt) {
                const markPrice = lastMarkCandle
                    ? o.side === 'BUY'
                        ? lastMarkCandle.close
                        : lastMarkCandle.close + (o.spread || 0)
                    : o.entryPrice;
                const liveImported: ReplayOrder = {
                    ...impCur,
                    status: 'OPEN',
                    filledAt: o.openedAt,
                    closedAt: undefined,
                    exitPrice: undefined,
                    pnl: pnlOf(o, markPrice),
                    rMultiple: Number(rOf(o, markPrice).toFixed(2)),
                };
                if (!sameState(liveImported, o)) changed = true;
                next.push(liveImported);
                continue;
            }

            // At or past closeTime: exact broker execution (entryPrice, exitPrice, closedAt, pnl)
            const closedImported: ReplayOrder = {
                ...impCur,
                status: histPnl >= 0 ? 'WIN' : 'LOSS',
                filledAt: o.openedAt,
                closedAt: histCloseAt ?? o.openedAt,
                exitPrice: histExit,
                exitReason: histReason,
                pnl: Number(histPnl.toFixed(2)),
                rMultiple: o.riskAmount > 0 ? Number((histPnl / o.riskAmount).toFixed(2)) : 0,
            };
            if (!sameState(closedImported, o)) changed = true;
            next.push(closedImported);
            continue;
        }

        // P0-1 CRITICAL: Non-rewind reloads/ticks/steps NEVER mutate already-finalized orders!
        if (!rewind && (o.status === 'WIN' || o.status === 'LOSS' || o.status === 'CANCELLED' || o.status === 'CLOSED')) {
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

        // Incremental O(activeOrders) fast-path when advancing strictly forward:
        // Orders already finalized before prevUptoTs, and without new SL/manual/cancel edits in (prevUptoTs, uptoTs], stay frozen.
        if (
            canIncremental &&
            (o.status === 'WIN' || o.status === 'LOSS' || o.status === 'CANCELLED' || o.status === 'CLOSED') &&
            (o.closedAt === undefined || o.closedAt <= prevUptoTs!) &&
            o.openedAt <= prevUptoTs!
        ) {
            next.push(o);
            continue;
        }

        let manualAt = o.manualCloseAt;
        let manualPrice = o.manualClosePrice;
        let cancelledAt = o.cancelledAt;
        let slModAt = o.slModifiedAt;
        let effectiveStop = o.stopLoss;
        const origStop = o.initialStopLoss !== undefined ? o.initialStopLoss : o.stopLoss;

        if (rewind && manualAt !== undefined && manualAt > uptoTs) { manualAt = undefined; manualPrice = undefined; }
        if (rewind && cancelledAt !== undefined && cancelledAt > uptoTs) cancelledAt = undefined;
        if (rewind && slModAt !== undefined && slModAt > uptoTs) {
            slModAt = undefined;
            effectiveStop = origStop;
        }

        const useIncrementalStep =
            canIncremental &&
            o.openedAt <= prevUptoTs! &&
            (o.status === 'OPEN' || o.status === 'PENDING') &&
            (slModAt === undefined || slModAt <= prevUptoTs!) &&
            (cancelledAt === undefined || cancelledAt > prevUptoTs!) &&
            (manualAt === undefined || manualAt > prevUptoTs!);

        let cur: ReplayOrder;
        if (useIncrementalStep) {
            cur = {
                ...o,
                initialStopLoss: origStop,
                stopLoss: effectiveStop,
            };
        } else {
            cur = reset(o);
            cur.stopLoss = effectiveStop;
            cur.initialStopLoss = origStop;
            if (slModAt !== undefined) cur.slModifiedAt = slModAt;
            else delete cur.slModifiedAt;
            if (manualAt !== undefined) cur.manualCloseAt = manualAt;
            else delete cur.manualCloseAt;
            if (manualPrice !== undefined) cur.manualClosePrice = manualPrice;
            else delete cur.manualClosePrice;
            if (cancelledAt !== undefined) cur.cancelledAt = cancelledAt;
            else delete cur.cancelledAt;
        }

        const loopStart = useIncrementalStep ? deltaStartIdx : 0;
        for (let i = loopStart; i < candles.length; i++) {
            const c = candles[i];
            if (c.timestamp <= o.openedAt) continue;
            if (c.timestamp > uptoTs) break;
            if (cancelledAt !== undefined && c.timestamp > cancelledAt) break;
            if (manualAt !== undefined && c.timestamp > manualAt) break;
            const barStop = slModAt !== undefined && c.timestamp <= slModAt ? origStop : effectiveStop;
            cur = stepOrder(cur.stopLoss === barStop ? cur : { ...cur, stopLoss: barStop }, c);
            if (cur.status === 'WIN' || cur.status === 'LOSS') break;
        }
        if (cur.status === 'OPEN' || cur.status === 'PENDING') {
            cur = { ...cur, stopLoss: effectiveStop };
        }

        if (cur.status === 'PENDING' && cancelledAt !== undefined && cancelledAt <= uptoTs) {
            const cancelled: ReplayOrder = { ...cur, status: 'CANCELLED', cancelledAt };
            delete cancelled.closedAt;
            cur = cancelled;
        } else if (cur.status === 'OPEN' && manualAt !== undefined && manualPrice !== undefined && manualAt <= uptoTs) {
            const exit = cur.side === 'BUY' ? manualPrice : manualPrice + (cur.spread || 0);
            cur = close(cur, exit, manualAt, 'MANUAL');
        }

        if (!sameState(cur, o)) changed = true;
        next.push(cur);
    }
    return changed || next.length !== orders.length ? next : orders;
}

const sameState = (a: ReplayOrder, b: ReplayOrder) =>
    a.status === b.status &&
    a.pnl === b.pnl &&
    a.mfe === b.mfe &&
    a.mae === b.mae &&
    a.filledAt === b.filledAt &&
    a.exitPrice === b.exitPrice &&
    a.closedAt === b.closedAt &&
    a.stopLoss === b.stopLoss &&
    a.takeProfit === b.takeProfit &&
    a.entryPrice === b.entryPrice &&
    a.riskAmount === b.riskAmount &&
    a.slModifiedAt === b.slModifiedAt &&
    a.manualCloseAt === b.manualCloseAt &&
    a.cancelledAt === b.cancelledAt;

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
    const closed = orders
        .filter(isClosed)
        .sort((a, b) => (a.closedAt ?? a.openedAt ?? 0) - (b.closedAt ?? b.openedAt ?? 0));
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

    const r2 = (v: number) => roundMoney(v);
    return {
        trades: closed.length,
        wins: wins.length,
        losses: losses.length,
        winRate: closed.length ? roundHalfUp((wins.length / closed.length) * 100, 1) : 0,
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
