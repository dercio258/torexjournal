import { KLineData } from 'klinecharts';
import api from '../api';
import {
    ReplayOrder,
    ChartCandleStyleId,
} from '../components/kline-replay/types';
import { ChartLayoutMode } from '../components/kline-replay/layers/TopToolbarLayer';
import { DataSourceMode } from './klineDatafeed';
import {
    BACKTEST_SNAPSHOT_SCHEMA_VERSION,
    DrawingEntityV2,
    DrawingToolsWorkspaceState,
    normalizeSnapshotToV2,
    TicketDefaultsState,
    writeLocalReplaySnapshot,
    YAxisSessionState,
} from './backtestSessionSnapshot';
import {
    BacktestReplaySession,
    createBacktestSession,
    loadBacktestSessions,
    loadBacktestStrategies,
    markSessionCloudSynced,
    updateBacktestSession,
} from './backtestWorkspaceStore';
import { sanitizeValidCandles } from '../schemas/backtestContracts';
import {
    generateMutationId,
    getCurrentUserScope,
    saveMediaOutboxItem,
} from './offlineDb';

const DB_NAME = 'torex_historical_ohlcv_batches_v1';
const DB_VERSION = 3;
const STORE_BATCHES = 'ohlcv_batches';
const STORE_ENCRYPTED_SESSIONS = 'encrypted_session_vault';
const STORE_SYNC_OUTBOX = 'pending_sync_outbox';
const DEVICE_VAULT_SEED_KEY = 'torex_device_vault_seed_v1';
const MAX_IDB_CANDLE_BATCHES = 180;

export interface PendingSyncOutboxRecord {
    sessionId: string;
    payload: SessionVaultData & { encryptedDigest?: string };
    accountId?: string;
    queuedAt: number;
    attempts: number;
}

export interface LocalDbStorageStats {
    candleBatchesCount: number;
    totalCachedCandles: number;
    encryptedSessionsCount: number;
    pendingOutboxCount: number;
}

export interface StoredCandleBatch {
    key: string; // `${symbol}:${timeframe}:${bucketTs}`
    seriesKey: string; // `${symbol}:${timeframe}`
    symbol: string;
    timeframe: string;
    bucketTs: number;
    earliestTs: number;
    latestTs: number;
    candles: KLineData[];
    source: string;
    savedAt: number;
}

export interface EncryptedSessionRecord {
    sessionId: string;
    ivBase64: string;
    ciphertextBase64: string;
    digestHex: string;
    algorithm: 'AES-GCM-256';
    updatedAt: number;
}

export interface SessionVaultData {
    schemaVersion?: 2;
    revision?: number;
    sessionId: string;
    name?: string;
    strategyName?: string;
    primarySymbol?: string;
    timeframe?: string;
    secondaryTimeframe?: string;
    auxPeriodTexts?: string[];
    timezone?: string;
    dataSource?: DataSourceMode;
    layoutMode?: ChartLayoutMode | string;
    selectedCandleStyle?: ChartCandleStyleId | string;
    replayActive?: boolean;
    syncEnabled?: boolean;
    yAxis?: YAxisSessionState;
    drawingTools?: DrawingToolsWorkspaceState;
    ticketDefaults?: TicketDefaultsState;
    pairs?: string[];
    fromDate?: string;
    toDate?: string;
    orders?: ReplayOrder[];
    drawings?: DrawingEntityV2[];
    drawnItems?: any[];
    drawingStylesById?: Record<string, any>;
    overlayGeometries?: Record<string, any>;
    activeIndicators?: string[];
    indicatorParamsByCode?: Record<string, string>;
    sessionScreenshots?: any[];
    quantMetrics?: any;
    journalNotes?: string;
    journalTitle?: string | null;
    journalMarketBias?: string | null;
    journalPsychCheck?: Record<string, string | null>;
    journalImages?: string[];
    replayTimestamp?: number | null;
    currentBalance?: number;
    netPnl?: number;
    closedTradesCount?: number;
    winsCount?: number;
    lossesCount?: number;
    winRate?: number;
    profitFactor?: number;
    expectancy?: number;
    avgR?: number;
    maxDrawdown?: number;
    maxDrawdownPct?: number;
    timeInvestedSeconds?: number;
    spread?: number;
    commission?: number;
    updatedAt?: string;
}

export interface BatchLoadProgress {
    symbol: string;
    timeframe: string;
    loadedBatches: number;
    totalBatches: number;
    totalBars: number;
    earliestTs: number | null;
    latestTs: number | null;
    fromCache: boolean;
    isPrefetching: boolean;
    hasMore: boolean;
    statusText: string;
}

export interface UnifiedSyncBatchProgress {
    phase: 'BROKER_SYNC' | 'TRADE_BATCHES' | 'OHLCV_PREFETCH' | 'SESSION_ASSEMBLY' | 'DONE';
    loadedTradeBatches: number;
    totalTradeBatches: number;
    totalTradesPulled: number;
    loadedCandleBatches: number;
    totalCandleBatches: number;
    totalCandlesCached: number;
    message: string;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
const MAX_SESSION_KEY_CACHE = 32;
const sessionKeyCache = new Map<string, Promise<CryptoKey | null>>();

function openBatchDatabase(): Promise<IDBDatabase | null> {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
        return Promise.resolve(null);
    }
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve) => {
        try {
            const req = window.indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE_BATCHES)) {
                    const store = db.createObjectStore(STORE_BATCHES, { keyPath: 'key' });
                    store.createIndex('by_series', 'seriesKey', { unique: false });
                }
                if (!db.objectStoreNames.contains(STORE_ENCRYPTED_SESSIONS)) {
                    db.createObjectStore(STORE_ENCRYPTED_SESSIONS, { keyPath: 'sessionId' });
                }
                if (!db.objectStoreNames.contains(STORE_SYNC_OUTBOX)) {
                    db.createObjectStore(STORE_SYNC_OUTBOX, { keyPath: 'sessionId' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        } catch (_) {
            resolve(null);
        }
    });

    return dbPromise;
}

function getOrCreateDeviceVaultSeed(): string {
    try {
        let seed = localStorage.getItem(DEVICE_VAULT_SEED_KEY);
        if (!seed || seed.length < 16) {
            const bytes = new Uint8Array(32);
            if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
                window.crypto.getRandomValues(bytes);
            }
            seed = Array.from(bytes)
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('');
            localStorage.setItem(DEVICE_VAULT_SEED_KEY, seed);
        }
        return seed;
    } catch (_) {
        return 'torex_fallback_device_seed_2026_aes256';
    }
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return typeof btoa === 'function' ? btoa(binary) : '';
}

