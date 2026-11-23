import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
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
import { X, Search, Trash2, Download, Share2, BookOpen, Check, Camera } from 'lucide-react';
import api from '../api';
import { useTheme } from '../context/ThemeContext';
import { useLocale } from '../context/LocaleContext';
import { useChartTheme } from '../hooks/useChartTheme';
import { CustomKLineDatafeed, DataSourceMode, DEFAULT_SYMBOLS } from '../services/klineDatafeed';
import {
    BatchLoadProgress,
    deleteBacktestScreenshotFile,
    uploadBacktestScreenshot,
} from '../services/historicalBatchCache';
import { SymbolInfo, Period } from '@klinecharts/pro';
import {
    ReplayOrder,
    TIMEFRAMES,
    findTimeframeByText,
    AVAILABLE_INDICATORS,
    ChartCandleStyleId,
    CANDLE_STYLE_OPTIONS,
    SessionScreenshotItem,
} from './kline-replay/types';
import { recomputeOrders } from './kline-replay/engine';
import { ensureCustomOverlays, setOverlayChartDataGetter } from './kline-replay/overlays/registerCustomOverlays';
import { ensureCustomIndicators } from './kline-replay/indicators/registerCustomIndicators';
import { TopToolbarLayer, ChartLayoutMode } from './kline-replay/layers/TopToolbarLayer';
import { LeftDrawingLayer } from './kline-replay/layers/LeftDrawingLayer';
import { ChartLegendOverlayLayer, ChartLegendOverlayRef } from './kline-replay/layers/ChartLegendOverlayLayer';
import { FloatingReplayBarLayer } from './kline-replay/layers/FloatingReplayBarLayer';
import { RightSidePanelLayer, RightDrawerMode, DrawnObjectItem } from './kline-replay/layers/RightSidePanelLayer';
import { BottomDockLayer } from './kline-replay/layers/BottomDockLayer';
import { DrawingStyleToolbarLayer, DrawingStyleState, OverlayPointCoord } from './kline-replay/layers/DrawingStyleToolbarLayer';
import { PostTradeQuickTagCard } from './kline-replay/layers/PostTradeQuickTagCard';
import { ReplayStateSnapshot } from '../store/useReplaySessionStore';
import {
    clearLocalReplaySnapshot,
    DrawingEntityV2,
    DrawingToolsWorkspaceState,
    readLocalReplaySnapshot,
    TicketDefaultsState,
    unpackDrawingsV2,
    YAxisSessionState,
} from '../services/backtestSessionSnapshot';
import {
    DEFAULT_DRAWING_STYLE,
    resolveNativeCandleType,
    resolveOverlayPointsAgainstCandles,
} from './kline-replay/hooks/drawingOverlayUtils';
import { useDrawingManager } from './kline-replay/hooks/useDrawingManager';
import { useMultiPaneCharts } from './kline-replay/hooks/useMultiPaneCharts';
import { useOrderExecution } from './kline-replay/hooks/useOrderExecution';
import { useReplayPlayback } from './kline-replay/hooks/useReplayPlayback';
import {
    useSessionSyncController,
    UseSessionSyncPayloadContract,
} from './kline-replay/hooks/useSessionSyncController';

export type SessionStateSyncPayload = UseSessionSyncPayloadContract;

interface KLineChartProTerminalProps {
    sessionId?: string;
    initialRevision?: number;
    sessionName?: string;
    strategyName?: string;
    sessionPairs?: string[];
    sessionFromDate?: string;
    sessionToDate?: string;
    initialSymbolTicker?: string;
    initialPeriodText?: string;
    initialSecondaryPeriodText?: string;
    initialAuxPeriodTexts?: string[];
    initialTimezone?: string;
    initialDataSource?: DataSourceMode;
    initialLayoutMode?: ChartLayoutMode;
    initialReplayActive?: boolean;
    initialSyncEnabled?: boolean;
    initialYAxis?: YAxisSessionState;
    initialDrawingTools?: DrawingToolsWorkspaceState;
    initialTicketDefaults?: Partial<TicketDefaultsState>;
    initialRiskPercent?: number;
    initialRrTarget?: number;
    initialSpread?: number;
    initialCommission?: number;
    initialOrders?: ReplayOrder[];
    initialDrawings?: DrawingEntityV2[];
    initialDrawnItems?: DrawnObjectItem[];
    initialDrawingStylesById?: Record<string, DrawingStyleState>;
    initialOverlayGeometries?: Record<string, OverlayPointCoord[]>;
    initialActiveIndicators?: string[];
    initialIndicatorParamsByCode?: Record<string, string>;
    initialCandleStyle?: ChartCandleStyleId;
    initialScreenshots?: SessionScreenshotItem[];
    initialJournalNotes?: string;
    initialReplayTimestamp?: number | null;
    deepLinkSymbol?: string;
    deepLinkPeriodText?: string;
    deepLinkTimestamp?: number;
    deepLinkTradeId?: string;
    initialBalance?: number;
    accountName?: string;
    onBackToHub?: () => void;
    onSessionStateSync?: (payload: SessionStateSyncPayload) => Promise<boolean> | void;
    onSaveReplaySession?: (sessionPayload: any) => Promise<void>;
    onFullscreenChange?: (isFullscreen: boolean) => void;
}

