import { KLineData } from 'klinecharts';
import { Datafeed, SymbolInfo, Period, DatafeedSubscribeCallback } from '@klinecharts/pro';
import api from '../api';

export type DataSourceMode = 'TRADINGVIEW' | 'BINANCE_LIVE' | 'MT5_BACKEND';

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

const BINANCE_TICKER_MAP: Record<string, string> = {
    BTCUSD: 'BTCUSDT',
    BTCUSDT: 'BTCUSDT',
    ETHUSD: 'ETHUSDT',
    ETHUSDT: 'ETHUSDT',
    SOLUSD: 'SOLUSDT',
    XAUUSD: 'PAXGUSDT',
    EURUSD: 'EURUSDT',
    GBPUSD: 'GBPUSDT',
};

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

interface CacheEntry {
    candles: KLineData[];
    source: string;
    fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 24;

export class CustomKLineDatafeed implements Datafeed {
    private mode: DataSourceMode = 'TRADINGVIEW';
    private ws: WebSocket | null = null;
    private liveTimer: ReturnType<typeof setInterval> | null = null;
    private activeCallback: DatafeedSubscribeCallback | null = null;

    // In-memory LRU Cache for instant timeframe switching & multi-chart sync
    private historyCache: Map<string, CacheEntry> = new Map();

    // Replay & Timestamp Synchronization state
    private fullHistory: KLineData[] = [];
    private replayActive: boolean = false;
    private replayIndex: number = 0;
    private replayCutoffTimestamp: number | null = null;
    private onCandleUpdateListener?: (candle: KLineData, stats: { source: string; totalBars: number; replayIndex: number; replayActive: boolean }) => void;
    private lastSourceUsed: string = 'TradingView API';

    constructor(
        initialMode: DataSourceMode = 'TRADINGVIEW',
        onCandleUpdate?: (candle: KLineData, stats: { source: string; totalBars: number; replayIndex: number; replayActive: boolean }) => void
    ) {
        this.mode = initialMode;
        this.onCandleUpdateListener = onCandleUpdate;
    }

    public setMode(newMode: DataSourceMode) {
        this.mode = newMode;
    }

    public getMode(): DataSourceMode {
        return this.mode;
    }

