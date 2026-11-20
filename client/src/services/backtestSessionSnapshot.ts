import {
    ReplayOrder,
    ChartCandleStyleId,
    SessionScreenshotItem,
} from '../components/kline-replay/types';
import { DrawnObjectItem } from '../components/kline-replay/layers/RightSidePanelLayer';
import {
    DrawingStyleState,
    OverlayPointCoord,
} from '../components/kline-replay/layers/DrawingStyleToolbarLayer';
import { ChartLayoutMode } from '../components/kline-replay/layers/TopToolbarLayer';
import { DataSourceMode } from './klineDatafeed';
import { sanitizeValidatedOrders, TicketDefaultsSchema } from '../schemas/backtestContracts';

export const BACKTEST_SNAPSHOT_SCHEMA_VERSION = 2 as const;
export const REPLAY_LOCAL_STORAGE_PREFIX = 'cossa_kline_replay_state_v1';

export const DEFAULT_DRAWING_STYLE_V2: DrawingStyleState = {
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

/**
 * Self-contained drawing entity anchored primarily by `timestamp` + `value` (price),
 * unifying metadata (`DrawnObjectItem`), visual style (`DrawingStyleState`), and
 * geometry (`OverlayPointCoord[]`) under a single stable ID.
 */
export interface DrawingEntityV2 {
    id: string;
    toolName: string;
    label: string;
    visible: boolean;
    locked: boolean;
    createdOnTimeframe?: string;
    points: OverlayPointCoord[];
    style: DrawingStyleState;
}

export interface YAxisSessionState {
    autoScale: boolean;
    logScale: boolean;
    customRange?: { from: number; to: number } | null;
}

export interface DrawingToolsWorkspaceState {
    magnetMode: boolean;
    drawingsLocked: boolean;
    drawingsVisible: boolean;
}

export interface TicketDefaultsState {
    orderSide: 'BUY' | 'SELL';
    orderType: 'MARKET' | 'LIMIT' | 'STOP';
    riskPercent: number;
    slDistancePct: number;
    rrTarget: number;
    spread: number;
    commission: number;
}

/**
 * Canonical V2 contract representing the full state of a Backtest Replay Session
 * across Zustand (in-memory Undo/Redo), localStorage, Encrypted IndexedDB, Redis, and PostgreSQL.
 */
export interface BacktestSessionSnapshotV2 {
    schemaVersion: 2;
    revision: number;
    sessionId: string;
    updatedAtMs: number;
    actionLabel?: string;

    // Market & Timeframe Context
    ticker: string;
    periodText: string;
    secondaryPeriodText: string;
    auxPeriodTexts?: string[];
    timezone?: string;
    dataSource: DataSourceMode;
    layoutMode: ChartLayoutMode;
    selectedCandleStyle: ChartCandleStyleId;
    replayTimestamp: number | null;
    replayActive: boolean;
    syncEnabled: boolean;

    // Precision Axes, Tools & Ticket Parameters
    yAxis: YAxisSessionState;
    drawingTools: DrawingToolsWorkspaceState;
    ticketDefaults: TicketDefaultsState;

    // Unified Drawings + Legacy Mirrors (kept 1:1 for full compatibility)
    drawings: DrawingEntityV2[];
    drawnItems: DrawnObjectItem[];
    drawingStylesById: Record<string, DrawingStyleState>;
    overlayGeometries: Record<string, OverlayPointCoord[]>;

    // Technical Indicators
    activeIndicators: string[];
    indicatorParamsByCode: Record<string, string>;

    // Portfolio, Journal & Captures
    orders: ReplayOrder[];
    journalNotes: string;
    journalTitle?: string | null;
    journalMarketBias?: string | null;
    journalPsychCheck?: Record<string, string | null>;
    journalImages?: string[];
    sessionScreenshots: SessionScreenshotItem[];

    // Top-level convenience mirrors for backward compatibility with V1 readers
    spread: number;
    commission: number;
}

export function getReplayVaultStorageKey(sessionId?: string | null): string {
    const clean = (sessionId || '').trim();
    let scope = 'anon';
    try {
        if (typeof localStorage !== 'undefined') {
            scope = localStorage.getItem('torex_last_user_scope') || 'anon';
        }
    } catch {
        scope = 'anon';
    }
    const safeScope = scope.replace(/[^a-zA-Z0-9_-]/g, '_');
    return clean
        ? `${REPLAY_LOCAL_STORAGE_PREFIX}_${safeScope}_${clean}`
        : `${REPLAY_LOCAL_STORAGE_PREFIX}_${safeScope}`;
}

/**
 * Packs legacy 3-part drawing structures (`drawnItems` + `drawingStylesById` + `overlayGeometries`)
 * into unified `DrawingEntityV2[]`.
 */
export function packDrawingsV2(
    drawnItems: DrawnObjectItem[] = [],
    drawingStylesById: Record<string, DrawingStyleState> = {},
    overlayGeometries: Record<string, OverlayPointCoord[]> = {},
    currentTimeframe?: string
): DrawingEntityV2[] {
    return drawnItems.map((item) => {
        const baseStyle = drawingStylesById[item.id];
        const fallbackColor =
            item.color ||
            (item.name === 'tvShortPosition'
                ? '#ef4444'
                : item.name === 'tvLongPosition'
                  ? '#10b981'
                  : DEFAULT_DRAWING_STYLE_V2.lineColor);

        const style: DrawingStyleState = baseStyle
            ? {
                  ...DEFAULT_DRAWING_STYLE_V2,
                  ...baseStyle,
                  extendData: baseStyle.extendData ?? item.extendData ?? '',
              }
            : {
                  ...DEFAULT_DRAWING_STYLE_V2,
                  lineColor: fallbackColor,
                  fillColor: fallbackColor,
                  textSize: item.name === 'tvEmojiMarker' ? 24 : 12,
                  extendData: item.extendData ?? '',
              };

        const rawPoints = overlayGeometries[item.id];
        const points: OverlayPointCoord[] = Array.isArray(rawPoints)
            ? rawPoints.map((pt) => ({
                  timestamp: typeof pt?.timestamp === 'number' ? pt.timestamp : undefined,
                  dataIndex: typeof pt?.dataIndex === 'number' ? pt.dataIndex : undefined,
                  value: typeof pt?.value === 'number' ? pt.value : undefined,
              }))
            : [];

        return {
            id: item.id,
            toolName: item.name,
            label: item.label || item.name,
            visible: item.visible !== false,
            locked: Boolean(item.locked),
            createdOnTimeframe: currentTimeframe,
            points,
            style,
        };
    });
}

/**
 * Unpacks either V2 `DrawingEntityV2[]` or legacy V1 (`drawnItems` + `drawingStylesById` + `overlayGeometries`)
 * into a guaranteed consistent quartet `{ drawings, drawnItems, drawingStylesById, overlayGeometries }`.
 */
export function unpackDrawingsV2(input: {
    drawings?: DrawingEntityV2[] | null;
    drawnItems?: DrawnObjectItem[] | null;
    drawingStylesById?: Record<string, DrawingStyleState> | null;
    overlayGeometries?: Record<string, OverlayPointCoord[]> | null;
}): {
    drawings: DrawingEntityV2[];
    drawnItems: DrawnObjectItem[];
    drawingStylesById: Record<string, DrawingStyleState>;
    overlayGeometries: Record<string, OverlayPointCoord[]>;
} {
    if (Array.isArray(input.drawings) && input.drawings.length > 0) {
        const drawnItems: DrawnObjectItem[] = [];
        const drawingStylesById: Record<string, DrawingStyleState> = {};
        const overlayGeometries: Record<string, OverlayPointCoord[]> = {};

        const normalizedDrawings: DrawingEntityV2[] = input.drawings.map((d) => {
            const style: DrawingStyleState = {
                ...DEFAULT_DRAWING_STYLE_V2,
                ...(d.style || {}),
            };
            const points: OverlayPointCoord[] = Array.isArray(d.points)
                ? d.points.map((p) => ({
                      timestamp: typeof p?.timestamp === 'number' ? p.timestamp : undefined,
                      dataIndex: typeof p?.dataIndex === 'number' ? p.dataIndex : undefined,
                      value: typeof p?.value === 'number' ? p.value : undefined,
                  }))
                : input.overlayGeometries?.[d.id] || [];

            drawnItems.push({
                id: d.id,
                name: d.toolName,
                label: d.label || d.toolName,
                visible: d.visible !== false,
                locked: Boolean(d.locked),
                color: style.lineColor,
                extendData: style.extendData,
            });
            drawingStylesById[d.id] = style;
            overlayGeometries[d.id] = points;

            return {
                id: d.id,
                toolName: d.toolName,
                label: d.label || d.toolName,
                visible: d.visible !== false,
                locked: Boolean(d.locked),
                createdOnTimeframe: d.createdOnTimeframe,
                points,
                style,
            };
        });

        return {
            drawings: normalizedDrawings,
            drawnItems,
            drawingStylesById,
            overlayGeometries,
        };
    }

    const legacyItems = Array.isArray(input.drawnItems) ? input.drawnItems : [];
    const legacyStyles = input.drawingStylesById || {};
    const legacyGeoms = input.overlayGeometries || {};
    const drawings = packDrawingsV2(legacyItems, legacyStyles, legacyGeoms);

    return {
        drawings,
        drawnItems: legacyItems,
        drawingStylesById: { ...legacyStyles },
        overlayGeometries: { ...legacyGeoms },
    };
}

/**
 * Normalizes any raw V1 or V2 object (from localStorage, IndexedDB, or Backend PostgreSQL/Redis)
 * into a strictly typed `BacktestSessionSnapshotV2`.
 */
export function normalizeSnapshotToV2(
    raw: Record<string, any> | null | undefined,
    fallbackSessionId: string = 'default_replay_session'
): BacktestSessionSnapshotV2 | null {
    if (!raw || typeof raw !== 'object') return null;

    // Support backend `BacktestSession` shapes where fields live under `raw.config`
    const cfg = raw.config && typeof raw.config === 'object' ? raw.config : {};
    const src = { ...cfg, ...raw };

    const unpacked = unpackDrawingsV2({
        drawings: src.drawings,
        drawnItems: src.drawnItems,
        drawingStylesById: src.drawingStylesById,
        overlayGeometries: src.overlayGeometries,
    });

    const spreadVal = Number(src.ticketDefaults?.spread ?? src.spread ?? 0) || 0;
    const commissionVal = Number(src.ticketDefaults?.commission ?? src.commission ?? 0) || 0;
    const riskPercentVal = Number(src.ticketDefaults?.riskPercent ?? src.riskPerTrade ?? src.riskPercent ?? 1.0) || 1.0;
    const slDistancePctVal = Number(src.ticketDefaults?.slDistancePct ?? src.slDistancePct ?? 0.3) || 0.3;
    const rrTargetVal = Number(src.ticketDefaults?.rrTarget ?? src.rrTarget ?? 2.0) || 2.0;

    const updatedAtMs =
        typeof src.updatedAtMs === 'number' && Number.isFinite(src.updatedAtMs)
            ? src.updatedAtMs
            : typeof src.timestamp === 'number' && Number.isFinite(src.timestamp)
              ? src.timestamp
              : src.updatedAt
                ? new Date(src.updatedAt).getTime() || Date.now()
                : 0;

    const revision =
        typeof src.revision === 'number' && Number.isFinite(src.revision) && src.revision >= 0
            ? Math.floor(src.revision)
            : 0;

    return {
        schemaVersion: BACKTEST_SNAPSHOT_SCHEMA_VERSION,
        revision,
        sessionId: String(src.sessionId || src.clientSessionId || src.id || fallbackSessionId),
        updatedAtMs,
        actionLabel: src.actionLabel,

        ticker: String(src.ticker || src.primarySymbol || src.symbol || 'XAUUSD'),
        periodText: String(src.periodText || src.timeframe || '15m'),
        secondaryPeriodText: String(src.secondaryPeriodText || src.secondaryTimeframe || '1h'),
        auxPeriodTexts: Array.isArray(src.auxPeriodTexts)
            ? src.auxPeriodTexts.map((v: any) => String(v))
            : undefined,
        timezone: typeof src.timezone === 'string' && src.timezone.trim() ? src.timezone.trim() : undefined,
        dataSource: (src.dataSource as DataSourceMode) || 'TRADINGVIEW',
        layoutMode: (['1x1', '1x2', '2x1', '1+2', '3x1', '2x2'].includes(src.layoutMode)
            ? src.layoutMode
            : '1x1') as ChartLayoutMode,
        selectedCandleStyle: (src.selectedCandleStyle as ChartCandleStyleId) || 'candles',
        replayTimestamp:
            typeof src.replayTimestamp === 'number' && Number.isFinite(src.replayTimestamp)
                ? src.replayTimestamp
                : null,
        replayActive: typeof src.replayActive === 'boolean' ? src.replayActive : true,
        syncEnabled: typeof src.syncEnabled === 'boolean' ? src.syncEnabled : true,

        yAxis: {
            autoScale: typeof src.yAxis?.autoScale === 'boolean' ? src.yAxis.autoScale : true,
            logScale: typeof src.yAxis?.logScale === 'boolean' ? src.yAxis.logScale : false,
            customRange: src.yAxis?.customRange ?? null,
        },
        drawingTools: {
            magnetMode: typeof src.drawingTools?.magnetMode === 'boolean' ? src.drawingTools.magnetMode : false,
            drawingsLocked:
                typeof src.drawingTools?.drawingsLocked === 'boolean' ? src.drawingTools.drawingsLocked : false,
            drawingsVisible:
                typeof src.drawingTools?.drawingsVisible === 'boolean' ? src.drawingTools.drawingsVisible : true,
        },
        ticketDefaults: TicketDefaultsSchema.parse({
            orderSide: src.ticketDefaults?.orderSide === 'SELL' ? 'SELL' : 'BUY',
            orderType:
                src.ticketDefaults?.orderType === 'LIMIT'
                    ? 'LIMIT'
                    : src.ticketDefaults?.orderType === 'STOP'
                      ? 'STOP'
                      : 'MARKET',
            riskPercent: riskPercentVal,
            slDistancePct: slDistancePctVal,
            rrTarget: rrTargetVal,
            spread: spreadVal,
            commission: commissionVal,
        }),

        drawings: unpacked.drawings,
        drawnItems: unpacked.drawnItems,
        drawingStylesById: unpacked.drawingStylesById,
        overlayGeometries: unpacked.overlayGeometries,

        activeIndicators: Array.isArray(src.activeIndicators) ? src.activeIndicators : [],
        indicatorParamsByCode:
            src.indicatorParamsByCode && typeof src.indicatorParamsByCode === 'object'
                ? { ...src.indicatorParamsByCode }
                : {},

        orders: sanitizeValidatedOrders(src.orders),
        journalNotes: typeof src.journalNotes === 'string' ? src.journalNotes : typeof src.notes === 'string' ? src.notes : '',
        journalTitle: typeof src.journalTitle === 'string' ? src.journalTitle : null,
        journalMarketBias: typeof src.journalMarketBias === 'string' ? src.journalMarketBias : null,
        journalPsychCheck:
            src.journalPsychCheck && typeof src.journalPsychCheck === 'object'
                ? { ...src.journalPsychCheck }
                : undefined,
        journalImages: Array.isArray(src.journalImages)
            ? src.journalImages.filter((u: any) => typeof u === 'string')
            : undefined,
        sessionScreenshots: Array.isArray(src.sessionScreenshots) ? src.sessionScreenshots : [],

        spread: spreadVal,
        commission: commissionVal,
    };
}

/**
 * Picks the most authoritative snapshot among multiple sources (localStorage, IndexedDB, Backend Redis/PG)
 * using monotonic `revision` first and `updatedAtMs` as tie-breaker.
 */
export function pickNewestSnapshot(
    ...candidates: Array<BacktestSessionSnapshotV2 | null | undefined>
): BacktestSessionSnapshotV2 | null {
    let winner: BacktestSessionSnapshotV2 | null = null;
    for (const c of candidates) {
        if (!c) continue;
        if (!winner) {
            winner = c;
            continue;
        }
        if (c.revision > winner.revision) {
            winner = c;
        } else if (c.revision === winner.revision && c.updatedAtMs > winner.updatedAtMs) {
            winner = c;
        }
    }
    return winner;
}

/**
 * Reads and normalizes the per-session snapshot from `localStorage`.
 */
export function readLocalReplaySnapshot(sessionId?: string | null): BacktestSessionSnapshotV2 | null {
    try {
        const key = getReplayVaultStorageKey(sessionId);
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return normalizeSnapshotToV2(parsed, sessionId || 'default_replay_session');
    } catch (_) {
        return null;
    }
}

/**
 * Single authoritative writer to `localStorage` for a Replay Session.
 * Caps inline Base64 screenshots to 5 in synchronous `localStorage` to stay well below browser 5MB quota,
 * while never stripping drawings, geometries, styles, indicators, candle style, yAxis, or ticket defaults.
 */
export function compactScreenshotsForLocalStorage(
    shots?: SessionScreenshotItem[]
): SessionScreenshotItem[] {
    if (!Array.isArray(shots) || shots.length === 0) return [];
    let inlineBase64Count = 0;
    const result: SessionScreenshotItem[] = [];
    for (const s of shots) {
        if (!s || typeof s.dataUrl !== 'string') continue;
        if (s.dataUrl.startsWith('data:')) {
            if (inlineBase64Count >= 3) continue;
            inlineBase64Count += 1;
        }
        result.push(s);
        if (result.length >= 50) break;
    }
    return result;
}

export function writeLocalReplaySnapshot(
    sessionId: string | undefined | null,
    snapshot: BacktestSessionSnapshotV2
): void {
    try {
        const sid = (sessionId || snapshot.sessionId || 'default_replay_session').trim();
        const key = getReplayVaultStorageKey(sid);
        const compactPayload: BacktestSessionSnapshotV2 & { vaultSignature: string } = {
            ...snapshot,
            schemaVersion: BACKTEST_SNAPSHOT_SCHEMA_VERSION,
            sessionId: sid,
            sessionScreenshots: compactScreenshotsForLocalStorage(snapshot.sessionScreenshots),
            vaultSignature: `v2_aes256_${sid}_r${snapshot.revision}_${snapshot.updatedAtMs}`,
        };
        localStorage.setItem(key, JSON.stringify(compactPayload));
    } catch (_) {}
}

/**
 * Clears the per-session snapshot from `localStorage` (used on explicit Reset Simulation or Session Delete).
 */
export function clearLocalReplaySnapshot(sessionId?: string | null): void {
    try {
        localStorage.removeItem(getReplayVaultStorageKey(sessionId));
    } catch (_) {}
}
