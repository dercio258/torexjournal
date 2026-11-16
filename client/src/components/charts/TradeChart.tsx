import {
    createChart,
    CandlestickSeries,
    createSeriesMarkers,
    ColorType,
    IChartApi,
    ISeriesApi,
    ISeriesMarkersPluginApi,
    SeriesMarker,
    Time,
} from 'lightweight-charts';
import { useEffect, useRef, useState, useCallback } from 'react';
import { CheckCircle2, Database, Layers } from 'lucide-react';
import { useChartTheme } from '../../hooks/useChartTheme';
import { useLocale } from '../../context/LocaleContext';
import { getMergedCandlesFromIDB } from '../../services/historicalBatchCache';

interface TradeChartProps {
    symbol: string;
    openTime: string;
    closeTime: string;
    openPrice: number;
    closePrice: number;
    type: string; // 'BUY' or 'SELL'
    profit?: number;
    onAvailabilityChange?: (available: boolean) => void;
}

export interface Candle {
    time: string | number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
}

function normalizeBaseSymbol(rawSymbol: string): string {
    const clean = (rawSymbol || 'XAUUSD').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.startsWith('XAUUSD') || clean.startsWith('GOLD')) return 'XAUUSD';
    if (clean.startsWith('EURUSD')) return 'EURUSD';
    if (clean.startsWith('GBPUSD')) return 'GBPUSD';
    if (clean.startsWith('USDJPY')) return 'USDJPY';
    if (clean.startsWith('AUDUSD')) return 'AUDUSD';
    if (clean.startsWith('NZDUSD')) return 'NZDUSD';
    if (clean.startsWith('USDCAD')) return 'USDCAD';
    if (clean.startsWith('USDCHF')) return 'USDCHF';
    if (clean.startsWith('EURGBP')) return 'EURGBP';
    if (clean.startsWith('EURJPY')) return 'EURJPY';
    if (clean.startsWith('GBPJPY')) return 'GBPJPY';
    if (clean.startsWith('BTCUSD')) return 'BTCUSD';
    if (clean.startsWith('ETHUSD')) return 'ETHUSD';
    if (clean.startsWith('SOLUSD')) return 'SOLUSD';
    if (clean.startsWith('NAS100') || clean.startsWith('US100') || clean.startsWith('USTEC')) return 'NAS100';
    if (clean.startsWith('US30') || clean.startsWith('DJ30')) return 'US30';
    if (clean.startsWith('SPX500') || clean.startsWith('US500')) return 'SPX500';
    return clean || 'XAUUSD';
}

/**
 * Pure Cache-Only Reader:
 * Checks ONLY local IndexedDB batches (`ohlcv_batches`) that were already pulled during
 * Trade Import / Sync (`/add-trades`). Never triggers network requests or sync attempts
 * on the Trade Details page, avoiding any bottleneck. If no exact batch covers the trade,
 * returns nothing (`null`) so the market chart section stays hidden.
 */