function base64ToBytes(b64: string): Uint8Array {
    const binary = typeof atob === 'function' ? atob(b64) : '';
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/**
 * Derives a unique AES-256-GCM CryptoKey scoped to a specific `sessionId`
 * using PBKDF2-SHA256 + device seed, coalescing concurrent calls via LRU Promise cache.
 */
async function deriveSessionCryptoKey(sessionId: string): Promise<CryptoKey | null> {
    if (typeof window === 'undefined' || !window.crypto?.subtle) return null;
    const cached = sessionKeyCache.get(sessionId);
    if (cached) {
        // Refresh LRU recency
        sessionKeyCache.delete(sessionId);
        sessionKeyCache.set(sessionId, cached);
        return cached;
    }

    if (sessionKeyCache.size >= MAX_SESSION_KEY_CACHE) {
        const oldestKey = sessionKeyCache.keys().next().value;
        if (oldestKey !== undefined) {
            sessionKeyCache.delete(oldestKey);
        }
    }

    const keyPromise = (async (): Promise<CryptoKey | null> => {
        try {
            const enc = new TextEncoder();
            const seed = getOrCreateDeviceVaultSeed();
            const baseKey = await window.crypto.subtle.importKey(
                'raw',
                enc.encode(`${seed}::session::${sessionId}`),
                { name: 'PBKDF2' },
                false,
                ['deriveKey']
            );
            return await window.crypto.subtle.deriveKey(
                {
                    name: 'PBKDF2',
                    salt: enc.encode(`torex_salt_v1_${sessionId}`),
                    iterations: 50000,
                    hash: 'SHA-256',
                },
                baseKey,
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt', 'decrypt']
            );
        } catch (_) {
            return null;
        }
    })();

    sessionKeyCache.set(sessionId, keyPromise);
    const derived = await keyPromise;
    if (!derived && sessionKeyCache.get(sessionId) === keyPromise) {
        sessionKeyCache.delete(sessionId);
    }
    return derived;
}

/**
 * Encrypts and saves the session state in IndexedDB (`encrypted_session_vault`)
 * with a unique per-session AES-256-GCM key and SHA-256 integrity digest.
 */
export async function saveEncryptedSessionToIDB(
    sessionId: string,
    payload: SessionVaultData
): Promise<{ ok: boolean; digestHex: string }> {
    if (!sessionId) return { ok: false, digestHex: '' };
    const db = await openBatchDatabase();
    const key = await deriveSessionCryptoKey(sessionId);
    if (!db || !key || !window.crypto?.subtle) {
        return { ok: false, digestHex: '' };
    }

    try {
        const enc = new TextEncoder();
        const jsonBytes = enc.encode(JSON.stringify(payload));
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const cipherBuffer = await window.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            jsonBytes
        );
        const digestBuffer = await window.crypto.subtle.digest('SHA-256', cipherBuffer);
        const digestHex = Array.from(new Uint8Array(digestBuffer))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');

        const record: EncryptedSessionRecord = {
            sessionId,
            ivBase64: bytesToBase64(iv),
            ciphertextBase64: bytesToBase64(new Uint8Array(cipherBuffer)),
            digestHex,
            algorithm: 'AES-GCM-256',
            updatedAt: Date.now(),
        };

        await new Promise<void>((resolve) => {
            try {
                const tx = db.transaction(STORE_ENCRYPTED_SESSIONS, 'readwrite');
                tx.objectStore(STORE_ENCRYPTED_SESSIONS).put(record);
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            } catch (_) {
                resolve();
            }
        });

        return { ok: true, digestHex };
    } catch (_) {
        return { ok: false, digestHex: '' };
    }
}

/**
 * Loads and decrypts the per-session AES-256-GCM vault from IndexedDB.
 */
export async function loadEncryptedSessionFromIDB(
    sessionId: string
): Promise<{ data: SessionVaultData | null; digestHex: string; updatedAt: number | null }> {
    if (!sessionId) return { data: null, digestHex: '', updatedAt: null };
    const db = await openBatchDatabase();
    const key = await deriveSessionCryptoKey(sessionId);
    if (!db || !key || !window.crypto?.subtle) {
        return { data: null, digestHex: '', updatedAt: null };
    }

    const record = await new Promise<EncryptedSessionRecord | null>((resolve) => {
        try {
            const tx = db.transaction(STORE_ENCRYPTED_SESSIONS, 'readonly');
            const req = tx.objectStore(STORE_ENCRYPTED_SESSIONS).get(sessionId);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        } catch (_) {
            resolve(null);
        }
    });

    if (!record || !record.ciphertextBase64 || !record.ivBase64) {
        return { data: null, digestHex: '', updatedAt: null };
    }

    try {
        const iv = base64ToBytes(record.ivBase64);
        const cipherBytes = base64ToBytes(record.ciphertextBase64);
        const plainBuffer = await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv as unknown as BufferSource },
            key,
            cipherBytes as unknown as BufferSource
        );
        const dec = new TextDecoder();
        const parsed: SessionVaultData = JSON.parse(dec.decode(plainBuffer));
        return {
            data: parsed,
            digestHex: record.digestHex,
            updatedAt: record.updatedAt,
        };
    } catch (_) {
        return { data: null, digestHex: '', updatedAt: null };
    }
}

/**
 * Removes an encrypted session vault record and its cached AES-256-GCM key from IndexedDB.
 */
export async function deleteEncryptedSessionFromIDB(sessionId: string): Promise<void> {
    if (!sessionId) return;
    sessionKeyCache.delete(sessionId);
    const db = await openBatchDatabase();
    if (!db) return;

    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(STORE_ENCRYPTED_SESSIONS, 'readwrite');
            tx.objectStore(STORE_ENCRYPTED_SESSIONS).delete(sessionId);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch (_) {
            resolve();
        }
    });
}

function buildV2BackendConfigEnvelope(payload: SessionVaultData) {
    return {
        schemaVersion: BACKTEST_SNAPSHOT_SCHEMA_VERSION,
        revision: payload.revision ?? 0,
        auxPeriodTexts: payload.auxPeriodTexts,
        timezone: payload.timezone,
        dataSource: payload.dataSource,
        layoutMode: payload.layoutMode,
        selectedCandleStyle: payload.selectedCandleStyle,
        replayActive: payload.replayActive,
        syncEnabled: payload.syncEnabled,
        yAxis: payload.yAxis,
        drawingTools: payload.drawingTools,
        ticketDefaults: payload.ticketDefaults,
        drawings: payload.drawings,
        drawnItems: payload.drawnItems,
        drawingStylesById: payload.drawingStylesById,
        overlayGeometries: payload.overlayGeometries,
        activeIndicators: payload.activeIndicators,
        indicatorParamsByCode: payload.indicatorParamsByCode,
        spread: payload.spread,
        commission: payload.commission,
    };
}

function emitStorageTelemetryEvent(detail: {
    cacheLayer?: 'IDB' | 'REDIS' | 'POSTGRES';
    offlineOutboxCount?: number;
}) {
    if (typeof window === 'undefined') return;
    try {
        window.dispatchEvent(new CustomEvent('torex:storage-telemetry', { detail }));
    } catch (_) {}
}

export async function getPendingSyncOutboxCount(): Promise<number> {
    const db = await openBatchDatabase();
    if (!db || !db.objectStoreNames.contains(STORE_SYNC_OUTBOX)) return 0;
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_SYNC_OUTBOX, 'readonly');
            const req = tx.objectStore(STORE_SYNC_OUTBOX).count();
            req.onsuccess = () => resolve(Number(req.result) || 0);
            req.onerror = () => resolve(0);
        } catch (_) {
            resolve(0);
        }
    });
}

async function enqueuePendingSessionSync(
    payload: SessionVaultData & { encryptedDigest?: string },
    accountId?: string
): Promise<number> {
    if (!payload?.sessionId) return 0;
    const db = await openBatchDatabase();
    if (!db || !db.objectStoreNames.contains(STORE_SYNC_OUTBOX)) return 0;

    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(STORE_SYNC_OUTBOX, 'readwrite');
            const store = tx.objectStore(STORE_SYNC_OUTBOX);
            const record: PendingSyncOutboxRecord = {
                sessionId: payload.sessionId,
                payload,
                accountId,
                queuedAt: Date.now(),
                attempts: 1,
            };
            store.put(record);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch (_) {
            resolve();
        }
    });

    const count = await getPendingSyncOutboxCount();
    emitStorageTelemetryEvent({ cacheLayer: 'IDB', offlineOutboxCount: count });
    return count;
}

