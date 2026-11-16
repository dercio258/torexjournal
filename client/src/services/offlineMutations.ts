import api from '../api';
import {
    enqueueSyncMutation,
    generateMutationId,
    getCurrentUserScope,
    listJournalEntitiesFromIDB,
    listUserAccountsFromIDB,
    mutateHttpGetCacheByPrefix,
    patchAccountInIDB,
    patchTradeInIDB,
    removeAccountFromIDB,
    removeJournalEntityFromIDB,
    resolveServerId,
    saveMediaOutboxItem,
    saveUserProfileInIDB,
    upsertAccountsInIDB,
    upsertJournalEntityInIDB,
    upsertTransactionsInIDB,
} from './offlineDb';
import { isNetworkError } from './syncEngine';
import { useOfflineSyncStore } from '../store/useOfflineSyncStore';
import type { AccountTransaction, TradingAccount } from '../context/AccountContext';

export interface OfflineMutationResult<T = any> {
    data: T;
    offlineQueued: boolean;
}

function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Falha ao ler arquivo local'));
        reader.readAsDataURL(file);
    });
}

function buildSyncHeaders(mutationId: string, clientUpdatedAt: string, accountHeader?: string) {
    const headers: Record<string, string> = {
        'X-Idempotency-Key': mutationId,
        'X-Client-Updated-At': clientUpdatedAt,
    };
    if (accountHeader && accountHeader !== 'all') {
        headers['x-account-id'] = accountHeader;
    }
    return headers;
}

async function patchJournalOverviewCache(
    userScope: string,
    updater: (overview: any) => any
): Promise<void> {
    await mutateHttpGetCacheByPrefix(
        userScope,
        '/dashboard/journal/overview',
        (rec) => {
            if (!rec?.data || typeof rec.data !== 'object') return undefined;
            return updater(rec.data);
        }
    );
}

export async function uploadJournalImageOfflineAware(file: File): Promise<string> {
    const userScope = getCurrentUserScope();
    if (typeof navigator === 'undefined' || navigator.onLine) {
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await api.post('/dashboard/journal/screenshot', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            if (res.data?.url) {
                return String(res.data.url);
            }
        } catch (err: any) {
            if (!isNetworkError(err)) {
                throw err;
            }
            useOfflineSyncStore.getState().setOnlineStatus(false);
        }
    }

    const dataUrl = await fileToDataUrl(file);
    await saveMediaOutboxItem({
        mediaId: generateMutationId(),
        userScope,
        blob: file,
        fileName: file.name || `journal_${Date.now()}.png`,
        mimeType: file.type || 'image/png',
        previewDataUrl: dataUrl,
        targetEndpoint: '/dashboard/journal/screenshot',
        uploadedUrl: null,
        createdAt: Date.now(),
    });
    void useOfflineSyncStore.getState().refreshCounts();
    return dataUrl;
}

export async function saveDailyNoteOfflineAware(
    date: string,
    payload: {
        title?: string | null;
        content: string;
        mood?: string | null;
        marketBias?: string | null;
        psychCheck?: Record<string, any>;
        images: string[];
    },
    accountId?: string
): Promise<OfflineMutationResult<any>> {
    const userScope = getCurrentUserScope();
    const mutationId = generateMutationId();
    const clientUpdatedAt = new Date().toISOString();
    const accountHeader = accountId && accountId !== 'all' ? accountId : undefined;
    const params = accountId ? { accountId } : undefined;
    const url = `/dashboard/journal/daily/${date}`;

    const applyLocalCache = async (noteData: any) => {
        const effAccount = accountId || 'all';
        await upsertJournalEntityInIDB(
            userScope,
            'daily',
            `${effAccount}:${date}`,
            noteData,
            effAccount
        );
        await patchJournalOverviewCache(userScope, (overview) => {
            const blocks = Array.isArray(overview.dailyBlocks) ? overview.dailyBlocks : [];
            const exists = blocks.some((b: any) => b.date === date);
            const nextBlocks = exists
                ? blocks.map((b: any) => (b.date === date ? { ...b, note: noteData } : b))
                : [
                      {
                          date,
                          metrics: {
                              totalTrades: 0,
                              closedTrades: 0,
                              wins: 0,
                              losses: 0,
                              breakevens: 0,
                              totalCommissions: 0,
                              grossPnl: 0,
                              netPnl: 0,
                              winRate: null,
                              profitFactor: null,
                              avgMfe: null,
                              maxMfe: null,
                              avgMae: null,
                              maxMae: null,
                          },
                          note: noteData,
                          trades: [],
                      },
                      ...blocks,
                  ].sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)));
            return { ...overview, dailyBlocks: nextBlocks };
        });
    };

    if (typeof navigator === 'undefined' || navigator.onLine) {
        try {
            const res = await api.put(url, payload, {
                params,
                headers: buildSyncHeaders(mutationId, clientUpdatedAt, accountHeader),
            });
            await applyLocalCache(res.data);
            return { data: res.data, offlineQueued: false };
        } catch (err: any) {
            if (!isNetworkError(err)) throw err;
            useOfflineSyncStore.getState().setOnlineStatus(false);
        }
    }

    const optimisticNote = {
        id: `offline-daily-${date}`,
        date,
        title: payload.title ?? null,
        content: payload.content ?? '',
        mood: payload.mood ?? null,
        marketBias: payload.marketBias ?? null,
        psychCheck: payload.psychCheck ?? {},
        images: Array.isArray(payload.images) ? payload.images : [],
        updatedAt: clientUpdatedAt,
    };

    await enqueueSyncMutation({
        userScope,
        entityType: 'journal_daily',
        coalesceKey: `journal_daily:${accountId || 'all'}:${date}`,
        method: 'PUT',
        url,
        params,
        body: payload,
        accountHeader,
        clientUpdatedAt,
    });
    await applyLocalCache(optimisticNote);
    void useOfflineSyncStore.getState().refreshCounts();
    return { data: optimisticNote, offlineQueued: true };
}

