import { QueryClient } from '@tanstack/react-query';
import api from '../api';
import { flushPendingSessionSyncQueue, getPendingSyncOutboxCount } from './historicalBatchCache';
import {
    deleteMediaOutboxItem,
    getAllIdMappings,
    getCurrentUserScope,
    listAllMediaOutbox,
    listPendingMediaOutbox,
    listSyncOutbox,
    loadPersistedQueries,
    markMediaOutboxUploaded,
    pruneStaleHttpCache,
    removeAccountFromIDB,
    removeJournalEntityFromIDB,
    removeSyncOutboxItem,
    saveIdMapping,
    savePersistedQuery,
    updateSyncOutboxItem,
    upsertAccountsInIDB,
    upsertJournalEntityInIDB,
} from './offlineDb';
import {
    registerSyncTriggerHandler,
    useOfflineSyncStore,
} from '../store/useOfflineSyncStore';

const MAX_PERSISTED_QUERY_AGE_MS = 7 * 24 * 60 * 60_000;
const SKIP_QUERY_PERSIST_PREFIXES = new Set(['health', 'admin', 'ai-job']);

let initialized = false;
let registeredQueryClient: QueryClient | null = null;
let flushPromise: Promise<void> | null = null;
let retryTimer: number | null = null;
let bannerTimer: number | null = null;

export function isNetworkError(error: any): boolean {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return true;
    }
    if (!error) return false;
    if (error.response) return false;
    const code = String(error.code || '');
    const msg = String(error.message || '');
    return (
        code === 'ERR_NETWORK' ||
        code === 'ECONNABORTED' ||
        code === 'ETIMEDOUT' ||
        msg.includes('Network Error') ||
        msg.includes('Failed to fetch') ||
        msg.includes('network')
    );
}

function replaceStringTokens(
    input: string,
    idMap: Record<string, string>,
    mediaMap: Map<string, string>
): string {
    let out = input;
    for (const [tempId, serverId] of Object.entries(idMap)) {
        if (tempId && serverId && out.includes(tempId)) {
            out = out.split(tempId).join(serverId);
        }
    }
    for (const [previewUrl, uploadedUrl] of mediaMap.entries()) {
        if (previewUrl && uploadedUrl && out.includes(previewUrl)) {
            out = out.split(previewUrl).join(uploadedUrl);
        }
    }
    return out;
}

function replaceDeepTokens(
    value: any,
    idMap: Record<string, string>,
    mediaMap: Map<string, string>
): any {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') {
        return replaceStringTokens(value, idMap, mediaMap);
    }
    if (Array.isArray(value)) {
        return value.map((item) => replaceDeepTokens(item, idMap, mediaMap));
    }
    if (typeof value === 'object') {
        const next: Record<string, any> = {};
        for (const [k, v] of Object.entries(value)) {
            next[k] = replaceDeepTokens(v, idMap, mediaMap);
        }
        return next;
    }
    return value;
}

function scheduleRetry(attempts: number) {
    if (typeof window === 'undefined') return;
    if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
    }
    const delayMs = Math.min(30_000, 1500 * Math.pow(2, Math.min(attempts, 5)));
    retryTimer = window.setTimeout(() => {
        retryTimer = null;
        if (typeof navigator === 'undefined' || navigator.onLine) {
            void flushAllOfflineQueues();
        }
    }, delayMs);
}

function extractReadableError(err: any): string {
    const rawMsg = err?.response?.data?.message;
    if (Array.isArray(rawMsg)) return rawMsg.join('; ');
    if (typeof rawMsg === 'string' && rawMsg.trim()) return rawMsg;
    if (typeof err?.response?.data?.error === 'string') return err.response.data.error;
    return String(err?.message || 'Falha ao sincronizar');
}

