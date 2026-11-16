import { KLineData } from 'klinecharts';
import { Datafeed, SymbolInfo, Period, DatafeedSubscribeCallback } from '@klinecharts/pro';
import api from '../api';
import {
    BatchLoadProgress,
    fetchSingleCandleBatch,
    getMergedCandlesFromIDB,
    mergeAndDeduplicateCandles,
    saveCandleBatchToIDB,
} from './historicalBatchCache';

/**
 * Each mode is ONE source. There is no silent cross-source fallback: if the
 * chosen feed fails, loading fails and the UI says so. `DEMO` is the only
 * mode with generated prices and it is always labelled as such.
 */
export type DataSourceMode = 'TRADINGVIEW' | 'BINANCE_LIVE' | 'MT5_BACKEND' | 'DEMO';

export interface FeedStats {
    source: string;
    /** Instrument/timeframe the loaded history belongs to. */
    ticker: string;
    periodText: string;
    /** True only in DEMO mode: prices are generated, not market data. */
    synthetic: boolean;
    totalBars: number;
    replayIndex: number;
    replayActive: boolean;
    batchProgress?: BatchLoadProgress;
}

export class FeedUnavailableError extends Error {
    constructor(public readonly mode: DataSourceMode, message: string) {
        super(message);
        this.name = 'FeedUnavailableError';
    }
}

export const DEFAULT_SYMBOLS: SymbolInfo[] = [
    {
        ticker: 'XAUUSD',
        name: 'Ouro / Dólar Americano (Gold Spot)',
        shortName: 'XAUUSD',
        exchange: 'CFD',
        market: 'cfd',
        pricePrecision: 2,
        volumePrecision: 0,
        priceCurrency: 'USD',
        type: 'CFD',
    },
    {
        ticker: 'EURUSD',
        name: 'Euro / Dólar Americano',
        shortName: 'EURUSD',
        exchange: 'FX',
        market: 'forex',
        pricePrecision: 5,
        volumePrecision: 0,
        priceCurrency: 'USD',
        type: 'FOREX',
    },
    {
        ticker: 'GBPUSD',
        name: 'Libra Esterlina / Dólar Americano',
        shortName: 'GBPUSD',
        exchange: 'FX',
        market: 'forex',
        pricePrecision: 5,
        volumePrecision: 0,
        priceCurrency: 'USD',
        type: 'FOREX',
    },
    {
        ticker: 'USDJPY',
        name: 'Dólar Americano / Iene Japonês',
        shortName: 'USDJPY',
        exchange: 'FX',
        market: 'forex',
        pricePrecision: 3,
        volumePrecision: 0,
        priceCurrency: 'JPY',
        type: 'FOREX',
    },
    {
        ticker: 'BTCUSD',
        name: 'Bitcoin / Dólar Americano',
        shortName: 'BTCUSD',
        exchange: 'BINANCE',
        market: 'crypto',
        pricePrecision: 2,
        volumePrecision: 2,
        priceCurrency: 'USD',
        type: 'CRYPTO',
    },
    {
        ticker: 'ETHUSD',
        name: 'Ethereum / Dólar Americano',
        shortName: 'ETHUSD',
        exchange: 'BINANCE',
        market: 'crypto',
        pricePrecision: 2,
        volumePrecision: 2,
        priceCurrency: 'USD',
        type: 'CRYPTO',
    },
    {
        ticker: 'NAS100',
        name: 'US Nasdaq 100 Index (US100)',
        shortName: 'NAS100',
        exchange: 'INDEX',
        market: 'index',
        pricePrecision: 2,
        volumePrecision: 0,
        priceCurrency: 'USD',
        type: 'INDEX',
    },
    {
        ticker: 'US30',
        name: 'Dow Jones Industrial Average (Wall St 30)',
        shortName: 'US30',
        exchange: 'INDEX',
        market: 'index',
        pricePrecision: 2,
        volumePrecision: 0,
        priceCurrency: 'USD',
        type: 'INDEX',
    },
    {
        ticker: 'SPX500',
        name: 'S&P 500 Index (US500)',
        shortName: 'SPX500',
        exchange: 'INDEX',
        market: 'index',
        pricePrecision: 2,
        volumePrecision: 0,
        priceCurrency: 'USD',
        type: 'INDEX',
    },
];

const BINANCE_TICKER_MAP: Record<string, string> = {
    BTCUSD: 'BTCUSDT',
    BTCUSDT: 'BTCUSDT',
    ETHUSD: 'ETHUSDT',
    ETHUSDT: 'ETHUSDT',
    SOLUSD: 'SOLUSDT',
    SOLUSDT: 'SOLUSDT',
};

export const binancePairOf = (ticker: string): string | undefined => BINANCE_TICKER_MAP[ticker.toUpperCase()];

const BASE_MARKET_CONFIG: Record<string, { price: number; volatility: number; decimals: number }> = {
    XAUUSD: { price: 2652.40, volatility: 3.2, decimals: 2 },
    EURUSD: { price: 1.08450, volatility: 0.0011, decimals: 5 },
    GBPUSD: { price: 1.29420, volatility: 0.0014, decimals: 5 },
    USDJPY: { price: 152.340, volatility: 0.20, decimals: 3 },
    BTCUSD: { price: 72450.00, volatility: 220.0, decimals: 2 },
    ETHUSD: { price: 2685.00, volatility: 16.0, decimals: 2 },
    NAS100: { price: 20290.00, volatility: 42.0, decimals: 2 },
    US30: { price: 42380.00, volatility: 60.0, decimals: 2 },
    SPX500: { price: 5825.00, volatility: 11.0, decimals: 2 },
};

export function periodToTimeframe(period: Period): string {
    const { multiplier, timespan } = period;
    if (timespan === 'minute') return `${multiplier}m`;
    if (timespan === 'hour') return `${multiplier}H`;
    if (timespan === 'day') return '1D';
    if (timespan === 'week') return '1W';
    if (timespan === 'month') return '1M';
    return '15m';
}

export function periodToBinanceInterval(period: Period): string {
    const { multiplier, timespan } = period;
    if (timespan === 'minute') {
        if ([1, 3, 5, 15, 30].includes(multiplier)) return `${multiplier}m`;
        return '15m';
    }
    if (timespan === 'hour') {
        if ([1, 2, 4, 6, 8, 12].includes(multiplier)) return `${multiplier}h`;
        return '1h';
    }
    if (timespan === 'day') return '1d';
    if (timespan === 'week') return '1w';
    if (timespan === 'month') return '1M';
    return '15m';
}

