import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import TradingView from '@mathieuc/tradingview';

@Injectable()
export class TradingViewService {
    private readonly logger = new Logger(TradingViewService.name);

    constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) { }

    async searchSymbols(query: string, type: string = 'forex', exchange: string = '') {
        const cacheKey = `tv_search:${query}:${type}:${exchange}`;
        const cached = await this.cacheManager.get(cacheKey);
        if (cached) return cached;

        try {
            const results = await TradingView.search(query, type, exchange);
            await this.cacheManager.set(cacheKey, results, 3600); // Cache for 1 hour
            return results;
        } catch (error) {
            this.logger.error(`Error searching symbols: ${error.message}`);
            throw error;
        }
    }

    async getCandles(symbol: string, timeframe: string = '1H', range: number = 100) {
        const cacheKey = `tv_candles:${symbol}:${timeframe}:${range}`;
        const cached = await this.cacheManager.get(cacheKey);
        if (cached) return cached;

        return new Promise((resolve, reject) => {
            const client = new TradingView.Client();
            const chart = new client.Session.Chart();

            chart.setMarket(symbol, {
                timeframe: timeframe,
                range: range, // Number of candles
            });

            chart.onUpdate(() => {
                if (!chart.periods || chart.periods.length === 0) return;

                // Transform data to a friendly format
                const candles = chart.periods.map(p => ({
                    time: p.time,
                    open: p.open,
                    high: p.max,
                    low: p.min,
                    close: p.close,
                    volume: p.volume
                }));

                // Cache the result
                this.cacheManager.set(cacheKey, candles, 60); // Cache for 1 minute

                client.end();
                resolve(candles);
            });

            chart.onError((err) => {
                this.logger.error(`Chart error for ${symbol}: ${err.message}`);
                client.end();
                reject(err);
            });
        });
    }

    async getQuote(symbol: string) {
        const cacheKey = `tv_quote:${symbol}`;
        const cached = await this.cacheManager.get(cacheKey);
        if (cached) return cached;

        return new Promise((resolve, reject) => {
            const client = new TradingView.Client(); // Use a new client to avoid session mix-up in simple quote fetch
            const session = new client.Session.Quote({
                fields: "lp"
            });

            session.setMarket(symbol);

            session.onQuote((data) => {
                this.cacheManager.set(cacheKey, data, 10); // Cache for 10 seconds
                client.end();
                resolve(data);
            });

            session.onError((err) => {
                client.end();
                reject(err);
            });
        });
    }
}