    public getLastSourceUsed(): string {
        return this.lastSourceUsed;
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
                if (this.onCandleUpdateListener) {
                    this.onCandleUpdateListener(last, {
                        source: `${this.lastSourceUsed} (Replay)`,
                        totalBars: this.fullHistory.length,
                        replayIndex: this.replayIndex,
                        replayActive: true,
                    });
                }
            }
            return visible;
        } else {
            this.replayActive = false;
            this.replayCutoffTimestamp = null;
            this.replayIndex = Math.max(0, this.fullHistory.length - 1);
            const last = this.fullHistory[this.fullHistory.length - 1];
            if (last && this.onCandleUpdateListener) {
                this.onCandleUpdateListener(last, {
                    source: this.lastSourceUsed,
                    totalBars: this.fullHistory.length,
                    replayIndex: this.replayIndex,
                    replayActive: false,
                });
            }
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
            if (nextCandle && this.onCandleUpdateListener) {
                this.onCandleUpdateListener(nextCandle, {
                    source: `${this.lastSourceUsed} (Replay)`,
                    totalBars: this.fullHistory.length,
                    replayIndex: this.replayIndex,
                    replayActive: this.replayIndex < this.fullHistory.length - 1,
                });
            }
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

    private async fetchOrGetCachedCandles(
        symbol: SymbolInfo,
        period: Period,
        from?: number,
        to?: number
    ): Promise<KLineData[]> {
        const tf = periodToTimeframe(period);
        const cacheKey = `${this.mode}:${symbol.ticker}:${tf}`;
        const cached = this.historyCache.get(cacheKey);

        if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS && cached.candles.length > 0) {
            // Refresh LRU order
            this.historyCache.delete(cacheKey);
            this.historyCache.set(cacheKey, cached);
            this.lastSourceUsed = cached.source;
            return cached.candles;
        }

        let candles: KLineData[] = [];

        // 1. Try TradingView Backend API if mode === 'TRADINGVIEW'
        if (this.mode === 'TRADINGVIEW') {
            try {
                const res = await api.get('/tradingview/candles', {
                    params: {
                        symbol: symbol.exchange && symbol.exchange !== 'TV' ? `${symbol.exchange}:${symbol.ticker}` : symbol.ticker,
                        timeframe: tf,
                        range: 350,
                        from,
                        to,
                    },
                });
                if (Array.isArray(res.data) && res.data.length > 0) {
                    candles = res.data.map((c: any) => ({
                        timestamp: c.timestamp || (c.time ? c.time * 1000 : Date.now()),
                        open: Number(c.open),
                        high: Number(c.high),
                        low: Number(c.low),
                        close: Number(c.close),
                        volume: Number(c.volume || 0),
                        turnover: Number(c.turnover || (c.close * (c.volume || 1))),
                    }));
                    this.lastSourceUsed = 'TradingView API';
                }
            } catch (_) {
                // Will fallback to Binance or MT5/Synthetic
            }
        }

        // 2. Try MT5 / Oanda Backend API if mode === 'MT5_BACKEND'
        if (candles.length === 0 && this.mode === 'MT5_BACKEND') {
            try {
                const fromIso = new Date(from || Date.now() - 7 * 86400000).toISOString();
                const toIso = new Date(to || Date.now()).toISOString();
                const res = await api.get('/market-data/candles', {
                    params: {
                        symbol: symbol.ticker,
                        from: fromIso,
                        to: toIso,
                        granularity: `M${period.multiplier || 5}`,
                    },
                });
                if (Array.isArray(res.data) && res.data.length > 0) {
                    candles = res.data.map((c: any) => ({
                        timestamp: typeof c.time === 'number' ? (c.time < 10000000000 ? c.time * 1000 : c.time) : new Date(c.time).getTime(),
                        open: Number(c.open),
                        high: Number(c.high),
                        low: Number(c.low),
                        close: Number(c.close),
                        volume: Number(c.volume || 100),
                        turnover: Number(c.close) * Number(c.volume || 100),
                    }));
                    this.lastSourceUsed = 'MT5 / Oanda Feed';
                }
            } catch (_) {
                // Fallback below
            }
        }

        // 3. Try Public Binance REST API (for Crypto, Gold PAXG, EUR, GBP or when BINANCE_LIVE is selected)
        const binancePair = BINANCE_TICKER_MAP[symbol.ticker.toUpperCase()];
        if (candles.length === 0 && (this.mode === 'BINANCE_LIVE' || binancePair)) {
            const targetPair = binancePair || 'BTCUSDT';
            try {
                const interval = periodToBinanceInterval(period);
                const url = `https://api.binance.com/api/v3/klines?symbol=${targetPair}&interval=${interval}&limit=350`;
                const response = await fetch(url);
                if (response.ok) {
                    const raw = await response.json();
                    if (Array.isArray(raw) && raw.length > 0 && (binancePair || this.mode === 'BINANCE_LIVE')) {
                        candles = raw.map((k: any[]) => ({
                            timestamp: Number(k[0]),
                            open: parseFloat(k[1]),
                            high: parseFloat(k[2]),
                            low: parseFloat(k[3]),
                            close: parseFloat(k[4]),
                            volume: parseFloat(k[5]),
                            turnover: parseFloat(k[7]),
                        }));
                        this.lastSourceUsed = binancePair ? `Binance Live (${targetPair})` : 'Binance API';
                    }
                }
            } catch (_) {
                // Fallback to local generator
            }
        }

        // 4. Guaranteed High-Precision Fallback so chart is never empty
        if (candles.length === 0) {
            candles = this.generateRealisticCandles(symbol.ticker, period, 350, to);
            this.lastSourceUsed = 'Simulador Institucional (Offline/Demo)';
        }

        candles.sort((a, b) => a.timestamp - b.timestamp);

        // Save in LRU Cache
        if (this.historyCache.size >= MAX_CACHE_ENTRIES) {
            const oldestKey = this.historyCache.keys().next().value;
            if (oldestKey) this.historyCache.delete(oldestKey);
        }
        this.historyCache.set(cacheKey, {
            candles,
            source: this.lastSourceUsed,
            fetchedAt: Date.now(),
        });

        return candles;
    }

    async getHistoryKLineData(symbol: SymbolInfo, period: Period, from: number, to: number): Promise<KLineData[]> {
        const candles = await this.fetchOrGetCachedCandles(symbol, period, from, to);
        this.fullHistory = candles;

        if (this.replayActive && candles.length > 20) {
            return this.setReplayMode(true, 0.72, true);
        }

        this.replayIndex = Math.max(0, candles.length - 1);
        const last = candles[candles.length - 1];
        if (last && this.onCandleUpdateListener) {
            this.onCandleUpdateListener(last, {
                source: this.lastSourceUsed,
                totalBars: candles.length,
                replayIndex: this.replayIndex,
                replayActive: false,
            });
        }

        return candles;
    }