export function periodToMs(period: Period): number {
    const { multiplier, timespan } = period;
    switch (timespan) {
        case 'minute': return multiplier * 60 * 1000;
        case 'hour': return multiplier * 60 * 60 * 1000;
        case 'day': return multiplier * 24 * 60 * 60 * 1000;
        case 'week': return multiplier * 7 * 24 * 60 * 60 * 1000;
        case 'month': return multiplier * 30 * 24 * 60 * 60 * 1000;
        default: return 15 * 60 * 1000;
    }
}

const MODE_LABEL: Record<DataSourceMode, string> = {
    TRADINGVIEW: 'TradingView',
    BINANCE_LIVE: 'Binance',
    MT5_BACKEND: 'MT5 / Market Feed',
    DEMO: 'Demo (dados simulados)',
};

interface CacheEntry {
    candles: KLineData[];
    source: string;
    synthetic: boolean;
    fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 24;
const DEFAULT_BATCH_SIZE = 500;

type CandleListener = (candle: KLineData, stats: FeedStats) => void;
type BatchProgressListener = (progress: BatchLoadProgress) => void;

export class CustomKLineDatafeed implements Datafeed {
    private mode: DataSourceMode = 'TRADINGVIEW';
    private ws: WebSocket | null = null;
    private activeCallback: DatafeedSubscribeCallback | null = null;
    /** Bars per request (set from the user's plan, minimum 500 for batching). */
    private maxBars = DEFAULT_BATCH_SIZE;

    // Session date range bounds for smart background batch pre-fetching
    private sessionFromTs: number | null = null;
    private sessionToTs: number | null = null;
    private priceAnchorHint: number | null = null;
    private prefetchAbortGeneration = 0;

    // In-memory LRU cache for instant timeframe switching & multi-chart sync
    private historyCache: Map<string, CacheEntry> = new Map();

    // Replay & timestamp synchronization state
    private fullHistory: KLineData[] = [];
    private replayActive: boolean = false;
    private replayIndex: number = 0;
    private replayCutoffTimestamp: number | null = null;
    private onCandleUpdateListener?: CandleListener;
    private onBatchProgressListener?: BatchProgressListener;
    private lastSourceUsed: string = MODE_LABEL.TRADINGVIEW;
    private lastSynthetic = false;
    private historyTicker = '';
    private historyPeriodText = '';
    private currentSymbolInfo: SymbolInfo | null = null;
    private currentPeriod: Period | null = null;

    private batchProgress: BatchLoadProgress = {
        symbol: 'XAUUSD',
        timeframe: '15m',
        loadedBatches: 0,
        totalBatches: 1,
        totalBars: 0,
        earliestTs: null,
        latestTs: null,
        fromCache: false,
        isPrefetching: false,
        hasMore: true,
        statusText: 'Pronto',
    };

    constructor(
        initialMode: DataSourceMode = 'TRADINGVIEW',
        onCandleUpdate?: CandleListener,
        onBatchProgress?: BatchProgressListener
    ) {
        this.mode = initialMode;
        this.onCandleUpdateListener = onCandleUpdate;
        this.onBatchProgressListener = onBatchProgress;
    }

    public setBatchProgressListener(listener?: BatchProgressListener) {
        this.onBatchProgressListener = listener;
        if (listener) listener(this.batchProgress);
    }

    public getBatchProgress(): BatchLoadProgress {
        return this.batchProgress;
    }

    /**
     * Configures the session date range (`fromDate -> toDate`) so background batch prefetching
     * knows the target window to pull in 500-candle chunks.
     */
    public setSessionDateWindow(fromDate?: string, toDate?: string) {
        if (fromDate) {
            const parsedFrom = new Date(`${fromDate}T00:00:00`).getTime();
            if (Number.isFinite(parsedFrom)) this.sessionFromTs = parsedFrom;
        }
        if (toDate) {
            const parsedTo = new Date(`${toDate}T23:59:59`).getTime();
            if (Number.isFinite(parsedTo)) this.sessionToTs = Math.min(Date.now(), parsedTo);
        }
    }

    public setPriceAnchorHint(price: number | null) {
        this.priceAnchorHint = typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null;
    }

    private resolveBackendSymbol(symbol: SymbolInfo): string {
        const cleanTicker = (symbol.ticker || 'XAUUSD').trim().toUpperCase();
        if (DEFAULT_SYMBOLS.some((s) => s.ticker === cleanTicker)) {
            return cleanTicker;
        }
        if (symbol.exchange && !['TV', 'FX', 'CFD', 'INDEX', 'BINANCE'].includes(symbol.exchange.toUpperCase())) {
            return `${symbol.exchange}:${cleanTicker}`;
        }
        return cleanTicker;
    }

    private updateBatchProgress(patch: Partial<BatchLoadProgress>) {
        this.batchProgress = {
            ...this.batchProgress,
            ...patch,
            totalBars: this.fullHistory.length || patch.totalBars || 0,
            earliestTs: this.fullHistory.length > 0 ? this.fullHistory[0].timestamp : (patch.earliestTs ?? null),
            latestTs:
                this.fullHistory.length > 0
                    ? this.fullHistory[this.fullHistory.length - 1].timestamp
                    : (patch.latestTs ?? null),
        };
        this.onBatchProgressListener?.(this.batchProgress);
    }

    public setMode(newMode: DataSourceMode) {
        this.mode = newMode;
    }

    public getMode(): DataSourceMode {
        return this.mode;
    }

    public setMaxBars(bars: number) {
        if (Number.isFinite(bars) && bars >= 50) this.maxBars = Math.max(DEFAULT_BATCH_SIZE, Math.floor(bars));
    }

    public getLastSourceUsed(): string {
        return this.lastSourceUsed;
    }

    public isSynthetic(): boolean {
        return this.lastSynthetic;
    }

    public getFullHistory(): KLineData[] {
        return this.fullHistory;
    }

    public isReplayActive(): boolean {
        return this.replayActive;
    }

    public getReplayTimestamp(): number | null {
        return this.replayCutoffTimestamp;
    }

    public getReplayState() {
        const currentCandle = this.fullHistory[this.replayIndex] || this.fullHistory[this.fullHistory.length - 1] || null;
        return {
            replayActive: this.replayActive,
            replayIndex: this.replayIndex,
            totalBars: this.fullHistory.length,
            currentCandle,
            replayTimestamp: currentCandle?.timestamp || this.replayCutoffTimestamp,
        };
    }

