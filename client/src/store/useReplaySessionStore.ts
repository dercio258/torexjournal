import { create } from 'zustand';
import {
    ReplayOrder,
    ChartCandleStyleId,
    SessionScreenshotItem,
} from '../components/kline-replay/types';
import { DrawnObjectItem } from '../components/kline-replay/layers/RightSidePanelLayer';
import { DrawingStyleState, OverlayPointCoord } from '../components/kline-replay/layers/DrawingStyleToolbarLayer';
import { ChartLayoutMode } from '../components/kline-replay/layers/TopToolbarLayer';
import { DataSourceMode } from '../services/klineDatafeed';
import { saveEncryptedSessionToIDB } from '../services/historicalBatchCache';
import {
    BACKTEST_SNAPSHOT_SCHEMA_VERSION,
    BacktestSessionSnapshotV2,
    DrawingEntityV2,
    DrawingToolsWorkspaceState,
    packDrawingsV2,
    TicketDefaultsState,
    unpackDrawingsV2,
    writeLocalReplaySnapshot,
    YAxisSessionState,
} from '../services/backtestSessionSnapshot';
import { computeStats } from '../components/kline-replay/engine';
import { computeOrdersSignature, sanitizeValidatedOrders } from '../schemas/backtestContracts';

export interface ReplayStateSnapshot {
    schemaVersion?: 2;
    revision?: number;
    ticker: string;
    periodText: string;
    secondaryPeriodText: string;
    auxPeriodTexts?: string[];
    timezone?: string;
    dataSource?: DataSourceMode;
    layoutMode: ChartLayoutMode;
    selectedCandleStyle: ChartCandleStyleId;
    replayActive?: boolean;
    syncEnabled?: boolean;
    yAxis?: YAxisSessionState;
    drawingTools?: DrawingToolsWorkspaceState;
    ticketDefaults?: TicketDefaultsState;
    orders: ReplayOrder[];
    drawings?: DrawingEntityV2[];
    drawnItems: DrawnObjectItem[];
    drawingStylesById: Record<string, DrawingStyleState>;
    overlayGeometries: Record<string, OverlayPointCoord[]>;
    activeIndicators: string[];
    indicatorParamsByCode: Record<string, string>;
    journalNotes: string;
    sessionScreenshots: SessionScreenshotItem[];
    replayTimestamp: number | null;
    spread: number;
    commission: number;
    actionLabel?: string;
    timestamp: number;
}

export type SyncStatusState =
    | 'idle'
    | 'saving_local'
    | 'syncing_cloud'
    | 'saved'
    | 'offline_queued'
    | 'error';
export type CacheLayerSource = 'IDB' | 'REDIS' | 'POSTGRES';

export type ExecutionEventKind =
    | 'ORDER_PLACED'
    | 'ORDER_FILLED'
    | 'TP_HIT'
    | 'SL_HIT'
    | 'MANUAL_CLOSE'
    | 'BREAK_EVEN'
    | 'PARTIAL_CLOSE';

export interface ExecutionFeedEvent {
    id: string;
    kind: ExecutionEventKind;
    title: string;
    detail: string;
    side: 'BUY' | 'SELL';
    pnl?: number;
    timestamp: number;
}

interface ReplaySessionStore {
    sessionId: string;
    revision: number;
    pastStates: ReplayStateSnapshot[];
    futureStates: ReplayStateSnapshot[];
    currentSnapshot: ReplayStateSnapshot | null;
    syncStatus: SyncStatusState;
    cacheLayer: CacheLayerSource;
    offlineOutboxCount: number;
    lastSavedAt: number | null;
    lastActionLabel: string;
    moveCounter: number;
    executionFeed: ExecutionFeedEvent[];