async function removePendingSessionSync(sessionId: string): Promise<number> {
    if (!sessionId) return 0;
    const db = await openBatchDatabase();
    if (!db || !db.objectStoreNames.contains(STORE_SYNC_OUTBOX)) return 0;

    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(STORE_SYNC_OUTBOX, 'readwrite');
            tx.objectStore(STORE_SYNC_OUTBOX).delete(sessionId);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch (_) {
            resolve();
        }
    });

    return getPendingSyncOutboxCount();
}

let isFlushingOutbox = false;
export async function flushPendingSessionSyncQueue(): Promise<number> {
    if (isFlushingOutbox) return getPendingSyncOutboxCount();
    const db = await openBatchDatabase();
    if (!db || !db.objectStoreNames.contains(STORE_SYNC_OUTBOX)) return 0;

    isFlushingOutbox = true;
    try {
        const queued = await new Promise<PendingSyncOutboxRecord[]>((resolve) => {
            try {
                const tx = db.transaction(STORE_SYNC_OUTBOX, 'readonly');
                const req = tx.objectStore(STORE_SYNC_OUTBOX).getAll();
                req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
                req.onerror = () => resolve([]);
            } catch (_) {
                resolve([]);
            }
        });

        for (const item of queued) {
            try {
                const res = await api.post(
                    '/dashboard/backtest/session-sync',
                    {
                        ...item.payload,
                        config: buildV2BackendConfigEnvelope(item.payload),
                        sessionId: item.sessionId,
                        mode: 'REPLAY_SESSION',
                    },
                    {
                        params: {
                            accountId: item.accountId && item.accountId !== 'all' ? item.accountId : undefined,
                        },
                    }
                );
                markSessionCloudSynced(item.sessionId);
                await removePendingSessionSync(item.sessionId);
                const layer = res.data?.cacheLayer === 'REDIS' ? 'REDIS' : 'POSTGRES';
                const rem = await getPendingSyncOutboxCount();
                emitStorageTelemetryEvent({ cacheLayer: layer, offlineOutboxCount: rem });
            } catch (_) {
                // Keep remaining items in outbox until connectivity resumes
                break;
            }
        }
    } finally {
        isFlushingOutbox = false;
    }

    return getPendingSyncOutboxCount();
}

if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
        void flushPendingSessionSyncQueue();
    });
}

export async function getLocalDbStorageStats(): Promise<LocalDbStorageStats> {
    const db = await openBatchDatabase();
    if (!db) {
        return {
            candleBatchesCount: 0,
            totalCachedCandles: 0,
            encryptedSessionsCount: 0,
            pendingOutboxCount: 0,
        };
    }

    const batches = await new Promise<StoredCandleBatch[]>((resolve) => {
        try {
            const tx = db.transaction(STORE_BATCHES, 'readonly');
            const req = tx.objectStore(STORE_BATCHES).getAll();
            req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
            req.onerror = () => resolve([]);
        } catch (_) {
            resolve([]);
        }
    });

    const encryptedSessionsCount = await new Promise<number>((resolve) => {
        try {
            const tx = db.transaction(STORE_ENCRYPTED_SESSIONS, 'readonly');
            const req = tx.objectStore(STORE_ENCRYPTED_SESSIONS).count();
            req.onsuccess = () => resolve(Number(req.result) || 0);
            req.onerror = () => resolve(0);
        } catch (_) {
            resolve(0);
        }
    });

    const pendingOutboxCount = await getPendingSyncOutboxCount();
    const totalCachedCandles = batches.reduce((acc, b) => acc + (Array.isArray(b.candles) ? b.candles.length : 0), 0);

    return {
        candleBatchesCount: batches.length,
        totalCachedCandles,
        encryptedSessionsCount,
        pendingOutboxCount,
    };
}

export async function pruneOldCandleBatchesInIDB(maxBatches: number = MAX_IDB_CANDLE_BATCHES): Promise<void> {
    const db = await openBatchDatabase();
    if (!db) return;

    const batches = await new Promise<StoredCandleBatch[]>((resolve) => {
        try {
            const tx = db.transaction(STORE_BATCHES, 'readonly');
            const req = tx.objectStore(STORE_BATCHES).getAll();
            req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
            req.onerror = () => resolve([]);
        } catch (_) {
            resolve([]);
        }
    });

    if (batches.length <= maxBatches) return;
    const sortedOldestFirst = [...batches].sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
    const toDelete = sortedOldestFirst.slice(0, batches.length - maxBatches);

    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(STORE_BATCHES, 'readwrite');
            const store = tx.objectStore(STORE_BATCHES);
            for (const b of toDelete) {
                store.delete(b.key);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch (_) {
            resolve();
        }
    });
}

/**
 * Uploads a Replay Journal screenshot as a binary PNG/WebP file (`POST /dashboard/backtest/screenshot`)
 * and returns its lightweight `/uploads/backtest-screenshots/...` URL so session sync JSON stays <15KB.
 */
export async function uploadBacktestScreenshot(
    sessionId: string | undefined,
    screenshotId: string,
    dataUrl: string
): Promise<string | null> {
    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
        return dataUrl || null;
    }
    try {
        const resBlob = await fetch(dataUrl);
        const blob = await resBlob.blob();
        const ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/jpeg' ? 'jpg' : 'png';

        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            await saveMediaOutboxItem({
                mediaId: generateMutationId(),
                userScope: getCurrentUserScope(),
                blob,
                fileName: `${screenshotId}.${ext}`,
                mimeType: blob.type || 'image/png',
                previewDataUrl: dataUrl,
                targetEndpoint: '/dashboard/backtest/screenshot',
                extraFields: {
                    sessionId: sessionId || 'session',
                    screenshotId,
                },
                uploadedUrl: null,
                createdAt: Date.now(),
            });
            emitStorageTelemetryEvent({ cacheLayer: 'IDB' });
            return dataUrl;
        }

        const formData = new FormData();
        formData.append('sessionId', sessionId || 'session');
        formData.append('screenshotId', screenshotId);
        formData.append('file', blob, `${screenshotId}.${ext}`);

        const res = await api.post('/dashboard/backtest/screenshot', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return typeof res.data?.url === 'string' && res.data.url.length > 0 ? res.data.url : null;
    } catch (err: any) {
        if (!err?.response) {
            try {
                const resBlob = await fetch(dataUrl);
                const blob = await resBlob.blob();
                const ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/jpeg' ? 'jpg' : 'png';
                await saveMediaOutboxItem({
                    mediaId: generateMutationId(),
                    userScope: getCurrentUserScope(),
                    blob,
                    fileName: `${screenshotId}.${ext}`,
                    mimeType: blob.type || 'image/png',
                    previewDataUrl: dataUrl,
                    targetEndpoint: '/dashboard/backtest/screenshot',
                    extraFields: {
                        sessionId: sessionId || 'session',
                        screenshotId,
                    },
                    uploadedUrl: null,
                    createdAt: Date.now(),
                });
                emitStorageTelemetryEvent({ cacheLayer: 'IDB' });
                return dataUrl;
            } catch {
                return null;
            }
        }
        return null;
    }
}

/**
 * Deletes an uploaded Replay Journal screenshot file from `/uploads/backtest-screenshots/...`.
 */
export async function deleteBacktestScreenshotFile(url?: string): Promise<void> {
    if (!url || !url.startsWith('/uploads/backtest-screenshots/')) return;
    try {
        await api.post('/dashboard/backtest/screenshot/delete', { url });
    } catch (_) {}
}

const lastSyncedSignatureBySession = new Map<string, string>();

/**
 * Persists the session state to Backend Redis Cache + PostgreSQL (`POST /dashboard/backtest/session-sync`).
 * Skips redundant network writes when the session's revision + encryptedDigest signature has not changed.
 */
