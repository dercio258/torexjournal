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
    YAxisType,
} from 'klinecharts';
import { X } from 'lucide-react';
import api from '../api';
import { useTheme } from '../context/ThemeContext';
import { useChartTheme } from '../hooks/useChartTheme';
import { CustomKLineDatafeed, DataSourceMode, DEFAULT_SYMBOLS, FeedStats } from '../services/klineDatafeed';
import { SymbolInfo, Period } from '@klinecharts/pro';
import { ReplayOrder, TIMEFRAMES, AVAILABLE_INDICATORS } from './kline-replay/types';
import { createOrder, recomputeOrders, computeStats } from './kline-replay/engine';
import { ensureCustomOverlays, setOverlayChartDataGetter } from './kline-replay/overlays/registerCustomOverlays';
import { TopToolbarLayer, ChartLayoutMode } from './kline-replay/layers/TopToolbarLayer';
import { LeftDrawingLayer } from './kline-replay/layers/LeftDrawingLayer';
import { ChartLegendOverlayLayer, ChartLegendOverlayRef } from './kline-replay/layers/ChartLegendOverlayLayer';
import { FloatingReplayBarLayer } from './kline-replay/layers/FloatingReplayBarLayer';
import { RightSidePanelLayer, RightDrawerMode, DrawnObjectItem } from './kline-replay/layers/RightSidePanelLayer';
import { BottomDockLayer } from './kline-replay/layers/BottomDockLayer';
import { DrawingStyleToolbarLayer, DrawingStyleState, OverlayPointCoord } from './kline-replay/layers/DrawingStyleToolbarLayer';

function hexToRgba(hex: string, opacityPct: number): string {
    const clean = hex.replace('#', '').trim();
    const alpha = Math.max(0, Math.min(1, opacityPct / 100));
    if (clean.length === 6) {
        const r = parseInt(clean.slice(0, 2), 16);
        const g = parseInt(clean.slice(2, 4), 16);
        const b = parseInt(clean.slice(4, 6), 16);
        if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }
    }
    return hex;
}

const DEFAULT_DRAWING_STYLE: DrawingStyleState = {
    lineColor: '#2962ff',
    lineOpacity: 100,
    lineSize: 2,
    lineStyle: 'solid',
    fillColor: '#2962ff',
    fillOpacity: 16,
    textColor: '#ffffff',
    textSize: 12,
    extendData: '',
};

function buildOverlayStylesPayload(st: DrawingStyleState) {
    const lineRgba = hexToRgba(st.lineColor, st.lineOpacity);
    const fillRgba = hexToRgba(st.fillColor, st.fillOpacity);
    const kLineType = st.lineStyle === 'solid' ? LineType.Solid : LineType.Dashed;
    const dashedValue = st.lineStyle === 'dotted' ? [2, 3] : st.lineStyle === 'dashed' ? [6, 4] : [2, 2];

    return {
        point: {
            color: st.lineColor,
            activeColor: st.lineColor,
        },
        line: {
            color: lineRgba,
            size: st.lineSize,
            style: kLineType,
            dashedValue,
        },
        polygon: {
            color: fillRgba,
            borderColor: lineRgba,
            borderSize: st.lineSize,
            borderStyle: kLineType,
            borderDashedValue: dashedValue,
        },
        rect: {
            color: fillRgba,
            borderColor: lineRgba,
            borderSize: st.lineSize,
            borderStyle: kLineType,
            borderDashedValue: dashedValue,
        },
        circle: {
            color: fillRgba,
            borderColor: lineRgba,
            borderSize: st.lineSize,
            borderStyle: kLineType,
            borderDashedValue: dashedValue,
        },
        arc: {
            color: lineRgba,
            size: st.lineSize,
            style: kLineType,
            dashedValue,
        },
        text: {
            color: st.textColor,
            size: st.textSize,
            backgroundColor: lineRgba,
            borderColor: lineRgba,
        },
    };
}

const LOCAL_STORAGE_KEY = 'cossa_kline_replay_state_v1';

interface PersistedReplayState {
    ticker?: string;
    periodText?: string;
    secondaryPeriodText?: string;
    layoutMode?: ChartLayoutMode;
    orders?: ReplayOrder[];
    journalNotes?: string;
    /** Replay cutoff at save time, so restored orders line up with the chart. */
    replayTimestamp?: number | null;
    spread?: number;
    commission?: number;
}

function loadPersistedState(storageKey: string): PersistedReplayState | null {
    try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (_) {
        return null;
    }
}

export interface SessionStateSyncPayload {
    currentBalance: number;
    netPnl: number;
    closedTradesCount: number;
    winsCount: number;
    lossesCount: number;
    winRate: number;
    profitFactor: number;
    expectancy: number;
    avgR: number;
    maxDrawdown: number;
    maxDrawdownPct: number;
    orders: ReplayOrder[];
    journalNotes: string;
    replayTimestamp: number | null;
    primarySymbol: string;
    timeframe: string;
    spread: number;
    commission: number;
    deltaSeconds?: number;
}

interface KLineChartProTerminalProps {
    sessionId?: string;
    sessionName?: string;
    strategyName?: string;
    sessionPairs?: string[];
    initialSymbolTicker?: string;
    initialPeriodText?: string;
    initialRiskPercent?: number;
    initialRrTarget?: number;
    initialOrders?: ReplayOrder[];
    initialJournalNotes?: string;
    initialReplayTimestamp?: number | null;
    initialBalance?: number;
    accountName?: string;
    onBackToHub?: () => void;
    onSessionStateSync?: (payload: SessionStateSyncPayload) => void;
    onSaveReplaySession?: (sessionPayload: any) => Promise<void>;
    onFullscreenChange?: (isFullscreen: boolean) => void;
}