    initSession: (sessionId: string, initialSnapshot: ReplayStateSnapshot) => void;
    recordMove: (snapshot: ReplayStateSnapshot, actionLabel?: string) => void;
    undoMove: () => ReplayStateSnapshot | null;
    redoMove: () => ReplayStateSnapshot | null;
    setSyncStatus: (status: SyncStatusState) => void;
    setStorageTelemetry: (patch: { cacheLayer?: CacheLayerSource; offlineOutboxCount?: number }) => void;
    pushExecutionEvent: (evt: Omit<ExecutionFeedEvent, 'id' | 'timestamp'>) => void;
    dismissExecutionEvent: (id: string) => void;
    clearSessionMemory: () => void;
}

const MAX_HISTORY_STACK = 25;
const BROADCAST_CHANNEL_NAME = 'torex_backtest_sync_v2';

function stripHeavyHistoryFields(snap: ReplayStateSnapshot): ReplayStateSnapshot {
    if (!Array.isArray(snap.sessionScreenshots) || snap.sessionScreenshots.length === 0) {
        return snap;
    }
    return {
        ...snap,
        sessionScreenshots: snap.sessionScreenshots.map((item: any) => {
            if (typeof item === 'string') {
                return item.startsWith('data:image/') ? '' : item;
            }
            if (item && typeof item === 'object') {
                const cleaned = { ...item };
                if (typeof cleaned.url === 'string' && cleaned.url.startsWith('data:image/')) {
                    cleaned.url = '';
                }
                if (typeof cleaned.dataUrl === 'string' && cleaned.dataUrl.startsWith('data:image/')) {
                    cleaned.dataUrl = '';
                }
                return cleaned;
            }
            return item;
        }),
    };
}

let broadcastChannelInstance: BroadcastChannel | null = null;
function getBacktestBroadcastChannel(): BroadcastChannel | null {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
    if (!broadcastChannelInstance) {
        try {
            broadcastChannelInstance = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        } catch (_) {
            broadcastChannelInstance = null;
        }
    }
    return broadcastChannelInstance;
}

export function publishBacktestCrossTabEvent(message: {
    type: 'SESSION_UPDATED' | 'OUTBOX_FLUSHED';
    sessionId: string;
    revision: number;
    updatedAtMs: number;
}): void {
    try {
        getBacktestBroadcastChannel()?.postMessage(message);
    } catch (_) {}
}

export function subscribeBacktestCrossTabEvents(
    listener: (msg: { type: string; sessionId: string; revision: number; updatedAtMs: number }) => void
): () => void {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
        return () => {};
    }
    try {
        const ch = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        const handler = (ev: MessageEvent) => {
            if (ev?.data && typeof ev.data === 'object') {
                listener(ev.data);
            }
        };
        ch.addEventListener('message', handler);
        return () => {
            ch.removeEventListener('message', handler);
            ch.close();
        };
    } catch (_) {
        return () => {};
    }
}

function computeFastSnapshotSignature(s: ReplayStateSnapshot): string {
    const ordersSig = computeOrdersSignature(s.orders);
    const td = s.ticketDefaults;
    const ticketSig = td
        ? `${td.orderSide}:${td.orderType}:${td.riskPercent}:${td.slDistancePct}:${td.rrTarget}:${td.spread}:${td.commission}`
        : '';
    const ya = s.yAxis;
    const yAxisSig = ya
        ? `${ya.autoScale ? 1 : 0}:${ya.logScale ? 1 : 0}:${ya.customRange?.from ?? ''}:${ya.customRange?.to ?? ''}`
        : '';
    const dt = s.drawingTools;
    const toolsSig = dt ? `${dt.magnetMode ? 1 : 0}:${dt.drawingsLocked ? 1 : 0}:${dt.drawingsVisible ? 1 : 0}` : '';
    const indSig = `${s.activeIndicators.join(',')}|${Object.entries(s.indicatorParamsByCode || {})
        .map(([k, v]) => `${k}=${v}`)
        .join(';')}`;
    const drawSig = (s.drawnItems || [])
        .map((it) => {
            const pts = s.overlayGeometries?.[it.id] || [];
            const ptsStr = pts.map((p) => `${p.timestamp ?? p.dataIndex ?? ''}@${p.value ?? ''}`).join(',');
            const st = s.drawingStylesById?.[it.id];
            return `${it.id}:${it.visible !== false ? 1 : 0}:${it.locked ? 1 : 0}:${st?.lineColor ?? ''}:${st?.lineSize ?? ''}:${ptsStr}`;
        })
        .join('|');

    return [
        s.ticker,
        s.periodText,
        s.secondaryPeriodText,
        (s.auxPeriodTexts || []).join(','),
        s.timezone || '',
        s.layoutMode,
        s.selectedCandleStyle,
        s.replayTimestamp ?? 'live',
        s.spread,
        s.commission,
        s.journalNotes.length,
        s.journalNotes,
        s.sessionScreenshots.length,
        ordersSig,
        ticketSig,
        yAxisSig,
        toolsSig,
        indSig,
        drawSig,
    ].join('§');
}

