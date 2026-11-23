import {
    canUseGeneralOfflineMode,
    canUseReplayOfflineMode,
    getStoredUserPlanTier,
    openWorkspacePlansModal,
} from '../lib/planGate';
import {
    clearOfflineSessionKey,
    decryptOfflineValue,
    encryptOfflineValue,
} from '../lib/offlineCrypto';

const DB_NAME = 'torex_offline_db_v1';
const DB_VERSION = 2;

export const STORE_HTTP_GET_CACHE = 'http_get_cache';
export const STORE_ENTITIES_TRADES = 'entities_trades';
export const STORE_ENTITIES_ACCOUNTS = 'entities_accounts';
export const STORE_ENTITIES_TRANSACTIONS = 'entities_transactions';
export const STORE_ENTITIES_JOURNAL = 'entities_journal';
export const STORE_ENTITIES_USER_PROFILE = 'entities_user_profile';
export const STORE_QUERY_CACHE = 'query_cache';
export const STORE_MEDIA_OUTBOX = 'media_outbox';
export const STORE_SYNC_OUTBOX = 'sync_outbox';
export const STORE_ID_MAPPINGS = 'id_mappings';

const LAST_USER_SCOPE_KEY = 'torex_last_user_scope';
const MAX_HTTP_CACHE_PER_USER = 300;
const MAX_QUERY_CACHE_PER_USER = 200;

export type SyncEntityType =
    | 'journal_daily'
    | 'journal_trade'
    | 'journal_general'
    | 'journal_template'
    | 'trade_meta'
    | 'account'
    | 'account_transaction'
    | 'user_profile'
    | 'notification'
    | 'backtest_session'
    | 'generic';

export type JournalEntityKind = 'daily' | 'trade' | 'general';

export interface StoredAccountEntityRecord {
    key: string; // `${userScope}:${accountId}`
    userScope: string;
    accountId: string;
    account: Record<string, any>;
    updatedAt: number;
}

export interface StoredTransactionEntityRecord {
    key: string; // `${userScope}:${txId}`
    userScope: string;
    accountScopeKey: string; // `${userScope}:${accountId}`
    accountId: string;
    txId: string;
    transaction: Record<string, any>;
    updatedAt: number;
}

export interface StoredJournalEntityRecord {
    key: string; // `${userScope}:${kind}:${entityKey}`
    userScope: string;
    kind: JournalEntityKind;
    kindUserKey: string; // `${userScope}:${kind}`
    entityKey: string;
    accountId: string;
    data: Record<string, any>;
    updatedAt: number;
}

export interface StoredUserProfileRecord {
    userScope: string;
    profile: Record<string, any>;
    updatedAt: number;
}

export type SyncMutationMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface HttpGetCacheRecord {
    cacheKey: string;
    userScope: string;
    urlPath: string;
    paramsKey: string;
    accountScope: string;
    data: any;
    updatedAt: number;
}

export interface StoredTradeEntityRecord {
    key: string; // `${userScope}:${tradeId}`
    userScope: string;
    tradeId: string;
    accountId: string;
    trade: Record<string, any>;
    updatedAt: number;
}

export interface PersistedQueryRecord {
    cacheKey: string;
    userScope: string;
    queryKey: any[];
    data: any;
    dataUpdatedAt: number;
}

export interface MediaOutboxItem {
    mediaId: string;
    userScope: string;
    blob: Blob;
    fileName: string;
    mimeType: string;
    previewDataUrl: string;
    targetEndpoint: string;
    extraFields?: Record<string, string>;
    uploadedUrl: string | null;
    createdAt: number;
}

export interface SyncOutboxItem {
    mutationId: string;
    userScope: string;
    entityType: SyncEntityType;
    coalesceKey?: string;
    tempEntityId?: string;
    method: SyncMutationMethod;
    url: string;
    params?: Record<string, any>;
    body?: any;
    accountHeader?: string;
    clientUpdatedAt: string;
    createdAt: number;
    attempts: number;
    status: 'pending' | 'syncing' | 'failed_permanent';
    lastError?: string;
}

