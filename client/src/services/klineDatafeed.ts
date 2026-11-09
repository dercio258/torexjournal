import { KLineData } from 'klinecharts';
import { Datafeed, SymbolInfo, Period, DatafeedSubscribeCallback } from '@klinecharts/pro';
import api from '../api';

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
        exchange: 'OANDA',
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
        exchange: 'OANDA',
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
        exchange: 'OANDA',
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
        exchange: 'OANDA',
        market: 'index',
        pricePrecision: 2,
        volumePrecision: 0,
        priceCurrency: 'USD',
        type: 'INDEX',
    },
];

/**
 * Binance only lists crypto. Forex/gold "equivalents" (PAXG, EURUSDT) are
 * different instruments with different prices, so they are NOT mapped.
 */
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

/** OANDA granularity: M1, M5, M15, M30, H1, H4, D, W, M. */
export function periodToOandaGranularity(period: Period): string {
    const { multiplier, timespan } = period;
    if (timespan === 'minute') return [1, 5, 15, 30].includes(multiplier) ? `M${multiplier}` : 'M15';
    if (timespan === 'hour') return [1, 2, 4, 6, 8, 12].includes(multiplier) ? `H${multiplier}` : 'H1';
    if (timespan === 'day') return 'D';
    if (timespan === 'week') return 'W';
    if (timespan === 'month') return 'M';
    return 'M15';
}

const MODE_LABEL: Record<DataSourceMode, string> = {
    TRADINGVIEW: 'TradingView',
    BINANCE_LIVE: 'Binance',
    MT5_BACKEND: 'OANDA',
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
const DEFAULT_BARS = 350;

type CandleListener = (candle: KLineData, stats: FeedStats) => void;

const toKLine = (c: any): KLineData => ({
    timestamp: Number(c.timestamp ?? (typeof c.time === 'number' ? (c.time < 1e10 ? c.time * 1000 : c.time) : new Date(c.time).getTime())),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume || 0),
});

const errorMessage = (e: any): string => e?.response?.data?.message || e?.message || 'erro desconhecido';

export class CustomKLineDatafeed implements Datafeed {
    private mode: DataSourceMode = 'TRADINGVIEW';
    private ws: WebSocket | null = null;
    private activeCallback: DatafeedSubscribeCallback | null = null;
    /** Bars per request (set from the user's plan). */
    private maxBars = DEFAULT_BARS;

    // In-memory LRU cache for instant timeframe switching & multi-chart sync
    private historyCache: Map<string, CacheEntry> = new Map();

    // Replay & timestamp synchronization state
    private fullHistory: KLineData[] = [];
    private replayActive: boolean = false;
    private replayIndex: number = 0;
    private replayCutoffTimestamp: number | null = null;
    private onCandleUpdateListener?: CandleListener;
    private lastSourceUsed: string = MODE_LABEL.TRADINGVIEW;
    private lastSynthetic = false;
    private historyTicker = '';
    private historyPeriodText = '';

    constructor(initialMode: DataSourceMode = 'TRADINGVIEW', onCandleUpdate?: CandleListener) {
        this.mode = initialMode;
        this.onCandleUpdateListener = onCandleUpdate;
    }

    public setMode(newMode: DataSourceMode) {
        this.mode = newMode;
    }

    public getMode(): DataSourceMode {
        return this.mode;
    }

