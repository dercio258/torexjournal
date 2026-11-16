import { useCallback, useEffect, useRef, useState } from 'react';
import { Chart, KLineData } from 'klinecharts';
import { SymbolInfo, Period } from '@klinecharts/pro';
import { CustomKLineDatafeed, DataSourceMode, DEFAULT_SYMBOLS, periodToMs } from '../../../services/klineDatafeed';
import { ReplayOrder } from '../types';
import { recomputeOrders } from '../engine';
import { ChartLegendOverlayRef } from '../layers/ChartLegendOverlayLayer';

export interface UseReplayPlaybackParams {
    chartRef: React.MutableRefObject<Chart | null>;
    datafeedRef: React.MutableRefObject<CustomKLineDatafeed | null>;
    legendOverlayRef: React.MutableRefObject<ChartLegendOverlayRef | null>;
    lastCutoffRef: React.MutableRefObject<{ key: string; ts: number } | null>;
    captureCurrentOverlayGeometries: () => Record<string, any>;
    reanchorMountedOverlays: (chart: Chart | null) => void;
    recomputeOrdersAtCutoff: (symbolTicker: string, periodText: string, cutoffTs: number, rewind: boolean) => void;
    syncAllAuxCharts: (sym: SymbolInfo, cutoffTs: number | null) => Promise<void>;
    loadChartData: (
        sym: SymbolInfo,
        per: Period,
        mode: DataSourceMode,
        isReplay: boolean,
        preserveTimestamp?: boolean
    ) => Promise<void>;
    currentSymbol: SymbolInfo;
    setCurrentSymbol: React.Dispatch<React.SetStateAction<SymbolInfo>>;
    currentPeriod: Period;
    dataSource: DataSourceMode;
    setOrders: React.Dispatch<React.SetStateAction<ReplayOrder[]>>;
    setLatestBar: React.Dispatch<React.SetStateAction<KLineData | null>>;
    setLimitEntryPrice: React.Dispatch<React.SetStateAction<string>>;
    initialReplayActive: boolean;
    deepLinkTradeId?: string;
}

