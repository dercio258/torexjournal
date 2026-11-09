import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import TradingView from '@mathieuc/tradingview';

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

const BASE_PRICES: Record<string, { price: number; volatility: number }> = {
    XAUUSD: { price: 2650.0, volatility: 3.5 },
    EURUSD: { price: 1.0845, volatility: 0.0012 },
    GBPUSD: { price: 1.2940, volatility: 0.0015 },
    USDJPY: { price: 152.30, volatility: 0.22 },
    BTCUSD: { price: 72400.0, volatility: 240.0 },
    ETHUSD: { price: 2680.0, volatility: 18.0 },
    US30: { price: 42350.0, volatility: 65.0 },
    NAS100: { price: 20280.0, volatility: 45.0 },
    SPX500: { price: 5820.0, volatility: 12.0 },
};

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
            await this.cacheManager.set(cacheKey, results, 3600);
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

    async getCandles(symbol: string, timeframe: string = '1H', range: number = 300, fromTs?: number, toTs?: number) {
        const tvSymbol = this.normalizeSymbol(symbol);
        const tvTimeframe = this.normalizeTimeframe(timeframe);
        const cacheKey = `tv_candles:${tvSymbol}:${tvTimeframe}:${range}`;
        const cached = await this.cacheManager.get<any[]>(cacheKey);
        if (cached && cached.length > 0) {
            return cached;
        }

        try {
            const candles = await new Promise<any[]>((resolve, reject) => {
                let settled = false;
                const client = new TradingView.Client();
                const chart = new client.Session.Chart();

                const timer = setTimeout(() => {
                    if (!settled) {
                        settled = true;
                        try { client.end(); } catch (_) {}
                        reject(new Error('TradingView WebSocket timeout'));
                    }
                }, 6500);

                chart.setMarket(tvSymbol, {
                    timeframe: tvTimeframe,
                    range: Math.min(Math.max(range, 50), 1000),
                });

                chart.onUpdate(() => {
                    if (settled || !chart.periods || chart.periods.length === 0) return;
                    settled = true;
                    clearTimeout(timer);

                    const sorted = [...chart.periods]
                        .sort((a, b) => a.time - b.time)
                        .map(p => ({
                            timestamp: p.time * 1000,
                            time: p.time,
                            open: Number(p.open),
                            high: Number(p.max),
                            low: Number(p.min),
                            close: Number(p.close),
                            volume: Number(p.volume || 0),
                            turnover: Number((p.close * (p.volume || 1)).toFixed(2)),
                        }));

                    try { client.end(); } catch (_) {}
                    resolve(sorted);
                });

                chart.onError((err) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    try { client.end(); } catch (_) {}
                    reject(err);
                });
            });

            if (candles && candles.length > 0) {
                await this.cacheManager.set(cacheKey, candles, 60000);
                return candles;
            }
        } catch (error) {
            this.logger.warn(`TradingView live fetch failed for ${tvSymbol} (${tvTimeframe}), using deterministic fallback: ${error.message}`);
        }

        return this.generateFallbackCandles(symbol, timeframe, range, toTs);
    }

    private generateFallbackCandles(symbol: string, timeframe: string, count: number = 300, toTs?: number) {
        const cleanSym = (symbol || 'EURUSD').replace(/^.*:/, '').toUpperCase();
        const cfg = BASE_PRICES[cleanSym] || { price: 100.0, volatility: 0.8 };
        const intervalMs = this.getIntervalMs(timeframe);
        const endTimestamp = toTs && toTs > 1000000000000 ? toTs : Date.now();
        const alignedEnd = Math.floor(endTimestamp / intervalMs) * intervalMs;

        const candles: any[] = [];
        let currentPrice = cfg.price;
        let seed = cleanSym.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) + intervalMs;

        const pseudoRandom = () => {
            seed = (seed * 1664525 + 1013904223) % 4294967296;
            return seed / 4294967296;
        };

        const decimals = cfg.price < 10 ? 5 : 2;

        for (let i = count; i >= 0; i--) {
            const ts = alignedEnd - i * intervalMs;
            const wave = Math.sin(i / 14) * (cfg.volatility * 0.35);
            const delta = (pseudoRandom() - 0.495) * cfg.volatility + wave * 0.15;
            const open = currentPrice;
            const close = Math.max(cfg.price * 0.2, open + delta);
            const wickUp = pseudoRandom() * cfg.volatility * 0.75;
            const wickDown = pseudoRandom() * cfg.volatility * 0.75;
            const high = Math.max(open, close) + wickUp;
            const low = Math.min(open, close) - wickDown;
            const volume = Math.round(150 + pseudoRandom() * 1400);

            candles.push({
                timestamp: ts,
                time: Math.floor(ts / 1000),
                open: Number(open.toFixed(decimals)),
                high: Number(high.toFixed(decimals)),
                low: Number(low.toFixed(decimals)),
                close: Number(close.toFixed(decimals)),
                volume,
                turnover: Number((close * volume).toFixed(2)),
            });

            currentPrice = close;
        }

        return candles;
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
