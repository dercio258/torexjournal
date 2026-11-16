import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KLineData } from 'klinecharts';
import { SymbolInfo, Period } from '@klinecharts/pro';
import { DataSourceMode } from '../../../services/klineDatafeed';
import { flushPendingSessionSyncQueue } from '../../../services/historicalBatchCache';
import { useReplaySessionStore, ReplayStateSnapshot } from '../../../store/useReplaySessionStore';
import { ChartCandleStyleId, ReplayOrder, SessionScreenshotItem } from '../types';
import { ChartLayoutMode } from '../layers/TopToolbarLayer';
import { DrawnObjectItem } from '../layers/RightSidePanelLayer';
import { DrawingStyleState, OverlayPointCoord } from '../layers/DrawingStyleToolbarLayer';
import { QuantAnalyticsReport } from '../indicators/quantMathEngine';
import { ReplayStats } from '../engine';
import {
    BACKTEST_SNAPSHOT_SCHEMA_VERSION,
    BacktestSessionSnapshotV2,
    DrawingToolsWorkspaceState,
    packDrawingsV2,
    TicketDefaultsState,
    writeLocalReplaySnapshot,
    YAxisSessionState,
} from '../../../services/backtestSessionSnapshot';

export interface UseSessionSyncPayloadContract {
    schemaVersion: 2;
    revision: number;
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
    drawings?: any[];
    drawnItems?: DrawnObjectItem[];
    drawingStylesById?: Record<string, DrawingStyleState>;
    overlayGeometries?: Record<string, OverlayPointCoord[]>;
    activeIndicators?: string[];
    indicatorParamsByCode?: Record<string, string>;
    selectedCandleStyle?: ChartCandleStyleId;
    layoutMode?: ChartLayoutMode;
    dataSource?: DataSourceMode;
    replayActive?: boolean;
    syncEnabled?: boolean;
    yAxis?: YAxisSessionState;
    drawingTools?: DrawingToolsWorkspaceState;
    ticketDefaults?: TicketDefaultsState;
    sessionScreenshots?: SessionScreenshotItem[];
    quantMetrics?: QuantAnalyticsReport;
    journalNotes: string;
    replayTimestamp: number | null;
    primarySymbol: string;
    timeframe: string;
    secondaryTimeframe: string;
    auxPeriodTexts?: string[];
    timezone?: string;
    spread: number;
    commission: number;
    deltaSeconds?: number;
}

export interface UseSessionSyncControllerParams {
    sessionId?: string;
    initialRevision?: number;
    savedRevision?: number;
    savedReplayTimestamp?: number | null;
    initialReplayTimestamp?: number | null;
    deepLinkTimestamp?: number;
    initialBalance: number;
    displayAccountName: string;
    isEn: boolean;
    isHydratingCanvasRef: React.MutableRefObject<boolean>;
    isRestoringSnapshotRef: React.MutableRefObject<boolean>;
    canvasHydratedCount: number;
    captureCurrentOverlayGeometries: () => Record<string, OverlayPointCoord[]>;
    applySnapshotToTerminal: (snap: ReplayStateSnapshot) => Promise<void>;
    orders: ReplayOrder[];
    drawnItems: DrawnObjectItem[];
    drawingStylesById: Record<string, DrawingStyleState>;
    pointsTick: number;
    activeIndicators: string[];
    indicatorParamsByCode: Record<string, string>;
    selectedCandleStyle: ChartCandleStyleId;
    layoutMode: ChartLayoutMode;
    dataSource: DataSourceMode;
    activeSourceLabel: string;
    isSynthetic: boolean;
    replayActive: boolean;
    autoPlaying: boolean;
    syncEnabled: boolean;
    currentYAxisState: YAxisSessionState;
    currentDrawingToolsState: DrawingToolsWorkspaceState;
    currentTicketDefaultsState: TicketDefaultsState;
    sessionScreenshots: SessionScreenshotItem[];
    journalNotes: string;
    latestBar: KLineData | null;
    currentSymbol: SymbolInfo;
    currentPeriod: Period;
    secondaryPeriod: Period;
    auxPeriods: [Period, Period, Period];
    extraAuxPeriods: [Period, Period];
    timezone: string;
    spread: number;
    commission: number;
    riskPercent: number;
    rrTarget: number;
    simBalance: number;
    floatingPnl: number;
    stats: ReplayStats;
    quantMetrics: QuantAnalyticsReport;
    onBackToHub?: () => void;
    onSessionStateSync?: (payload: any) => Promise<boolean> | void;
    onSaveReplaySession?: (sessionPayload: any) => Promise<void>;
}

