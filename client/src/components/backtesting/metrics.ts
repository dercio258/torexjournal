import { computeStats, ReplayStats } from '../kline-replay/engine';
import type { ReplayOrder } from '../kline-replay/types';
import type { DailyPoint } from '../charts/PnLChart';
import type { BacktestReplaySession, BacktestStrategy } from '../../services/backtestWorkspaceStore';
import { getCurrentLocale } from '../../context/LocaleContext';

/**
 * Every figure shown in the backtesting pages is derived from the session
 * orders with the same engine the replay terminal uses, so the hub and the
 * terminal can never disagree.
 */

export const closedOrders = (orders: ReplayOrder[] = []) =>
    orders.filter((o) => o.status === 'WIN' || o.status === 'LOSS').sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));

export const openOrders = (orders: ReplayOrder[] = []) => orders.filter((o) => o.status === 'OPEN' || o.status === 'PENDING');

export const sessionStats = (s: BacktestReplaySession): ReplayStats => {
    const orders = s.orders || [];
    const capital = s.startingCapital || 0;
    if (orders.length === 0 && (s._isSlimSummary || (s.closedTradesCount ?? 0) > 0)) {
        const trades = s.closedTradesCount || 0;
        const wins = s.winsCount || 0;
        const losses = s.lossesCount || 0;
        const winRate = s.winRate || 0;
        const netProfit = Number((s.netPnl || 0).toFixed(2));
        const pf = s.profitFactor && s.profitFactor > 0 ? s.profitFactor : null;
        let grossProfit = 0;
        let grossLoss = 0;
        if (pf && pf > 0 && Math.abs(pf - 1) > 1e-6 && netProfit !== 0) {
            const candidateLoss = netProfit / (pf - 1);
            if (candidateLoss > 0) {
                grossLoss = Number(candidateLoss.toFixed(2));
                grossProfit = Number(Math.max(0, netProfit + grossLoss).toFixed(2));
            }
        }
        if (grossProfit === 0 && grossLoss === 0) {
            if (netProfit < 0) {
                grossLoss = Number(Math.abs(netProfit).toFixed(2));
            } else {
                grossProfit = Number(Math.max(0, netProfit).toFixed(2));
            }
        }
        const expectancy = s.expectancy ?? (trades > 0 ? Number((netProfit / trades).toFixed(2)) : 0);
        const avgR = s.avgR || 0;
        const maxDrawdown = s.maxDrawdown || 0;
        const maxDrawdownPct = s.maxDrawdownPct || 0;
        const realizedBalance = Number((s.currentBalance ?? capital + netProfit).toFixed(2));
        return {
            trades,
            wins,
            losses,
            winRate,
            grossProfit,
            grossLoss,
            profitFactor: pf,
            netProfit,
            expectancy,
            avgR,
            maxDrawdown,
            maxDrawdownPct,
            realizedBalance,
        };
    }
    return computeStats(orders, capital);
};