export async function deleteDailyNoteOfflineAware(
    date: string,
    accountId?: string
): Promise<OfflineMutationResult<{ ok: boolean }>> {
    const userScope = getCurrentUserScope();
    const mutationId = generateMutationId();
    const clientUpdatedAt = new Date().toISOString();
    const accountHeader = accountId && accountId !== 'all' ? accountId : undefined;
    const params = accountId ? { accountId } : undefined;
    const url = `/dashboard/journal/daily/${date}`;

    const applyLocalCache = async () => {
        const effAccount = accountId || 'all';
        await removeJournalEntityFromIDB(
            userScope,
            'daily',
            `${effAccount}:${date}`
        );
        await patchJournalOverviewCache(userScope, (overview) => {
            const blocks = Array.isArray(overview.dailyBlocks) ? overview.dailyBlocks : [];
            return {
                ...overview,
                dailyBlocks: blocks.map((b: any) =>
                    b.date === date ? { ...b, note: null } : b
                ),
            };
        });
    };

    if (typeof navigator === 'undefined' || navigator.onLine) {
        try {
            const res = await api.delete(url, {
                params,
                headers: buildSyncHeaders(mutationId, clientUpdatedAt, accountHeader),
            });
            await applyLocalCache();
            return { data: res.data || { ok: true }, offlineQueued: false };
        } catch (err: any) {
            if (!isNetworkError(err)) throw err;
            useOfflineSyncStore.getState().setOnlineStatus(false);
        }
    }

    await enqueueSyncMutation({
        userScope,
        entityType: 'journal_daily',
        method: 'DELETE',
        url,
        params,
        accountHeader,
        clientUpdatedAt,
    });
    await applyLocalCache();
    void useOfflineSyncStore.getState().refreshCounts();
    return { data: { ok: true }, offlineQueued: true };
}

export async function saveTradeNoteOfflineAware(
    tradeId: string,
    payload: {
        content: string;
        screenshotUrl: string | null;
        screenshots: string[];
        setup?: string | null;
        rating?: number;
        psychCheck?: Record<string, any>;
        mfe?: number | null;
        mae?: number | null;
    }
): Promise<OfflineMutationResult<any>> {
    const userScope = getCurrentUserScope();
    const mutationId = generateMutationId();
    const clientUpdatedAt = new Date().toISOString();
    const url = `/dashboard/journal/trade/${encodeURIComponent(tradeId)}`;

    const optimisticTradeNote = {
        id: `offline-tn-${tradeId}`,
        tradeId,
        content: payload.content,
        screenshotUrl: payload.screenshotUrl,
        screenshots: payload.screenshots,
        setup: payload.setup ?? null,
        mistakes: null,
        lessons: null,
        rating: payload.rating ?? 0,
        psychCheck: payload.psychCheck ?? {},
        updatedAt: clientUpdatedAt,
    };

    const applyLocalCache = async (savedNote: any) => {
        await upsertJournalEntityInIDB(
            userScope,
            'trade',
            String(tradeId),
            savedNote,
            'all'
        );
        await patchTradeInIDB(userScope, tradeId, {
            mfe: payload.mfe ?? null,
            mae: payload.mae ?? null,
            setup: payload.setup ?? null,
            rating: payload.rating ?? 0,
            tradeNote: savedNote,
        });
        await patchJournalOverviewCache(userScope, (overview) => {
            const blocks = Array.isArray(overview.dailyBlocks) ? overview.dailyBlocks : [];
            return {
                ...overview,
                dailyBlocks: blocks.map((b: any) => ({
                    ...b,
                    trades: Array.isArray(b.trades)
                        ? b.trades.map((t: any) =>
                              String(t.id) === String(tradeId)
                                  ? {
                                        ...t,
                                        mfe: payload.mfe ?? null,
                                        mae: payload.mae ?? null,
                                        setup: payload.setup ?? null,
                                        rating: payload.rating ?? 0,
                                        tradeNote: savedNote,
                                    }
                                  : t
                          )
                        : [],
                })),
            };
        });
    };

    if (typeof navigator === 'undefined' || navigator.onLine) {
        try {
            const res = await api.put(url, payload, {
                headers: buildSyncHeaders(mutationId, clientUpdatedAt),
            });
            await applyLocalCache(res.data || optimisticTradeNote);
            return { data: res.data, offlineQueued: false };
        } catch (err: any) {
            if (!isNetworkError(err)) throw err;
            useOfflineSyncStore.getState().setOnlineStatus(false);
        }
    }

    await enqueueSyncMutation({
        userScope,
        entityType: 'journal_trade',
        coalesceKey: `journal_trade:${tradeId}`,
        method: 'PUT',
        url,
        body: payload,
        clientUpdatedAt,
    });
    await applyLocalCache(optimisticTradeNote);
    void useOfflineSyncStore.getState().refreshCounts();
    return { data: optimisticTradeNote, offlineQueued: true };
}