export function useSessionSyncController({
    sessionId,
    initialRevision,
    savedRevision,
    savedReplayTimestamp,
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
}: UseSessionSyncControllerParams) {
    const zustandRevision = useReplaySessionStore((s) => s.revision);
    const zustandInitSession = useReplaySessionStore((s) => s.initSession);
    const zustandRecordMove = useReplaySessionStore((s) => s.recordMove);
    const zustandUndoMove = useReplaySessionStore((s) => s.undoMove);
    const zustandRedoMove = useReplaySessionStore((s) => s.redoMove);
    const zustandPastStates = useReplaySessionStore((s) => s.pastStates);
    const zustandFutureStates = useReplaySessionStore((s) => s.futureStates);
    const zustandSyncStatus = useReplaySessionStore((s) => s.syncStatus);
    const zustandSetSyncStatus = useReplaySessionStore((s) => s.setSyncStatus);
    const zustandCacheLayer = useReplaySessionStore((s) => s.cacheLayer);
    const zustandOfflineOutboxCount = useReplaySessionStore((s) => s.offlineOutboxCount);
    const zustandSetStorageTelemetry = useReplaySessionStore((s) => s.setStorageTelemetry);
    const zustandExecutionFeed = useReplaySessionStore((s) => s.executionFeed);
    const zustandDismissExecutionEvent = useReplaySessionStore((s) => s.dismissExecutionEvent);

    const [savingSession, setSavingSession] = useState<boolean>(false);
    const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

    useEffect(() => {
        void flushPendingSessionSyncQueue();
        const onTelemetry = (ev: Event) => {
            const detail = (ev as CustomEvent)?.detail;
            if (detail && typeof detail === 'object') {
                zustandSetStorageTelemetry(detail);
            }
        };
        window.addEventListener('torex:storage-telemetry', onTelemetry);
        return () => window.removeEventListener('torex:storage-telemetry', onTelemetry);
    }, [zustandSetStorageTelemetry]);

    useEffect(() => {
        if (zustandExecutionFeed.length === 0) return;
        const oldest = zustandExecutionFeed[zustandExecutionFeed.length - 1];
        const timer = setTimeout(() => {
            zustandDismissExecutionEvent(oldest.id);
        }, 4800);
        return () => clearTimeout(timer);
    }, [zustandExecutionFeed, zustandDismissExecutionEvent]);

    const handleUndoState = useCallback(() => {
        const snap = zustandUndoMove();
        if (snap) {
            void applySnapshotToTerminal(snap);
        }
    }, [zustandUndoMove, applySnapshotToTerminal]);

    const handleRedoState = useCallback(() => {
        const snap = zustandRedoMove();
        if (snap) {
            void applySnapshotToTerminal(snap);
        }
    }, [zustandRedoMove, applySnapshotToTerminal]);

    const undoStateRef = useRef<() => void>(() => {});
    const redoStateRef = useRef<() => void>(() => {});
    undoStateRef.current = handleUndoState;
    redoStateRef.current = handleRedoState;

    const currentGeometriesSnapshot = captureCurrentOverlayGeometries();
    const currentDrawingsV2 = useMemo(
        () => packDrawingsV2(drawnItems, drawingStylesById, currentGeometriesSnapshot, currentPeriod.text),
        [drawnItems, drawingStylesById, currentGeometriesSnapshot, currentPeriod.text]
    );

    const effectiveRevision = Math.max(zustandRevision, savedRevision ?? initialRevision ?? 0);
    const effectiveReplayTs = replayActive
        ? latestBar?.timestamp ?? deepLinkTimestamp ?? savedReplayTimestamp ?? initialReplayTimestamp ?? null
        : null;

    // Initialize Zustand V2 session store once canvas hydration completes with live anchored geometries
    useEffect(() => {
        if (isHydratingCanvasRef.current) return;
        const freshGeoms = captureCurrentOverlayGeometries();
        const freshDrawings = packDrawingsV2(drawnItems, drawingStylesById, freshGeoms, currentPeriod.text);
        zustandInitSession(sessionId || 'default_replay_session', {
            schemaVersion: BACKTEST_SNAPSHOT_SCHEMA_VERSION,
            revision: savedRevision ?? initialRevision ?? 0,
            actionLabel: isEn ? 'Session Start' : 'Início da Sessão',
            timestamp: Date.now(),
            replayTimestamp: effectiveReplayTs,
            ticker: currentSymbol.ticker,
            periodText: currentPeriod.text,
            secondaryPeriodText: secondaryPeriod.text,
            auxPeriodTexts: auxPeriods.map((p) => p.text),
            timezone,
            dataSource,
            layoutMode,
            selectedCandleStyle,
            replayActive,
            syncEnabled,
            yAxis: currentYAxisState,
            drawingTools: currentDrawingToolsState,
            ticketDefaults: currentTicketDefaultsState,
            orders,
            drawings: freshDrawings,
            drawnItems,
            drawingStylesById,
            overlayGeometries: freshGeoms,
            activeIndicators,
            indicatorParamsByCode,
            journalNotes,
            sessionScreenshots,
            spread,
            commission,
        });
    }, [sessionId, canvasHydratedCount]);

    const latestBarTsRef = useRef<number | undefined>(latestBar?.timestamp);
    latestBarTsRef.current = latestBar?.timestamp;

    // Record every movement automatically in Zustand (Undo/Redo + Canonical V2 localStorage + AES-256 IDB)
    useEffect(() => {
        if (isRestoringSnapshotRef.current || isHydratingCanvasRef.current) return;
        const freshGeoms = captureCurrentOverlayGeometries();
        const freshDrawings = packDrawingsV2(drawnItems, drawingStylesById, freshGeoms, currentPeriod.text);
        const snapReplayTs = latestBarTsRef.current ?? effectiveReplayTs;
        zustandRecordMove(
            {
                schemaVersion: BACKTEST_SNAPSHOT_SCHEMA_VERSION,
                revision: effectiveRevision,
                timestamp: Date.now(),
                replayTimestamp: snapReplayTs,
                ticker: currentSymbol.ticker,
                periodText: currentPeriod.text,
                secondaryPeriodText: secondaryPeriod.text,
                auxPeriodTexts: auxPeriods.map((p) => p.text),
                timezone,
                dataSource,
                layoutMode,
                selectedCandleStyle,
                replayActive,
                syncEnabled,
                yAxis: currentYAxisState,
                drawingTools: currentDrawingToolsState,
                ticketDefaults: currentTicketDefaultsState,
                orders,
                drawings: freshDrawings,
                drawnItems,
                drawingStylesById,
                overlayGeometries: freshGeoms,
                activeIndicators,
                indicatorParamsByCode,
                journalNotes,
                sessionScreenshots,
                spread,
                commission,
            },
            'Movimento de Replay'
        );
    }, [
        orders,
        drawnItems,
        drawingStylesById,
        pointsTick,
        activeIndicators,
        indicatorParamsByCode,
        selectedCandleStyle,
        layoutMode,
        dataSource,
        replayActive,
        syncEnabled,
        currentYAxisState,
        currentDrawingToolsState,
        currentTicketDefaultsState,
        journalNotes,
        sessionScreenshots,
        currentSymbol.ticker,
        currentPeriod.text,
        secondaryPeriod.text,
        extraAuxPeriods,
        timezone,
        spread,
        commission,
    ]);

    const syncRef = useRef(onSessionStateSync);
    syncRef.current = onSessionStateSync;

    const latestV2SnapshotRef = useRef<BacktestSessionSnapshotV2 | null>(null);
    latestV2SnapshotRef.current = {
        schemaVersion: BACKTEST_SNAPSHOT_SCHEMA_VERSION,
        revision: effectiveRevision,
        sessionId: sessionId || 'default_replay_session',
        updatedAtMs: Date.now(),
        ticker: currentSymbol.ticker,
        periodText: currentPeriod.text,
        secondaryPeriodText: secondaryPeriod.text,
        auxPeriodTexts: auxPeriods.map((p) => p.text),
        timezone,
        dataSource,
        layoutMode,
        selectedCandleStyle,
        replayTimestamp: effectiveReplayTs,
        replayActive,
        syncEnabled,
        yAxis: currentYAxisState,
        drawingTools: currentDrawingToolsState,
        ticketDefaults: currentTicketDefaultsState,
        drawings: currentDrawingsV2,
        drawnItems,
        drawingStylesById,
        overlayGeometries: currentGeometriesSnapshot,
        activeIndicators,
        indicatorParamsByCode,
        orders,
        journalNotes,
        sessionScreenshots,
        spread,
        commission,
    };

    const latestSyncPayloadRef = useRef<UseSessionSyncPayloadContract | null>(null);
    latestSyncPayloadRef.current = {
        schemaVersion: BACKTEST_SNAPSHOT_SCHEMA_VERSION,
        revision: effectiveRevision,
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
        drawings: currentDrawingsV2,
        drawnItems,
        drawingStylesById,
        overlayGeometries: currentGeometriesSnapshot,
        activeIndicators,
        indicatorParamsByCode,
        selectedCandleStyle,
        layoutMode,
        dataSource,
        replayActive,
        syncEnabled,
        yAxis: currentYAxisState,
        drawingTools: currentDrawingToolsState,
        ticketDefaults: currentTicketDefaultsState,
        sessionScreenshots,
        quantMetrics,
        journalNotes,
        replayTimestamp: effectiveReplayTs,
        primarySymbol: currentSymbol.ticker,
        timeframe: currentPeriod.text,
        secondaryTimeframe: secondaryPeriod.text,
        auxPeriodTexts: auxPeriods.map((p) => p.text),
        timezone,
        spread,
        commission,
    };

    const lastUserActivityRef = useRef<number>(Date.now());
    const pendingPracticeSecondsRef = useRef<number>(0);
    const autoPlayingRef = useRef<boolean>(autoPlaying);
    autoPlayingRef.current = autoPlaying;

    const ordersPersistSignature = useMemo(
        () =>
            orders
                .map((o) =>
                    [
                        o.id,
                        o.status,
                        o.orderType,
                        o.entryPrice,
                        o.stopLoss,
                        o.takeProfit,
                        o.lots,
                        o.slModifiedAt ?? '',
                        o.filledAt ?? '',
                        o.closedAt ?? '',
                        o.exitPrice ?? '',
                        o.status === 'OPEN' ? 'open' : o.pnl,
                        o.rating ?? '',
                        o.setup ?? '',
                        o.psychCheck?.followingPlan ?? '',
                        o.psychCheck?.feeling ?? '',
                        (o.journalContent || '').length,
                        (o.journalImages || []).length,
                    ].join(':')
                )
                .join('|'),
        [orders]
    );
    const prevOrdersSigRef = useRef<string>(ordersPersistSignature);

    const handleBackToHubWithFlush = useCallback(() => {
        if (!isHydratingCanvasRef.current) {
            if (latestV2SnapshotRef.current) {
                const freshGeoms = captureCurrentOverlayGeometries();
                const freshDrawings = packDrawingsV2(
                    latestV2SnapshotRef.current.drawnItems,
                    latestV2SnapshotRef.current.drawingStylesById,
                    freshGeoms,
                    latestV2SnapshotRef.current.periodText
                );
                writeLocalReplaySnapshot(sessionId, {
                    ...latestV2SnapshotRef.current,
                    updatedAtMs: Date.now(),
                    overlayGeometries: freshGeoms,
                    drawings: freshDrawings,
                });
            }
            if (syncRef.current && latestSyncPayloadRef.current) {
                const pendingSec = pendingPracticeSecondsRef.current;
                if (pendingSec > 0) pendingPracticeSecondsRef.current = 0;
                void Promise.resolve(
                    syncRef.current({
                        ...latestSyncPayloadRef.current,
                        ...(pendingSec > 0 ? { deltaSeconds: pendingSec } : {}),
                    })
                ).catch(() => {});
            }
        }
        onBackToHub?.();
    }, [sessionId, captureCurrentOverlayGeometries, onBackToHub, isHydratingCanvasRef]);

    // Debounced sync of session state (600ms) + skip autoplay candle ticks unless order state mutated
    useEffect(() => {
        if (!syncRef.current || isHydratingCanvasRef.current) return;
        const ordersChanged = prevOrdersSigRef.current !== ordersPersistSignature;
        if (autoPlaying && !ordersChanged) return;

        const timer = setTimeout(() => {
            if (syncRef.current && latestSyncPayloadRef.current && !isHydratingCanvasRef.current) {
                prevOrdersSigRef.current = ordersPersistSignature;
                zustandSetSyncStatus('syncing_cloud');
                Promise.resolve(syncRef.current(latestSyncPayloadRef.current))
                    .then((ok) => {
                        zustandSetSyncStatus(ok === false ? 'offline_queued' : 'saved');
                    })
                    .catch(() => {
                        zustandSetSyncStatus('error');
                    });
            }
        }, 600);
        return () => clearTimeout(timer);
    }, [
        canvasHydratedCount,
        ordersPersistSignature,
        autoPlaying,
        drawnItems,
        drawingStylesById,
        pointsTick,
        activeIndicators,
        indicatorParamsByCode,
        selectedCandleStyle,
        layoutMode,
        dataSource,
        replayActive,
        syncEnabled,
        currentYAxisState,
        currentDrawingToolsState,
        currentTicketDefaultsState,
        sessionScreenshots,
        journalNotes,
        currentSymbol.ticker,
        currentPeriod.text,
        secondaryPeriod.text,
        spread,
        commission,
        zustandSetSyncStatus,
        isHydratingCanvasRef,
    ]);

    // Ensure canonical V2 localStorage + parent sync flush immediately before page close/reload/tab switch
    useEffect(() => {
        const flushLocal = () => {
            if (isHydratingCanvasRef.current) return;
            if (latestV2SnapshotRef.current) {
                const freshGeoms = captureCurrentOverlayGeometries();
                const freshDrawings = packDrawingsV2(
                    latestV2SnapshotRef.current.drawnItems,
                    latestV2SnapshotRef.current.drawingStylesById,
                    freshGeoms,
                    latestV2SnapshotRef.current.periodText
                );
                writeLocalReplaySnapshot(sessionId, {
                    ...latestV2SnapshotRef.current,
                    updatedAtMs: Date.now(),
                    overlayGeometries: freshGeoms,
                    drawings: freshDrawings,
                });
            }
            if (syncRef.current && latestSyncPayloadRef.current) {
                const pendingSec = pendingPracticeSecondsRef.current;
                if (pendingSec > 0) pendingPracticeSecondsRef.current = 0;
                void Promise.resolve(
                    syncRef.current({
                        ...latestSyncPayloadRef.current,
                        ...(pendingSec > 0 ? { deltaSeconds: pendingSec } : {}),
                    })
                ).catch(() => {});
            }
        };

        const onVisChange = () => {
            if (document.visibilityState === 'hidden') {
                flushLocal();
            } else if (document.visibilityState === 'visible') {
                lastUserActivityRef.current = Date.now();
            }
        };

        window.addEventListener('beforeunload', flushLocal);
        window.addEventListener('pagehide', flushLocal);
        document.addEventListener('visibilitychange', onVisChange);
        return () => {
            window.removeEventListener('beforeunload', flushLocal);
            window.removeEventListener('pagehide', flushLocal);
            document.removeEventListener('visibilitychange', onVisChange);
            flushLocal();
        };
    }, [sessionId, captureCurrentOverlayGeometries, isHydratingCanvasRef]);

    // Track active practice time (visible + recent input or autoplay), flushing every 60s
    useEffect(() => {
        const markActive = () => {
            lastUserActivityRef.current = Date.now();
        };
        window.addEventListener('pointerdown', markActive, { passive: true });
        window.addEventListener('keydown', markActive, { passive: true });

        const timer = setInterval(() => {
            const isVisible = typeof document === 'undefined' || document.visibilityState === 'visible';
            const isEngaged = autoPlayingRef.current || Date.now() - lastUserActivityRef.current < 60_000;
            if (!isVisible || !isEngaged) return;

            pendingPracticeSecondsRef.current += 15;
            if (pendingPracticeSecondsRef.current >= 60 && syncRef.current && latestSyncPayloadRef.current) {
                const delta = pendingPracticeSecondsRef.current;
                pendingPracticeSecondsRef.current = 0;
                void Promise.resolve(
                    syncRef.current({
                        ...latestSyncPayloadRef.current,
                        deltaSeconds: delta,
                    })
                ).catch(() => {});
            }
        }, 15000);

        return () => {
            clearInterval(timer);
            window.removeEventListener('pointerdown', markActive);
            window.removeEventListener('keydown', markActive);
        };
    }, []);

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
                notes:
                    journalNotes ||
                    (isEn
                        ? `Replay Session on ${currentSymbol.ticker} (${displayAccountName})`
                        : `Sessão de Replay em ${currentSymbol.ticker} (${displayAccountName})`),
            });
            setSavedSuccess(true);
            setTimeout(() => setSavedSuccess(false), 2500);
        } finally {
            setSavingSession(false);
        }
    }, [
        onSaveReplaySession,
        currentSymbol.ticker,
        currentPeriod.text,
        initialBalance,
        riskPercent,
        rrTarget,
        spread,
        commission,
        dataSource,
        activeSourceLabel,
        isSynthetic,
        simBalance,
        floatingPnl,
        stats,
        journalNotes,
        displayAccountName,
        isEn,
    ]);

    return {
        savingSession,
        savedSuccess,
        effectiveRevision,
        effectiveReplayTs,
        undoStateRef,
        redoStateRef,
        handleUndoState,
        handleRedoState,
        handleBackToHubWithFlush,
        handleSaveReplaySession,
        zustandPastStatesCount: zustandPastStates.length,
        zustandFutureStatesCount: zustandFutureStates.length,
        zustandSyncStatus,
        zustandCacheLayer,
        zustandOfflineOutboxCount,
        zustandExecutionFeed,
        zustandDismissExecutionEvent,
    };
}
