import { KLineData } from 'klinecharts';
import api from '../api';
import { ReplayOrder } from '../components/kline-replay/types';
import {
    BacktestReplaySession,
    createBacktestSession,
    loadBacktestSessions,
    loadBacktestStrategies,
    updateBacktestSession,
} from './backtestWorkspaceStore';

const DB_NAME = 'torex_historical_ohlcv_batches_v1';
const DB_VERSION = 1;
const STORE_BATCHES = 'ohlcv_batches';

export interface StoredCandleBatch {
    key: string; // `${symbol}:${timeframe}:${bucketTs}`
    seriesKey: string; // `${symbol}:${timeframe}`
    symbol: string;
    timeframe: string;
    bucketTs: number;
    earliestTs: number;
    latestTs: number;
    candles: KLineData[];
    source: string;
    savedAt: number;
}

export interface BatchLoadProgress {
    symbol: string;
    timeframe: string;
    loadedBatches: number;
    totalBatches: number;
    totalBars: number;
    earliestTs: number | null;
    latestTs: number | null;
    fromCache: boolean;
    isPrefetching: boolean;
    hasMore: boolean;
    statusText: string;
}

export interface UnifiedSyncBatchProgress {
    phase: 'BROKER_SYNC' | 'TRADE_BATCHES' | 'OHLCV_PREFETCH' | 'SESSION_ASSEMBLY' | 'DONE';
    loadedTradeBatches: number;
    totalTradeBatches: number;
    totalTradesPulled: number;
    loadedCandleBatches: number;
    totalCandleBatches: number;
    totalCandlesCached: number;
    message: string;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openBatchDatabase(): Promise<IDBDatabase | null> {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
        return Promise.resolve(null);
    }
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve) => {
        try {
            const req = window.indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE_BATCHES)) {
                    const store = db.createObjectStore(STORE_BATCHES, { keyPath: 'key' });
                    store.createIndex('by_series', 'seriesKey', { unique: false });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        } catch (_) {
            resolve(null);
        }
    });

    return dbPromise;
}

export function normalizeSymbolKey(symbol: string): string {
    return (symbol || 'XAUUSD').replace(/^.*:/, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'XAUUSD';
}

export function normalizeTimeframeKey(tf: string): string {
    const clean = (tf || '15m').trim();
    const map: Record<string, string> = {
        '1': '1m',
        '1m': '1m',
        'M1': '1m',
        '5': '5m',
        '5m': '5m',
        'M5': '5m',
        '15': '15m',
        '15m': '15m',
        'M15': '15m',
        '30': '30m',
        '30m': '30m',
        'M30': '30m',
        '60': '1H',
        '1h': '1H',
        '1H': '1H',
        'H1': '1H',
        '240': '4H',
        '4h': '4H',
        '4H': '4H',
        'H4': '4H',
        '1D': '1D',
        '1d': '1D',
        'D': '1D',
        '1W': '1W',
        '1w': '1W',
        'W': '1W',
    };
    return map[clean] || clean;
}

export function mergeAndDeduplicateCandles(existing: KLineData[], incoming: KLineData[]): KLineData[] {
    const map = new Map<number, KLineData>();
    for (const c of existing) {
        if (c && Number.isFinite(c.timestamp) && Number.isFinite(c.open) && Number.isFinite(c.close)) {
            map.set(c.timestamp, c);
        }
    }
    for (const c of incoming) {
        if (c && Number.isFinite(c.timestamp) && Number.isFinite(c.open) && Number.isFinite(c.close)) {
            map.set(c.timestamp, c);
        }
    }
    return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
}

export async function saveCandleBatchToIDB(
    symbol: string,
    timeframe: string,
    candles: KLineData[],
    source: string = 'TradingView'
): Promise<void> {
    if (!candles || candles.length === 0) return;
    const db = await openBatchDatabase();
    if (!db) return;

    const sym = normalizeSymbolKey(symbol);
    const tf = normalizeTimeframeKey(timeframe);
    const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
    const earliestTs = sorted[0].timestamp;
    const latestTs = sorted[sorted.length - 1].timestamp;
    // Bucket by 500-bar window start so overlapping updates overwrite cleanly
    const bucketTs = Math.floor(earliestTs / (3600 * 1000 * 12)) * (3600 * 1000 * 12);
    const seriesKey = `${sym}:${tf}`;
    const key = `${seriesKey}:${bucketTs}`;

    const record: StoredCandleBatch = {
        key,
        seriesKey,
        symbol: sym,
        timeframe: tf,
        bucketTs,
        earliestTs,
        latestTs,
        candles: sorted,
        source,
        savedAt: Date.now(),
    };

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_BATCHES, 'readwrite');
            const store = tx.objectStore(STORE_BATCHES);
            store.put(record);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch (_) {
            resolve();
        }
    });
}