export async function deleteTradeNoteOfflineAware(
    tradeId: string
): Promise<OfflineMutationResult<{ ok: boolean }>> {
    const userScope = getCurrentUserScope();
    const mutationId = generateMutationId();
    const clientUpdatedAt = new Date().toISOString();
    const url = `/dashboard/journal/trade/${encodeURIComponent(tradeId)}`;

    const applyLocalCache = async () => {
        await removeJournalEntityFromIDB(userScope, 'trade', String(tradeId));
        await patchTradeInIDB(userScope, tradeId, { tradeNote: null });
        await patchJournalOverviewCache(userScope, (overview) => {
            const blocks = Array.isArray(overview.dailyBlocks) ? overview.dailyBlocks : [];
            return {
                ...overview,
                dailyBlocks: blocks.map((b: any) => ({
                    ...b,
                    trades: Array.isArray(b.trades)
                        ? b.trades.map((t: any) =>
                              String(t.id) === String(tradeId)
                                  ? { ...t, tradeNote: null }
                                  : t
                          )
                        : [],
                })),
            };
        });
    };

    if (typeof navigator === 'undefined' || navigator.onLine) {
        try {
            const res = await api.delete(url, {
                headers: buildSyncHeaders(mutationId, clientUpdatedAt),
            });
            await applyLocalCache();
            return { data: res.data || { ok: true }, offlineQueued: false };
        } catch (err: any) {
            if (!isNetworkError(err)) throw err;
            useOfflineSyncStore.getState().setOnlineStatus(false);
        }
    }

    await enqueueSyncMutation({
        userScope,
        entityType: 'journal_trade',
        method: 'DELETE',
        url,
        clientUpdatedAt,
    });
    await applyLocalCache();
    void useOfflineSyncStore.getState().refreshCounts();
    return { data: { ok: true }, offlineQueued: true };
}

export async function createGeneralNoteOfflineAware(payload: {
    title: string;
    category: string;
    content: string;
    images: string[];
    pinned: boolean;
    isTemplate: boolean;
}): Promise<OfflineMutationResult<any>> {
    const userScope = getCurrentUserScope();
    const mutationId = generateMutationId();
    const clientUpdatedAt = new Date().toISOString();
    const url = '/dashboard/journal/general';

    const applyLocalCache = async (created: any) => {
        if (created?.id) {
            await upsertJournalEntityInIDB(
                userScope,
                'general',
                String(created.id),
                created,
                'all'
            );
        }
        await patchJournalOverviewCache(userScope, (overview) => {
            if (payload.isTemplate) {
                const templates = Array.isArray(overview.templates) ? overview.templates : [];
                return {
                    ...overview,
                    templates: [created, ...templates.filter((t: any) => t.id !== created.id)],
                };
            }
            const generalNotes = Array.isArray(overview.generalNotes)
                ? overview.generalNotes
                : [];
            return {
                ...overview,
                generalNotes: [
                    created,
                    ...generalNotes.filter((g: any) => g.id !== created.id),
                ],
            };
        });
    };

    if (typeof navigator === 'undefined' || navigator.onLine) {
        try {
            const res = await api.post(url, payload, {
                headers: buildSyncHeaders(mutationId, clientUpdatedAt),
            });
            await applyLocalCache(res.data);
            return { data: res.data, offlineQueued: false };
        } catch (err: any) {
            if (!isNetworkError(err)) throw err;
            useOfflineSyncStore.getState().setOnlineStatus(false);
        }
    }

    const tempId = `offline-gen-${generateMutationId()}`;
    const optimistic = {
        id: tempId,
        title: payload.title,
        category: payload.category || 'GENERAL',
        content: payload.content || '',
        images: Array.isArray(payload.images) ? payload.images : [],
        pinned: Boolean(payload.pinned),
        isTemplate: Boolean(payload.isTemplate),
        updatedAt: clientUpdatedAt,
    };

    await enqueueSyncMutation({
        userScope,
        entityType: payload.isTemplate ? 'journal_template' : 'journal_general',
        tempEntityId: tempId,
        method: 'POST',
        url,
        body: payload,
        clientUpdatedAt,
    });
    await applyLocalCache(optimistic);
    void useOfflineSyncStore.getState().refreshCounts();
    return { data: optimistic, offlineQueued: true };
}