    /** Instrument/timeframe of `getFullHistory()`. */
    public getContext() {
        return { ticker: this.historyTicker, periodText: this.historyPeriodText };
    }

    private emit(candle: KLineData, replay: boolean) {
        this.onCandleUpdateListener?.(candle, {
            ticker: this.historyTicker,
            periodText: this.historyPeriodText,
            source: replay ? `${this.lastSourceUsed} · Replay` : this.lastSourceUsed,
            synthetic: this.lastSynthetic,
            totalBars: this.fullHistory.length,
            replayIndex: this.replayIndex,
            replayActive: replay,
            batchProgress: this.batchProgress,
        });
    }

    /**
     * Enables or disables Bar-by-Bar Replay mode by slicing the loaded history.
     * If preserveTimestamp is true and replayCutoffTimestamp exists, aligns the slice
     * to the exact historical timestamp T so switching timeframes or merging earlier batches
     * never leaks future bars or jumps the user's current replay position.
     */
    public setReplayMode(
        enabled: boolean,
        startRatio: number = 0.72,
        preserveTimestamp: boolean = false
    ): KLineData[] {
        this.replayActive = enabled;
        if (enabled && this.fullHistory.length > 5) {
            this.stopLiveStream();

            const minIdx = Math.min(10, Math.max(1, this.fullHistory.length - 2));
            const fallbackIdx = Math.min(
                this.fullHistory.length - 1,
                Math.max(minIdx, Math.floor(this.fullHistory.length * startRatio))
            );

            if (preserveTimestamp && this.replayCutoffTimestamp) {
                let idx = -1;
                for (let i = 0; i < this.fullHistory.length; i++) {
                    if (this.fullHistory[i].timestamp <= this.replayCutoffTimestamp) {
                        idx = i;
                    } else {
                        break;
                    }
                }
                if (idx >= 1) {
                    this.replayIndex = idx;
                } else {
                    this.replayIndex = fallbackIdx;
                }
            } else {
                this.replayIndex = fallbackIdx;
            }

            const visible = this.fullHistory.slice(0, this.replayIndex + 1);
            const last = visible[visible.length - 1];
            if (last) {
                this.replayCutoffTimestamp = last.timestamp;
                this.emit(last, true);
            }
            return visible;
        } else {
            this.replayActive = false;
            this.replayCutoffTimestamp = null;
            this.replayIndex = Math.max(0, this.fullHistory.length - 1);
            const last = this.fullHistory[this.fullHistory.length - 1];
            if (last) this.emit(last, false);
            return this.fullHistory;
        }
    }

    /**
     * Sets the replay cutoff directly to a specific timestamp T
     */
    public setReplayTimestamp(timestamp: number): KLineData[] {
        this.replayCutoffTimestamp = timestamp;
        return this.setReplayMode(true, 0.72, true);
    }

    /**
     * Advances 1 candle forward in Replay Mode and pushes it to KLineChart via subscribe callback
     */
    public stepReplayForward(): KLineData | null {
        if (!this.replayActive || this.fullHistory.length === 0) return null;
        if (this.replayIndex < this.fullHistory.length - 1) {
            this.replayIndex += 1;
            const nextCandle = this.fullHistory[this.replayIndex];
            if (nextCandle) {
                this.replayCutoffTimestamp = nextCandle.timestamp;
            }
            if (this.activeCallback && nextCandle) {
                this.activeCallback(nextCandle);
            }
            if (nextCandle) this.emit(nextCandle, true);
            return nextCandle;
        }
        return null;
    }