function detectOrderExecutionTransitions(
    prevOrders: ReplayOrder[],
    nextOrders: ReplayOrder[],
    prevTs: number | null,
    nextTs: number | null
): Omit<ExecutionFeedEvent, 'id' | 'timestamp'>[] {
    // Do not emit execution toasts when rewinding candles backward
    if (prevTs !== null && nextTs !== null && nextTs < prevTs) {
        return [];
    }

    const prevMap = new Map<string, ReplayOrder>();
    for (const o of prevOrders) {
        prevMap.set(o.id, o);
    }

    const events: Omit<ExecutionFeedEvent, 'id' | 'timestamp'>[] = [];

    for (const next of nextOrders) {
        if (next.isImportedTrade) continue;
        const prev = prevMap.get(next.id);

        if (!prev) {
            if (next.isPartialClose) {
                events.push({
                    kind: 'PARTIAL_CLOSE',
                    side: next.side,
                    pnl: next.pnl,
                    title: `Parcial 50% Realizada (${next.side})`,
                    detail: `${next.symbol} @ ${next.exitPrice ?? next.entryPrice} · ${next.pnl >= 0 ? '+' : ''}$${next.pnl.toFixed(2)}`,
                });
            } else if (next.status === 'PENDING') {
                events.push({
                    kind: 'ORDER_PLACED',
                    side: next.side,
                    title: `Ordem ${next.side} ${next.orderType} Armazenada`,
                    detail: `${next.symbol} @ ${next.entryPrice} · ${next.lots.toFixed(2)} lotes`,
                });
            } else if (next.status === 'OPEN') {
                events.push({
                    kind: 'ORDER_FILLED',
                    side: next.side,
                    title: `Execução ${next.side} ${next.orderType}`,
                    detail: `Preenchida @ ${next.entryPrice} · ${next.lots.toFixed(2)} lotes (SL ${next.stopLoss} / TP ${next.takeProfit})`,
                });
            }
            continue;
        }

        if (prev.status === 'PENDING' && next.status === 'OPEN') {
            events.push({
                kind: 'ORDER_FILLED',
                side: next.side,
                title: `Gatilho Ativado — ${next.side} ${next.orderType}`,
                detail: `${next.symbol} preenchida @ ${next.entryPrice} (${next.lots.toFixed(2)} lotes)`,
            });
        } else if (
            (prev.status === 'OPEN' || prev.status === 'PENDING') &&
            (next.status === 'WIN' || next.status === 'LOSS')
        ) {
            const rStr = next.rMultiple !== undefined ? ` (${next.rMultiple >= 0 ? '+' : ''}${next.rMultiple}R)` : '';
            if (next.exitReason === 'TP') {
                events.push({
                    kind: 'TP_HIT',
                    side: next.side,
                    pnl: next.pnl,
                    title: `Take Profit Atingido (${next.side})`,
                    detail: `${next.symbol} @ ${next.exitPrice} · +$${Math.abs(next.pnl).toFixed(2)}${rStr}`,
                });
            } else if (next.exitReason === 'SL') {
                const isBe = Math.abs((next.exitPrice ?? 0) - next.entryPrice) <= 1e-6;
                events.push({
                    kind: isBe ? 'BREAK_EVEN' : 'SL_HIT',
                    side: next.side,
                    pnl: next.pnl,
                    title: isBe ? `Saída no Break-Even (${next.side})` : `Stop Loss Atingido (${next.side})`,
                    detail: `${next.symbol} @ ${next.exitPrice} · ${next.pnl >= 0 ? '+' : '-'}$${Math.abs(next.pnl).toFixed(2)}${rStr}`,
                });
            } else {
                events.push({
                    kind: 'MANUAL_CLOSE',
                    side: next.side,
                    pnl: next.pnl,
                    title: `Posição Encerrada (${next.side})`,
                    detail: `${next.symbol} @ ${next.exitPrice ?? next.entryPrice} · ${next.pnl >= 0 ? '+' : '-'}$${Math.abs(next.pnl).toFixed(2)}${rStr}`,
                });
            }
        } else if (
            prev.status === 'OPEN' &&
            next.status === 'OPEN' &&
            prev.stopLoss !== next.stopLoss &&
            Math.abs(next.stopLoss - next.entryPrice) <= 1e-6
        ) {
            events.push({
                kind: 'BREAK_EVEN',
                side: next.side,
                title: `Stop Movido para Break-Even`,
                detail: `${next.symbol} (${next.side}) protegido @ ${next.entryPrice}`,
            });
        }
    }

    return events;
}