/** Aggregate over many sessions. Pass `baseCapital` when scoping to a single strategy so startingCapital isn't multiplied by session count. */
export const aggregateStats = (sessions: BacktestReplaySession[], baseCapital?: number) => {
    const all = sessions.flatMap((s) => s.orders || []);
    const closed = closedOrders(all);
    const open = openOrders(all);
    const capital =
        baseCapital !== undefined
            ? baseCapital
            : sessions.length > 0
              ? Array.from(new Map(sessions.map((s) => [s.strategyId, s.startingCapital || 0])).values()).reduce((a, b) => a + b, 0)
              : 100000;
    const perSession = sessions.map(sessionStats);
    const hasSlimOnly = sessions.some(
        (s) => (s.orders?.length ?? 0) === 0 && (s._isSlimSummary || (s.closedTradesCount ?? 0) > 0)
    );

    let stats: ReplayStats;
    if (hasSlimOnly) {
        const trades = perSession.reduce((acc, st) => acc + st.trades, 0);
        const wins = perSession.reduce((acc, st) => acc + st.wins, 0);
        const losses = perSession.reduce((acc, st) => acc + st.losses, 0);
        const grossProfit = Number(perSession.reduce((acc, st) => acc + st.grossProfit, 0).toFixed(2));
        const grossLoss = Number(perSession.reduce((acc, st) => acc + st.grossLoss, 0).toFixed(2));
        const netProfit = Number(perSession.reduce((acc, st) => acc + st.netProfit, 0).toFixed(2));
        const winRate = trades > 0 ? Number(((wins / trades) * 100).toFixed(1)) : 0;
        const profitFactor =
            grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 9.99 : null;
        const expectancy = trades > 0 ? Number((netProfit / trades).toFixed(2)) : 0;
        const weightedAvgR = perSession.reduce((acc, st) => acc + st.avgR * st.trades, 0);
        const avgR = trades > 0 ? Number((weightedAvgR / trades).toFixed(2)) : 0;
        const maxDd = perSession.reduce((m, st) => Math.max(m, st.maxDrawdown), 0);
        const maxDdPct = perSession.reduce((m, st) => Math.max(m, st.maxDrawdownPct), 0);
        stats = {
            trades,
            wins,
            losses,
            winRate,
            grossProfit,
            grossLoss,
            profitFactor,
            netProfit,
            expectancy,
            avgR,
            maxDrawdown: maxDd,
            maxDrawdownPct: maxDdPct,
            realizedBalance: Number((capital + netProfit).toFixed(2)),
        };
    } else {
        stats = computeStats(all, capital);
    }

    const winsArr = closed.filter((o) => o.pnl > 0);
    const lossesArr = closed.filter((o) => o.pnl < 0);
    const avgWin = winsArr.length ? Number((winsArr.reduce((s, o) => s + o.pnl, 0) / winsArr.length).toFixed(2)) : 0;
    const avgLoss = lossesArr.length ? Number((Math.abs(lossesArr.reduce((s, o) => s + o.pnl, 0)) / lossesArr.length).toFixed(2)) : 0;
    const rTrades = closed.filter((o) => o.stopLoss > 0 && o.rMultiple !== undefined);
    const avgRWithPlan = rTrades.length ? Number((rTrades.reduce((s, o) => s + (o.rMultiple ?? 0), 0) / rTrades.length).toFixed(2)) : null;

    const daily = dailyPoints(all);
    const bestDay = daily.reduce<DailyPoint | null>((b, d) => (!b || d.value > b.value ? d : b), null);
    const worstDay = daily.reduce<DailyPoint | null>((w, d) => (!w || d.value < w.value ? d : w), null);

    // Drawdown across the consolidated curve (or worst session if higher)
    const maxDrawdown = Math.max(stats.maxDrawdown, perSession.reduce((m, s) => Math.max(m, s.maxDrawdown), 0));
    const maxDrawdownPct = Math.max(stats.maxDrawdownPct, perSession.reduce((m, s) => Math.max(m, s.maxDrawdownPct), 0));
    const closedCount = hasSlimOnly ? stats.trades : closed.length;

    return {
        ...stats,
        totalTrades: closedCount + open.length,
        closedTrades: closedCount,
        openTrades: open.length,
        avgWin,
        avgLoss,
        avgRWithPlan,
        rTradesCount: rTrades.length,
        bestDay,
        worstDay,
        maxDrawdown,
        maxDrawdownPct,
        bestSession: perSession.reduce((m, s) => Math.max(m, s.netProfit), 0),
        worstSession: perSession.reduce((m, s) => Math.min(m, s.netProfit), 0),
        capital,
        currentBalance: Number((capital + stats.netProfit).toFixed(2)),
    };
};