export async function syncSessionToBackendRedisPostgres(
    payload: SessionVaultData & { encryptedDigest?: string },
    accountId?: string
): Promise<boolean> {
    const syncSig = payload.encryptedDigest
        ? `${accountId || 'all'}:${payload.revision ?? ''}:${payload.encryptedDigest}`
        : '';
    if (syncSig && lastSyncedSignatureBySession.get(payload.sessionId) === syncSig) {
        return true;
    }

    try {
        const res = await api.post(
            '/dashboard/backtest/session-sync',
            {
                ...payload,
                config: buildV2BackendConfigEnvelope(payload),
                sessionId: payload.sessionId,
                mode: 'REPLAY_SESSION',
            },
            {
                params: { accountId: accountId && accountId !== 'all' ? accountId : undefined },
            }
        );
        if (syncSig) {
            lastSyncedSignatureBySession.set(payload.sessionId, syncSig);
        }
        markSessionCloudSynced(payload.sessionId);
        const remainingOutbox = await removePendingSessionSync(payload.sessionId);
        const layer = res.data?.cacheLayer === 'REDIS' ? 'REDIS' : 'POSTGRES';
        emitStorageTelemetryEvent({ cacheLayer: layer, offlineOutboxCount: remainingOutbox });
        if (remainingOutbox > 0) {
            void flushPendingSessionSyncQueue();
        }
        return true;
    } catch (_) {
        await enqueuePendingSessionSync(payload, accountId);
        return false;
    }
}

/**
 * Fetches a session from Backend Redis Cache (`<5ms`) or PostgreSQL (`GET /dashboard/backtest/session/:sessionId`).
 * When `knownRevision` matches the backend revision, the server returns `{ unchanged: true }` to avoid transferring heavy snapshots.
 */
export async function fetchSessionFromBackendRedisPostgres(
    sessionId: string,
    knownRevision?: number
): Promise<any | null> {
    try {
        const res = await api.get(`/dashboard/backtest/session/${sessionId}`, {
            params: knownRevision && knownRevision > 0 ? { knownRevision } : undefined,
        });
        const data = res.data || null;
        if (data) {
            const outbox = await getPendingSyncOutboxCount();
            emitStorageTelemetryEvent({
                cacheLayer: data.fromRedisCache || data.cacheLayer === 'REDIS' ? 'REDIS' : 'POSTGRES',
                offlineOutboxCount: outbox,
            });
        }
        return data;
    } catch (_) {
        const outbox = await getPendingSyncOutboxCount();
        emitStorageTelemetryEvent({ cacheLayer: 'IDB', offlineOutboxCount: outbox });
        return null;
    }
}

/**
 * Guaranteed flush before closing/reloading the page (`beforeunload` / `pagehide` / `visibilitychange`).
 * 1. Synchronously updates `localStorage` (`backtestWorkspaceStore`).
 * 2. Encrypts and writes to IndexedDB (`AES-256-GCM`).
 * 3. Dispatches a non-blocking `fetch(..., { keepalive: true })` to Backend Redis + PostgreSQL.
 */
export function flushSessionBeforeUnload(payload: SessionVaultData, accountId?: string): void {
    if (!payload.sessionId) return;

    const v2Payload: SessionVaultData = {
        ...payload,
        schemaVersion: BACKTEST_SNAPSHOT_SCHEMA_VERSION,
        updatedAt: payload.updatedAt || new Date().toISOString(),
    };

    // 1. Synchronous localStorage updates (both Workspace Hub store & Terminal V2 Vault)
    try {
        updateBacktestSession(v2Payload.sessionId, {
            schemaVersion: BACKTEST_SNAPSHOT_SCHEMA_VERSION,
            revision: v2Payload.revision,
            currentBalance: v2Payload.currentBalance,
            netPnl: v2Payload.netPnl,
            closedTradesCount: v2Payload.closedTradesCount,
            winsCount: v2Payload.winsCount,
            lossesCount: v2Payload.lossesCount,
            winRate: v2Payload.winRate,
            profitFactor: v2Payload.profitFactor,
            expectancy: v2Payload.expectancy,
            avgR: v2Payload.avgR,
            maxDrawdown: v2Payload.maxDrawdown,
            maxDrawdownPct: v2Payload.maxDrawdownPct,
            orders: v2Payload.orders,
            journalNotes: v2Payload.journalNotes,
            replayTimestamp: v2Payload.replayTimestamp,
            primarySymbol: v2Payload.primarySymbol,
            timeframe: v2Payload.timeframe,
            secondaryTimeframe: v2Payload.secondaryTimeframe,
            dataSource: v2Payload.dataSource,
            layoutMode: v2Payload.layoutMode as ChartLayoutMode | undefined,
            selectedCandleStyle: v2Payload.selectedCandleStyle as ChartCandleStyleId | undefined,
            replayActive: v2Payload.replayActive,
            syncEnabled: v2Payload.syncEnabled,
            yAxis: v2Payload.yAxis,
            drawingTools: v2Payload.drawingTools,
            ticketDefaults: v2Payload.ticketDefaults,
            drawings: v2Payload.drawings,
            drawnItems: v2Payload.drawnItems,
            drawingStylesById: v2Payload.drawingStylesById,
            overlayGeometries: v2Payload.overlayGeometries,
            activeIndicators: v2Payload.activeIndicators,
            indicatorParamsByCode: v2Payload.indicatorParamsByCode,
            sessionScreenshots: v2Payload.sessionScreenshots,
            spread: v2Payload.spread,
            commission: v2Payload.commission,
            timeInvestedSeconds: v2Payload.timeInvestedSeconds,
        });

        const normalizedSnap = normalizeSnapshotToV2(v2Payload, v2Payload.sessionId);
        if (normalizedSnap) {
            writeLocalReplaySnapshot(v2Payload.sessionId, normalizedSnap);
        }
    } catch (_) {}

    // 2. Per-session AES-256-GCM encrypted IndexedDB write (preserves full screenshots)
    void saveEncryptedSessionToIDB(v2Payload.sessionId, v2Payload);

    // 3. Keepalive HTTP POST to Redis + PostgreSQL (<64KB safe payload so browser never aborts on tab close)
    try {
        const token = localStorage.getItem('token');
        const baseUrl = (api.defaults.baseURL || '/api').replace(/\/$/, '');
        const query = accountId && accountId !== 'all' ? `?accountId=${encodeURIComponent(accountId)}` : '';
        const url = `${baseUrl}/dashboard/backtest/session-sync${query}`;

        const configEnvelope = buildV2BackendConfigEnvelope(v2Payload);
        // Strip only un-uploaded inline `data:` Base64 strings on unload while preserving all `/uploads/...` URLs
        const urlOnlyScreenshots = Array.isArray(v2Payload.sessionScreenshots)
            ? v2Payload.sessionScreenshots.filter(
                  (s) => s && typeof s.dataUrl === 'string' && !s.dataUrl.startsWith('data:')
              )
            : undefined;

        let bodyStr = JSON.stringify({
            ...v2Payload,
            ...(urlOnlyScreenshots ? { sessionScreenshots: urlOnlyScreenshots } : {}),
            config: configEnvelope,
            mode: 'REPLAY_SESSION',
        });

        // Browser `keepalive: true` enforces a strict 64KB body cap; strip remaining screenshots only if still > 56KB
        if (bodyStr.length > 56_000) {
            const { sessionScreenshots: _omitShots, ...slimPayload } = v2Payload;
            bodyStr = JSON.stringify({
                ...slimPayload,
                config: configEnvelope,
                mode: 'REPLAY_SESSION',
            });
        }

        fetch(url, {
            method: 'POST',
            keepalive: true,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: bodyStr,
        }).catch(() => {});
    } catch (_) {}
}