export const KLineChartProTerminal: React.FC<KLineChartProTerminalProps> = ({
    sessionId,
    sessionName,
    strategyName,
    sessionPairs,
    initialSymbolTicker,
    initialPeriodText,
    initialRiskPercent,
    initialRrTarget,
    initialOrders,
    initialJournalNotes,
    initialReplayTimestamp,
    initialBalance = 10000,
    accountName = 'Conta Principal',
    onBackToHub,
    onSessionStateSync,
    onSaveReplaySession,
    onFullscreenChange,
}) => {
    ensureCustomOverlays();

    const effectiveStorageKey = useMemo(
        () => (sessionId ? `${LOCAL_STORAGE_KEY}_${sessionId}` : LOCAL_STORAGE_KEY),
        [sessionId]
    );
    const saved = useMemo(() => loadPersistedState(effectiveStorageKey), [effectiveStorageKey]);

    const chartDivRef = useRef<HTMLDivElement | null>(null);
    const chartRef = useRef<Chart | null>(null);
    const secondaryChartDivRef = useRef<HTMLDivElement | null>(null);
    const secondaryChartRef = useRef<Chart | null>(null);
    const datafeedRef = useRef<CustomKLineDatafeed | null>(null);
    const legendOverlayRef = useRef<ChartLegendOverlayRef | null>(null);
    const drawnOverlayIdsRef = useRef<string[]>([]);
    const pendingOverlayIdRef = useRef<string | null>(null);
    const orderOverlayIdsRef = useRef<string[]>([]);
    const cutCandleModeRef = useRef<boolean>(false);
    const rafCrosshairRef = useRef<number | null>(null);
    const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
    const [drawnItems, setDrawnItems] = useState<DrawnObjectItem[]>([]);

    useEffect(() => {
        api.get('/tradingview/replay-limits')
            .then(res => {
                if (res?.data?.tier) {
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
    // Chart follows the app theme; canvas colors come from the design tokens.
    const { theme: chartTheme, toggleTheme } = useTheme();
    const ct = useChartTheme();
    const [layoutMode, setLayoutMode] = useState<ChartLayoutMode>(saved?.layoutMode || '1x1');
    const [dataSource, setDataSource] = useState<DataSourceMode>('TRADINGVIEW');
    const [activeSourceLabel, setActiveSourceLabel] = useState<string>('TradingView');
    const [isSynthetic, setIsSynthetic] = useState<boolean>(false);

    // Symbol & Period (Primary + Secondary for 1x2 Split-Screen)
    const [currentSymbol, setCurrentSymbol] = useState<SymbolInfo>(() => {
        const ticker = saved?.ticker || initialSymbolTicker;
        if (ticker) {
            const found = DEFAULT_SYMBOLS.find(s => s.ticker === ticker);
            if (found) return found;
        }
        return DEFAULT_SYMBOLS[0];
    });
    const [currentPeriod, setCurrentPeriod] = useState<Period>(() => {
        const pText = saved?.periodText || initialPeriodText;
        if (pText) {
            const found = TIMEFRAMES.find(t => t.text === pText);
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
    const [zoomAreaMode, setZoomAreaMode] = useState<boolean>(false);
    const zoomAreaModeRef = useRef<boolean>(false);
    const [zoomBox, setZoomBox] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
    const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
    const [drawingStylesById, setDrawingStylesById] = useState<Record<string, DrawingStyleState>>({});
    const [pointsTick, setPointsTick] = useState<number>(0);
    const [magnetMode, setMagnetMode] = useState<boolean>(false);
    const [drawingsLocked, setDrawingsLocked] = useState<boolean>(false);
    const [drawingsVisible, setDrawingsVisible] = useState<boolean>(true);

    // Vertical Axis (Y-Axis) Precision Controls
    const [yAxisAutoScale, setYAxisAutoScale] = useState<boolean>(true);
    const yAxisAutoScaleRef = useRef<boolean>(true);
    const [yAxisLogScale, setYAxisLogScale] = useState<boolean>(false);

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
    const [rightDrawer, setRightDrawer] = useState<RightDrawerMode>('none');
    const [orderSide, setOrderSide] = useState<'BUY' | 'SELL'>('BUY');
    const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET');
    const [limitEntryPrice, setLimitEntryPrice] = useState<string>('');
    const [riskPercent, setRiskPercent] = useState<number>(initialRiskPercent ?? 1.0);
    const [lots] = useState<number>(1.0); // informational only: size comes from risk %
    const [slDistancePct, setSlDistancePct] = useState<number>(0.30);
    const [rrTarget, setRrTarget] = useState<number>(initialRrTarget ?? 2.0);
    const [journalNotes, setJournalNotes] = useState<string>(saved?.journalNotes ?? initialJournalNotes ?? '');
    const [spread, setSpread] = useState<number>(saved?.spread ?? 0);
    const [commission, setCommission] = useState<number>(saved?.commission ?? 0);

    // Simulation portfolio. Orders are the single source of truth; the balance
    // is derived from closed trades, so StrictMode double-invocation is harmless.
    const [orders, setOrders] = useState<ReplayOrder[]>(saved?.orders ?? initialOrders ?? []);
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
                orders,
                journalNotes,
                replayTimestamp: replayActive ? latestBar?.timestamp ?? initialReplayTimestamp ?? null : null,
                spread,
                commission,
            };
            localStorage.setItem(effectiveStorageKey, JSON.stringify(payload));
        } catch (_) {}
    }, [effectiveStorageKey, currentSymbol.ticker, currentPeriod.text, secondaryPeriod.text, layoutMode, orders, journalNotes, replayActive, latestBar?.timestamp, initialReplayTimestamp, spread, commission]);

    useEffect(() => {
        cutCandleModeRef.current = cutCandleMode;
    }, [cutCandleMode]);

    useEffect(() => {
        zoomAreaModeRef.current = zoomAreaMode;
    }, [zoomAreaMode]);

    // Precision Vertical Axis (Y-Axis) Helpers
    const getCandlePaneAndYAxis = useCallback((chart: Chart | null) => {
        if (!chart) return null;
        const pane = (chart as any).getDrawPaneById?.('candle_pane');
        const yAxis = pane?.getAxisComponent?.();
        if (!pane || !yAxis) return null;
        return { pane, yAxis };
    }, []);

    const applyYAxisRange = useCallback((chart: Chart | null, rawFrom: number, rawTo: number) => {
        const ctx = getCandlePaneAndYAxis(chart);
        if (!ctx || !Number.isFinite(rawFrom) || !Number.isFinite(rawTo)) return;
        const { yAxis } = ctx;
        const from = Math.min(rawFrom, rawTo);
        const to = Math.max(rawFrom, rawTo);
        const range = Math.max(1e-8, to - from);
        const realFrom = typeof yAxis.convertToRealValue === 'function' ? yAxis.convertToRealValue(from) : from;
        const realTo = typeof yAxis.convertToRealValue === 'function' ? yAxis.convertToRealValue(to) : to;
        const realRange = Math.max(1e-8, realTo - realFrom);

        yAxis.setRange({
            from,
            to,
            range,
            realFrom,
            realTo,
            realRange,
        });
        (chart as any).adjustPaneViewport?.(false, true, true, true, true);
        if (chart === chartRef.current && yAxisAutoScaleRef.current) {
            yAxisAutoScaleRef.current = false;
            setYAxisAutoScale(false);
        }
    }, [getCandlePaneAndYAxis]);

    const handleResetYAxisAutoScale = useCallback(() => {
        [chartRef.current, secondaryChartRef.current].forEach((c) => {
            const ctx = getCandlePaneAndYAxis(c);
            if (ctx) {
                ctx.yAxis.setAutoCalcTickFlag?.(true);
                (c as any).adjustPaneViewport?.(false, true, true, true, true);
            }
        });
        yAxisAutoScaleRef.current = true;
        setYAxisAutoScale(true);
    }, [getCandlePaneAndYAxis]);

    const handleScaleYAxisByFactor = useCallback((factor: number, anchorRatio: number = 0.5, targetChart?: Chart | null) => {
        const chart = targetChart ?? chartRef.current;
        const ctx = getCandlePaneAndYAxis(chart);
        if (!ctx) return;
        const cur = ctx.yAxis.getRange?.();
        if (!cur || !Number.isFinite(cur.from) || !Number.isFinite(cur.to)) return;
        const span = Math.max(1e-8, cur.to - cur.from);
        const clampedRatio = Math.max(0.05, Math.min(0.95, anchorRatio));
        const anchorVal = cur.to - clampedRatio * span;
        const nextSpan = Math.max(1e-7, span * factor);
        const nextTo = anchorVal + clampedRatio * nextSpan;
        const nextFrom = nextTo - nextSpan;
        applyYAxisRange(chart, nextFrom, nextTo);
    }, [getCandlePaneAndYAxis, applyYAxisRange]);

    const handleToggleYAxisLogScale = useCallback(() => {
        setYAxisLogScale(prev => {
            const next = !prev;
            const axisType = next ? YAxisType.Log : YAxisType.Normal;
            [chartRef.current, secondaryChartRef.current].forEach((c) => {
                if (!c) return;
                c.setStyles({ yAxis: { type: axisType } } as any);
                const ctx = getCandlePaneAndYAxis(c);
                if (ctx) {
                    ctx.yAxis.setAutoCalcTickFlag?.(true);
                    (c as any).adjustPaneViewport?.(false, true, true, true, true);
                }
            });
            yAxisAutoScaleRef.current = true;
            setYAxisAutoScale(true);
            return next;
        });
    }, [getCandlePaneAndYAxis]);

    const bindPrecisionYAxisEvents = useCallback((el: HTMLElement, chart: Chart) => {
        let activeDrag: {
            mode: 'yaxis-scale' | 'canvas-pan';
            startX: number;
            startY: number;
            startFrom: number;
            startTo: number;
            startRange: number;
            paneHeight: number;
            unlockedVertical: boolean;
        } | null = null;

        const getGeometry = (clientX: number, clientY: number) => {
            const rect = el.getBoundingClientRect();
            const localX = clientX - rect.left;
            const localY = clientY - rect.top;
            const ctx = getCandlePaneAndYAxis(chart);
            const mainBounding = ctx?.pane?.getMainWidget?.()?.getBounding?.();
            const yAxisBounding = ctx?.pane?.getYAxisWidget?.()?.getBounding?.();
            const paneHeight = mainBounding?.height || Math.max(180, el.clientHeight - 120);
            const yAxisWidth = Math.max(58, yAxisBounding?.width || 68);
            const isInsideYAxis = localX >= el.clientWidth - yAxisWidth && localX <= el.clientWidth && localY >= 0 && localY <= paneHeight;
            const isInsideMainCandlePane = localX >= 0 && localX < el.clientWidth - yAxisWidth && localY >= 0 && localY <= paneHeight;
            return { localX, localY, paneHeight, yAxisWidth, isInsideYAxis, isInsideMainCandlePane, ctx };
        };

        const isOverlayBusy = () => {
            const overlayStore = (chart as any)._chartStore?.getOverlayStore?.();
            if (!overlayStore) return Boolean(pendingOverlayIdRef.current);
            if (overlayStore.isDrawing?.()) return true;
            const pressed = overlayStore.getPressedInstanceInfo?.();
            return Boolean(pressed?.instance);
        };

        const onHoverMove = (e: MouseEvent) => {
            if (activeDrag || zoomAreaModeRef.current) return;
            const { isInsideYAxis } = getGeometry(e.clientX, e.clientY);
            if (isInsideYAxis) {
                if (el.style.cursor !== 'ns-resize') el.style.cursor = 'ns-resize';
            } else if (el.style.cursor === 'ns-resize') {
                el.style.cursor = '';
            }
        };

        const onWindowMouseMove = (e: MouseEvent) => {
            if (!activeDrag) return;
            if (activeDrag.mode === 'yaxis-scale') {
                const deltaY = e.clientY - activeDrag.startY;
                const scaleFactor = Math.exp(deltaY * 0.0055);
                const mid = (activeDrag.startFrom + activeDrag.startTo) / 2;
                const half = Math.max(1e-8, (activeDrag.startRange * scaleFactor) / 2);
                applyYAxisRange(chart, mid - half, mid + half);
                return;
            }

            if (activeDrag.mode === 'canvas-pan') {
                if (isOverlayBusy() || zoomAreaModeRef.current || cutCandleModeRef.current) {
                    activeDrag = null;
                    return;
                }
                const deltaY = e.clientY - activeDrag.startY;
                if (!activeDrag.unlockedVertical && Math.abs(deltaY) >= 5) {
                    activeDrag.unlockedVertical = true;
                }
                if (activeDrag.unlockedVertical) {
                    const priceShift = (deltaY / Math.max(100, activeDrag.paneHeight)) * activeDrag.startRange;
                    applyYAxisRange(chart, activeDrag.startFrom + priceShift, activeDrag.startTo + priceShift);
                }
            }
        };

        const onWindowMouseUp = () => {
            if (activeDrag) {
                activeDrag = null;
                window.removeEventListener('mousemove', onWindowMouseMove, true);
                window.removeEventListener('mouseup', onWindowMouseUp, true);
            }
        };

        const onMouseDownCapture = (e: MouseEvent) => {
            if (e.button !== 0 || zoomAreaModeRef.current || cutCandleModeRef.current) return;
            const { isInsideYAxis, isInsideMainCandlePane, paneHeight, ctx } = getGeometry(e.clientX, e.clientY);
            if (!ctx) return;
            const curRange = ctx.yAxis.getRange?.();
            if (!curRange || !Number.isFinite(curRange.from) || !Number.isFinite(curRange.to)) return;

            if (isInsideYAxis) {
                // Intercept Y-Axis drag to provide smooth exponential vertical price scale compression/expansion
                e.stopPropagation();
                e.preventDefault();
                activeDrag = {
                    mode: 'yaxis-scale',
                    startX: e.clientX,
                    startY: e.clientY,
                    startFrom: curRange.from,
                    startTo: curRange.to,
                    startRange: Math.max(1e-8, curRange.to - curRange.from),
                    paneHeight,
                    unlockedVertical: true,
                };
                window.addEventListener('mousemove', onWindowMouseMove, true);
                window.addEventListener('mouseup', onWindowMouseUp, true);
                return;
            }

            if (isInsideMainCandlePane && !isOverlayBusy()) {
                // Allow horizontal scroll in klinecharts AND smoothly pan Y-axis when dragging vertically
                activeDrag = {
                    mode: 'canvas-pan',
                    startX: e.clientX,
                    startY: e.clientY,
                    startFrom: curRange.from,
                    startTo: curRange.to,
                    startRange: Math.max(1e-8, curRange.to - curRange.from),
                    paneHeight,
                    unlockedVertical: !ctx.yAxis.getAutoCalcTickFlag?.(),
                };
                window.addEventListener('mousemove', onWindowMouseMove, true);
                window.addEventListener('mouseup', onWindowMouseUp, true);
            }
        };

        const onDblClickCapture = (e: MouseEvent) => {
            const { isInsideYAxis, ctx } = getGeometry(e.clientX, e.clientY);
            if (isInsideYAxis && ctx) {
                e.stopPropagation();
                e.preventDefault();
                ctx.yAxis.setAutoCalcTickFlag?.(true);
                (chart as any).adjustPaneViewport?.(false, true, true, true, true);
                if (chart === chartRef.current) {
                    yAxisAutoScaleRef.current = true;
                    setYAxisAutoScale(true);
                }
            }
        };

        const onWheelCapture = (e: WheelEvent) => {
            const { localY, paneHeight, isInsideYAxis, isInsideMainCandlePane } = getGeometry(e.clientX, e.clientY);
            // Vertical zoom when wheel is used over the Y-axis OR with Ctrl / Alt / Shift over the chart canvas
            if (isInsideYAxis || (isInsideMainCandlePane && (e.ctrlKey || e.altKey || e.shiftKey))) {
                e.preventDefault();
                e.stopPropagation();
                const zoomOut = e.deltaY > 0;
                const factor = zoomOut ? 1.13 : 0.88;
                const anchorRatio = isInsideYAxis
                    ? 0.5
                    : Math.max(0.05, Math.min(0.95, localY / Math.max(100, paneHeight)));
                handleScaleYAxisByFactor(factor, anchorRatio, chart);
            }
        };

        el.addEventListener('mousemove', onHoverMove);
        el.addEventListener('mousedown', onMouseDownCapture, { capture: true });
        el.addEventListener('dblclick', onDblClickCapture, { capture: true });
        el.addEventListener('wheel', onWheelCapture, { capture: true, passive: false });

        return () => {
            onWindowMouseUp();
            el.removeEventListener('mousemove', onHoverMove);
            el.removeEventListener('mousedown', onMouseDownCapture, { capture: true });
            el.removeEventListener('dblclick', onDblClickCapture, { capture: true });
            el.removeEventListener('wheel', onWheelCapture, { capture: true });
        };
    }, [getCandlePaneAndYAxis, applyYAxisRange, handleScaleYAxisByFactor]);

    // Always-current values for callbacks registered once (chart actions, feed listener).
    const liveRef = useRef({ currentSymbol, currentPeriod, secondaryPeriod, dataSource, replayActive, syncEnabled });
    liveRef.current = { currentSymbol, currentPeriod, secondaryPeriod, dataSource, replayActive, syncEnabled };
    const loadChartDataRef = useRef<((sym: SymbolInfo, per: Period, mode: DataSourceMode, isReplay: boolean, preserve?: boolean) => Promise<void>) | null>(null);
    const syncSecondaryRef = useRef<((sym: SymbolInfo, per: Period, ts: number | null) => void) | null>(null);
    const lastCutoffRef = useRef<{ key: string; ts: number } | null>(null);

    // Apply Chart Theme Styles
    const applyChartTheme = useCallback((chart: Chart, _theme?: string) => {
        const withAlpha = (c: string, a: number) => c.replace(/,\s*[\d.]+\)$/, `, ${a})`);
        const grid = { show: true, size: 1, color: ct.grid, style: LineType.Solid };
        const crossLine = { show: true, style: LineType.Dashed, dashedValue: [4, 4], size: 1, color: ct.tick };
        // Inverted chip (fg on canvas) reads in both themes.
        const crossText = {
            show: true, color: ct.background, backgroundColor: ct.tooltipTitle, size: 11,
            paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3, borderRadius: 3,
        };
        chart.setStyles({
            grid: { show: true, horizontal: grid, vertical: { ...grid, show: false } },
            candle: {
                type: candleStyle,
                bar: {
                    upColor: ct.pos, downColor: ct.neg, noChangeColor: ct.tick,
                    upBorderColor: ct.pos, downBorderColor: ct.neg, noChangeBorderColor: ct.tick,
                    upWickColor: ct.pos, downWickColor: ct.neg, noChangeWickColor: ct.tick,
                },
                area: {
                    lineColor: ct.series1,
                    backgroundColor: [
                        { offset: 0, color: withAlpha(ct.series1, 0.01) },
                        { offset: 1, color: withAlpha(ct.series1, 0.18) },
                    ],
                } as any,
                priceMark: {
                    show: true,
                    high: { show: false },
                    low: { show: false },
                    last: {
                        show: true,
                        upColor: ct.pos,
                        downColor: ct.neg,
                        noChangeColor: ct.tick,
                        line: { show: true, style: LineType.Dashed, dashedValue: [4, 4], size: 1 },
                        text: {
                            show: true, size: 11, color: '#ffffff', borderRadius: 3,
                            paddingLeft: 6, paddingTop: 4, paddingRight: 6, paddingBottom: 4,
                        },
                    },
                },
                tooltip: { showRule: 'none' as any },
            },
            indicator: {
                bars: [{ upColor: withAlpha(ct.pos, 0.45), downColor: withAlpha(ct.neg, 0.45), noChangeColor: withAlpha(ct.tick, 0.45) }],
                tooltip: { showRule: 'none' as any },
            },
            xAxis: {
                show: true,
                axisLine: { show: true, color: ct.gridStrong, size: 1 },
                tickText: { show: true, color: ct.tick, size: 11 },
                tickLine: { show: false },
            },
            yAxis: {
                show: true,
                axisLine: { show: false },
                tickText: { show: true, color: ct.tick, size: 11 },
                tickLine: { show: false },
            },
            separator: { size: 1, color: ct.gridStrong },
            crosshair: {
                show: true,
                horizontal: { show: true, line: crossLine, text: crossText },
                vertical: { show: true, line: crossLine, text: crossText },
            },
        });
    }, [candleStyle, ct]);

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

        setOrders(cur => {
            if (cur.length === 0) return cur;
            if (!rewind && !cur.some(o => o.status === 'OPEN' || o.status === 'PENDING')) return cur;
            const candles = df.getFullHistory();
            return recomputeOrders(cur, { symbol: stats.ticker, candles, uptoTs: candle.timestamp, rewind });
        });
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

        const ctx = getCandlePaneAndYAxis(chart);
        if (ctx) {
            ctx.yAxis.setAutoCalcTickFlag?.(true);
        }
        yAxisAutoScaleRef.current = true;
        setYAxisAutoScale(true);

        try {
            await df.getHistoryKLineData(sym, per);
        } catch (_) {
            return;
        }

        const barsToRender = df.setReplayMode(isReplay, 0.72, preserveTimestamp && syncEnabled);
        chart.applyNewData(barsToRender, barsToRender.length > 0);
        (chart as any).adjustPaneViewport?.(false, true, true, true, true);

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
        setOverlayChartDataGetter(() => chart.getDataList() || []);

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
        const unbindYAxis = bindPrecisionYAxisEvents(el, chart);

        return () => {
            if (rafCrosshairRef.current) cancelAnimationFrame(rafCrosshairRef.current);
            unbindYAxis();
            setOverlayChartDataGetter(null);
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
        const unbindSecYAxis = bindPrecisionYAxisEvents(secEl, secChart);

        return () => {
            unbindSecYAxis();
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
                        color: ct.label,
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
                        color: ct.neg,
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
                        color: ct.pos,
                        size: 1,
                        style: LineType.Dashed,
                        dashedValue: [4, 4],
                    },
                },
            });
            if (typeof tpId === 'string') orderOverlayIdsRef.current.push(tpId);
        });
    }, [activeOrdersSignature, ct]);

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

    const handleSelectDrawingTool = useCallback((
        overlayName: string,
        extendData?: string,
        label?: string,
        replacePending?: boolean
    ) => {
        const chart = chartRef.current;
        if (!chart) return;

        setZoomAreaMode(false);
        setZoomBox(null);

        // Only replace an overlay if it is STILL unstarted (currentStep === 1, i.e. 0 clicks on chart).
        // NOTE: KLineCharts fires onDrawStart synchronously inside createOverlay() before returning `id`,
        // so we MUST inspect `ov.isDrawing()` and `ov.currentStep === 1` directly on the overlay instance
        // to avoid ever deleting a drawing that the user has already started or completed!
        if (replacePending && pendingOverlayIdRef.current) {
            const candidateId = pendingOverlayIdRef.current;
            const ov = chart.getOverlayById(candidateId) as any;
            const isStillUnclicked = ov && typeof ov.isDrawing === 'function' && ov.isDrawing() && ov.currentStep === 1;
            if (isStillUnclicked) {
                try { chart.removeOverlay(candidateId); } catch (_) {}
                drawnOverlayIdsRef.current = drawnOverlayIdsRef.current.filter(id => id !== candidateId);
                setDrawnItems(prev => prev.filter(item => item.id !== candidateId));
            }
            pendingOverlayIdRef.current = null;
        }

        const initialStyle: DrawingStyleState = {
            ...DEFAULT_DRAWING_STYLE,
            lineColor: overlayName === 'tvShortPosition' ? '#ef4444' : overlayName === 'tvLongPosition' ? '#10b981' : '#2962ff',
            fillColor: overlayName === 'tvShortPosition' ? '#ef4444' : overlayName === 'tvLongPosition' ? '#10b981' : '#2962ff',
            textSize: overlayName === 'tvEmojiMarker' ? 24 : 12,
            extendData: extendData || '',
        };

        const id = chart.createOverlay({
            name: overlayName,
            extendData,
            mode: magnetMode ? OverlayMode.WeakMagnet : OverlayMode.Normal,
            lock: drawingsLocked,
            visible: drawingsVisible,
            styles: buildOverlayStylesPayload(initialStyle) as any,
            onDrawing: (event: any) => {
                const ov = event?.overlay;
                if (ov && pendingOverlayIdRef.current === ov.id && ov.currentStep !== 1) {
                    pendingOverlayIdRef.current = null;
                }
                return false;
            },
            onDrawEnd: (event: any) => {
                const ov = event?.overlay;
                if (ov && pendingOverlayIdRef.current === ov.id) {
                    pendingOverlayIdRef.current = null;
                }
                setPointsTick(t => t + 1);
                return false;
            },
            onPressedMoveEnd: (event: any) => {
                const ovId = event?.overlay?.id;
                if (ovId) setSelectedDrawingId(ovId);
                setPointsTick(t => t + 1);
                return false;
            },
            onSelected: (event: any) => {
                const ovId = event?.overlay?.id;
                if (ovId) setSelectedDrawingId(ovId);
                setPointsTick(t => t + 1);
                return false;
            },
            onDeselected: (event: any) => {
                const ovId = event?.overlay?.id;
                if (ovId) setSelectedDrawingId(prev => (prev === ovId ? null : prev));
                return false;
            },
            onRemoved: (event: any) => {
                const remId = event?.overlay?.id;
                if (remId) {
                    if (pendingOverlayIdRef.current === remId) pendingOverlayIdRef.current = null;
                    drawnOverlayIdsRef.current = drawnOverlayIdsRef.current.filter(x => x !== remId);
                    setDrawnItems(prev => prev.filter(item => item.id !== remId));
                    setSelectedDrawingId(prev => (prev === remId ? null : prev));
                }
                return false;
            },
        });
        if (typeof id === 'string') {
            pendingOverlayIdRef.current = id;
            drawnOverlayIdsRef.current.push(id);
            setSelectedDrawingId(id);
            setDrawingStylesById(prev => ({ ...prev, [id]: initialStyle }));
            setDrawnItems(prev => [
                ...prev,
                {
                    id,
                    name: overlayName,
                    label: label || overlayName,
                    visible: drawingsVisible,
                    locked: drawingsLocked,
                    color: initialStyle.lineColor,
                    extendData: initialStyle.extendData,
                },
            ]);
        }
    }, [magnetMode, drawingsLocked, drawingsVisible]);

    const handleCancelPendingTool = useCallback(() => {
        setZoomAreaMode(false);
        setZoomBox(null);
        setCutCandleMode(false);
        const chart = chartRef.current;
        if (chart && pendingOverlayIdRef.current) {
            const candidateId = pendingOverlayIdRef.current;
            const ov = chart.getOverlayById(candidateId) as any;
            const isStillUnclicked = ov && typeof ov.isDrawing === 'function' && ov.isDrawing() && ov.currentStep === 1;
            if (isStillUnclicked) {
                try { chart.removeOverlay(candidateId); } catch (_) {}
                drawnOverlayIdsRef.current = drawnOverlayIdsRef.current.filter(id => id !== candidateId);
                setDrawnItems(prev => prev.filter(item => item.id !== candidateId));
            }
            pendingOverlayIdRef.current = null;
        }
    }, []);

    const handleUndoDrawing = useCallback(() => {
        const chart = chartRef.current;
        if (!chart || drawnOverlayIdsRef.current.length === 0) return;
        const lastId = drawnOverlayIdsRef.current.pop();
        if (lastId) {
            if (pendingOverlayIdRef.current === lastId) pendingOverlayIdRef.current = null;
            try { chart.removeOverlay(lastId); } catch (_) {}
            setDrawnItems(prev => prev.filter(item => item.id !== lastId));
            setSelectedDrawingId(prev => (prev === lastId ? null : prev));
        }
    }, []);

    const handleRemoveDrawingById = useCallback((id: string) => {
        const chart = chartRef.current;
        if (!chart) return;
        if (pendingOverlayIdRef.current === id) pendingOverlayIdRef.current = null;
        try { chart.removeOverlay(id); } catch (_) {}
        drawnOverlayIdsRef.current = drawnOverlayIdsRef.current.filter(x => x !== id);
        setDrawnItems(prev => prev.filter(item => item.id !== id));
        setSelectedDrawingId(prev => (prev === id ? null : prev));
    }, []);

    const handleSelectDrawingById = useCallback((id: string) => {
        const chart = chartRef.current;
        if (!chart) return;
        setSelectedDrawingId(id);
        setPointsTick(t => t + 1);
        const ov = chart.getOverlayById(id) as any;
        if (!ov) return;
        // Make sure it's visible so the user can see it when selected
        setDrawnItems(prev => prev.map(item => (item.id === id ? { ...item, visible: true } : item)));
        chart.overrideOverlay({
            id,
            visible: true,
        });
        const firstPt = Array.isArray(ov.points) ? ov.points[0] : null;
        if (firstPt && typeof firstPt.timestamp === 'number') {
            chart.scrollToTimestamp(firstPt.timestamp, 220);
        } else if (firstPt && typeof firstPt.dataIndex === 'number') {
            chart.scrollToDataIndex(firstPt.dataIndex, 220);
        }
    }, []);

    const handleUpdateSelectedStyle = useCallback((patch: Partial<DrawingStyleState>) => {
        const chart = chartRef.current;
        const id = selectedDrawingId;
        if (!chart || !id) return;

        setDrawingStylesById(prev => {
            const current = prev[id] || DEFAULT_DRAWING_STYLE;
            const next: DrawingStyleState = { ...current, ...patch };
            const stylesPayload = buildOverlayStylesPayload(next);
            chart.overrideOverlay({
                id,
                extendData: next.extendData,
                styles: stylesPayload as any,
            });
            setDrawnItems(items =>
                items.map(it =>
                    it.id === id
                        ? { ...it, color: next.lineColor, extendData: next.extendData }
                        : it
                )
            );
            return { ...prev, [id]: next };
        });
    }, [selectedDrawingId]);

    const handleUpdateDrawingLabel = useCallback((id: string, newLabel: string) => {
        setDrawnItems(prev => prev.map(item => (item.id === id ? { ...item, label: newLabel } : item)));
    }, []);

    const handleUpdateSelectedPoint = useCallback((pointIndex: number, patch: Partial<OverlayPointCoord>) => {
        const chart = chartRef.current;
        const id = selectedDrawingId;
        if (!chart || !id) return;
        const ov = chart.getOverlayById(id) as any;
        if (!ov || !Array.isArray(ov.points)) return;

        const dataList = chart.getDataList() || [];
        const nextPoints = ov.points.map((pt: any, idx: number) => {
            if (idx !== pointIndex) return { ...pt };
            const updated = { ...pt, ...patch };
            if (typeof patch.dataIndex === 'number' && dataList[patch.dataIndex]) {
                updated.timestamp = dataList[patch.dataIndex].timestamp;
            }
            return updated;
        });
        chart.overrideOverlay({ id, points: nextPoints });
        setPointsTick(t => t + 1);
    }, [selectedDrawingId]);

    const handleDuplicateDrawing = useCallback((id: string) => {
        const chart = chartRef.current;
        if (!chart) return;
        const ov = chart.getOverlayById(id) as any;
        const sourceItem = drawnItems.find(it => it.id === id);
        if (!ov || !sourceItem) return;

        const sourceStyle = drawingStylesById[id] || DEFAULT_DRAWING_STYLE;
        const clonedPoints = Array.isArray(ov.points)
            ? ov.points.map((pt: any) => ({
                  ...pt,
                  dataIndex: typeof pt.dataIndex === 'number' ? pt.dataIndex + 2 : pt.dataIndex,
                  value: typeof pt.value === 'number' ? pt.value * 1.0004 : pt.value,
              }))
            : [];

        const newId = chart.createOverlay({
            name: sourceItem.name,
            points: clonedPoints,
            extendData: sourceStyle.extendData,
            mode: magnetMode ? OverlayMode.WeakMagnet : OverlayMode.Normal,
            lock: false,
            visible: true,
            styles: buildOverlayStylesPayload(sourceStyle) as any,
            onPressedMoveEnd: (event: any) => {
                const ovId = event?.overlay?.id;
                if (ovId) setSelectedDrawingId(ovId);
                setPointsTick(t => t + 1);
                return false;
            },
            onSelected: (event: any) => {
                const ovId = event?.overlay?.id;
                if (ovId) setSelectedDrawingId(ovId);
                setPointsTick(t => t + 1);
                return false;
            },
            onDeselected: (event: any) => {
                const ovId = event?.overlay?.id;
                if (ovId) setSelectedDrawingId(prev => (prev === ovId ? null : prev));
                return false;
            },
            onRemoved: (event: any) => {
                const remId = event?.overlay?.id;
                if (remId) {
                    drawnOverlayIdsRef.current = drawnOverlayIdsRef.current.filter(x => x !== remId);
                    setDrawnItems(prev => prev.filter(item => item.id !== remId));
                    setSelectedDrawingId(prev => (prev === remId ? null : prev));
                }
                return false;
            },
        });

        if (typeof newId === 'string') {
            drawnOverlayIdsRef.current.push(newId);
            setDrawingStylesById(prev => ({ ...prev, [newId]: { ...sourceStyle } }));
            setDrawnItems(prev => [
                ...prev,
                {
                    id: newId,
                    name: sourceItem.name,
                    label: `${sourceItem.label} (Cópia)`,
                    visible: true,
                    locked: false,
                    color: sourceStyle.lineColor,
                    extendData: sourceStyle.extendData,
                },
            ]);
            setSelectedDrawingId(newId);
            setPointsTick(t => t + 1);
        }
    }, [drawnItems, drawingStylesById, magnetMode]);

    const handleResetDrawingStyle = useCallback((id: string) => {
        const chart = chartRef.current;
        if (!chart) return;
        const item = drawnItems.find(it => it.id === id);
        const resetStyle: DrawingStyleState = {
            ...DEFAULT_DRAWING_STYLE,
            lineColor: item?.name === 'tvShortPosition' ? '#ef4444' : item?.name === 'tvLongPosition' ? '#10b981' : '#2962ff',
            fillColor: item?.name === 'tvShortPosition' ? '#ef4444' : item?.name === 'tvLongPosition' ? '#10b981' : '#2962ff',
            textSize: item?.name === 'tvEmojiMarker' ? 24 : 12,
            extendData: drawingStylesById[id]?.extendData || '',
        };
        setDrawingStylesById(prev => ({ ...prev, [id]: resetStyle }));
        chart.overrideOverlay({
            id,
            styles: buildOverlayStylesPayload(resetStyle) as any,
        });
        setDrawnItems(prev => prev.map(it => (it.id === id ? { ...it, color: resetStyle.lineColor } : it)));
    }, [drawnItems, drawingStylesById]);

    const handleSendPositionToOrderTicket = useCallback((side: 'BUY' | 'SELL', entry: number, tp: number, sl: number) => {
        const dec = currentSymbol.pricePrecision ?? (entry < 10 ? 5 : 2);
        setOrderSide(side);
        setOrderType('LIMIT');
        setLimitEntryPrice(entry.toFixed(dec));
        if (entry > 0) {
            const slDistPct = Math.max(0.01, Number(((Math.abs(entry - sl) / entry) * 100).toFixed(3)));
            const riskAbs = Math.max(0.000001, Math.abs(entry - sl));
            const rewardAbs = Math.abs(tp - entry);
            const rr = Math.max(0.2, Number((rewardAbs / riskAbs).toFixed(2)));
            setSlDistancePct(slDistPct);
            setRrTarget(rr);
        }
        setRightDrawer('trade');
    }, [currentSymbol.pricePrecision]);

    const handleToggleDrawingVisibleById = useCallback((id: string) => {
        const chart = chartRef.current;
        if (!chart) return;
        setDrawnItems(prev =>
            prev.map(item => {
                if (item.id !== id) return item;
                const nextVis = item.visible === false ? true : false;
                chart.overrideOverlay({ id, visible: nextVis });
                return { ...item, visible: nextVis };
            })
        );
    }, []);

    const handleToggleDrawingLockById = useCallback((id: string) => {
        const chart = chartRef.current;
        if (!chart) return;
        setDrawnItems(prev =>
            prev.map(item => {
                if (item.id !== id) return item;
                const nextLock = !item.locked;
                chart.overrideOverlay({ id, lock: nextLock });
                return { ...item, locked: nextLock };
            })
        );
    }, []);

    const handleClearDrawings = useCallback(() => {
        const chart = chartRef.current;
        if (!chart) return;
        pendingOverlayIdRef.current = null;
        drawnOverlayIdsRef.current.forEach(id => {
            try { chart.removeOverlay(id); } catch (_) {}
        });
        drawnOverlayIdsRef.current = [];
        setDrawnItems([]);
        setSelectedDrawingId(null);
    }, []);

    const handleZoomIn = useCallback(() => {
        setZoomBox(null);
        setZoomAreaMode(prev => !prev);
    }, []);

    const handleToggleMagnet = useCallback(() => {
        setMagnetMode(prev => {
            const next = !prev;
            drawnOverlayIdsRef.current.forEach(id => {
                chartRef.current?.overrideOverlay({ id, mode: next ? OverlayMode.WeakMagnet : OverlayMode.Normal });
            });
            return next;
        });
    }, []);

    const handleToggleLock = useCallback(() => {
        setDrawingsLocked(prev => {
            const next = !prev;
            drawnOverlayIdsRef.current.forEach(id => {
                chartRef.current?.overrideOverlay({ id, lock: next });
            });
            setDrawnItems(items => items.map(it => ({ ...it, locked: next })));
            return next;
        });
    }, []);

    const handleToggleVisible = useCallback(() => {
        setDrawingsVisible(prev => {
            const next = !prev;
            drawnOverlayIdsRef.current.forEach(id => {
                chartRef.current?.overrideOverlay({ id, visible: next });
            });
            setDrawnItems(items => items.map(it => ({ ...it, visible: next })));
            return next;
        });
    }, []);

    const handleScreenshot = useCallback(() => {
        const chart = chartRef.current;
        if (!chart) return;
        const url = chart.getConvertPictureUrl(true, 'jpeg', ct.background);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Backtest_${currentSymbol.ticker}_${currentPeriod.text}.jpg`;
        a.click();
    }, [ct.background, currentSymbol.ticker, currentPeriod.text]);

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
            } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDrawingId) {
                e.preventDefault();
                handleRemoveDrawingById(selectedDrawingId);
            } else if (e.key === 'Escape') {
                setIndicatorModalOpen(false);
                setRightDrawer('none');
                setCutCandleMode(false);
                setZoomAreaMode(false);
                setZoomBox(null);
                setIsFullscreen(false);
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [handleTogglePlay, handleStepForward, handleStepBackward, executeOrderWithSide, selectedDrawingId, handleRemoveDrawingById]);

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

    const handleToggleIndicator = useCallback((code: string, pane: string) => {
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
    }, [activeIndicators]);

    const handleRemoveIndicatorByCode = useCallback((code: string) => {
        const found = AVAILABLE_INDICATORS.find(i => i.code === code);
        handleToggleIndicator(code, found?.pane || 'sub');
    }, [handleToggleIndicator]);

    const stats = useMemo(() => computeStats(orders, initialBalance), [orders, initialBalance]);
    const openPositions = useMemo(() => orders.filter(o => o.status === 'OPEN'), [orders]);
    const floatingPnl = useMemo(() => Number(openPositions.reduce((s, o) => s + o.pnl, 0).toFixed(2)), [openPositions]);
    const simBalance = stats.realizedBalance;
    const netProfit = Number((stats.netProfit + floatingPnl).toFixed(2));

    const syncRef = useRef(onSessionStateSync);
    syncRef.current = onSessionStateSync;

    // Sync session state whenever orders, notes, symbol, timeframe, or spread/commission change
    useEffect(() => {
        if (!syncRef.current) return;
        syncRef.current({
            currentBalance: Number((simBalance + floatingPnl).toFixed(2)),
            netPnl: stats.netProfit,
            closedTradesCount: stats.trades,
            winsCount: stats.wins,
            lossesCount: stats.losses,
            winRate: stats.winRate,
            profitFactor: stats.profitFactor ?? 0,
            expectancy: stats.expectancy,
            avgR: stats.avgR ?? 0,
            maxDrawdown: stats.maxDrawdown,
            maxDrawdownPct: stats.maxDrawdownPct,
            orders,
            journalNotes,
            replayTimestamp: replayActive ? latestBar?.timestamp ?? null : null,
            primarySymbol: currentSymbol.ticker,
            timeframe: currentPeriod.text,
            spread,
            commission,
        });
    }, [orders, journalNotes, currentSymbol.ticker, currentPeriod.text, spread, commission, simBalance, floatingPnl, stats, replayActive, latestBar?.timestamp]);

    // Track active practice time every 15 seconds while Replay Terminal is open
    useEffect(() => {
        const timer = setInterval(() => {
            if (!syncRef.current) return;
            syncRef.current({
                currentBalance: Number((simBalance + floatingPnl).toFixed(2)),
                netPnl: stats.netProfit,
                closedTradesCount: stats.trades,
                winsCount: stats.wins,
                lossesCount: stats.losses,
                winRate: stats.winRate,
                profitFactor: stats.profitFactor ?? 0,
                expectancy: stats.expectancy,
                avgR: stats.avgR ?? 0,
                maxDrawdown: stats.maxDrawdown,
                maxDrawdownPct: stats.maxDrawdownPct,
                orders,
                journalNotes,
                replayTimestamp: replayActive ? latestBar?.timestamp ?? null : null,
                primarySymbol: currentSymbol.ticker,
                timeframe: currentPeriod.text,
                spread,
                commission,
                deltaSeconds: 15,
            });
        }, 15000);
        return () => clearInterval(timer);
    }, [orders, journalNotes, currentSymbol.ticker, currentPeriod.text, spread, commission, simBalance, floatingPnl, stats, replayActive, latestBar?.timestamp]);

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

    const selectedDrawnItem = useMemo(
        () => (selectedDrawingId ? drawnItems.find(it => it.id === selectedDrawingId) || null : null),
        [selectedDrawingId, drawnItems]
    );

    const selectedStyleState = useMemo<DrawingStyleState>(
        () => (selectedDrawingId && drawingStylesById[selectedDrawingId]) || DEFAULT_DRAWING_STYLE,
        [selectedDrawingId, drawingStylesById]
    );

    const selectedOverlayPoints = useMemo<OverlayPointCoord[]>(() => {
        if (!selectedDrawingId || !chartRef.current) return [];
        const ov = chartRef.current.getOverlayById(selectedDrawingId) as any;
        if (!ov || !Array.isArray(ov.points)) return [];
        return ov.points.map((pt: any) => ({
            dataIndex: pt.dataIndex,
            timestamp: pt.timestamp,
            value: pt.value,
        }));
    }, [selectedDrawingId, pointsTick]);

    const handleToggleFullscreen = useCallback(() => {
        setIsFullscreen(prev => !prev);
    }, []);

    useEffect(() => {
        onFullscreenChange?.(isFullscreen);
        window.dispatchEvent(new CustomEvent('cossa:backtest-fullscreen', { detail: { isFullscreen } }));
        const timer = setTimeout(() => {
            requestAnimationFrame(() => {
                chartRef.current?.resize();
                secondaryChartRef.current?.resize();
            });
        }, 40);
        return () => clearTimeout(timer);
    }, [isFullscreen, onFullscreenChange]);

    useEffect(() => {
        return () => {
            window.dispatchEvent(new CustomEvent('cossa:backtest-fullscreen', { detail: { isFullscreen: false } }));
        };
    }, []);

    const formattedReplayClock = useMemo(() => {
        if (!latestBar?.timestamp) return '—';
        const d = new Date(latestBar.timestamp);
        const when = d.toLocaleString('pt-BR', {
            weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
        });
        let tz = '';
        try {
            tz = new Intl.DateTimeFormat('pt-BR', { timeZoneName: 'shortOffset' }).formatToParts(d).find(p => p.type === 'timeZoneName')?.value || '';
        } catch (_) {}
        return tz ? `${when} (${tz})` : when;
    }, [latestBar?.timestamp]);

    return (
        <div
            className={
                isFullscreen
                    ? 'fixed inset-0 z-[9999] w-screen h-screen flex flex-col select-none overflow-hidden bg-surface text-fg'
                    : 'select-none overflow-hidden rounded-2xl border border-line bg-surface text-fg shadow-lg flex flex-col'
            }
        >
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
                onToggleTheme={toggleTheme}
                onToggleTradeDrawer={() => setRightDrawer(d => (d === 'trade' ? 'none' : 'trade'))}
                onResetSimulation={handleResetSimulation}
                onScreenshot={handleScreenshot}
                isFullscreen={isFullscreen}
                onToggleFullscreen={handleToggleFullscreen}
                sessionName={sessionName}
                strategyName={strategyName}
                sessionPairs={sessionPairs}
                onBackToHub={onBackToHub}
            />

            {/* WORKSPACE: LAYER 2 (LEFT TOOLS) + LAYER 3 & 4 (CHART(S) & FLOATING PILL) + LAYER 5 (RIGHT PANEL) */}
            <div className={`relative flex ${isFullscreen ? 'flex-1 min-h-0' : 'h-[calc(100vh-145px)] min-h-[540px]'}`}>
                    {/* LAYER 2: LEFT DRAWING SIDEBAR */}
                    <LeftDrawingLayer
                        cutCandleMode={cutCandleMode}
                        zoomAreaMode={zoomAreaMode}
                        magnetMode={magnetMode}
                        drawingsLocked={drawingsLocked}
                        drawingsVisible={drawingsVisible}
                        onSelectDrawingTool={handleSelectDrawingTool}
                        onCancelPendingTool={handleCancelPendingTool}
                        onZoomIn={handleZoomIn}
                        onToggleMagnet={handleToggleMagnet}
                        onToggleLock={handleToggleLock}
                        onToggleVisible={handleToggleVisible}
                        onClearDrawings={handleClearDrawings}
                    />

                    {/* CENTER CANVAS AREA (Supports 1x1 Single or 1x2 Split-Screen Multi-Timeframe) */}
                    <div className="flex-1 relative flex overflow-hidden">
                        {/* PRIMARY CHART CONTAINER */}
                        <div className={`relative h-full ${layoutMode === '1x2' ? 'w-1/2 border-r border-line' : 'w-full'}`}>
                            {/* LAYER 3: 60FPS ISOLATED LEGEND & CROSSHAIR (+) BUTTON */}
                            <ChartLegendOverlayLayer
                                ref={legendOverlayRef}
                                ticker={currentSymbol.ticker}
                                periodText={currentPeriod.text}
                                decimals={decimals}
                                initialBar={latestBar}
                                cutCandleMode={cutCandleMode}
                                onCancelCutCandle={() => setCutCandleMode(false)}
                                onQuickLimitOrderAtPrice={handleQuickLimitOrderAtPrice}
                            />

                            {/* FLOATING DRAWING STYLE TOOLBAR & ADVANCED SETTINGS MODAL */}
                            <DrawingStyleToolbarLayer
                                selectedItem={selectedDrawnItem}
                                styleState={selectedStyleState}
                                points={selectedOverlayPoints}
                                decimals={decimals}
                                onUpdateStyle={handleUpdateSelectedStyle}
                                onUpdateLabel={handleUpdateDrawingLabel}
                                onUpdatePoint={handleUpdateSelectedPoint}
                                onToggleLock={handleToggleDrawingLockById}
                                onToggleVisible={handleToggleDrawingVisibleById}
                                onDuplicate={handleDuplicateDrawing}
                                onCenterOnChart={handleSelectDrawingById}
                                onDelete={handleRemoveDrawingById}
                                onResetStyle={handleResetDrawingStyle}
                                onSendPositionToOrderTicket={handleSendPositionToOrderTicket}
                            />

                            {/* AREA SELECTION ZOOM OVERLAY (Changes mouse to zoom-in and lets user drag-select an area to magnify) */}
                            {zoomAreaMode && (
                                <div
                                    className="absolute inset-0 z-30 cursor-zoom-in select-none"
                                    onMouseDown={(e) => {
                                        if (e.button !== 0) return;
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        const x = e.clientX - rect.left;
                                        const y = e.clientY - rect.top;
                                        setZoomBox({ startX: x, startY: y, endX: x, endY: y });
                                    }}
                                    onMouseMove={(e) => {
                                        if (!zoomBox) return;
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
                                        const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
                                        setZoomBox(prev => (prev ? { ...prev, endX: x, endY: y } : null));
                                    }}
                                    onMouseUp={(e) => {
                                        const chart = chartRef.current;
                                        const box = zoomBox;
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        setZoomBox(null);
                                        if (!chart || !box) return;

                                        const minX = Math.min(box.startX, box.endX);
                                        const maxX = Math.max(box.startX, box.endX);
                                        const minY = Math.min(box.startY, box.endY);
                                        const maxY = Math.max(box.startY, box.endY);
                                        const widthPx = maxX - minX;
                                        const heightPx = maxY - minY;

                                        if (widthPx < 14 && heightPx < 14) {
                                            // Single click: zoom in centered at clicked coordinate (both X and Y axes)
                                            chart.zoomAtCoordinate(1.45, { x: box.endX, y: box.endY });
                                            const ctx = getCandlePaneAndYAxis(chart);
                                            const paneH = ctx?.pane?.getMainWidget?.()?.getBounding?.()?.height || Math.max(180, rect.height - 120);
                                            const ratio = Math.max(0.1, Math.min(0.9, box.endY / paneH));
                                            handleScaleYAxisByFactor(0.76, ratio, chart);
                                        } else {
                                            // Dragged area: convert top-left and bottom-right of selection box to dataIndex + price value
                                            const pts = chart.convertFromPixel(
                                                [
                                                    { x: minX, y: minY },
                                                    { x: maxX, y: maxY },
                                                ],
                                                { paneId: 'candle_pane' }
                                            ) as any;
                                            const p1 = Array.isArray(pts) ? pts[0] : null;
                                            const p2 = Array.isArray(pts) ? pts[1] : null;
                                            if (p1 && p2 && typeof p1.dataIndex === 'number' && typeof p2.dataIndex === 'number' && widthPx >= 14) {
                                                const minIdx = Math.min(p1.dataIndex, p2.dataIndex);
                                                const maxIdx = Math.max(p1.dataIndex, p2.dataIndex);
                                                const selectedBars = Math.max(4, maxIdx - minIdx + 1);
                                                const usableWidth = Math.max(200, rect.width - 68);
                                                const targetBarSpace = Math.max(4, Math.min(48, Math.floor(usableWidth / selectedBars)));
                                                chart.setBarSpace(targetBarSpace);
                                                chart.scrollToDataIndex(maxIdx, 180);
                                            } else if (widthPx >= 14) {
                                                const centerX = (minX + maxX) / 2;
                                                const centerY = (minY + maxY) / 2;
                                                const factor = Math.max(1.3, Math.min(3.5, rect.width / Math.max(40, widthPx)));
                                                chart.zoomAtCoordinate(factor, { x: centerX, y: centerY });
                                            }

                                            // Fit Vertical Axis (Y-Axis) to the exact selected price range
                                            if (p1 && p2 && typeof p1.value === 'number' && typeof p2.value === 'number' && heightPx >= 14) {
                                                const lowVal = Math.min(p1.value, p2.value);
                                                const highVal = Math.max(p1.value, p2.value);
                                                const span = Math.max(1e-8, highVal - lowVal);
                                                const pad = span * 0.06;
                                                applyYAxisRange(chart, lowVal - pad, highVal + pad);
                                            }
                                        }
                                        if (!e.shiftKey) {
                                            setZoomAreaMode(false);
                                        }
                                    }}
                                >
                                    {/* Top floating hint pill */}
                                    <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-[#2962ff] text-white text-[11px] font-semibold shadow-lg flex items-center gap-2 pointer-events-auto">
                                        <span>Arraste para selecionar a área de Zoom (Horizontal + Vertical)</span>
                                        <button
                                            type="button"
                                            onClick={(ev) => {
                                                ev.stopPropagation();
                                                setZoomBox(null);
                                                setZoomAreaMode(false);
                                            }}
                                            className="px-1.5 py-0.2 rounded bg-white/20 hover:bg-white/30 text-[10px] cursor-pointer"
                                        >
                                            ESC
                                        </button>
                                    </div>

                                    {/* Live marquee selection box */}
                                    {zoomBox && (
                                        <div
                                            className="absolute border-2 border-[#2962ff] bg-[#2962ff]/15 rounded-xs pointer-events-none shadow-sm"
                                            style={{
                                                left: Math.min(zoomBox.startX, zoomBox.endX),
                                                top: Math.min(zoomBox.startY, zoomBox.endY),
                                                width: Math.max(2, Math.abs(zoomBox.endX - zoomBox.startX)),
                                                height: Math.max(2, Math.abs(zoomBox.endY - zoomBox.startY)),
                                            }}
                                        />
                                    )}
                                </div>
                            )}

                            {/* NATIVE KLINECHARTS PRIMARY CANVAS */}
                            <div ref={chartDivRef} className={`w-full h-full ${zoomAreaMode ? 'cursor-zoom-in' : ''}`} />

                            {/* Y-AXIS QUICK CONTROLS ([+] [-] [A] [L]) AT BOTTOM-RIGHT OF PRICE SCALE */}
                            <div
                                className="absolute bottom-7 right-1.5 z-20 flex items-center gap-0.5 px-1 py-0.5 rounded-md border border-line/80 bg-surface/90 backdrop-blur-xs shadow-sm select-none"
                                title="Controles do Eixo Vertical (Arraste o eixo de preço ou use Scroll sobre o eixo para ajustar)"
                            >
                                <button
                                    type="button"
                                    onClick={() => handleScaleYAxisByFactor(0.82, 0.5)}
                                    title="Expandir escala vertical (Zoom + no preço)"
                                    className="w-5 h-5 rounded flex items-center justify-center text-[11px] font-bold text-fg-muted hover:text-fg hover:bg-surface-2 cursor-pointer transition-colors"
                                >
                                    +
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleScaleYAxisByFactor(1.22, 0.5)}
                                    title="Comprimir escala vertical (Zoom - no preço)"
                                    className="w-5 h-5 rounded flex items-center justify-center text-[11px] font-bold text-fg-muted hover:text-fg hover:bg-surface-2 cursor-pointer transition-colors"
                                >
                                    −
                                </button>
                                <button
                                    type="button"
                                    onClick={handleResetYAxisAutoScale}
                                    title={
                                        yAxisAutoScale
                                            ? 'Auto-escala vertical ativa (A) — arraste verticalmente no gráfico para mover livremente'
                                            : 'Clique para reativar Auto-escala vertical (A) ou dê duplo-clique no eixo de preço'
                                    }
                                    className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold cursor-pointer transition-colors ${
                                        yAxisAutoScale
                                            ? 'bg-[#2962ff] text-white shadow-2xs'
                                            : 'text-fg-muted hover:text-fg hover:bg-surface-2 border border-line/60'
                                    }`}
                                >
                                    A
                                </button>
                                <button
                                    type="button"
                                    onClick={handleToggleYAxisLogScale}
                                    title="Alternar Escala Logarítmica (L) no eixo vertical"
                                    className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold cursor-pointer transition-colors ${
                                        yAxisLogScale
                                            ? 'bg-[#2962ff] text-white shadow-2xs'
                                            : 'text-fg-muted hover:text-fg hover:bg-surface-2'
                                    }`}
                                >
                                    L
                                </button>
                            </div>
                        </div>

                        {/* SECONDARY CHART CONTAINER (Only rendered in 1x2 Split-Screen Mode) */}
                        {layoutMode === '1x2' && (
                            <div className="relative w-1/2 h-full">
                                <div className="absolute top-2.5 left-3 z-20 flex items-center gap-2 pointer-events-auto">
                                    <span className={`px-2 py-0.5 rounded text-xs font-bold border ${
                                        'bg-surface/90 border-line text-fg'
                                    }`}>
                                        {currentSymbol.ticker} · {secondaryPeriod.text} {syncEnabled ? '(Sync ✓)' : ''}
                                    </span>
                                    <div className="flex items-center gap-0.5 bg-black/5 p-0.5 rounded-md dark:bg-white/5">
                                        {TIMEFRAMES.map(tf => (
                                            <button
                                                key={tf.text}
                                                onClick={() => handleSelectSecondaryPeriod(tf)}
                                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                                                    secondaryPeriod.text === tf.text
                                                        ? 'bg-accent text-accent-on'
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
                        ticker={currentSymbol.ticker}
                        periodText={currentPeriod.text}
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
                        drawnItems={drawnItems}
                        selectedDrawingId={selectedDrawingId}
                        activeIndicators={activeIndicators}
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
                        onRemoveDrawingById={handleRemoveDrawingById}
                        onSelectDrawingById={handleSelectDrawingById}
                        onToggleDrawingVisibleById={handleToggleDrawingVisibleById}
                        onToggleDrawingLockById={handleToggleDrawingLockById}
                        onRemoveIndicatorByCode={handleRemoveIndicatorByCode}
                    />
                </div>

                {/* LAYER 6: BOTTOM POSITIONS / PENDING / HISTORY DOCK */}
                <BottomDockLayer
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
                            'bg-surface border-line text-fg'
                        }`}>
                            <div className="flex items-center justify-between border-b pb-3 mb-3 border-line">
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
                                                    ? 'bg-accent/10 border-accent/40 text-accent-fg font-bold'
                                                    : 'border-transparent hover:bg-surface-2'
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
    );
};