export const strategySummary = (strategy: BacktestStrategy, allSessions: BacktestReplaySession[]) => {
    const stratSessions = allSessions.filter((s) => s.strategyId === strategy.id);
    const agg = aggregateStats(stratSessions, strategy.startingCapital || 100000);
    const timeInvestedSeconds = stratSessions.reduce((a, s) => a + (s.timeInvestedSeconds || 0), 0);
    return {
        ...agg,
        sessionsCount: stratSessions.length,
        activeSessionsCount: stratSessions.filter((s) => s.status === 'ACTIVE').length,
        timeInvestedSeconds,
        sessions: stratSessions,
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

export interface EquityPoint {
    label: string;
    sublabel?: string;
    balance: number;
    delta: number;
}

export const equitySeries = (orders: ReplayOrder[], initialCapital: number, mode: 'trades' | 'days'): EquityPoint[] => {
    const isEn = getCurrentLocale() === 'en';
    const closed = closedOrders(orders);
    if (closed.length === 0) return [];
    if (mode === 'trades') {
        let bal = initialCapital;
        const pts: EquityPoint[] = [{ label: '#0', sublabel: isEn ? 'Initial balance' : 'Saldo inicial', balance: initialCapital, delta: 0 }];
        closed.forEach((o, idx) => {
            bal = Math.round((bal + o.pnl) * 100) / 100;
            pts.push({
                label: `#${idx + 1}`,
                sublabel: `${o.symbol} · ${isEn ? (o.side === 'BUY' ? 'Long' : 'Short') : o.side === 'BUY' ? 'Compra' : 'Venda'}`,
                balance: bal,
                delta: o.pnl,
            });
        });
        return pts;
    }
    const daily = dailyPoints(closed);
    let bal = initialCapital;
    const pts: EquityPoint[] = [
        { label: isEn ? 'Start' : 'Início', sublabel: isEn ? 'Initial balance' : 'Saldo inicial', balance: initialCapital, delta: 0 },
    ];
    daily.forEach((d) => {
        bal = Math.round((bal + d.value) * 100) / 100;
        pts.push({
            label: d.date,
            sublabel: d.isoDate,
            balance: bal,
            delta: d.value,
        });
    });
    return pts;
};

export interface UnderwaterPoint {
    label: string;
    ddPct: number; // <= 0 (e.g. -2.4 means 2.4% below peak)
    ddAbs: number;
}

export const underwaterSeries = (orders: ReplayOrder[], initialCapital: number): UnderwaterPoint[] => {
    const closed = closedOrders(orders);
    if (closed.length === 0 || initialCapital <= 0) return [];
    let equity = initialCapital;
    let peak = initialCapital;
    const pts: UnderwaterPoint[] = [{ label: '#0', ddPct: 0, ddAbs: 0 }];
    closed.forEach((o, i) => {
        equity += o.pnl;
        peak = Math.max(peak, equity);
        const ddAbs = Math.max(0, peak - equity);
        const ddPct = peak > 0 ? -Number(((ddAbs / peak) * 100).toFixed(2)) : 0;
        pts.push({ label: `#${i + 1}`, ddPct, ddAbs: Number(ddAbs.toFixed(2)) });
    });
    return pts;
};

export interface RBucket {
    label: string;
    count: number;
    positive: boolean;
}

export const rDistribution = (orders: ReplayOrder[]): RBucket[] => {
    const isEn = getCurrentLocale() === 'en';
    const sep = isEn ? 'to' : 'a';
    const closed = closedOrders(orders).filter((o) => o.stopLoss > 0 && o.rMultiple !== undefined);
    const defs: { label: string; min: number; max: number; positive: boolean }[] = [
        { label: '≤ −2R', min: -Infinity, max: -2, positive: false },
        { label: `−2R ${sep} −1R`, min: -2, max: -1, positive: false },
        { label: `−1R ${sep} 0R`, min: -1, max: 0, positive: false },
        { label: `0R ${sep} +1R`, min: 0, max: 1, positive: true },
        { label: `+1R ${sep} +2R`, min: 1, max: 2, positive: true },
        { label: `+2R ${sep} +3R`, min: 2, max: 3, positive: true },
        { label: '> +3R', min: 3, max: Infinity, positive: true },
    ];
    return defs.map((b) => ({
        label: b.label,
        positive: b.positive,
        count: closed.filter((o) => {
            const r = o.rMultiple ?? 0;
            if (b.min === -Infinity) return r <= b.max;
            if (b.max === Infinity) return r > b.min;
            return b.positive ? r > b.min && r <= b.max : r > b.min && r <= b.max;
        }).length,
    }));
};

export interface ProgressPoint {
    index: number;
    label: string;
    winRate: number;
    avgR: number;
}

export const progressSeries = (orders: ReplayOrder[]): ProgressPoint[] => {
    const closed = closedOrders(orders);
    let wins = 0;
    let sumR = 0;
    return closed.map((o, idx) => {
        if (o.pnl > 0) wins += 1;
        sumR += o.rMultiple ?? 0;
        const n = idx + 1;
        return {
            index: n,
            label: `#${n}`,
            winRate: Number(((wins / n) * 100).toFixed(1)),
            avgR: Number((sumR / n).toFixed(2)),
        };
    });
};

export interface HourRow {
    hour: number;
    label: string;
    trades: number;
    wins: number;
    pnl: number;
}

export const byEntryHour = (orders: ReplayOrder[]): HourRow[] => {
    const rows: HourRow[] = Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        label: `${String(h).padStart(2, '0')}h`,
        trades: 0,
        wins: 0,
        pnl: 0,
    }));
    closedOrders(orders).forEach((o) => {
        const h = new Date(o.openedAt).getHours();
        if (h >= 0 && h < 24) {
            rows[h].trades += 1;
            if (o.pnl > 0) rows[h].wins += 1;
            rows[h].pnl = Number((rows[h].pnl + o.pnl).toFixed(2));
        }
    });
    return rows;
};