export async function updateGeneralNoteOfflineAware(
    id: string,
    payload: {
        title?: string;
        category?: string;
        pinned?: boolean;
        content?: string;
        images?: string[];
    }
): Promise<OfflineMutationResult<any>> {
    const userScope = getCurrentUserScope();
    const mutationId = generateMutationId();
    const clientUpdatedAt = new Date().toISOString();
    const resolvedId = await resolveServerId(id);
    const url = `/dashboard/journal/general/${encodeURIComponent(resolvedId)}`;

    const applyLocalCache = async (updated: any) => {
        const existingList = await listJournalEntitiesFromIDB(userScope, 'general');
        const existing = existingList.find(
            (r) => r.entityKey === id || r.entityKey === resolvedId
        )?.data;
        const merged = { ...(existing || {}), ...updated, id: updated?.id || resolvedId };
        await upsertJournalEntityInIDB(
            userScope,
            'general',
            String(merged.id),
            merged,
            'all'
        );
        await patchJournalOverviewCache(userScope, (overview) => {
            const generalNotes = Array.isArray(overview.generalNotes)
                ? overview.generalNotes
                : [];
            return {
                ...overview,
                generalNotes: generalNotes
                    .map((g: any) =>
                        g.id === id || g.id === resolvedId ? { ...g, ...updated } : g
                    )
                    .sort((a: any, b: any) => Number(b.pinned) - Number(a.pinned)),
            };
        });
    };

    if (typeof navigator === 'undefined' || navigator.onLine) {
        try {
            const res = await api.put(url, payload, {
                headers: buildSyncHeaders(mutationId, clientUpdatedAt),
            });
            await applyLocalCache(res.data);
            return { data: res.data, offlineQueued: false };
        } catch (err: any) {
            if (!isNetworkError(err)) throw err;
            useOfflineSyncStore.getState().setOnlineStatus(false);
        }
    }

    const optimistic = {
        id: resolvedId,
        ...payload,
        updatedAt: clientUpdatedAt,
    };
    const isTemp = resolvedId.startsWith('offline-gen-');

    await enqueueSyncMutation({
        userScope,
        entityType: 'journal_general',
        coalesceKey: `journal_general:${id}`,
        tempEntityId: isTemp ? resolvedId : undefined,
        method: 'PUT',
        url,
        body: payload,
        clientUpdatedAt,
    });
    await applyLocalCache(optimistic);
    void useOfflineSyncStore.getState().refreshCounts();
    return { data: optimistic, offlineQueued: true };
}

export async function deleteGeneralNoteOfflineAware(
    id: string
): Promise<OfflineMutationResult<{ ok: boolean }>> {
    const userScope = getCurrentUserScope();
    const mutationId = generateMutationId();
    const clientUpdatedAt = new Date().toISOString();
    const resolvedId = await resolveServerId(id);
    const url = `/dashboard/journal/general/${encodeURIComponent(resolvedId)}`;

    const applyLocalCache = async () => {
        await removeJournalEntityFromIDB(userScope, 'general', String(id));
        if (resolvedId !== id) {
            await removeJournalEntityFromIDB(userScope, 'general', String(resolvedId));
        }
        await patchJournalOverviewCache(userScope, (overview) => {
            const generalNotes = Array.isArray(overview.generalNotes)
                ? overview.generalNotes
                : [];
            const templates = Array.isArray(overview.templates) ? overview.templates : [];
            return {
                ...overview,
                generalNotes: generalNotes.filter(
                    (g: any) => g.id !== id && g.id !== resolvedId
                ),
                templates: templates.filter(
                    (t: any) => t.id !== id && t.id !== resolvedId
                ),
            };
        });
    };

    if (typeof navigator === 'undefined' || navigator.onLine) {
        try {
            const res = await api.delete(url, {
                headers: buildSyncHeaders(mutationId, clientUpdatedAt),
            });
            await applyLocalCache();
            return { data: res.data || { ok: true }, offlineQueued: false };
        } catch (err: any) {
            if (!isNetworkError(err)) throw err;
            useOfflineSyncStore.getState().setOnlineStatus(false);
        }
    }

    const isTemp = resolvedId.startsWith('offline-gen-');
    await enqueueSyncMutation({
        userScope,
        entityType: 'journal_general',
        tempEntityId: isTemp ? resolvedId : undefined,
        method: 'DELETE',
        url,
        clientUpdatedAt,
    });
    await applyLocalCache();
    void useOfflineSyncStore.getState().refreshCounts();
    return { data: { ok: true }, offlineQueued: true };
}

export async function updateTradeMetaOfflineAware(
    tradeId: string,
    editForm: {
        setup?: string;
        mood?: string;
        rating?: number;
        lesson?: string;
        session?: string;
        tags?: string[];
    }
): Promise<OfflineMutationResult<any>> {
    const userScope = getCurrentUserScope();
    const mutationId = generateMutationId();
    const clientUpdatedAt = new Date().toISOString();
    const url = `/dashboard/trades/${encodeURIComponent(tradeId)}`;

    const applyLocalCache = async () => {
        await patchTradeInIDB(userScope, tradeId, editForm);
        await mutateHttpGetCacheByPrefix(
            userScope,
            `/dashboard/trades/${encodeURIComponent(tradeId)}`,
            (rec) => {
                if (!rec?.data) return undefined;
                if (rec.data.trade) {
                    return {
                        ...rec.data,
                        trade: { ...rec.data.trade, ...editForm },
                    };
                }
                return { ...rec.data, ...editForm };
            }
        );
        await mutateHttpGetCacheByPrefix(userScope, '/dashboard/trades', (rec) => {
            if (rec.urlPath !== '/dashboard/trades' || !rec.data) return undefined;
            if (Array.isArray(rec.data.items)) {
                return {
                    ...rec.data,
                    items: rec.data.items.map((t: any) =>
                        String(t.id) === String(tradeId) ? { ...t, ...editForm } : t
                    ),
                };
            }
            if (Array.isArray(rec.data)) {
                return rec.data.map((t: any) =>
                    String(t.id) === String(tradeId) ? { ...t, ...editForm } : t
                );
            }
            return undefined;
        });
    };

    if (typeof navigator === 'undefined' || navigator.onLine) {
        try {
            const res = await api.patch(url, editForm, {
                headers: buildSyncHeaders(mutationId, clientUpdatedAt),
            });
            await applyLocalCache();
            return { data: res.data, offlineQueued: false };
        } catch (err: any) {
            if (!isNetworkError(err)) throw err;
            useOfflineSyncStore.getState().setOnlineStatus(false);
        }
    }

    await enqueueSyncMutation({
        userScope,
        entityType: 'trade_meta',
        coalesceKey: `trade_meta:${tradeId}`,
        method: 'PATCH',
        url,
        body: editForm,
        clientUpdatedAt,
    });
    await applyLocalCache();
    void useOfflineSyncStore.getState().refreshCounts();
    return { data: { id: tradeId, ...editForm }, offlineQueued: true };
}