function toCanonicalV2Snapshot(
    sessionId: string,
    revision: number,
    snap: ReplayStateSnapshot
): BacktestSessionSnapshotV2 {
    const unpacked =
        Array.isArray(snap.drawings) && snap.drawings.length > 0
            ? unpackDrawingsV2({
                  drawings: snap.drawings,
                  drawnItems: snap.drawnItems,
                  drawingStylesById: snap.drawingStylesById,
                  overlayGeometries: snap.overlayGeometries,
              })
            : {
                  drawings: packDrawingsV2(
                      snap.drawnItems,
                      snap.drawingStylesById,
                      snap.overlayGeometries,
                      snap.periodText
                  ),
                  drawnItems: snap.drawnItems,
                  drawingStylesById: snap.drawingStylesById,
                  overlayGeometries: snap.overlayGeometries,
              };

    const spreadVal = snap.ticketDefaults?.spread ?? snap.spread ?? 0;
    const commissionVal = snap.ticketDefaults?.commission ?? snap.commission ?? 0;

    return {
        schemaVersion: BACKTEST_SNAPSHOT_SCHEMA_VERSION,
        revision,
        sessionId: sessionId || 'default_replay_session',
        updatedAtMs: snap.timestamp || Date.now(),
        actionLabel: snap.actionLabel,
        ticker: snap.ticker,
        periodText: snap.periodText,
        secondaryPeriodText: snap.secondaryPeriodText,
        auxPeriodTexts: snap.auxPeriodTexts,
        timezone: snap.timezone,
        dataSource: snap.dataSource || 'TRADINGVIEW',
        layoutMode: snap.layoutMode,
        selectedCandleStyle: snap.selectedCandleStyle,
        replayTimestamp: snap.replayTimestamp,
        replayActive: snap.replayActive ?? true,
        syncEnabled: snap.syncEnabled ?? true,
        yAxis: snap.yAxis || { autoScale: true, logScale: false, customRange: null },
        drawingTools: snap.drawingTools || {
            magnetMode: false,
            drawingsLocked: false,
            drawingsVisible: true,
        },
        ticketDefaults: snap.ticketDefaults || {
            orderSide: 'BUY',
            orderType: 'MARKET',
            riskPercent: 1.0,
            slDistancePct: 0.3,
            rrTarget: 2.0,
            spread: spreadVal,
            commission: commissionVal,
        },
        drawings: unpacked.drawings,
        drawnItems: unpacked.drawnItems,
        drawingStylesById: unpacked.drawingStylesById,
        overlayGeometries: unpacked.overlayGeometries,
        activeIndicators: snap.activeIndicators,
        indicatorParamsByCode: snap.indicatorParamsByCode,
        orders: sanitizeValidatedOrders(snap.orders),
        journalNotes: snap.journalNotes,
        sessionScreenshots: snap.sessionScreenshots,
        spread: spreadVal,
        commission: commissionVal,
    };
}