export interface IdMappingRecord {
    tempId: string;
    serverId: string;
    entityType: string;
    createdAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

export function generateMutationId(): string {
    if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
        return window.crypto.randomUUID();
    }
    return `mut-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function rememberUserScope(userId?: string | null): void {
    if (typeof window === 'undefined' || !userId) return;
    try {
        localStorage.setItem(LAST_USER_SCOPE_KEY, String(userId));
    } catch {
        // Ignore storage quota errors
    }
}

export function getCurrentUserScope(): string {
    if (typeof window === 'undefined') return 'anon';
    try {
        const rawUser = localStorage.getItem('torex_user_cache');
        if (rawUser) {
            const parsed = JSON.parse(rawUser);
            if (parsed?.id) return String(parsed.id);
        }
    } catch {
        // Ignore parse failures and try JWT fallback
    }

    try {
        const token = localStorage.getItem('token');
        if (token && token.split('.').length >= 2) {
            const payloadB64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            const padded = payloadB64.padEnd(Math.ceil(payloadB64.length / 4) * 4, '=');
            const decoded = JSON.parse(atob(padded));
            const sub = decoded?.id || decoded?.userId || decoded?.sub;
            if (sub) return String(sub);
        }
    } catch {
        // Ignore malformed token
    }

    try {
        const remembered = localStorage.getItem(LAST_USER_SCOPE_KEY);
        if (remembered && remembered.trim()) {
            return remembered.trim();
        }
    } catch {
        // Ignore storage errors
    }

    return 'anon';
}

export function openOfflineDatabase(): Promise<IDBDatabase | null> {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
        return Promise.resolve(null);
    }
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve) => {
        try {
            const req = window.indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;

                if (!db.objectStoreNames.contains(STORE_HTTP_GET_CACHE)) {
                    const httpStore = db.createObjectStore(STORE_HTTP_GET_CACHE, {
                        keyPath: 'cacheKey',
                    });
                    httpStore.createIndex('by_user', 'userScope', { unique: false });
                    httpStore.createIndex('by_url', 'urlPath', { unique: false });
                }

                if (!db.objectStoreNames.contains(STORE_ENTITIES_TRADES)) {
                    const tradeStore = db.createObjectStore(STORE_ENTITIES_TRADES, {
                        keyPath: 'key',
                    });
                    tradeStore.createIndex('by_user', 'userScope', { unique: false });
                }

                if (!db.objectStoreNames.contains(STORE_ENTITIES_ACCOUNTS)) {
                    const accStore = db.createObjectStore(STORE_ENTITIES_ACCOUNTS, {
                        keyPath: 'key',
                    });
                    accStore.createIndex('by_user', 'userScope', { unique: false });
                }

                if (!db.objectStoreNames.contains(STORE_ENTITIES_TRANSACTIONS)) {
                    const txStore = db.createObjectStore(STORE_ENTITIES_TRANSACTIONS, {
                        keyPath: 'key',
                    });
                    txStore.createIndex('by_user', 'userScope', { unique: false });
                    txStore.createIndex('by_account', 'accountScopeKey', { unique: false });
                }

                if (!db.objectStoreNames.contains(STORE_ENTITIES_JOURNAL)) {
                    const journalStore = db.createObjectStore(STORE_ENTITIES_JOURNAL, {
                        keyPath: 'key',
                    });
                    journalStore.createIndex('by_user', 'userScope', { unique: false });
                    journalStore.createIndex('by_kind_user', 'kindUserKey', { unique: false });
                }

                if (!db.objectStoreNames.contains(STORE_ENTITIES_USER_PROFILE)) {
                    db.createObjectStore(STORE_ENTITIES_USER_PROFILE, {
                        keyPath: 'userScope',
                    });
                }

                if (!db.objectStoreNames.contains(STORE_QUERY_CACHE)) {
                    const queryStore = db.createObjectStore(STORE_QUERY_CACHE, {
                        keyPath: 'cacheKey',
                    });
                    queryStore.createIndex('by_user', 'userScope', { unique: false });
                }

                if (!db.objectStoreNames.contains(STORE_MEDIA_OUTBOX)) {
                    const mediaStore = db.createObjectStore(STORE_MEDIA_OUTBOX, {
                        keyPath: 'mediaId',
                    });
                    mediaStore.createIndex('by_user', 'userScope', { unique: false });
                }

                if (!db.objectStoreNames.contains(STORE_SYNC_OUTBOX)) {
                    const outboxStore = db.createObjectStore(STORE_SYNC_OUTBOX, {
                        keyPath: 'mutationId',
                    });
                    outboxStore.createIndex('by_created', 'createdAt', { unique: false });
                }

                if (!db.objectStoreNames.contains(STORE_ID_MAPPINGS)) {
                    db.createObjectStore(STORE_ID_MAPPINGS, { keyPath: 'tempId' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });

    return dbPromise;
}

export function stableSerializeParams(params?: Record<string, any>): string {
    if (!params || typeof params !== 'object') return '';
    const keys = Object.keys(params)
        .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
        .sort();
    if (keys.length === 0) return '';
    return keys
        .map((k) => {
            const v = params[k];
            const valStr = Array.isArray(v)
                ? v.join(',')
                : typeof v === 'object'
                  ? JSON.stringify(v)
                  : String(v);
            return `${k}=${valStr}`;
        })
        .join('&');
}

export function buildHttpCacheKey(
    userScope: string,
    urlPath: string,
    paramsKey: string,
    accountScope: string
): string {
    return `${userScope}::${accountScope || 'all'}::${urlPath}::${paramsKey}`;
}

export async function saveHttpGetCache(
    userScope: string,
    urlPath: string,
    paramsKey: string,
    accountScope: string,
    data: any
): Promise<void> {
    const db = await openOfflineDatabase();
    if (!db) return;

    const encryptedData = await encryptOfflineValue(userScope, data);

    const record: HttpGetCacheRecord = {
        cacheKey: buildHttpCacheKey(userScope, urlPath, paramsKey, accountScope),
        userScope,
        urlPath,
        paramsKey,
        accountScope: accountScope || 'all',
        data: encryptedData,
        updatedAt: Date.now(),
    };

    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(STORE_HTTP_GET_CACHE, 'readwrite');
            tx.objectStore(STORE_HTTP_GET_CACHE).put(record);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch {
            resolve();
        }
    });
}

export async function readHttpGetCache(
    userScope: string,
    urlPath: string,
    paramsKey: string,
    accountScope: string
): Promise<HttpGetCacheRecord | null> {
    const db = await openOfflineDatabase();
    if (!db) return null;

    const cacheKey = buildHttpCacheKey(userScope, urlPath, paramsKey, accountScope);
    const rawRec = await new Promise<HttpGetCacheRecord | null>((resolve) => {
        try {
            const tx = db.transaction(STORE_HTTP_GET_CACHE, 'readonly');
            const req = tx.objectStore(STORE_HTTP_GET_CACHE).get(cacheKey);
            req.onsuccess = () => resolve((req.result as HttpGetCacheRecord) || null);
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
    if (!rawRec) return null;
    const decrypted = await decryptOfflineValue(userScope, rawRec.data);
    if (decrypted === null && rawRec.data !== null) return null;
    return { ...rawRec, data: decrypted };
}

export async function mutateHttpGetCacheByPrefix(
    userScope: string,
    urlPrefix: string,
    mutatorFn: (record: HttpGetCacheRecord) => any
): Promise<void> {
    const db = await openOfflineDatabase();
    if (!db) return;

    const allUserRecords = await new Promise<HttpGetCacheRecord[]>((resolve) => {
        try {
            const tx = db.transaction(STORE_HTTP_GET_CACHE, 'readonly');
            const index = tx.objectStore(STORE_HTTP_GET_CACHE).index('by_user');
            const req = index.getAll(userScope);
            req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
            req.onerror = () => resolve([]);
        } catch {
            resolve([]);
        }
    });

    const matches = allUserRecords.filter((r) => r.urlPath.startsWith(urlPrefix));
    if (matches.length === 0) return;

    const updatedRows: HttpGetCacheRecord[] = [];
    for (const rec of matches) {
        const plainData = await decryptOfflineValue(userScope, rec.data);
        if (plainData === null && rec.data !== null) continue;
        const nextData = mutatorFn({ ...rec, data: plainData });
        if (nextData !== undefined) {
            const encryptedNext = await encryptOfflineValue(userScope, nextData);
            updatedRows.push({
                ...rec,
                data: encryptedNext,
                updatedAt: Date.now(),
            });
        }
    }
    if (updatedRows.length === 0) return;

    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(STORE_HTTP_GET_CACHE, 'readwrite');
            const store = tx.objectStore(STORE_HTTP_GET_CACHE);
            for (const row of updatedRows) {
                store.put(row);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch {
            resolve();
        }
    });
}

export async function pruneStaleHttpCache(
    userScope: string,
    maxEntries: number = MAX_HTTP_CACHE_PER_USER
): Promise<void> {
    const db = await openOfflineDatabase();
    if (!db) return;

    const records = await new Promise<HttpGetCacheRecord[]>((resolve) => {
        try {
            const tx = db.transaction(STORE_HTTP_GET_CACHE, 'readonly');
            const index = tx.objectStore(STORE_HTTP_GET_CACHE).index('by_user');
            const req = index.getAll(userScope);
            req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
            req.onerror = () => resolve([]);
        } catch {
            resolve([]);
        }
    });

    if (records.length <= maxEntries) return;
    const oldestFirst = [...records].sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
    const toRemove = oldestFirst.slice(0, records.length - maxEntries);

    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(STORE_HTTP_GET_CACHE, 'readwrite');
            const store = tx.objectStore(STORE_HTTP_GET_CACHE);
            for (const r of toRemove) {
                store.delete(r.cacheKey);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch {
            resolve();
        }
    });
}

export async function upsertTradesInIDB(
    userScope: string,
    trades: Record<string, any>[]
): Promise<void> {
    if (!Array.isArray(trades) || trades.length === 0) return;
    const db = await openOfflineDatabase();
    if (!db) return;

    const existingList = await listUserTradesFromIDB(userScope);
    const existingById = new Map<string, Record<string, any>>();
    for (const item of existingList) {
        const tid = String(item.id || item.ticket || '');
        if (tid) existingById.set(tid, item);
    }

    const now = Date.now();
    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(STORE_ENTITIES_TRADES, 'readwrite');
            const store = tx.objectStore(STORE_ENTITIES_TRADES);
            for (const raw of trades) {
                if (!raw || typeof raw !== 'object') continue;
                const tradeId = String(raw.id || raw.ticket || '');
                if (!tradeId) continue;
                const prev = existingById.get(tradeId) || {};
                const merged = { ...prev, ...raw };
                const record: StoredTradeEntityRecord = {
                    key: `${userScope}:${tradeId}`,
                    userScope,
                    tradeId,
                    accountId: String(merged.accountId || ''),
                    trade: merged,
                    updatedAt: now,
                };
                store.put(record);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch {
            resolve();
        }
    });
}

export async function getTradeFromIDB(
    userScope: string,
    tradeId: string
): Promise<Record<string, any> | null> {
    const db = await openOfflineDatabase();
    if (!db || !tradeId) return null;

    const direct = await new Promise<StoredTradeEntityRecord | null>((resolve) => {
        try {
            const tx = db.transaction(STORE_ENTITIES_TRADES, 'readonly');
            const req = tx.objectStore(STORE_ENTITIES_TRADES).get(`${userScope}:${tradeId}`);
            req.onsuccess = () => resolve((req.result as StoredTradeEntityRecord) || null);
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });

    if (direct?.trade) return direct.trade;

    const all = await listUserTradesFromIDB(userScope);
    return (
        all.find(
            (t) =>
                String(t.id) === String(tradeId) ||
                String(t.ticket) === String(tradeId) ||
                String(t.contractId) === String(tradeId)
        ) || null
    );
}

export async function listUserTradesFromIDB(userScope: string): Promise<Record<string, any>[]> {
    const db = await openOfflineDatabase();
    if (!db) return [];

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_ENTITIES_TRADES, 'readonly');
            const index = tx.objectStore(STORE_ENTITIES_TRADES).index('by_user');
            const req = index.getAll(userScope);
            req.onsuccess = () => {
                const rows = Array.isArray(req.result) ? (req.result as StoredTradeEntityRecord[]) : [];
                resolve(rows.map((r) => r.trade).filter(Boolean));
            };
            req.onerror = () => resolve([]);
        } catch {
            resolve([]);
        }
    });
}

export async function patchTradeInIDB(
    userScope: string,
    tradeId: string,
    patch: Record<string, any>
): Promise<void> {
    const db = await openOfflineDatabase();
    if (!db || !tradeId) return;

    const existing = await getTradeFromIDB(userScope, tradeId);
    const resolvedId = String(existing?.id || tradeId);
    const merged = { ...(existing || { id: resolvedId }), ...patch };

    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(STORE_ENTITIES_TRADES, 'readwrite');
            const record: StoredTradeEntityRecord = {
                key: `${userScope}:${resolvedId}`,
                userScope,
                tradeId: resolvedId,
                accountId: String(merged.accountId || ''),
                trade: merged,
                updatedAt: Date.now(),
            };
            tx.objectStore(STORE_ENTITIES_TRADES).put(record);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch {
            resolve();
        }
    });
}

export async function saveMediaOutboxItem(item: MediaOutboxItem): Promise<void> {
    const tier = getStoredUserPlanTier();
    const isReplayMedia = Boolean(item.targetEndpoint?.includes('/backtest/'));
    const allowed = isReplayMedia ? canUseReplayOfflineMode(tier) : canUseGeneralOfflineMode(tier);
    if (!allowed) {
        openWorkspacePlansModal(isReplayMedia ? 'offline_replay_premium_only' : 'offline_mode_pro_only');
        throw new Error(
            isReplayMedia
                ? 'Modo Offline no Trade Replay disponível apenas no Plano Premium.'
                : 'Modo Offline disponível a partir do Plano Pro.',
        );
    }

    const db = await openOfflineDatabase();
    if (!db) return;

    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(STORE_MEDIA_OUTBOX, 'readwrite');
            tx.objectStore(STORE_MEDIA_OUTBOX).put(item);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch {
            resolve();
        }
    });
}

export async function listPendingMediaOutbox(userScope?: string): Promise<MediaOutboxItem[]> {
    const db = await openOfflineDatabase();
    if (!db) return [];

    const all = await listAllMediaOutbox(userScope);
    return all.filter((m) => !m.uploadedUrl);
}

export async function listAllMediaOutbox(userScope?: string): Promise<MediaOutboxItem[]> {
    const db = await openOfflineDatabase();
    if (!db) return [];

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_MEDIA_OUTBOX, 'readonly');
            const store = tx.objectStore(STORE_MEDIA_OUTBOX);
            const req = userScope ? store.index('by_user').getAll(userScope) : store.getAll();
            req.onsuccess = () => {
                const items = Array.isArray(req.result) ? (req.result as MediaOutboxItem[]) : [];
                items.sort((a, b) => a.createdAt - b.createdAt);
                resolve(items);
            };
            req.onerror = () => resolve([]);
        } catch {
            resolve([]);
        }
    });
}

export async function markMediaOutboxUploaded(mediaId: string, uploadedUrl: string): Promise<void> {
    const db = await openOfflineDatabase();
    if (!db) return;

    const existing = await new Promise<MediaOutboxItem | null>((resolve) => {
        try {
            const tx = db.transaction(STORE_MEDIA_OUTBOX, 'readonly');
            const req = tx.objectStore(STORE_MEDIA_OUTBOX).get(mediaId);
            req.onsuccess = () => resolve((req.result as MediaOutboxItem) || null);
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });

    if (!existing) return;

    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(STORE_MEDIA_OUTBOX, 'readwrite');
            tx.objectStore(STORE_MEDIA_OUTBOX).put({ ...existing, uploadedUrl });
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch {
            resolve();
        }
    });
}

export async function deleteMediaOutboxItem(mediaId: string): Promise<void> {
    const db = await openOfflineDatabase();
    if (!db) return;

    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(STORE_MEDIA_OUTBOX, 'readwrite');
            tx.objectStore(STORE_MEDIA_OUTBOX).delete(mediaId);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch {
            resolve();
        }
    });
}

export async function listSyncOutbox(userScope?: string): Promise<SyncOutboxItem[]> {
    const db = await openOfflineDatabase();
    if (!db) return [];

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_SYNC_OUTBOX, 'readonly');
            const req = tx.objectStore(STORE_SYNC_OUTBOX).index('by_created').getAll();
            req.onsuccess = () => {
                const rows = Array.isArray(req.result) ? (req.result as SyncOutboxItem[]) : [];
                const filtered = userScope ? rows.filter((r) => r.userScope === userScope) : rows;
                filtered.sort((a, b) => a.createdAt - b.createdAt);
                resolve(filtered);
            };
            req.onerror = () => resolve([]);
        } catch {
            resolve([]);
        }
    });
}

export async function updateSyncOutboxItem(item: SyncOutboxItem): Promise<void> {
    const db = await openOfflineDatabase();
    if (!db) return;

    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(STORE_SYNC_OUTBOX, 'readwrite');
            tx.objectStore(STORE_SYNC_OUTBOX).put(item);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch {
            resolve();
        }
    });
}

export async function removeSyncOutboxItem(mutationId: string): Promise<void> {
    const db = await openOfflineDatabase();
    if (!db) return;

    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(STORE_SYNC_OUTBOX, 'readwrite');
            tx.objectStore(STORE_SYNC_OUTBOX).delete(mutationId);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch {
            resolve();
        }
    });
}

export interface EnqueueMutationInput {
    userScope?: string;
    entityType: SyncEntityType;
    coalesceKey?: string;
    tempEntityId?: string;
    method: SyncMutationMethod;
    url: string;
    params?: Record<string, any>;
    body?: any;
    accountHeader?: string;
    clientUpdatedAt?: string;
}

export async function enqueueSyncMutation(input: EnqueueMutationInput): Promise<SyncOutboxItem> {
    const tier = getStoredUserPlanTier();
    const isReplayMut = Boolean(input.url?.includes('/backtest/')) || input.entityType === 'backtest_session';
    const allowed = isReplayMut ? canUseReplayOfflineMode(tier) : canUseGeneralOfflineMode(tier);
    if (!allowed) {
        openWorkspacePlansModal(isReplayMut ? 'offline_replay_premium_only' : 'offline_mode_pro_only');
        throw new Error(
            isReplayMut
                ? 'Modo Offline no Trade Replay disponível apenas no Plano Premium.'
                : 'Modo Offline disponível a partir do Plano Pro.',
        );
    }

    const userScope = input.userScope || getCurrentUserScope();
    const now = Date.now();
    const clientUpdatedAt = input.clientUpdatedAt || new Date(now).toISOString();
    const effectiveAccountHeader =
        input.accountHeader ??
        (input.params?.accountId && input.params.accountId !== 'all'
            ? String(input.params.accountId)
            : undefined) ??
        (() => {
            try {
                const sel =
                    typeof localStorage !== 'undefined'
                        ? localStorage.getItem('torex_selected_account_id')
                        : null;
                return sel && sel !== 'all' ? sel : undefined;
            } catch {
                return undefined;
            }
        })();
    const existingQueue = await listSyncOutbox(userScope);

    // 1. Handle DELETE of an unsynced tempEntityId created offline
    if (input.method === 'DELETE' && input.tempEntityId) {
        const pendingCreates = existingQueue.filter(
            (q) => q.status === 'pending' && q.tempEntityId === input.tempEntityId
        );
        if (pendingCreates.length > 0) {
            for (const item of pendingCreates) {
                await removeSyncOutboxItem(item.mutationId);
            }
            return {
                mutationId: generateMutationId(),
                userScope,
                entityType: input.entityType,
                tempEntityId: input.tempEntityId,
                method: 'DELETE',
                url: input.url,
                params: input.params,
                body: input.body,
                accountHeader: effectiveAccountHeader,
                clientUpdatedAt,
                createdAt: now,
                attempts: 0,
                status: 'pending',
            };
        }
    }

    // 2. Handle PUT / PATCH targeting an unsynced tempEntityId -> fold into the pending POST
    if ((input.method === 'PUT' || input.method === 'PATCH') && input.tempEntityId) {
        const pendingPost = existingQueue.find(
            (q) =>
                q.status === 'pending' &&
                q.method === 'POST' &&
                q.tempEntityId === input.tempEntityId
        );
        if (pendingPost) {
            const mergedBody =
                pendingPost.body && typeof pendingPost.body === 'object' && input.body && typeof input.body === 'object'
                    ? { ...pendingPost.body, ...input.body }
                    : input.body ?? pendingPost.body;
            const updatedPost: SyncOutboxItem = {
                ...pendingPost,
                body: mergedBody,
                clientUpdatedAt,
                lastError: undefined,
            };
            await updateSyncOutboxItem(updatedPost);
            return updatedPost;
        }
    }

    // 3. Coalesce repeated PUT / PATCH operations on the same coalesceKey
    if ((input.method === 'PUT' || input.method === 'PATCH') && input.coalesceKey) {
        const existingPending = existingQueue.find(
            (q) =>
                q.status === 'pending' &&
                q.method === input.method &&
                q.coalesceKey === input.coalesceKey
        );
        if (existingPending) {
            const nextBody =
                input.method === 'PATCH' &&
                existingPending.body &&
                typeof existingPending.body === 'object' &&
                input.body &&
                typeof input.body === 'object'
                    ? { ...existingPending.body, ...input.body }
                    : input.body;

            const coalesced: SyncOutboxItem = {
                ...existingPending,
                mutationId: generateMutationId(),
                url: input.url,
                params: input.params ?? existingPending.params,
                body: nextBody,
                accountHeader: effectiveAccountHeader ?? existingPending.accountHeader,
                clientUpdatedAt,
                lastError: undefined,
            };
            // Replace old key so new mutationId is stored cleanly
            await removeSyncOutboxItem(existingPending.mutationId);
            await updateSyncOutboxItem(coalesced);
            return coalesced;
        }
    }

    const newItem: SyncOutboxItem = {
        mutationId: generateMutationId(),
        userScope,
        entityType: input.entityType,
        coalesceKey: input.coalesceKey,
        tempEntityId: input.tempEntityId,
        method: input.method,
        url: input.url,
        params: input.params,
        body: input.body,
        accountHeader: effectiveAccountHeader,
        clientUpdatedAt,
        createdAt: now,
        attempts: 0,
        status: 'pending',
    };

    await updateSyncOutboxItem(newItem);
    return newItem;
}

export async function saveIdMapping(
    tempId: string,
    serverId: string,
    entityType: string
): Promise<void> {
    if (!tempId || !serverId || tempId === serverId) return;
    const db = await openOfflineDatabase();
    if (!db) return;

    const record: IdMappingRecord = {
        tempId,
        serverId,
        entityType,
        createdAt: Date.now(),
    };

    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(STORE_ID_MAPPINGS, 'readwrite');
            tx.objectStore(STORE_ID_MAPPINGS).put(record);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch {
            resolve();
        }
    });
}

export async function resolveServerId(id: string): Promise<string> {
    if (!id) return id;
    const db = await openOfflineDatabase();
    if (!db) return id;

    const rec = await new Promise<IdMappingRecord | null>((resolve) => {
        try {
            const tx = db.transaction(STORE_ID_MAPPINGS, 'readonly');
            const req = tx.objectStore(STORE_ID_MAPPINGS).get(id);
            req.onsuccess = () => resolve((req.result as IdMappingRecord) || null);
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });

    return rec?.serverId || id;
}

export async function getAllIdMappings(): Promise<Record<string, string>> {
    const db = await openOfflineDatabase();
    if (!db) return {};

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_ID_MAPPINGS, 'readonly');
            const req = tx.objectStore(STORE_ID_MAPPINGS).getAll();
            req.onsuccess = () => {
                const rows = Array.isArray(req.result) ? (req.result as IdMappingRecord[]) : [];
                const map: Record<string, string> = {};
                for (const r of rows) {
                    if (r.tempId && r.serverId) {
                        map[r.tempId] = r.serverId;
                    }
                }
                resolve(map);
            };
            req.onerror = () => resolve({});
        } catch {
            resolve({});
        }
    });
}

export async function savePersistedQuery(
    userScope: string,
    queryKey: any[],
    data: any,
    dataUpdatedAt: number
): Promise<void> {
    const db = await openOfflineDatabase();
    if (!db) return;

    let serializedKey = '';
    try {
        serializedKey = JSON.stringify(queryKey);
    } catch {
        return;
    }

    const record: PersistedQueryRecord = {
        cacheKey: `${userScope}::${serializedKey}`,
        userScope,
        queryKey,
        data,
        dataUpdatedAt,
    };

    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(STORE_QUERY_CACHE, 'readwrite');
            tx.objectStore(STORE_QUERY_CACHE).put(record);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch {
            resolve();
        }
    });

    // Periodically cap persisted query count
    const allUserQueries = await loadPersistedQueries(userScope);
    if (allUserQueries.length > MAX_QUERY_CACHE_PER_USER) {
        const sortedOldest = [...allUserQueries].sort(
            (a, b) => (a.dataUpdatedAt || 0) - (b.dataUpdatedAt || 0)
        );
        const toDelete = sortedOldest.slice(0, allUserQueries.length - MAX_QUERY_CACHE_PER_USER);
        await new Promise<void>((resolve) => {
            try {
                const tx = db.transaction(STORE_QUERY_CACHE, 'readwrite');
                const store = tx.objectStore(STORE_QUERY_CACHE);
                for (const q of toDelete) {
                    store.delete(q.cacheKey);
                }
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            } catch {
                resolve();
            }
        });
    }
}

export async function loadPersistedQueries(userScope: string): Promise<PersistedQueryRecord[]> {
    const db = await openOfflineDatabase();
    if (!db) return [];

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_QUERY_CACHE, 'readonly');
            const req = tx.objectStore(STORE_QUERY_CACHE).index('by_user').getAll(userScope);
            req.onsuccess = () =>
                resolve(Array.isArray(req.result) ? (req.result as PersistedQueryRecord[]) : []);
            req.onerror = () => resolve([]);
        } catch {
            resolve([]);
        }
    });
}


// ---------------------------------------------------------------------------
// Structured Entity Stores (Accounts, Transactions, Journal, User Profile)
// ---------------------------------------------------------------------------

export async function listUserAccountsFromIDB(
    userScope: string
): Promise<Record<string, any>[]> {
    const db = await openOfflineDatabase();
    if (!db) return [];

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_ENTITIES_ACCOUNTS, 'readonly');
            const req = tx
                .objectStore(STORE_ENTITIES_ACCOUNTS)
                .index('by_user')
                .getAll(userScope);
            req.onsuccess = () => {
                const rows = Array.isArray(req.result)
                    ? (req.result as StoredAccountEntityRecord[])
                    : [];
                const items = rows.map((r) => r.account).filter(Boolean);
                items.sort((a, b) => {
                    if (Boolean(a.isPrimary) !== Boolean(b.isPrimary)) {
                        return a.isPrimary ? -1 : 1;
                    }
                    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
                });
                resolve(items);
            };
            req.onerror = () => resolve([]);
        } catch {
            resolve([]);
        }
    });
}

export async function upsertAccountsInIDB(
    userScope: string,
    accounts: Record<string, any>[]
): Promise<void> {
    if (!Array.isArray(accounts) || accounts.length === 0) return;
    const db = await openOfflineDatabase();
    if (!db) return;

    const existingList = await listUserAccountsFromIDB(userScope);
    const existingById = new Map<string, Record<string, any>>();
    for (const acc of existingList) {
        if (acc?.id) existingById.set(String(acc.id), acc);
    }

    const now = Date.now();
    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(STORE_ENTITIES_ACCOUNTS, 'readwrite');
            const store = tx.objectStore(STORE_ENTITIES_ACCOUNTS);
            for (const raw of accounts) {
                if (!raw || !raw.id) continue;
                const accountId = String(raw.id);
                const merged = { ...(existingById.get(accountId) || {}), ...raw };
                const record: StoredAccountEntityRecord = {
                    key: `${userScope}:${accountId}`,
                    userScope,
                    accountId,
                    account: merged,
                    updatedAt: now,
                };
                store.put(record);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch {
            resolve();
        }
    });
}

export async function replaceUserAccountsInIDB(
    userScope: string,
    accounts: Record<string, any>[]
): Promise<void> {
    const db = await openOfflineDatabase();
    if (!db || !Array.isArray(accounts)) return;

    const [existingRecords, outbox] = await Promise.all([
        new Promise<StoredAccountEntityRecord[]>((resolve) => {
            try {
                const tx = db.transaction(STORE_ENTITIES_ACCOUNTS, 'readonly');
                const req = tx
                    .objectStore(STORE_ENTITIES_ACCOUNTS)
                    .index('by_user')
                    .getAll(userScope);
                req.onsuccess = () =>
                    resolve(Array.isArray(req.result) ? req.result : []);
                req.onerror = () => resolve([]);
            } catch {
                resolve([]);
            }
        }),
        listSyncOutbox(userScope),
    ]);

    const pendingTempAccountIds = new Set(
        outbox
            .filter(
                (q) =>
                    q.status === 'pending' &&
                    q.entityType === 'account' &&
                    Boolean(q.tempEntityId)
            )
            .map((q) => String(q.tempEntityId))
    );

    const incomingIds = new Set(
        accounts.filter((a) => a?.id).map((a) => String(a.id))
    );

    const now = Date.now();
    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(STORE_ENTITIES_ACCOUNTS, 'readwrite');
            const store = tx.objectStore(STORE_ENTITIES_ACCOUNTS);

            for (const rec of existingRecords) {
                const isPendingTemp = pendingTempAccountIds.has(rec.accountId);
                if (!isPendingTemp && !incomingIds.has(rec.accountId)) {
                    store.delete(rec.key);
                }
            }

            for (const raw of accounts) {
                if (!raw || !raw.id) continue;
                const accountId = String(raw.id);
                const record: StoredAccountEntityRecord = {
                    key: `${userScope}:${accountId}`,
                    userScope,
                    accountId,
                    account: raw,
                    updatedAt: now,
                };
                store.put(record);
            }

            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch {
            resolve();
        }
    });
}

export async function patchAccountInIDB(
    userScope: string,
    accountId: string,
    patch: Record<string, any>
): Promise<void> {
    const db = await openOfflineDatabase();
    if (!db || !accountId) return;

    const key = `${userScope}:${accountId}`;
    const existing = await new Promise<StoredAccountEntityRecord | null>((resolve) => {
        try {
            const tx = db.transaction(STORE_ENTITIES_ACCOUNTS, 'readonly');
            const req = tx.objectStore(STORE_ENTITIES_ACCOUNTS).get(key);
            req.onsuccess = () =>
                resolve((req.result as StoredAccountEntityRecord) || null);
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });

    if (!existing?.account) return;

    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(STORE_ENTITIES_ACCOUNTS, 'readwrite');
            tx.objectStore(STORE_ENTITIES_ACCOUNTS).put({
                ...existing,
                account: { ...existing.account, ...patch },
                updatedAt: Date.now(),
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch {
            resolve();
        }
    });
}

export async function removeAccountFromIDB(
    userScope: string,
    accountId: string
): Promise<void> {
    const db = await openOfflineDatabase();
    if (!db || !accountId) return;

    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(STORE_ENTITIES_ACCOUNTS, 'readwrite');
            tx.objectStore(STORE_ENTITIES_ACCOUNTS).delete(`${userScope}:${accountId}`);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch {
            resolve();
        }
    });
}

export async function upsertTransactionsInIDB(
    userScope: string,
    accountId: string,
    transactions: Record<string, any>[]
): Promise<void> {
    if (!Array.isArray(transactions) || transactions.length === 0 || !accountId) return;
    const db = await openOfflineDatabase();
    if (!db) return;

    const now = Date.now();
    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(STORE_ENTITIES_TRANSACTIONS, 'readwrite');
            const store = tx.objectStore(STORE_ENTITIES_TRANSACTIONS);
            for (const raw of transactions) {
                if (!raw || !raw.id) continue;
                const txId = String(raw.id);
                const resolvedAccountId = String(raw.accountId || accountId);
                const record: StoredTransactionEntityRecord = {
                    key: `${userScope}:${txId}`,
                    userScope,
                    accountScopeKey: `${userScope}:${resolvedAccountId}`,
                    accountId: resolvedAccountId,
                    txId,
                    transaction: { ...raw, accountId: resolvedAccountId },
                    updatedAt: now,
                };
                store.put(record);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch {
            resolve();
        }
    });
}

export async function listAccountTransactionsFromIDB(
    userScope: string,
    accountId: string
): Promise<Record<string, any>[]> {
    const db = await openOfflineDatabase();
    if (!db || !accountId) return [];

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_ENTITIES_TRANSACTIONS, 'readonly');
            const req = tx
                .objectStore(STORE_ENTITIES_TRANSACTIONS)
                .index('by_account')
                .getAll(`${userScope}:${accountId}`);
            req.onsuccess = () => {
                const rows = Array.isArray(req.result)
                    ? (req.result as StoredTransactionEntityRecord[])
                    : [];
                const items = rows.map((r) => r.transaction).filter(Boolean);
                items.sort((a, b) => {
                    const ta = new Date(a.date || a.createdAt || 0).getTime();
                    const tb = new Date(b.date || b.createdAt || 0).getTime();
                    return tb - ta;
                });
                resolve(items);
            };
            req.onerror = () => resolve([]);
        } catch {
            resolve([]);
        }
    });
}

export async function upsertJournalEntityInIDB(
    userScope: string,
    kind: JournalEntityKind,
    entityKey: string,
    data: Record<string, any>,
    accountId: string = 'all'
): Promise<void> {
    const db = await openOfflineDatabase();
    if (!db || !entityKey) return;

    const record: StoredJournalEntityRecord = {
        key: `${userScope}:${kind}:${entityKey}`,
        userScope,
        kind,
        kindUserKey: `${userScope}:${kind}`,
        entityKey,
        accountId: accountId || 'all',
        data,
        updatedAt: Date.now(),
    };

    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(STORE_ENTITIES_JOURNAL, 'readwrite');
            tx.objectStore(STORE_ENTITIES_JOURNAL).put(record);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch {
            resolve();
        }
    });
}

export async function removeJournalEntityFromIDB(
    userScope: string,
    kind: JournalEntityKind,
    entityKey: string
): Promise<void> {
    const db = await openOfflineDatabase();
    if (!db || !entityKey) return;

    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(STORE_ENTITIES_JOURNAL, 'readwrite');
            tx.objectStore(STORE_ENTITIES_JOURNAL).delete(
                `${userScope}:${kind}:${entityKey}`
            );
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch {
            resolve();
        }
    });
}

export async function listJournalEntitiesFromIDB(
    userScope: string,
    kind: JournalEntityKind
): Promise<
    Array<{
        key: string;
        entityKey: string;
        accountId: string;
        data: Record<string, any>;
        updatedAt: number;
    }>
> {
    const db = await openOfflineDatabase();
    if (!db) return [];

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_ENTITIES_JOURNAL, 'readonly');
            const req = tx
                .objectStore(STORE_ENTITIES_JOURNAL)
                .index('by_kind_user')
                .getAll(`${userScope}:${kind}`);
            req.onsuccess = () => {
                const rows = Array.isArray(req.result)
                    ? (req.result as StoredJournalEntityRecord[])
                    : [];
                resolve(
                    rows.map((r) => ({
                        key: r.key,
                        entityKey: r.entityKey,
                        accountId: r.accountId || 'all',
                        data: r.data,
                        updatedAt: r.updatedAt,
                    }))
                );
            };
            req.onerror = () => resolve([]);
        } catch {
            resolve([]);
        }
    });
}

export async function saveUserProfileInIDB(
    userScope: string,
    profile: Record<string, any>
): Promise<void> {
    const db = await openOfflineDatabase();
    if (!db || !userScope || userScope === 'anon' || !profile) return;

    const existing = await getUserProfileFromIDB(userScope);
    const mergedProfile = { ...(existing || {}), ...profile };
    const encryptedProfile = await encryptOfflineValue(userScope, mergedProfile);
    const record: StoredUserProfileRecord = {
        userScope,
        profile: encryptedProfile,
        updatedAt: Date.now(),
    };

    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(STORE_ENTITIES_USER_PROFILE, 'readwrite');
            tx.objectStore(STORE_ENTITIES_USER_PROFILE).put(record);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch {
            resolve();
        }
    });
}

export async function getUserProfileFromIDB(
    userScope: string
): Promise<Record<string, any> | null> {
    const db = await openOfflineDatabase();
    if (!db || !userScope || userScope === 'anon') return null;

    const rawRec = await new Promise<StoredUserProfileRecord | null>((resolve) => {
        try {
            const tx = db.transaction(STORE_ENTITIES_USER_PROFILE, 'readonly');
            const req = tx
                .objectStore(STORE_ENTITIES_USER_PROFILE)
                .get(userScope);
            req.onsuccess = () => {
                resolve((req.result as StoredUserProfileRecord) || null);
            };
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
    if (!rawRec?.profile) return null;
    return decryptOfflineValue<Record<string, any>>(userScope, rawRec.profile);
}

/**
 * Atomically wipes all local offline IndexedDB data, encryption session keys,
 * and runtime Service Worker API caches on logout or account switch.
 */
export async function wipeAllOfflineData(): Promise<void> {
    clearOfflineSessionKey();
    try {
        if (dbPromise) {
            const db = await dbPromise.catch(() => null);
            db?.close();
            dbPromise = null;
        }
        if (typeof window !== 'undefined' && 'indexedDB' in window) {
            await new Promise<void>((resolve) => {
                try {
                    const req = window.indexedDB.deleteDatabase(DB_NAME);
                    req.onsuccess = () => resolve();
                    req.onerror = () => resolve();
                    req.onblocked = () => resolve();
                } catch {
                    resolve();
                }
            });
        }
        if (typeof caches !== 'undefined' && typeof caches.keys === 'function') {
            const keys = await caches.keys();
            await Promise.all(
                keys
                    .filter((k) => k.includes('torex') || k.includes('api') || k.includes('uploads'))
                    .map((k) => caches.delete(k).catch(() => false)),
            );
        }
    } catch {
        // Ignore cleanup failures
    }
}