export async function createAccountOfflineAware(
    data: Partial<TradingAccount>
): Promise<OfflineMutationResult<TradingAccount>> {
    const userScope = getCurrentUserScope();
    const mutationId = generateMutationId();
    const clientUpdatedAt = new Date().toISOString();
    const url = '/accounts';

    const applyLocalCache = async (acc: TradingAccount) => {
        await upsertAccountsInIDB(userScope, [acc]);
        await mutateHttpGetCacheByPrefix(userScope, '/accounts', (rec) => {
            if (rec.urlPath !== '/accounts' || !Array.isArray(rec.data)) return undefined;
            return [...rec.data.filter((a: any) => a.id !== acc.id), acc];
        });
    };

    if (typeof navigator === 'undefined' || navigator.onLine) {
        try {
            const res = await api.post(url, data, {
                headers: buildSyncHeaders(mutationId, clientUpdatedAt),
            });
            await applyLocalCache(res.data);
            return { data: res.data, offlineQueued: false };
        } catch (err: any) {
            if (!isNetworkError(err)) throw err;
            useOfflineSyncStore.getState().setOnlineStatus(false);
        }
    }

    const tempId = `offline-acc-${generateMutationId()}`;
    const optimistic: TradingAccount = {
        id: tempId,
        name: data.name || 'Conta Offline',
        broker: data.broker || 'Manual',
        type: (data.type as any) || 'custom',
        currency: data.currency || 'USD',
        initialBalance: Number(data.initialBalance || 0),
        balance: Number(data.balance ?? data.initialBalance ?? 0),
        equity: Number(data.equity ?? data.initialBalance ?? 0),
        margin: 0,
        marginFree: Number(data.initialBalance || 0),
        marginLevel: 0,
        leverage: Number(data.leverage || 100),
        isConnected: false,
        lastSeen: null,
        appToken: '',
        userId: userScope,
        isPrimary: Boolean(data.isPrimary),
        isArchived: false,
        archivedAt: null,
        propFirmRules: data.propFirmRules || null,
        mt5Id: data.mt5Id,
        tradesCount: 0,
        netPnl: 0,
        winRate: 0,
        createdAt: clientUpdatedAt,
        updatedAt: clientUpdatedAt,
    };

    await enqueueSyncMutation({
        userScope,
        entityType: 'account',
        tempEntityId: tempId,
        method: 'POST',
        url,
        body: data,
        clientUpdatedAt,
    });
    await applyLocalCache(optimistic);
    void useOfflineSyncStore.getState().refreshCounts();
    return { data: optimistic, offlineQueued: true };
}

export async function updateAccountOfflineAware(
    id: string,
    data: Partial<TradingAccount>
): Promise<OfflineMutationResult<TradingAccount>> {
    const userScope = getCurrentUserScope();
    const mutationId = generateMutationId();
    const clientUpdatedAt = new Date().toISOString();
    const resolvedId = await resolveServerId(id);
    const url = `/accounts/${encodeURIComponent(resolvedId)}`;

    const applyLocalCache = async (patchOrFull: Partial<TradingAccount>) => {
        await patchAccountInIDB(userScope, resolvedId, patchOrFull);
        if (id !== resolvedId) {
            await patchAccountInIDB(userScope, id, patchOrFull);
        }
        await mutateHttpGetCacheByPrefix(userScope, '/accounts', (rec) => {
            if (rec.urlPath !== '/accounts' || !Array.isArray(rec.data)) return undefined;
            return rec.data.map((a: any) =>
                a.id === id || a.id === resolvedId ? { ...a, ...patchOrFull } : a
            );
        });
    };

    if (typeof navigator === 'undefined' || navigator.onLine) {
        try {
            const res = await api.put(url, data, {
                headers: buildSyncHeaders(mutationId, clientUpdatedAt),
            });
            await applyLocalCache(res.data);
            return { data: res.data, offlineQueued: false };
        } catch (err: any) {
            if (!isNetworkError(err)) throw err;
            useOfflineSyncStore.getState().setOnlineStatus(false);
        }
    }

    const isTemp = resolvedId.startsWith('offline-acc-');
    await enqueueSyncMutation({
        userScope,
        entityType: 'account',
        coalesceKey: `account:${id}`,
        tempEntityId: isTemp ? resolvedId : undefined,
        method: 'PUT',
        url,
        body: data,
        clientUpdatedAt,
    });
    await applyLocalCache({ ...data, updatedAt: clientUpdatedAt });
    void useOfflineSyncStore.getState().refreshCounts();
    return {
        data: { id: resolvedId, ...(data as any), updatedAt: clientUpdatedAt } as TradingAccount,
        offlineQueued: true,
    };
}

