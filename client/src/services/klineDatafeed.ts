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
import { getQuantAuthHeaders } from '../lib/quantAuth';

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
    /** Canonical replay timestamp preserved across finer <-> coarser timeframe switches. */
    canonicalTimestamp?: number | null;
    /** True when the last visible candle on a coarse timeframe is an in-progress slice synthesized from LTF data. */
    hasPartialLastBar?: boolean;
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

export function timeframeToMs(tf: string): number {
    const clean = (tf || '').trim();
    const match = clean.match(/^(\d+)?([a-zA-Z]+)$/);
    if (!match) return 15 * 60 * 1000;
    const mult = Math.max(1, parseInt(match[1] || '1', 10) || 1);
    const unit = match[2];
    if (unit === 'm') return mult * 60 * 1000;
    if (unit === 'h' || unit === 'H') return mult * 60 * 60 * 1000;
    if (unit === 'd' || unit === 'D') return mult * 24 * 60 * 60 * 1000;
    if (unit === 'w' || unit === 'W') return mult * 7 * 24 * 60 * 60 * 1000;
    if (unit === 'M') return mult * 30 * 24 * 60 * 60 * 1000;
    return 15 * 60 * 1000;
}

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

export function computeMaxAllowedGapMs(stepMs: number): number {
    return Math.max(Math.max(60_000, stepMs) * 48, FIVE_DAYS_MS);
}

/**
 * Merges two candle series ONLY when they form a contiguous window; if they belong to
 * disjoint historical islands separated by a multi-day missing hole, prefers `incoming`
 * so switching timeframes far in the past never splices a hole onto today's cache.
 */
export function mergeContiguousCandles(
    existing: KLineData[],
    incoming: KLineData[],
    stepMs: number
): KLineData[] {
    if (!Array.isArray(incoming) || incoming.length === 0) return existing || [];
    const cleanIncoming = mergeAndDeduplicateCandles([], incoming);
    if (!Array.isArray(existing) || existing.length === 0) return cleanIncoming;
    if (cleanIncoming.length === 0) return existing;

    const cleanExisting =
        existing[0].timestamp <= existing[existing.length - 1].timestamp
            ? existing
            : mergeAndDeduplicateCandles([], existing);
    const maxGap = computeMaxAllowedGapMs(stepMs);
    const eMin = cleanExisting[0].timestamp;
    const eMax = cleanExisting[cleanExisting.length - 1].timestamp;
    const iMin = cleanIncoming[0].timestamp;
    const iMax = cleanIncoming[cleanIncoming.length - 1].timestamp;

    if ((iMax < eMin && eMin - iMax > maxGap) || (iMin > eMax && iMin - eMax > maxGap)) {
        return cleanIncoming;
    }

    return mergeAndDeduplicateCandles(cleanExisting, cleanIncoming);
}

/**
 * Checks whether a candle array truly covers `targetTs` without a missing hole
 * around the replay cursor (allows normal weekend/holiday market closures).
 */
export function doesHistoryCoverReplayTarget(
    candles: KLineData[],
    targetTs: number,
    stepMs: number
): boolean {
    if (!Array.isArray(candles) || candles.length === 0 || !Number.isFinite(targetTs)) {
        return false;
    }
    const safeStep = Math.max(60_000, stepMs);
    const firstTs = candles[0].timestamp;
    const lastTs = candles[candles.length - 1].timestamp;

    if (targetTs < firstTs) return false;
    if (targetTs >= lastTs + safeStep) return false;

    const maxGap = computeMaxAllowedGapMs(safeStep);
    let lo = 0;
    let hi = candles.length - 1;
    let idx = 0;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (candles[mid].timestamp <= targetTs) {
            idx = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }

    if (idx + 1 < candles.length) {
        const rightGap = candles[idx + 1].timestamp - candles[idx].timestamp;
        if (rightGap > maxGap && targetTs - candles[idx].timestamp > safeStep * 4) {
            return false;
        }
    }
    if (idx > 0) {
        const leftGap = candles[idx].timestamp - candles[idx - 1].timestamp;
        if (leftGap > maxGap && candles[idx].timestamp - targetTs < safeStep * 4) {
            return false;
        }
    }
    return true;
}

export function idbCoversTargetWindowPure(
    candles: KLineData[],
    toTs: number,
    stepMs: number
): boolean {
    if (!Array.isArray(candles) || candles.length < 60) return false;
    const earliestTs = candles[0].timestamp;
    const latestTs = candles[candles.length - 1].timestamp;
    const safeStep = Math.max(60_000, stepMs);
    const maxGap = computeMaxAllowedGapMs(safeStep);

    if (earliestTs > toTs - safeStep * 10) return false;
    if (latestTs < toTs - Math.max(safeStep * 96, 4 * 24 * 60 * 60 * 1000)) return false;

    const scanStart = Math.max(1, candles.length - 120);
    for (let i = scanStart; i < candles.length; i++) {
        if (candles[i].timestamp - candles[i - 1].timestamp > maxGap) {
            return false;
        }
    }
    return true;
}