export function useReplayPlayback({
    chartRef,
    datafeedRef,
    legendOverlayRef,
    lastCutoffRef,
    captureCurrentOverlayGeometries,
    reanchorMountedOverlays,
    recomputeOrdersAtCutoff,
    syncAllAuxCharts,
    loadChartData,
    currentSymbol,
    setCurrentSymbol,
    currentPeriod,
    dataSource,
    setOrders,
    setLatestBar,
    setLimitEntryPrice,
    initialReplayActive,
    deepLinkTradeId,
}: UseReplayPlaybackParams) {
    const cutCandleModeRef = useRef<boolean>(false);
    const [cutCandleMode, setCutCandleMode] = useState<boolean>(false);
    const [replayActive, setReplayActive] = useState<boolean>(initialReplayActive);
    const [autoPlaying, setAutoPlaying] = useState<boolean>(false);
    const [replaySpeedMs, setReplaySpeedMs] = useState<number>(650);
    const [replaySpeedLabel, setReplaySpeedLabel] = useState<string>('1x');
    const [activeJumpTradeId, setActiveJumpTradeId] = useState<string | null>(deepLinkTradeId ?? null);

    useEffect(() => {
        cutCandleModeRef.current = cutCandleMode;
    }, [cutCandleMode]);

    const handleStepForward = useCallback(() => {
        if (!datafeedRef.current || !chartRef.current) return;
        if (!replayActive) {
            setReplayActive(true);
            const sliced = datafeedRef.current.setReplayMode(true, 0.72, false);
            chartRef.current.applyNewData(sliced);
            datafeedRef.current.stepReplayForward();
            return;
        }
        const nextBar = datafeedRef.current.stepReplayForward();
        if (!nextBar) setAutoPlaying(false);
    }, [datafeedRef, chartRef, replayActive]);

    const handleStepBackward = useCallback(() => {
        const df = datafeedRef.current;
        const chart = chartRef.current;
        if (!df || !chart) return;
        const full = df.getFullHistory();
        const state = df.getReplayState();
        if (full.length > 5) {
            captureCurrentOverlayGeometries();
            const prevIdx = Math.max(Math.min(3, full.length - 2), state.replayIndex - 1);
            const ratio = prevIdx / full.length;
            setReplayActive(true);
            setAutoPlaying(false);
            const sliced = df.setReplayMode(true, ratio, false);
            chart.applyNewData(sliced);
            reanchorMountedOverlays(chart);
            const last = sliced[sliced.length - 1];
            if (last) {
                setLatestBar(last);
                legendOverlayRef.current?.updateLegend(last, null, null);
                recomputeOrdersAtCutoff(currentSymbol.ticker, currentPeriod.text, last.timestamp, true);
                void syncAllAuxCharts(currentSymbol, last.timestamp);
            }
        }
    }, [
        datafeedRef,
        chartRef,
        legendOverlayRef,
        setLatestBar,
        currentSymbol,
        currentPeriod.text,
        syncAllAuxCharts,
        captureCurrentOverlayGeometries,
        reanchorMountedOverlays,
        recomputeOrdersAtCutoff,
    ]);

    const handleFastForward = useCallback(() => {
        for (let i = 0; i < 5; i++) handleStepForward();
    }, [handleStepForward]);

    const handleTogglePlay = useCallback(() => {
        if (!replayActive && datafeedRef.current && chartRef.current) {
            captureCurrentOverlayGeometries();
            setReplayActive(true);
            const bars = datafeedRef.current.setReplayMode(true, 0.72, false);
            chartRef.current.applyNewData(bars);
            reanchorMountedOverlays(chartRef.current);
        }
        setAutoPlaying((p) => !p);
    }, [replayActive, datafeedRef, chartRef, captureCurrentOverlayGeometries, reanchorMountedOverlays]);

    const handleChangeSpeed = useCallback((val: string) => {
        setReplaySpeedLabel(val);
        if (val === '0.5x') setReplaySpeedMs(1100);
        else if (val === '1x' || val === '1m') setReplaySpeedMs(650);
        else if (val === '2x' || val === '5m') setReplaySpeedMs(350);
        else if (val === '5x' || val === '15m') setReplaySpeedMs(160);
        else if (val === '10x') setReplaySpeedMs(80);
    }, []);

    const handleJumpToRatio = useCallback(
        (ratio: number) => {
            const df = datafeedRef.current;
            const chart = chartRef.current;
            if (!df || !chart) return;
            const prevTs = lastCutoffRef.current?.ts;
            captureCurrentOverlayGeometries();
            setAutoPlaying(false);
            setReplayActive(ratio < 1.0);
            const bars = df.setReplayMode(ratio < 1.0, ratio, false);
            chart.applyNewData(bars);
            reanchorMountedOverlays(chart);
            const last = bars[bars.length - 1];
            if (last) {
                setLatestBar(last);
                legendOverlayRef.current?.updateLegend(last, null, null);
                const isRewind = ratio < 1.0 && (prevTs === undefined || last.timestamp <= prevTs);
                recomputeOrdersAtCutoff(currentSymbol.ticker, currentPeriod.text, last.timestamp, isRewind);
                if (ratio >= 1.0) lastCutoffRef.current = null;
                void syncAllAuxCharts(currentSymbol, last.timestamp);
            }
        },
        [
            datafeedRef,
            chartRef,
            legendOverlayRef,
            lastCutoffRef,
            setLatestBar,
            currentSymbol,
            currentPeriod.text,
            syncAllAuxCharts,
            captureCurrentOverlayGeometries,
            reanchorMountedOverlays,
            recomputeOrdersAtCutoff,
        ]
    );

    const handleJumpToTimestamp = useCallback(
        async (timestampMs: number) => {
            const df = datafeedRef.current;
            const chart = chartRef.current;
            if (!df || !chart) return;
            captureCurrentOverlayGeometries();
            setAutoPlaying(false);
            setReplayActive(true);
            const bars = await df.ensureTimestampLoaded(timestampMs);
            chart.applyNewData(bars);
            reanchorMountedOverlays(chart);
            const last = bars[bars.length - 1];
            if (last) {
                setLatestBar(last);
                legendOverlayRef.current?.updateLegend(last, null, null);
                setLimitEntryPrice(String(last.close));
                recomputeOrdersAtCutoff(currentSymbol.ticker, currentPeriod.text, last.timestamp, true);
                void syncAllAuxCharts(currentSymbol, last.timestamp);
            }
        },
        [
            datafeedRef,
            chartRef,
            legendOverlayRef,
            setLatestBar,
            setLimitEntryPrice,
            currentSymbol,
            currentPeriod.text,
            syncAllAuxCharts,
            captureCurrentOverlayGeometries,
            reanchorMountedOverlays,
            recomputeOrdersAtCutoff,
        ]
    );

    const handleLoadEarlierBatch = useCallback(async () => {
        const df = datafeedRef.current;
        const chart = chartRef.current;
        if (!df || !chart) return;
        captureCurrentOverlayGeometries();
        const res = await df.loadEarlierBatch(500);
        if (res.visibleCandles.length > 0) {
            chart.applyNewData(res.visibleCandles, true);
            reanchorMountedOverlays(chart);
        }
    }, [datafeedRef, chartRef, captureCurrentOverlayGeometries, reanchorMountedOverlays]);

    const handleJumpToSessionTrade = useCallback(
        async (trade: ReplayOrder) => {
            const df = datafeedRef.current;
            const chart = chartRef.current;
            if (!df || !chart) return;

            setActiveJumpTradeId(trade.id);
            setAutoPlaying(false);
            setReplayActive(true);

            const stepMs = periodToMs(currentPeriod);
            const closedRefTs = trade.historicalClosedAt ?? trade.closedAt;
            const targetTs =
                closedRefTs && closedRefTs >= trade.openedAt
                    ? Math.min(Date.now(), closedRefTs + stepMs * 8)
                    : Math.min(Date.now(), (trade.filledAt ?? trade.openedAt) + stepMs * 4);
            const cleanTicker = (trade.symbol || 'XAUUSD').toUpperCase();
            let activeSym = currentSymbol;

            if (cleanTicker !== currentSymbol.ticker) {
                const targetSym: SymbolInfo = DEFAULT_SYMBOLS.find((s) => s.ticker === cleanTicker) || {
                    ticker: cleanTicker,
                    name: cleanTicker,
                    shortName: cleanTicker,
                    exchange: 'OANDA',
                    market: 'forex',
                    pricePrecision: cleanTicker.includes('JPY') ? 3 : cleanTicker.includes('XAU') ? 2 : 5,
                    volumePrecision: 0,
                    priceCurrency: 'USD',
                    type: 'FOREX',
                };
                activeSym = targetSym;
                setCurrentSymbol(targetSym);
                await loadChartData(targetSym, currentPeriod, dataSource, true, false);
            }

            lastCutoffRef.current = null;
            const bars = await df.ensureTimestampLoaded(targetTs);
            if (bars.length > 0) {
                chart.applyNewData(bars, true);
                const last = bars[bars.length - 1];
                if (last) {
                    lastCutoffRef.current = { key: `${activeSym.ticker}:${currentPeriod.text}`, ts: last.timestamp };
                    setLatestBar(last);
                    legendOverlayRef.current?.updateLegend(last, null, null);
                    setOrders((cur) =>
                        cur.length > 0
                            ? recomputeOrders(cur, {
                                  symbol: activeSym.ticker,
                                  candles: df.getFullHistory(),
                                  uptoTs: last.timestamp,
                                  rewind: false,
                              })
                            : cur
                    );
                    void syncAllAuxCharts(activeSym, last.timestamp);
                }
                const focusCenterTs =
                    closedRefTs && closedRefTs > trade.openedAt
                        ? Math.round((trade.openedAt + closedRefTs) / 2)
                        : trade.filledAt ?? trade.openedAt;
                requestAnimationFrame(() => {
                    try {
                        chart.scrollToTimestamp(focusCenterTs, 240);
                    } catch (_) {}
                });
            }
        },
        [
            datafeedRef,
            chartRef,
            legendOverlayRef,
            lastCutoffRef,
            setCurrentSymbol,
            setLatestBar,
            setOrders,
            currentSymbol,
            currentPeriod,
            dataSource,
            loadChartData,
            syncAllAuxCharts,
        ]
    );

    useEffect(() => {
        if (!autoPlaying) return;
        const timer = setInterval(handleStepForward, replaySpeedMs);
        return () => clearInterval(timer);
    }, [autoPlaying, replaySpeedMs, handleStepForward]);

    return {
        replayActive,
        setReplayActive,
        autoPlaying,
        setAutoPlaying,
        replaySpeedMs,
        replaySpeedLabel,
        cutCandleMode,
        setCutCandleMode,
        cutCandleModeRef,
        activeJumpTradeId,
        setActiveJumpTradeId,
        handleStepForward,
        handleStepBackward,
        handleFastForward,
        handleTogglePlay,
        handleChangeSpeed,
        handleJumpToRatio,
        handleJumpToTimestamp,
        handleLoadEarlierBatch,
        handleJumpToSessionTrade,
    };
}