export async function addTransactionOfflineAware(
    accountId: string,
    data: { type: string; amount: number; description?: string; date?: string }
): Promise<OfflineMutationResult<AccountTransaction>> {
    const userScope = getCurrentUserScope();
    const mutationId = generateMutationId();
    const clientUpdatedAt = new Date().toISOString();
    const resolvedAccountId = await resolveServerId(accountId);
    const url = `/accounts/${encodeURIComponent(resolvedAccountId)}/transactions`;

    const applyLocalCache = async (txItem: AccountTransaction, nextBalance?: number) => {
        await upsertTransactionsInIDB(userScope, resolvedAccountId, [txItem]);
        if (typeof nextBalance === 'number') {
            await patchAccountInIDB(userScope, resolvedAccountId, {
                balance: nextBalance,
                equity: nextBalance,
            });
            await mutateHttpGetCacheByPrefix(userScope, '/accounts', (rec) => {
                if (rec.urlPath !== '/accounts' || !Array.isArray(rec.data)) return undefined;
                return rec.data.map((a: any) =>
                    a.id === resolvedAccountId || a.id === accountId
                        ? { ...a, balance: nextBalance, equity: nextBalance }
                        : a
                );
            });
        }
        await mutateHttpGetCacheByPrefix(
            userScope,
            `/accounts/${encodeURIComponent(accountId)}/transactions`,
            (rec) => {
                if (!Array.isArray(rec.data)) return undefined;
                return [txItem, ...rec.data];
            }
        );
    };

    if (typeof navigator === 'undefined' || navigator.onLine) {
        try {
            const res = await api.post(url, data, {
                headers: buildSyncHeaders(mutationId, clientUpdatedAt),
            });
            const bal =
                typeof res.data?.balanceAfter === 'number'
                    ? res.data.balanceAfter
                    : undefined;
            await applyLocalCache(res.data, bal);
            return { data: res.data, offlineQueued: false };
        } catch (err: any) {
            if (!isNetworkError(err)) throw err;
            useOfflineSyncStore.getState().setOnlineStatus(false);
        }
    }

    const storedAccounts = await listUserAccountsFromIDB(userScope);
    const targetAcc = storedAccounts.find(
        (a) => a.id === resolvedAccountId || a.id === accountId
    );
    const prevBalance = Number(targetAcc?.balance || 0);
    const amt = Number(data.amount || 0);
    const delta =
        data.type === 'withdrawal' || data.type === 'fee'
            ? -Math.abs(amt)
            : amt;
    const optimisticBalance = Number((prevBalance + delta).toFixed(2));

    const optimisticTx: AccountTransaction = {
        id: `offline-tx-${generateMutationId()}`,
        accountId: resolvedAccountId,
        type: (data.type as AccountTransaction['type']) || 'deposit',
        amount: amt,
        date: data.date || clientUpdatedAt,
        description: data.description || null,
        balanceAfter: optimisticBalance,
        createdAt: clientUpdatedAt,
    };

    await enqueueSyncMutation({
        userScope,
        entityType: 'account_transaction',
        method: 'POST',
        url,
        body: data,
        clientUpdatedAt,
    });
    await applyLocalCache(optimisticTx, targetAcc ? optimisticBalance : undefined);
    void useOfflineSyncStore.getState().refreshCounts();
    return { data: optimisticTx, offlineQueued: true };
}


async function runJsonOfflineAware<T = any>(opts: {
    entityType: Parameters<typeof enqueueSyncMutation>[0]['entityType'];
    coalesceKey?: string;
    tempEntityId?: string;
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url: string;
    params?: Record<string, any>;
    body?: any;
    accountHeader?: string;
    fallbackData: T;
    applyLocalCache: (serverData?: T) => Promise<void>;
}): Promise<OfflineMutationResult<T>> {
    const userScope = getCurrentUserScope();
    const mutationId = generateMutationId();
    const clientUpdatedAt = new Date().toISOString();

    if (typeof navigator === 'undefined' || navigator.onLine) {
        try {
            const res = await api.request<T>({
                method: opts.method,
                url: opts.url,
                params: opts.params,
                data: opts.body,
                headers: buildSyncHeaders(mutationId, clientUpdatedAt, opts.accountHeader),
            });
            await opts.applyLocalCache(res.data);
            return { data: res.data, offlineQueued: false };
        } catch (err: any) {
            if (!isNetworkError(err)) throw err;
            useOfflineSyncStore.getState().setOnlineStatus(false);
        }
    }

    await enqueueSyncMutation({
        userScope,
        entityType: opts.entityType,
        coalesceKey: opts.coalesceKey,
        tempEntityId: opts.tempEntityId,
        method: opts.method,
        url: opts.url,
        params: opts.params,
        body: opts.body,
        accountHeader: opts.accountHeader,
        clientUpdatedAt,
    });
    await opts.applyLocalCache();
    void useOfflineSyncStore.getState().refreshCounts();
    return { data: opts.fallbackData, offlineQueued: true };
}

export async function setPrimaryAccountOfflineAware(
    id: string
): Promise<OfflineMutationResult<{ ok: boolean }>> {
    const userScope = getCurrentUserScope();
    const resolvedId = await resolveServerId(id);
    const applyLocalCache = async () => {
        const all = await listUserAccountsFromIDB(userScope);
        await Promise.all(
            all.map((a) =>
                patchAccountInIDB(userScope, String(a.id), {
                    isPrimary: a.id === id || a.id === resolvedId,
                })
            )
        );
        await mutateHttpGetCacheByPrefix(userScope, '/accounts', (rec) => {
            if (rec.urlPath !== '/accounts' || !Array.isArray(rec.data)) return undefined;
            return rec.data.map((a: any) => ({
                ...a,
                isPrimary: a.id === id || a.id === resolvedId,
            }));
        });
    };

    return runJsonOfflineAware({
        entityType: 'account',
        method: 'POST',
        url: `/accounts/${encodeURIComponent(resolvedId)}/primary`,
        fallbackData: { ok: true },
        applyLocalCache,
    });
}

