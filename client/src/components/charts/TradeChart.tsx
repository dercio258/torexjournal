import { createChart, ColorType, IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import api from '../../api';

interface TradeChartProps {
    symbol: string;
    openTime: string;
    closeTime: string;
    openPrice: number;
    closePrice: number;
    type: string; // 'BUY' or 'SELL'
}

interface Candle {
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
}

export const TradeChart = ({ symbol, openTime, closeTime, openPrice, closePrice, type }: TradeChartProps) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [candles, setCandles] = useState<Candle[]>([]);

    useEffect(() => {
        const fetchCandles = async () => {
            setLoading(true);
            setError(null);
            try {
                // Calculate range: Trade duration + padding
                const tradeStart = new Date(openTime);
                const tradeEnd = new Date(closeTime);
                const duration = tradeEnd.getTime() - tradeStart.getTime();

                // Add 50% duration padding before and after (min 1 hour padding)
                const padding = Math.max(duration * 0.5, 60 * 60 * 1000);

                const from = new Date(tradeStart.getTime() - padding);
                const to = new Date(tradeEnd.getTime() + padding);

                // Determine granularity based on duration
                // < 1 hour -> M1
                // < 6 hours -> M5
                // < 1 day -> M15
                // < 3 days -> H1
                // > 3 days -> H4 or D
                let granularity = 'M5';
                if (duration < 60 * 60 * 1000) granularity = 'M1';
                else if (duration < 6 * 60 * 60 * 1000) granularity = 'M5';
                else if (duration < 24 * 60 * 60 * 1000) granularity = 'M15';
                else if (duration < 3 * 24 * 60 * 60 * 1000) granularity = 'H1';
                else granularity = 'H4';

                const response = await api.get('/market-data/candles', {
                    params: {
                        symbol,
                        from: from.toISOString(),
                        to: to.toISOString(),
                        granularity
                    }
                });

                setCandles(response.data);
            } catch (err) {
                console.error('Failed to load chart data', err);
                setError('Failed to load market data.');
            } finally {
                setLoading(false);
            }
        };

        if (symbol && openTime && closeTime) {
            fetchCandles();
        }
    }, [symbol, openTime, closeTime]);

    useEffect(() => {
        if (!chartContainerRef.current) return;

        const handleResize = () => {
            if (chartRef.current && chartContainerRef.current) {
                chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
            }
        };

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: '#94a3b8',
            },
            grid: {
                vertLines: { color: '#1e293b' },
                horzLines: { color: '#1e293b' },
            },
            width: chartContainerRef.current.clientWidth,
            height: 400,
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
            },
        });

        const candlestickSeries = chart.addCandlestickSeries({
            upColor: '#10b981', // Emerald 500
            downColor: '#ef4444', // Red 500
            borderVisible: false,
            wickUpColor: '#10b981',
            wickDownColor: '#ef4444',
        });

        chartRef.current = chart;
        seriesRef.current = candlestickSeries;

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
        };
    }, []);

    useEffect(() => {
        if (seriesRef.current && candles.length > 0) {
            // Transform data for lightweight-charts
            const data = candles.map(c => ({
                time: (new Date(c.time).getTime() / 1000) as Time,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
            }));

            // Sort data by time just in case
            data.sort((a, b) => (a.time as number) - (b.time as number));

            seriesRef.current.setData(data);

            // Add markers for entry and exit
            const openTs = new Date(openTime).getTime() / 1000;
            const closeTs = new Date(closeTime).getTime() / 1000;

            const markers = [
                {
                    time: openTs as Time,
                    position: type === 'BUY' ? 'belowBar' : 'aboveBar',
                    color: '#3b82f6', // Blue
                    shape: type === 'BUY' ? 'arrowUp' : 'arrowDown',
                    text: 'ENTRY',
                },
                {
                    time: closeTs as Time,
                    position: type === 'BUY' ? 'aboveBar' : 'belowBar',
                    color: '#f59e0b', // Amber
                    shape: type === 'BUY' ? 'arrowDown' : 'arrowUp', // Exit shape
                    text: 'EXIT',
                }
            ];
            // @ts-ignore
            seriesRef.current.setMarkers(markers);

            chartRef.current?.timeScale().fitContent();
        }
    }, [candles, openTime, closeTime, type]);

    if (loading) return <div className="h-[400px] flex items-center justify-center text-slate-500 animate-pulse">Carregando gráfico...</div>;
    if (error) return <div className="h-[400px] flex items-center justify-center text-red-400">{error}</div>;

    return (
        <div className="relative w-full h-[400px] bg-slate-950/30 rounded-xl border border-slate-800 overflow-hidden">
            <div ref={chartContainerRef} className="w-full h-full" />
            <div className="absolute top-4 left-4 z-10 bg-slate-900/80 backdrop-blur px-3 py-1 rounded-lg border border-slate-700 text-xs font-mono text-slate-300">
                {symbol} (Replay)
            </div>
        </div>
    );
};
