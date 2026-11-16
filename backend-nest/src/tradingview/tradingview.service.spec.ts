let createdClients = 0;
let mockTvError: string | null = null;

jest.mock('@mathieuc/tradingview', () => ({
    Client: jest.fn().mockImplementation(() => {
        createdClients += 1;
        return {
            end: jest.fn(),
            Session: {
                Chart: jest.fn().mockImplementation(() => {
                    const chartObj: any = {
                        periods: [],
                        _updateCb: null as null | (() => void),
                        _errorCb: null as null | ((...args: any[]) => void),
                        setMarket: jest.fn((_sym: string, _opts: any) => {
                            if (mockTvError) {
                                const err = mockTvError;
                                setTimeout(() => chartObj._errorCb?.(err), 5);
                                return;
                            }
                            chartObj.periods = [
                                { time: 1700000000, open: 2000, max: 2010, min: 1995, close: 2005, volume: 120 },
                                { time: 1700003600, open: 2005, max: 2015, min: 2001, close: 2012, volume: 90 },
                            ];
                            setTimeout(() => chartObj._updateCb?.(), 15);
                        }),
                        onUpdate: jest.fn((cb: () => void) => {
                            chartObj._updateCb = cb;
                        }),
                        onError: jest.fn((cb: (...args: any[]) => void) => {
                            chartObj._errorCb = cb;
                        }),
                    };
                    return chartObj;
                }),
            },
        };
    }),
    search: jest.fn().mockResolvedValue([]),
}));

import { TradingViewService } from './tradingview.service';

describe('TradingViewService — Market Data (MT5 Priority, Single-Flight & HTTP Fallback)', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        createdClients = 0;
        mockTvError = null;
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('TradingViewService.getCandles coalesces concurrent identical requests into a single upstream session', async () => {
        const cacheManager = {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue(undefined),
        } as any;

        const tvService = new TradingViewService(cacheManager);
        const query = { range: 200, toTs: 1700010000000 };

        const responses = await Promise.all([
            tvService.getCandles('XAUUSD', '1h', query),
            tvService.getCandles('XAUUSD', '1h', query),
            tvService.getCandles('XAUUSD', '1h', query),
            tvService.getCandles('XAUUSD', '1h', query),
            tvService.getCandles('XAUUSD', '1h', query),
        ]);

        expect(createdClients).toBe(1);
        expect(responses).toHaveLength(5);
        for (const res of responses) {
            expect(res.tvSymbol).toBe('OANDA:XAUUSD');
            expect(res.source).toBe('tradingview');
            expect(res.candles).toHaveLength(2);
            expect(res.candles[1].close).toBe(2012);
        }
        expect((tvService as any).inFlightCandles.size).toBe(0);
    });

    it('TradingViewService.getCandles serves synced MT5 candles without opening a TradingView WebSocket', async () => {
        const cacheManager = {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue(undefined),
        } as any;

        const tvService = new TradingViewService(cacheManager);
        const baseTs = 1700000000000;
        const bars = Array.from({ length: 20 }, (_, i) => ({
            timestamp: baseTs + i * 3600_000,
            open: 1.08 + i * 0.0005,
            high: 1.081 + i * 0.0005,
            low: 1.079 + i * 0.0005,
            close: 1.0805 + i * 0.0005,
            volume: 100 + i,
        }));

        await tvService.ingestMt5CandleBatch('EURUSD', '1h', bars);

        const res = await tvService.getCandles('EURUSD', '1h', {
            range: 50,
            toTs: baseTs + 25 * 3600_000,
        });

        expect(createdClients).toBe(0);
        expect(res.source).toBe('mt5');
        expect(res.candles).toHaveLength(20);
        expect(res.candles[0].timestamp).toBe(baseTs);
    });

    it('TradingViewService.getCandles falls back to public Yahoo Finance HTTP feed when TradingView emits an error', async () => {
        const cacheManager = {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue(undefined),
        } as any;

        mockTvError = 'TradingView WebSocket timeout';
        const nowMs = Date.now();
        const nowSec = Math.floor(nowMs / 1000);

        const mockFetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                chart: {
                    result: [
                        {
                            timestamp: [nowSec - 7200, nowSec - 3600],
                            indicators: {
                                quote: [
                                    {
                                        open: [1.08, 1.085],
                                        high: [1.09, 1.092],
                                        low: [1.078, 1.084],
                                        close: [1.085, 1.09],
                                        volume: [100, 150],
                                    },
                                ],
                            },
                        },
                    ],
                },
            }),
        });
        global.fetch = mockFetch as any;

        const tvService = new TradingViewService(cacheManager);
        const res = await tvService.getCandles('EURUSDm', '1h', { range: 50, toTs: nowMs });

        expect(createdClients).toBe(1);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(String(mockFetch.mock.calls[0][0])).toContain('query1.finance.yahoo.com/v8/finance/chart/EURUSD%3DX');
        expect(res.source).toBe('yahoo');
        expect(res.candles).toHaveLength(2);
        expect(res.candles[1].close).toBe(1.09);
    });
});