export async function archiveAccountOfflineAware(
    id: string
): Promise<OfflineMutationResult<{ ok: boolean }>> {
    const userScope = getCurrentUserScope();
    const resolvedId = await resolveServerId(id);
    const nowIso = new Date().toISOString();
    const applyLocalCache = async () => {
        const patch = { isArchived: true, archivedAt: nowIso };
        await patchAccountInIDB(userScope, resolvedId, patch);
        if (id !== resolvedId) await patchAccountInIDB(userScope, id, patch);
        await mutateHttpGetCacheByPrefix(userScope, '/accounts', (rec) => {
            if (rec.urlPath !== '/accounts' || !Array.isArray(rec.data)) return undefined;
            return rec.data.map((a: any) =>
                a.id === id || a.id === resolvedId ? { ...a, ...patch } : a
            );
        });
    };

    return runJsonOfflineAware({
        entityType: 'account',
        method: 'POST',
        url: `/accounts/${encodeURIComponent(resolvedId)}/archive`,
        fallbackData: { ok: true },
        applyLocalCache,
    });
}

export async function restoreAccountOfflineAware(
    id: string
): Promise<OfflineMutationResult<{ ok: boolean }>> {
    const userScope = getCurrentUserScope();
    const resolvedId = await resolveServerId(id);
    const applyLocalCache = async () => {
        const patch = { isArchived: false, archivedAt: null };
        await patchAccountInIDB(userScope, resolvedId, patch);
        if (id !== resolvedId) await patchAccountInIDB(userScope, id, patch);
        await mutateHttpGetCacheByPrefix(userScope, '/accounts', (rec) => {
            if (rec.urlPath !== '/accounts' || !Array.isArray(rec.data)) return undefined;
            return rec.data.map((a: any) =>
                a.id === id || a.id === resolvedId ? { ...a, ...patch } : a
            );
        });
    };

    return runJsonOfflineAware({
        entityType: 'account',
        method: 'POST',
        url: `/accounts/${encodeURIComponent(resolvedId)}/restore`,
        fallbackData: { ok: true },
        applyLocalCache,
    });
}

export async function deleteAccountOfflineAware(
    id: string,
    force = false
): Promise<OfflineMutationResult<{ ok: boolean }>> {
    const userScope = getCurrentUserScope();
    const resolvedId = await resolveServerId(id);
    const isTemp = resolvedId.startsWith('offline-acc-');
    const applyLocalCache = async () => {
        await removeAccountFromIDB(userScope, resolvedId);
        if (id !== resolvedId) await removeAccountFromIDB(userScope, id);
        await mutateHttpGetCacheByPrefix(userScope, '/accounts', (rec) => {
            if (rec.urlPath !== '/accounts' || !Array.isArray(rec.data)) return undefined;
            return rec.data.filter((a: any) => a.id !== id && a.id !== resolvedId);
        });
    };

    return runJsonOfflineAware({
        entityType: 'account',
        tempEntityId: isTemp ? resolvedId : undefined,
        method: 'DELETE',
        url: `/accounts/${encodeURIComponent(resolvedId)}${force ? '?force=true' : ''}`,
        fallbackData: { ok: true },
        applyLocalCache,
    });
}

async function applyUserProfileLocalPatch(
    userScope: string,
    patch: Record<string, any>
): Promise<void> {
    await saveUserProfileInIDB(userScope, patch);
    try {
        const raw = localStorage.getItem('torex_user_cache');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                localStorage.setItem('torex_user_cache', JSON.stringify({ ...parsed, ...patch }));
            }
        }
    } catch {
        // Ignore storage errors
    }
    await mutateHttpGetCacheByPrefix(userScope, '/auth/profile', (rec) => {
        if (rec.urlPath !== '/auth/profile' || !rec.data || typeof rec.data !== 'object') {
            return undefined;
        }
        return { ...rec.data, ...patch };
    });
}

export async function updateUserProfileOfflineAware(
    patch: Record<string, any>
): Promise<OfflineMutationResult<any>> {
    const userScope = getCurrentUserScope();
    return runJsonOfflineAware({
        entityType: 'user_profile',
        coalesceKey: 'user_profile:main',
        method: 'PUT',
        url: '/auth/profile',
        body: patch,
        fallbackData: patch,
        applyLocalCache: async (serverData) => {
            await applyUserProfileLocalPatch(
                userScope,
                serverData && typeof serverData === 'object' ? { ...patch, ...serverData } : patch
            );
        },
    });
}

export async function updateUserContactOfflineAware(payload: {
    whatsapp: string;
}): Promise<OfflineMutationResult<any>> {
    const userScope = getCurrentUserScope();
    return runJsonOfflineAware({
        entityType: 'user_profile',
        coalesceKey: 'user_profile:contact',
        method: 'PUT',
        url: '/auth/contact',
        body: payload,
        fallbackData: payload,
        applyLocalCache: async () => {
            await applyUserProfileLocalPatch(userScope, { whatsapp: payload.whatsapp });
        },
    });
}