let idbSaveTimer: ReturnType<typeof setTimeout> | null = null;
let lastComputedSignature: string = '';

function persistUnifiedSnapshotLocalAndIDB(
    sessionId: string,
    v2Snap: BacktestSessionSnapshotV2,
    onDone?: () => void
): void {
    const sid = sessionId || 'default_replay_session';
    writeLocalReplaySnapshot(sid, v2Snap);
    publishBacktestCrossTabEvent({
        type: 'SESSION_UPDATED',
        sessionId: sid,
        revision: v2Snap.revision,
        updatedAtMs: v2Snap.updatedAtMs,
    });

    if (idbSaveTimer) clearTimeout(idbSaveTimer);
    idbSaveTimer = setTimeout(() => {
        const snapStats = computeStats(v2Snap.orders || [], 100000);
        saveEncryptedSessionToIDB(sid, {
            schemaVersion: BACKTEST_SNAPSHOT_SCHEMA_VERSION,
            revision: v2Snap.revision,
            sessionId: sid,
            primarySymbol: v2Snap.ticker,
            timeframe: v2Snap.periodText,
            secondaryTimeframe: v2Snap.secondaryPeriodText,
            auxPeriodTexts: v2Snap.auxPeriodTexts,
            timezone: v2Snap.timezone,
            dataSource: v2Snap.dataSource,
            layoutMode: v2Snap.layoutMode,
            selectedCandleStyle: v2Snap.selectedCandleStyle,
            replayActive: v2Snap.replayActive,
            syncEnabled: v2Snap.syncEnabled,
            yAxis: v2Snap.yAxis,
            drawingTools: v2Snap.drawingTools,
            ticketDefaults: v2Snap.ticketDefaults,
            orders: v2Snap.orders,
            drawings: v2Snap.drawings,
            drawnItems: v2Snap.drawnItems,
            drawingStylesById: v2Snap.drawingStylesById,
            overlayGeometries: v2Snap.overlayGeometries,
            activeIndicators: v2Snap.activeIndicators,
            indicatorParamsByCode: v2Snap.indicatorParamsByCode,
            journalNotes: v2Snap.journalNotes,
            sessionScreenshots: v2Snap.sessionScreenshots,
            replayTimestamp: v2Snap.replayTimestamp,
            spread: v2Snap.spread,
            commission: v2Snap.commission,
            netPnl: snapStats.netProfit,
            closedTradesCount: snapStats.trades,
            winsCount: snapStats.wins,
            lossesCount: snapStats.losses,
            winRate: snapStats.winRate,
            profitFactor: snapStats.profitFactor ?? 0,
            expectancy: snapStats.expectancy,
            avgR: snapStats.avgR,
            maxDrawdown: snapStats.maxDrawdown,
            maxDrawdownPct: snapStats.maxDrawdownPct,
            updatedAt: new Date(v2Snap.updatedAtMs).toISOString(),
        })
            .then(() => onDone?.())
            .catch(() => {});
    }, 150);
}