export function normalizeSymbolKey(symbol: string): string {
    return (symbol || 'XAUUSD').replace(/^.*:/, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'XAUUSD';
}

export function normalizeTimeframeKey(tf: string): string {
    const clean = (tf || '15m').trim();
    const map: Record<string, string> = {
        '1': '1m',
        '1m': '1m',
        'M1': '1m',
        '5': '5m',
        '5m': '5m',
        'M5': '5m',
        '15': '15m',
        '15m': '15m',
        'M15': '15m',
        '30': '30m',
        '30m': '30m',
        'M30': '30m',
        '60': '1H',
        '1h': '1H',
        '1H': '1H',
        'H1': '1H',
        '240': '4H',
        '4h': '4H',
        '4H': '4H',
        'H4': '4H',
        '1D': '1D',
        '1d': '1D',
        'D': '1D',
        '1W': '1W',
        '1w': '1W',
        'W': '1W',
    };
    return map[clean] || clean;
}

export function mergeAndDeduplicateCandles(existing: KLineData[], incoming: KLineData[]): KLineData[] {
    const map = new Map<number, KLineData>();
    for (const c of existing) {
        if (c && Number.isFinite(c.timestamp) && Number.isFinite(c.open) && Number.isFinite(c.close)) {
            map.set(c.timestamp, c);
        }
    }
    for (const c of incoming) {
        if (c && Number.isFinite(c.timestamp) && Number.isFinite(c.open) && Number.isFinite(c.close)) {
            map.set(c.timestamp, c);
        }
    }
    return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
}

export async function saveCandleBatchToIDB(
    symbol: string,
    timeframe: string,
    candles: KLineData[],
    source: string = 'TradingView'
): Promise<void> {
    if (!candles || candles.length === 0) return;
    // Never persist synthetic/simulated demo candles into the historical market cache
    if (/demo|simulad/i.test(source || '')) return;
    const validated = sanitizeValidCandles(candles);
    if (validated.length === 0) return;
    const db = await openBatchDatabase();
    if (!db) return;

    const sym = normalizeSymbolKey(symbol);
    const tf = normalizeTimeframeKey(timeframe);
    const sorted = [...validated].sort((a, b) => a.timestamp - b.timestamp);
    const earliestTs = sorted[0].timestamp;
    const latestTs = sorted[sorted.length - 1].timestamp;
    // Bucket by 500-bar window start so overlapping updates overwrite cleanly
    const bucketTs = Math.floor(earliestTs / (3600 * 1000 * 12)) * (3600 * 1000 * 12);
    const seriesKey = `${sym}:${tf}`;
    const key = `${seriesKey}:${bucketTs}`;

    const record: StoredCandleBatch = {
        key,
        seriesKey,
        symbol: sym,
        timeframe: tf,
        bucketTs,
        earliestTs,
        latestTs,
        candles: sorted,
        source,
        savedAt: Date.now(),
    };

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_BATCHES, 'readwrite');
            const store = tx.objectStore(STORE_BATCHES);
            store.put(record);
            tx.oncomplete = () => {
                void pruneOldCandleBatchesInIDB();
                resolve();
            };
            tx.onerror = () => resolve();
        } catch (_) {
            resolve();
        }
    });
}

export async function getMergedCandlesFromIDB(
    symbol: string,
    timeframe: string
): Promise<{
    candles: KLineData[];
    batchCount: number;
    earliestTs: number | null;
    latestTs: number | null;
    source: string;
}> {
    const db = await openBatchDatabase();
    if (!db) {
        return { candles: [], batchCount: 0, earliestTs: null, latestTs: null, source: 'TradingView' };
    }

    const sym = normalizeSymbolKey(symbol);
    const tf = normalizeTimeframeKey(timeframe);
    const candidateSeriesKeys = Array.from(
        new Set([`${sym}:${tf}`, `${sym}:${tf.toLowerCase()}`, `${sym}:${(timeframe || '').trim()}`])
    );

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_BATCHES, 'readonly');
            const store = tx.objectStore(STORE_BATCHES);
            const idx = store.index('by_series');
            const collected: StoredCandleBatch[] = [];
            let pending = candidateSeriesKeys.length;

            const finalize = () => {
                const realBatches = collected.filter((b) => !/demo|simulad/i.test(b?.source || ''));
                if (realBatches.length === 0) {
                    resolve({ candles: [], batchCount: 0, earliestTs: null, latestTs: null, source: 'TradingView' });
                    return;
                }
                let merged: KLineData[] = [];
                let source = 'TradingView';
                for (const b of realBatches) {
                    merged = mergeAndDeduplicateCandles(merged, b.candles || []);
                    if (b.source) source = b.source;
                }
                resolve({
                    candles: merged,
                    batchCount: realBatches.length,
                    earliestTs: merged.length > 0 ? merged[0].timestamp : null,
                    latestTs: merged.length > 0 ? merged[merged.length - 1].timestamp : null,
                    source,
                });
            };

            for (const sKey of candidateSeriesKeys) {
                const req = idx.getAll(IDBKeyRange.only(sKey));
                req.onsuccess = () => {
                    if (Array.isArray(req.result)) {
                        collected.push(...req.result);
                    }
                    pending -= 1;
                    if (pending <= 0) finalize();
                };
                req.onerror = () => {
                    pending -= 1;
                    if (pending <= 0) finalize();
                };
            }
        } catch (_) {
            resolve({ candles: [], batchCount: 0, earliestTs: null, latestTs: null, source: 'TradingView' });
        }
    });
}

const toKLine = (c: any): KLineData => ({
    timestamp: Number(
        c.timestamp ??
            (typeof c.time === 'number' ? (c.time < 1e10 ? c.time * 1000 : c.time) : new Date(c.time).getTime())
    ),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume || 0),
});

/**
 * Fetches a single 500-candle chunk from the backend `/tradingview/candles/batch` endpoint
 * and persists it into IndexedDB.
 */
export async function fetchSingleCandleBatch(params: {
    symbol: string;
    timeframe: string;
    chunkSize?: number;
    chunkIndex?: number;
    cursorTo?: number;
    fromTs?: number;
    toTs?: number;
}): Promise<{
    candles: KLineData[];
    nextCursorTo: number | null;
    hasMore: boolean;
    estimatedTotalChunks: number;
    fromCache: boolean;
}> {
    const chunkSize = params.chunkSize || 500;
    const res = await api.get('/tradingview/candles/batch', {
        params: {
            symbol: params.symbol,
            timeframe: params.timeframe,
            chunkSize,
            chunkIndex: params.chunkIndex || 0,
            cursorTo: params.cursorTo,
            from: params.fromTs,
            to: params.toTs,
        },
    });

    const data = res.data || {};
    const rawList = Array.isArray(data.candles) ? data.candles : Array.isArray(data) ? data : [];
    const candles = rawList
        .map(toKLine)
        .filter((c: KLineData) => Number.isFinite(c.timestamp) && Number.isFinite(c.open) && Number.isFinite(c.close))
        .sort((a: KLineData, b: KLineData) => a.timestamp - b.timestamp);

    if (candles.length > 0) {
        await saveCandleBatchToIDB(params.symbol, params.timeframe, candles, 'TradingView');
    }

    return {
        candles,
        nextCursorTo: data.nextCursorTo ?? null,
        hasMore: Boolean(data.hasMore),
        estimatedTotalChunks: Number(data.estimatedTotalChunks) || 1,
        fromCache: Boolean(data.fromCache),
    };
}

/**
 * Maps a raw trade from `/journal/trades` to a `ReplayOrder` for the Replay Terminal.
 */