export async function updateUserPreferencesOfflineAware(
    payload: Record<string, any>
): Promise<OfflineMutationResult<any>> {
    const userScope = getCurrentUserScope();
    return runJsonOfflineAware({
        entityType: 'user_profile',
        coalesceKey: 'user_profile:prefs',
        method: 'PUT',
        url: '/auth/preferences',
        body: payload,
        fallbackData: payload,
        applyLocalCache: async () => {
            await applyUserProfileLocalPatch(userScope, {
                preferredLocale: payload.preferredLocale,
                timezone: payload.timezone,
            });
        },
    });
}

export async function markAllNotificationsReadOfflineAware(): Promise<
    OfflineMutationResult<{ ok: boolean }>
> {
    const userScope = getCurrentUserScope();
    return runJsonOfflineAware({
        entityType: 'notification',
        coalesceKey: 'notifications:read_all',
        method: 'PATCH',
        url: '/notifications/read-all',
        fallbackData: { ok: true },
        applyLocalCache: async () => {
            await mutateHttpGetCacheByPrefix(userScope, '/notifications', (rec) => {
                if (rec.urlPath !== '/notifications' || !Array.isArray(rec.data)) {
                    return undefined;
                }
                return rec.data.map((n: any) => ({ ...n, read: true }));
            });
        },
    });
}

export async function markNotificationReadOfflineAware(
    id: number | string
): Promise<OfflineMutationResult<{ ok: boolean }>> {
    const userScope = getCurrentUserScope();
    return runJsonOfflineAware({
        entityType: 'notification',
        coalesceKey: `notification_read:${id}`,
        method: 'PATCH',
        url: `/notifications/${id}/read`,
        fallbackData: { ok: true },
        applyLocalCache: async () => {
            await mutateHttpGetCacheByPrefix(userScope, '/notifications', (rec) => {
                if (rec.urlPath !== '/notifications' || !Array.isArray(rec.data)) {
                    return undefined;
                }
                return rec.data.map((n: any) =>
                    String(n.id) === String(id) ? { ...n, read: true } : n
                );
            });
        },
    });
}

export async function resolveAlertOfflineAware(
    id: string
): Promise<OfflineMutationResult<{ ok: boolean }>> {
    const userScope = getCurrentUserScope();
    return runJsonOfflineAware({
        entityType: 'notification',
        coalesceKey: `alert_resolve:${id}`,
        method: 'PATCH',
        url: `/alerts/${id}/resolve`,
        fallbackData: { ok: true },
        applyLocalCache: async () => {
            await mutateHttpGetCacheByPrefix(userScope, '/alerts', (rec) => {
                if (rec.urlPath !== '/alerts' || !Array.isArray(rec.data)) {
                    return undefined;
                }
                return rec.data.map((a: any) =>
                    String(a.id) === String(id) ? { ...a, resolved: true } : a
                );
            });
        },
    });
}

export async function deleteNotificationOfflineAware(
    id: number | string
): Promise<OfflineMutationResult<{ ok: boolean }>> {
    const userScope = getCurrentUserScope();
    return runJsonOfflineAware({
        entityType: 'notification',
        method: 'DELETE',
        url: `/notifications/${id}`,
        fallbackData: { ok: true },
        applyLocalCache: async () => {
            await mutateHttpGetCacheByPrefix(userScope, '/notifications', (rec) => {
                if (rec.urlPath !== '/notifications' || !Array.isArray(rec.data)) {
                    return undefined;
                }
                return rec.data.filter((n: any) => String(n.id) !== String(id));
            });
        },
    });
}

export async function saveBacktestHypothesisOfflineAware(
    payload: Record<string, any>,
    accountId?: string
): Promise<OfflineMutationResult<any>> {
    const userScope = getCurrentUserScope();
    const tempId = `temp-bt-${generateMutationId()}`;
    const accountHeader = accountId && accountId !== 'all' ? accountId : undefined;
    const params = accountHeader ? { accountId: accountHeader } : undefined;
    const optimistic = {
        id: tempId,
        ...payload,
        createdAt: new Date().toISOString(),
    };

    return runJsonOfflineAware({
        entityType: 'backtest_session',
        tempEntityId: tempId,
        method: 'POST',
        url: '/dashboard/backtest/save',
        params,
        body: payload,
        accountHeader,
        fallbackData: optimistic,
        applyLocalCache: async (serverData) => {
            const item = serverData && serverData.id ? serverData : optimistic;
            await mutateHttpGetCacheByPrefix(userScope, '/dashboard/backtest/history', (rec) => {
                if (!Array.isArray(rec.data)) return undefined;
                return [item, ...rec.data.filter((x: any) => x.id !== item.id)].slice(0, 20);
            });
        },
    });
}

export async function deleteBacktestSessionOfflineAware(
    sessionId: string
): Promise<OfflineMutationResult<{ ok: boolean }>> {
    const userScope = getCurrentUserScope();
    const resolvedId = await resolveServerId(sessionId);
    const isTemp = resolvedId.startsWith('temp-bt-');
    return runJsonOfflineAware({
        entityType: 'backtest_session',
        tempEntityId: isTemp ? resolvedId : undefined,
        method: 'DELETE',
        url: `/dashboard/backtest/session/${encodeURIComponent(resolvedId)}`,
        fallbackData: { ok: true },
        applyLocalCache: async () => {
            await mutateHttpGetCacheByPrefix(userScope, '/dashboard/backtest/history', (rec) => {
                if (!Array.isArray(rec.data)) return undefined;
                return rec.data.filter(
                    (x: any) => x.id !== sessionId && x.id !== resolvedId
                );
            });
        },
    });
}