export const KLineChartProTerminal: React.FC<KLineChartProTerminalProps> = ({
    sessionId,
    initialRevision,
    sessionName,
    strategyName,
    sessionPairs,
    sessionFromDate,
    sessionToDate,
    initialSymbolTicker,
    initialPeriodText,
    initialSecondaryPeriodText,
    initialAuxPeriodTexts,
    initialTimezone,
    initialDataSource,
    initialLayoutMode,
    initialReplayActive,
    initialSyncEnabled,
    initialYAxis,
    initialDrawingTools,
    initialTicketDefaults,
    initialRiskPercent,
    initialRrTarget,
    initialSpread,
    initialCommission,
    initialOrders,
    initialDrawings,
    initialDrawnItems,
    initialDrawingStylesById,
    initialOverlayGeometries,
    initialActiveIndicators,
    initialIndicatorParamsByCode,
    initialCandleStyle,
    initialScreenshots,
    initialJournalNotes,
    initialReplayTimestamp,
    deepLinkSymbol,
    deepLinkPeriodText,
    deepLinkTimestamp,
    deepLinkTradeId,
    initialBalance = 10000,
    accountName = 'Conta Principal',
    onBackToHub,
    onSessionStateSync,
    onSaveReplaySession,
    onFullscreenChange,
}) => {
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const displayAccountName = accountName === 'Conta Principal' && isEn ? 'Primary Account' : accountName;
    ensureCustomOverlays();
    ensureCustomIndicators();

    // Read normalized V2 snapshot from localStorage and compare revision against incoming props
    const saved = useMemo(() => {
        const localSnap = readLocalReplaySnapshot(sessionId);
        if (localSnap && typeof initialRevision === 'number' && initialRevision > localSnap.revision) {
            return null;
        }
        return localSnap;
    }, [sessionId, initialRevision]);

    const initialUnpackedDrawings = useMemo(
        () =>
            saved
                ? {
                      drawings: saved.drawings,
                      drawnItems: saved.drawnItems,
                      drawingStylesById: saved.drawingStylesById,
                      overlayGeometries: saved.overlayGeometries,
                  }
                : unpackDrawingsV2({
                      drawings: initialDrawings,
                      drawnItems: initialDrawnItems,
                      drawingStylesById: initialDrawingStylesById,
                      overlayGeometries: initialOverlayGeometries,
                  }),
        [saved, initialDrawings, initialDrawnItems, initialDrawingStylesById, initialOverlayGeometries]
    );

    const chartDivRef = useRef<HTMLDivElement | null>(null);
    const chartRef = useRef<Chart | null>(null);
    const datafeedRef = useRef<CustomKLineDatafeed | null>(null);
    const legendOverlayRef = useRef<ChartLegendOverlayRef | null>(null);
    const rafCrosshairRef = useRef<number | null>(null);
    const screenshotCloseTimerRef = useRef<number | null>(null);
    const lastCrosshairPriceRef = useRef<number | null>(null);
    const isRestoringSnapshotRef = useRef<boolean>(false);
    const isHydratingCanvasRef = useRef<boolean>(true);
    const [canvasHydratedCount, setCanvasHydratedCount] = useState<number>(0);

    const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
    const [focusWorkspaceMode, setFocusWorkspaceMode] = useState<boolean>(false);
    const [rightDrawer, setRightDrawer] = useState<RightDrawerMode>('none');
    const [timezone, setTimezone] = useState<string>(() => {
        if (saved?.timezone) return saved.timezone;
        if (initialTimezone) return initialTimezone;
        try {
            return localStorage.getItem('torex_replay_timezone_v1') || 'local';
        } catch (_) {
            return 'local';
        }
    });

    const { theme: chartTheme, toggleTheme } = useTheme();
    const ct = useChartTheme();
    const [dataSource, setDataSource] = useState<DataSourceMode>(saved?.dataSource || initialDataSource || 'TRADINGVIEW');
    const [activeSourceLabel, setActiveSourceLabel] = useState<string>('TradingView');
    const [isSynthetic, setIsSynthetic] = useState<boolean>(false);
    const [batchProgress, setBatchProgress] = useState<BatchLoadProgress | undefined>(undefined);
    const [syncEnabled, setSyncEnabled] = useState<boolean>(saved?.syncEnabled ?? initialSyncEnabled ?? true);

    const [currentSymbol, setCurrentSymbol] = useState<SymbolInfo>(() => {
        const ticker = deepLinkSymbol || saved?.ticker || initialSymbolTicker;
        if (ticker) {
            const found = DEFAULT_SYMBOLS.find((s) => s.ticker === ticker);
            if (found) return found;
            return {
                ticker,
                name: ticker,
                shortName: ticker,
                exchange: 'FX',
                market: 'forex',
                pricePrecision: ticker.includes('JPY') ? 3 : 5,
                volumePrecision: 0,
                priceCurrency: 'USD',
            };
        }
        return DEFAULT_SYMBOLS[0];
    });
    const [currentPeriod, setCurrentPeriod] = useState<Period>(() => {
        const pText = deepLinkPeriodText || saved?.periodText || initialPeriodText;
        if (pText) {
            const found = findTimeframeByText(pText);
            if (found) return found;
        }
        return TIMEFRAMES.find((t) => t.text === '15m') || TIMEFRAMES[0];
    });

    const initialResolvedStyle: ChartCandleStyleId = saved?.selectedCandleStyle || initialCandleStyle || 'candles';
    const [candleStyle, setCandleStyle] = useState<CandleType>(() => resolveNativeCandleType(initialResolvedStyle));
    const [selectedCandleStyle, setSelectedCandleStyle] = useState<ChartCandleStyleId>(initialResolvedStyle);
    const [latestBar, setLatestBar] = useState<KLineData | null>(null);

    // Screenshot Hub & Session Journal
    const [sessionScreenshots, setSessionScreenshots] = useState<SessionScreenshotItem[]>(
        saved?.sessionScreenshots || initialScreenshots || []
    );
    const [screenshotModalOpen, setScreenshotModalOpen] = useState<boolean>(false);
    const [capturedImageUrl, setCapturedImageUrl] = useState<string>('');
    const [screenshotCaption, setScreenshotCaption] = useState<string>('');
    const [screenshotFeedback, setScreenshotFeedback] = useState<string | null>(null);
    const [journalNotes, setJournalNotes] = useState<string>(saved?.journalNotes ?? initialJournalNotes ?? '');

    // Indicators Modal
    const [indicatorModalOpen, setIndicatorModalOpen] = useState(false);
    const [activeIndicators, setActiveIndicators] = useState<string[]>(
        saved?.activeIndicators || initialActiveIndicators || []
    );
    const [indicatorSearch, setIndicatorSearch] = useState<string>('');
    const [indicatorParamsByCode, setIndicatorParamsByCode] = useState<Record<string, string>>(() => {
        const initMap: Record<string, string> = {};
        AVAILABLE_INDICATORS.forEach((ind) => {
            if (ind.defaultParams && ind.defaultParams.length > 0) {
                initMap[ind.code] = ind.defaultParams.join(', ');
            }
        });
        return { ...initMap, ...(initialIndicatorParamsByCode || {}), ...(saved?.indicatorParamsByCode || {}) };
    });

    // Vertical Axis (Y-Axis) Precision Controls
    const initAutoScale = saved?.yAxis?.autoScale ?? initialYAxis?.autoScale ?? true;
    const initLogScale = saved?.yAxis?.logScale ?? initialYAxis?.logScale ?? false;
    const initCustomRange = saved?.yAxis?.customRange ?? initialYAxis?.customRange ?? null;
    const [yAxisAutoScale, setYAxisAutoScale] = useState<boolean>(initAutoScale);
    const yAxisAutoScaleRef = useRef<boolean>(initAutoScale);
    const [yAxisLogScale, setYAxisLogScale] = useState<boolean>(initLogScale);
    const yAxisLogScaleRef = useRef<boolean>(initLogScale);
    yAxisLogScaleRef.current = yAxisLogScale;
    const [yAxisCustomRange, setYAxisCustomRange] = useState<{ from: number; to: number } | null>(initCustomRange);
    const yAxisCustomRangeRef = useRef<{ from: number; to: number } | null>(initCustomRange);
    yAxisCustomRangeRef.current = yAxisCustomRange;

    // Cross-hook bridge refs to keep hook invocation order strictly acyclic
    const setCutCandleBridgeRef = useRef<(v: boolean) => void>(() => {});
    const cutCandleModeBridgeRef = useRef<boolean>(false);
    const selectPrimaryPeriodBridgeRef = useRef<(per: Period) => void>(() => {});
    const auxChartsLiveRef = useRef<(Chart | null)[]>([null, null, null]);

    // 1) HOOK: Drawing Manager
    const drawingManager = useDrawingManager({
        chartRef,
        isRestoringSnapshotRef,
        isHydratingCanvasRef,
        initialDrawnItems: initialUnpackedDrawings.drawnItems,
        initialDrawingStylesById: initialUnpackedDrawings.drawingStylesById,
        initialOverlayGeometries: initialUnpackedDrawings.overlayGeometries,
        initialMagnetMode: saved?.drawingTools?.magnetMode ?? initialDrawingTools?.magnetMode ?? false,
        initialDrawingsLocked: saved?.drawingTools?.drawingsLocked ?? initialDrawingTools?.drawingsLocked ?? false,
        initialDrawingsVisible: saved?.drawingTools?.drawingsVisible ?? initialDrawingTools?.drawingsVisible ?? true,
        isEn,
        onCancelCutCandle: useCallback(() => setCutCandleBridgeRef.current(false), []),
    });

    const {
        drawnOverlayIdsRef,
        pendingOverlayIdRef,
        drawnItems,
        setDrawnItems,
        overlayGeometriesRef,
        selectedDrawingId,
        setDrawingStylesById,
        drawingStylesById,
        pointsTick,
        magnetMode,
        setMagnetMode,
        drawingsLocked,
        setDrawingsLocked,
        drawingsVisible,
        setDrawingsVisible,
        zoomAreaMode,
        setZoomAreaMode,
        zoomAreaModeRef,
        zoomBox,
        setZoomBox,
        captureCurrentOverlayGeometries,
        mountOverlayWithHandlers,
        reanchorMountedOverlays,
        placeHorizontalLineAtPrice,
        handleSelectDrawingTool,
        handleCancelPendingTool,
        handleUndoDrawing,
        handleRemoveDrawingById,
        handleSelectDrawingById,
        handleUpdateSelectedStyle,
        handleUpdateDrawingLabel,
        handleUpdateSelectedPoint,
        handleDuplicateDrawing,
        handleResetDrawingStyle,
        handleToggleDrawingVisibleById,
        handleToggleDrawingLockById,
        handleClearDrawings,
        handleZoomIn,
        handleToggleMagnet,
        handleToggleLock,
        handleToggleVisible,
        selectedDrawnItem,
        selectedStyleState,
        selectedOverlayPoints,
        currentDrawingToolsState,
    } = drawingManager;

    // Precision Vertical Axis Helpers & Theme Application
    const getCandlePaneAndYAxis = useCallback((chart: Chart | null) => {
        if (!chart) return null;
        const pane = (chart as any).getDrawPaneById?.('candle_pane');
        const yAxis = pane?.getAxisComponent?.();
        if (!pane || !yAxis) return null;
        return { pane, yAxis };
    }, []);

    const applyYAxisRange = useCallback(
        (chart: Chart | null, rawFrom: number, rawTo: number) => {
            const ctx = getCandlePaneAndYAxis(chart);
            if (!ctx || !Number.isFinite(rawFrom) || !Number.isFinite(rawTo)) return;
            const { yAxis } = ctx;
            const from = Math.min(rawFrom, rawTo);
            const to = Math.max(rawFrom, rawTo);
            const range = Math.max(1e-8, to - from);
            const realFrom = typeof yAxis.convertToRealValue === 'function' ? yAxis.convertToRealValue(from) : from;
            const realTo = typeof yAxis.convertToRealValue === 'function' ? yAxis.convertToRealValue(to) : to;
            const realRange = Math.max(1e-8, realTo - realFrom);

            yAxis.setRange({ from, to, range, realFrom, realTo, realRange });
            (chart as any).adjustPaneViewport?.(false, true, true, true, true);
            if (chart === chartRef.current) {
                if (yAxisAutoScaleRef.current) {
                    yAxisAutoScaleRef.current = false;
                    setYAxisAutoScale(false);
                }
                const nextCustom = { from: Number(from.toFixed(6)), to: Number(to.toFixed(6)) };
                yAxisCustomRangeRef.current = nextCustom;
                setYAxisCustomRange(nextCustom);
            }
        },
        [getCandlePaneAndYAxis]
    );

    const handleResetYAxisAutoScale = useCallback(() => {
        [chartRef.current, ...auxChartsLiveRef.current].forEach((c) => {
            const ctx = getCandlePaneAndYAxis(c);
            if (ctx) {
                ctx.yAxis.setAutoCalcTickFlag?.(true);
                (c as any).adjustPaneViewport?.(false, true, true, true, true);
            }
        });
        yAxisAutoScaleRef.current = true;
        setYAxisAutoScale(true);
        yAxisCustomRangeRef.current = null;
        setYAxisCustomRange(null);
    }, [getCandlePaneAndYAxis]);

    const handleScaleYAxisByFactor = useCallback(
        (factor: number, anchorRatio: number = 0.5, targetChart?: Chart | null) => {
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
        },
        [getCandlePaneAndYAxis, applyYAxisRange]
    );

    const handleToggleYAxisLogScale = useCallback(() => {
        setYAxisLogScale((prev) => {
            const next = !prev;
            yAxisLogScaleRef.current = next;
            const axisType = next ? YAxisType.Log : YAxisType.Normal;
            [chartRef.current, ...auxChartsLiveRef.current].forEach((c) => {
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
            yAxisCustomRangeRef.current = null;
            setYAxisCustomRange(null);
            return next;
        });
    }, [getCandlePaneAndYAxis]);

    const bindPrecisionYAxisEvents = useCallback(
        (el: HTMLElement, chart: Chart) => {
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
                const isInsideYAxis =
                    localX >= el.clientWidth - yAxisWidth &&
                    localX <= el.clientWidth &&
                    localY >= 0 &&
                    localY <= paneHeight;
                const isInsideMainCandlePane =
                    localX >= 0 && localX < el.clientWidth - yAxisWidth && localY >= 0 && localY <= paneHeight;
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
                    if (isOverlayBusy() || zoomAreaModeRef.current || cutCandleModeBridgeRef.current) {
                        activeDrag = null;
                        return;
                    }
                    const deltaY = e.clientY - activeDrag.startY;
                    if (!activeDrag.unlockedVertical && Math.abs(deltaY) >= 5) {
                        activeDrag.unlockedVertical = true;
                    }
                    if (activeDrag.unlockedVertical) {
                        const priceShift =
                            (deltaY / Math.max(100, activeDrag.paneHeight)) * activeDrag.startRange;
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
                if (e.button !== 0 || zoomAreaModeRef.current || cutCandleModeBridgeRef.current) return;
                const { isInsideYAxis, isInsideMainCandlePane, paneHeight, ctx } = getGeometry(e.clientX, e.clientY);
                if (!ctx) return;
                const curRange = ctx.yAxis.getRange?.();
                if (!curRange || !Number.isFinite(curRange.from) || !Number.isFinite(curRange.to)) return;

                if (isInsideYAxis) {
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
                        yAxisCustomRangeRef.current = null;
                        setYAxisCustomRange(null);
                    }
                }
            };

            const onWheelCapture = (e: WheelEvent) => {
                const { localY, paneHeight, isInsideYAxis, isInsideMainCandlePane } = getGeometry(e.clientX, e.clientY);
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
        },
        [getCandlePaneAndYAxis, applyYAxisRange, handleScaleYAxisByFactor, pendingOverlayIdRef, zoomAreaModeRef]
    );

    const applyChartTheme = useCallback(
        (chart: Chart, _theme?: string) => {
            const withAlpha = (c: string, a: number) => c.replace(/,\s*[\d.]+\)$/, `, ${a})`);
            const grid = { show: true, size: 1, color: ct.grid, style: LineType.Solid };
            const crossLine = { show: true, style: LineType.Dashed, dashedValue: [4, 4], size: 1, color: ct.tick };
            const crossText = {
                show: true,
                color: ct.background,
                backgroundColor: ct.tooltipTitle,
                size: 11,
                paddingLeft: 6,
                paddingRight: 6,
                paddingTop: 3,
                paddingBottom: 3,
                borderRadius: 3,
            };

            const customDrawnStyles: ChartCandleStyleId[] = [
                'hlc_bars',
                'lines_with_marks',
                'step_line',
                'hlc_area',
                'baseline',
                'columns',
                'high_low',
                'heikin_ashi',
            ];
            const isCustomDrawn = customDrawnStyles.includes(selectedCandleStyle);

            let effectiveCandleType: CandleType = CandleType.CandleSolid;
            if (selectedCandleStyle === 'bars') effectiveCandleType = CandleType.Ohlc;
            else if (selectedCandleStyle === 'candles') effectiveCandleType = CandleType.CandleSolid;
            else if (selectedCandleStyle === 'hollow_candles') effectiveCandleType = CandleType.CandleStroke;
            else if (selectedCandleStyle === 'lines' || selectedCandleStyle === 'area') {
                effectiveCandleType = CandleType.Area;
            }

            const transparent = 'rgba(0, 0, 0, 0)';
            const barColors = isCustomDrawn
                ? {
                      upColor: transparent,
                      downColor: transparent,
                      noChangeColor: transparent,
                      upBorderColor: transparent,
                      downBorderColor: transparent,
                      noChangeBorderColor: transparent,
                      upWickColor: transparent,
                      downWickColor: transparent,
                      noChangeWickColor: transparent,
                  }
                : {
                      upColor: ct.pos,
                      downColor: ct.neg,
                      noChangeColor: ct.tick,
                      upBorderColor: ct.pos,
                      downBorderColor: ct.neg,
                      noChangeBorderColor: ct.tick,
                      upWickColor: ct.pos,
                      downWickColor: ct.neg,
                      noChangeWickColor: ct.tick,
                  };

            const areaBg =
                selectedCandleStyle === 'lines'
                    ? [
                          { offset: 0, color: transparent },
                          { offset: 1, color: transparent },
                      ]
                    : [
                          { offset: 0, color: withAlpha(ct.series1, 0.01) },
                          { offset: 1, color: withAlpha(ct.series1, 0.22) },
                      ];

            chart.setStyles({
                grid: { show: true, horizontal: grid, vertical: { ...grid, show: false } },
                candle: {
                    type: effectiveCandleType,
                    bar: barColors,
                    area: {
                        lineSize: 2,
                        lineColor: ct.series1,
                        backgroundColor: areaBg,
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
                                show: true,
                                size: 11,
                                color: '#ffffff',
                                borderRadius: 3,
                                paddingLeft: 6,
                                paddingTop: 4,
                                paddingRight: 6,
                                paddingBottom: 4,
                            },
                        },
                    },
                    tooltip: { showRule: 'none' as any },
                },
                indicator: {
                    bars: [
                        {
                            upColor: withAlpha(ct.pos, 0.45),
                            downColor: withAlpha(ct.neg, 0.45),
                            noChangeColor: withAlpha(ct.tick, 0.45),
                        },
                    ],
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
                    type: yAxisLogScaleRef.current ? YAxisType.Log : YAxisType.Normal,
                    axisLine: { show: false },
                    tickText: { show: true, color: ct.tick, size: 11 },
                    tickLine: { show: false },
                } as any,
                separator: { size: 1, color: ct.gridStrong },
                crosshair: {
                    show: true,
                    horizontal: { show: true, line: crossLine, text: crossText },
                    vertical: { show: true, line: crossLine, text: crossText },
                },
            });

            if (isCustomDrawn) {
                const payload = {
                    name: 'TV_CANDLE_STYLE_RENDERER',
                    extendData: {
                        styleId: selectedCandleStyle,
                        upColor: ct.pos,
                        downColor: ct.neg,
                        lineColor: '#2962ff',
                    },
                };
                const existing = chart.getIndicatorByPaneId('candle_pane', 'TV_CANDLE_STYLE_RENDERER');
                if (existing) {
                    chart.overrideIndicator(payload as any, 'candle_pane');
                } else {
                    chart.createIndicator(payload as any, true, { id: 'candle_pane' });
                }
            } else {
                chart.removeIndicator('candle_pane', 'TV_CANDLE_STYLE_RENDERER');
            }

            try {
                const resolvedTz =
                    timezone && timezone !== 'local'
                        ? timezone
                        : Intl.DateTimeFormat().resolvedOptions().timeZone;
                if (resolvedTz) {
                    chart.setTimezone?.(resolvedTz);
                }
            } catch (_) {}
        },
        [selectedCandleStyle, candleStyle, ct, timezone]
    );

    // 2) HOOK: Multi-Pane Charts
    const multiPane = useMultiPaneCharts({
        chartRef,
        datafeedRef,
        currentSymbol,
        currentPeriod,
        latestBar,
        syncEnabled,
        chartTheme,
        candleStyle,
        applyChartTheme,
        bindPrecisionYAxisEvents,
        captureCurrentOverlayGeometries,
        drawnItems,
        drawingStylesById,
        pointsTick,
        drawingsVisible,
        focusWorkspaceMode,
        rightDrawer,
        initialLayoutMode: saved?.layoutMode || initialLayoutMode || '1x1',
        initialSecondaryPeriodText: saved?.secondaryPeriodText || initialSecondaryPeriodText,
        initialAuxPeriodTexts: saved?.auxPeriodTexts || initialAuxPeriodTexts,
        onSelectPrimaryPeriod: useCallback((per: Period) => selectPrimaryPeriodBridgeRef.current(per), []),
    });

    const {
        layoutMode,
        setLayoutMode,
        focusedPaneIndex,
        setFocusedPaneIndex,
        secondaryPeriod,
        setSecondaryPeriod,
        extraAuxPeriods,
        setExtraAuxPeriods,
        auxPaneCount,
        auxPeriods,
        panePeriods,
        auxDataSyncTick,
        gridLayoutClass,
        auxChartDivRefs,
        auxChartRefs,
        auxOrderOverlayIdsRef,
        syncAllAuxCharts,
        handleSelectSecondaryPeriod,
        handleSelectPanePeriod,
    } = multiPane;

    auxChartsLiveRef.current = auxChartRefs.current;

    // 3) HOOK: Order Execution, Ticket & Interactive Order Preview / Quick-Tagging
    const orderExecution = useOrderExecution({
        chartRef,
        auxChartRefs,
        auxOrderOverlayIdsRef,
        datafeedRef,
        legendOverlayRef,
        isHydratingCanvasRef,
        isRestoringSnapshotRef,
        canvasHydratedCount,
        auxDataSyncTick,
        currentSymbol,
        currentPeriod,
        latestBar,
        setLatestBar,
        auxPaneCount,
        auxPeriods,
        syncEnabled,
        rightDrawer,
        setRightDrawer,
        ct,
        isEn,
        initialBalance,
        initialOrders: saved?.orders ?? initialOrders ?? [],
        initialOrderSide: saved?.ticketDefaults?.orderSide ?? initialTicketDefaults?.orderSide ?? 'BUY',
        initialOrderType: saved?.ticketDefaults?.orderType ?? initialTicketDefaults?.orderType ?? 'MARKET',
        initialRiskPercent:
            saved?.ticketDefaults?.riskPercent ?? initialTicketDefaults?.riskPercent ?? initialRiskPercent ?? 1.0,
        initialSlDistancePct: saved?.ticketDefaults?.slDistancePct ?? initialTicketDefaults?.slDistancePct ?? 0.3,
        initialRrTarget: saved?.ticketDefaults?.rrTarget ?? initialTicketDefaults?.rrTarget ?? initialRrTarget ?? 2.0,
        initialSpread: saved?.ticketDefaults?.spread ?? saved?.spread ?? initialTicketDefaults?.spread ?? initialSpread ?? 0,
        initialCommission:
            saved?.ticketDefaults?.commission ??
            saved?.commission ??
            initialTicketDefaults?.commission ??
            initialCommission ??
            0,
    });

    const {
        orders,
        setOrders,
        orderSide,
        setOrderSide,
        orderType,
        setOrderType,
        limitEntryPrice,
        setLimitEntryPrice,
        riskPercent,
        setRiskPercent,
        slDistancePct,
        setSlDistancePct,
        rrTarget,
        setRrTarget,
        spread,
        setSpread,
        commission,
        setCommission,
        showChartOrderPreview,
        setShowChartOrderPreview,
        quickTagOrder,
        handleOpenQuickTagForOrder,
        handleDismissQuickTag,
        handleUpdateOrderQuickTag,
        lastCutoffRef,
        recomputeOrdersAtCutoff,
        onFeedCandle,
        executeOrderWithSide,
        handleExecuteOrder,
        handleQuickLimitOrderAtPrice,
        handleSendPositionToOrderTicket,
        handleMoveOrderToBreakEven,
        handlePartialCloseOrder,
        handleCloseOrCancelOrder,
        stats,
        quantMetrics,
        floatingPnl,
        simBalance,
        netProfit,
        currentTicketDefaultsState,
    } = orderExecution;

    // Live ref bridge for datafeed & chart init callbacks
    const liveRef = useRef({
        currentSymbol,
        currentPeriod,
        secondaryPeriod,
        dataSource,
        replayActive: true,
        syncEnabled,
        orders,
    });
    const liveLatestTsRef = useRef<number | null>(latestBar?.timestamp ?? null);
    liveLatestTsRef.current = latestBar?.timestamp ?? null;
    const isChartLoadingRef = useRef<boolean>(false);
    const loadRequestGenRef = useRef<number>(0);
    const loadChartDataRef = useRef<
        ((sym: SymbolInfo, per: Period, mode: DataSourceMode, isReplay: boolean, preserve?: boolean) => Promise<void>) | null
    >(null);
    const syncAuxChartsRef = useRef<((sym: SymbolInfo, ts: number | null) => void) | null>(null);

    const loadChartData = useCallback(
        async (
            sym: SymbolInfo,
            per: Period,
            mode: DataSourceMode,
            isReplay: boolean,
            preserveTimestamp: boolean = false
        ) => {
            const chart = chartRef.current;
            const df = datafeedRef.current;
            if (!chart || !df) return;

            const reqGen = ++loadRequestGenRef.current;
            isChartLoadingRef.current = true;

            try {
                if (!isHydratingCanvasRef.current) {
                    captureCurrentOverlayGeometries();
                }

                const preservedCutoffTs =
                    preserveTimestamp && syncEnabled && isReplay
                        ? df.getReplayTimestamp() || liveLatestTsRef.current || null
                        : null;

                df.setMode(mode);
                const symOrderHint = liveRef.current.orders.find(
                    (o) =>
                        o.symbol.toUpperCase() === sym.ticker.toUpperCase() &&
                        Number.isFinite(o.entryPrice) &&
                        o.entryPrice > 0
                );
                df.setPriceAnchorHint(symOrderHint?.entryPrice ?? null);
                df.unsubscribe();
                chart.setPriceVolumePrecision(sym.pricePrecision ?? 2, sym.volumePrecision ?? 0);

                if (!isHydratingCanvasRef.current) {
                    const ctx = getCandlePaneAndYAxis(chart);
                    if (ctx) {
                        ctx.yAxis.setAutoCalcTickFlag?.(true);
                    }
                    yAxisAutoScaleRef.current = true;
                    setYAxisAutoScale(true);
                    yAxisCustomRangeRef.current = null;
                    setYAxisCustomRange(null);
                }

                try {
                    await df.getHistoryKLineData(
                        sym,
                        per,
                        undefined,
                        undefined,
                        preservedCutoffTs,
                        preserveTimestamp && syncEnabled
                    );
                } catch (_) {
                    return;
                }

                if (reqGen !== loadRequestGenRef.current || chartRef.current !== chart) return;

                const barsToRender =
                    preservedCutoffTs && preservedCutoffTs > 0
                        ? await df.ensureTimestampLoaded(preservedCutoffTs, { preserveCanonicalStep: true })
                        : df.setReplayMode(isReplay, 0.72, false);

                if (reqGen !== loadRequestGenRef.current || chartRef.current !== chart) return;

                chart.applyNewData(barsToRender, barsToRender.length > 0);
                if (!isHydratingCanvasRef.current) {
                    reanchorMountedOverlays(chart);
                }
                (chart as any).adjustPaneViewport?.(false, true, true, true, true);

                if (barsToRender.length > 0) {
                    const last = barsToRender[barsToRender.length - 1];
                    setLatestBar(last);
                    legendOverlayRef.current?.updateLegend(last, null, null);
                    setLimitEntryPrice(String(last.close));
                    void syncAllAuxCharts(sym, df.getReplayTimestamp() ?? last.timestamp);
                }

                df.subscribe(sym, per, (bar) => {
                    chart.updateData(bar);
                });
            } finally {
                if (reqGen === loadRequestGenRef.current) {
                    isChartLoadingRef.current = false;
                }
            }
        },
        [syncEnabled, syncAllAuxCharts, captureCurrentOverlayGeometries, getCandlePaneAndYAxis, reanchorMountedOverlays, setLimitEntryPrice]
    );

    loadChartDataRef.current = loadChartData;
    syncAuxChartsRef.current = syncAllAuxCharts;

    // 4) HOOK: Replay Playback
    const playback = useReplayPlayback({
        chartRef,
        datafeedRef,
        legendOverlayRef,
        lastCutoffRef,
        isChartLoadingRef,
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
        initialReplayActive: deepLinkTimestamp !== undefined ? true : saved?.replayActive ?? initialReplayActive ?? true,
        deepLinkTradeId,
    });

    const {
        replayActive,
        setReplayActive,
        autoPlaying,
        setAutoPlaying,
        replaySpeedLabel,
        cutCandleMode,
        setCutCandleMode,
        cutCandleModeRef,
        activeJumpTradeId,
        handleStepForward,
        handleStepBackward,
        handleFastForward,
        handleTogglePlay,
        handleChangeSpeed,
        handleJumpToRatio,
        handleJumpToTimestamp,
        handleLoadEarlierBatch,
        handleJumpToSessionTrade,
    } = playback;

    setCutCandleBridgeRef.current = setCutCandleMode;
    cutCandleModeBridgeRef.current = cutCandleModeRef.current;

    liveRef.current = {
        currentSymbol,
        currentPeriod,
        secondaryPeriod,
        dataSource,
        replayActive,
        syncEnabled,
        orders,
    };

    const handleSelectSymbol = useCallback(
        (sym: SymbolInfo) => {
            setCurrentSymbol(sym);
            void loadChartData(sym, currentPeriod, dataSource, replayActive, false);
        },
        [currentPeriod, dataSource, replayActive, loadChartData]
    );

    const handleSelectPeriod = useCallback(
        (per: Period) => {
            setCurrentPeriod(per);
            void loadChartData(currentSymbol, per, dataSource, replayActive, true);
        },
        [currentSymbol, dataSource, replayActive, loadChartData]
    );
    selectPrimaryPeriodBridgeRef.current = handleSelectPeriod;

    const handleChangeTimezone = useCallback((nextTz: string) => {
        setTimezone(nextTz);
        try {
            localStorage.setItem('torex_replay_timezone_v1', nextTz);
        } catch (_) {}
    }, []);

    const handleChangeDataSource = useCallback(
        (mode: DataSourceMode) => {
            setDataSource(mode);
            void loadChartData(currentSymbol, currentPeriod, mode, replayActive, true);
        },
        [currentSymbol, currentPeriod, replayActive, loadChartData]
    );

    const handleSelectCandleStyle = useCallback((styleId: ChartCandleStyleId) => {
        setSelectedCandleStyle(styleId);
        if (styleId === 'bars') setCandleStyle(CandleType.Ohlc);
        else if (styleId === 'hollow_candles') setCandleStyle(CandleType.CandleStroke);
        else if (styleId === 'lines' || styleId === 'area') setCandleStyle(CandleType.Area);
        else setCandleStyle(CandleType.CandleSolid);
    }, []);

    const handleCycleCandleStyle = useCallback(() => {
        setSelectedCandleStyle((prev) => {
            const idx = CANDLE_STYLE_OPTIONS.findIndex((o) => o.id === prev);
            const next = CANDLE_STYLE_OPTIONS[(idx + 1) % CANDLE_STYLE_OPTIONS.length];
            setCandleStyle(resolveNativeCandleType(next.id));
            return next.id;
        });
    }, []);

    const hydrateWorkspaceStateRef = useRef({
        activeIndicators,
        indicatorParamsByCode,
        drawnItems,
        drawingStylesById,
        magnetMode,
        drawingsLocked,
        drawingsVisible,
        chartTheme,
    });
    hydrateWorkspaceStateRef.current = {
        activeIndicators,
        indicatorParamsByCode,
        drawnItems,
        drawingStylesById,
        magnetMode,
        drawingsLocked,
        drawingsVisible,
        chartTheme,
    };

    const hydrateTerminalWorkspace = useCallback(
        (chart: Chart) => {
            const {
                activeIndicators: inds,
                indicatorParamsByCode: indParams,
                drawnItems: items,
                drawingStylesById: stylesMap,
                magnetMode: mag,
                drawingsLocked: globalLocked,
                drawingsVisible: globalVisible,
                chartTheme: themeVal,
            } = hydrateWorkspaceStateRef.current;

            applyChartTheme(chart, themeVal);
            auxChartRefs.current.forEach((auxChart) => {
                if (auxChart) applyChartTheme(auxChart, themeVal);
            });

            if (!yAxisAutoScaleRef.current && yAxisCustomRangeRef.current) {
                applyYAxisRange(chart, yAxisCustomRangeRef.current.from, yAxisCustomRangeRef.current.to);
            } else {
                const ctx = getCandlePaneAndYAxis(chart);
                if (ctx) {
                    ctx.yAxis.setAutoCalcTickFlag?.(true);
                    (chart as any).adjustPaneViewport?.(false, true, true, true, true);
                }
            }

            inds.forEach((code) => {
                const found = AVAILABLE_INDICATORS.find((i) => i.code === code);
                const paneId = found?.pane === 'main' ? 'candle_pane' : `pane_${code}`;
                try {
                    chart.removeIndicator(paneId, code);
                } catch (_) {}

                const rawParams = indParams[code];
                const parsedParams = rawParams
                    ? rawParams
                          .split(',')
                          .map((v) => Number(v.trim()))
                          .filter((n) => Number.isFinite(n) && n > 0)
                    : undefined;
                const indPayload: any =
                    parsedParams && parsedParams.length > 0 ? { name: code, calcParams: parsedParams } : code;

                if (found?.pane === 'main') {
                    chart.createIndicator(indPayload, true, { id: 'candle_pane' });
                } else {
                    chart.createIndicator(indPayload, false, { id: `pane_${code}`, height: 105 });
                }
            });

            drawnOverlayIdsRef.current.forEach((id) => {
                try {
                    chart.removeOverlay(id);
                } catch (_) {}
            });
            drawnOverlayIdsRef.current = [];

            const candles = chart.getDataList() || [];
            const restoredItems: DrawnObjectItem[] = [];
            const restoredStyles: Record<string, DrawingStyleState> = {};
            const restoredGeoms: Record<string, OverlayPointCoord[]> = {};

            items.forEach((item) => {
                const pts = overlayGeometriesRef.current[item.id];
                const styleState = stylesMap[item.id] || {
                    ...DEFAULT_DRAWING_STYLE,
                    lineColor: item.color || DEFAULT_DRAWING_STYLE.lineColor,
                    fillColor: item.color || DEFAULT_DRAWING_STYLE.fillColor,
                    extendData: item.extendData ?? '',
                };

                if (Array.isArray(pts) && pts.length > 0) {
                    const effectiveLock = Boolean(item.locked ?? globalLocked);
                    const effectiveVis = globalVisible ? item.visible !== false : false;
                    const newId = mountOverlayWithHandlers(chart, {
                        preferredId: item.id,
                        name: item.name,
                        points: pts,
                        extendData: styleState.extendData ?? item.extendData,
                        mode: mag ? OverlayMode.WeakMagnet : OverlayMode.Normal,
                        lock: effectiveLock,
                        visible: effectiveVis,
                        styleState,
                    });
                    if (newId) {
                        const resolvedPts = resolveOverlayPointsAgainstCandles(pts, candles);
                        drawnOverlayIdsRef.current.push(newId);
                        restoredItems.push({
                            ...item,
                            id: newId,
                            locked: effectiveLock,
                            visible: effectiveVis,
                        });
                        restoredStyles[newId] = styleState;
                        restoredGeoms[newId] = resolvedPts;
                    }
                }
            });

            overlayGeometriesRef.current = restoredGeoms;
            setDrawingStylesById(restoredStyles);
            setDrawnItems(restoredItems);

            const df = datafeedRef.current;
            if (df && candles.length > 0) {
                const last = candles[candles.length - 1];
                const { currentSymbol: sym, currentPeriod: per } = liveRef.current;
                lastCutoffRef.current = {
                    key: `${sym.ticker}:${per.text}`,
                    ts: last.timestamp,
                    canonicalTs: df.getReplayTimestamp() ?? last.timestamp,
                };
                setOrders((cur) => {
                    if (cur.length === 0) return cur;
                    return recomputeOrders(cur, {
                        symbol: sym.ticker,
                        candles: df.getFullHistory(),
                        uptoTs: last.timestamp,
                        rewind: false,
                    });
                });
            }
        },
        [
            applyChartTheme,
            auxChartRefs,
            getCandlePaneAndYAxis,
            applyYAxisRange,
            mountOverlayWithHandlers,
            drawnOverlayIdsRef,
            overlayGeometriesRef,
            setDrawingStylesById,
            setDrawnItems,
            lastCutoffRef,
            setOrders,
        ]
    );

    const hydrateTerminalWorkspaceRef = useRef(hydrateTerminalWorkspace);
    hydrateTerminalWorkspaceRef.current = hydrateTerminalWorkspace;

    const applySnapshotToTerminal = useCallback(
        async (snap: ReplayStateSnapshot) => {
            isRestoringSnapshotRef.current = true;
            try {
                const chart = chartRef.current;
                const df = datafeedRef.current;

                const nextCandleStyle = snap.selectedCandleStyle || 'candles';
                setOrders(snap.orders || []);
                setJournalNotes(snap.journalNotes || '');
                setSessionScreenshots(snap.sessionScreenshots || []);
                setSelectedCandleStyle(nextCandleStyle);
                setCandleStyle(resolveNativeCandleType(nextCandleStyle));
                setLayoutMode(snap.layoutMode || '1x1');
                if (snap.timezone) setTimezone(snap.timezone);
                if (Array.isArray(snap.auxPeriodTexts) && snap.auxPeriodTexts.length > 0) {
                    const sec = findTimeframeByText(snap.auxPeriodTexts?.[0]);
                    if (sec) setSecondaryPeriod(sec);
                    const p2 = snap.auxPeriodTexts[1] ? findTimeframeByText(snap.auxPeriodTexts?.[1]) : undefined;
                    const p3 = snap.auxPeriodTexts[2] ? findTimeframeByText(snap.auxPeriodTexts?.[2]) : undefined;
                    if (p2 || p3) {
                        setExtraAuxPeriods((prev) => [p2 || prev[0], p3 || prev[1]]);
                    }
                }
                if (snap.dataSource) setDataSource(snap.dataSource);
                if (typeof snap.replayActive === 'boolean') setReplayActive(snap.replayActive);
                if (typeof snap.syncEnabled === 'boolean') setSyncEnabled(snap.syncEnabled);

                if (snap.yAxis) {
                    yAxisAutoScaleRef.current = snap.yAxis.autoScale;
                    setYAxisAutoScale(snap.yAxis.autoScale);
                    yAxisLogScaleRef.current = snap.yAxis.logScale;
                    setYAxisLogScale(snap.yAxis.logScale);
                    yAxisCustomRangeRef.current = snap.yAxis.customRange ?? null;
                    setYAxisCustomRange(snap.yAxis.customRange ?? null);
                }
                if (snap.drawingTools) {
                    setMagnetMode(snap.drawingTools.magnetMode);
                    setDrawingsLocked(snap.drawingTools.drawingsLocked);
                    setDrawingsVisible(snap.drawingTools.drawingsVisible);
                }
                if (snap.ticketDefaults) {
                    setOrderSide(snap.ticketDefaults.orderSide);
                    setOrderType(snap.ticketDefaults.orderType);
                    setRiskPercent(snap.ticketDefaults.riskPercent);
                    setSlDistancePct(snap.ticketDefaults.slDistancePct);
                    setRrTarget(snap.ticketDefaults.rrTarget);
                    setSpread(snap.ticketDefaults.spread);
                    setCommission(snap.ticketDefaults.commission);
                } else {
                    setSpread(snap.spread ?? 0);
                    setCommission(snap.commission ?? 0);
                }

                if (chart && df && snap.replayTimestamp) {
                    const bars = await df.ensureTimestampLoaded(snap.replayTimestamp);
                    if (bars.length > 0) {
                        chart.applyNewData(bars);
                        setLatestBar(bars[bars.length - 1]);
                    }
                }

                if (chart) {
                    const axisType = yAxisLogScaleRef.current ? YAxisType.Log : YAxisType.Normal;
                    [chart, ...auxChartRefs.current].forEach((c) => {
                        if (!c) return;
                        c.setStyles({ yAxis: { type: axisType } } as any);
                    });
                    if (!yAxisAutoScaleRef.current && yAxisCustomRangeRef.current) {
                        applyYAxisRange(chart, yAxisCustomRangeRef.current.from, yAxisCustomRangeRef.current.to);
                    } else {
                        const ctx = getCandlePaneAndYAxis(chart);
                        if (ctx) {
                            ctx.yAxis.setAutoCalcTickFlag?.(true);
                            (chart as any).adjustPaneViewport?.(false, true, true, true, true);
                        }
                    }

                    activeIndicators.forEach((code) => {
                        const found = AVAILABLE_INDICATORS.find((i) => i.code === code);
                        const paneId = found?.pane === 'main' ? 'candle_pane' : `pane_${code}`;
                        try {
                            chart.removeIndicator(paneId, code);
                        } catch (_) {}
                    });
                    const nextInds = snap.activeIndicators || [];
                    const nextParams = snap.indicatorParamsByCode || indicatorParamsByCode;
                    nextInds.forEach((code) => {
                        const found = AVAILABLE_INDICATORS.find((i) => i.code === code);
                        const rawParams = nextParams[code];
                        const parsedParams = rawParams
                            ? rawParams
                                  .split(',')
                                  .map((v) => Number(v.trim()))
                                  .filter((n) => Number.isFinite(n) && n > 0)
                            : undefined;
                        const indPayload: any =
                            parsedParams && parsedParams.length > 0 ? { name: code, calcParams: parsedParams } : code;
                        if (found?.pane === 'main') chart.createIndicator(indPayload, true, { id: 'candle_pane' });
                        else chart.createIndicator(indPayload, false, { id: `pane_${code}`, height: 105 });
                    });
                    setActiveIndicators(nextInds);
                    setIndicatorParamsByCode(nextParams);

                    drawnOverlayIdsRef.current.forEach((id) => {
                        try {
                            chart.removeOverlay(id);
                        } catch (_) {}
                    });
                    drawnOverlayIdsRef.current = [];
                    const unpacked = unpackDrawingsV2({
                        drawings: snap.drawings,
                        drawnItems: snap.drawnItems,
                        drawingStylesById: snap.drawingStylesById,
                        overlayGeometries: snap.overlayGeometries,
                    });

                    const candles = chart.getDataList() || [];
                    const restoredItems: DrawnObjectItem[] = [];
                    const restoredStyles: Record<string, DrawingStyleState> = {};
                    const restoredGeoms: Record<string, OverlayPointCoord[]> = {};
                    const effectiveMagnet = snap.drawingTools?.magnetMode ?? magnetMode;
                    const effectiveGlobalVis = snap.drawingTools?.drawingsVisible ?? drawingsVisible;

                    unpacked.drawnItems.forEach((item) => {
                        const pts = unpacked.overlayGeometries[item.id];
                        const styleState = unpacked.drawingStylesById[item.id] || DEFAULT_DRAWING_STYLE;
                        if (Array.isArray(pts) && pts.length > 0) {
                            const effectiveVis = effectiveGlobalVis ? item.visible !== false : false;
                            const newId = mountOverlayWithHandlers(chart, {
                                preferredId: item.id,
                                name: item.name,
                                points: pts,
                                extendData: styleState.extendData ?? item.extendData,
                                mode: effectiveMagnet ? OverlayMode.WeakMagnet : OverlayMode.Normal,
                                lock: Boolean(item.locked),
                                visible: effectiveVis,
                                styleState,
                            });
                            if (newId) {
                                drawnOverlayIdsRef.current.push(newId);
                                restoredItems.push({ ...item, id: newId, visible: effectiveVis });
                                restoredStyles[newId] = styleState;
                                restoredGeoms[newId] = resolveOverlayPointsAgainstCandles(pts, candles);
                            }
                        }
                    });
                    overlayGeometriesRef.current = restoredGeoms;
                    setDrawingStylesById(restoredStyles);
                    setDrawnItems(restoredItems);
                }
            } finally {
                setTimeout(() => {
                    isRestoringSnapshotRef.current = false;
                }, 80);
            }
        },
        [
            activeIndicators,
            indicatorParamsByCode,
            magnetMode,
            drawingsVisible,
            applyYAxisRange,
            getCandlePaneAndYAxis,
            mountOverlayWithHandlers,
            auxChartRefs,
            setOrders,
            setLayoutMode,
            setSecondaryPeriod,
            setExtraAuxPeriods,
            setReplayActive,
            setMagnetMode,
            setDrawingsLocked,
            setDrawingsVisible,
            setOrderSide,
            setOrderType,
            setRiskPercent,
            setSlDistancePct,
            setRrTarget,
            setSpread,
            setCommission,
            drawnOverlayIdsRef,
            overlayGeometriesRef,
            setDrawingStylesById,
            setDrawnItems,
        ]
    );

    const currentYAxisState = useMemo<YAxisSessionState>(
        () => ({
            autoScale: yAxisAutoScale,
            logScale: yAxisLogScale,
            customRange: yAxisAutoScale ? null : yAxisCustomRange,
        }),
        [yAxisAutoScale, yAxisLogScale, yAxisCustomRange]
    );

    // 5) HOOK: Session Sync Controller (Zustand Time-Travel + V2 Vault + Debounced Sync + Unload + Active Timer)
    const syncController = useSessionSyncController({
        sessionId,
        initialRevision,
        savedRevision: saved?.revision,
        savedReplayTimestamp: saved?.replayTimestamp,
        initialReplayTimestamp,
        deepLinkTimestamp,
        initialBalance,
        displayAccountName,
        isEn,
        isHydratingCanvasRef,
        isRestoringSnapshotRef,
        canvasHydratedCount,
        captureCurrentOverlayGeometries,
        applySnapshotToTerminal,
        orders,
        drawnItems,
        drawingStylesById,
        pointsTick,
        activeIndicators,
        indicatorParamsByCode,
        selectedCandleStyle,
        layoutMode,
        dataSource,
        activeSourceLabel,
        isSynthetic,
        replayActive,
        autoPlaying,
        syncEnabled,
        currentYAxisState,
        currentDrawingToolsState,
        currentTicketDefaultsState,
        sessionScreenshots,
        journalNotes,
        latestBar,
        currentSymbol,
        currentPeriod,
        secondaryPeriod,
        auxPeriods,
        extraAuxPeriods,
        timezone,
        spread,
        commission,
        riskPercent,
        rrTarget,
        simBalance,
        floatingPnl,
        stats,
        quantMetrics,
        onBackToHub,
        onSessionStateSync,
        onSaveReplaySession,
    });

    const {
        savingSession,
        savedSuccess,
        effectiveRevision,
        undoStateRef,
        redoStateRef,
        handleUndoState,
        handleRedoState,
        handleBackToHubWithFlush,
        handleSaveReplaySession,
        zustandPastStatesCount,
        zustandFutureStatesCount,
        zustandSyncStatus,
        zustandCacheLayer,
        zustandOfflineOutboxCount,
        zustandExecutionFeed,
        zustandDismissExecutionEvent,
    } = syncController;

    // Fetch Replay Limits on mount
    useEffect(() => {
        api.get('/tradingview/replay-limits')
            .then((res) => {
                if (res?.data?.tier) {
                    const df = datafeedRef.current;
                    if (df && Number(res.data.maxBars) > 350) {
                        df.setMaxBars(res.data.maxBars);
                        const { currentSymbol: sym, currentPeriod: per, dataSource: mode, replayActive: rp } =
                            liveRef.current;
                        void loadChartDataRef.current?.(sym, per, mode, rp, true);
                    }
                }
            })
            .catch(() => {});
    }, []);

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
                    if (typeof val === 'number') {
                        priceVal = val;
                        lastCrosshairPriceRef.current = val;
                    }
                }
                legendOverlayRef.current?.updateLegend(data?.kLineData || null, yVal, priceVal);

                auxChartRefs.current.forEach((auxChart, idx) => {
                    if (!auxChart) return;
                    const syncLineId = `__mtf_xhair_${idx}__`;
                    if (priceVal !== null) {
                        const existing = auxChart.getOverlayById(syncLineId);
                        if (existing) {
                            auxChart.overrideOverlay({ id: syncLineId, points: [{ value: priceVal }] });
                        } else {
                            auxChart.createOverlay({
                                id: syncLineId,
                                name: 'priceLine',
                                points: [{ value: priceVal }],
                                lock: true,
                                styles: {
                                    line: {
                                        color: 'rgba(41, 98, 255, 0.45)',
                                        size: 1,
                                        style: LineType.Dashed,
                                        dashedValue: [3, 3],
                                    },
                                },
                            });
                        }
                    } else {
                        try {
                            auxChart.removeOverlay(syncLineId);
                        } catch (_) {}
                    }
                });
            });
        });

        chart.subscribeAction(ActionType.OnCandleBarClick, (data: any) => {
            if (cutCandleModeRef.current && typeof data?.dataIndex === 'number' && datafeedRef.current) {
                const full = datafeedRef.current.getFullHistory();
                if (full.length > 5) {
                    captureCurrentOverlayGeometries();
                    const ratio = Math.max(0.05, Math.min(0.99, (data.dataIndex + 1) / full.length));
                    const sliced = datafeedRef.current.setReplayMode(true, ratio, false);
                    chart.applyNewData(sliced);
                    reanchorMountedOverlays(chart);
                    setReplayActive(true);
                    setAutoPlaying(false);
                    setCutCandleMode(false);
                    const last = sliced[sliced.length - 1];
                    if (last) {
                        setLatestBar(last);
                        legendOverlayRef.current?.updateLegend(last, null, null);
                        const { currentSymbol: sym, currentPeriod: per } = liveRef.current;
                        recomputeOrdersAtCutoff(sym.ticker, per.text, last.timestamp, true);
                        syncAuxChartsRef.current?.(sym, last.timestamp);
                    }
                }
            }
        });

        const df = new CustomKLineDatafeed(
            dataSource,
            (candle, statsItem) => {
                setActiveSourceLabel(statsItem.source);
                setIsSynthetic(statsItem.synthetic);
                if (statsItem.batchProgress) setBatchProgress(statsItem.batchProgress);
                onFeedCandle(candle, statsItem);
            },
            (progress) => {
                setBatchProgress(progress);
            }
        );
        df.setSessionDateWindow(sessionFromDate, sessionToDate);
        df.setOnHistoryPrependedListener((visibleCandles) => {
            if (chartRef.current !== chart || isHydratingCanvasRef.current) return;
            if (visibleCandles.length > 0) {
                chart.applyNewData(visibleCandles, false);
                reanchorMountedOverlays(chart);
            }
        });
        datafeedRef.current = df;

        isHydratingCanvasRef.current = true;
        loadChartData(currentSymbol, currentPeriod, dataSource, replayActive, false)
            .then(async () => {
                if (chartRef.current !== chart) return;
                const ts = deepLinkTimestamp ?? saved?.replayTimestamp ?? initialReplayTimestamp;
                if (ts && replayActive) {
                    lastCutoffRef.current = null;
                    const bars = await df.ensureTimestampLoaded(ts);
                    if (chartRef.current === chart && bars.length > 0) {
                        chart.applyNewData(bars);
                        const last = bars[bars.length - 1];
                        setLatestBar(last);
                        legendOverlayRef.current?.updateLegend(last, null, null);
                        setLimitEntryPrice(String(last.close));
                        const { currentSymbol: sym, currentPeriod: per } = liveRef.current;
                        lastCutoffRef.current = {
                    key: `${sym.ticker}:${per.text}`,
                    ts: last.timestamp,
                    canonicalTs: df.getReplayTimestamp() ?? last.timestamp,
                };
                        syncAuxChartsRef.current?.(sym, last.timestamp);
                        if (deepLinkTradeId) {
                            const matchedTrade = (liveRef.current.orders || []).find((o) => o.id === deepLinkTradeId);
                            const scrollTs = matchedTrade ? matchedTrade.filledAt ?? matchedTrade.openedAt : ts;
                            requestAnimationFrame(() => {
                                try {
                                    chart.scrollToTimestamp(scrollTs, 240);
                                } catch (_) {}
                            });
                        }
                    }
                }
                if (chartRef.current === chart) {
                    hydrateTerminalWorkspaceRef.current?.(chart);
                }
            })
            .finally(() => {
                if (chartRef.current === chart) {
                    isHydratingCanvasRef.current = false;
                    setCanvasHydratedCount((c) => c + 1);
                }
            });

        let resizeRaf: number | null = null;
        const resizeObserver = new ResizeObserver(() => {
            if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
            resizeRaf = requestAnimationFrame(() => {
                resizeRaf = null;
                chart.resize();
            });
        });
        resizeObserver.observe(el);
        const unbindYAxis = bindPrecisionYAxisEvents(el, chart);

        return () => {
            if (rafCrosshairRef.current) {
                cancelAnimationFrame(rafCrosshairRef.current);
                rafCrosshairRef.current = null;
            }
            if (resizeRaf !== null) {
                cancelAnimationFrame(resizeRaf);
                resizeRaf = null;
            }
            if (screenshotCloseTimerRef.current !== null) {
                window.clearTimeout(screenshotCloseTimerRef.current);
                screenshotCloseTimerRef.current = null;
            }
            datafeedRef.current?.dispose();
            datafeedRef.current = null;
            unbindYAxis();
            setOverlayChartDataGetter(null);
            resizeObserver.disconnect();
            dispose(el);
            chartRef.current = null;
        };
    }, []);

    // Screenshots & Indicators Handlers
    const handleScreenshot = useCallback(() => {
        const chart = chartRef.current;
        if (!chart) return;
        const url = chart.getConvertPictureUrl(true, 'png', ct.background);
        setCapturedImageUrl(url);
        setScreenshotCaption(
            `${currentSymbol.ticker} (${currentPeriod.text}) • ${
                latestBar?.timestamp
                    ? new Date(latestBar.timestamp).toLocaleString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                      })
                    : 'Replay'
            }`
        );
        setScreenshotFeedback(null);
        setScreenshotModalOpen(true);
    }, [ct.background, currentSymbol.ticker, currentPeriod.text, latestBar?.timestamp]);

    const handleDownloadScreenshot = useCallback(() => {
        if (!capturedImageUrl) return;
        const a = document.createElement('a');
        a.href = capturedImageUrl;
        a.download = `Backtest_${currentSymbol.ticker}_${currentPeriod.text}_${Date.now()}.png`;
        a.click();
        setScreenshotFeedback(
            isEn ? 'Image downloaded (PNG export complete)!' : 'Imagem transferida (Download PNG concluído)!'
        );
    }, [capturedImageUrl, currentSymbol.ticker, currentPeriod.text, isEn]);

    const handleShareScreenshot = useCallback(async () => {
        if (!capturedImageUrl) return;
        try {
            const res = await fetch(capturedImageUrl);
            const blob = await res.blob();

            if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                setScreenshotFeedback(
                    isEn
                        ? 'Image copied to clipboard (Ctrl+V to paste)!'
                        : 'Imagem copiada para a Área de Transferência (Ctrl+V para colar)!'
                );
                return;
            }

            if (navigator.share) {
                const file = new File([blob], `Backtest_${currentSymbol.ticker}_${currentPeriod.text}.png`, {
                    type: 'image/png',
                });
                await navigator.share({
                    title: `Replay ${currentSymbol.ticker} (${currentPeriod.text})`,
                    text: screenshotCaption,
                    files: [file],
                });
                setScreenshotFeedback(isEn ? 'Snapshot shared successfully!' : 'Captura compartilhada com sucesso!');
                return;
            }
        } catch (_) {}

        try {
            await navigator.clipboard.writeText(window.location.href);
            setScreenshotFeedback(
                isEn ? 'Session link copied to clipboard!' : 'Link da sessão copiado para a Área de Transferência!'
            );
        } catch (_) {
            setScreenshotFeedback(isEn ? 'Ready to share!' : 'Pronto para compartilhar!');
        }
    }, [capturedImageUrl, currentSymbol.ticker, currentPeriod.text, screenshotCaption, isEn]);

    const handleSaveScreenshotToJournal = useCallback(() => {
        if (!capturedImageUrl) return;
        const shotId = `shot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const rawImage = capturedImageUrl;
        const newShot: SessionScreenshotItem = {
            id: shotId,
            dataUrl: rawImage,
            symbol: currentSymbol.ticker,
            timeframe: currentPeriod.text,
            candleStyle: selectedCandleStyle,
            caption: screenshotCaption.trim() || `${currentSymbol.ticker} · ${currentPeriod.text}`,
            createdAt: Date.now(),
            replayTimestamp: latestBar?.timestamp ?? null,
        };
        setSessionScreenshots((prev) => [newShot, ...prev]);

        void uploadBacktestScreenshot(sessionId, shotId, rawImage).then((uploadedUrl) => {
            if (uploadedUrl) {
                setSessionScreenshots((prev) =>
                    prev.map((item) => (item.id === shotId ? { ...item, dataUrl: uploadedUrl } : item))
                );
            }
        });

        const stamp = new Date().toLocaleTimeString(isEn ? 'en-US' : 'pt-BR', { hour: '2-digit', minute: '2-digit' });
        const noteEntry = `\n[📸 ${isEn ? 'Snapshot' : 'Captura'} ${stamp} — ${currentSymbol.ticker} ${currentPeriod.text}]: ${
            screenshotCaption.trim() || (isEn ? 'Snapshot saved to Journal' : 'Snapshot salvo no Journal')
        }`;
        setJournalNotes((prev) => (prev ? `${prev}${noteEntry}` : noteEntry.trim()));
        setScreenshotFeedback(isEn ? 'Snapshot saved to Session Journal!' : 'Captura salva no Journal da Sessão!');
        setRightDrawer('journal');
        if (screenshotCloseTimerRef.current !== null) {
            window.clearTimeout(screenshotCloseTimerRef.current);
        }
        screenshotCloseTimerRef.current = window.setTimeout(() => {
            screenshotCloseTimerRef.current = null;
            setScreenshotModalOpen(false);
        }, 700);
    }, [
        sessionId,
        capturedImageUrl,
        currentSymbol.ticker,
        currentPeriod.text,
        selectedCandleStyle,
        screenshotCaption,
        latestBar?.timestamp,
        isEn,
    ]);

    const handleRemoveScreenshot = useCallback((id: string) => {
        setSessionScreenshots((prev) => {
            const target = prev.find((s) => s.id === id);
            if (target?.dataUrl?.startsWith('/uploads/backtest-screenshots/')) {
                void deleteBacktestScreenshotFile(target.dataUrl);
            }
            return prev.filter((s) => s.id !== id);
        });
    }, []);

    const handleResetSimulation = useCallback(() => {
        setAutoPlaying(false);
        setOrders([]);
        setJournalNotes('');
        handleDismissQuickTag();
        lastCutoffRef.current = null;
        clearLocalReplaySnapshot(sessionId);
    }, [sessionId, setAutoPlaying, setOrders, handleDismissQuickTag, lastCutoffRef]);

    const handleToggleIndicator = useCallback(
        (code: string, pane: string) => {
            const chart = chartRef.current;
            if (!chart) return;
            if (activeIndicators.includes(code)) {
                if (pane === 'main') chart.removeIndicator('candle_pane', code);
                else chart.removeIndicator(`pane_${code}`, code);
                setActiveIndicators((prev) => prev.filter((i) => i !== code));
            } else {
                const rawParams = indicatorParamsByCode[code];
                const parsedParams = rawParams
                    ? rawParams
                          .split(',')
                          .map((v) => Number(v.trim()))
                          .filter((n) => Number.isFinite(n) && n > 0)
                    : undefined;

                const indPayload: any =
                    parsedParams && parsedParams.length > 0 ? { name: code, calcParams: parsedParams } : code;

                if (pane === 'main') chart.createIndicator(indPayload, true, { id: 'candle_pane' });
                else chart.createIndicator(indPayload, false, { id: `pane_${code}`, height: 105 });
                setActiveIndicators((prev) => [...prev, code]);
            }
        },
        [activeIndicators, indicatorParamsByCode]
    );

    const handleClearAllIndicators = useCallback(() => {
        const chart = chartRef.current;
        if (!chart) return;
        activeIndicators.forEach((code) => {
            const found = AVAILABLE_INDICATORS.find((i) => i.code === code);
            const paneId = found?.pane === 'main' ? 'candle_pane' : `pane_${code}`;
            chart.removeIndicator(paneId, code);
        });
        setActiveIndicators([]);
    }, [activeIndicators]);

    const handleRemoveIndicatorByCode = useCallback(
        (code: string) => {
            const found = AVAILABLE_INDICATORS.find((i) => i.code === code);
            handleToggleIndicator(code, found?.pane || 'sub');
        },
        [handleToggleIndicator]
    );

    const handleUpdateIndicatorParams = useCallback(
        (code: string, paramStr: string) => {
            const chart = chartRef.current;
            if (!chart) return;
            const found = AVAILABLE_INDICATORS.find((i) => i.code === code);
            const pane = found?.pane || 'sub';
            const parsedParams = paramStr
                .split(',')
                .map((v) => Number(v.trim()))
                .filter((n) => Number.isFinite(n) && n > 0);
            setIndicatorParamsByCode((prev) => ({ ...prev, [code]: paramStr }));
            if (parsedParams.length > 0 && activeIndicators.includes(code)) {
                const paneId = pane === 'main' ? 'candle_pane' : `pane_${code}`;
                chart.overrideIndicator({ name: code, calcParams: parsedParams }, paneId);
            }
        },
        [activeIndicators]
    );

    // Global Keyboard Shortcuts
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
            } else if (e.key === 'ArrowRight' && e.shiftKey) {
                e.preventDefault();
                handleFastForward();
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
            } else if (e.altKey && (e.key === 'h' || e.key === 'H')) {
                e.preventDefault();
                const price = lastCrosshairPriceRef.current ?? latestBar?.close;
                if (typeof price === 'number' && Number.isFinite(price)) {
                    placeHorizontalLineAtPrice(price, latestBar?.timestamp ?? Date.now(), currentSymbol.pricePrecision ?? 2);
                }
            } else if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'f' || e.key === 'F')) {
                e.preventDefault();
                setFocusWorkspaceMode((prev) => !prev);
            } else if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'c' || e.key === 'C')) {
                e.preventDefault();
                setCutCandleMode((prev) => !prev);
            } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
                e.preventDefault();
                undoStateRef.current();
            } else if (
                ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) ||
                ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z'))
            ) {
                e.preventDefault();
                redoStateRef.current();
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
                handleDismissQuickTag();
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [
        handleTogglePlay,
        handleStepForward,
        handleFastForward,
        handleStepBackward,
        setOrderSide,
        executeOrderWithSide,
        selectedDrawingId,
        handleRemoveDrawingById,
        latestBar?.close,
        latestBar?.timestamp,
        currentSymbol.pricePrecision,
        placeHorizontalLineAtPrice,
        setCutCandleMode,
        setZoomAreaMode,
        setZoomBox,
        handleDismissQuickTag,
        undoStateRef,
        redoStateRef,
    ]);

    const handleToggleFullscreen = useCallback(() => {
        setIsFullscreen((prev) => {
            const next = !prev;
            if (typeof document !== 'undefined') {
                if (next && !document.fullscreenElement) {
                    document.documentElement.requestFullscreen?.().catch(() => {});
                } else if (!next && document.fullscreenElement) {
                    document.exitFullscreen?.().catch(() => {});
                }
            }
            return next;
        });
    }, []);

    useEffect(() => {
        const onNativeFsChange = () => {
            if (!document.fullscreenElement) {
                setIsFullscreen(false);
            }
        };
        document.addEventListener('fullscreenchange', onNativeFsChange);
        return () => document.removeEventListener('fullscreenchange', onNativeFsChange);
    }, []);

    useEffect(() => {
        onFullscreenChange?.(isFullscreen);
        window.dispatchEvent(new CustomEvent('cossa:backtest-fullscreen', { detail: { isFullscreen } }));
        const timer = setTimeout(() => {
            requestAnimationFrame(() => {
                chartRef.current?.resize();
                auxChartRefs.current.forEach((c) => c?.resize());
            });
        }, 45);
        return () => clearTimeout(timer);
    }, [isFullscreen, onFullscreenChange, auxChartRefs]);

    useEffect(() => {
        return () => {
            window.dispatchEvent(new CustomEvent('cossa:backtest-fullscreen', { detail: { isFullscreen: false } }));
        };
    }, []);

    const formattedReplayClock = useMemo(() => {
        if (!latestBar?.timestamp) return '—';
        const d = new Date(latestBar.timestamp);
        const tzOpt = timezone && timezone !== 'local' ? { timeZone: timezone } : {};
        try {
            const when = d.toLocaleString('pt-BR', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                ...tzOpt,
            });
            let tzLabel = '';
            try {
                tzLabel =
                    new Intl.DateTimeFormat('pt-BR', { timeZoneName: 'shortOffset', ...tzOpt })
                        .formatToParts(d)
                        .find((p) => p.type === 'timeZoneName')?.value || '';
            } catch (_) {}
            return tzLabel ? `${when} (${tzLabel})` : when;
        } catch (_) {
            return d.toLocaleString('pt-BR', {
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
            });
        }
    }, [latestBar?.timestamp, timezone]);

    const availableSetups = useMemo(
        () =>
            Array.from(
                new Set(orders.map((o) => o.setup).filter((s): s is string => Boolean(s && s.trim())))
            ),
        [orders]
    );

    const isLight = chartTheme === 'light';
    const decimals = currentSymbol.pricePrecision ?? 2;

    return (
        <div
            className={
                isFullscreen
                    ? 'fixed inset-0 z-[9999] w-screen h-screen flex flex-col select-none overflow-hidden bg-surface text-fg'
                    : sessionId
                      ? 'w-full h-screen flex flex-col select-none overflow-hidden bg-surface text-fg'
                      : 'select-none overflow-hidden rounded-2xl border border-line bg-surface text-fg shadow-lg flex flex-col'
            }
        >
            {/* LAYER 1: TOP TOOLBAR */}
            <TopToolbarLayer
                isLight={isLight}
                currentSymbol={currentSymbol}
                currentPeriod={currentPeriod}
                secondaryPeriod={secondaryPeriod}
                focusedPaneIndex={focusedPaneIndex}
                focusedPanePeriod={panePeriods[focusedPaneIndex] || currentPeriod}
                panePeriods={panePeriods}
                layoutMode={layoutMode}
                activeIndicatorsCount={activeIndicators.length}
                dataSource={dataSource}
                selectedCandleStyle={selectedCandleStyle}
                focusWorkspaceMode={focusWorkspaceMode}
                onToggleFocusWorkspace={() => setFocusWorkspaceMode((v) => !v)}
                onSelectSymbol={handleSelectSymbol}
                onSelectPeriod={handleSelectPeriod}
                onSelectSecondaryPeriod={handleSelectSecondaryPeriod}
                onSelectPanePeriod={handleSelectPanePeriod}
                onChangeLayoutMode={setLayoutMode}
                onCycleCandleStyle={handleCycleCandleStyle}
                onSelectCandleStyle={handleSelectCandleStyle}
                onOpenIndicators={() => setIndicatorModalOpen(true)}
                onUndoDrawing={handleUndoDrawing}
                onClearDrawings={handleClearDrawings}
                onChangeDataSource={handleChangeDataSource}
                onToggleTheme={toggleTheme}
                onToggleTradeDrawer={() => setRightDrawer((d) => (d === 'trade' ? 'none' : 'trade'))}
                onResetSimulation={handleResetSimulation}
                onScreenshot={handleScreenshot}
                isFullscreen={isFullscreen}
                onToggleFullscreen={handleToggleFullscreen}
                sessionName={sessionName}
                strategyName={strategyName}
                sessionPairs={sessionPairs}
                onBackToHub={onBackToHub ? handleBackToHubWithFlush : undefined}
                batchProgress={batchProgress}
                onLoadEarlierBatch={handleLoadEarlierBatch}
                sessionTrades={orders}
                activeJumpTradeId={activeJumpTradeId}
                onJumpToSessionTrade={handleJumpToSessionTrade}
                onUndoState={handleUndoState}
                onRedoState={handleRedoState}
                canUndoState={zustandPastStatesCount > 0}
                canRedoState={zustandFutureStatesCount > 0}
                undoCount={zustandPastStatesCount}
                redoCount={zustandFutureStatesCount}
                syncStatus={zustandSyncStatus}
                cacheLayer={zustandCacheLayer}
                revision={effectiveRevision}
                offlineOutboxCount={zustandOfflineOutboxCount}
                cutCandleMode={cutCandleMode}
                onActivateCutCandle={() => setCutCandleMode((prev) => !prev)}
            />

            {/* WORKSPACE: LAYER 2 (LEFT TOOLS) + LAYER 3 & 4 (CHART(S) & FLOATING PILL) + LAYER 5 (RIGHT PANEL) */}
            <div className={`relative flex ${isFullscreen || sessionId ? 'flex-1 min-h-0' : 'h-[calc(100vh-145px)] min-h-[540px]'}`}>
                {!focusWorkspaceMode && (
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
                )}

                {/* CENTER MULTI-LAYOUT CANVAS AREA */}
                <div className="flex-1 relative overflow-hidden min-w-0 min-h-0">
                    <div className={`w-full h-full ${gridLayoutClass}`}>
                        {/* PRIMARY CHART CONTAINER */}
                        <div
                            onMouseDownCapture={() => {
                                if (focusedPaneIndex !== 0) setFocusedPaneIndex(0);
                            }}
                            className={`relative w-full h-full min-w-0 min-h-0 bg-surface overflow-hidden ${
                                layoutMode === '1+2' ? 'row-span-2' : ''
                            } ${
                                layoutMode !== '1x1' && focusedPaneIndex === 0 ? 'ring-1 ring-inset ring-accent/55' : ''
                            }`}
                        >
                            <ChartLegendOverlayLayer
                                ref={legendOverlayRef}
                                ticker={currentSymbol.ticker}
                                periodText={currentPeriod.text}
                                decimals={decimals}
                                timezone={timezone}
                                initialBar={latestBar}
                                cutCandleMode={cutCandleMode}
                                activeIndicators={activeIndicators}
                                indicatorParamsByCode={indicatorParamsByCode}
                                onUpdateIndicatorParams={handleUpdateIndicatorParams}
                                onRemoveIndicator={handleRemoveIndicatorByCode}
                                onCancelCutCandle={() => setCutCandleMode(false)}
                                onQuickLimitOrderAtPrice={handleQuickLimitOrderAtPrice}
                            />

                            {/* FLOATING MARKET EXECUTION TOAST FEED */}
                            {zustandExecutionFeed.length > 0 && (
                                <div className="absolute top-11 right-16 z-30 flex flex-col gap-1.5 max-w-xs pointer-events-none">
                                    {zustandExecutionFeed.map((evt) => {
                                        const isPositive =
                                            evt.kind === 'TP_HIT' || (evt.pnl !== undefined && evt.pnl > 0);
                                        const isNegative =
                                            evt.kind === 'SL_HIT' || (evt.pnl !== undefined && evt.pnl < 0);
                                        return (
                                            <div
                                                key={evt.id}
                                                className={`pointer-events-auto px-3 py-2 rounded-xl border shadow-lg backdrop-blur-md text-xs flex items-start justify-between gap-2 transition-all ${
                                                    isPositive
                                                        ? 'bg-emerald-950/85 border-emerald-500/40 text-emerald-100'
                                                        : isNegative
                                                          ? 'bg-rose-950/85 border-rose-500/40 text-rose-100'
                                                          : 'bg-surface/92 border-line text-fg'
                                                }`}
                                            >
                                                <div className="min-w-0">
                                                    <div className="font-bold text-[11px] leading-tight truncate">{evt.title}</div>
                                                    <div className="text-[10px] font-mono opacity-85 mt-0.5 truncate">
                                                        {evt.detail}
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => zustandDismissExecutionEvent(evt.id)}
                                                    className="p-0.5 rounded opacity-60 hover:opacity-100 cursor-pointer shrink-0"
                                                >
                                                    <X size={12} />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* FLOATING DRAWING STYLE TOOLBAR */}
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

                            {/* AREA SELECTION ZOOM OVERLAY */}
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
                                        setZoomBox((prev) => (prev ? { ...prev, endX: x, endY: y } : null));
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
                                            chart.zoomAtCoordinate(1.45, { x: box.endX, y: box.endY });
                                            const ctx = getCandlePaneAndYAxis(chart);
                                            const paneH =
                                                ctx?.pane?.getMainWidget?.()?.getBounding?.()?.height ||
                                                Math.max(180, rect.height - 120);
                                            const ratio = Math.max(0.1, Math.min(0.9, box.endY / paneH));
                                            handleScaleYAxisByFactor(0.76, ratio, chart);
                                        } else {
                                            const pts = chart.convertFromPixel(
                                                [
                                                    { x: minX, y: minY },
                                                    { x: maxX, y: maxY },
                                                ],
                                                { paneId: 'candle_pane' }
                                            ) as any;
                                            const p1 = Array.isArray(pts) ? pts[0] : null;
                                            const p2 = Array.isArray(pts) ? pts[1] : null;
                                            if (
                                                p1 &&
                                                p2 &&
                                                typeof p1.dataIndex === 'number' &&
                                                typeof p2.dataIndex === 'number' &&
                                                widthPx >= 14
                                            ) {
                                                const minIdx = Math.min(p1.dataIndex, p2.dataIndex);
                                                const maxIdx = Math.max(p1.dataIndex, p2.dataIndex);
                                                const selectedBars = Math.max(4, maxIdx - minIdx + 1);
                                                const usableWidth = Math.max(200, rect.width - 68);
                                                const targetBarSpace = Math.max(
                                                    4,
                                                    Math.min(48, Math.floor(usableWidth / selectedBars))
                                                );
                                                chart.setBarSpace(targetBarSpace);
                                                chart.scrollToDataIndex(maxIdx, 180);
                                            } else if (widthPx >= 14) {
                                                const centerX = (minX + maxX) / 2;
                                                const centerY = (minY + maxY) / 2;
                                                const factor = Math.max(1.3, Math.min(3.5, rect.width / Math.max(40, widthPx)));
                                                chart.zoomAtCoordinate(factor, { x: centerX, y: centerY });
                                            }

                                            if (
                                                p1 &&
                                                p2 &&
                                                typeof p1.value === 'number' &&
                                                typeof p2.value === 'number' &&
                                                heightPx >= 14
                                            ) {
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
                                    <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-[#2962ff] text-white text-[11px] font-semibold shadow-lg flex items-center gap-2 pointer-events-auto">
                                        <span>
                                            {isEn
                                                ? 'Drag to select Zoom area (Horizontal + Vertical)'
                                                : 'Arraste para selecionar a área de Zoom (Horizontal + Vertical)'}
                                        </span>
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

                            {/* CUT CANDLE INTERACTIVE OVERLAY */}
                            {cutCandleMode && (
                                <div
                                    className="absolute inset-0 z-30 cursor-crosshair select-none"
                                    onClick={(e) => {
                                        const chart = chartRef.current;
                                        const df = datafeedRef.current;
                                        if (!chart || !df) return;
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        const localX = e.clientX - rect.left;
                                        const localY = e.clientY - rect.top;
                                        const pt = chart.convertFromPixel([{ x: localX, y: localY }], {
                                            paneId: 'candle_pane',
                                        }) as any;
                                        const resolved = Array.isArray(pt) ? pt[0] : pt;
                                        const clickedIdx = resolved?.dataIndex;
                                        const clickedTs = resolved?.timestamp;

                                        const full = df.getFullHistory();
                                        if (full.length > 5) {
                                            let targetFullIdx = -1;
                                            if (typeof clickedTs === 'number' && clickedTs > 0) {
                                                targetFullIdx = full.findIndex((b) => b.timestamp >= clickedTs);
                                            }
                                            if (targetFullIdx < 0 && typeof clickedIdx === 'number') {
                                                const visibleList = chart.getDataList() || [];
                                                const targetBar =
                                                    visibleList[Math.max(0, Math.min(visibleList.length - 1, clickedIdx))];
                                                if (targetBar) {
                                                    targetFullIdx = full.findIndex(
                                                        (b) => b.timestamp >= targetBar.timestamp
                                                    );
                                                }
                                            }
                                            if (targetFullIdx >= 0) {
                                                captureCurrentOverlayGeometries();
                                                const ratio = Math.max(
                                                    0.05,
                                                    Math.min(0.99, (targetFullIdx + 1) / full.length)
                                                );
                                                const sliced = df.setReplayMode(true, ratio, false);
                                                chart.applyNewData(sliced);
                                                reanchorMountedOverlays(chart);
                                                setReplayActive(true);
                                                setAutoPlaying(false);
                                                setCutCandleMode(false);
                                                const last = sliced[sliced.length - 1];
                                                if (last) {
                                                    setLatestBar(last);
                                                    legendOverlayRef.current?.updateLegend(last, null, null);
                                                    const { currentSymbol: sym, currentPeriod: per } = liveRef.current;
                                                    recomputeOrdersAtCutoff(sym.ticker, per.text, last.timestamp, true);
                                                    void syncAllAuxCharts(sym, last.timestamp);
                                                }
                                            }
                                        }
                                    }}
                                />
                            )}

                            {/* NATIVE KLINECHARTS PRIMARY CANVAS */}
                            <div ref={chartDivRef} className={`w-full h-full ${zoomAreaMode ? 'cursor-zoom-in' : ''}`} />

                            {/* Y-AXIS QUICK CONTROLS ([+] [-] [A] [L]) */}
                            <div
                                className="absolute bottom-7 right-1.5 z-20 flex items-center gap-0.5 px-1 py-0.5 rounded-md border border-line bg-surface/90 backdrop-blur-xs shadow-sm select-none"
                                title={
                                    isEn
                                        ? 'Vertical Axis Controls (Drag price scale or scroll over axis to adjust)'
                                        : 'Controles do Eixo Vertical (Arraste o eixo de preço ou use Scroll sobre o eixo para ajustar)'
                                }
                            >
                                <button
                                    type="button"
                                    onClick={() => handleScaleYAxisByFactor(0.82, 0.5)}
                                    title={isEn ? 'Expand vertical scale (Zoom +)' : 'Expandir escala vertical (Zoom + no preço)'}
                                    className="w-5 h-5 rounded flex items-center justify-center text-[11px] font-bold text-fg-muted hover:text-fg hover:bg-surface-2 cursor-pointer transition-colors"
                                >
                                    +
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleScaleYAxisByFactor(1.22, 0.5)}
                                    title={isEn ? 'Compress vertical scale (Zoom -)' : 'Comprimir escala vertical (Zoom - no preço)'}
                                    className="w-5 h-5 rounded flex items-center justify-center text-[11px] font-bold text-fg-muted hover:text-fg hover:bg-surface-2 cursor-pointer transition-colors"
                                >
                                    −
                                </button>
                                <button
                                    type="button"
                                    onClick={handleResetYAxisAutoScale}
                                    title={
                                        yAxisAutoScale
                                            ? isEn
                                                ? 'Vertical Auto-Scale active (A) — drag vertically on chart to pan freely'
                                                : 'Auto-escala vertical ativa (A) — arraste verticalmente no gráfico para mover livremente'
                                            : isEn
                                              ? 'Click to re-enable Vertical Auto-Scale (A) or double-click price scale'
                                              : 'Clique para reativar Auto-escala vertical (A) ou dê duplo-clique no eixo de preço'
                                    }
                                    className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold cursor-pointer transition-colors ${
                                        yAxisAutoScale
                                            ? 'bg-accent text-accent-on shadow-2xs'
                                            : 'text-fg-muted hover:text-fg hover:bg-surface-2 border border-line-subtle'
                                    }`}
                                >
                                    A
                                </button>
                                <button
                                    type="button"
                                    onClick={handleToggleYAxisLogScale}
                                    title={
                                        isEn
                                            ? 'Toggle Logarithmic Scale (L) on price axis'
                                            : 'Alternar Escala Logarítmica (L) no eixo vertical'
                                    }
                                    className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold cursor-pointer transition-colors ${
                                        yAxisLogScale
                                            ? 'bg-accent text-accent-on shadow-2xs'
                                            : 'text-fg-muted hover:text-fg hover:bg-surface-2'
                                    }`}
                                >
                                    L
                                </button>
                            </div>
                        </div>

                        {/* AUXILIARY CHART CONTAINERS */}
                        {Array.from({ length: auxPaneCount }).map((_, auxIdx) => {
                            const paneIndex = auxIdx + 1;
                            const panePeriod = auxPeriods[auxIdx] || secondaryPeriod;
                            const isPaneFocused = focusedPaneIndex === paneIndex;
                            return (
                                <div
                                    key={`aux-pane-${auxIdx}`}
                                    onMouseDownCapture={() => {
                                        if (focusedPaneIndex !== paneIndex) setFocusedPaneIndex(paneIndex);
                                    }}
                                    className={`relative w-full h-full min-w-0 min-h-0 bg-surface overflow-hidden ${
                                        isPaneFocused ? 'ring-1 ring-inset ring-accent/55' : ''
                                    }`}
                                >
                                    <div className="absolute top-2 left-2.5 z-20 flex items-center gap-1.5 pointer-events-auto">
                                        <span
                                            className={`px-2 py-0.5 rounded text-[11px] font-bold border shadow-2xs ${
                                                isPaneFocused
                                                    ? 'bg-accent/15 border-accent/40 text-accent-fg'
                                                    : 'bg-surface/90 border-line text-fg'
                                            }`}
                                        >
                                            {currentSymbol.ticker} · {panePeriod.text}
                                        </span>
                                        <div className="flex items-center gap-0.5 bg-surface/90 border border-line p-0.5 rounded-md backdrop-blur-xs">
                                            {TIMEFRAMES.map((tf) => (
                                                <button
                                                    key={tf.text}
                                                    type="button"
                                                    onClick={() => handleSelectPanePeriod(paneIndex, tf)}
                                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-colors ${
                                                        panePeriod.text === tf.text
                                                            ? 'bg-accent text-accent-on'
                                                            : 'text-fg-muted hover:text-fg hover:bg-surface-2'
                                                    }`}
                                                >
                                                    {tf.text}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div
                                        ref={(el) => {
                                            auxChartDivRefs.current[auxIdx] = el;
                                        }}
                                        className="w-full h-full"
                                    />
                                </div>
                            );
                        })}
                    </div>

                    {/* LAYER 4: FLOATING REPLAY BAR */}
                    <FloatingReplayBarLayer
                        autoPlaying={autoPlaying}
                        replaySpeedLabel={replaySpeedLabel}
                        syncEnabled={syncEnabled}
                        cutCandleMode={cutCandleMode}
                        savingSession={savingSession}
                        savedSuccess={savedSuccess}
                        currentReplayTimestamp={latestBar?.timestamp ?? null}
                        onStepBackward={handleStepBackward}
                        onTogglePlay={handleTogglePlay}
                        onStepForward={handleStepForward}
                        onFastForward={handleFastForward}
                        onChangeSpeed={handleChangeSpeed}
                        onToggleSync={() => setSyncEnabled((s) => !s)}
                        onActivateCutCandle={() => setCutCandleMode((prev) => !prev)}
                        onJumpToRatio={handleJumpToRatio}
                        onJumpToTimestamp={handleJumpToTimestamp}
                        onToggleTradeDrawer={() => setRightDrawer((d) => (d === 'trade' ? 'none' : 'trade'))}
                        onToggleJournalDrawer={() => setRightDrawer((d) => (d === 'journal' ? 'none' : 'journal'))}
                        onSaveSession={handleSaveReplaySession}
                    />
                </div>

                {/* LAYER 5: RIGHT SLIDE-OVER & ACTION BAR */}
                {(!focusWorkspaceMode || rightDrawer !== 'none') && (
                    <RightSidePanelLayer
                        ticker={currentSymbol.ticker}
                        periodText={currentPeriod.text}
                        rightDrawer={rightDrawer}
                        orderSide={orderSide}
                        orderType={orderType}
                        limitEntryPrice={limitEntryPrice}
                        currentBid={latestBar?.close ?? 0}
                        decimals={decimals}
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
                        sessionScreenshots={sessionScreenshots}
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
                        onRemoveScreenshot={handleRemoveScreenshot}
                        onOpenScreenshotModal={handleScreenshot}
                        showChartOrderPreview={showChartOrderPreview}
                        onToggleChartOrderPreview={() => setShowChartOrderPreview((v) => !v)}
                    />
                )}
            </div>

            {/* POST-TRADE INLINE QUICK-TAGGING FLOATING CARD */}
            <PostTradeQuickTagCard
                trade={quickTagOrder}
                availableSetups={availableSetups}
                onSaveTag={handleUpdateOrderQuickTag}
                onDismiss={handleDismissQuickTag}
            />

            {/* LAYER 6: BOTTOM POSITIONS / PENDING / HISTORY DOCK */}
            <BottomDockLayer
                orders={orders}
                simBalance={simBalance}
                initialBalance={initialBalance}
                floatingPnl={floatingPnl}
                netProfit={netProfit}
                formattedReplayClock={formattedReplayClock}
                timezone={timezone}
                currentReplayTimestamp={latestBar?.timestamp ?? null}
                onChangeTimezone={handleChangeTimezone}
                onJumpToTimestamp={handleJumpToTimestamp}
                onJumpToTrade={handleJumpToSessionTrade}
                onMoveOrderToBreakEven={handleMoveOrderToBreakEven}
                onPartialCloseOrder={handlePartialCloseOrder}
                onCloseOrCancelOrder={handleCloseOrCancelOrder}
                onQuickTagTrade={handleOpenQuickTagForOrder}
            />

            {/* LAYER 7: SIMPLIFIED INDICATORS MODAL */}
            {indicatorModalOpen &&
                typeof document !== 'undefined' &&
                createPortal(
                    <div
                        className="fixed inset-0 z-[10050] bg-black/55 backdrop-blur-xs flex items-center justify-center p-4 select-none"
                        onClick={() => setIndicatorModalOpen(false)}
                    >
                        <div
                            onClick={(e) => e.stopPropagation()}
                            className="w-full max-w-md max-h-[76vh] rounded-xl border border-line bg-surface text-fg shadow-2xl flex flex-col overflow-hidden"
                        >
                            <div className="px-4 py-3 border-b border-line flex items-center justify-between">
                                <h3 className="font-bold text-sm text-fg">{isEn ? 'Indicators' : 'Indicadores'}</h3>
                                <div className="flex items-center gap-2">
                                    {activeIndicators.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={handleClearAllIndicators}
                                            className="px-2 py-1 rounded-md bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
                                        >
                                            <Trash2 size={12} />
                                            <span>
                                                {isEn ? `Clear (${activeIndicators.length})` : `Limpar (${activeIndicators.length})`}
                                            </span>
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setIndicatorModalOpen(false)}
                                        className="p-1 rounded-md text-fg-muted hover:text-fg hover:bg-surface-2 cursor-pointer transition-colors"
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                            </div>

                            <div className="p-3 border-b border-line bg-surface-2/30">
                                <div className="relative">
                                    <Search
                                        size={15}
                                        className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none"
                                    />
                                    <input
                                        type="text"
                                        autoFocus
                                        value={indicatorSearch}
                                        onChange={(e) => setIndicatorSearch(e.target.value)}
                                        placeholder={isEn ? 'Search indicator...' : 'Pesquisar indicador...'}
                                        className="w-full pl-9 pr-8 py-2 rounded-lg bg-surface border border-line text-xs text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent"
                                    />
                                    {indicatorSearch && (
                                        <button
                                            type="button"
                                            onClick={() => setIndicatorSearch('')}
                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg cursor-pointer"
                                        >
                                            <X size={13} />
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto py-1.5 px-2 space-y-0.5">
                                {AVAILABLE_INDICATORS.filter((ind) => {
                                    if (!indicatorSearch.trim()) return true;
                                    const q = indicatorSearch.trim().toLowerCase();
                                    return (
                                        ind.name.toLowerCase().includes(q) ||
                                        (ind.nameEn && ind.nameEn.toLowerCase().includes(q)) ||
                                        ind.code.toLowerCase().includes(q)
                                    );
                                }).map((ind) => {
                                    const isAdded = activeIndicators.includes(ind.code);
                                    return (
                                        <button
                                            key={ind.code}
                                            type="button"
                                            onClick={() => handleToggleIndicator(ind.code, ind.pane)}
                                            className={`w-full px-3 py-2 rounded-lg text-left text-xs flex items-center justify-between transition-colors cursor-pointer ${
                                                isAdded
                                                    ? 'bg-accent/12 text-accent-fg font-bold'
                                                    : 'text-fg hover:bg-surface-2 font-medium'
                                            }`}
                                        >
                                            <span className="truncate">{isEn ? ind.nameEn || ind.name : ind.name}</span>
                                            {isAdded && <Check size={14} className="shrink-0 text-accent-fg" />}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>,
                    document.body
                )}

            {/* LAYER 8: SCREENSHOT CAPTURE & ALTERNATIVES MODAL */}
            {screenshotModalOpen &&
                typeof document !== 'undefined' &&
                createPortal(
                    <div
                        className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-[10050] p-4"
                        onClick={() => setScreenshotModalOpen(false)}
                    >
                        <div
                            onClick={(e) => e.stopPropagation()}
                            className="w-full max-w-xl rounded-2xl border border-line bg-surface text-fg shadow-2xl flex flex-col overflow-hidden"
                        >
                            <div className="px-5 py-3.5 border-b border-line flex items-center justify-between">
                                <div className="flex items-center gap-2.5">
                                    <span className="w-8 h-8 rounded-xl bg-accent/15 text-accent-fg flex items-center justify-center">
                                        <Camera size={16} />
                                    </span>
                                    <div>
                                        <h3 className="font-bold text-sm text-fg">
                                            {isEn
                                                ? 'Chart Screenshot (Snapshot)'
                                                : 'Captura de Ecrã do Gráfico (Snapshot)'}
                                        </h3>
                                        <p className="text-[11px] text-fg-muted">
                                            {currentSymbol.ticker} • {currentPeriod.text} • {isEn ? 'Style:' : 'Estilo:'}{' '}
                                            {CANDLE_STYLE_OPTIONS.find((o) => o.id === selectedCandleStyle)?.shortLabel ||
                                                'Candles'}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setScreenshotModalOpen(false)}
                                    className="p-1.5 rounded-lg hover:bg-surface-2 cursor-pointer opacity-70 hover:opacity-100"
                                >
                                    <X size={16} />
                                </button>
                            </div>

                            <div className="p-5 space-y-4">
                                {capturedImageUrl && (
                                    <div className="relative rounded-xl overflow-hidden border border-line bg-black/30 shadow-inner">
                                        <img
                                            src={capturedImageUrl}
                                            alt={isEn ? 'Chart Snapshot' : 'Captura do Gráfico'}
                                            className="w-full max-h-72 object-contain"
                                        />
                                        <div className="absolute top-2.5 left-2.5 px-2.5 py-1 rounded-lg bg-black/75 text-white text-[11px] font-mono font-bold backdrop-blur-xs">
                                            {currentSymbol.ticker} · {currentPeriod.text}
                                        </div>
                                    </div>
                                )}

                                <div>
                                    <label className="text-[11px] font-bold uppercase tracking-wider text-fg-muted block mb-1.5">
                                        {isEn
                                            ? 'Caption / Note for Session Journal'
                                            : 'Legenda / Anotação para o Journal da Sessão'}
                                    </label>
                                    <input
                                        type="text"
                                        value={screenshotCaption}
                                        onChange={(e) => setScreenshotCaption(e.target.value)}
                                        placeholder={
                                            isEn
                                                ? 'e.g. Entry after liquidity sweep during London session...'
                                                : 'Ex: Entrada após sweep de liquidez na sessão de Londres...'
                                        }
                                        className="w-full px-3.5 py-2 rounded-xl bg-surface-2 border border-line text-xs text-fg focus:outline-none focus:border-accent"
                                    />
                                </div>

                                {screenshotFeedback && (
                                    <div className="px-3.5 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 text-xs font-bold flex items-center gap-2">
                                        <Check size={14} />
                                        <span>{screenshotFeedback}</span>
                                    </div>
                                )}

                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                                    <button
                                        type="button"
                                        onClick={handleDownloadScreenshot}
                                        className="py-2.5 px-3 rounded-xl bg-surface-2 hover:bg-surface-3 border border-line text-fg font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors"
                                    >
                                        <Download size={15} className="text-accent-fg" />
                                        <span>{isEn ? 'Download (PNG)' : 'Baixar (PNG)'}</span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={handleShareScreenshot}
                                        className="py-2.5 px-3 rounded-xl bg-surface-2 hover:bg-surface-3 border border-line text-fg font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors"
                                    >
                                        <Share2 size={15} className="text-blue-400" />
                                        <span>{isEn ? 'Share / Copy' : 'Compartilhar / Copiar'}</span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={handleSaveScreenshotToJournal}
                                        className="py-2.5 px-3 rounded-xl bg-accent hover:opacity-95 text-accent-on font-bold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-md transition-opacity"
                                    >
                                        <BookOpen size={15} />
                                        <span>{isEn ? 'Save to Journal' : 'Salvar no Journal'}</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}
        </div>
    );
};