    /**
     * On-demand lazy loader: pulls the next 500-candle historical batch older than the earliest
     * currently loaded bar, stores it in IndexedDB, merges it into `this.fullHistory`, and
     * preserves the user's current replay position.
     */
    public async loadEarlierBatch(chunkSize: number = DEFAULT_BATCH_SIZE): Promise<{
        addedBars: number;
        totalBars: number;
        visibleCandles: KLineData[];
    }> {
        const symbol = this.currentSymbolInfo || DEFAULT_SYMBOLS[0];
        const period = this.currentPeriod || { multiplier: 15, timespan: 'minute', text: '15m' };
        const tf = periodToTimeframe(period);
        const stepMs = periodToMs(period);
        const earliestTs =
            this.fullHistory.length > 0 ? this.fullHistory[0].timestamp : Date.now();
        const cursorTo = earliestTs - stepMs;

        const beforeCount = this.fullHistory.length;
        this.updateBatchProgress({
            symbol: symbol.ticker,
            timeframe: tf,
            isPrefetching: true,
            statusText: `Buscando +${chunkSize} velas anteriores...`,
        });

        try {
            if (this.mode === 'DEMO') {
                const anchorPrice = this.fullHistory[0]?.open ?? this.priceAnchorHint ?? undefined;
                const generated = this.generateDemoCandles(symbol.ticker, period, chunkSize, cursorTo, anchorPrice);
                this.lastSynthetic = true;
                this.lastSourceUsed = MODE_LABEL.DEMO;
                this.fullHistory = mergeAndDeduplicateCandles(this.fullHistory, generated);
                this.syncMemoryCache(symbol, period, this.fullHistory);
                const addedBars = Math.max(0, this.fullHistory.length - beforeCount);
                const visibleCandles = this.replayActive ? this.setReplayMode(true, 0.72, true) : this.fullHistory;
                return { addedBars, totalBars: this.fullHistory.length, visibleCandles };
            }

            const batch = await fetchSingleCandleBatch({
                symbol: this.resolveBackendSymbol(symbol),
                timeframe: tf,
                chunkSize,
                chunkIndex: this.batchProgress.loadedBatches,
                cursorTo,
                fromTs: Math.min(this.sessionFromTs || cursorTo, cursorTo) - chunkSize * stepMs * 2,
            });

            if (batch.candles.length > 0) {
                this.fullHistory = mergeAndDeduplicateCandles(this.fullHistory, batch.candles);
                this.syncMemoryCache(symbol, period, this.fullHistory);
            } else {
                const pair = binancePairOf(symbol.ticker);
                if (pair) {
                    const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${periodToBinanceInterval(period)}&endTime=${cursorTo}&limit=${chunkSize}`;
                    const resp = await fetch(url);
                    if (resp.ok) {
                        const raw = await resp.json();
                        if (Array.isArray(raw) && raw.length > 0) {
                            const mapped: KLineData[] = raw.map((k: any[]) => ({
                                timestamp: Number(k[0]),
                                open: parseFloat(k[1]),
                                high: parseFloat(k[2]),
                                low: parseFloat(k[3]),
                                close: parseFloat(k[4]),
                                volume: parseFloat(k[5]),
                            }));
                            await saveCandleBatchToIDB(symbol.ticker, tf, mapped, `${MODE_LABEL.BINANCE_LIVE} (${pair})`);
                            this.fullHistory = mergeAndDeduplicateCandles(this.fullHistory, mapped);
                            this.syncMemoryCache(symbol, period, this.fullHistory);
                        }
                    }
                }
            }

            const addedBars = Math.max(0, this.fullHistory.length - beforeCount);
            const nextLoadedBatches = this.batchProgress.loadedBatches + 1;
            this.updateBatchProgress({
                loadedBatches: nextLoadedBatches,
                totalBatches: Math.max(nextLoadedBatches, this.batchProgress.totalBatches),
                totalBars: this.fullHistory.length,
                hasMore: batch.hasMore,
                isPrefetching: false,
                statusText: `Lote ${nextLoadedBatches} carregado • ${this.fullHistory.length} velas`,
            });

            const visibleCandles = this.replayActive
                ? this.setReplayMode(true, 0.72, true)
                : this.fullHistory;

            return {
                addedBars,
                totalBars: this.fullHistory.length,
                visibleCandles,
            };
        } catch (_) {
            const pair = binancePairOf(symbol.ticker);
            if (pair) {
                try {
                    const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${periodToBinanceInterval(period)}&endTime=${cursorTo}&limit=${chunkSize}`;
                    const resp = await fetch(url);
                    if (resp.ok) {
                        const raw = await resp.json();
                        if (Array.isArray(raw) && raw.length > 0) {
                            const mapped: KLineData[] = raw.map((k: any[]) => ({
                                timestamp: Number(k[0]),
                                open: parseFloat(k[1]),
                                high: parseFloat(k[2]),
                                low: parseFloat(k[3]),
                                close: parseFloat(k[4]),
                                volume: parseFloat(k[5]),
                            }));
                            await saveCandleBatchToIDB(symbol.ticker, tf, mapped, `${MODE_LABEL.BINANCE_LIVE} (${pair})`);
                            this.fullHistory = mergeAndDeduplicateCandles(this.fullHistory, mapped);
                            this.syncMemoryCache(symbol, period, this.fullHistory);
                        }
                    }
                } catch (_) {}
            }
            if (this.fullHistory.length === beforeCount && (this.mode === 'DEMO' || this.lastSynthetic)) {
                const anchorPrice = this.fullHistory[0]?.open ?? this.priceAnchorHint ?? undefined;
                const generated = this.generateDemoCandles(symbol.ticker, period, chunkSize, cursorTo, anchorPrice);
                this.lastSynthetic = true;
                this.lastSourceUsed = MODE_LABEL.DEMO;
                this.fullHistory = mergeAndDeduplicateCandles(this.fullHistory, generated);
                this.syncMemoryCache(symbol, period, this.fullHistory);
            }

            const addedBars = Math.max(0, this.fullHistory.length - beforeCount);
            const nextLoadedBatches = this.batchProgress.loadedBatches + 1;
            this.updateBatchProgress({
                loadedBatches: nextLoadedBatches,
                totalBatches: Math.max(nextLoadedBatches, this.batchProgress.totalBatches),
                totalBars: this.fullHistory.length,
                isPrefetching: false,
                statusText: `Lote ${nextLoadedBatches} • ${this.fullHistory.length} velas`,
            });

            const visibleCandles = this.replayActive
                ? this.setReplayMode(true, 0.72, true)
                : this.fullHistory;

            return {
                addedBars,
                totalBars: this.fullHistory.length,
                visibleCandles,
            };
        }
    }

