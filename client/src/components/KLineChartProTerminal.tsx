import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
    init,
    dispose,
    Chart,
    KLineData,
    OverlayMode,
    CandleType,
    LineType,
    ActionType,
} from 'klinecharts';
import { X } from 'lucide-react';
import api from '../api';
import { CustomKLineDatafeed, DataSourceMode, DEFAULT_SYMBOLS, FeedUnavailableError, FeedStats } from '../services/klineDatafeed';
import { SymbolInfo, Period } from '@klinecharts/pro';
import { ReplayOrder, TIMEFRAMES, AVAILABLE_INDICATORS } from './kline-replay/types';
import { createOrder, recomputeOrders, computeStats } from './kline-replay/engine';
import { ensureCustomOverlays } from './kline-replay/overlays/registerCustomOverlays';
import { TopToolbarLayer, ChartLayoutMode } from './kline-replay/layers/TopToolbarLayer';
import { LeftDrawingLayer } from './kline-replay/layers/LeftDrawingLayer';
import { ChartLegendOverlayLayer, ChartLegendOverlayRef } from './kline-replay/layers/ChartLegendOverlayLayer';
import { FloatingReplayBarLayer } from './kline-replay/layers/FloatingReplayBarLayer';
import { RightSidePanelLayer } from './kline-replay/layers/RightSidePanelLayer';
import { BottomDockLayer } from './kline-replay/layers/BottomDockLayer';

const LOCAL_STORAGE_KEY = 'cossa_kline_replay_state_v1';

interface PersistedReplayState {
    ticker?: string;
    periodText?: string;
    secondaryPeriodText?: string;
    layoutMode?: ChartLayoutMode;
    chartTheme?: 'light' | 'dark';
    orders?: ReplayOrder[];
    journalNotes?: string;
    /** Replay cutoff at save time, so restored orders line up with the chart. */
    replayTimestamp?: number | null;
    spread?: number;
    commission?: number;
}

function loadPersistedState(): PersistedReplayState | null {
    try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (_) {
        return null;
    }
}

interface KLineChartProTerminalProps {
    initialBalance?: number;
    accountName?: string;
    onSaveReplaySession?: (sessionPayload: any) => Promise<void>;
}