export function mapSyncedTradeToReplayOrder(rawTrade: any, idx: number = 0): ReplayOrder {
    const isBuy = (rawTrade.type || 'BUY').toUpperCase().includes('BUY');
    const entryPrice = Number(rawTrade.openPrice) || 1.0;
    const closePrice = Number(rawTrade.closePrice) || entryPrice;
    const pnl =
        Number(rawTrade.profit || 0) + Number(rawTrade.commission || 0) + Number(rawTrade.swap || 0);
    const rawSl = Number(rawTrade.stopLoss || rawTrade.sl || 0);
    const rawTp = Number(rawTrade.takeProfit || rawTrade.tp || 0);
    const sl = rawSl > 0 ? Number(rawSl.toFixed(5)) : 0;
    const tp = rawTp > 0 ? Number(rawTp.toFixed(5)) : 0;
    const openTs = rawTrade.openTime ? new Date(rawTrade.openTime).getTime() : Date.now() - 86400000;
    const closeTs = rawTrade.closeTime ? new Date(rawTrade.closeTime).getTime() : openTs + 1800000;
    const riskDist = sl > 0 ? Math.abs(entryPrice - sl) : 0;
    const rewardDist = tp > 0 ? Math.abs(tp - entryPrice) : Math.abs(closePrice - entryPrice);
    const rrRatio = riskDist > 0 && rewardDist > 0 ? Number((rewardDist / riskDist).toFixed(2)) : 2.0;
    const riskAmount = Math.max(10, Math.abs(pnl) || 100);
    const tol = Math.max(Math.abs(closePrice - entryPrice) * 0.2, entryPrice * 0.0002);
    const exitReason: 'TP' | 'SL' | 'MANUAL' =
        tp > 0 && Math.abs(closePrice - tp) <= tol
            ? 'TP'
            : sl > 0 && Math.abs(closePrice - sl) <= tol
              ? 'SL'
              : pnl >= 0
                ? 'TP'
                : 'SL';

    return {
        id: String(rawTrade.id || rawTrade.ticket || `sync-${idx}-${Date.now()}`),
        symbol: normalizeSymbolKey(rawTrade.symbol || 'XAUUSD'),
        side: isBuy ? 'BUY' : 'SELL',
        orderType: 'MARKET',
        status: pnl >= 0 ? 'WIN' : 'LOSS',
        lots: Number(rawTrade.volume || rawTrade.lots || 0.1),
        entryPrice,
        stopLoss: sl,
        initialStopLoss: sl,
        takeProfit: tp,
        exitPrice: closePrice,
        exitReason,
        openedAt: openTs,
        filledAt: openTs,
        closedAt: closeTs,
        isImportedTrade: true,
        historicalExitPrice: closePrice,
        historicalClosedAt: closeTs,
        historicalPnl: Number(pnl.toFixed(2)),
        historicalExitReason: exitReason,
        pnl: Number(pnl.toFixed(2)),
        riskAmount,
        rrRatio,
        rMultiple: Number((pnl / riskAmount).toFixed(2)),
    };
}

/**
 * Pulls all historical trades of an account in sequential batches, pre-fetches 500-candle OHLCV
 * batches for every traded symbol into IndexedDB + Server Cache, and assembles/updates a
 * SINGLE UNIFIED REPLAY SESSION for the complete synchronization.
 */