export const TradeChart = ({
    symbol,
    openTime,
    closeTime,
    openPrice,
    closePrice,
    type,
    onAvailabilityChange,
}: TradeChartProps) => {
    const ct = useChartTheme();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
    const [checkedCache, setCheckedCache] = useState(false);
    const [sourceLabel, setSourceLabel] = useState<string>('');
    const [batchInfoLabel, setBatchInfoLabel] = useState<string>('');
    const [activeTimeframe, setActiveTimeframe] = useState<string>('15m');
    const [availableTimeframes, setAvailableTimeframes] = useState<string[]>([]);
    const [candles, setCandles] = useState<Candle[]>([]);

    const loadFromLocalBatchCacheOnly = useCallback(async (preferredTf?: string) => {
        const tradeStartMs = new Date(openTime).getTime();
        const rawEndMs = new Date(closeTime || openTime).getTime();
        const tradeEndMs =
            Number.isFinite(rawEndMs) && rawEndMs >= tradeStartMs ? rawEndMs : tradeStartMs + 15 * 60 * 1000;

        if (!Number.isFinite(tradeStartMs) || tradeStartMs <= 0) {
            setCandles([]);
            setCheckedCache(true);
            return;
        }

        const normSymbol = normalizeBaseSymbol(symbol);
        const candidateTfs = preferredTf
            ? [preferredTf, '15m', '5m', '1m', '30m', '1H', '4H', '1D']
            : ['15m', '5m', '1m', '30m', '1H', '4H', '1D'];
        const uniqueTfs = Array.from(new Set(candidateTfs));

        const foundTfs: string[] = [];
        let matchedBars: Candle[] = [];
        let matchedTf = '';
        let matchedSource = '';

        for (const tf of uniqueTfs) {
            const stepMs =
                tf === '1m'
                    ? 60_000
                    : tf === '5m'
                      ? 300_000
                      : tf === '15m'
                        ? 900_000
                        : tf === '30m'
                          ? 1_800_000
                          : tf === '1H' || tf === '1h'
                            ? 3_600_000
                            : tf === '4H' || tf === '4h'
                              ? 14_400_000
                              : 86_400_000;

            const preWindowMs = stepMs * 120;
            const postWindowMs = stepMs * 80;
            const batchFromMs = tradeStartMs - preWindowMs;
            const batchToMs = tradeEndMs + postWindowMs;

            try {
                const cachedIdb = await getMergedCandlesFromIDB(normSymbol, tf);
                if (cachedIdb.candles.length > 0) {
                    const inWindow = cachedIdb.candles.filter(
                        (c) => c.timestamp >= batchFromMs - stepMs * 50 && c.timestamp <= batchToMs + stepMs * 50
                    );
                    const coversTrade =
                        inWindow.length >= 5 &&
                        inWindow[0].timestamp <= tradeStartMs + stepMs * 8 &&
                        inWindow[inWindow.length - 1].timestamp >= tradeStartMs - stepMs * 8;

                    if (coversTrade) {
                        foundTfs.push(tf);
                        if (matchedBars.length === 0) {
                            matchedBars = inWindow.map((c) => ({
                                time: c.timestamp,
                                open: c.open,
                                high: c.high,
                                low: c.low,
                                close: c.close,
                                volume: c.volume,
                            }));
                            matchedTf = tf;
                            matchedSource = cachedIdb.source || 'Sync Batch';
                        }
                    }
                }
            } catch (_) {}
        }

        setAvailableTimeframes(foundTfs);
        if (matchedBars.length > 0) {
            setCandles(matchedBars);
            setActiveTimeframe(matchedTf);
            setSourceLabel(isEn ? `Synced Batch (${matchedSource} · ${matchedTf})` : `Lote Sincronizado (${matchedSource} · ${matchedTf})`);
            setBatchInfoLabel(isEn ? `${matchedBars.length} cached bars` : `${matchedBars.length} velas em cache`);
            onAvailabilityChange?.(true);
        } else {
            setCandles([]);
            onAvailabilityChange?.(false);
        }
        setCheckedCache(true);
    }, [symbol, openTime, closeTime, onAvailabilityChange]);

    useEffect(() => {
        if (symbol && openTime) {
            void loadFromLocalBatchCacheOnly();
        } else {
            setCheckedCache(true);
        }
    }, [symbol, openTime, closeTime, loadFromLocalBatchCacheOnly]);

    // Re-theme the live chart without recreating it.
    useEffect(() => {
        chartRef.current?.applyOptions({
            layout: { textColor: ct.tick },
            grid: { vertLines: { color: ct.grid }, horzLines: { color: ct.grid } },
        });
        seriesRef.current?.applyOptions({
            upColor: ct.pos,
            downColor: ct.neg,
            wickUpColor: ct.pos,
            wickDownColor: ct.neg,
        });
    }, [ct]);

    useEffect(() => {
        if (!checkedCache || candles.length === 0 || !chartContainerRef.current) return;

        const handleResize = () => {
            if (chartRef.current && chartContainerRef.current) {
                chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
            }
        };

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: ct.tick,
            },
            grid: {
                vertLines: { color: ct.grid },
                horzLines: { color: ct.grid },
            },
            width: chartContainerRef.current.clientWidth,
            height: 400,
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
            },
        });

        const candlestickSeries = chart.addSeries(CandlestickSeries, {
            upColor: ct.pos,
            downColor: ct.neg,
            borderVisible: false,
            wickUpColor: ct.pos,
            wickDownColor: ct.neg,
        });

        chartRef.current = chart;
        seriesRef.current = candlestickSeries;
        markersPluginRef.current = createSeriesMarkers(candlestickSeries, []);

        const rawData = candles.map((c) => {
            const sec =
                typeof c.time === 'number'
                    ? Math.floor(c.time > 1e11 ? c.time / 1000 : c.time)
                    : Math.floor(new Date(c.time).getTime() / 1000);
            return {
                time: sec as Time,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
            };
        });

        rawData.sort((a, b) => (a.time as number) - (b.time as number));
        const uniqueData = rawData.filter(
            (item, idx, arr) => idx === 0 || (item.time as number) > (arr[idx - 1].time as number)
        );

        candlestickSeries.setData(uniqueData);

        const openTs = Math.floor(new Date(openTime).getTime() / 1000);
        const closeTs = Math.floor(new Date(closeTime || openTime).getTime() / 1000);
        const isBuy = String(type).toUpperCase() === 'BUY';

        const findNearestBarTime = (targetSec: number): Time => {
            let best = uniqueData[0].time;
            let bestDist = Math.abs((best as number) - targetSec);
            for (const d of uniqueData) {
                const dist = Math.abs((d.time as number) - targetSec);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = d.time;
                }
            }
            return best;
        };

        const entryTime = findNearestBarTime(openTs);
        const exitTime = findNearestBarTime(closeTs);

        const markers: SeriesMarker<Time>[] = [
            {
                time: entryTime,
                position: isBuy ? 'belowBar' : 'aboveBar',
                color: '#3b82f6',
                shape: isBuy ? 'arrowUp' : 'arrowDown',
                text: `ENTRY (${isBuy ? 'BUY' : 'SELL'} @ ${openPrice})`,
            },
            {
                time: exitTime,
                position: isBuy ? 'aboveBar' : 'belowBar',
                color: '#f59e0b',
                shape: isBuy ? 'arrowDown' : 'arrowUp',
                text: `EXIT (@ ${closePrice})`,
            },
        ];
        markers.sort((a, b) => (a.time as number) - (b.time as number));
        markersPluginRef.current.setMarkers(markers);
        chart.timeScale().fitContent();

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            markersPluginRef.current = null;
            seriesRef.current = null;
            chartRef.current = null;
            chart.remove();
        };
    }, [checkedCache, candles, openTime, closeTime, openPrice, closePrice, type]);

    // Do NOT render anything if the trade does not already have synchronized market batches in cache
    if (!checkedCache || candles.length === 0) {
        return null;
    }

    return (
        <div className="relative w-full h-[400px] bg-canvas/30 rounded-xl border border-line overflow-hidden">
            <div ref={chartContainerRef} className="w-full h-full" />

            <div className="absolute top-3 left-3 right-3 z-10 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
                <div className="flex flex-wrap items-center gap-2 pointer-events-auto">
                    <div className="bg-surface/90 backdrop-blur px-3 py-1 rounded-lg border border-line-strong text-xs font-mono font-bold text-fg flex items-center gap-1.5">
                        <CheckCircle2 size={13} className="text-emerald-500" />
                        <span>{symbol}</span>
                    </div>
                    <div className="bg-surface/85 backdrop-blur px-2.5 py-1 rounded-lg border border-line text-[11px] text-fg-muted flex items-center gap-1.5">
                        <Database size={12} className="text-emerald-500" />
                        <span>{sourceLabel}</span>
                    </div>
                    {batchInfoLabel && (
                        <div className="bg-emerald-500/10 backdrop-blur px-2.5 py-1 rounded-lg border border-emerald-500/25 text-[11px] text-emerald-500 font-semibold flex items-center gap-1">
                            <Layers size={11} />
                            <span>{batchInfoLabel}</span>
                        </div>
                    )}
                </div>

                {availableTimeframes.length > 1 && (
                    <div className="flex items-center gap-1 bg-surface/90 backdrop-blur px-1.5 py-1 rounded-lg border border-line pointer-events-auto">
                        {availableTimeframes.map((tf) => (
                            <button
                                key={tf}
                                type="button"
                                onClick={() => void loadFromLocalBatchCacheOnly(tf)}
                                className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-colors ${
                                    activeTimeframe === tf
                                        ? 'bg-emerald-500 text-slate-950'
                                        : 'text-fg-muted hover:text-fg hover:bg-surface-2'
                                }`}
                            >
                                {tf}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
