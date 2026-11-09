import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import * as TradingViewPkg from '@mathieuc/tradingview';

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
    source: 'tradingview';
    tvSymbol: string;
    timeframe: string;
}

@Injectable()
export class TradingViewService {
    private readonly logger = new Logger(TradingViewService.name);

    constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) { }

    private normalizeSymbol(symbol: string): string {
        if (!symbol) return 'OANDA:EURUSD';
        const clean = symbol.trim().toUpperCase();
        if (clean.includes(':')) return clean;
        return DEFAULT_SYMBOL_MAP[clean] || `OANDA:${clean}`;
    }

    private normalizeTimeframe(tf: string): string {
        if (!tf) return '60';
        return TIMEFRAME_MAP[tf] || TIMEFRAME_MAP[tf.toUpperCase()] || '60';
    }

    private getIntervalMs(tf: string): number {
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

    /**
     * Real candles from TradingView. Throws when the feed is unavailable:
     * the caller must surface the outage instead of receiving made-up prices.
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

            const timer = setTimeout(() => finish(() => reject(new Error('TradingView WebSocket timeout'))), 8000);

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

        const result: CandleResponse = { candles, source: 'tradingview', tvSymbol, timeframe: tvTimeframe };
        // cache-manager v7 TTL is in milliseconds.
        await this.cacheManager.set(cacheKey, result, 60_000);
        return result;
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