export async function pullAccountHistoryInBatchesAndBuildUnifiedSession(options: {
    accountId?: string;
    accountName?: string;
    syncSourceLabel?: string;
    isDeriv?: boolean;
    triggerLiveBrokerSync?: boolean;
    focusTrade?: any;
    onProgress?: (progress: UnifiedSyncBatchProgress) => void;
}): Promise<{
    session: BacktestReplaySession;
    totalTrades: number;
    totalCandlesCached: number;
    pairs: string[];
}> {
    const emit = (p: UnifiedSyncBatchProgress) => {
        options.onProgress?.(p);
    };

    // 1. Optional live broker synchronization (MT5 Cloud / EA / Deriv)
    if (options.triggerLiveBrokerSync) {
        emit({
            phase: 'BROKER_SYNC',
            loadedTradeBatches: 0,
            totalTradeBatches: 1,
            totalTradesPulled: 0,
            loadedCandleBatches: 0,
            totalCandleBatches: 1,
            totalCandlesCached: 0,
            message: `Conectando ao ${options.syncSourceLabel || 'MT5 / Deriv'} para sincronizar novos lotes da conta...`,
        });

        try {
            if (options.isDeriv) {
                await api.post('/integrations/deriv/sync');
            } else {
                await api.post('/mt5/cloud/sync', { accountId: options.accountId });
            }
        } catch (_) {
            // Even if live cloud sync is offline, continue pulling stored historical batches
        }
    }

    // 2. Pull historical trades from `/journal/trades` and process them in sequential batches of 25 trades
    emit({
        phase: 'TRADE_BATCHES',
        loadedTradeBatches: 0,
        totalTradeBatches: 1,
        totalTradesPulled: 0,
        loadedCandleBatches: 0,
        totalCandleBatches: 1,
        totalCandlesCached: 0,
        message: 'Puxando histórico de operações da conta em lotes...',
    });

    let rawTrades: any[] = [];
    try {
        const res = await api.get('/journal/trades', {
            params: options.accountId ? { accountId: options.accountId } : undefined,
        });
        rawTrades = Array.isArray(res.data) ? res.data : [];
    } catch (_) {
        rawTrades = [];
    }

    if (options.focusTrade && !rawTrades.some((t) => String(t.id) === String(options.focusTrade.id))) {
        rawTrades.unshift(options.focusTrade);
    }

    // Filter to the target account if accountId is provided
    const accountTrades = options.accountId
        ? rawTrades.filter((t) => !t.accountId || String(t.accountId) === String(options.accountId))
        : rawTrades;

    const effectiveTrades = accountTrades.length > 0 ? accountTrades : rawTrades;
    const TRADE_BATCH_SIZE = 25;
    const totalTradeBatches = Math.max(1, Math.ceil(effectiveTrades.length / TRADE_BATCH_SIZE));
    const mappedOrders: ReplayOrder[] = [];

    for (let b = 0; b < totalTradeBatches; b++) {
        const slice = effectiveTrades.slice(b * TRADE_BATCH_SIZE, (b + 1) * TRADE_BATCH_SIZE);
        slice.forEach((t, idx) => {
            mappedOrders.push(mapSyncedTradeToReplayOrder(t, b * TRADE_BATCH_SIZE + idx));
        });
        emit({
            phase: 'TRADE_BATCHES',
            loadedTradeBatches: b + 1,
            totalTradeBatches,
            totalTradesPulled: mappedOrders.length,
            loadedCandleBatches: 0,
            totalCandleBatches: 1,
            totalCandlesCached: 0,
            message: `Lote de Trades ${b + 1}/${totalTradeBatches} processado (${mappedOrders.length} trades)...`,
        });
        // Yield briefly to keep UI responsive
        await new Promise((r) => setTimeout(r, 40));
    }

    // Sort orders chronologically by openedAt
    mappedOrders.sort((a, b) => a.openedAt - b.openedAt);

    // 3. Extract unique pairs and date window across all batches
    const focusSymbol = options.focusTrade ? normalizeSymbolKey(options.focusTrade.symbol) : undefined;
    const uniquePairs = Array.from(
        new Set([
            ...(focusSymbol ? [focusSymbol] : []),
            ...mappedOrders.map((o) => normalizeSymbolKey(o.symbol)).filter(Boolean),
        ])
    ).slice(0, 12);

    if (uniquePairs.length === 0) {
        uniquePairs.push('XAUUSD');
    }

    const timestamps = mappedOrders.map((o) => o.openedAt).filter((ts) => Number.isFinite(ts) && ts > 0);
    const minTs = timestamps.length > 0 ? Math.min(...timestamps) : Date.now() - 14 * 86400000;
    const maxTs = timestamps.length > 0 ? Math.max(...timestamps) : Date.now();

    const fromDate = new Date(minTs - 2 * 86400000).toISOString().slice(0, 10);
    const toDate = new Date(Math.min(Date.now(), maxTs + 2 * 86400000)).toISOString().slice(0, 10);

    // 4. Pre-fetch 500-candle OHLCV batches per symbol into Backend Cache + MT5 Worker + Frontend IndexedDB
    const symbolsToPrefetch = uniquePairs.slice(0, 6);
    const timeframesToPrefetch = ['15m', '5m', '1H'];
    const totalCandleBatches = symbolsToPrefetch.length * timeframesToPrefetch.length;
    let totalCandlesCached = 0;

    // Warm server cache & trigger MT5 Worker historical candle extraction in parallel first
    try {
        await Promise.allSettled([
            api.post('/tradingview/candles/prefetch', {
                items: symbolsToPrefetch.map((sym) => ({
                    symbol: sym,
                    timeframe: '15m',
                    toTs: Math.min(Date.now(), maxTs + 12 * 3600 * 1000),
                    fromTs: minTs - 24 * 3600 * 1000,
                    chunkSize: 500,
                })),
            }),
            api.post('/mt5/market-feed-demo/prefetch-session', {
                symbols: symbolsToPrefetch,
                timeframe: '15m',
                fromDate,
                toDate,
            }),
        ]);
    } catch (_) {}

    let batchStep = 0;
    for (let i = 0; i < symbolsToPrefetch.length; i++) {
        const sym = symbolsToPrefetch[i];
        const symbolOrders = mappedOrders.filter((o) => o.symbol === sym);
        const latestOrderTs =
            symbolOrders.length > 0
                ? Math.max(...symbolOrders.map((o) => o.closedAt || o.openedAt))
                : maxTs;

        for (const tf of timeframesToPrefetch) {
            emit({
                phase: 'OHLCV_PREFETCH',
                loadedTradeBatches: totalTradeBatches,
                totalTradeBatches,
                totalTradesPulled: mappedOrders.length,
                loadedCandleBatches: batchStep,
                totalCandleBatches,
                totalCandlesCached,
                message: `Baixando lote de 500 velas OHLCV (${sym} · ${tf}) [${batchStep + 1}/${totalCandleBatches}]...`,
            });

            try {
                const batch = await fetchSingleCandleBatch({
                    symbol: sym,
                    timeframe: tf,
                    chunkSize: 500,
                    chunkIndex: 0,
                    cursorTo: Math.min(Date.now(), latestOrderTs + 6 * 3600 * 1000),
                    fromTs: minTs - 24 * 3600 * 1000,
                });
                totalCandlesCached += batch.candles.length;
            } catch (_) {
                const cached = await getMergedCandlesFromIDB(sym, tf);
                totalCandlesCached += cached.candles.length;
            }

            batchStep++;
            emit({
                phase: 'OHLCV_PREFETCH',
                loadedTradeBatches: totalTradeBatches,
                totalTradeBatches,
                totalTradesPulled: mappedOrders.length,
                loadedCandleBatches: batchStep,
                totalCandleBatches,
                totalCandlesCached,
                message: `Lote OHLCV ${sym} (${tf}) armazenado no cache (${totalCandlesCached} velas)...`,
            });
        }
    }

    // 5. Assemble or Update the SINGLE UNIFIED REPLAY SESSION for this Account Sync
    emit({
        phase: 'SESSION_ASSEMBLY',
        loadedTradeBatches: totalTradeBatches,
        totalTradeBatches,
        totalTradesPulled: mappedOrders.length,
        loadedCandleBatches: totalCandleBatches,
        totalCandleBatches,
        totalCandlesCached,
        message: 'Consolidando Sessão Única de Replay da Sincronização...',
    });

    const strategies = loadBacktestStrategies();
    const defaultStrat = strategies[0];
    const existingSessions = loadBacktestSessions();

    const accountTag = options.accountName || (options.accountId ? `Conta ${String(options.accountId).slice(0, 6)}` : 'Conta Principal');
    const unifiedSessionPrefix = `[Sync Unificado] ${accountTag}`;

    // Find existing unified session for this account so all sync batches converge into ONE session
    let unifiedSession = existingSessions.find(
        (s) => s.name.startsWith(unifiedSessionPrefix) || s.journalNotes?.includes(`SYNC_ACCOUNT_ID:${options.accountId || 'DEFAULT'}`)
    );

    const netPnl = mappedOrders.reduce((acc, o) => acc + (o.pnl || 0), 0);
    const winsCount = mappedOrders.filter((o) => (o.pnl || 0) > 0).length;
    const lossesCount = mappedOrders.filter((o) => (o.pnl || 0) <= 0).length;
    const closedCount = mappedOrders.length;
    const winRate = closedCount > 0 ? Number(((winsCount / closedCount) * 100).toFixed(1)) : 0;
    const grossProfit = mappedOrders.filter((o) => o.pnl > 0).reduce((a, b) => a + b.pnl, 0);
    const grossLoss = Math.abs(mappedOrders.filter((o) => o.pnl < 0).reduce((a, b) => a + b.pnl, 0));
    const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 9.99 : 0;

    // Position the initial replay timestamp 15 minutes before the focusTrade (or earliest trade)
    const targetEntryTs = options.focusTrade?.openTime
        ? new Date(options.focusTrade.openTime).getTime()
        : mappedOrders[0]?.openedAt || minTs;
    const initialReplayTimestamp = targetEntryTs - 15 * 60 * 1000;

    const sessionNotes = [
        `SYNC_ACCOUNT_ID:${options.accountId || 'DEFAULT'}`,
        `Sessão Única consolidada via ${options.syncSourceLabel || 'MT5 Sync'} em lotes.`,
        `Total de operações sincronizadas: ${mappedOrders.length} trades em ${uniquePairs.length} ativos (${uniquePairs.join(', ')}).`,
        `Cache OHLCV IndexedDB: ${totalCandlesCached} velas pré-carregadas em blocos de 500.`,
    ].join('\n');

    if (unifiedSession) {
        const mergedPairs = Array.from(new Set([...(focusSymbol ? [focusSymbol] : []), ...uniquePairs, ...unifiedSession.pairs]));
        const updated = updateBacktestSession(unifiedSession.id, {
            name: `${unifiedSessionPrefix} (${mappedOrders.length} Trades)`,
            primarySymbol: focusSymbol || unifiedSession.primarySymbol || mergedPairs[0],
            pairs: mergedPairs,
            fromDate: fromDate < unifiedSession.fromDate ? fromDate : unifiedSession.fromDate,
            toDate: toDate > unifiedSession.toDate ? toDate : unifiedSession.toDate,
            orders: mappedOrders,
            closedTradesCount: closedCount,
            winsCount,
            lossesCount,
            winRate,
            profitFactor,
            netPnl: Number(netPnl.toFixed(2)),
            currentBalance: Number((unifiedSession.startingCapital + netPnl).toFixed(2)),
            replayTimestamp: initialReplayTimestamp,
            journalNotes: sessionNotes,
        });
        if (updated) unifiedSession = updated;
    } else {
        const created = createBacktestSession({
            name: `${unifiedSessionPrefix} (${mappedOrders.length} Trades)`,
            strategyId: defaultStrat.id,
            pairs: uniquePairs,
            primarySymbol: focusSymbol || uniquePairs[0],
            timeframe: '15m',
            fromDate,
            toDate,
            keepEndFollowingToday: true,
            randomStartDate: false,
            riskPerTrade: 1.0,
            fundedMode: {
                enabled: false,
                profitTargetPct: 10,
                maxDailyLossPct: 5,
                maxTotalLossPct: 10,
            },
        });
        const patched = updateBacktestSession(created.id, {
            orders: mappedOrders,
            closedTradesCount: closedCount,
            winsCount,
            lossesCount,
            winRate,
            profitFactor,
            netPnl: Number(netPnl.toFixed(2)),
            currentBalance: Number((created.startingCapital + netPnl).toFixed(2)),
            replayTimestamp: initialReplayTimestamp,
            journalNotes: sessionNotes,
        });
        unifiedSession = patched || created;
    }

    if (unifiedSession) {
        const vaultPayload: SessionVaultData = {
            sessionId: unifiedSession.id,
            name: unifiedSession.name,
            strategyName: unifiedSession.strategyName,
            primarySymbol: unifiedSession.primarySymbol,
            timeframe: unifiedSession.timeframe,
            secondaryTimeframe: unifiedSession.secondaryTimeframe,
            pairs: unifiedSession.pairs,
            fromDate: unifiedSession.fromDate,
            toDate: unifiedSession.toDate,
            orders: unifiedSession.orders,
            journalNotes: unifiedSession.journalNotes,
            replayTimestamp: unifiedSession.replayTimestamp,
            currentBalance: unifiedSession.currentBalance,
            netPnl: unifiedSession.netPnl,
            closedTradesCount: unifiedSession.closedTradesCount,
            winsCount: unifiedSession.winsCount,
            lossesCount: unifiedSession.lossesCount,
            winRate: unifiedSession.winRate,
            profitFactor: unifiedSession.profitFactor,
            timeInvestedSeconds: unifiedSession.timeInvestedSeconds,
            updatedAt: new Date().toISOString(),
        };
        const { digestHex } = await saveEncryptedSessionToIDB(unifiedSession.id, vaultPayload);
        await syncSessionToBackendRedisPostgres(
            { ...vaultPayload, encryptedDigest: digestHex },
            options.accountId
        );
    }

    emit({
        phase: 'DONE',
        loadedTradeBatches: totalTradeBatches,
        totalTradeBatches,
        totalTradesPulled: mappedOrders.length,
        loadedCandleBatches: totalCandleBatches,
        totalCandleBatches,
        totalCandlesCached,
        message: `Sincronização concluída! ${mappedOrders.length} trades e ${totalCandlesCached} velas prontos na Sessão Única.`,
    });

    return {
        session: unifiedSession!,
        totalTrades: mappedOrders.length,
        totalCandlesCached,
        pairs: uniquePairs,
    };
}