export async function getMergedCandlesFromIDB(
    symbol: string,
    timeframe: string
): Promise<{
    candles: KLineData[];
    batchCount: number;
    earliestTs: number | null;
    latestTs: number | null;
    source: string;
}> {
    const db = await openBatchDatabase();
    if (!db) {
        return { candles: [], batchCount: 0, earliestTs: null, latestTs: null, source: 'TradingView' };
    }

    const sym = normalizeSymbolKey(symbol);
    const tf = normalizeTimeframeKey(timeframe);
    const seriesKey = `${sym}:${tf}`;

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_BATCHES, 'readonly');
            const store = tx.objectStore(STORE_BATCHES);
            const idx = store.index('by_series');
            const req = idx.getAll(IDBKeyRange.only(seriesKey));

            req.onsuccess = () => {
                const batches: StoredCandleBatch[] = Array.isArray(req.result) ? req.result : [];
                if (batches.length === 0) {
                    resolve({ candles: [], batchCount: 0, earliestTs: null, latestTs: null, source: 'TradingView' });
                    return;
                }
                let merged: KLineData[] = [];
                let source = 'TradingView';
                for (const b of batches) {
                    merged = mergeAndDeduplicateCandles(merged, b.candles || []);
                    if (b.source) source = b.source;
                }
                resolve({
                    candles: merged,
                    batchCount: batches.length,
                    earliestTs: merged.length > 0 ? merged[0].timestamp : null,
                    latestTs: merged.length > 0 ? merged[merged.length - 1].timestamp : null,
                    source,
                });
            };
            req.onerror = () => {
                resolve({ candles: [], batchCount: 0, earliestTs: null, latestTs: null, source: 'TradingView' });
            };
        } catch (_) {
            resolve({ candles: [], batchCount: 0, earliestTs: null, latestTs: null, source: 'TradingView' });
        }
    });
}

const toKLine = (c: any): KLineData => ({
    timestamp: Number(
        c.timestamp ??
            (typeof c.time === 'number' ? (c.time < 1e10 ? c.time * 1000 : c.time) : new Date(c.time).getTime())
    ),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume || 0),
});

/**
 * Fetches a single 500-candle chunk from the backend `/tradingview/candles/batch` endpoint
 * and persists it into IndexedDB.
 */
export async function fetchSingleCandleBatch(params: {
    symbol: string;
    timeframe: string;
    chunkSize?: number;
    chunkIndex?: number;
    cursorTo?: number;
    fromTs?: number;
    toTs?: number;
}): Promise<{
    candles: KLineData[];
    nextCursorTo: number | null;
    hasMore: boolean;
    estimatedTotalChunks: number;
    fromCache: boolean;
}> {
    const chunkSize = params.chunkSize || 500;
    const res = await api.get('/tradingview/candles/batch', {
        params: {
            symbol: params.symbol,
            timeframe: params.timeframe,
            chunkSize,
            chunkIndex: params.chunkIndex || 0,
            cursorTo: params.cursorTo,
            from: params.fromTs,
            to: params.toTs,
        },
    });

    const data = res.data || {};
    const rawList = Array.isArray(data.candles) ? data.candles : Array.isArray(data) ? data : [];
    const candles = rawList
        .map(toKLine)
        .filter((c: KLineData) => Number.isFinite(c.timestamp) && Number.isFinite(c.open) && Number.isFinite(c.close))
        .sort((a: KLineData, b: KLineData) => a.timestamp - b.timestamp);

    if (candles.length > 0) {
        await saveCandleBatchToIDB(params.symbol, params.timeframe, candles, 'TradingView');
    }

    return {
        candles,
        nextCursorTo: data.nextCursorTo ?? null,
        hasMore: Boolean(data.hasMore),
        estimatedTotalChunks: Number(data.estimatedTotalChunks) || 1,
        fromCache: Boolean(data.fromCache),
    };
}

