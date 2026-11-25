import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import * as TradingViewPkg from '@mathieuc/tradingview';
import { getQuantInternalHeaders } from '../common/security/security.config';

const TradingView: any = (TradingViewPkg as any)?.Client
    ? TradingViewPkg
    : (TradingViewPkg as any)?.default || TradingViewPkg;

const DEFAULT_SYMBOL_MAP: Record<string, string> = {
    XAUUSD: 'OANDA:XAUUSD',
    EURUSD: 'OANDA:EURUSD',
    GBPUSD: 'OANDA:GBPUSD',
    USDJPY: 'OANDA:USDJPY',
    AUDUSD: 'OANDA:AUDUSD',
    USDCAD: 'OANDA:USDCAD',
    USDCHF: 'OANDA:USDCHF',
    NZDUSD: 'OANDA:NZDUSD',
    EURGBP: 'OANDA:EURGBP',
    EURJPY: 'OANDA:EURJPY',
    GBPJPY: 'OANDA:GBPJPY',
    BTCUSD: 'BINANCE:BTCUSDT',
    BTCUSDT: 'BINANCE:BTCUSDT',
    ETHUSD: 'BINANCE:ETHUSDT',
    ETHUSDT: 'BINANCE:ETHUSDT',
    SOLUSD: 'BINANCE:SOLUSDT',
    US30: 'OANDA:US30USD',
    NAS100: 'OANDA:NAS100USD',
    SPX500: 'OANDA:SPX500USD',
    GER40: 'OANDA:DE30EUR',
    UK100: 'OANDA:UK100GBP',
    USOIL: 'OANDA:WTICOUSD',
};

const TIMEFRAME_MAP: Record<string, string> = {
    '1m': '1',
    '1': '1',
    'M1': '1',
    '5m': '5',
    '5': '5',
    'M5': '5',
    '15m': '15',
    '15': '15',
    'M15': '15',
    '30m': '30',
    '30': '30',
    'M30': '30',
    '1h': '60',
    '1H': '60',
    '60': '60',
    'H1': '60',
    '2h': '120',
    '2H': '120',
    '120': '120',
    '4h': '240',
    '4H': '240',
    '240': '240',
    'H4': '240',
    '1d': '1D',
    '1D': '1D',
    'D': '1D',
    'D1': '1D',
    '1w': '1W',
    '1W': '1W',
    'W': '1W',
    '1M': '1M',
    'M': '1M',
};

/** Hard ceiling of bars per request, regardless of plan. */
const MAX_BARS_PER_REQUEST = 5000;

export interface CandleQuery {
    /** Bars requested (already clamped to the user's plan by the controller). */
    range: number;
    /** Last bar timestamp (ms). Defaults to now. */
    toTs?: number;
    /** Bars older than this (ms) are dropped: enforces the plan's history window. */
    earliestTs?: number;
}

export interface CandleResponse {
    candles: any[];
    /** Always a real market source: this service never fabricates prices. */
    source: 'tradingview' | 'mt5' | 'yahoo' | 'binance';
    tvSymbol: string;
    timeframe: string;
}

export interface CandleBatchResponse extends CandleResponse {
    chunkSize: number;
    chunkIndex: number;
    estimatedTotalChunks: number;
    earliestLoadedTs: number | null;
    latestLoadedTs: number | null;
    nextCursorTo: number | null;
    hasMore: boolean;
    fromCache: boolean;
}

@Injectable()
export class TradingViewService {
    private readonly logger = new Logger(TradingViewService.name);
    private readonly mt5MemoryStore = new Map<string, any[]>();
    private readonly inFlightCandles = new Map<string, Promise<CandleResponse>>();
    private readonly lastParquetMirrorAt = new Map<string, number>();

    constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) { }

    private setLastParquetMirrorAt(throttleKey: string, now: number): void {
        const MAX_THROTTLE_KEYS = 200;
        for (const [k, ts] of this.lastParquetMirrorAt.entries()) {
            if (now - ts > 120_000) {
                this.lastParquetMirrorAt.delete(k);
            }
        }
        if (this.lastParquetMirrorAt.has(throttleKey)) {
            this.lastParquetMirrorAt.delete(throttleKey);
        }
        while (this.lastParquetMirrorAt.size >= MAX_THROTTLE_KEYS) {
            const oldest = this.lastParquetMirrorAt.keys().next().value;
            if (oldest === undefined) break;
            this.lastParquetMirrorAt.delete(oldest);
        }
        this.lastParquetMirrorAt.set(throttleKey, now);
    }

    private setMt5MemoryCandles(storeKey: string, candles: any[]): void {
        const MAX_MEM_SERIES = 24;
        if (this.mt5MemoryStore.has(storeKey)) {
            this.mt5MemoryStore.delete(storeKey);
        }
        while (this.mt5MemoryStore.size >= MAX_MEM_SERIES) {
            const oldest = this.mt5MemoryStore.keys().next().value;
            if (oldest === undefined) break;
            this.mt5MemoryStore.delete(oldest);
        }
        this.mt5MemoryStore.set(storeKey, candles);
    }

    private mirrorCandlesToQuantParquet(symbol: string, timeframe: string, candles: any[]): void {
        if (!Array.isArray(candles) || candles.length < 20) return;
        const baseSym = this.normalizeBaseSymbol(symbol);
        const tfKey = (timeframe || '15m').toLowerCase();
        const throttleKey = `${baseSym}:${tfKey}`;
        const now = Date.now();
        if (now - (this.lastParquetMirrorAt.get(throttleKey) || 0) < 45_000) return;
        this.setLastParquetMirrorAt(throttleKey, now);

        const quantUrl = (process.env.QUANT_ENGINE_URL || 'http://127.0.0.1:8001').trim().replace(/\/$/, '');
        const payload = {
            symbol: baseSym,
            timeframe: tfKey,
            sourcePreference: 'MT5_TV',
            candles: candles
                .filter((c) => Number(c?.timestamp) > 0 && Number(c?.open) > 0 && Number(c?.high) > 0 && Number(c?.low) > 0 && Number(c?.close) > 0)
                .map((c) => ({
                    timestamp: Number(c.timestamp),
                    open: Number(c.open),
                    high: Number(c.high),
                    low: Number(c.low),
                    close: Number(c.close),
                    volume: Math.max(0, Number(c.volume || 0)),
                })),
        };
        if (payload.candles.length < 20) return;

        void fetch(`${quantUrl}/api/quant/market-data/sync`, {
            method: 'POST',
            headers: getQuantInternalHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(5000),
        }).catch(() => {});
    }

    private normalizeBaseSymbol(symbol: string): string {
        const clean = (symbol || 'XAUUSD').trim().toUpperCase().replace(/^.*:/, '').replace(/[^A-Z0-9]/g, '');
        if (clean.startsWith('XAUUSD') || clean.startsWith('GOLD')) return 'XAUUSD';
        if (clean.startsWith('XAGUSD') || clean.startsWith('SILVER')) return 'XAGUSD';
        if (clean.startsWith('EURUSD')) return 'EURUSD';
        if (clean.startsWith('GBPUSD')) return 'GBPUSD';
        if (clean.startsWith('USDJPY')) return 'USDJPY';
        if (clean.startsWith('AUDUSD')) return 'AUDUSD';
        if (clean.startsWith('USDCAD')) return 'USDCAD';
        if (clean.startsWith('USDCHF')) return 'USDCHF';
        if (clean.startsWith('NZDUSD')) return 'NZDUSD';
        if (clean.startsWith('EURGBP')) return 'EURGBP';
        if (clean.startsWith('EURJPY')) return 'EURJPY';
        if (clean.startsWith('GBPJPY')) return 'GBPJPY';
        if (clean.startsWith('BTCUSD')) return 'BTCUSD';
        if (clean.startsWith('ETHUSD')) return 'ETHUSD';
        if (clean.startsWith('SOLUSD')) return 'SOLUSD';
        if (clean.startsWith('NAS100') || clean.startsWith('US100') || clean.startsWith('USTEC')) return 'NAS100';
        if (clean.startsWith('US30') || clean.startsWith('DJ30')) return 'US30';
        if (clean.startsWith('SPX500') || clean.startsWith('US500')) return 'SPX500';
        if (clean.startsWith('GER40') || clean.startsWith('DE30') || clean.startsWith('DE40')) return 'GER40';
        if (clean.startsWith('UK100')) return 'UK100';
        if (clean.startsWith('USOIL') || clean.startsWith('WTI') || clean.startsWith('XTIUSD')) return 'USOIL';
        if (/^(USD|EUR|GBP|JPY|AUD|CAD|CHF|NZD){2}[A-Z0-9]{0,5}$/.test(clean)) return clean.slice(0, 6);
        return clean || 'XAUUSD';
    }

    /**
     * Ingests OHLCV candle batches extracted from MetaTrader 5 (Demo Feed or Trade Sync)
     * into Redis + in-memory store for instant backtest & replay serving.
     */
    async ingestMt5CandleBatch(
        symbol: string,
        timeframe: string,
        rawCandles: Array<{
            timestamp?: number;
            time?: number;
            open: number;
            high: number;
            low: number;
            close: number;
            volume?: number;
        }>,
    ): Promise<{ symbol: string; timeframe: string; stored: number }> {
        const baseSym = this.normalizeBaseSymbol(symbol);
        const tvTimeframe = this.normalizeTimeframe(timeframe);
        const storeKey = `mt5_candles:${baseSym}:${tvTimeframe}`;

        const incoming = (rawCandles || [])
            .map((c) => {
                const rawTs = Number(c.timestamp ?? c.time ?? 0);
                const timestamp = rawTs > 0 && rawTs < 1e11 ? rawTs * 1000 : rawTs;
                return {
                    timestamp,
                    open: Number(c.open),
                    high: Number(c.high),
                    low: Number(c.low),
                    close: Number(c.close),
                    volume: Number(c.volume || 0),
                };
            })
            .filter((c) => c.timestamp > 0 && Number.isFinite(c.open) && Number.isFinite(c.close));

        if (incoming.length === 0) {
            return { symbol: baseSym, timeframe: tvTimeframe, stored: 0 };
        }

        let existing = this.mt5MemoryStore.get(storeKey) || [];
        if (existing.length === 0) {
            const fromRedis = await this.cacheManager.get<any[]>(storeKey);
            if (Array.isArray(fromRedis)) existing = fromRedis;
        }

        const byTs = new Map<number, any>();
        for (const bar of existing) byTs.set(bar.timestamp, bar);
        for (const bar of incoming) byTs.set(bar.timestamp, bar);

        const merged = Array.from(byTs.values())
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(-15000);

        this.setMt5MemoryCandles(storeKey, merged);
        await this.cacheManager.set(storeKey, merged, 86_400_000); // 24h in Redis

        this.logger.log(`[MT5-FEED] Lote OHLCV armazenado: ${baseSym} (${tvTimeframe}) -> +${incoming.length} velas (Total em cache: ${merged.length})`);
        return { symbol: baseSym, timeframe: tvTimeframe, stored: merged.length };
    }

    async getMt5CachedCandles(symbol: string, timeframe: string): Promise<any[]> {
        const baseSym = this.normalizeBaseSymbol(symbol);
        const tvTimeframe = this.normalizeTimeframe(timeframe);
        const storeKey = `mt5_candles:${baseSym}:${tvTimeframe}`;
        const mem = this.mt5MemoryStore.get(storeKey);
        if (mem && mem.length > 0) return mem;
        const redis = await this.cacheManager.get<any[]>(storeKey);
        if (Array.isArray(redis) && redis.length > 0) {
            this.setMt5MemoryCandles(storeKey, redis);
            return redis;
        }
        return [];
    }

    private normalizeSymbol(symbol: string): string {
        if (!symbol) return 'OANDA:EURUSD';
        const clean = symbol.trim().toUpperCase();
        const base = this.normalizeBaseSymbol(clean);
        if (!clean.includes(':')) {
            return DEFAULT_SYMBOL_MAP[base] || DEFAULT_SYMBOL_MAP[clean] || `OANDA:${clean}`;
        }
        const [exchange, rawTicker] = clean.split(':');
        // Remap frontend generic aliases (e.g. BINANCE:BTCUSD -> BINANCE:BTCUSDT, OANDA:NAS100 -> OANDA:NAS100USD, FX:EURUSD -> OANDA:EURUSD)
        if (
            DEFAULT_SYMBOL_MAP[base] &&
            ((exchange === 'BINANCE' && !rawTicker.endsWith('USDT')) ||
                (exchange === 'OANDA' && ['NAS100', 'US30', 'SPX500', 'GER40', 'UK100', 'USOIL'].includes(rawTicker)) ||
                exchange === 'FX' ||
                exchange === 'TV' ||
                exchange === 'CFD' ||
                exchange === 'INDEX')
        ) {
            return DEFAULT_SYMBOL_MAP[base];
        }
        return clean;
    }

    private normalizeTimeframe(tf: string): string {
        if (!tf) return '60';
        return TIMEFRAME_MAP[tf] || TIMEFRAME_MAP[tf.toUpperCase()] || '60';
    }

    public getIntervalMs(tf: string): number {
        const norm = this.normalizeTimeframe(tf);
        switch (norm) {
            case '1': return 60 * 1000;
            case '5': return 5 * 60 * 1000;
            case '15': return 15 * 60 * 1000;
            case '30': return 30 * 60 * 1000;
            case '60': return 60 * 60 * 1000;
            case '120': return 2 * 60 * 60 * 1000;
            case '240': return 4 * 60 * 60 * 1000;
            case '1D': return 24 * 60 * 60 * 1000;
            case '1W': return 7 * 24 * 60 * 60 * 1000;
            case '1M': return 30 * 24 * 60 * 60 * 1000;
            default: return 60 * 60 * 1000;
        }
    }

    async searchSymbols(query: string = '', type: string = '', exchange: string = '') {
        const cacheKey = `tv_search:${query}:${type}:${exchange}`;
        const cached = await this.cacheManager.get(cacheKey);
        if (cached) return cached;

        try {
            const results = await TradingView.search(query, type, exchange);
            await this.cacheManager.set(cacheKey, results, 3_600_000); // 1h (ms)
            return results;
        } catch (error) {
            this.logger.warn(`Fallback symbol search for "${query}": ${error.message}`);
            const defaultList = [
                { id: 'OANDA:XAUUSD', symbol: 'XAUUSD', description: 'Gold / US Dollar', exchange: 'OANDA', type: 'cfd' },
                { id: 'OANDA:EURUSD', symbol: 'EURUSD', description: 'Euro / US Dollar', exchange: 'OANDA', type: 'forex' },
                { id: 'OANDA:GBPUSD', symbol: 'GBPUSD', description: 'British Pound / US Dollar', exchange: 'OANDA', type: 'forex' },
                { id: 'OANDA:USDJPY', symbol: 'USDJPY', description: 'US Dollar / Japanese Yen', exchange: 'OANDA', type: 'forex' },
                { id: 'BINANCE:BTCUSDT', symbol: 'BTCUSD', description: 'Bitcoin / US Dollar', exchange: 'BINANCE', type: 'crypto' },
                { id: 'BINANCE:ETHUSDT', symbol: 'ETHUSD', description: 'Ethereum / US Dollar', exchange: 'BINANCE', type: 'crypto' },
                { id: 'OANDA:NAS100USD', symbol: 'NAS100', description: 'US Nasdaq 100 Index', exchange: 'OANDA', type: 'index' },
                { id: 'OANDA:US30USD', symbol: 'US30', description: 'US Wall St 30 Index', exchange: 'OANDA', type: 'index' },
                { id: 'OANDA:SPX500USD', symbol: 'SPX500', description: 'US S&P 500 Index', exchange: 'OANDA', type: 'index' },
            ];
            const q = (query || '').toUpperCase();
            return q ? defaultList.filter(s => s.symbol.includes(q) || s.description.toUpperCase().includes(q)) : defaultList;
        }
    }

    private async fetchPublicHttpFallbackCandles(
        symbol: string,
        timeframe: string,
        range: number,
        toTs: number,
        earliestTs?: number,
    ): Promise<{ candles: any[]; source: 'yahoo' | 'binance' }> {
        const base = this.normalizeBaseSymbol(symbol);
        const tvTf = this.normalizeTimeframe(timeframe);
        const headers = { 'User-Agent': 'Mozilla/5.0' };
        const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
            ? AbortSignal.timeout(6000)
            : undefined;

        const CRYPTO_PAIR_MAP: Record<string, string> = {
            BTCUSD: 'BTCUSDT',
            ETHUSD: 'ETHUSDT',
            SOLUSD: 'SOLUSDT',
        };
        const BINANCE_INTERVAL_MAP: Record<string, string> = {
            '1': '1m',
            '5': '5m',
            '15': '15m',
            '30': '30m',
            '60': '1h',
            '120': '2h',
            '240': '4h',
            '1D': '1d',
            '1W': '1w',
            '1M': '1M',
        };

        const binancePair = CRYPTO_PAIR_MAP[base] || (base.endsWith('USDT') ? base : null);
        if (binancePair) {
            try {
                const bInterval = BINANCE_INTERVAL_MAP[tvTf] || '1h';
                const limit = Math.min(range, 1000);
                const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(binancePair)}&interval=${encodeURIComponent(bInterval)}&endTime=${Math.floor(toTs)}&limit=${limit}`;
                const res = await fetch(url, { headers, signal });
                if (res.ok) {
                    const raw: any = await res.json();
                    if (Array.isArray(raw)) {
                        const candles = raw
                            .map((k: any[]) => ({
                                timestamp: Number(k[0]),
                                open: Number(k[1]),
                                high: Number(k[2]),
                                low: Number(k[3]),
                                close: Number(k[4]),
                                volume: Number(k[5] || 0),
                            }))
                            .filter(
                                (c) =>
                                    Number.isFinite(c.timestamp) &&
                                    c.timestamp > 0 &&
                                    Number.isFinite(c.open) &&
                                    Number.isFinite(c.high) &&
                                    Number.isFinite(c.low) &&
                                    Number.isFinite(c.close) &&
                                    c.timestamp <= toTs &&
                                    (!earliestTs || c.timestamp >= earliestTs),
                            )
                            .sort((a, b) => a.timestamp - b.timestamp);

                        if (candles.length > 0) {
                            return { candles, source: 'binance' };
                        }
                    }
                }
            } catch (err: any) {
                this.logger.debug(`Binance public klines fallback failed for ${binancePair}: ${err?.message || err}`);
            }
        }

        const YAHOO_TICKER_MAP: Record<string, string> = {
            XAUUSD: 'GC=F',
            XAGUSD: 'SI=F',
            USOIL: 'CL=F',
            NAS100: '^NDX',
            US30: '^DJI',
            SPX500: '^GSPC',
            GER40: '^GDAXI',
            UK100: '^FTSE',
            BTCUSD: 'BTC-USD',
            ETHUSD: 'ETH-USD',
            SOLUSD: 'SOL-USD',
        };
        const yahooTicker = YAHOO_TICKER_MAP[base] || (/^[A-Z]{6}$/.test(base) ? `${base}=X` : null);
        if (!yahooTicker) {
            return { candles: [], source: 'yahoo' };
        }

        const YAHOO_TF_CONFIG: Record<string, { yInterval: string; maxDays: number; aggBars: number }> = {
            '1': { yInterval: '1m', maxDays: 6, aggBars: 1 },
            '5': { yInterval: '5m', maxDays: 58, aggBars: 1 },
            '15': { yInterval: '15m', maxDays: 58, aggBars: 1 },
            '30': { yInterval: '30m', maxDays: 58, aggBars: 1 },
            '60': { yInterval: '60m', maxDays: 720, aggBars: 1 },
            '120': { yInterval: '60m', maxDays: 720, aggBars: 2 },
            '240': { yInterval: '60m', maxDays: 720, aggBars: 4 },
            '1D': { yInterval: '1d', maxDays: 3650, aggBars: 1 },
            '1W': { yInterval: '1wk', maxDays: 3650, aggBars: 1 },
            '1M': { yInterval: '1mo', maxDays: 3650, aggBars: 1 },
        };

        const { yInterval, maxDays, aggBars } = YAHOO_TF_CONFIG[tvTf] || { yInterval: '60m', maxDays: 720, aggBars: 1 };
        const intervalMs = this.getIntervalMs(tvTf);
        const nowSec = Math.floor(Date.now() / 1000);
        const minAllowedSec = nowSec - maxDays * 86400;
        const period2 = Math.floor(toTs / 1000);

        if (period2 <= minAllowedSec + 60) {
            return { candles: [], source: 'yahoo' };
        }

        const minPaddingSec = intervalMs <= 3_600_000 ? 4 * 86400 : 3600;
        const spanSec = Math.max(minPaddingSec, Math.ceil((range * aggBars * intervalMs * 1.8) / 1000));
        const period1 = Math.max(minAllowedSec, period2 - spanSec);

        try {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?period1=${period1}&period2=${period2}&interval=${encodeURIComponent(yInterval)}&includePrePost=false`;
            const res = await fetch(url, { headers, signal });
            if (!res.ok) {
                return { candles: [], source: 'yahoo' };
            }

            const data: any = await res.json();
            const result = data?.chart?.result?.[0];
            const rawTsList: any[] = Array.isArray(result?.timestamp) ? result.timestamp : [];
            const quote = result?.indicators?.quote?.[0] || {};
            const opens: any[] = Array.isArray(quote.open) ? quote.open : [];
            const highs: any[] = Array.isArray(quote.high) ? quote.high : [];
            const lows: any[] = Array.isArray(quote.low) ? quote.low : [];
            const closes: any[] = Array.isArray(quote.close) ? quote.close : [];
            const volumes: any[] = Array.isArray(quote.volume) ? quote.volume : [];

            let bars = rawTsList
                .map((sec, idx) => ({
                    timestamp: Number(sec) * 1000,
                    open: Number(opens[idx]),
                    high: Number(highs[idx]),
                    low: Number(lows[idx]),
                    close: Number(closes[idx]),
                    volume: Number(volumes[idx] || 0),
                }))
                .filter(
                    (c) =>
                        Number.isFinite(c.timestamp) &&
                        c.timestamp > 0 &&
                        Number.isFinite(c.open) &&
                        Number.isFinite(c.high) &&
                        Number.isFinite(c.low) &&
                        Number.isFinite(c.close) &&
                        c.open > 0 &&
                        c.close > 0,
                )
                .sort((a, b) => a.timestamp - b.timestamp);

            if (aggBars > 1 && bars.length > 0) {
                const buckets = new Map<number, any>();
                for (const bar of bars) {
                    const bucketTs = Math.floor(bar.timestamp / intervalMs) * intervalMs;
                    const existing = buckets.get(bucketTs);
                    if (!existing) {
                        buckets.set(bucketTs, { ...bar, timestamp: bucketTs });
                    } else {
                        existing.high = Math.max(existing.high, bar.high);
                        existing.low = Math.min(existing.low, bar.low);
                        existing.close = bar.close;
                        existing.volume += bar.volume;
                    }
                }
                bars = Array.from(buckets.values()).sort((a, b) => a.timestamp - b.timestamp);
            }

            const candles = bars
                .filter((c) => c.timestamp <= toTs && (!earliestTs || c.timestamp >= earliestTs))
                .slice(-range);

            return { candles, source: 'yahoo' };
        } catch (err: any) {
            this.logger.debug(`Yahoo fallback failed for ${yahooTicker}: ${err?.message || err}`);
            return { candles: [], source: 'yahoo' };
        }
    }

    /**
     * Real candles prioritized from synced MT5 cache, then TradingView WebSocket,
     * with keyless public HTTP fallback (Binance / Yahoo Finance). Throws only when all real feeds fail.
     */
    async getCandles(symbol: string, timeframe: string = '1H', query: CandleQuery): Promise<CandleResponse> {
        const tvSymbol = this.normalizeSymbol(symbol);
        const tvTimeframe = this.normalizeTimeframe(timeframe);
        const intervalMs = this.getIntervalMs(timeframe);
        const range = Math.min(Math.max(Math.floor(query.range) || 300, 50), MAX_BARS_PER_REQUEST);
        const now = Date.now();
        const toTs = query.toTs && query.toTs > 1e12 ? Math.min(query.toTs, now) : now;
        // Bucket `to` to the bar interval so near-identical requests share a cache entry.
        const toBucket = Math.floor(toTs / intervalMs) * intervalMs;
        const cacheKey = `tv_candles:${tvSymbol}:${tvTimeframe}:${range}:${toBucket}:${query.earliestTs ?? 0}`;

        const cached = await this.cacheManager.get<CandleResponse>(cacheKey);
        if (cached?.candles?.length) return cached;

        const existingFlight = this.inFlightCandles.get(cacheKey);
        if (existingFlight) return existingFlight;

        const flightPromise = (async (): Promise<CandleResponse> => {
            // 1. Prioritize MT5 synced/ingested candles when sufficient bars exist in the requested window
            const mt5Bars = await this.getMt5CachedCandles(symbol, timeframe);
            const mt5InWindow = mt5Bars
                .filter((c) => c.timestamp <= toTs && (!query.earliestTs || c.timestamp >= query.earliestTs))
                .sort((a, b) => a.timestamp - b.timestamp);

            if (mt5InWindow.length >= Math.min(30, Math.floor(range * 0.25))) {
                const mt5Result: CandleResponse = {
                    candles: mt5InWindow.slice(-range),
                    source: 'mt5',
                    tvSymbol,
                    timeframe: tvTimeframe,
                };
                await this.cacheManager.set(cacheKey, mt5Result, 60_000);
                return mt5Result;
            }

            try {
                const raw = await new Promise<any[]>((resolve, reject) => {
                    let settled = false;
                    const client = new TradingView.Client();
                    const chart = new client.Session.Chart();
                    const finish = (fn: () => void) => {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timer);
                        try { client.end(); } catch (_) {}
                        fn();
                    };

                    const timer = setTimeout(() => finish(() => reject(new Error('TradingView WebSocket timeout'))), 5000);

                    chart.setMarket(tvSymbol, {
                        timeframe: tvTimeframe as any,
                        range,
                        // Library expects seconds; omit when "now" so the live edge is returned.
                        ...(toTs < now - intervalMs ? { to: Math.floor(toTs / 1000) } : {}),
                    });

                    chart.onUpdate(() => {
                        if (!chart.periods || chart.periods.length === 0) return;
                        const periods = [...chart.periods];
                        finish(() => resolve(periods));
                    });

                    chart.onError((...err: any[]) => finish(() => reject(new Error(err.map(String).join(' ') || 'TradingView error'))));
                });

                const candles = raw
                    .map(p => ({
                        timestamp: p.time * 1000,
                        open: Number(p.open),
                        high: Number(p.max),
                        low: Number(p.min),
                        close: Number(p.close),
                        volume: Number(p.volume || 0),
                    }))
                    .filter(c => Number.isFinite(c.open) && Number.isFinite(c.close))
                    .filter(c => !query.earliestTs || c.timestamp >= query.earliestTs)
                    .sort((a, b) => a.timestamp - b.timestamp);

                if (candles.length === 0) {
                    throw new Error(`TradingView returned no bars for ${tvSymbol} (${tvTimeframe}) in the allowed window`);
                }

                this.mirrorCandlesToQuantParquet(symbol, timeframe, candles);
                const result: CandleResponse = { candles, source: 'tradingview', tvSymbol, timeframe: tvTimeframe };
                // cache-manager v7 TTL is in milliseconds.
                await this.cacheManager.set(cacheKey, result, 60_000);
                return result;
            } catch (tvError: any) {
                if (mt5InWindow.length > 0) {
                    const slicedMt5 = mt5InWindow.slice(-range);
                    this.mirrorCandlesToQuantParquet(symbol, timeframe, slicedMt5);
                    const partialMt5Result: CandleResponse = {
                        candles: slicedMt5,
                        source: 'mt5',
                        tvSymbol,
                        timeframe: tvTimeframe,
                    };
                    await this.cacheManager.set(cacheKey, partialMt5Result, 60_000);
                    return partialMt5Result;
                }

                const fallback = await this.fetchPublicHttpFallbackCandles(symbol, tvTimeframe, range, toTs, query.earliestTs);
                if (fallback.candles.length > 0) {
                    this.logger.warn(
                        `TradingView unavailable for ${tvSymbol} (${tvError?.message || tvError}); served ${fallback.candles.length} bars via ${fallback.source} HTTP fallback`,
                    );
                    this.mirrorCandlesToQuantParquet(symbol, timeframe, fallback.candles);
                    const fallbackResult: CandleResponse = {
                        candles: fallback.candles,
                        source: fallback.source,
                        tvSymbol,
                        timeframe: tvTimeframe,
                    };
                    await this.cacheManager.set(cacheKey, fallbackResult, 60_000);
                    return fallbackResult;
                }

                throw tvError;
            }
        })();

        this.inFlightCandles.set(cacheKey, flightPromise);
        try {
            return await flightPromise;
        } finally {
            this.inFlightCandles.delete(cacheKey);
        }
    }

    /**
     * Fetches a 500-candle historical batch (chunk) anchored at `cursorTo` (or `toTs`)
     * down to `fromTs` (bounded by `earliestTs`), with server-side chunk caching (10 min TTL)
     * and pagination cursor (`nextCursorTo`, `hasMore`) so the client can pre-fetch or lazy-load batches.
     */
    async getCandlesBatch(
        symbol: string,
        timeframe: string = '15m',
        options: {
            chunkSize?: number;
            chunkIndex?: number;
            cursorTo?: number;
            fromTs?: number;
            toTs?: number;
            earliestTs?: number;
        },
    ): Promise<CandleBatchResponse> {
        const tvSymbol = this.normalizeSymbol(symbol);
        const tvTimeframe = this.normalizeTimeframe(timeframe);
        const intervalMs = this.getIntervalMs(timeframe);
        const chunkSize = Math.min(Math.max(Math.floor(options.chunkSize || 500), 100), 1500);
        const chunkIndex = Math.max(0, Math.floor(options.chunkIndex || 0));
        const now = Date.now();
        const effectiveTo = options.cursorTo && options.cursorTo > 1e11
            ? Math.min(options.cursorTo, now)
            : (options.toTs && options.toTs > 1e11 ? Math.min(options.toTs, now) : now);
        const effectiveFrom = options.fromTs && options.fromTs > 1e11
            ? Math.max(options.fromTs, options.earliestTs || 0)
            : (options.earliestTs || effectiveTo - chunkSize * intervalMs * 4);

        const toBucket = Math.floor(effectiveTo / intervalMs) * intervalMs;
        const batchCacheKey = `tv_batch:${tvSymbol}:${tvTimeframe}:${chunkSize}:${toBucket}:${options.earliestTs || 0}`;

        const cachedBatch = await this.cacheManager.get<CandleResponse>(batchCacheKey);
        let candles: any[] = [];
        let fromCache = false;
        let dataSource: CandleResponse['source'] = 'tradingview';

        // 1. Check MT5 Demo / Synced Candle Store first (only when it actually covers near `effectiveTo`)
        const mt5Bars = await this.getMt5CachedCandles(symbol, timeframe);
        const mt5InWindow = mt5Bars.filter(
            (c) => c.timestamp <= effectiveTo && (!options.earliestTs || c.timestamp >= options.earliestTs),
        );
        const latestMt5Ts = mt5InWindow.length > 0 ? mt5InWindow[mt5InWindow.length - 1].timestamp : 0;
        const mt5CoversTargetEnd =
            mt5InWindow.length >= Math.min(50, chunkSize * 0.25) &&
            latestMt5Ts >= effectiveTo - Math.max(intervalMs * 96, 4 * 24 * 60 * 60 * 1000);

        if (mt5CoversTargetEnd) {
            candles = mt5InWindow.slice(-chunkSize);
            fromCache = true;
            dataSource = 'mt5';
        } else if (cachedBatch?.candles?.length) {
            candles = cachedBatch.candles;
            fromCache = true;
            dataSource = cachedBatch.source || 'tradingview';
        } else {
            try {
                const fetched = await this.getCandles(symbol, timeframe, {
                    range: chunkSize,
                    toTs: effectiveTo,
                    earliestTs: options.earliestTs,
                });
                // Merge any MT5 bars we have with the fetched bars
                if (mt5InWindow.length > 0) {
                    const mergedMap = new Map<number, any>();
                    for (const b of fetched.candles) mergedMap.set(b.timestamp, b);
                    for (const b of mt5InWindow) mergedMap.set(b.timestamp, b);
                    candles = Array.from(mergedMap.values()).sort((a, b) => a.timestamp - b.timestamp);
                    dataSource = 'mt5';
                } else {
                    candles = fetched.candles;
                    dataSource = fetched.source || 'tradingview';
                }
                // Historical batches are immutable once closed; cache for 10 minutes
                await this.cacheManager.set(batchCacheKey, { ...fetched, candles, source: dataSource }, 600_000);
            } catch (err) {
                if (mt5InWindow.length > 0) {
                    candles = mt5InWindow.slice(-chunkSize);
                    fromCache = true;
                    dataSource = 'mt5';
                } else {
                    throw err;
                }
            }
        }

        const filtered = candles
            .filter(c => c.timestamp <= effectiveTo && (!options.earliestTs || c.timestamp >= options.earliestTs))
            .sort((a, b) => a.timestamp - b.timestamp);

        if (filtered.length >= 20 && (!fromCache || dataSource === 'mt5')) {
            this.mirrorCandlesToQuantParquet(symbol, timeframe, filtered);
        }

        const earliestLoadedTs = filtered.length > 0 ? filtered[0].timestamp : null;
        const latestLoadedTs = filtered.length > 0 ? filtered[filtered.length - 1].timestamp : null;
        const nextCursorTo = earliestLoadedTs ? earliestLoadedTs - intervalMs : null;
        const hasMore = Boolean(
            earliestLoadedTs &&
            nextCursorTo &&
            nextCursorTo > effectiveFrom &&
            (!options.earliestTs || nextCursorTo > options.earliestTs) &&
            filtered.length >= Math.min(50, chunkSize * 0.4),
        );

        const spanMs = Math.max(intervalMs * chunkSize, effectiveTo - effectiveFrom);
        const estimatedTotalChunks = Math.max(1, Math.min(20, Math.ceil(spanMs / (chunkSize * intervalMs))));

        return {
            candles: filtered,
            source: dataSource,
            tvSymbol,
            timeframe: tvTimeframe,
            chunkSize,
            chunkIndex,
            estimatedTotalChunks,
            earliestLoadedTs,
            latestLoadedTs,
            nextCursorTo: hasMore ? nextCursorTo : null,
            hasMore,
            fromCache,
        };
    }

    async getQuote(symbol: string) {
        const tvSymbol = this.normalizeSymbol(symbol);
        const cacheKey = `tv_quote:${tvSymbol}`;
        const cached = await this.cacheManager.get(cacheKey);
        if (cached) return cached;

        return new Promise((resolve, reject) => {
            let settled = false;
            const client = new TradingView.Client();
            const session = new client.Session.Quote({
                fields: 'lp',
            });

            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    try { client.end(); } catch (_) {}
                    reject(new Error('Quote timeout'));
                }
            }, 5000);

            session.setMarket(tvSymbol);

            session.onQuote((data) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                this.cacheManager.set(cacheKey, data, 10000);
                try { client.end(); } catch (_) {}
                resolve(data);
            });

            session.onError((err) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                try { client.end(); } catch (_) {}
                reject(err);
            });
        });
    }
}