export interface FinerSeriesCandidate {
    stepMs: number;
    candles: KLineData[];
}

export interface FormingSliceResult {
    candles: KLineData[];
    hasPartialLastBar: boolean;
}

/**
 * Slices `targetCandles` up to `cutoffIdx` and rebuilds the last candle as an
 * in-progress bar from `finerSeries` whenever viewing a coarser timeframe inside
 * an active lower-timeframe replay cursor, preventing future HTF wicks/closes from leaking.
 */
export function buildVisibleReplaySlice(
    targetCandles: KLineData[],
    cutoffIdx: number,
    targetStepMs: number,
    canonicalCutoffTs: number,
    canonicalStepMs: number | null,
    finerSeries: FinerSeriesCandidate[]
): FormingSliceResult {
    if (!Array.isArray(targetCandles) || targetCandles.length === 0) {
        return { candles: [], hasPartialLastBar: false };
    }
    const safeIdx = Math.max(0, Math.min(targetCandles.length - 1, cutoffIdx));
    const visible = targetCandles.slice(0, safeIdx + 1);
    const lastBar = visible[visible.length - 1];

    if (
        !lastBar ||
        canonicalStepMs === null ||
        !Number.isFinite(canonicalStepMs) ||
        canonicalStepMs <= 0 ||
        canonicalStepMs >= targetStepMs ||
        canonicalCutoffTs < lastBar.timestamp ||
        canonicalCutoffTs >= lastBar.timestamp + targetStepMs
    ) {
        return { candles: visible, hasPartialLastBar: false };
    }

    const revealEndExclusive = canonicalCutoffTs + canonicalStepMs;
    if (revealEndExclusive >= lastBar.timestamp + targetStepMs) {
        return { candles: visible, hasPartialLastBar: false };
    }

    const ranked = finerSeries
        .filter((s) => s.stepMs > 0 && s.stepMs < targetStepMs && Array.isArray(s.candles) && s.candles.length > 0)
        .sort((a, b) => {
            const diffA = Math.abs(a.stepMs - canonicalStepMs);
            const diffB = Math.abs(b.stepMs - canonicalStepMs);
            if (diffA !== diffB) return diffA - diffB;
            return a.stepMs - b.stepMs;
        });

    for (const candidate of ranked) {
        const parts: KLineData[] = [];
        for (let i = 0; i < candidate.candles.length; i++) {
            const bar = candidate.candles[i];
            if (bar.timestamp < lastBar.timestamp) continue;
            if (bar.timestamp >= revealEndExclusive) break;
            parts.push(bar);
        }
        if (parts.length > 0) {
            let high = parts[0].high;
            let low = parts[0].low;
            let volume = 0;
            for (const p of parts) {
                if (p.high > high) high = p.high;
                if (p.low < low) low = p.low;
                volume += p.volume || 0;
            }
            visible[visible.length - 1] = {
                ...lastBar,
                open: parts[0].open,
                high,
                low,
                close: parts[parts.length - 1].close,
                volume,
            };
            return { candles: visible, hasPartialLastBar: true };
        }
    }

    return { candles: visible, hasPartialLastBar: false };
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
    private visibleHistory: KLineData[] = [];
    private replayActive: boolean = false;
    private replayIndex: number = 0;
    private replayCutoffTimestamp: number | null = null;
    private canonicalReplayTimestamp: number | null = null;
    private canonicalReplayStepMs: number | null = null;
    private currentChartCutoffTimestamp: number | null = null;
    private currentVisibleHasPartialLastBar: boolean = false;
    private onCandleUpdateListener?: CandleListener;
    private onBatchProgressListener?: BatchProgressListener;
    private onHistoryPrependedListener?: (visibleCandles: KLineData[], addedBars: number) => void;
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

    public getVisibleReplayCandles(): KLineData[] {
        return this.visibleHistory.length > 0 ? this.visibleHistory : this.fullHistory;
    }

    public setOnHistoryPrependedListener(
        listener?: (visibleCandles: KLineData[], addedBars: number) => void
    ) {
        this.onHistoryPrependedListener = listener;
    }

    public isReplayActive(): boolean {
        return this.replayActive;
    }

    public getReplayTimestamp(): number | null {
        return this.canonicalReplayTimestamp ?? this.replayCutoffTimestamp;
    }

    public getCanonicalReplayStepMs(): number | null {
        return this.canonicalReplayStepMs;
    }

    public getChartCutoffTimestamp(): number | null {
        return this.currentChartCutoffTimestamp ?? this.replayCutoffTimestamp;
    }

    public getReplayState() {
        const currentCandle =
            this.visibleHistory[this.visibleHistory.length - 1] ||
            this.fullHistory[this.replayIndex] ||
            this.fullHistory[this.fullHistory.length - 1] ||
            null;
        return {
            replayActive: this.replayActive,
            replayIndex: this.replayIndex,
            totalBars: this.fullHistory.length,
            currentCandle,
            replayTimestamp: this.getReplayTimestamp() ?? currentCandle?.timestamp ?? null,
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
            canonicalTimestamp: this.canonicalReplayTimestamp ?? candle.timestamp,
            hasPartialLastBar: this.currentVisibleHasPartialLastBar,
            batchProgress: this.batchProgress,
        });
    }

    private collectFinerSeriesCandidates(symbol: SymbolInfo, targetStepMs: number): FinerSeriesCandidate[] {
        const candidates: FinerSeriesCandidate[] = [];
        const prefix = `${this.mode}:${symbol.exchange}:${symbol.ticker}:`;
        this.historyCache.forEach((entry, key) => {
            if (!key.startsWith(prefix) || !entry?.candles?.length) return;
            const parts = key.slice(prefix.length).split(':');
            const tf = parts[0];
            if (!tf) return;
            const stepMs = timeframeToMs(tf);
            if (stepMs > 0 && stepMs < targetStepMs) {
                candidates.push({ stepMs, candles: entry.candles });
            }
        });
        return candidates;
    }

    /**
     * Enables or disables Bar-by-Bar Replay mode by slicing the loaded history.
     * If preserveTimestamp is true and a replay cutoff timestamp exists, aligns the slice
     * to that timestamp without clobbering the canonical LTF cursor when viewing an HTF bar.
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
            const currentStepMs = this.currentPeriod ? periodToMs(this.currentPeriod) : 15 * 60_000;
            const targetPreserveTs = preserveTimestamp
                ? (this.canonicalReplayTimestamp ?? this.replayCutoffTimestamp)
                : null;

            let usedPreservedTs = false;
            if (targetPreserveTs !== null) {
                let idx = -1;
                for (let i = 0; i < this.fullHistory.length; i++) {
                    if (this.fullHistory[i].timestamp <= targetPreserveTs) {
                        idx = i;
                    } else {
                        break;
                    }
                }
                if (idx >= 1) {
                    this.replayIndex = idx;
                    usedPreservedTs = true;
                } else {
                    this.replayIndex = fallbackIdx;
                }
            } else {
                this.replayIndex = fallbackIdx;
            }

            if (usedPreservedTs && targetPreserveTs !== null) {
                const sym = this.currentSymbolInfo || DEFAULT_SYMBOLS[0];
                const sliceResult = buildVisibleReplaySlice(
                    this.fullHistory,
                    this.replayIndex,
                    currentStepMs,
                    targetPreserveTs,
                    this.canonicalReplayStepMs,
                    this.collectFinerSeriesCandidates(sym, currentStepMs)
                );
                this.visibleHistory = sliceResult.candles;
                this.currentVisibleHasPartialLastBar = sliceResult.hasPartialLastBar;
                this.canonicalReplayTimestamp = targetPreserveTs;
                if (this.canonicalReplayStepMs === null) {
                    this.canonicalReplayStepMs = currentStepMs;
                }
                this.replayCutoffTimestamp = targetPreserveTs;
            } else {
                this.visibleHistory = this.fullHistory.slice(0, this.replayIndex + 1);
                this.currentVisibleHasPartialLastBar = false;
                const picked = this.visibleHistory[this.visibleHistory.length - 1];
                if (picked) {
                    this.canonicalReplayTimestamp = picked.timestamp;
                    this.canonicalReplayStepMs = currentStepMs;
                    this.replayCutoffTimestamp = picked.timestamp;
                }
            }

            const lastVisible = this.visibleHistory[this.visibleHistory.length - 1];
            if (lastVisible) {
                this.currentChartCutoffTimestamp = lastVisible.timestamp;
                this.emit(lastVisible, true);
            }
            return this.visibleHistory;
        } else {
            this.replayActive = false;
            this.replayCutoffTimestamp = null;
            this.canonicalReplayTimestamp = null;
            this.canonicalReplayStepMs = null;
            this.currentChartCutoffTimestamp = null;
            this.currentVisibleHasPartialLastBar = false;
            this.visibleHistory = this.fullHistory;
            this.replayIndex = Math.max(0, this.fullHistory.length - 1);
            const last = this.fullHistory[this.fullHistory.length - 1];
            if (last) this.emit(last, false);
            return this.fullHistory;
        }
    }

    /**
     * Sets the replay cutoff directly to a specific timestamp T.
     */
    public setReplayTimestamp(
        timestamp: number,
        options?: { preserveCanonicalStep?: boolean }
    ): KLineData[] {
        this.replayCutoffTimestamp = timestamp;
        this.canonicalReplayTimestamp = timestamp;
        if (!options?.preserveCanonicalStep && this.currentPeriod) {
            this.canonicalReplayStepMs = periodToMs(this.currentPeriod);
        }
        return this.setReplayMode(true, 0.72, true);
    }

    /**
     * Advances 1 candle forward in Replay Mode and pushes it to KLineChart via subscribe callback.
     * If the current HTF candle was an in-progress LTF synthesis, finalizes that bar first
     * before advancing to the subsequent bar.
     */
    public stepReplayForward(): KLineData | null {
        if (!this.replayActive || this.fullHistory.length === 0) return null;
        const currentStepMs = this.currentPeriod ? periodToMs(this.currentPeriod) : 15 * 60_000;

        if (this.currentVisibleHasPartialLastBar) {
            const finalizedCandle = this.fullHistory[this.replayIndex];
            if (finalizedCandle) {
                this.currentVisibleHasPartialLastBar = false;
                if (this.visibleHistory.length > 0) {
                    this.visibleHistory = [
                        ...this.visibleHistory.slice(0, -1),
                        finalizedCandle,
                    ];
                } else {
                    this.visibleHistory = this.fullHistory.slice(0, this.replayIndex + 1);
                }
                this.canonicalReplayTimestamp = finalizedCandle.timestamp;
                this.canonicalReplayStepMs = currentStepMs;
                this.replayCutoffTimestamp = finalizedCandle.timestamp;
                this.currentChartCutoffTimestamp = finalizedCandle.timestamp;
                if (this.activeCallback) {
                    this.activeCallback(finalizedCandle);
                }
                this.emit(finalizedCandle, true);
                return finalizedCandle;
            }
        }

        if (this.replayIndex < this.fullHistory.length - 1) {
            this.replayIndex += 1;
            const nextCandle = this.fullHistory[this.replayIndex];
            if (nextCandle) {
                this.canonicalReplayTimestamp = nextCandle.timestamp;
                this.canonicalReplayStepMs = currentStepMs;
                this.replayCutoffTimestamp = nextCandle.timestamp;
                this.currentChartCutoffTimestamp = nextCandle.timestamp;
                this.currentVisibleHasPartialLastBar = false;
                if (this.visibleHistory.length > 0) {
                    this.visibleHistory = [...this.visibleHistory, nextCandle];
                } else {
                    this.visibleHistory = this.fullHistory.slice(0, this.replayIndex + 1);
                }
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
     * Ensures that a specific historical timestamp `targetTimestamp` (from a synced trade,
     * Go To Date, or cross-timeframe replay switch) is covered cleanly by `this.fullHistory`
     * without leaving multi-day gaps or failing in DEMO/offline modes.
     */
    public async ensureTimestampLoaded(
        targetTimestamp: number,
        options?: { preserveCanonicalStep?: boolean }
    ): Promise<KLineData[]> {
        const symbol = this.currentSymbolInfo || DEFAULT_SYMBOLS[0];
        const period = this.currentPeriod || { multiplier: 15, timespan: 'minute', text: '15m' };
        const tf = periodToTimeframe(period);
        const stepMs = periodToMs(period);
        const startGen = this.prefetchAbortGeneration;
        const startTicker = symbol.ticker;

        const earliest = this.fullHistory[0]?.timestamp ?? Infinity;
        const needsWindow =
            !doesHistoryCoverReplayTarget(this.fullHistory, targetTimestamp, stepMs) ||
            targetTimestamp < earliest + stepMs * 10;

        if (needsWindow) {
            this.updateBatchProgress({
                isPrefetching: true,
                statusText: 'Carregando lote da data selecionada...',
            });

            const windowEnd = Math.min(Date.now(), targetTimestamp + stepMs * 160);
            const windowStart = targetTimestamp - stepMs * 340;
            let working = this.fullHistory;

            if (this.mode === 'DEMO') {
                let loadedDemo: KLineData[] | null = null;
                try {
                    const res = await fetch(
                        `/api/quant/ohlcv?symbol=${encodeURIComponent(symbol.ticker)}&timeframe=${encodeURIComponent(tf)}&to=${windowEnd}&limit=${DEFAULT_BATCH_SIZE}`,
                        {
                            headers: getQuantAuthHeaders(),
                            signal: AbortSignal.timeout(2500),
                        }
                    );
                    if (res.ok) {
                        const data = await res.json();
                        if (Array.isArray(data?.candles) && data.candles.length > 0) {
                            loadedDemo = data.candles.map((c: any) => ({
                                timestamp: Number(c.timestamp),
                                open: Number(c.open),
                                high: Number(c.high),
                                low: Number(c.low),
                                close: Number(c.close),
                                volume: Number(c.volume || 0),
                            }));
                            this.lastSourceUsed = `${MODE_LABEL.DEMO} · Polars`;
                        }
                    }
                } catch (_) {}

                if (!loadedDemo || !doesHistoryCoverReplayTarget(loadedDemo, targetTimestamp, stepMs)) {
                    const anchor = this.fullHistory[0]?.open ?? this.priceAnchorHint ?? undefined;
                    loadedDemo = this.generateDemoCandles(
                        symbol.ticker,
                        period,
                        DEFAULT_BATCH_SIZE,
                        windowEnd,
                        anchor
                    );
                    this.lastSourceUsed = MODE_LABEL.DEMO;
                }
                this.lastSynthetic = true;
                working = mergeContiguousCandles(working, loadedDemo, stepMs);
            } else {
                // 1. Unified backend batch endpoint
                try {
                    if (this.mode !== 'BINANCE_LIVE') {
                        const batch = await fetchSingleCandleBatch({
                            symbol: this.resolveBackendSymbol(symbol),
                            timeframe: tf,
                            chunkSize: DEFAULT_BATCH_SIZE,
                            cursorTo: windowEnd,
                            fromTs: windowStart,
                        });
                        if (batch.candles.length > 0) {
                            working = mergeContiguousCandles(working, batch.candles, stepMs);
                        }
                    }
                } catch (_) {}

                // 2. IndexedDB fallback (only contiguous ranges covering targetTimestamp)
                if (!doesHistoryCoverReplayTarget(working, targetTimestamp, stepMs)) {
                    try {
                        const idb = await getMergedCandlesFromIDB(symbol.ticker, tf);
                        if (idb.candles.length > 0 && doesHistoryCoverReplayTarget(idb.candles, targetTimestamp, stepMs)) {
                            working = mergeContiguousCandles(working, idb.candles, stepMs);
                        }
                    } catch (_) {}
                }

                // 3. Binance public klines when available
                const pair = binancePairOf(symbol.ticker);
                if (pair && !doesHistoryCoverReplayTarget(working, targetTimestamp, stepMs)) {
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
                                    turnover: parseFloat(k[7]),
                                }));
                                await saveCandleBatchToIDB(
                                    symbol.ticker,
                                    tf,
                                    mapped,
                                    `${MODE_LABEL.BINANCE_LIVE} (${pair})`
                                );
                                working = mergeContiguousCandles(working, mapped, stepMs);
                            }
                        }
                    } catch (_) {}
                }

                // 4. Quant-Engine Real Parquet Data Lake
                if (!doesHistoryCoverReplayTarget(working, targetTimestamp, stepMs)) {
                    try {
                        const qRes = await fetch(
                            `/api/quant/ohlcv?symbol=${encodeURIComponent(this.resolveBackendSymbol(symbol))}&timeframe=${encodeURIComponent(tf)}&to=${windowEnd}&limit=${DEFAULT_BATCH_SIZE}&source=real`,
                            {
                                headers: getQuantAuthHeaders(),
                                signal: AbortSignal.timeout(4000),
                            }
                        );
                        if (qRes.ok) {
                            const qData = await qRes.json();
                            if (qData?.isRealMarket && Array.isArray(qData.candles) && qData.candles.length > 0) {
                                working = mergeContiguousCandles(working, qData.candles as KLineData[], stepMs);
                            }
                        }
                    } catch (_) {}
                }

                // 5. Emergency offline fallback ONLY if still uncovered
                if (!doesHistoryCoverReplayTarget(working, targetTimestamp, stepMs)) {
                    const anchor = this.fullHistory[0]?.open ?? this.priceAnchorHint ?? undefined;
                    const fallbackChunk = this.generateDemoCandles(
                        symbol.ticker,
                        period,
                        DEFAULT_BATCH_SIZE,
                        windowEnd,
                        anchor
                    );
                    this.lastSynthetic = true;
                    this.lastSourceUsed = 'Demo (offline — sem conexão ao feed)';
                    working = mergeContiguousCandles(working, fallbackChunk, stepMs);
                }
            }

            // Abort cleanly if the user switched symbol/timeframe while fetching
            const activeTf = this.currentPeriod ? periodToTimeframe(this.currentPeriod) : tf;
            if (
                startGen !== this.prefetchAbortGeneration ||
                startTicker !== this.currentSymbolInfo?.ticker ||
                tf !== activeTf
            ) {
                return this.getVisibleReplayCandles();
            }

            this.fullHistory = working;
            this.syncMemoryCache(symbol, period, this.fullHistory);

            this.updateBatchProgress({
                loadedBatches: this.batchProgress.loadedBatches + 1,
                totalBatches: Math.max(this.batchProgress.totalBatches, this.batchProgress.loadedBatches + 1),
                totalBars: this.fullHistory.length,
                isPrefetching: false,
                statusText: `Lote sincronizado • ${this.fullHistory.length} velas`,
            });
        }

        return this.setReplayTimestamp(targetTimestamp, options);
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
     * Used by Auxiliary Multi-Pane charts: never triggers primary background prefetch or overwrites `this.fullHistory`,
     * never leaks future HTF candle OHLC past the active LTF cursor, and fetches historical windows if cutoff is older.
     */
    public async getHistorySlicedAtTimestamp(
        symbol: SymbolInfo,
        period: Period,
        cutoffTimestamp: number | null
    ): Promise<KLineData[]> {
        const candles = await this.fetchOrGetCachedCandles(symbol, period, {
            anchorTs: cutoffTimestamp,
            allowPrefetch: false,
        });
        if (!cutoffTimestamp || !this.replayActive) {
            return candles;
        }

        const stepMs = periodToMs(period);
        let targetCandles = candles;
        if (!doesHistoryCoverReplayTarget(targetCandles, cutoffTimestamp, stepMs)) {
            const windowEnd = Math.min(Date.now(), cutoffTimestamp + stepMs * 160);
            try {
                const fetched = await this.fetchInitialBatchFromSource(symbol, period, windowEnd);
                if (fetched.candles.length > 0) {
                    targetCandles = mergeContiguousCandles(targetCandles, fetched.candles, stepMs);
                    const tf = periodToTimeframe(period);
                    const cacheKey = `${this.mode}:${symbol.exchange}:${symbol.ticker}:${tf}:${this.maxBars}`;
                    this.historyCache.set(cacheKey, {
                        candles: targetCandles,
                        source: fetched.source,
                        synthetic: fetched.synthetic,
                        fetchedAt: Date.now(),
                    });
                }
            } catch (_) {}
        }

        let cutoffIdx = -1;
        for (let i = 0; i < targetCandles.length; i++) {
            if (targetCandles[i].timestamp <= cutoffTimestamp) {
                cutoffIdx = i;
            } else {
                break;
            }
        }
        if (cutoffIdx < 0) {
            return [];
        }

        return buildVisibleReplaySlice(
            targetCandles,
            cutoffIdx,
            stepMs,
            cutoffTimestamp,
            this.canonicalReplayStepMs,
            this.collectFinerSeriesCandidates(symbol, stepMs)
        ).candles;
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
                    {
                        headers: getQuantAuthHeaders(),
                        signal: AbortSignal.timeout(2500),
                    }
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

        // 1. Check IndexedDB dual-layer cache AND verify contiguous coverage around `to`
        const idbCached = await getMergedCandlesFromIDB(symbol.ticker, tf);
        const idbCoversTargetWindow = idbCoversTargetWindowPure(idbCached.candles, to, stepMs);

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
                    const merged = mergeContiguousCandles(idbCached.candles, batchRes.candles, stepMs);
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
                        const merged = mergeContiguousCandles(idbCached.candles, mapped, stepMs);
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

        // 5. If IndexedDB had partial real market candles covering or near `to`, prefer them over synthetic
        if (idbCached.candles.length > 0 && idbCached.earliestTs !== null && idbCached.earliestTs <= to) {
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
                {
                    headers: getQuantAuthHeaders(),
                    signal: AbortSignal.timeout(6000),
                }
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
        estimatedTotalChunks: number,
        generation: number
    ) {
        const tf = periodToTimeframe(period);
        const stepMs = periodToMs(period);
        const targetFromTs =
            this.sessionFromTs || Date.now() - stepMs * DEFAULT_BATCH_SIZE * 2;

        const isStillPrimaryTarget = () =>
            generation === this.prefetchAbortGeneration &&
            this.currentSymbolInfo?.ticker === symbol.ticker &&
            this.currentPeriod !== null &&
            periodToTimeframe(this.currentPeriod) === tf;

        // If DEMO/synthetic or we already cover `targetFromTs` or no cursor is needed, mark complete
        const currentEarliest = this.fullHistory[0]?.timestamp ?? Infinity;
        if (
            !isStillPrimaryTarget() ||
            this.mode === 'DEMO' ||
            this.lastSynthetic ||
            !initialCursorTo ||
            currentEarliest <= targetFromTs
        ) {
            if (isStillPrimaryTarget()) {
                this.updateBatchProgress({
                    symbol: symbol.ticker,
                    timeframe: tf,
                    loadedBatches: Math.max(1, this.batchProgress.loadedBatches),
                    totalBatches: Math.max(1, this.batchProgress.loadedBatches),
                    isPrefetching: false,
                    statusText: `${this.fullHistory.length} velas em cache`,
                });
            }
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
                if (!isStillPrimaryTarget() || !cursor) break;
                // Wait 250ms so chart rendering & user interactions have 100% priority
                await new Promise((r) => setTimeout(r, 250));
                if (!isStillPrimaryTarget()) break;

                try {
                    const batch = await fetchSingleCandleBatch({
                        symbol: this.resolveBackendSymbol(symbol),
                        timeframe: tf,
                        chunkSize: DEFAULT_BATCH_SIZE,
                        chunkIndex: idx,
                        cursorTo: cursor,
                        fromTs: targetFromTs - stepMs * DEFAULT_BATCH_SIZE,
                    });

                    if (!isStillPrimaryTarget()) break;

                    if (batch.candles.length > 0) {
                        const beforeLen = this.fullHistory.length;
                        this.fullHistory = mergeContiguousCandles(this.fullHistory, batch.candles, stepMs);
                        this.syncMemoryCache(symbol, period, this.fullHistory);
                        const addedBars = Math.max(0, this.fullHistory.length - beforeLen);
                        // Re-align replayIndex without disturbing canonical replay cutoff
                        if (this.replayActive && this.getReplayTimestamp()) {
                            const updatedVisible = this.setReplayMode(true, 0.72, true);
                            if (addedBars > 0) {
                                this.onHistoryPrependedListener?.(updatedVisible, addedBars);
                            }
                        } else if (addedBars > 0) {
                            this.visibleHistory = this.fullHistory;
                            this.onHistoryPrependedListener?.(this.visibleHistory, addedBars);
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
                    if (isStillPrimaryTarget()) {
                        this.updateBatchProgress({
                            isPrefetching: false,
                            statusText: `Lote 1/1 • ${this.fullHistory.length} velas (IDB)`,
                        });
                    }
                    break;
                }
            }
        })();
    }

    private async fetchOrGetCachedCandles(
        symbol: SymbolInfo,
        period: Period,
        options?: {
            anchorTs?: number | null;
            allowPrefetch?: boolean;
            generation?: number;
        }
    ): Promise<KLineData[]> {
        const tf = periodToTimeframe(period);
        const stepMs = periodToMs(period);
        const cacheKey = `${this.mode}:${symbol.exchange}:${symbol.ticker}:${tf}:${this.maxBars}`;
        const cached = this.historyCache.get(cacheKey);
        const allowPrefetch = options?.allowPrefetch ?? false;
        const anchorTs = options?.anchorTs ?? null;

        const cacheCoversAnchor =
            !anchorTs || doesHistoryCoverReplayTarget(cached?.candles || [], anchorTs, stepMs);

        if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS && cached.candles.length > 0 && cacheCoversAnchor) {
            this.historyCache.delete(cacheKey); // refresh LRU order
            this.historyCache.set(cacheKey, cached);
            if (allowPrefetch) {
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
            }
            return cached.candles;
        }

        const effectiveTo =
            anchorTs && anchorTs > 0
                ? Math.min(Date.now(), anchorTs + stepMs * 160)
                : this.sessionToTs
                  ? Math.min(Date.now(), this.sessionToTs)
                  : Date.now();
        const initialBatch = await this.fetchInitialBatchFromSource(symbol, period, effectiveTo);
        const sorted = initialBatch.candles
            .filter((c) => Number.isFinite(c.open) && Number.isFinite(c.close) && Number.isFinite(c.timestamp))
            .sort((a, b) => a.timestamp - b.timestamp);

        const nextSeries =
            cached && cached.candles.length > 0
                ? mergeContiguousCandles(cached.candles, sorted, stepMs)
                : sorted;

        if (this.historyCache.size >= MAX_CACHE_ENTRIES && !this.historyCache.has(cacheKey)) {
            const oldestKey = this.historyCache.keys().next().value;
            if (oldestKey) this.historyCache.delete(oldestKey);
        }
        this.historyCache.delete(cacheKey);
        this.historyCache.set(cacheKey, {
            candles: nextSeries,
            source: initialBatch.source,
            synthetic: initialBatch.synthetic,
            fetchedAt: Date.now(),
        });

        const isPrimaryGeneration =
            allowPrefetch &&
            (options?.generation === undefined || options.generation === this.prefetchAbortGeneration) &&
            symbol.ticker === this.currentSymbolInfo?.ticker &&
            this.currentPeriod !== null &&
            periodToTimeframe(this.currentPeriod) === tf;

        if (isPrimaryGeneration) {
            this.lastSourceUsed = initialBatch.source;
            this.lastSynthetic = initialBatch.synthetic;
            const batchesLoaded = Math.max(1, Math.ceil(nextSeries.length / DEFAULT_BATCH_SIZE));
            this.updateBatchProgress({
                symbol: symbol.ticker,
                timeframe: tf,
                loadedBatches: batchesLoaded,
                totalBatches: Math.max(batchesLoaded, initialBatch.estimatedTotalChunks),
                totalBars: nextSeries.length,
                fromCache: initialBatch.fromCache,
                isPrefetching: false,
                hasMore: initialBatch.hasMore,
                statusText: initialBatch.fromCache
                    ? `Lotes ${batchesLoaded}/${batchesLoaded} • ${nextSeries.length} velas (IDB)`
                    : `Lote 1/${Math.max(1, initialBatch.estimatedTotalChunks)} • ${nextSeries.length} velas`,
            });

            this.startBackgroundBatchPrefetch(
                symbol,
                period,
                initialBatch.nextCursorTo,
                initialBatch.estimatedTotalChunks,
                options?.generation ?? this.prefetchAbortGeneration
            );
        }

        return nextSeries;
    }

    async getHistoryKLineData(
        symbol: SymbolInfo,
        period: Period,
        _from?: number,
        _to?: number,
        replayAnchorTs?: number | null,
        preserveReplayCursor: boolean = true
    ): Promise<KLineData[]> {
        // Save the outgoing series in memory cache before mutating `currentSymbolInfo`/`currentPeriod`
        // so LTF -> HTF timeframe switches always have the outgoing LTF series available for forming bars.
        if (this.fullHistory.length > 0 && this.currentSymbolInfo && this.currentPeriod) {
            this.syncMemoryCache(this.currentSymbolInfo, this.currentPeriod, this.fullHistory);
        }

        const loadGen = ++this.prefetchAbortGeneration;
        this.currentSymbolInfo = symbol;
        this.currentPeriod = period;

        if (!preserveReplayCursor) {
            this.replayCutoffTimestamp = null;
            this.canonicalReplayTimestamp = null;
            this.canonicalReplayStepMs = null;
            this.currentChartCutoffTimestamp = null;
            this.currentVisibleHasPartialLastBar = false;
        }

        const effectiveAnchorTs =
            replayAnchorTs && replayAnchorTs > 0
                ? replayAnchorTs
                : this.replayActive && preserveReplayCursor
                  ? this.getReplayTimestamp()
                  : null;

        const candles = await this.fetchOrGetCachedCandles(symbol, period, {
            anchorTs: effectiveAnchorTs,
            allowPrefetch: true,
            generation: loadGen,
        });

        if (loadGen !== this.prefetchAbortGeneration) {
            return this.getVisibleReplayCandles();
        }

        this.fullHistory = candles;
        this.historyTicker = symbol.ticker;
        this.historyPeriodText = period.text ?? periodToTimeframe(period);

        if (this.replayActive && candles.length > 5) {
            const shouldPreserve = Boolean(
                preserveReplayCursor &&
                    effectiveAnchorTs &&
                    doesHistoryCoverReplayTarget(candles, effectiveAnchorTs, periodToMs(period))
            );
            return this.setReplayMode(true, 0.72, shouldPreserve);
        }

        this.visibleHistory = candles;
        this.currentVisibleHasPartialLastBar = false;
        this.replayIndex = Math.max(0, candles.length - 1);
        const last = candles[candles.length - 1];
        this.currentChartCutoffTimestamp = last?.timestamp ?? null;
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

    public dispose(): void {
        this.prefetchAbortGeneration += 1;
        this.stopLiveStream();
        this.activeCallback = null;
        this.onCandleUpdateListener = undefined;
        this.onBatchProgressListener = undefined;
        this.onHistoryPrependedListener = undefined;
        this.historyCache.clear();
        this.fullHistory = [];
        this.visibleHistory = [];
    }

    private stopLiveStream() {
        if (this.ws) {
            try {
                this.ws.onopen = null;
                this.ws.onmessage = null;
                this.ws.onerror = null;
                this.ws.onclose = null;
                this.ws.close();
            } catch (_) {}
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