export interface BehaviorScore {
    ready: boolean;
    sampleSize: number;
    overall: number | null;
    axes: {
        key: string;
        label: string;
        value: number;
    }[];
}

export const computeBehavior = (orders: ReplayOrder[]): BehaviorScore => {
    const isEn = getCurrentLocale() === 'en';
    const closed = closedOrders(orders);
    const n = closed.length;
    if (n < 3) {
        return {
            ready: false,
            sampleSize: n,
            overall: null,
            axes: [
                { key: 'discipline', label: isEn ? 'Discipline' : 'Disciplina', value: 0 },
                { key: 'execution', label: isEn ? 'Execution' : 'Execução', value: 0 },
                { key: 'risk', label: isEn ? 'Risk' : 'Risco', value: 0 },
                { key: 'consistency', label: isEn ? 'Consistency' : 'Consistência', value: 0 },
                { key: 'results', label: isEn ? 'Results' : 'Resultados', value: 0 },
            ],
        };
    }

    const withStop = closed.filter((o) => o.stopLoss > 0).length;
    let discipline = Math.round((withStop / n) * 100);

    const plannedExits = closed.filter((o) => o.exitReason === 'TP' || o.exitReason === 'SL').length;
    let execution = Math.round((plannedExits / n) * 100);

    const risks = closed.map((o) => o.riskAmount || 0).filter((v) => v > 0);
    let riskScore = 70;
    if (risks.length >= 2) {
        const mean = risks.reduce((a, b) => a + b, 0) / risks.length;
        const variance = risks.reduce((a, v) => a + (v - mean) ** 2, 0) / risks.length;
        const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
        riskScore = Math.round(Math.max(15, Math.min(100, (1 - Math.min(cv, 1)) * 100)));
    }

    const daily = dailyPoints(closed);
    const greenDays = daily.filter((d) => d.value > 0).length;
    let consistency = daily.length > 0 ? Math.round((greenDays / daily.length) * 100) : 50;

    // Enrich Behavior Pentagon with Journal & Guided Questions when present (NEVER assuming zero when absent)
    const planScores: number[] = [];
    const execJournalScores: number[] = [];
    const riskComfortScores: number[] = [];
    const emotionalStabilityScores: number[] = [];

    for (const o of closed) {
        const pc = o.psychCheck;
        if (pc?.followingPlan) {
            if (pc.followingPlan === 'Sim' || pc.followingPlan === '100% no Plano') planScores.push(100);
            else if (pc.followingPlan === 'Ajuste Parcial') planScores.push(68);
            else if (pc.followingPlan === 'Não' || pc.followingPlan === 'Fora do Plano') planScores.push(18);
        }
        if (pc?.entryDriver) {
            if (pc.entryDriver === 'Estratégia' || pc.entryDriver === 'Estratégia Validada') planScores.push(100);
            else if (pc.entryDriver === 'Confirmação Parcial') planScores.push(65);
            else if (
                pc.entryDriver === 'Impulso' ||
                pc.entryDriver === 'Impulso / FOMO' ||
                pc.entryDriver === 'Revenge Trade'
            ) {
                planScores.push(15);
            }
        }
        if (o.rating && o.rating >= 1 && o.rating <= 5) {
            execJournalScores.push(((o.rating - 1) / 4) * 100);
        }
        if (o.mfe && o.mfe > 0 && o.pnl > 0) {
            const capture = Math.max(0, Math.min(1, o.pnl / o.mfe)) * 100;
            execJournalScores.push(capture);
        }
        if (pc?.riskComfort) {
            if (pc.riskComfort === 'Sim' || pc.riskComfort === 'Confortável') riskComfortScores.push(100);
            else if (pc.riskComfort === 'Lote um pouco alto') riskComfortScores.push(55);
            else if (pc.riskComfort === 'Não' || pc.riskComfort === 'Desconfortável / Overrisk') riskComfortScores.push(15);
        }
        if (pc?.feeling) {
            if (pc.feeling === 'Calmo' || pc.feeling === 'Calmo & Focado' || pc.feeling === 'Confiante') {
                emotionalStabilityScores.push(95);
            } else if (pc.feeling === 'Hesitante') {
                emotionalStabilityScores.push(60);
            } else if (pc.feeling === 'Ansioso' || pc.feeling === 'Frustrado') {
                emotionalStabilityScores.push(25);
            }
        }
    }

    const blendNonZero = (base: number, samples: number[], maxWeight: number): number => {
        if (samples.length === 0) return base; // Zero penalty: 100% original math when absent
        const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
        const coverage = Math.min(1, samples.length / Math.max(1, n));
        const w = maxWeight * (0.45 + 0.55 * coverage);
        return Math.round(Math.max(0, Math.min(100, base * (1 - w) + avg * w)));
    };

    discipline = blendNonZero(discipline, planScores, 0.35);
    execution = blendNonZero(execution, execJournalScores, 0.3);
    riskScore = blendNonZero(riskScore, riskComfortScores, 0.3);
    consistency = blendNonZero(consistency, emotionalStabilityScores, 0.25);

    const grossWin = closed.filter((o) => o.pnl > 0).reduce((s, o) => s + o.pnl, 0);
    const grossLoss = Math.abs(closed.filter((o) => o.pnl < 0).reduce((s, o) => s + o.pnl, 0));
    const pf = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 3 : 0;
    const results = Math.round(Math.max(0, Math.min(100, (pf / 2.5) * 100)));

    const axes = [
        { key: 'discipline', label: isEn ? 'Discipline' : 'Disciplina', value: discipline },
        { key: 'execution', label: isEn ? 'Execution' : 'Execução', value: execution },
        { key: 'risk', label: isEn ? 'Risk' : 'Risco', value: riskScore },
        { key: 'consistency', label: isEn ? 'Consistency' : 'Consistência', value: consistency },
        { key: 'results', label: isEn ? 'Results' : 'Resultados', value: results },
    ];
    const overall = Math.round(axes.reduce((s, a) => s + a.value, 0) / axes.length);
    return { ready: true, sampleSize: n, overall, axes };
};