/**
 * Maps a raw trade from `/journal/trades` to a `ReplayOrder` for the Replay Terminal.
 */
export function mapSyncedTradeToReplayOrder(rawTrade: any, idx: number = 0): ReplayOrder {
    const isBuy = (rawTrade.type || 'BUY').toUpperCase().includes('BUY');
    const entryPrice = Number(rawTrade.openPrice) || 1.0;
    const closePrice = Number(rawTrade.closePrice) || entryPrice;
    const sl =
        Number(rawTrade.stopLoss) > 0
            ? Number(rawTrade.stopLoss)
            : Number((isBuy ? entryPrice * 0.996 : entryPrice * 1.004).toFixed(5));
    const tp =
        Number(rawTrade.takeProfit) > 0
            ? Number(rawTrade.takeProfit)
            : Number((isBuy ? entryPrice * 1.008 : entryPrice * 0.992).toFixed(5));
    const openTs = rawTrade.openTime ? new Date(rawTrade.openTime).getTime() : Date.now() - 86400000;
    const closeTs = rawTrade.closeTime ? new Date(rawTrade.closeTime).getTime() : openTs + 1800000;
    const riskDist = Math.abs(entryPrice - sl);
    const rewardDist = Math.abs(tp - entryPrice);
    const rrTarget = riskDist > 0 ? Number((rewardDist / riskDist).toFixed(2)) : 2.0;

    return {
        id: String(rawTrade.id || rawTrade.ticket || `sync-${idx}-${Date.now()}`),
        symbol: normalizeSymbolKey(rawTrade.symbol || 'XAUUSD'),
        side: isBuy ? 'BUY' : 'SELL',
        type: 'MARKET',
        status: rawTrade.closeTime ? 'CLOSED' : 'OPEN',
        lots: Number(rawTrade.volume || rawTrade.lots || 0.1),
        entryPrice,
        stopLoss: sl,
        takeProfit: tp,
        closePrice: rawTrade.closeTime ? closePrice : undefined,
        openTimestamp: openTs,
        closeTimestamp: rawTrade.closeTime ? closeTs : undefined,
        pnl: Number(rawTrade.profit || 0),
        riskPercent: 1.0,
        rrTarget,
    };
}

/**
 * Pulls all historical trades of an account in sequential batches, pre-fetches 500-candle OHLCV
 * batches for every traded symbol into IndexedDB + Server Cache, and assembles/updates a
 * SINGLE UNIFIED REPLAY SESSION for the complete synchronization.
 */