// ============================================================================
// SHARED MT5 DEMO ACCOUNT FOR ALL BACKTEST SESSIONS
// ============================================================================

export interface SharedMt5DemoFeedConfig {
    login: string;
    server: string;
    connected?: boolean;
    connectionState?: string;
    statusMessage?: string;
    updatedAt: string;
}

const SHARED_MT5_DEMO_STORAGE_KEY = 'torex_shared_mt5_demo_feed_v1';

export function loadSharedMt5DemoConfig(): SharedMt5DemoFeedConfig {
    try {
        const raw = localStorage.getItem(SHARED_MT5_DEMO_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && parsed.login) {
                return parsed;
            }
        }
    } catch (_) {}
    return {
        login: '',
        server: 'MetaQuotes-Demo',
        connected: false,
        connectionState: 'READY',
        statusMessage: 'Conta Demo compartilhada pronta para todas as sessões',
        updatedAt: new Date().toISOString(),
    };
}

export function saveSharedMt5DemoConfig(config: Partial<SharedMt5DemoFeedConfig>): SharedMt5DemoFeedConfig {
    const current = loadSharedMt5DemoConfig();
    const next: SharedMt5DemoFeedConfig = {
        ...current,
        ...config,
        login: (config.login ?? current.login ?? '').trim(),
        server: (config.server ?? current.server ?? 'MetaQuotes-Demo').trim() || 'MetaQuotes-Demo',
        updatedAt: new Date().toISOString(),
    };
    try {
        localStorage.setItem(SHARED_MT5_DEMO_STORAGE_KEY, JSON.stringify(next));
    } catch (_) {}
    return next;
}

export async function fetchBackendSharedMt5DemoStatus(): Promise<SharedMt5DemoFeedConfig> {
    const local = loadSharedMt5DemoConfig();
    try {
        const res = await api.get('/mt5/market-feed-demo');
        if (res.data && res.data.login) {
            return saveSharedMt5DemoConfig({
                login: res.data.login,
                server: res.data.server || local.server || 'MetaQuotes-Demo',
                connected: Boolean(res.data.connected),
                connectionState: res.data.connectionState || 'CONNECTED',
                statusMessage: res.data.statusMessage,
            });
        }
    } catch (_) {}
    return local;
}

/**
 * Logs into the saved Shared MT5 Demo Account on the backend/worker and pulls 500-candle
 * historical OHLCV batches into IndexedDB (`ohlcv_batches`) when a user creates or opens a session.
 */
export async function prefetchSessionViaSharedDemoAccount(params: {
    sessionId?: string;
    symbols: string[];
    timeframe: string;
    fromDate?: string;
    toDate?: string;
    demoLogin?: string;
    demoPass?: string;
    demoServer?: string;
}): Promise<{ totalCandlesCached: number; demoAccount: SharedMt5DemoFeedConfig }> {
    const savedDemo =
        params.demoLogin && params.demoLogin.trim()
            ? saveSharedMt5DemoConfig({
                  login: params.demoLogin.trim(),
                  server: params.demoServer || 'MetaQuotes-Demo',
              })
            : loadSharedMt5DemoConfig();

    try {
        const res = await api.post('/mt5/market-feed-demo/prefetch-session', {
            sessionId: params.sessionId,
            symbols: params.symbols,
            timeframe: params.timeframe,
            fromDate: params.fromDate,
            toDate: params.toDate,
            demoLogin: savedDemo.login || undefined,
            demoPass: params.demoPass || undefined,
            demoServer: savedDemo.server || 'MetaQuotes-Demo',
        });
        if (res.data?.demoAccount?.login) {
            saveSharedMt5DemoConfig({
                login: res.data.demoAccount.login,
                server: res.data.demoAccount.server,
                connected: Boolean(res.data.demoAccount.connected),
                connectionState: res.data.demoAccount.connectionState,
                statusMessage: res.data.demoAccount.statusMessage,
            });
        }
    } catch (_) {}

    const fromTs = params.fromDate ? new Date(params.fromDate).getTime() - 24 * 3600_000 : Date.now() - 15 * 86400_000;
    const toTs = params.toDate
        ? Math.min(Date.now(), new Date(params.toDate).getTime() + 24 * 3600_000)
        : Date.now();

    const primarySymbol = (params.symbols || ['XAUUSD'])[0] || 'XAUUSD';
    const warmupTimeframes = Array.from(new Set([params.timeframe || '15m', '1h']));
    const results = await Promise.allSettled(
        warmupTimeframes.map((targetTf) =>
            fetchSingleCandleBatch({
                symbol: primarySymbol,
                timeframe: targetTf,
                chunkSize: 500,
                chunkIndex: 0,
                cursorTo: toTs,
                fromTs,
                toTs,
            })
        )
    );
    const totalCandlesCached = results.reduce(
        (acc, res) => acc + (res.status === 'fulfilled' ? res.value.candles.length : 0),
        0
    );

    return {
        totalCandlesCached,
        demoAccount: loadSharedMt5DemoConfig(),
    };
}