    public setMaxBars(bars: number) {
        if (Number.isFinite(bars) && bars >= 50) this.maxBars = Math.floor(bars);
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
        });
    }

    /**
     * Enables or disables Bar-by-Bar Replay mode by slicing the loaded history.
     * If preserveTimestamp is true and replayCutoffTimestamp exists, aligns the slice
     * to the exact historical timestamp T so switching timeframes never leaks future bars.
     */
    public setReplayMode(
        enabled: boolean,
        startRatio: number = 0.72,
        preserveTimestamp: boolean = false
    ): KLineData[] {
        this.replayActive = enabled;
        if (enabled && this.fullHistory.length > 20) {
            this.stopLiveStream();

            if (preserveTimestamp && this.replayCutoffTimestamp) {
                let idx = -1;
                for (let i = 0; i < this.fullHistory.length; i++) {
                    if (this.fullHistory[i].timestamp <= this.replayCutoffTimestamp) {
                        idx = i;
                    } else {
                        break;
                    }
                }
                if (idx >= 5) {
                    this.replayIndex = idx;
                } else {
                    this.replayIndex = Math.max(15, Math.floor(this.fullHistory.length * startRatio));
                }
            } else {
                this.replayIndex = Math.max(15, Math.floor(this.fullHistory.length * startRatio));
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
     * Fetches (or reads from LRU cache) a timeframe's history and slices it up to cutoffTimestamp.
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

    /** One request to the source selected by `mode`. Throws FeedUnavailableError on failure. */
    private async fetchFromSource(symbol: SymbolInfo, period: Period, to: number): Promise<{ candles: KLineData[]; source: string; synthetic: boolean }> {
        const bars = this.maxBars;
        const from = to - bars * periodToMs(period);

        switch (this.mode) {
            case 'TRADINGVIEW': {
                try {
                    const res = await api.get('/tradingview/candles', {
                        params: {
                            symbol: symbol.exchange && symbol.exchange !== 'TV' ? `${symbol.exchange}:${symbol.ticker}` : symbol.ticker,
                            timeframe: periodToTimeframe(period),
                            range: bars,
                            to,
                        },
                    });
                    const raw = Array.isArray(res.data) ? res.data : res.data?.candles;
                    if (!Array.isArray(raw) || raw.length === 0) throw new Error('sem barras para este ativo/timeframe');
                    return { candles: raw.map(toKLine), source: MODE_LABEL.TRADINGVIEW, synthetic: false };
                } catch (e) {
                    throw new FeedUnavailableError(this.mode, `TradingView indisponível: ${errorMessage(e)}`);
                }
            }

            case 'MT5_BACKEND': {
                try {
                    const res = await api.get('/market-data/candles', {
                        params: {
                            symbol: symbol.ticker,
                            from: new Date(from).toISOString(),
                            to: new Date(to).toISOString(),
                            granularity: periodToOandaGranularity(period),
                        },
                    });
                    if (!Array.isArray(res.data) || res.data.length === 0) throw new Error('sem barras para este ativo/timeframe');
                    return { candles: res.data.map(toKLine), source: MODE_LABEL.MT5_BACKEND, synthetic: false };
                } catch (e) {
                    throw new FeedUnavailableError(this.mode, `OANDA indisponível: ${errorMessage(e)}`);
                }
            }

            case 'BINANCE_LIVE': {
                const pair = binancePairOf(symbol.ticker);
                if (!pair) {
                    throw new FeedUnavailableError(this.mode, `${symbol.ticker} não é negociado na Binance (só cripto). Use TradingView ou OANDA.`);
                }
                try {
                    const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${periodToBinanceInterval(period)}&endTime=${to}&limit=${Math.min(bars, 1000)}`;
                    const response = await fetch(url);
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    const raw = await response.json();
                    if (!Array.isArray(raw) || raw.length === 0) throw new Error('sem barras');
                    return {
                        candles: raw.map((k: any[]) => ({
                            timestamp: Number(k[0]),
                            open: parseFloat(k[1]),
                            high: parseFloat(k[2]),
                            low: parseFloat(k[3]),
                            close: parseFloat(k[4]),
                            volume: parseFloat(k[5]),
                            turnover: parseFloat(k[7]),
                        })),
                        source: `${MODE_LABEL.BINANCE_LIVE} (${pair})`,
                        synthetic: false,
                    };
                } catch (e) {
                    throw new FeedUnavailableError(this.mode, `Binance indisponível: ${errorMessage(e)}`);
                }
            }

            case 'DEMO':
            default:
                return { candles: this.generateDemoCandles(symbol.ticker, period, bars, to), source: MODE_LABEL.DEMO, synthetic: true };
        }
    }

    private async fetchOrGetCachedCandles(symbol: SymbolInfo, period: Period): Promise<KLineData[]> {
        const cacheKey = `${this.mode}:${symbol.exchange}:${symbol.ticker}:${periodToTimeframe(period)}:${this.maxBars}`;
        const cached = this.historyCache.get(cacheKey);

        if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS && cached.candles.length > 0) {
            this.historyCache.delete(cacheKey); // refresh LRU order
            this.historyCache.set(cacheKey, cached);
            this.lastSourceUsed = cached.source;
            this.lastSynthetic = cached.synthetic;
            return cached.candles;
        }

        const { candles, source, synthetic } = await this.fetchFromSource(symbol, period, Date.now());
        const sorted = candles
            .filter(c => Number.isFinite(c.open) && Number.isFinite(c.close) && Number.isFinite(c.timestamp))
            .sort((a, b) => a.timestamp - b.timestamp);
        this.lastSourceUsed = source;
        this.lastSynthetic = synthetic;

        if (this.historyCache.size >= MAX_CACHE_ENTRIES) {
            const oldestKey = this.historyCache.keys().next().value;
            if (oldestKey) this.historyCache.delete(oldestKey);
        }
        this.historyCache.set(cacheKey, { candles: sorted, source, synthetic, fetchedAt: Date.now() });
        return sorted;
    }

    /** `from`/`to` from the Datafeed interface are ignored: the window is sized by period x plan bars. */
    async getHistoryKLineData(symbol: SymbolInfo, period: Period, _from?: number, _to?: number): Promise<KLineData[]> {
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
     * DEMO mode only. Deterministic generated series, always surfaced in the
     * UI as simulated data, never used as a fallback for a real feed.
     */
    private generateDemoCandles(ticker: string, period: Period, count: number, toTs: number): KLineData[] {
        const clean = ticker.replace(/^.*:/, '').toUpperCase();
        const cfg = BASE_MARKET_CONFIG[clean] || { price: 100.0, volatility: 0.8, decimals: 2 };
        const stepMs = periodToMs(period);
        const alignedEnd = Math.floor(toTs / stepMs) * stepMs;
        // Scale per-bar volatility with the timeframe (~sqrt(t) from a 15m base).
        const vol = cfg.volatility * Math.sqrt(stepMs / (15 * 60 * 1000));

        let seed = clean.split('').reduce((a, b) => a + b.charCodeAt(0), 0) + stepMs / 60000;
        const rand = () => {
            seed = (seed * 1664525 + 1013904223) % 4294967296;
            return seed / 4294967296;
        };

        const bars: KLineData[] = [];
        let price = cfg.price;
        for (let i = count; i >= 0; i--) {
            const ts = alignedEnd - i * stepMs;
            const swing = Math.sin(i / 18) * vol * 0.3;
            const open = price;
            const close = Math.max(cfg.price * 0.25, open + (rand() - 0.495) * vol + swing * 0.15);
            const high = Math.max(open, close) + rand() * vol * 0.7;
            const low = Math.min(open, close) - rand() * vol * 0.7;
            const volume = Math.round(120 + rand() * 1200);
            bars.push({
                timestamp: ts,
                open: Number(open.toFixed(cfg.decimals)),
                high: Number(high.toFixed(cfg.decimals)),
                low: Number(low.toFixed(cfg.decimals)),
                close: Number(close.toFixed(cfg.decimals)),
                volume,
            });
            price = close;
        }
        return bars;
    }
}