export type BreakdownDimension = 'none' | 'dow' | 'hour' | 'side' | 'symbol' | 'session';

export interface BreakdownRow {
    id: string;
    label: string;
    href?: string;
    trades: number;
    wins: number;
    losses: number;
    winRate: number;
    avgR: number;
    profitFactor: number | null;
    pnl: number;
}

const DOW_LABELS_PT = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const DOW_LABELS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const computeBreakdown = (sessions: BacktestReplaySession[], dimension: BreakdownDimension): BreakdownRow[] => {
    const isEn = getCurrentLocale() === 'en';
    const tagged = sessions.flatMap((s) =>
        closedOrders(s.orders || []).map((o) => ({ order: o, session: s }))
    );

    const buildRow = (id: string, label: string, items: ReplayOrder[], href?: string): BreakdownRow => {
        const wins = items.filter((o) => o.pnl > 0);
        const losses = items.filter((o) => o.pnl < 0);
        const gp = wins.reduce((s, o) => s + o.pnl, 0);
        const gl = Math.abs(losses.reduce((s, o) => s + o.pnl, 0));
        const pnl = Number((gp - gl).toFixed(2));
        const avgR = items.length ? Number((items.reduce((s, o) => s + (o.rMultiple ?? 0), 0) / items.length).toFixed(2)) : 0;
        return {
            id,
            label,
            href,
            trades: items.length,
            wins: wins.length,
            losses: losses.length,
            winRate: items.length ? Number(((wins.length / items.length) * 100).toFixed(1)) : 0,
            avgR,
            profitFactor: gl > 0 ? Number((gp / gl).toFixed(2)) : gp > 0 ? null : 0,
            pnl,
        };
    };

    if (dimension === 'none') {
        const all = tagged.map((t) => t.order);
        return all.length ? [buildRow('total', isEn ? 'Consolidated Total' : 'Total consolidado', all)] : [];
    }

    if (dimension === 'session') {
        return sessions.map((s) => buildRow(s.id, `${s.name} (${s.primarySymbol})`, closedOrders(s.orders || []), `/backtesting/sessions/${s.id}`));
    }

    const groups = new Map<string, { label: string; orders: ReplayOrder[] }>();
    for (const { order } of tagged) {
        let key = '';
        let label = '';
        if (dimension === 'dow') {
            const d = new Date(order.openedAt).getDay();
            key = String(d);
            label = isEn ? DOW_LABELS_EN[d] : DOW_LABELS_PT[d];
        } else if (dimension === 'hour') {
            const h = new Date(order.openedAt).getHours();
            if (h < 7) { key = 'asia'; label = isEn ? 'Asia (00:00–06:59)' : 'Asiática (00h–06h)'; }
            else if (h < 13) { key = 'london'; label = isEn ? 'London (07:00–12:59)' : 'Londres (07h–12h)'; }
            else if (h < 18) { key = 'ny'; label = isEn ? 'New York (13:00–17:59)' : 'Nova Iorque (13h–17h)'; }
            else { key = 'late'; label = isEn ? 'Close / Post-NY (18:00–23:59)' : 'Fecho / Pós-NY (18h–23h)'; }
        } else if (dimension === 'side') {
            key = order.side;
            label = isEn ? (order.side === 'BUY' ? 'Long (Buy)' : 'Short (Sell)') : order.side === 'BUY' ? 'Compra (Buy)' : 'Venda (Sell)';
        } else if (dimension === 'symbol') {
            key = order.symbol;
            label = order.symbol;
        }
        const g = groups.get(key) || { label, orders: [] };
        g.orders.push(order);
        groups.set(key, g);
    }

    return [...groups.entries()]
        .map(([k, g]) => buildRow(k, g.label, g.orders))
        .sort((a, b) => b.pnl - a.pnl);
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
    const isEn = getCurrentLocale() === 'en';
    if (worstDayPct >= maxDailyLossPct) {
        breach = isEn
            ? `Daily loss of ${worstDayPct}% breached the ${maxDailyLossPct}% limit`
            : `Perda diária de ${worstDayPct}% atingiu o limite de ${maxDailyLossPct}%`;
    } else if (totalDdPct >= maxTotalLossPct) {
        breach = isEn
            ? `Drawdown of ${totalDdPct}% below initial capital breached the ${maxTotalLossPct}% limit`
            : `Queda de ${totalDdPct}% abaixo do capital atingiu o limite de ${maxTotalLossPct}%`;
    }

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