export async function flushAllOfflineQueues(): Promise<void> {
    if (flushPromise) return flushPromise;

    flushPromise = (async () => {
        const store = useOfflineSyncStore.getState();
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) {
            await store.refreshCounts();
            return;
        }

        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            store.setOnlineStatus(false);
            await store.refreshCounts();
            return;
        }

        const userScope = getCurrentUserScope();
        let syncedCount = 0;
        let authPaused = false;
        let networkBlocked = false;

        store.setSyncState({ isSyncing: true, syncStatus: 'syncing' });

        try {
            // 1. Upload pending media blobs first so mutation payloads can reference final /uploads/... URLs
            const [pendingMedia, allMedia] = await Promise.all([
                listPendingMediaOutbox(userScope),
                listAllMediaOutbox(userScope),
            ]);

            const mediaMap = new Map<string, string>();
            for (const m of allMedia) {
                if (m.uploadedUrl && m.previewDataUrl) {
                    mediaMap.set(m.previewDataUrl, m.uploadedUrl);
                }
            }

            for (const media of pendingMedia) {
                try {
                    const formData = new FormData();
                    if (media.extraFields) {
                        for (const [fieldKey, fieldVal] of Object.entries(media.extraFields)) {
                            if (fieldVal !== undefined && fieldVal !== null) {
                                formData.append(fieldKey, fieldVal);
                            }
                        }
                    }
                    formData.append('file', media.blob, media.fileName || 'screenshot.png');

                    const uploadRes = await api.post(media.targetEndpoint, formData, {
                        headers: { 'Content-Type': 'multipart/form-data' },
                        _isSyncEngineRequest: true,
                    } as any);

                    const uploadedUrl = uploadRes?.data?.url;
                    if (typeof uploadedUrl === 'string' && uploadedUrl.length > 0) {
                        await markMediaOutboxUploaded(media.mediaId, uploadedUrl);
                        mediaMap.set(media.previewDataUrl, uploadedUrl);
                        syncedCount += 1;
                    }
                } catch (err: any) {
                    const status = err?.response?.status;
                    if (status === 401) {
                        authPaused = true;
                        break;
                    }
                    if (isNetworkError(err)) {
                        networkBlocked = true;
                        store.setOnlineStatus(false);
                        scheduleRetry(1);
                        break;
                    }
                    // Permanent 4xx media rejection: remove broken upload to avoid blocking other items
                    await deleteMediaOutboxItem(media.mediaId);
                }
            }

            // 2. Drain JSON mutations strictly in FIFO order
            if (!authPaused && !networkBlocked) {
                const queue = await listSyncOutbox(userScope);
                const pendingItems = queue.filter((q) => q.status === 'pending');
                const idMap = await getAllIdMappings();

                for (const item of pendingItems) {
                    const resolvedUrl = replaceStringTokens(item.url, idMap, mediaMap);
                    const resolvedParams = item.params
                        ? replaceDeepTokens(item.params, idMap, mediaMap)
                        : undefined;
                    const resolvedBody =
                        item.body !== undefined
                            ? replaceDeepTokens(item.body, idMap, mediaMap)
                            : undefined;
                    const resolvedAccountHeader = item.accountHeader
                        ? idMap[item.accountHeader] || item.accountHeader
                        : undefined;

                    try {
                        const headers: Record<string, string> = {
                            'X-Idempotency-Key': item.mutationId,
                            'X-Client-Updated-At': item.clientUpdatedAt,
                            'X-Sync-Replay': '1',
                        };
                        if (resolvedAccountHeader) {
                            headers['x-account-id'] = resolvedAccountHeader;
                        }

                        const res = await api.request({
                            method: item.method,
                            url: resolvedUrl,
                            params: resolvedParams,
                            data: resolvedBody,
                            headers,
                            _isSyncEngineRequest: true,
                        } as any);

                        if (item.tempEntityId && res?.data?.id) {
                            const serverId = String(res.data.id);
                            await saveIdMapping(item.tempEntityId, serverId, item.entityType);
                            idMap[item.tempEntityId] = serverId;
                            if (item.entityType === 'account') {
                                await removeAccountFromIDB(userScope, item.tempEntityId);
                                await upsertAccountsInIDB(userScope, [res.data]);
                            } else if (
                                item.entityType === 'journal_general' ||
                                item.entityType === 'journal_template'
                            ) {
                                await removeJournalEntityFromIDB(
                                    userScope,
                                    'general',
                                    item.tempEntityId
                                );
                                await upsertJournalEntityInIDB(
                                    userScope,
                                    'general',
                                    serverId,
                                    res.data,
                                    'all'
                                );
                            }
                            try {
                                if (
                                    localStorage.getItem('torex_selected_account_id') ===
                                    item.tempEntityId
                                ) {
                                    localStorage.setItem('torex_selected_account_id', serverId);
                                }
                            } catch {
                                // Ignore storage errors
                            }
                        }

                        await removeSyncOutboxItem(item.mutationId);
                        syncedCount += 1;
                    } catch (err: any) {
                        const status = err?.response?.status;

                        if (item.method === 'DELETE' && status === 404) {
                            await removeSyncOutboxItem(item.mutationId);
                            syncedCount += 1;
                            continue;
                        }

                        if (status === 401) {
                            authPaused = true;
                            break;
                        }

                        if (
                            status &&
                            (status === 400 || status === 403 || status === 404 || status === 422)
                        ) {
                            await updateSyncOutboxItem({
                                ...item,
                                status: 'failed_permanent',
                                attempts: item.attempts + 1,
                                lastError: extractReadableError(err),
                            });
                            continue;
                        }

                        // Network failure, 429, or 5xx -> retry with exponential backoff keeping FIFO order
                        const nextAttempts = item.attempts + 1;
                        await updateSyncOutboxItem({
                            ...item,
                            status: 'pending',
                            attempts: nextAttempts,
                            lastError: extractReadableError(err),
                        });
                        if (isNetworkError(err)) {
                            networkBlocked = true;
                            store.setOnlineStatus(false);
                        }
                        scheduleRetry(nextAttempts);
                        break;
                    }
                }
            }

            // 3. Flush Backtesting replay session outbox as well
            if (!authPaused && !networkBlocked) {
                try {
                    const beforeBt = await getPendingSyncOutboxCount();
                    const afterBt = await flushPendingSessionSyncQueue();
                    if (beforeBt > afterBt) {
                        syncedCount += beforeBt - afterBt;
                    }
                } catch {
                    // Backtest queue stays persisted in IDB until next online cycle
                }
            }

            // 4. Clean up uploaded media items no longer referenced by any pending mutation
            if (!authPaused && !networkBlocked) {
                const [remainingQueue, currentAllMedia] = await Promise.all([
                    listSyncOutbox(userScope),
                    listAllMediaOutbox(userScope),
                ]);
                const serializedRemaining = JSON.stringify(remainingQueue);
                for (const m of currentAllMedia) {
                    if (m.uploadedUrl && !serializedRemaining.includes(m.previewDataUrl)) {
                        await deleteMediaOutboxItem(m.mediaId);
                    }
                }
            }
        } finally {
            store.setSyncState({ isSyncing: false });
            await store.refreshCounts();
            const refreshed = useOfflineSyncStore.getState();

            if (authPaused) {
                store.setSyncState({ syncStatus: 'paused_auth' });
            } else if (!refreshed.isOnline) {
                store.setSyncState({ syncStatus: 'offline' });
            } else if (refreshed.failedMutations.length > 0) {
                store.setSyncState({ syncStatus: 'has_errors' });
            } else {
                store.setSyncState({ syncStatus: 'idle' });
            }

            if (syncedCount > 0) {
                const now = Date.now();
                store.setSyncState({
                    lastSyncedAt: now,
                    justSyncedBannerUntil: now + 3500,
                });
                if (typeof window !== 'undefined') {
                    if (bannerTimer !== null) {
                        window.clearTimeout(bannerTimer);
                    }
                    bannerTimer = window.setTimeout(() => {
                        bannerTimer = null;
                        useOfflineSyncStore
                            .getState()
                            .setSyncState({ justSyncedBannerUntil: null });
                    }, 3600);

                    window.dispatchEvent(
                        new CustomEvent('torex:offline-sync-completed', {
                            detail: { syncedCount },
                        })
                    );
                }

                if (registeredQueryClient) {
                    void registeredQueryClient.invalidateQueries({ queryKey: ['dashboard'] });
                    void registeredQueryClient.invalidateQueries({ queryKey: ['trades'] });
                    void registeredQueryClient.invalidateQueries({ queryKey: ['accounts'] });
                    void registeredQueryClient.invalidateQueries({ queryKey: ['reports'] });
                    void registeredQueryClient.invalidateQueries({
                        queryKey: ['technical-journal'],
                    });
                    void registeredQueryClient.invalidateQueries({ queryKey: ['heatmap'] });
                }
            }

            void pruneStaleHttpCache(userScope);
            flushPromise = null;
        }
    })();

    return flushPromise;
}