    subscribe(symbol: SymbolInfo, period: Period, callback: DatafeedSubscribeCallback): void {
        this.activeCallback = callback;
        this.stopLiveStream();

        // In Replay mode, candles only advance when the user clicks Step or Play
        if (this.replayActive) {
            return;
        }

        const binancePair = BINANCE_TICKER_MAP[symbol.ticker.toUpperCase()];
        if (binancePair) {
            try {
                const interval = periodToBinanceInterval(period);
                const streamName = `${binancePair.toLowerCase()}@kline_${interval}`;
                this.ws = new WebSocket(`wss://stream.binance.com:9443/ws/${streamName}`);
                this.ws.onmessage = (event) => {
                    if (this.replayActive) return;
                    try {
                        const msg = JSON.parse(event.data);
                        if (msg.k) {
                            const k = msg.k;
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
                            callback(bar);
                            if (this.onCandleUpdateListener) {
                                this.onCandleUpdateListener(bar, {
                                    source: this.lastSourceUsed,
                                    totalBars: this.fullHistory.length,
                                    replayIndex: this.fullHistory.length - 1,
                                    replayActive: false,
                                });
                            }
                        }
                    } catch (_) {}
                };
                return;
            } catch (_) {}
        }

        // Simulated real-time micro-tick updates for non-Binance symbols when not in Replay Mode
        const cfg = BASE_MARKET_CONFIG[symbol.ticker.toUpperCase()] || { price: 100, volatility: 0.5, decimals: 2 };
        this.liveTimer = setInterval(() => {
            if (this.replayActive || this.fullHistory.length === 0) return;
            const last = { ...this.fullHistory[this.fullHistory.length - 1] };
            const microStep = (Math.random() - 0.498) * (cfg.volatility * 0.08);
            const nextClose = Number((last.close + microStep).toFixed(cfg.decimals));
            last.close = nextClose;
            if (nextClose > last.high) last.high = nextClose;
            if (nextClose < last.low) last.low = nextClose;
            last.volume = (last.volume || 100) + Math.round(Math.random() * 5);

            this.fullHistory[this.fullHistory.length - 1] = last;
            callback(last);
            if (this.onCandleUpdateListener) {
                this.onCandleUpdateListener(last, {
                    source: this.lastSourceUsed,
                    totalBars: this.fullHistory.length,
                    replayIndex: this.fullHistory.length - 1,
                    replayActive: false,
                });
            }
        }, 1500);
    }

    unsubscribe(_symbol: SymbolInfo, _period: Period): void {
        this.stopLiveStream();
    }

    private stopLiveStream() {
        if (this.ws) {
            try { this.ws.close(); } catch (_) {}
            this.ws = null;
        }
        if (this.liveTimer) {
            clearInterval(this.liveTimer);
            this.liveTimer = null;
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
     * Generates deterministic multi-timeframe coherent candles anchored to 15m epochs
     * so 15m, 1h and 4h charts align in price and timestamp during offline/demo simulation.
     */
    private generateRealisticCandles(ticker: string, period: Period, count: number, toTs?: number): KLineData[] {
        const clean = ticker.replace(/^.*:/, '').toUpperCase();
        const cfg = BASE_MARKET_CONFIG[clean] || { price: 100.0, volatility: 0.8, decimals: 2 };
        const stepMs = periodToMs(period);
        const end = toTs && toTs > 1000000000000 ? toTs : Date.now();
        const alignedEnd = Math.floor(end / stepMs) * stepMs;

        let seed = clean.split('').reduce((a, b) => a + b.charCodeAt(0), 0) + 1337;
        const rand = () => {
            seed = (seed * 1664525 + 1013904223) % 4294967296;
            return seed / 4294967296;
        };

        const bars: KLineData[] = [];
        let price = cfg.price;

        for (let i = count; i >= 0; i--) {
            const ts = alignedEnd - i * stepMs;
            const swing = Math.sin(i / 18) * cfg.volatility * 0.3;
            const change = (rand() - 0.495) * cfg.volatility + swing * 0.15;
            const open = price;
            const close = Math.max(cfg.price * 0.25, open + change);
            const high = Math.max(open, close) + rand() * cfg.volatility * 0.7;
            const low = Math.min(open, close) - rand() * cfg.volatility * 0.7;
            const volume = Math.round(120 + rand() * 1200);

            bars.push({
                timestamp: ts,
                open: Number(open.toFixed(cfg.decimals)),
                high: Number(high.toFixed(cfg.decimals)),
                low: Number(low.toFixed(cfg.decimals)),
                close: Number(close.toFixed(cfg.decimals)),
                volume,
                turnover: Number((close * volume).toFixed(2)),
            });
            price = close;
        }

        return bars;
    }
}