export const KLineChartProTerminal: React.FC<KLineChartProTerminalProps> = ({
    initialBalance = 10000,
    accountName = 'Conta Principal',
    onSaveReplaySession,
}) => {
    ensureCustomOverlays();

    const saved = useMemo(() => loadPersistedState(), []);

    const chartDivRef = useRef<HTMLDivElement | null>(null);
    const chartRef = useRef<Chart | null>(null);
    const secondaryChartDivRef = useRef<HTMLDivElement | null>(null);
    const secondaryChartRef = useRef<Chart | null>(null);
    const datafeedRef = useRef<CustomKLineDatafeed | null>(null);
    const legendOverlayRef = useRef<ChartLegendOverlayRef | null>(null);
    const drawnOverlayIdsRef = useRef<string[]>([]);
    const orderOverlayIdsRef = useRef<string[]>([]);
    const cutCandleModeRef = useRef<boolean>(false);
    const rafCrosshairRef = useRef<number | null>(null);

    // Top Plan Banner (Traynio style)
    const [showPlanBanner, setShowPlanBanner] = useState<boolean>(true);
    const [planLimits, setPlanLimits] = useState<{
        tier: string;
        maxDays: number;
        maxBars: number;
        earliestDate: string;
        isPaid: boolean;
    }>(() => ({
        tier: 'FREE',
        maxDays: 15,
        maxBars: 350,
        earliestDate: new Date(Date.now() - 15 * 86400000).toLocaleDateString('en-US', {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric',
        }),
        isPaid: false,
    }));

    useEffect(() => {
        api.get('/tradingview/replay-limits')
            .then(res => {
                if (res?.data?.tier) {
                    setPlanLimits(res.data);
                    const df = datafeedRef.current;
                    if (df && Number(res.data.maxBars) > 350) {
                        df.setMaxBars(res.data.maxBars);
                        const { currentSymbol: sym, currentPeriod: per, dataSource: mode, replayActive: rp } = liveRef.current;
                        loadChartDataRef.current?.(sym, per, mode, rp, true);
                    }
                }
            })
            .catch(() => {});
    }, []);

    // Theme, Layout & Data Source
    const [chartTheme, setChartTheme] = useState<'light' | 'dark'>(saved?.chartTheme || 'light');
    const [layoutMode, setLayoutMode] = useState<ChartLayoutMode>(saved?.layoutMode || '1x1');
    const [dataSource, setDataSource] = useState<DataSourceMode>('TRADINGVIEW');
    const [activeSourceLabel, setActiveSourceLabel] = useState<string>('TradingView');
    const [isSynthetic, setIsSynthetic] = useState<boolean>(false);
    const [feedError, setFeedError] = useState<string | null>(null);
    const [feedLoading, setFeedLoading] = useState<boolean>(false);

    // Symbol & Period (Primary + Secondary for 1x2 Split-Screen)
    const [currentSymbol, setCurrentSymbol] = useState<SymbolInfo>(() => {
        if (saved?.ticker) {
            const found = DEFAULT_SYMBOLS.find(s => s.ticker === saved.ticker);
            if (found) return found;
        }
        return DEFAULT_SYMBOLS[0];
    });
    const [currentPeriod, setCurrentPeriod] = useState<Period>(() => {
        if (saved?.periodText) {
            const found = TIMEFRAMES.find(t => t.text === saved.periodText);
            if (found) return found;
        }
        return TIMEFRAMES[1]; // 15m
    });
    const [secondaryPeriod, setSecondaryPeriod] = useState<Period>(() => {
        if (saved?.secondaryPeriodText) {
            const found = TIMEFRAMES.find(t => t.text === saved.secondaryPeriodText);
            if (found) return found;
        }
        return TIMEFRAMES[2]; // 1h
    });

    const [candleStyle, setCandleStyle] = useState<CandleType>(CandleType.CandleSolid);
    const [latestBar, setLatestBar] = useState<KLineData | null>(null);

    // Drawing Controls
    const [cutCandleMode, setCutCandleMode] = useState<boolean>(false);
    const [magnetMode, setMagnetMode] = useState<boolean>(false);
    const [drawingsLocked, setDrawingsLocked] = useState<boolean>(false);
    const [drawingsVisible, setDrawingsVisible] = useState<boolean>(true);

    // Indicators Modal
    const [indicatorModalOpen, setIndicatorModalOpen] = useState(false);
    const [activeIndicators, setActiveIndicators] = useState<string[]>([]);

    // Replay Controls
    const [replayActive, setReplayActive] = useState<boolean>(true);
    const [autoPlaying, setAutoPlaying] = useState<boolean>(false);
    const [replaySpeedMs, setReplaySpeedMs] = useState<number>(600);
    const [replaySpeedLabel, setReplaySpeedLabel] = useState<string>('1m');
    const [syncEnabled, setSyncEnabled] = useState<boolean>(true);

    // Right Drawer & Order Ticket
    const [rightDrawer, setRightDrawer] = useState<'none' | 'trade' | 'journal'>('none');
    const [orderSide, setOrderSide] = useState<'BUY' | 'SELL'>('BUY');
    const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET');
    const [limitEntryPrice, setLimitEntryPrice] = useState<string>('');
    const [riskPercent, setRiskPercent] = useState<number>(1.0);
    const [lots] = useState<number>(1.0); // informational only: size comes from risk %
    const [slDistancePct, setSlDistancePct] = useState<number>(0.30);
    const [rrTarget, setRrTarget] = useState<number>(2.0);
    const [journalNotes, setJournalNotes] = useState<string>(saved?.journalNotes || '');
    const [spread, setSpread] = useState<number>(saved?.spread ?? 0);
    const [commission, setCommission] = useState<number>(saved?.commission ?? 0);

    // Simulation portfolio. Orders are the single source of truth; the balance
    // is derived from closed trades, so StrictMode double-invocation is harmless.
    const [orders, setOrders] = useState<ReplayOrder[]>(saved?.orders || []);
    const [savingSession, setSavingSession] = useState<boolean>(false);
    const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

    // Persist state to localStorage (Phase 3)
    useEffect(() => {
        try {
            const payload: PersistedReplayState = {
                ticker: currentSymbol.ticker,
                periodText: currentPeriod.text,
                secondaryPeriodText: secondaryPeriod.text,
                layoutMode,
                chartTheme,
                orders,
                journalNotes,
                replayTimestamp: replayActive ? latestBar?.timestamp ?? null : null,
                spread,
                commission,
            };
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));
        } catch (_) {}
    }, [currentSymbol.ticker, currentPeriod.text, secondaryPeriod.text, layoutMode, chartTheme, orders, journalNotes, replayActive, latestBar?.timestamp, spread, commission]);

    useEffect(() => {
        cutCandleModeRef.current = cutCandleMode;
    }, [cutCandleMode]);

    // Always-current values for callbacks registered once (chart actions, feed listener).
    const liveRef = useRef({ currentSymbol, currentPeriod, secondaryPeriod, dataSource, replayActive, syncEnabled });
    liveRef.current = { currentSymbol, currentPeriod, secondaryPeriod, dataSource, replayActive, syncEnabled };
    const loadChartDataRef = useRef<((sym: SymbolInfo, per: Period, mode: DataSourceMode, isReplay: boolean, preserve?: boolean) => Promise<void>) | null>(null);
    const syncSecondaryRef = useRef<((sym: SymbolInfo, per: Period, ts: number | null) => void) | null>(null);
    const lastCutoffRef = useRef<{ key: string; ts: number } | null>(null);

    // Apply Chart Theme Styles
    const applyChartTheme = useCallback((chart: Chart, theme: 'light' | 'dark') => {
        const isLight = theme === 'light';
        chart.setStyles({
            grid: {
                show: true,
                horizontal: {
                    show: true,
                    size: 1,
                    color: isLight ? '#f0f3fa' : '#1e222d',
                    style: LineType.Dashed,
                    dashedValue: [3, 3],
                },
                vertical: {
                    show: true,
                    size: 1,
                    color: isLight ? '#f0f3fa' : '#1e222d',
                    style: LineType.Dashed,
                    dashedValue: [3, 3],
                },
            },
            candle: {
                type: candleStyle,
                bar: {
                    upColor: '#26a69a',
                    downColor: '#ef5350',
                    noChangeColor: '#888888',
                    upBorderColor: '#26a69a',
                    downBorderColor: '#ef5350',
                    noChangeBorderColor: '#888888',
                    upWickColor: '#26a69a',
                    downWickColor: '#ef5350',
                    noChangeWickColor: '#888888',
                },
                priceMark: {
                    show: true,
                    high: { show: false },
                    low: { show: false },
                    last: {
                        show: true,
                        upColor: '#26a69a',
                        downColor: '#ef5350',
                        noChangeColor: '#888888',
                        line: {
                            show: true,
                            style: LineType.Dashed,
                            dashedValue: [4, 4],
                            size: 1,
                        },
                        text: {
                            show: true,
                            size: 11,
                            paddingLeft: 6,
                            paddingTop: 4,
                            paddingRight: 6,
                            paddingBottom: 4,
                            color: '#ffffff',
                            borderRadius: 3,
                        },
                    },
                },
                tooltip: { showRule: 'none' as any },
            },
            indicator: {
                bars: [
                    {
                        upColor: 'rgba(38, 166, 154, 0.42)',
                        downColor: 'rgba(239, 83, 80, 0.42)',
                        noChangeColor: 'rgba(136, 136, 136, 0.42)',
                    },
                ],
                tooltip: { showRule: 'none' as any },
            },
            xAxis: {
                show: true,
                axisLine: { show: true, color: isLight ? '#e0e3eb' : '#2a2e39', size: 1 },
                tickText: { show: true, color: isLight ? '#131722' : '#b2b5be', size: 11 },
                tickLine: { show: false },
            },
            yAxis: {
                show: true,
                axisLine: { show: false },
                tickText: { show: true, color: isLight ? '#131722' : '#b2b5be', size: 11 },
                tickLine: { show: false },
            },
            separator: {
                size: 1,
                color: isLight ? '#e0e3eb' : '#2a2e39',
            },
            crosshair: {
                show: true,
                horizontal: {
                    show: true,
                    line: {
                        show: true,
                        style: LineType.Dashed,
                        dashedValue: [4, 4],
                        size: 1,
                        color: isLight ? '#787b86' : '#9598a1',
                    },
                    text: {
                        show: true,
                        color: '#ffffff',
                        backgroundColor: '#131722',
                        size: 11,
                        paddingLeft: 6,
                        paddingRight: 6,
                        paddingTop: 3,
                        paddingBottom: 3,
                        borderRadius: 3,
                    },
                },
                vertical: {
                    show: true,
                    line: {
                        show: true,
                        style: LineType.Dashed,
                        dashedValue: [4, 4],
                        size: 1,
                        color: isLight ? '#787b86' : '#9598a1',
                    },
                    text: {
                        show: true,
                        color: '#ffffff',
                        backgroundColor: '#131722',
                        size: 11,
                        paddingLeft: 6,
                        paddingRight: 6,
                        paddingTop: 3,
                        paddingBottom: 3,
                        borderRadius: 3,
                    },
                },
            },
        });
    }, [candleStyle]);

    // Sync Secondary Chart in 1x2 Split-Screen Mode
    const syncSecondaryChart = useCallback(async (sym: SymbolInfo, secPer: Period, cutoffTs: number | null) => {
        const secChart = secondaryChartRef.current;
        const df = datafeedRef.current;
        if (!secChart || !df) return;

        secChart.setPriceVolumePrecision(sym.pricePrecision ?? 2, sym.volumePrecision ?? 0);
        const bars = await df.getHistorySlicedAtTimestamp(sym, secPer, syncEnabled ? cutoffTs : null);
        secChart.applyNewData(bars, bars.length > 0);
    }, [syncEnabled]);

    // Re-derive orders from the engine whenever the visible cutoff changes.
    // Rewind = cutoff moved backwards on the same instrument/timeframe.
    const onFeedCandle = useCallback((candle: KLineData, stats: FeedStats) => {
        setLatestBar(candle);
        legendOverlayRef.current?.updateLegend(candle, null, null);
        const df = datafeedRef.current;
        if (!df || !stats.ticker) return;

        const key = `${stats.ticker}:${stats.periodText}`;
        const prev = lastCutoffRef.current;
        const rewind = !!prev && prev.key === key && candle.timestamp < prev.ts;
        lastCutoffRef.current = { key, ts: candle.timestamp };

        const candles = df.getFullHistory();
        setOrders(cur => recomputeOrders(cur, { symbol: stats.ticker, candles, uptoTs: candle.timestamp, rewind }));
    }, []);

    // Load Chart Data (with Phase 4 Timestamp Preservation across Timeframes)
    const loadChartData = useCallback(async (
        sym: SymbolInfo,
        per: Period,
        mode: DataSourceMode,
        isReplay: boolean,
        preserveTimestamp: boolean = false
    ) => {
        const chart = chartRef.current;
        const df = datafeedRef.current;
        if (!chart || !df) return;

        df.setMode(mode);
        df.unsubscribe();
        chart.setPriceVolumePrecision(sym.pricePrecision ?? 2, sym.volumePrecision ?? 0);

        setFeedLoading(true);
        try {
            await df.getHistoryKLineData(sym, per);
            setFeedError(null);
        } catch (e) {
            // Never fall back to generated prices: show the outage and an empty chart.
            setFeedError(e instanceof FeedUnavailableError ? e.message : 'Não foi possível carregar o histórico.');
            chart.clearData();
            setLatestBar(null);
            return;
        } finally {
            setFeedLoading(false);
        }

        const barsToRender = df.setReplayMode(isReplay, 0.72, preserveTimestamp && syncEnabled);
        chart.applyNewData(barsToRender, barsToRender.length > 0);

        if (barsToRender.length > 0) {
            const last = barsToRender[barsToRender.length - 1];
            setLatestBar(last);
            legendOverlayRef.current?.updateLegend(last, null, null);
            setLimitEntryPrice(String(last.close));
            if (secondaryChartRef.current) {
                syncSecondaryChart(sym, secondaryPeriod, last.timestamp);
            }
        }

        df.subscribe(sym, per, (bar) => {
            chart.updateData(bar);
        });
    }, [syncEnabled, secondaryPeriod, syncSecondaryChart]);

    loadChartDataRef.current = loadChartData;
    syncSecondaryRef.current = syncSecondaryChart;

    // Initialize Primary Chart & ResizeObserver
    useEffect(() => {
        const el = chartDivRef.current;
        if (!el) return;

        const chart = init(el);
        if (!chart) return;
        chartRef.current = chart;

        applyChartTheme(chart, chartTheme);
        chart.createIndicator('VOL', false, { height: 95 });

        chart.subscribeAction(ActionType.OnCrosshairChange, (data: any) => {
            if (rafCrosshairRef.current) cancelAnimationFrame(rafCrosshairRef.current);
            rafCrosshairRef.current = requestAnimationFrame(() => {
                let yVal: number | null = null;
                let priceVal: number | null = null;
                if (typeof data?.y === 'number' && data.paneId === 'candle_pane') {
                    yVal = data.y;
                    const pt = chart.convertFromPixel([{ x: data.x || 100, y: data.y }], { paneId: 'candle_pane' });
                    const val = Array.isArray(pt) ? pt[0]?.value : (pt as any)?.value;
                    if (typeof val === 'number') priceVal = val;
                }
                legendOverlayRef.current?.updateLegend(data?.kLineData || null, yVal, priceVal);
            });
        });

        chart.subscribeAction(ActionType.OnCandleBarClick, (data: any) => {
            if (cutCandleModeRef.current && typeof data?.dataIndex === 'number' && datafeedRef.current) {
                const full = datafeedRef.current.getFullHistory();
                if (full.length > 20) {
                    const ratio = Math.max(0.1, Math.min(0.98, (data.dataIndex + 1) / full.length));
                    const sliced = datafeedRef.current.setReplayMode(true, ratio, false);
                    chart.applyNewData(sliced);
                    setReplayActive(true);
                    setAutoPlaying(false);
                    setCutCandleMode(false);
                    const last = sliced[sliced.length - 1];
                    if (last && secondaryChartRef.current) {
                        const { currentSymbol: sym, secondaryPeriod: sec } = liveRef.current;
                        syncSecondaryRef.current?.(sym, sec, last.timestamp);
                    }
                }
            }
        });

        const df = new CustomKLineDatafeed(dataSource, (candle, stats) => {
            setActiveSourceLabel(stats.source);
            setIsSynthetic(stats.synthetic);
            onFeedCandle(candle, stats);
        });
        datafeedRef.current = df;

        loadChartData(currentSymbol, currentPeriod, dataSource, replayActive, false).then(() => {
            // Resume where the saved session stopped, so restored orders match the chart.
            const ts = saved?.replayTimestamp;
            if (!ts || !replayActive || chartRef.current !== chart) return;
            if (!df.getFullHistory().some(c => c.timestamp <= ts)) return;
            lastCutoffRef.current = null; // a restore is not a rewind
            chart.applyNewData(df.setReplayTimestamp(ts));
        });

        const resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(() => chart.resize());
        });
        resizeObserver.observe(el);

        return () => {
            if (rafCrosshairRef.current) cancelAnimationFrame(rafCrosshairRef.current);
            resizeObserver.disconnect();
            dispose(el);
            chartRef.current = null;
        };
    }, []);

    // Initialize / Dispose Secondary Chart when layoutMode === '1x2' (Phase 2)
    useEffect(() => {
        if (layoutMode !== '1x2') {
            if (secondaryChartDivRef.current && secondaryChartRef.current) {
                dispose(secondaryChartDivRef.current);
                secondaryChartRef.current = null;
            }
            return;
        }

        const secEl = secondaryChartDivRef.current;
        if (!secEl) return;

        const secChart = init(secEl);
        if (!secChart) return;
        secondaryChartRef.current = secChart;

        applyChartTheme(secChart, chartTheme);
        secChart.createIndicator('EMA', true, { id: 'candle_pane' });

        const cutoffTs = datafeedRef.current?.getReplayTimestamp() || latestBar?.timestamp || null;
        syncSecondaryChart(currentSymbol, secondaryPeriod, cutoffTs);

        const resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(() => {
                secChart.resize();
                chartRef.current?.resize();
            });
        });
        resizeObserver.observe(secEl);

        return () => {
            resizeObserver.disconnect();
            dispose(secEl);
            secondaryChartRef.current = null;
        };
    }, [layoutMode]);

    // Update Secondary Chart when symbol, secondaryPeriod, or latestBar changes
    useEffect(() => {
        if (layoutMode === '1x2' && secondaryChartRef.current) {
            syncSecondaryChart(currentSymbol, secondaryPeriod, latestBar?.timestamp || null);
        }
    }, [layoutMode, currentSymbol, secondaryPeriod, latestBar?.timestamp, syncEnabled, syncSecondaryChart]);

    useEffect(() => {
        if (chartRef.current) {
            applyChartTheme(chartRef.current, chartTheme);
        }
        if (secondaryChartRef.current) {
            applyChartTheme(secondaryChartRef.current, chartTheme);
        }
    }, [chartTheme, candleStyle, applyChartTheme]);

    // Redraw order price lines when active/pending orders change
    const activeOrdersSignature = useMemo(
        () =>
            orders
                .filter(o => o.status === 'OPEN' || o.status === 'PENDING')
                .map(o => `${o.id}:${o.status}:${o.entryPrice}:${o.stopLoss}:${o.takeProfit}`)
                .join('|'),
        [orders]
    );

    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;

        orderOverlayIdsRef.current.forEach(id => {
            try { chart.removeOverlay(id); } catch (_) {}
        });
        orderOverlayIdsRef.current = [];

        const activeOrPending = orders.filter(o => o.status === 'OPEN' || o.status === 'PENDING');
        activeOrPending.forEach(ord => {
            const entryId = chart.createOverlay({
                name: 'priceLine',
                points: [{ value: ord.entryPrice }],
                lock: true,
                styles: {
                    line: {
                        color: ord.side === 'BUY' ? '#2563eb' : '#9333ea',
                        size: 1.5,
                        style: LineType.Solid,
                    },
                },
            });
            if (typeof entryId === 'string') orderOverlayIdsRef.current.push(entryId);

            const slId = chart.createOverlay({
                name: 'priceLine',
                points: [{ value: ord.stopLoss }],
                lock: true,
                styles: {
                    line: {
                        color: '#ef5350',
                        size: 1,
                        style: LineType.Dashed,
                        dashedValue: [4, 4],
                    },
                },
            });
            if (typeof slId === 'string') orderOverlayIdsRef.current.push(slId);

            const tpId = chart.createOverlay({
                name: 'priceLine',
                points: [{ value: ord.takeProfit }],
                lock: true,
                styles: {
                    line: {
                        color: '#26a69a',
                        size: 1,
                        style: LineType.Dashed,
                        dashedValue: [4, 4],
                    },
                },
            });
            if (typeof tpId === 'string') orderOverlayIdsRef.current.push(tpId);
        });
    }, [activeOrdersSignature]);

    // Memoized Callbacks for Layers
    const handleSelectSymbol = useCallback((sym: SymbolInfo) => {
        setCurrentSymbol(sym);
        loadChartData(sym, currentPeriod, dataSource, replayActive, false);
    }, [currentPeriod, dataSource, replayActive, loadChartData]);

    const handleSelectPeriod = useCallback((per: Period) => {
        setCurrentPeriod(per);
        // Phase 4: Preserve exact Replay Timestamp T when switching timeframes!
        loadChartData(currentSymbol, per, dataSource, replayActive, true);
    }, [currentSymbol, dataSource, replayActive, loadChartData]);

    const handleSelectSecondaryPeriod = useCallback((per: Period) => {
        setSecondaryPeriod(per);
    }, []);

    const handleChangeDataSource = useCallback((mode: DataSourceMode) => {
        setDataSource(mode);
        loadChartData(currentSymbol, currentPeriod, mode, replayActive, true);
    }, [currentSymbol, currentPeriod, replayActive, loadChartData]);

    const handleCycleCandleStyle = useCallback(() => {
        setCandleStyle(prev =>
            prev === CandleType.CandleSolid
                ? CandleType.CandleStroke
                : prev === CandleType.CandleStroke
                    ? CandleType.Area
                    : CandleType.CandleSolid
        );
    }, []);

    const handleStepForward = useCallback(() => {
        if (!datafeedRef.current || !chartRef.current) return;
        if (!replayActive) {
            setReplayActive(true);
            const sliced = datafeedRef.current.setReplayMode(true, 0.72, false);
            chartRef.current.applyNewData(sliced);
            return;
        }
        const nextBar = datafeedRef.current.stepReplayForward();
        if (!nextBar) setAutoPlaying(false);
    }, [replayActive]);

    const handleStepBackward = useCallback(() => {
        const df = datafeedRef.current;
        const chart = chartRef.current;
        if (!df || !chart) return;
        const full = df.getFullHistory();
        const state = df.getReplayState();
        if (full.length > 25) {
            const prevIdx = Math.max(15, state.replayIndex - 1);
            const ratio = prevIdx / full.length;
            setReplayActive(true);
            setAutoPlaying(false);
            const sliced = df.setReplayMode(true, ratio, false);
            chart.applyNewData(sliced);
        }
    }, []);

    const handleFastForward = useCallback(() => {
        for (let i = 0; i < 5; i++) handleStepForward();
    }, [handleStepForward]);

    const handleTogglePlay = useCallback(() => {
        if (!replayActive && datafeedRef.current && chartRef.current) {
            setReplayActive(true);
            const bars = datafeedRef.current.setReplayMode(true, 0.72, false);
            chartRef.current.applyNewData(bars);
        }
        setAutoPlaying(p => !p);
    }, [replayActive]);

    const handleChangeSpeed = useCallback((val: string) => {
        setReplaySpeedLabel(val);
        if (val === '1m') setReplaySpeedMs(700);
        else if (val === '5m') setReplaySpeedMs(400);
        else if (val === '15m') setReplaySpeedMs(200);
        else if (val === '10x') setReplaySpeedMs(90);
    }, []);

    const handleJumpToRatio = useCallback((ratio: number) => {
        const df = datafeedRef.current;
        const chart = chartRef.current;
        if (!df || !chart) return;
        setAutoPlaying(false);
        setReplayActive(ratio < 1.0);
        const bars = df.setReplayMode(ratio < 1.0, ratio, false);
        chart.applyNewData(bars);
    }, []);

    const handleJumpToTimestamp = useCallback((timestampMs: number) => {
        const df = datafeedRef.current;
        const chart = chartRef.current;
        if (!df || !chart) return;
        setAutoPlaying(false);
        setReplayActive(true);
        const bars = df.setReplayTimestamp(timestampMs);
        chart.applyNewData(bars);
        const last = bars[bars.length - 1];
        if (last && secondaryChartRef.current) {
            syncSecondaryChart(currentSymbol, secondaryPeriod, last.timestamp);
        }
    }, [currentSymbol, secondaryPeriod, syncSecondaryChart]);

    useEffect(() => {
        if (!autoPlaying) return;
        const timer = setInterval(handleStepForward, replaySpeedMs);
        return () => clearInterval(timer);
    }, [autoPlaying, replaySpeedMs, handleStepForward]);

    const handleSelectDrawingTool = useCallback((overlayName: string) => {
        const chart = chartRef.current;
        if (!chart) return;
        const id = chart.createOverlay({
            name: overlayName,
            mode: magnetMode ? OverlayMode.WeakMagnet : OverlayMode.Normal,
            lock: drawingsLocked,
            visible: drawingsVisible,
        });
        if (typeof id === 'string') drawnOverlayIdsRef.current.push(id);
    }, [magnetMode, drawingsLocked, drawingsVisible]);

    const handleUndoDrawing = useCallback(() => {
        const chart = chartRef.current;
        if (!chart || drawnOverlayIdsRef.current.length === 0) return;
        const lastId = drawnOverlayIdsRef.current.pop();
        if (lastId) chart.removeOverlay(lastId);
    }, []);

    const handleClearDrawings = useCallback(() => {
        const chart = chartRef.current;
        if (!chart) return;
        drawnOverlayIdsRef.current.forEach(id => {
            try { chart.removeOverlay(id); } catch (_) {}
        });
        drawnOverlayIdsRef.current = [];
    }, []);

    const handleZoomIn = useCallback(() => {
        chartRef.current?.zoomAtCoordinate(1.25);
    }, []);

    const handleToggleMagnet = useCallback(() => {
        setMagnetMode(prev => {
            const next = !prev;
            chartRef.current?.overrideOverlay({ mode: next ? OverlayMode.WeakMagnet : OverlayMode.Normal });
            return next;
        });
    }, []);

    const handleToggleLock = useCallback(() => {
        setDrawingsLocked(prev => {
            const next = !prev;
            chartRef.current?.overrideOverlay({ lock: next });
            return next;
        });
    }, []);

    const handleToggleVisible = useCallback(() => {
        setDrawingsVisible(prev => {
            const next = !prev;
            chartRef.current?.overrideOverlay({ visible: next });
            return next;
        });
    }, []);

    const handleScreenshot = useCallback(() => {
        const chart = chartRef.current;
        if (!chart) return;
        const url = chart.getConvertPictureUrl(true, 'jpeg', chartTheme === 'light' ? '#ffffff' : '#131722');
        const a = document.createElement('a');
        a.href = url;
        a.download = `Backtest_${currentSymbol.ticker}_${currentPeriod.text}.jpg`;
        a.click();
    }, [chartTheme, currentSymbol.ticker, currentPeriod.text]);

    const handleQuickLimitOrderAtPrice = useCallback((priceStr: string) => {
        setOrderType('LIMIT');
        setLimitEntryPrice(priceStr);
        setRightDrawer('trade');
    }, []);

    const executeOrderWithSide = useCallback((forcedSide?: 'BUY' | 'SELL') => {
        if (!latestBar) return; // nothing loaded (feed down): no price to trade at
        const side = forcedSide || orderSide;
        const bid = latestBar.close;
        const price = orderType === 'MARKET' ? bid : (parseFloat(limitEntryPrice) || bid);
        const decimals = currentSymbol.pricePrecision ?? (price < 10 ? 5 : 2);
        const realized = computeStats(orders, initialBalance).realizedBalance;

        const order = createOrder({
            symbol: currentSymbol.ticker,
            side,
            orderType,
            price,
            slDistance: price * (slDistancePct / 100),
            rrRatio: rrTarget,
            riskAmount: Number(((realized * riskPercent) / 100).toFixed(2)),
            lots,
            spread: Math.max(0, spread || 0),
            commission: Math.max(0, commission || 0),
            openedAt: latestBar.timestamp,
            decimals,
        }, `#${Math.floor(100000 + Math.random() * 900000)}`);

        setOrders(prev => [order, ...prev]);
    }, [latestBar, orderType, limitEntryPrice, currentSymbol, orders, initialBalance, riskPercent, slDistancePct, rrTarget, orderSide, lots, spread, commission]);

    const handleExecuteOrder = useCallback(() => {
        executeOrderWithSide();
    }, [executeOrderWithSide]);

    const handleResetSimulation = useCallback(() => {
        setAutoPlaying(false);
        setOrders([]);
        setJournalNotes('');
        lastCutoffRef.current = null;
        try {
            localStorage.removeItem(LOCAL_STORAGE_KEY);
        } catch (_) {}
    }, []);

    // Global Keyboard Shortcuts (Phase 3)
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
                if (e.key === 'Escape') {
                    target.blur();
                }
                return;
            }

            if (e.code === 'Space') {
                e.preventDefault();
                handleTogglePlay();
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                handleStepForward();
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                handleStepBackward();
            } else if (e.altKey && (e.key === 'b' || e.key === 'B')) {
                e.preventDefault();
                setOrderSide('BUY');
                executeOrderWithSide('BUY');
            } else if (e.altKey && (e.key === 's' || e.key === 'S')) {
                e.preventDefault();
                setOrderSide('SELL');
                executeOrderWithSide('SELL');
            } else if (e.key === 'Escape') {
                setIndicatorModalOpen(false);
                setRightDrawer('none');
                setCutCandleMode(false);
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [handleTogglePlay, handleStepForward, handleStepBackward, executeOrderWithSide]);

    const handleCloseOrCancelOrder = useCallback((id: string) => {
        const df = datafeedRef.current;
        const bar = df?.getReplayState().currentCandle;
        if (!df || !bar) return;
        const { ticker } = df.getContext();

        setOrders(prev => recomputeOrders(
            prev.map(o => {
                if (o.id !== id) return o;
                if (o.status === 'PENDING') return { ...o, cancelledAt: bar.timestamp };
                if (o.status !== 'OPEN') return o;
                if (o.symbol !== ticker) {
                    // Chart shows another instrument: close at its last marked P&L.
                    return { ...o, status: o.pnl >= 0 ? 'WIN' : 'LOSS', exitReason: 'MANUAL', closedAt: bar.timestamp };
                }
                return { ...o, manualCloseAt: bar.timestamp, manualClosePrice: bar.close };
            }),
            { symbol: ticker, candles: df.getFullHistory(), uptoTs: bar.timestamp, rewind: false },
        ));
    }, []);

    const handleToggleIndicator = (code: string, pane: string) => {
        const chart = chartRef.current;
        if (!chart) return;
        if (activeIndicators.includes(code)) {
            if (pane === 'main') chart.removeIndicator('candle_pane', code);
            else chart.removeIndicator(`pane_${code}`, code);
            setActiveIndicators(prev => prev.filter(i => i !== code));
        } else {
            if (pane === 'main') chart.createIndicator(code, true, { id: 'candle_pane' });
            else chart.createIndicator(code, false, { id: `pane_${code}`, height: 100 });
            setActiveIndicators(prev => [...prev, code]);
        }
    };

    const stats = useMemo(() => computeStats(orders, initialBalance), [orders, initialBalance]);
    const openPositions = useMemo(() => orders.filter(o => o.status === 'OPEN'), [orders]);
    const floatingPnl = useMemo(() => Number(openPositions.reduce((s, o) => s + o.pnl, 0).toFixed(2)), [openPositions]);
    const simBalance = stats.realizedBalance;
    const netProfit = Number((stats.netProfit + floatingPnl).toFixed(2));

    const handleSaveReplaySession = useCallback(async () => {
        if (!onSaveReplaySession) return;
        try {
            setSavingSession(true);
            await onSaveReplaySession({
                name: `Replay ${currentSymbol.ticker} (${currentPeriod.text})`,
                mode: 'REPLAY_SESSION',
                strategy: 'Price Action / Fibonacci Replay',
                symbol: currentSymbol.ticker,
                config: {
                    initialBalance,
                    riskPercent,
                    rrTarget,
                    spread,
                    commission,
                    timeframe: currentPeriod.text,
                    dataSource,
                    dataSourceLabel: activeSourceLabel,
                    syntheticData: isSynthetic,
                },
                results: {
                    initialBalance,
                    finalBalance: Number((simBalance + floatingPnl).toFixed(2)),
                    simulatedNetProfit: stats.netProfit,
                    floatingPnl,
                    simulatedTrades: stats.trades,
                    simulatedWins: stats.wins,
                    simulatedLosses: stats.losses,
                    simulatedWinRate: stats.winRate,
                    simulatedProfitFactor: stats.profitFactor,
                    expectancy: stats.expectancy,
                    avgR: stats.avgR,
                    maxDrawdown: stats.maxDrawdown,
                    maxDrawdownPct: stats.maxDrawdownPct,
                },
                notes: journalNotes || `Sessão de Replay em ${currentSymbol.ticker} (${accountName})`,
            });
            setSavedSuccess(true);
            setTimeout(() => setSavedSuccess(false), 2500);
        } finally {
            setSavingSession(false);
        }
    }, [onSaveReplaySession, currentSymbol.ticker, currentPeriod.text, initialBalance, riskPercent, rrTarget, spread, commission, dataSource, activeSourceLabel, isSynthetic, simBalance, floatingPnl, stats, journalNotes, accountName]);

    const isLight = chartTheme === 'light';
    const decimals = currentSymbol.pricePrecision ?? 2;

    const formattedReplayClock = useMemo(() => {
        if (!latestBar?.timestamp) return 'Fri, Oct 23, 2026 02:00 (GMT+2)';
        return (
            new Date(latestBar.timestamp).toLocaleString('en-US', {
                weekday: 'short',
                month: 'short',
                day: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
            }) + ' (GMT+2)'
        );
    }, [latestBar?.timestamp]);

    return (
        <div className="space-y-2.5">
            {/* TOP PLAN HISTORY BANNER (Traynio Reference Style) */}
            {showPlanBanner && (
                <div className={`px-4 py-2 rounded-xl border flex items-center justify-between text-xs transition-colors ${
                    isLight
                        ? 'bg-[#f4f6f9] border-slate-200/80 text-slate-600'
                        : 'bg-[#1a1f2e] border-slate-800 text-slate-300'
                }`}>
                    <div>
                        {planLimits.isPaid ? (
                            <>
                                <span className="font-bold text-indigo-600 dark:text-indigo-400">{planLimits.tier} Plan:</span>{' '}
                                <span>Histórico completo desbloqueado ({planLimits.maxDays} dias a partir de {planLimits.earliestDate}) · Fonte: <strong>{activeSourceLabel}</strong></span>
                            </>
                        ) : (
                            <>
                                <span>Free account: the chart shows the last {planLimits.maxDays} days, from {planLimits.earliestDate}. A </span>
                                <a href="/pricing" className="underline font-semibold text-slate-800 dark:text-white hover:text-indigo-600">
                                    paid plan
                                </a>
                                <span> unlocks the full history.</span>
                            </>
                        )}
                    </div>
                    <button
                        onClick={() => setShowPlanBanner(false)}
                        className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer opacity-60 hover:opacity-100"
                        title="Ocultar aviso"
                    >
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* FEED STATUS: outages and simulated data are always explicit */}
            {feedError ? (
                <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-danger/40 bg-danger/10 px-4 py-2 text-xs text-danger-fg">
                    <strong className="font-semibold">Feed indisponível.</strong>
                    <span>{feedError}</span>
                    <span className="text-fg-muted">Nenhum preço simulado foi usado no lugar. Tente outra fonte ou o modo Demo.</span>
                </div>
            ) : isSynthetic ? (
                <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
                    <strong className="font-semibold">Modo Demo:</strong>
                    <span>os preços são gerados e não representam o mercado. Use apenas para treinar a interface.</span>
                </div>
            ) : feedLoading ? (
                <div role="status" className="rounded-xl border border-line bg-surface-2 px-4 py-2 text-xs text-fg-muted">
                    A carregar histórico…
                </div>
            ) : null}

            <div className={`rounded-2xl overflow-hidden border shadow-2xl select-none transition-colors ${
                isLight ? 'bg-white border-slate-200 text-slate-800' : 'bg-[#131722] border-slate-800 text-slate-100'
            }`}>
                {/* LAYER 1: TOP TOOLBAR */}
                <TopToolbarLayer
                    isLight={isLight}
                    currentSymbol={currentSymbol}
                    currentPeriod={currentPeriod}
                    secondaryPeriod={secondaryPeriod}
                    layoutMode={layoutMode}
                    activeIndicatorsCount={activeIndicators.length}
                    dataSource={dataSource}
                    onSelectSymbol={handleSelectSymbol}
                    onSelectPeriod={handleSelectPeriod}
                    onSelectSecondaryPeriod={handleSelectSecondaryPeriod}
                    onChangeLayoutMode={setLayoutMode}
                    onCycleCandleStyle={handleCycleCandleStyle}
                    onOpenIndicators={() => setIndicatorModalOpen(true)}
                    onUndoDrawing={handleUndoDrawing}
                    onClearDrawings={handleClearDrawings}
                    onChangeDataSource={handleChangeDataSource}
                    onToggleTheme={() => setChartTheme(t => (t === 'light' ? 'dark' : 'light'))}
                    onToggleTradeDrawer={() => setRightDrawer(d => (d === 'trade' ? 'none' : 'trade'))}
                    onResetSimulation={handleResetSimulation}
                    onScreenshot={handleScreenshot}
                />

                {/* WORKSPACE: LAYER 2 (LEFT TOOLS) + LAYER 3 & 4 (CHART(S) & FLOATING PILL) + LAYER 5 (RIGHT PANEL) */}
                <div className="relative flex h-[520px] md:h-[600px]">
                    {/* LAYER 2: LEFT DRAWING SIDEBAR */}
                    <LeftDrawingLayer
                        isLight={isLight}
                        cutCandleMode={cutCandleMode}
                        magnetMode={magnetMode}
                        drawingsLocked={drawingsLocked}
                        drawingsVisible={drawingsVisible}
                        onSelectDrawingTool={handleSelectDrawingTool}
                        onZoomIn={handleZoomIn}
                        onToggleMagnet={handleToggleMagnet}
                        onToggleLock={handleToggleLock}
                        onToggleVisible={handleToggleVisible}
                        onClearDrawings={handleClearDrawings}
                    />

                    {/* CENTER CANVAS AREA (Supports 1x1 Single or 1x2 Split-Screen Multi-Timeframe) */}
                    <div className="flex-1 relative flex overflow-hidden">
                        {/* PRIMARY CHART CONTAINER */}
                        <div className={`relative h-full ${layoutMode === '1x2' ? 'w-1/2 border-r border-slate-200 dark:border-slate-800' : 'w-full'}`}>
                            {/* LAYER 3: 60FPS ISOLATED LEGEND & CROSSHAIR (+) BUTTON */}
                            <ChartLegendOverlayLayer
                                ref={legendOverlayRef}
                                isLight={isLight}
                                ticker={currentSymbol.ticker}
                                periodText={currentPeriod.text}
                                decimals={decimals}
                                initialBar={latestBar}
                                cutCandleMode={cutCandleMode}
                                onCancelCutCandle={() => setCutCandleMode(false)}
                                onQuickLimitOrderAtPrice={handleQuickLimitOrderAtPrice}
                            />

                            {/* NATIVE KLINECHARTS PRIMARY CANVAS */}
                            <div ref={chartDivRef} className="w-full h-full" />
                        </div>

                        {/* SECONDARY CHART CONTAINER (Only rendered in 1x2 Split-Screen Mode) */}
                        {layoutMode === '1x2' && (
                            <div className="relative w-1/2 h-full">
                                <div className="absolute top-2.5 left-3 z-20 flex items-center gap-2 pointer-events-auto">
                                    <span className={`px-2 py-0.5 rounded text-xs font-bold border ${
                                        isLight ? 'bg-white/90 border-slate-200 text-slate-800' : 'bg-slate-900/90 border-slate-700 text-white'
                                    }`}>
                                        {currentSymbol.ticker} · {secondaryPeriod.text} {syncEnabled ? '(Sync ✓)' : ''}
                                    </span>
                                    <div className="flex items-center gap-0.5 bg-black/5 dark:bg-white/5 p-0.5 rounded-md">
                                        {TIMEFRAMES.map(tf => (
                                            <button
                                                key={tf.text}
                                                onClick={() => handleSelectSecondaryPeriod(tf)}
                                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                                                    secondaryPeriod.text === tf.text
                                                        ? 'bg-indigo-600 text-white'
                                                        : ' opacity-70 hover:opacity-100'
                                                }`}
                                            >
                                                {tf.text}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div ref={secondaryChartDivRef} className="w-full h-full" />
                            </div>
                        )}

                        {/* LAYER 4: GPU-ACCELERATED FLOATING REPLAY BAR */}
                        <FloatingReplayBarLayer
                            isLight={isLight}
                            autoPlaying={autoPlaying}
                            replaySpeedLabel={replaySpeedLabel}
                            syncEnabled={syncEnabled}
                            cutCandleMode={cutCandleMode}
                            savingSession={savingSession}
                            savedSuccess={savedSuccess}
                            onStepBackward={handleStepBackward}
                            onTogglePlay={handleTogglePlay}
                            onStepForward={handleStepForward}
                            onFastForward={handleFastForward}
                            onChangeSpeed={handleChangeSpeed}
                            onToggleSync={() => setSyncEnabled(s => !s)}
                            onActivateCutCandle={() => setCutCandleMode(true)}
                            onJumpToRatio={handleJumpToRatio}
                            onJumpToTimestamp={handleJumpToTimestamp}
                            onToggleTradeDrawer={() => setRightDrawer(d => (d === 'trade' ? 'none' : 'trade'))}
                            onToggleJournalDrawer={() => setRightDrawer(d => (d === 'journal' ? 'none' : 'journal'))}
                            onSaveSession={handleSaveReplaySession}
                        />
                    </div>

                    {/* LAYER 5: RIGHT SLIDE-OVER & ACTION BAR */}
                    <RightSidePanelLayer
                        isLight={isLight}
                        ticker={currentSymbol.ticker}
                        rightDrawer={rightDrawer}
                        orderSide={orderSide}
                        orderType={orderType}
                        limitEntryPrice={limitEntryPrice}
                        riskPercent={riskPercent}
                        slDistancePct={slDistancePct}
                        rrTarget={rrTarget}
                        spread={spread}
                        commission={commission}
                        onSetSpread={setSpread}
                        onSetCommission={setCommission}
                        journalNotes={journalNotes}
                        simBalance={simBalance}
                        floatingPnl={floatingPnl}
                        netProfit={netProfit}
                        savingSession={savingSession}
                        savedSuccess={savedSuccess}
                        onSetRightDrawer={setRightDrawer}
                        onSetOrderSide={setOrderSide}
                        onSetOrderType={setOrderType}
                        onSetLimitEntryPrice={setLimitEntryPrice}
                        onSetRiskPercent={setRiskPercent}
                        onSetSlDistancePct={setSlDistancePct}
                        onSetRrTarget={setRrTarget}
                        onSetJournalNotes={setJournalNotes}
                        onExecuteOrder={handleExecuteOrder}
                        onSaveSession={handleSaveReplaySession}
                        onClearDrawings={handleClearDrawings}
                    />
                </div>

                {/* LAYER 6: BOTTOM POSITIONS / PENDING / HISTORY DOCK */}
                <BottomDockLayer
                    isLight={isLight}
                    orders={orders}
                    simBalance={simBalance}
                    floatingPnl={floatingPnl}
                    netProfit={netProfit}
                    formattedReplayClock={formattedReplayClock}
                    onCloseOrCancelOrder={handleCloseOrCancelOrder}
                />

                {/* LAYER 7: INDICATORS MODAL */}
                {indicatorModalOpen && (
                    <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50">
                        <div className={`w-96 rounded-2xl border p-5 shadow-2xl ${
                            isLight ? 'bg-white border-slate-200 text-slate-800' : 'bg-slate-900 border-slate-700 text-white'
                        }`}>
                            <div className="flex items-center justify-between border-b pb-3 mb-3 border-slate-200 dark:border-slate-800">
                                <h3 className="font-bold text-sm">Indicadores Técnicos (fx)</h3>
                                <button onClick={() => setIndicatorModalOpen(false)} className="cursor-pointer opacity-60 hover:opacity-100">
                                    <X size={16} />
                                </button>
                            </div>
                            <div className="space-y-1.5">
                                {AVAILABLE_INDICATORS.map(ind => {
                                    const isAdded = activeIndicators.includes(ind.code);
                                    return (
                                        <button
                                            key={ind.code}
                                            onClick={() => handleToggleIndicator(ind.code, ind.pane)}
                                            className={`w-full px-3 py-2 rounded-xl text-xs flex items-center justify-between cursor-pointer border transition-colors ${
                                                isAdded
                                                    ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-600 dark:text-indigo-300 font-bold'
                                                    : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800'
                                            }`}
                                        >
                                            <span>{ind.name}</span>
                                            <span className="text-[10px] uppercase">{isAdded ? 'Ativo ✓' : '+ Adicionar'}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