async function hydrateQueriesFromIDB(queryClient: QueryClient): Promise<void> {
    const userScope = getCurrentUserScope();
    if (!userScope || userScope === 'anon') return;

    const records = await loadPersistedQueries(userScope);
    const cutoff = Date.now() - MAX_PERSISTED_QUERY_AGE_MS;

    for (const rec of records) {
        if (!Array.isArray(rec.queryKey) || rec.data === undefined) continue;
        if ((rec.dataUpdatedAt || 0) < cutoff) continue;
        if (queryClient.getQueryData(rec.queryKey) === undefined) {
            queryClient.setQueryData(rec.queryKey, rec.data, {
                updatedAt: rec.dataUpdatedAt,
            });
        }
    }
}

async function probeConnectivityAndFlush(): Promise<void> {
    try {
        await api.get('/health', {
            _skipOfflineCache: true,
            timeout: 4000,
        } as any);
        useOfflineSyncStore.getState().setOnlineStatus(true);
        await flushAllOfflineQueues();
    } catch (err: any) {
        if (isNetworkError(err)) {
            useOfflineSyncStore.getState().setOnlineStatus(false);
        }
    }
}

export function initOfflineSyncEngine(queryClient: QueryClient): void {
    registeredQueryClient = queryClient;
    registerSyncTriggerHandler(flushAllOfflineQueues);

    if (initialized) return;
    initialized = true;

    void hydrateQueriesFromIDB(queryClient);
    void useOfflineSyncStore.getState().refreshCounts();

    // Persist successful React Query snapshots into IndexedDB (debounced per queryKey)
    const pendingTimers = new Map<string, number>();
    queryClient.getQueryCache().subscribe((event) => {
        if (!event || (event.type !== 'updated' && event.type !== 'added')) return;
        const query = event.query;
        if (!query || query.state.status !== 'success' || query.state.data === undefined) {
            return;
        }
        const keyArr = query.queryKey as any[];
        if (!Array.isArray(keyArr) || keyArr.length === 0) return;
        if (SKIP_QUERY_PERSIST_PREFIXES.has(String(keyArr[0]))) return;

        let serializedKey = '';
        try {
            serializedKey = JSON.stringify(keyArr);
        } catch {
            return;
        }

        if (typeof window === 'undefined') return;
        const existingTimer = pendingTimers.get(serializedKey);
        if (existingTimer) {
            window.clearTimeout(existingTimer);
        }
        const timer = window.setTimeout(() => {
            pendingTimers.delete(serializedKey);
            const userScope = getCurrentUserScope();
            if (userScope && userScope !== 'anon') {
                void savePersistedQuery(
                    userScope,
                    keyArr,
                    query.state.data,
                    query.state.dataUpdatedAt || Date.now()
                );
            }
        }, 500);
        pendingTimers.set(serializedKey, timer);
    });

    if (typeof window !== 'undefined') {
        window.addEventListener('online', () => {
            useOfflineSyncStore.getState().setOnlineStatus(true);
            void probeConnectivityAndFlush();
        });

        window.addEventListener('offline', () => {
            useOfflineSyncStore.getState().setOnlineStatus(false);
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && navigator.onLine) {
                void probeConnectivityAndFlush();
            }
        });

        window.addEventListener('torex:storage-telemetry', () => {
            void useOfflineSyncStore.getState().refreshCounts();
        });

        window.addEventListener('auth:login-success', () => {
            void hydrateQueriesFromIDB(queryClient);
            void flushAllOfflineQueues();
        });

        if (navigator.onLine && localStorage.getItem('token')) {
            void flushAllOfflineQueues();
        }
    }
}