export const useReplaySessionStore = create<ReplaySessionStore>((set, get) => ({
    sessionId: 'default_replay_session',
    revision: 0,
    pastStates: [],
    futureStates: [],
    currentSnapshot: null,
    syncStatus: 'idle',
    cacheLayer: 'IDB',
    offlineOutboxCount: 0,
    lastSavedAt: null,
    lastActionLabel: 'Sessão Iniciada',
    moveCounter: 0,
    executionFeed: [],

    initSession: (sessionId, initialSnapshot) => {
        const sid = sessionId || 'default_replay_session';
        const baseRevision =
            typeof initialSnapshot.revision === 'number' && initialSnapshot.revision >= 0
                ? initialSnapshot.revision
                : 0;
        const stamped: ReplayStateSnapshot = {
            ...initialSnapshot,
            orders: sanitizeValidatedOrders(initialSnapshot.orders),
            schemaVersion: BACKTEST_SNAPSHOT_SCHEMA_VERSION,
            revision: baseRevision,
            drawings:
                initialSnapshot.drawings ||
                packDrawingsV2(
                    initialSnapshot.drawnItems,
                    initialSnapshot.drawingStylesById,
                    initialSnapshot.overlayGeometries,
                    initialSnapshot.periodText
                ),
        };
        lastComputedSignature = computeFastSnapshotSignature(stamped);
        set({
            sessionId: sid,
            revision: baseRevision,
            pastStates: [],
            futureStates: [],
            currentSnapshot: stamped,
            syncStatus: 'saved',
            lastSavedAt: Date.now(),
            lastActionLabel: 'Sessão Carregada',
            moveCounter: 0,
            executionFeed: [],
        });
    },

    recordMove: (snapshot, actionLabel = 'Movimento') => {
        const { currentSnapshot, pastStates, sessionId, moveCounter, revision, executionFeed } = get();

        const nextSig = computeFastSnapshotSignature(snapshot);
        if (currentSnapshot && nextSig === lastComputedSignature) {
            return;
        }
        lastComputedSignature = nextSig;

        const nowMs = Date.now();
        const nextRevision = Math.max(revision, snapshot.revision || 0) + 1;
        const validatedOrders = sanitizeValidatedOrders(snapshot.orders);
        const drawingsV2 = packDrawingsV2(
            snapshot.drawnItems,
            snapshot.drawingStylesById,
            snapshot.overlayGeometries,
            snapshot.periodText
        );

        const nextSnap: ReplayStateSnapshot = {
            ...snapshot,
            orders: validatedOrders,
            schemaVersion: BACKTEST_SNAPSHOT_SCHEMA_VERSION,
            revision: nextRevision,
            drawings: drawingsV2,
            actionLabel,
            timestamp: nowMs,
        };

        const transitionEvents = currentSnapshot
            ? detectOrderExecutionTransitions(
                  currentSnapshot.orders,
                  validatedOrders,
                  currentSnapshot.replayTimestamp,
                  snapshot.replayTimestamp
              )
            : [];

        const stampedEvents: ExecutionFeedEvent[] = transitionEvents.map((ev, idx) => ({
            ...ev,
            id: `exec_${nowMs}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
            timestamp: nowMs,
        }));

        const nextFeed =
            stampedEvents.length > 0 ? [...stampedEvents, ...executionFeed].slice(0, 4) : executionFeed;

        const nextPast = currentSnapshot
            ? [...pastStates.slice(-(MAX_HISTORY_STACK - 1)), stripHeavyHistoryFields(currentSnapshot)]
            : pastStates;

        set({
            revision: nextRevision,
            pastStates: nextPast,
            futureStates: [],
            currentSnapshot: nextSnap,
            syncStatus: 'saving_local',
            lastActionLabel: actionLabel,
            moveCounter: moveCounter + 1,
            executionFeed: nextFeed,
        });

        const v2Snap = toCanonicalV2Snapshot(sessionId, nextRevision, nextSnap);
        persistUnifiedSnapshotLocalAndIDB(sessionId, v2Snap, () => {
            set({ syncStatus: 'saved', lastSavedAt: Date.now() });
        });
    },

    undoMove: () => {
        const { pastStates, futureStates, currentSnapshot, sessionId, moveCounter, revision } = get();
        if (pastStates.length === 0) return null;

        const nextRevision = revision + 1;
        const rawPrev = pastStates[pastStates.length - 1];
        const previous: ReplayStateSnapshot = {
            ...rawPrev,
            schemaVersion: BACKTEST_SNAPSHOT_SCHEMA_VERSION,
            revision: nextRevision,
            timestamp: Date.now(),
        };
        lastComputedSignature = computeFastSnapshotSignature(previous);
        const newPast = pastStates.slice(0, -1);
        const newFuture = currentSnapshot
            ? [stripHeavyHistoryFields(currentSnapshot), ...futureStates.slice(0, MAX_HISTORY_STACK - 1)]
            : futureStates;

        set({
            revision: nextRevision,
            pastStates: newPast,
            futureStates: newFuture,
            currentSnapshot: previous,
            syncStatus: 'saving_local',
            lastActionLabel: `Undo: ${previous.actionLabel || 'Estado Anterior'}`,
            moveCounter: moveCounter + 1,
        });

        const v2Snap = toCanonicalV2Snapshot(sessionId, nextRevision, previous);
        persistUnifiedSnapshotLocalAndIDB(sessionId, v2Snap, () => {
            set({ syncStatus: 'saved', lastSavedAt: Date.now() });
        });

        return previous;
    },

    redoMove: () => {
        const { pastStates, futureStates, currentSnapshot, sessionId, moveCounter, revision } = get();
        if (futureStates.length === 0) return null;

        const nextRevision = revision + 1;
        const rawNext = futureStates[0];
        const next: ReplayStateSnapshot = {
            ...rawNext,
            schemaVersion: BACKTEST_SNAPSHOT_SCHEMA_VERSION,
            revision: nextRevision,
            timestamp: Date.now(),
        };
        lastComputedSignature = computeFastSnapshotSignature(next);
        const newFuture = futureStates.slice(1);
        const newPast = currentSnapshot
            ? [...pastStates.slice(-(MAX_HISTORY_STACK - 1)), stripHeavyHistoryFields(currentSnapshot)]
            : pastStates;

        set({
            revision: nextRevision,
            pastStates: newPast,
            futureStates: newFuture,
            currentSnapshot: next,
            syncStatus: 'saving_local',
            lastActionLabel: `Redo: ${next.actionLabel || 'Estado Refeito'}`,
            moveCounter: moveCounter + 1,
        });

        const v2Snap = toCanonicalV2Snapshot(sessionId, nextRevision, next);
        persistUnifiedSnapshotLocalAndIDB(sessionId, v2Snap, () => {
            set({ syncStatus: 'saved', lastSavedAt: Date.now() });
        });

        return next;
    },

    setSyncStatus: (status) => {
        set({
            syncStatus: status,
            ...(status === 'saved' ? { lastSavedAt: Date.now() } : {}),
        });
    },

    setStorageTelemetry: (patch) => {
        set((state) => ({
            cacheLayer: patch.cacheLayer ?? state.cacheLayer,
            offlineOutboxCount: patch.offlineOutboxCount ?? state.offlineOutboxCount,
        }));
    },

    pushExecutionEvent: (evt) => {
        const now = Date.now();
        const item: ExecutionFeedEvent = {
            ...evt,
            id: `exec_${now}_${Math.random().toString(36).slice(2, 6)}`,
            timestamp: now,
        };
        set((state) => ({
            executionFeed: [item, ...state.executionFeed].slice(0, 4),
        }));
    },

    dismissExecutionEvent: (id) => {
        set((state) => ({
            executionFeed: state.executionFeed.filter((item) => item.id !== id),
        }));
    },

    clearSessionMemory: () => {
        set({
            pastStates: [],
            futureStates: [],
            executionFeed: [],
        });
    },
}));