export async function pullAccountHistoryInBatchesAndBuildUnifiedSession(options: {
    accountId?: string;
    accountName?: string;
    syncSourceLabel?: string;
    isDeriv?: boolean;
    triggerLiveBrokerSync?: boolean;
    focusTrade?: any;
    onProgress?: (progress: UnifiedSyncBatchProgress) => void;
}): Promise<{
    session: BacktestReplaySession;
    totalTrades: number;
    totalCandlesCached: number;
    pairs: string[];
}> {
    const emit = (p: UnifiedSyncBatchProgress) => {
        options.onProgress?.(p);
    };

    // 1. Optional live broker synchronization (MT5 Cloud / EA / Deriv)
    if (options.triggerLiveBrokerSync) {
        emit({
            phase: 'BROKER_SYNC',
            loadedTradeBatches: 0,
            totalTradeBatches: 1,
            totalTradesPulled: 0,
            loadedCandleBatches: 0,
            totalCandleBatches: 1,
            totalCandlesCached: 0,
            message: `Conectando ao ${options.syncSourceLabel || 'MT5 / Deriv'} para sincronizar novos lotes da conta...`,
        });

        try {
            if (options.isDeriv) {
                await api.post('/integrations/deriv/sync');
            } else {
                await api.post('/mt5/cloud/sync', { accountId: options.accountId });
            }
        } catch (_) {
            // Even if live cloud sync is offline, continue pulling stored historical batches
        }
    }

    // 2. Pull historical trades from `/journal/trades` and process them in sequential batches of 25 trades
    emit({
        phase: 'TRADE_BATCHES',
        loadedTradeBatches: 0,
        totalTradeBatches: 1,
        totalTradesPulled: 0,
        loadedCandleBatches: 0,
        totalCandleBatches: 1,
        totalCandlesCached: 0,
        message: 'Puxando histórico de operações da conta em lotes...',
    });

    let rawTrades: any[] = [];
    try {
        const res = await api.get('/journal/trades', {
            params: options.accountId ? { accountId: options.accountId } : undefined,
        });
        rawTrades = Array.isArray(res.data) ? res.data : [];
    } catch (_) {
        rawTrades = [];
    }

    if (options.focusTrade && !rawTrades.some((t) => String(t.id) === String(options.focusTrade.id))) {
        rawTrades.unshift(options.focusTrade);
    }

    // Filter to the target account if accountId is provided
    const accountTrades = options.accountId
        ? rawTrades.filter((t) => !t.accountId || String(t.accountId) === String(options.accountId))
        : rawTrades;

    const effectiveTrades = accountTrades.length > 0 ? accountTrades : rawTrades;
    const TRADE_BATCH_SIZE = 25;
    const totalTradeBatches = Math.max(1, Math.ceil(effectiveTrades.length / TRADE_BATCH_SIZE));
    const mappedOrders: ReplayOrder[] = [];

    for (let b = 0; b < totalTradeBatches; b++) {
        const slice = effectiveTrades.slice(b * TRADE_BATCH_SIZE, (b + 1) * TRADE_BATCH_SIZE);
        slice.forEach((t, idx) => {
            mappedOrders.push(mapSyncedTradeToReplayOrder(t, b * TRADE_BATCH_SIZE + idx));
        });
        emit({
            phase: 'TRADE_BATCHES',
            loadedTradeBatches: b + 1,
            totalTradeBatches,
            totalTradesPulled: mappedOrders.length,
            loadedCandleBatches: 0,
            totalCandleBatches: 1,
            totalCandlesCached: 0,
            message: `Lote de Trades ${b + 1}/${totalTradeBatches} processado (${mappedOrders.length} trades)...`,
        });
        // Yield briefly to keep UI responsive
        await new Promise((r) => setTimeout(r, 40));
    }

    // Sort orders chronologically by openTimestamp
    mappedOrders.sort((a, b) => a.openTimestamp - b.openTimestamp);

    // 3. Extract unique pairs and date window across all batches
    const focusSymbol = options.focusTrade ? normalizeSymbolKey(options.focusTrade.symbol) : undefined;
    const uniquePairs = Array.from(
        new Set([
            ...(focusSymbol ? [focusSymbol] : []),
            ...mappedOrders.map((o) => normalizeSymbolKey(o.symbol)).filter(Boolean),
        ])
    ).slice(0, 12);

    if (uniquePairs.length === 0) {
        uniquePairs.push('XAUUSD');
    }

    const timestamps = mappedOrders.map((o) => o.openTimestamp).filter((ts) => Number.isFinite(ts) && ts > 0);
    const minTs = timestamps.length > 0 ? Math.min(...timestamps) : Date.now() - 14 * 86400000;
    const maxTs = timestamps.length > 0 ? Math.max(...timestamps) : Date.now();

    const fromDate = new Date(minTs - 2 * 86400000).toISOString().slice(0, 10);
    const toDate = new Date(Math.min(Date.now(), maxTs + 2 * 86400000)).toISOString().slice(0, 10);

    // 4. Pre-fetch 500-candle OHLCV batches per symbol into Backend Cache + Frontend IndexedDB
    const symbolsToPrefetch = uniquePairs.slice(0, 5);
    const totalCandleBatches = symbolsToPrefetch.length;
    let totalCandlesCached = 0;

    // Warm server cache in parallel first
    try {
        await api.post('/tradingview/candles/prefetch', {
            items: symbolsToPrefetch.map((sym) => ({
                symbol: sym,
                timeframe: '15m',
                toTs: Math.min(Date.now(), maxTs + 12 * 3600 * 1000),
                fromTs: minTs - 24 * 3600 * 1000,
                chunkSize: 500,
            })),
        });
    } catch (_) {}

    for (let i = 0; i < symbolsToPrefetch.length; i++) {
        const sym = symbolsToPrefetch[i];
        emit({
            phase: 'OHLCV_PREFETCH',
            loadedTradeBatches: totalTradeBatches,
            totalTradeBatches,
            totalTradesPulled: mappedOrders.length,
            loadedCandleBatches: i,
            totalCandleBatches,
            totalCandlesCached,
            message: `Baixando lote de 500 velas OHLCV (${sym} · 15m) [${i + 1}/${totalCandleBatches}]...`,
        });

        try {
            const symbolOrders = mappedOrders.filter((o) => o.symbol === sym);
            const latestOrderTs =
                symbolOrders.length > 0
                    ? Math.max(...symbolOrders.map((o) => o.closeTimestamp || o.openTimestamp))
                    : maxTs;

            const batch = await fetchSingleCandleBatch({
                symbol: sym,
                timeframe: '15m',
                chunkSize: 500,
                chunkIndex: 0,
                cursorTo: Math.min(Date.now(), latestOrderTs + 6 * 3600 * 1000),
                fromTs: minTs - 24 * 3600 * 1000,
            });
            totalCandlesCached += batch.candles.length;
        } catch (_) {
            // Check if already in IDB
            const cached = await getMergedCandlesFromIDB(sym, '15m');
            totalCandlesCached += cached.candles.length;
        }

        emit({
            phase: 'OHLCV_PREFETCH',
            loadedTradeBatches: totalTradeBatches,
            totalTradeBatches,
            totalTradesPulled: mappedOrders.length,
            loadedCandleBatches: i + 1,
            totalCandleBatches,
            totalCandlesCached,
            message: `Lote OHLCV ${sym} armazenado no cache (${totalCandlesCached} velas)...`,
        });
    }

    // 5. Assemble or Update the SINGLE UNIFIED REPLAY SESSION for this Account Sync
    emit({
        phase: 'SESSION_ASSEMBLY',
        loadedTradeBatches: totalTradeBatches,
        totalTradeBatches,
        totalTradesPulled: mappedOrders.length,
        loadedCandleBatches: totalCandleBatches,
        totalCandleBatches,
        totalCandlesCached,
        message: 'Consolidando Sessão Única de Replay da Sincronização...',
    });

    const strategies = loadBacktestStrategies();
    const defaultStrat = strategies[0];
    const existingSessions = loadBacktestSessions();

    const accountTag = options.accountName || (options.accountId ? `Conta ${String(options.accountId).slice(0, 6)}` : 'Conta Principal');
    const unifiedSessionPrefix = `[Sync Unificado] ${accountTag}`;

    // Find existing unified session for this account so all sync batches converge into ONE session
    let unifiedSession = existingSessions.find(
        (s) => s.name.startsWith(unifiedSessionPrefix) || s.journalNotes?.includes(`SYNC_ACCOUNT_ID:${options.accountId || 'DEFAULT'}`)
    );

    const netPnl = mappedOrders.reduce((acc, o) => acc + (o.pnl || 0), 0);
    const winsCount = mappedOrders.filter((o) => (o.pnl || 0) > 0).length;
    const lossesCount = mappedOrders.filter((o) => (o.pnl || 0) <= 0).length;
    const closedCount = mappedOrders.length;
    const winRate = closedCount > 0 ? Number(((winsCount / closedCount) * 100).toFixed(1)) : 0;
    const grossProfit = mappedOrders.filter((o) => o.pnl > 0).reduce((a, b) => a + b.pnl, 0);
    const grossLoss = Math.abs(mappedOrders.filter((o) => o.pnl < 0).reduce((a, b) => a + b.pnl, 0));
    const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 9.99 : 0;

    // Position the initial replay timestamp 15 minutes before the focusTrade (or earliest trade)
    const targetEntryTs = options.focusTrade?.openTime
        ? new Date(options.focusTrade.openTime).getTime()
        : mappedOrders[0]?.openTimestamp || minTs;
    const initialReplayTimestamp = targetEntryTs - 15 * 60 * 1000;

    const sessionNotes = [
        `SYNC_ACCOUNT_ID:${options.accountId || 'DEFAULT'}`,
        `Sessão Única consolidada via ${options.syncSourceLabel || 'MT5 Sync'} em lotes.`,
        `Total de operações sincronizadas: ${mappedOrders.length} trades em ${uniquePairs.length} ativos (${uniquePairs.join(', ')}).`,
        `Cache OHLCV IndexedDB: ${totalCandlesCached} velas pré-carregadas em blocos de 500.`,
    ].join('\n');

    if (unifiedSession) {
        const mergedPairs = Array.from(new Set([...(focusSymbol ? [focusSymbol] : []), ...uniquePairs, ...unifiedSession.pairs]));
        const updated = updateBacktestSession(unifiedSession.id, {
            name: `${unifiedSessionPrefix} (${mappedOrders.length} Trades)`,
            primarySymbol: focusSymbol || unifiedSession.primarySymbol || mergedPairs[0],
            pairs: mergedPairs,
            fromDate: fromDate < unifiedSession.fromDate ? fromDate : unifiedSession.fromDate,
            toDate: toDate > unifiedSession.toDate ? toDate : unifiedSession.toDate,
            orders: mappedOrders,
            closedTradesCount: closedCount,
            winsCount,
            lossesCount,
            winRate,
            profitFactor,
            netPnl: Number(netPnl.toFixed(2)),
            currentBalance: Number((unifiedSession.startingCapital + netPnl).toFixed(2)),
            replayTimestamp: initialReplayTimestamp,
            journalNotes: sessionNotes,
        });
        if (updated) unifiedSession = updated;
    } else {
        const created = createBacktestSession({
            name: `${unifiedSessionPrefix} (${mappedOrders.length} Trades)`,
            strategyId: defaultStrat.id,
            pairs: uniquePairs,
            primarySymbol: focusSymbol || uniquePairs[0],
            timeframe: '15m',
            fromDate,
            toDate,
            keepEndFollowingToday: true,
            randomStartDate: false,
            riskPerTrade: 1.0,
            fundedMode: {
                enabled: false,
                profitTargetPct: 10,
                maxDailyLossPct: 5,
                maxTotalLossPct: 10,
            },
        });
        const patched = updateBacktestSession(created.id, {
            orders: mappedOrders,
            closedTradesCount: closedCount,
            winsCount,
            lossesCount,
            winRate,
            profitFactor,
            netPnl: Number(netPnl.toFixed(2)),
            currentBalance: Number((created.startingCapital + netPnl).toFixed(2)),
            replayTimestamp: initialReplayTimestamp,
            journalNotes: sessionNotes,
        });
        unifiedSession = patched || created;
    }

    emit({
        phase: 'DONE',
        loadedTradeBatches: totalTradeBatches,
        totalTradeBatches,
        totalTradesPulled: mappedOrders.length,
        loadedCandleBatches: totalCandleBatches,
        totalCandleBatches,
        totalCandlesCached,
        message: `Sincronização concluída! ${mappedOrders.length} trades e ${totalCandlesCached} velas prontos na Sessão Única.`,
    });

    return {
        session: unifiedSession!,
        totalTrades: mappedOrders.length,
        totalCandlesCached,
        pairs: uniquePairs,
    };
}