    /**
     * Ensures that a specific historical timestamp `targetTimestamp` (from a synced trade or Go To Date)
     * is covered by `this.fullHistory`. If `targetTimestamp` is outside the loaded range, fetches
     * the 500-candle batch covering `targetTimestamp` and merges it into IndexedDB & `this.fullHistory`.
     */
    public async ensureTimestampLoaded(targetTimestamp: number): Promise<KLineData[]> {
        const symbol = this.currentSymbolInfo || DEFAULT_SYMBOLS[0];
        const period = this.currentPeriod || { multiplier: 15, timespan: 'minute', text: '15m' };
        const tf = periodToTimeframe(period);
        const stepMs = periodToMs(period);

        const earliest = this.fullHistory[0]?.timestamp ?? Infinity;
        const latest = this.fullHistory[this.fullHistory.length - 1]?.timestamp ?? 0;

        if (targetTimestamp < earliest + stepMs * 15 || targetTimestamp > latest - stepMs * 2) {
            this.updateBatchProgress({
                isPrefetching: true,
                statusText: 'Carregando lote da data selecionada...',
            });

            const windowEnd = Math.min(Date.now(), targetTimestamp + stepMs * 160);
            const windowStart = targetTimestamp - stepMs * 340;

            try {
                if (this.mode !== 'DEMO') {
                    const batch = await fetchSingleCandleBatch({
                        symbol: this.resolveBackendSymbol(symbol),
                        timeframe: tf,
                        chunkSize: DEFAULT_BATCH_SIZE,
                        cursorTo: windowEnd,
                        fromTs: windowStart,
                    });

                    if (batch.candles.length > 0) {
                        this.fullHistory = mergeAndDeduplicateCandles(this.fullHistory, batch.candles);
                        this.syncMemoryCache(symbol, period, this.fullHistory);
                    }
                }
            } catch (_) {
                const idb = await getMergedCandlesFromIDB(symbol.ticker, tf);
                if (idb.candles.length > 0) {
                    this.fullHistory = mergeAndDeduplicateCandles(this.fullHistory, idb.candles);
                }
                const pair = binancePairOf(symbol.ticker);
                if (
                    this.mode !== 'DEMO' &&
                    pair &&
                    (this.fullHistory.length === 0 ||
                        targetTimestamp < (this.fullHistory[0]?.timestamp ?? Infinity) ||
                        targetTimestamp > (this.fullHistory[this.fullHistory.length - 1]?.timestamp ?? 0))
                ) {
                    try {
                        const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${periodToBinanceInterval(period)}&endTime=${windowEnd}&limit=${DEFAULT_BATCH_SIZE}`;
                        const resp = await fetch(url);
                        if (resp.ok) {
                            const raw = await resp.json();
                            if (Array.isArray(raw) && raw.length > 0) {
                                const mapped: KLineData[] = raw.map((k: any[]) => ({
                                    timestamp: Number(k[0]),
                                    open: parseFloat(k[1]),
                                    high: parseFloat(k[2]),
                                    low: parseFloat(k[3]),
                                    close: parseFloat(k[4]),
                                    volume: parseFloat(k[5]),
                                }));
                                await saveCandleBatchToIDB(symbol.ticker, tf, mapped, `${MODE_LABEL.BINANCE_LIVE} (${pair})`);
                                this.fullHistory = mergeAndDeduplicateCandles(this.fullHistory, mapped);
                            }
                        }
                    } catch (_) {}
                }
                if (
                    (this.mode === 'DEMO' || this.fullHistory.length === 0) &&
                    (this.fullHistory.length === 0 ||
                        targetTimestamp < (this.fullHistory[0]?.timestamp ?? Infinity))
                ) {
                    const anchor = this.fullHistory[0]?.open ?? this.priceAnchorHint ?? undefined;
                    const fallbackChunk = this.generateDemoCandles(
                        symbol.ticker,
                        period,
                        DEFAULT_BATCH_SIZE,
                        windowEnd,
                        anchor
                    );
                    this.lastSynthetic = true;
                    this.lastSourceUsed = MODE_LABEL.DEMO;
                    this.fullHistory = mergeAndDeduplicateCandles(this.fullHistory, fallbackChunk);
                }
                this.syncMemoryCache(symbol, period, this.fullHistory);
            }

            this.updateBatchProgress({
                loadedBatches: this.batchProgress.loadedBatches + 1,
                totalBatches: Math.max(this.batchProgress.totalBatches, this.batchProgress.loadedBatches + 1),
                totalBars: this.fullHistory.length,
                isPrefetching: false,
                statusText: `Lote sincronizado • ${this.fullHistory.length} velas`,
            });
        }

        return this.setReplayTimestamp(targetTimestamp);
    }

    private syncMemoryCache(symbol: SymbolInfo, period: Period, candles: KLineData[]) {
        const cacheKey = `${this.mode}:${symbol.exchange}:${symbol.ticker}:${periodToTimeframe(period)}:${this.maxBars}`;
        this.historyCache.set(cacheKey, {
            candles,
            source: this.lastSourceUsed,
            synthetic: this.lastSynthetic,
            fetchedAt: Date.now(),
        });
    }

    /**
     * Fetches (or reads from LRU cache / IndexedDB) a timeframe's history and slices it up to cutoffTimestamp.
     * Used by the Secondary Chart in 1x2 Split-Screen Multi-Timeframe mode.
     */
    public async getHistorySlicedAtTimestamp(
        symbol: SymbolInfo,
        period: Period,
        cutoffTimestamp: number | null
    ): Promise<KLineData[]> {
        const candles = await this.fetchOrGetCachedCandles(symbol, period);
        if (!cutoffTimestamp || !this.replayActive) {
            return candles;
        }
        const filtered = candles.filter(c => c.timestamp <= cutoffTimestamp);
        return filtered.length >= 5 ? filtered : candles.slice(0, Math.max(10, Math.floor(candles.length * 0.72)));
    }

    async searchSymbols(search?: string): Promise<SymbolInfo[]> {
        const q = (search || '').trim().toUpperCase();
        const localMatches = DEFAULT_SYMBOLS.filter(
            s => !q || s.ticker.includes(q) || (s.name && s.name.toUpperCase().includes(q))
        );

        if (this.mode === 'TRADINGVIEW' && q.length >= 2) {
            try {
                const res = await api.get('/tradingview/search', { params: { q } });
                if (Array.isArray(res.data) && res.data.length > 0) {
                    const remoteSymbols: SymbolInfo[] = res.data.slice(0, 12).map((item: any) => ({
                        ticker: item.symbol || item.id,
                        name: item.description || item.symbol,
                        shortName: item.symbol,
                        exchange: item.exchange || 'TV',
                        market: item.type || 'forex',
                        pricePrecision: (item.symbol || '').includes('JPY') ? 3 : (item.type === 'forex' ? 5 : 2),
                        volumePrecision: 0,
                        priceCurrency: 'USD',
                        type: (item.type || 'CFD').toUpperCase(),
                    }));
                    const seen = new Set(localMatches.map(s => s.ticker));
                    for (const rem of remoteSymbols) {
                        if (!seen.has(rem.ticker)) {
                            localMatches.push(rem);
                            seen.add(rem.ticker);
                        }
                    }
                }
            } catch (_) {
                // Fallback to local symbols list
            }
        }

        return localMatches;
    }

    /**
     * Fetches the 1st 500-candle batch immediately for `<1s` chart rendering,
     * checking IndexedDB cache first and falling back cleanly across feeds.
     */
    private async fetchInitialBatchFromSource(
        symbol: SymbolInfo,
        period: Period,
        to: number
    ): Promise<{
        candles: KLineData[];
        source: string;
        synthetic: boolean;
        fromCache: boolean;
        nextCursorTo: number | null;
        hasMore: boolean;
        estimatedTotalChunks: number;
    }> {
        const tf = periodToTimeframe(period);
        const stepMs = periodToMs(period);
        const batchSize = DEFAULT_BATCH_SIZE;
        const from = Math.min(this.sessionFromTs || to, to) - batchSize * stepMs * 2;
        const backendSymbol = this.resolveBackendSymbol(symbol);

        // Explicit DEMO mode: fetch deterministic Polars/Parquet OHLCV first, fallback to cursor-invariant generator
        if (this.mode === 'DEMO') {
            try {
                const res = await fetch(
                    `/api/quant/ohlcv?symbol=${encodeURIComponent(symbol.ticker)}&timeframe=${encodeURIComponent(tf)}&to=${to}&limit=${batchSize}`,
                    { signal: AbortSignal.timeout(2500) }
                );
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data?.candles) && data.candles.length > 0) {
                        const bars: KLineData[] = data.candles.map((c: any) => ({
                            timestamp: Number(c.timestamp),
                            open: Number(c.open),
                            high: Number(c.high),
                            low: Number(c.low),
                            close: Number(c.close),
                            volume: Number(c.volume || 0),
                        }));
                        return {
                            candles: bars,
                            source: `${MODE_LABEL.DEMO} · Polars`,
                            synthetic: true,
                            fromCache: false,
                            nextCursorTo: bars[0]?.timestamp ? bars[0].timestamp - stepMs : null,
                            hasMore: true,
                            estimatedTotalChunks: 2,
                        };
                    }
                }
            } catch (_) {
                // Offline fallback below
            }
            const generated = this.generateDemoCandles(
                symbol.ticker,
                period,
                batchSize,
                to,
                this.priceAnchorHint ?? undefined
            );
            return {
                candles: generated,
                source: MODE_LABEL.DEMO,
                synthetic: true,
                fromCache: false,
                nextCursorTo: generated[0]?.timestamp ? generated[0].timestamp - stepMs : null,
                hasMore: true,
                estimatedTotalChunks: 2,
            };
        }

        // 1. Check IndexedDB dual-layer cache AND verify that it covers the requested `to` window
        const idbCached = await getMergedCandlesFromIDB(symbol.ticker, tf);
        const idbCoversTargetWindow =
            idbCached.candles.length >= 60 &&
            idbCached.earliestTs !== null &&
            idbCached.latestTs !== null &&
            idbCached.earliestTs <= to - stepMs * 10 &&
            idbCached.latestTs >= to - stepMs * 96;

        if (idbCoversTargetWindow) {
            return {
                candles: idbCached.candles,
                source: `${idbCached.source} · IDB`,
                synthetic: false,
                fromCache: true,
                nextCursorTo: idbCached.earliestTs ? idbCached.earliestTs - stepMs : null,
                hasMore: true,
                estimatedTotalChunks: Math.max(1, idbCached.batchCount),
            };
        }

        // 2. Unified Backend Batch Endpoint (`/tradingview/candles/batch`: MT5 cache -> TradingView WS -> public HTTP fallback)
        if (this.mode === 'TRADINGVIEW' || this.mode === 'MT5_BACKEND') {
            try {
                const batchRes = await fetchSingleCandleBatch({
                    symbol: backendSymbol,
                    timeframe: tf,
                    chunkSize: batchSize,
                    chunkIndex: 0,
                    cursorTo: to,
                    fromTs: from,
                    toTs: to,
                });
                if (batchRes.candles.length > 0) {
                    const merged = mergeAndDeduplicateCandles(idbCached.candles, batchRes.candles);
                    return {
                        candles: merged,
                        source: this.mode === 'MT5_BACKEND' ? MODE_LABEL.MT5_BACKEND : MODE_LABEL.TRADINGVIEW,
                        synthetic: false,
                        fromCache: batchRes.fromCache,
                        nextCursorTo: batchRes.nextCursorTo,
                        hasMore: batchRes.hasMore,
                        estimatedTotalChunks: batchRes.estimatedTotalChunks,
                    };
                }
            } catch (_) {
                // Fallback below
            }
        }

        // 4. Binance Public Klines (500-bar real market batch anchored at `to`)
        const pair = binancePairOf(symbol.ticker);
        if (pair) {
            try {
                const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${periodToBinanceInterval(period)}&endTime=${to}&limit=${batchSize}`;
                const response = await fetch(url);
                if (response.ok) {
                    const raw = await response.json();
                    if (Array.isArray(raw) && raw.length > 0) {
                        const mapped: KLineData[] = raw.map((k: any[]) => ({
                            timestamp: Number(k[0]),
                            open: parseFloat(k[1]),
                            high: parseFloat(k[2]),
                            low: parseFloat(k[3]),
                            close: parseFloat(k[4]),
                            volume: parseFloat(k[5]),
                            turnover: parseFloat(k[7]),
                        }));
                        await saveCandleBatchToIDB(symbol.ticker, tf, mapped, `${MODE_LABEL.BINANCE_LIVE} (${pair})`);
                        const merged = mergeAndDeduplicateCandles(idbCached.candles, mapped);
                        return {
                            candles: merged,
                            source: `${MODE_LABEL.BINANCE_LIVE} (${pair})`,
                            synthetic: false,
                            fromCache: false,
                            nextCursorTo: mapped[0]?.timestamp ? mapped[0].timestamp - stepMs : null,
                            hasMore: true,
                            estimatedTotalChunks: 2,
                        };
                    }
                }
            } catch (_) {
                // Fallback below
            }
        }

        // 5. If IndexedDB had partial real market candles, prefer real cached data over synthetic
        if (idbCached.candles.length > 0) {
            return {
                candles: idbCached.candles,
                source: `${idbCached.source} · IDB`,
                synthetic: false,
                fromCache: true,
                nextCursorTo: idbCached.earliestTs ? idbCached.earliestTs - stepMs : null,
                hasMore: false,
                estimatedTotalChunks: Math.max(1, idbCached.batchCount),
            };
        }

        // 5.5 Quant-Engine Real Parquet Data Lake fallback (only serves verified real market Parquet)
        try {
            const qRes = await fetch(
                `/api/quant/ohlcv?symbol=${encodeURIComponent(this.resolveBackendSymbol(symbol))}&timeframe=${encodeURIComponent(tf)}&to=${to}&limit=${batchSize}&source=real`,
                { signal: AbortSignal.timeout(6000) }
            );
            if (qRes.ok) {
                const qData = await qRes.json();
                if (qData?.isRealMarket && Array.isArray(qData.candles) && qData.candles.length > 0) {
                    const bars = qData.candles as KLineData[];
                    return {
                        candles: bars,
                        source: qData.source || 'Real Parquet Lake',
                        synthetic: false,
                        fromCache: true,
                        nextCursorTo: qData.nextCursorTo ?? (bars[0]?.timestamp ? bars[0].timestamp - stepMs : null),
                        hasMore: true,
                        estimatedTotalChunks: 2,
                    };
                }
            }
        } catch {
            // fall through cleanly to emergency offline fallback
        }

        // 6. Offline emergency fallback ONLY in memory (NEVER saved to IDB, ALWAYS flagged synthetic: true)
        const generated = this.generateDemoCandles(
            symbol.ticker,
            period,
            batchSize,
            to,
            this.priceAnchorHint ?? undefined
        );
        return {
            candles: generated,
            source: 'Demo (offline — sem conexão ao feed)',
            synthetic: true,
            fromCache: false,
            nextCursorTo: generated[0]?.timestamp ? generated[0].timestamp - stepMs : null,
            hasMore: true,
            estimatedTotalChunks: 2,
        };
    }

    /**
     * Background Smart Prefetcher: after the 1st batch renders the chart in `<1s`,
     * pulls remaining 500-bar chunks for the session window (`sessionFromTs -> sessionToTs`)
     * in the background and stores them in IndexedDB + `this.fullHistory`.
     */
    private startBackgroundBatchPrefetch(
        symbol: SymbolInfo,
        period: Period,
        initialCursorTo: number | null,
        estimatedTotalChunks: number
    ) {
        const generation = ++this.prefetchAbortGeneration;
        const tf = periodToTimeframe(period);
        const stepMs = periodToMs(period);
        const targetFromTs =
            this.sessionFromTs || Date.now() - stepMs * DEFAULT_BATCH_SIZE * 2;

        // If DEMO/synthetic or we already cover `targetFromTs` or no cursor is needed, mark complete
        const currentEarliest = this.fullHistory[0]?.timestamp ?? Infinity;
        if (this.mode === 'DEMO' || this.lastSynthetic || !initialCursorTo || currentEarliest <= targetFromTs) {
            this.updateBatchProgress({
                symbol: symbol.ticker,
                timeframe: tf,
                loadedBatches: Math.max(1, this.batchProgress.loadedBatches),
                totalBatches: Math.max(1, this.batchProgress.loadedBatches),
                isPrefetching: false,
                statusText: `${this.fullHistory.length} velas em cache`,
            });
            return;
        }

        const maxAdditionalBatches = Math.min(3, Math.max(1, estimatedTotalChunks - 1));
        const totalBatches = 1 + maxAdditionalBatches;

        this.updateBatchProgress({
            symbol: symbol.ticker,
            timeframe: tf,
            loadedBatches: 1,
            totalBatches,
            isPrefetching: true,
            statusText: `Lote 1/${totalBatches} • Pré-carregando histórico...`,
        });

        (async () => {
            let cursor: number | null = initialCursorTo;
            for (let idx = 1; idx <= maxAdditionalBatches; idx++) {
                if (generation !== this.prefetchAbortGeneration || !cursor) break;
                // Wait 250ms so chart rendering & user interactions have 100% priority
                await new Promise((r) => setTimeout(r, 250));
                if (generation !== this.prefetchAbortGeneration) break;

                try {
                    const batch = await fetchSingleCandleBatch({
                        symbol: this.resolveBackendSymbol(symbol),
                        timeframe: tf,
                        chunkSize: DEFAULT_BATCH_SIZE,
                        chunkIndex: idx,
                        cursorTo: cursor,
                        fromTs: targetFromTs - stepMs * DEFAULT_BATCH_SIZE,
                    });

                    if (generation !== this.prefetchAbortGeneration) break;

                    if (batch.candles.length > 0) {
                        this.fullHistory = mergeAndDeduplicateCandles(this.fullHistory, batch.candles);
                        this.syncMemoryCache(symbol, period, this.fullHistory);
                        // Re-align replayIndex without disturbing replayCutoffTimestamp
                        if (this.replayActive && this.replayCutoffTimestamp) {
                            this.setReplayMode(true, 0.72, true);
                        }
                    }

                    cursor = batch.nextCursorTo;
                    const loadedCount = idx + 1;
                    const reachedTarget =
                        !batch.hasMore ||
                        !cursor ||
                        (this.fullHistory[0]?.timestamp ?? Infinity) <= targetFromTs;

                    this.updateBatchProgress({
                        symbol: symbol.ticker,
                        timeframe: tf,
                        loadedBatches: loadedCount,
                        totalBatches: reachedTarget ? loadedCount : totalBatches,
                        isPrefetching: !reachedTarget && idx < maxAdditionalBatches,
                        hasMore: batch.hasMore,
                        statusText:
                            !reachedTarget && idx < maxAdditionalBatches
                                ? `Lote ${loadedCount}/${totalBatches} • ${this.fullHistory.length} velas...`
                                : `Lotes ${loadedCount}/${loadedCount} • ${this.fullHistory.length} velas (IDB)`,
                    });

                    if (reachedTarget) break;
                } catch (_) {
                    this.updateBatchProgress({
                        isPrefetching: false,
                        statusText: `Lote 1/1 • ${this.fullHistory.length} velas (IDB)`,
                    });
                    break;
                }
            }
        })();
    }

    private async fetchOrGetCachedCandles(symbol: SymbolInfo, period: Period): Promise<KLineData[]> {
        const tf = periodToTimeframe(period);
        const cacheKey = `${this.mode}:${symbol.exchange}:${symbol.ticker}:${tf}:${this.maxBars}`;
        const cached = this.historyCache.get(cacheKey);

        if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS && cached.candles.length > 0) {
            this.historyCache.delete(cacheKey); // refresh LRU order
            this.historyCache.set(cacheKey, cached);
            this.lastSourceUsed = cached.source;
            this.lastSynthetic = cached.synthetic;
            this.updateBatchProgress({
                symbol: symbol.ticker,
                timeframe: tf,
                loadedBatches: Math.max(1, Math.ceil(cached.candles.length / DEFAULT_BATCH_SIZE)),
                totalBatches: Math.max(1, Math.ceil(cached.candles.length / DEFAULT_BATCH_SIZE)),
                totalBars: cached.candles.length,
                fromCache: true,
                isPrefetching: false,
                statusText: `${cached.candles.length} velas (Cache)`,
            });
            return cached.candles;
        }

        const effectiveTo = this.sessionToTs ? Math.min(Date.now(), this.sessionToTs) : Date.now();
        const initialBatch = await this.fetchInitialBatchFromSource(symbol, period, effectiveTo);
        const sorted = initialBatch.candles
            .filter(c => Number.isFinite(c.open) && Number.isFinite(c.close) && Number.isFinite(c.timestamp))
            .sort((a, b) => a.timestamp - b.timestamp);

        this.lastSourceUsed = initialBatch.source;
        this.lastSynthetic = initialBatch.synthetic;

        if (this.historyCache.size >= MAX_CACHE_ENTRIES) {
            const oldestKey = this.historyCache.keys().next().value;
            if (oldestKey) this.historyCache.delete(oldestKey);
        }
        this.historyCache.set(cacheKey, {
            candles: sorted,
            source: initialBatch.source,
            synthetic: initialBatch.synthetic,
            fetchedAt: Date.now(),
        });

        const batchesLoaded = Math.max(1, Math.ceil(sorted.length / DEFAULT_BATCH_SIZE));
        this.updateBatchProgress({
            symbol: symbol.ticker,
            timeframe: tf,
            loadedBatches: batchesLoaded,
            totalBatches: Math.max(batchesLoaded, initialBatch.estimatedTotalChunks),
            totalBars: sorted.length,
            fromCache: initialBatch.fromCache,
            isPrefetching: false,
            hasMore: initialBatch.hasMore,
            statusText: initialBatch.fromCache
                ? `Lotes ${batchesLoaded}/${batchesLoaded} • ${sorted.length} velas (IDB)`
                : `Lote 1/${Math.max(1, initialBatch.estimatedTotalChunks)} • ${sorted.length} velas`,
        });

        // Trigger smart background prefetch of remaining batches for the session window
        if (symbol.ticker === this.currentSymbolInfo?.ticker) {
            this.startBackgroundBatchPrefetch(
                symbol,
                period,
                initialBatch.nextCursorTo,
                initialBatch.estimatedTotalChunks
            );
        }

        return sorted;
    }

    async getHistoryKLineData(symbol: SymbolInfo, period: Period, _from?: number, _to?: number): Promise<KLineData[]> {
        this.currentSymbolInfo = symbol;
        this.currentPeriod = period;
        const candles = await this.fetchOrGetCachedCandles(symbol, period);
        this.fullHistory = candles;
        this.historyTicker = symbol.ticker;
        this.historyPeriodText = period.text ?? periodToTimeframe(period);

        if (this.replayActive && candles.length > 20) {
            return this.setReplayMode(true, 0.72, true);
        }

        this.replayIndex = Math.max(0, candles.length - 1);
        const last = candles[candles.length - 1];
        if (last) this.emit(last, false);
        return candles;
    }

    /**
     * Live updates only come from a real stream (Binance mode, crypto). Other
     * modes stay static until reloaded: no simulated ticks.
     */
    subscribe(symbol: SymbolInfo, period: Period, callback: DatafeedSubscribeCallback): void {
        this.activeCallback = callback;
        this.stopLiveStream();

        if (this.replayActive || this.mode !== 'BINANCE_LIVE') return;
        const pair = binancePairOf(symbol.ticker);
        if (!pair) return;

        try {
            const streamName = `${pair.toLowerCase()}@kline_${periodToBinanceInterval(period)}`;
            this.ws = new WebSocket(`wss://stream.binance.com:9443/ws/${streamName}`);
            this.ws.onmessage = (event) => {
                if (this.replayActive) return;
                try {
                    const k = JSON.parse(event.data)?.k;
                    if (!k) return;
                    const bar: KLineData = {
                        timestamp: Number(k.t),
                        open: parseFloat(k.o),
                        high: parseFloat(k.h),
                        low: parseFloat(k.l),
                        close: parseFloat(k.c),
                        volume: parseFloat(k.v),
                        turnover: parseFloat(k.q),
                    };
                    this.updateLatestHistoryBar(bar);
                    this.replayIndex = this.fullHistory.length - 1;
                    callback(bar);
                    this.emit(bar, false);
                } catch (_) {}
            };
        } catch (_) {}
    }

    unsubscribe(_symbol?: SymbolInfo, _period?: Period): void {
        this.stopLiveStream();
    }

    private stopLiveStream() {
        if (this.ws) {
            try { this.ws.close(); } catch (_) {}
            this.ws = null;
        }
    }

    private updateLatestHistoryBar(bar: KLineData) {
        if (this.fullHistory.length === 0) {
            this.fullHistory.push(bar);
            return;
        }
        const lastIdx = this.fullHistory.length - 1;
        if (this.fullHistory[lastIdx].timestamp === bar.timestamp) {
            this.fullHistory[lastIdx] = bar;
        } else if (bar.timestamp > this.fullHistory[lastIdx].timestamp) {
            this.fullHistory.push(bar);
        }
    }

    /**
     * Cursor-invariant deterministic candles anchored to UTC 2026-01-01 so shared timestamps
     * never mutate when the user pans, changes `to`, or reloads the session.
     */
    private generateDemoCandles(
        ticker: string,
        period: Period,
        count: number,
        toTs: number,
        anchorEndPrice?: number
    ): KLineData[] {
        const clean = ticker.replace(/^.*:/, '').toUpperCase();
        const cfg = BASE_MARKET_CONFIG[clean] || { price: 100.0, volatility: 0.8, decimals: 2 };
        const stepMs = periodToMs(period);
        const alignedEnd = Math.floor(toTs / stepMs) * stepMs;
        const vol = cfg.volatility * Math.sqrt(stepMs / (15 * 60 * 1000));
        const epochAnchor = Date.UTC(2026, 0, 1, 0, 0, 0);
        const basePrice = anchorEndPrice && Number.isFinite(anchorEndPrice) ? anchorEndPrice : cfg.price;

        let symHash = 2166136261;
        for (let k = 0; k < clean.length; k++) {
            symHash ^= clean.charCodeAt(k);
            symHash = Math.imul(symHash, 16777619);
        }
        const hashUnit = (barIdx: number, salt: number): number => {
            let h = (symHash ^ Math.imul(barIdx, 374761393) ^ Math.imul(salt, 668265263)) >>> 0;
            h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
            return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
        };
        const closeAtIndex = (barIdx: number): number => {
            const macro =
                Math.sin(barIdx / 47.0 + (symHash % 7)) * vol * 3.8 +
                Math.cos(barIdx / 16.0) * vol * 1.9 +
                Math.sin(barIdx / 5.5) * vol * 0.85;
            const micro = (hashUnit(barIdx, 1) - 0.5) * vol * 1.1;
            return Math.max(basePrice * 0.25, basePrice + macro + micro);
        };

        const bars: KLineData[] = [];
        for (let i = count; i >= 0; i--) {
            const ts = alignedEnd - i * stepMs;
            const barIdx = Math.round((ts - epochAnchor) / stepMs);
            const open = closeAtIndex(barIdx - 1);
            const close = closeAtIndex(barIdx);
            const high = Math.max(open, close) + hashUnit(barIdx, 2) * vol * 0.7;
            const low = Math.max(basePrice * 0.1, Math.min(open, close) - hashUnit(barIdx, 3) * vol * 0.7);
            const volume = Math.round(120 + hashUnit(barIdx, 4) * 1200);
            bars.push({
                timestamp: ts,
                open: Number(open.toFixed(cfg.decimals)),
                high: Number(high.toFixed(cfg.decimals)),
                low: Number(low.toFixed(cfg.decimals)),
                close: Number(close.toFixed(cfg.decimals)),
                volume,
            });
        }
        return bars;
    }
}
