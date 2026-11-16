import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import {
    getCurrentUserScope,
    getTradeFromIDB,
    getUserProfileFromIDB,
    listAccountTransactionsFromIDB,
    listJournalEntitiesFromIDB,
    listUserAccountsFromIDB,
    listUserTradesFromIDB,
    readHttpGetCache,
    rememberUserScope,
    replaceUserAccountsInIDB,
    saveHttpGetCache,
    saveUserProfileInIDB,
    stableSerializeParams,
    upsertAccountsInIDB,
    upsertJournalEntityInIDB,
    upsertTradesInIDB,
    upsertTransactionsInIDB,
} from './services/offlineDb';
import { useOfflineSyncStore } from './store/useOfflineSyncStore';

const api = axios.create({
    baseURL: '/api',
    headers: {
        'Content-Type': 'application/json',
    },
});

const SKIP_CACHE_PREFIXES = [
    '/health',
    '/admin',
    '/auth/2fa',
    '/ai/chat/jobs',
    '/payment',
    '/mt5/cloud',
];

function shouldSkipOfflineCache(urlPath: string, config?: any): boolean {
    if (config?._skipOfflineCache) return true;
    return SKIP_CACHE_PREFIXES.some((prefix) => urlPath.startsWith(prefix));
}

function isAxiosNetworkFailure(error: any): boolean {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return true;
    }
    if (!error || error.response) return false;
    const code = String(error.code || '');
    const msg = String(error.message || '');
    return (
        code === 'ERR_NETWORK' ||
        code === 'ECONNABORTED' ||
        code === 'ETIMEDOUT' ||
        msg.includes('Network Error') ||
        msg.includes('Failed to fetch')
    );
}

function parseUrlAndParams(
    rawUrl: string,
    configParams?: Record<string, any>
): { urlPath: string; mergedParams: Record<string, any> } {
    const [rawPath, queryStr] = rawUrl.split('?');
    const urlPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    const mergedParams: Record<string, any> = { ...(configParams || {}) };
    if (queryStr) {
        const sp = new URLSearchParams(queryStr);
        sp.forEach((val, key) => {
            if (mergedParams[key] === undefined) {
                mergedParams[key] = val;
            }
        });
    }
    return { urlPath, mergedParams };
}

function makeOfflineResponse<T>(
    data: T,
    config?: AxiosRequestConfig
): AxiosResponse<T> {
    return {
        data,
        status: 200,
        statusText: 'OK (Offline Cache)',
        headers: { 'x-torex-offline-cache': '1' },
        config: (config || {}) as any,
    };
}

function filterAndPaginateTradesOffline(
    trades: Record<string, any>[],
    params: Record<string, any>
) {
    const accountId =
        params.accountId && params.accountId !== 'all'
            ? String(params.accountId)
            : undefined;
    const ticketFilter = params.ticket
        ? String(params.ticket).trim().toLowerCase()
        : '';
    const symbolFilter =
        params.symbol && params.symbol !== 'ALL'
            ? String(params.symbol).trim().toUpperCase()
            : '';
    const typeFilter =
        params.type && params.type !== 'ALL'
            ? String(params.type).trim().toUpperCase()
            : '';
    const statusFilter =
        params.status && params.status !== 'ALL'
            ? String(params.status).trim().toUpperCase()
            : '';
    const startDate = params.startDate ? String(params.startDate) : '';
    const endDate = params.endDate ? String(params.endDate) : '';

    const accountScoped = accountId
        ? trades.filter((t) => String(t.accountId || '') === accountId)
        : trades;

    const availableSymbols = Array.from(
        new Set(
            accountScoped
                .map((t) => String(t.symbol || '').replace(/m$/, '').trim())
                .filter(Boolean)
        )
    ).sort();

    const filtered = accountScoped.filter((t) => {
        if (ticketFilter) {
            const ticketStr = String(t.ticket || t.id || '').toLowerCase();
            if (!ticketStr.includes(ticketFilter)) return false;
        }
        if (symbolFilter) {
            const sym = String(t.symbol || '').replace(/m$/, '').toUpperCase();
            if (sym !== symbolFilter) return false;
        }
        if (typeFilter) {
            const typ = String(t.type || '').toUpperCase();
            if (!typ.includes(typeFilter)) return false;
        }
        if (statusFilter) {
            const st = String(t.status || 'CLOSED').toUpperCase();
            if (st !== statusFilter) return false;
        }
        const refDate = String(t.closeTime || t.openTime || '').slice(0, 10);
        if (startDate && refDate && refDate < startDate) return false;
        if (endDate && refDate && refDate > endDate) return false;
        return true;
    });

    const sort = String(params.sort || 'date-desc');
    filtered.sort((a, b) => {
        const timeA = new Date(a.closeTime || a.openTime || 0).getTime();
        const timeB = new Date(b.closeTime || b.openTime || 0).getTime();
        const netA = Number(a.netPnl ?? a.netProfit ?? a.profit ?? 0);
        const netB = Number(b.netPnl ?? b.netProfit ?? b.profit ?? 0);
        if (sort === 'date-asc') return timeA - timeB;
        if (sort === 'profit-desc') return netB - netA;
        if (sort === 'profit-asc') return netA - netB;
        return timeB - timeA;
    });

    const isPaginated = params.paginated === 'true' || params.paginated === '1';
    if (!isPaginated) {
        const limit = Number(params.limit) || 100;
        return filtered.slice(0, limit);
    }

    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.max(1, Number(params.limit) || 15);
    const total = filtered.length;
    const totalPages = Math.ceil(total / limit);
    const summaryNet = filtered.reduce(
        (acc, t) =>
            acc +
            Number(
                t.netPnl ??
                    t.netProfit ??
                    (Number(t.profit || 0) +
                        Number(t.commission || 0) +
                        Number(t.swap || 0))
            ),
        0
    );
    const items = filtered.slice((page - 1) * limit, page * limit);

    return {
        items,
        total,
        page,
        limit,
        totalPages,
        summaryNet: Number(summaryNet.toFixed(2)),
        availableSymbols,
    };
}

async function synthesizeJournalOverviewOffline(
    userScope: string,
    mergedParams: Record<string, any>,
    accountScope: string
): Promise<any | null> {
    const [trades, dailyRecords, tradeNoteRecords, generalRecords] = await Promise.all([
        listUserTradesFromIDB(userScope),
        listJournalEntitiesFromIDB(userScope, 'daily'),
        listJournalEntitiesFromIDB(userScope, 'trade'),
        listJournalEntitiesFromIDB(userScope, 'general'),
    ]);

    if (
        trades.length === 0 &&
        dailyRecords.length === 0 &&
        tradeNoteRecords.length === 0 &&
        generalRecords.length === 0
    ) {
        return null;
    }

    const accountFilter =
        mergedParams.accountId && mergedParams.accountId !== 'all'
            ? String(mergedParams.accountId)
            : accountScope && accountScope !== 'all'
              ? accountScope
              : undefined;
    const startDate = mergedParams.startDate ? String(mergedParams.startDate) : '';
    const endDate = mergedParams.endDate ? String(mergedParams.endDate) : '';

    const tradeNoteByTradeId = new Map<string, Record<string, any>>();
    for (const rec of tradeNoteRecords) {
        if (rec.entityKey && rec.data) {
            tradeNoteByTradeId.set(String(rec.entityKey), rec.data);
        }
    }

    const scopedTrades = trades.filter((t) => {
        if (accountFilter && String(t.accountId || '') !== accountFilter) return false;
        const dateKey = String(t.closeTime || t.openTime || '').slice(0, 10);
        if (startDate && dateKey && dateKey < startDate) return false;
        if (endDate && dateKey && dateKey > endDate) return false;
        return true;
    });

    const dailyNoteByDate = new Map<string, Record<string, any>>();
    for (const rec of dailyRecords) {
        const idx = rec.entityKey.indexOf(':');
        const recAccount = idx >= 0 ? rec.entityKey.slice(0, idx) : rec.accountId || 'all';
        const dateStr = idx >= 0 ? rec.entityKey.slice(idx + 1) : rec.entityKey;
        if (!dateStr) continue;
        if (accountFilter && recAccount !== accountFilter && recAccount !== 'all') continue;
        if (startDate && dateStr < startDate) continue;
        if (endDate && dateStr > endDate) continue;
        const existing = dailyNoteByDate.get(dateStr);
        if (!existing || recAccount === (accountFilter || 'all')) {
            dailyNoteByDate.set(dateStr, rec.data);
        }
    }

    const tradesByDate = new Map<string, Record<string, any>[]>();
    for (const t of scopedTrades) {
        const dateKey = String(t.closeTime || t.openTime || '').slice(0, 10);
        if (!dateKey) continue;
        const enrichedNote = tradeNoteByTradeId.get(String(t.id)) ?? t.tradeNote ?? null;
        const row = { ...t, tradeNote: enrichedNote };
        const arr = tradesByDate.get(dateKey) || [];
        arr.push(row);
        tradesByDate.set(dateKey, arr);
    }

    const allDates = Array.from(
        new Set<string>([...tradesByDate.keys(), ...dailyNoteByDate.keys()])
    ).sort((a, b) => b.localeCompare(a));

    const dailyBlocks = allDates.map((date) => {
        const dayTrades = tradesByDate.get(date) || [];
        let closedTrades = 0;
        let wins = 0;
        let losses = 0;
        let grossPnl = 0;
        let commissions = 0;

        for (const t of dayTrades) {
            const isClosed = String(t.status || 'CLOSED').toUpperCase() !== 'OPEN';
            if (isClosed) closedTrades += 1;
            const gross = Number(t.profit || 0);
            const comm = Number(t.commission || 0) + Number(t.swap || 0);
            const net =
                t.netPnl !== undefined && t.netPnl !== null
                    ? Number(t.netPnl)
                    : gross + comm;
            grossPnl += gross;
            commissions += comm;
            if (net > 0) wins += 1;
            else if (net < 0) losses += 1;
        }
        const netPnl = grossPnl + commissions;
        const winRate = closedTrades > 0 ? Number(((wins / closedTrades) * 100).toFixed(1)) : 0;

        return {
            date,
            note: dailyNoteByDate.get(date) || null,
            trades: dayTrades,
            metrics: {
                totalTrades: dayTrades.length,
                closedTrades,
                wins,
                losses,
                winRate,
                grossPnl: Number(grossPnl.toFixed(2)),
                netPnl: Number(netPnl.toFixed(2)),
                commissions: Number(commissions.toFixed(2)),
            },
        };
    });

    const generalNotes = generalRecords
        .map((r) => r.data)
        .filter((d) => d && !d.isTemplate)
        .sort((a, b) =>
            String(b.updatedAt || b.createdAt || '').localeCompare(
                String(a.updatedAt || a.createdAt || '')
            )
        );
    const templates = generalRecords
        .map((r) => r.data)
        .filter((d) => d && Boolean(d.isTemplate));

    if (dailyBlocks.length === 0 && generalNotes.length === 0 && templates.length === 0) {
        return null;
    }

    return {
        dailyBlocks,
        generalNotes,
        templates,
        _offlineSynthesized: true,
    };
}

async function resolveOfflineGetFallback<T>(
    userScope: string,
    urlPath: string,
    mergedParams: Record<string, any>,
    accountScope: string,
    config?: AxiosRequestConfig
): Promise<AxiosResponse<T> | null> {
    const paramsKey = stableSerializeParams(mergedParams);
    const cached = await readHttpGetCache(
        userScope,
        urlPath,
        paramsKey,
        accountScope
    );
    if (cached && cached.data !== undefined) {
        return makeOfflineResponse<T>(cached.data, config);
    }

    // Auth profile entity fallback
    if (urlPath === '/auth/profile') {
        const profile = await getUserProfileFromIDB(userScope);
        if (profile) {
            return makeOfflineResponse<T>(profile as unknown as T, config);
        }
    }

    // Accounts list entity fallback
    if (urlPath === '/accounts') {
        const storedAccounts = await listUserAccountsFromIDB(userScope);
        if (storedAccounts.length > 0) {
            const includeArchived =
                mergedParams.includeArchived === 'true' ||
                mergedParams.includeArchived === true;
            const list = includeArchived
                ? storedAccounts
                : storedAccounts.filter((a) => !a.isArchived);
            return makeOfflineResponse<T>(list as unknown as T, config);
        }
    }

    // Account transactions entity fallback
    const txMatch = urlPath.match(/^\/accounts\/([^/]+)\/transactions$/);
    if (txMatch) {
        const accountId = decodeURIComponent(txMatch[1]);
        const txs = await listAccountTransactionsFromIDB(userScope, accountId);
        if (txs.length > 0) {
            return makeOfflineResponse<T>(txs as unknown as T, config);
        }
    }

    // Trade details entity fallback (enriched with entities_journal trade note)
    const tradeDetailMatch = urlPath.match(/^\/dashboard\/trades\/([^/]+)$/);
    if (tradeDetailMatch && tradeDetailMatch[1] !== 'recent') {
        const tradeId = decodeURIComponent(tradeDetailMatch[1]);
        const [trade, tradeNotes] = await Promise.all([
            getTradeFromIDB(userScope, tradeId),
            listJournalEntitiesFromIDB(userScope, 'trade'),
        ]);
        if (trade) {
            const matchedNote =
                tradeNotes.find(
                    (n) =>
                        String(n.entityKey) === String(trade.id) ||
                        String(n.entityKey) === tradeId
                )?.data ||
                trade.tradeNote ||
                null;
            const screenshots = Array.isArray(matchedNote?.screenshots)
                ? matchedNote.screenshots
                : [];
            const payload = {
                trade,
                tradeNote: matchedNote,
                dailyNote: null,
                annotationSource: matchedNote ? 'trade_note' : 'none',
                imageSource: screenshots.length > 0 ? 'trade_note' : 'none',
                effectiveScreenshots: screenshots,
                technicalJournal: null,
                mentalLog: null,
            };
            return makeOfflineResponse<T>(payload as unknown as T, config);
        }
    }

    // Journal overview synthesis from local entities_trades + entities_journal
    if (urlPath === '/dashboard/journal/overview') {
        const overview = await synthesizeJournalOverviewOffline(
            userScope,
            mergedParams,
            accountScope
        );
        if (overview) {
            return makeOfflineResponse<T>(overview as unknown as T, config);
        }
    }

    // Paginated / filtered /dashboard/trades synthesis from local entities_trades
    if (urlPath === '/dashboard/trades') {
        const localTrades = await listUserTradesFromIDB(userScope);
        if (localTrades.length > 0) {
            const synthesized = filterAndPaginateTradesOffline(
                localTrades,
                mergedParams
            );
            return makeOfflineResponse<T>(synthesized as unknown as T, config);
        }
    }

    return null;
}

async function persistEntitiesFromResponse(
    userScope: string,
    urlPath: string,
    mergedParams: Record<string, any>,
    accountScope: string,
    data: any
): Promise<void> {
    if (!data) return;

    if (urlPath === '/auth/profile' && data?.id) {
        const uid = String(data.id);
        rememberUserScope(uid);
        await saveUserProfileInIDB(uid, data);
        return;
    }

    if (urlPath === '/accounts' && Array.isArray(data)) {
        const includeArchived =
            mergedParams.includeArchived === 'true' ||
            mergedParams.includeArchived === true;
        if (includeArchived) {
            await replaceUserAccountsInIDB(userScope, data);
        } else {
            await upsertAccountsInIDB(userScope, data);
        }
        return;
    }

    const txMatch = urlPath.match(/^\/accounts\/([^/]+)\/transactions$/);
    if (txMatch && Array.isArray(data)) {
        await upsertTransactionsInIDB(
            userScope,
            decodeURIComponent(txMatch[1]),
            data
        );
        return;
    }

    if (urlPath === '/dashboard/trades' || urlPath === '/dashboard/trades/recent') {
        const rows = Array.isArray(data?.items)
            ? data.items
            : Array.isArray(data)
              ? data
              : [];
        if (rows.length > 0) {
            await upsertTradesInIDB(userScope, rows);
        }
        return;
    }

    const tradeDetailMatch = urlPath.match(/^\/dashboard\/trades\/([^/]+)$/);
    if (tradeDetailMatch && tradeDetailMatch[1] !== 'recent') {
        const trade = data.trade || (data.id ? data : null);
        if (trade) {
            const note = data.tradeNote ?? trade.tradeNote ?? null;
            await upsertTradesInIDB(userScope, [{ ...trade, tradeNote: note }]);
            if (note && trade.id) {
                await upsertJournalEntityInIDB(
                    userScope,
                    'trade',
                    String(trade.id),
                    note,
                    String(trade.accountId || accountScope || 'all')
                );
            }
        }
        return;
    }

    if (urlPath === '/dashboard/journal/overview') {
        const jobs: Promise<void>[] = [];
        if (Array.isArray(data.dailyBlocks)) {
            const allTrades: Record<string, any>[] = [];
            for (const block of data.dailyBlocks) {
                if (block?.date && block?.note) {
                    const effAcc =
                        mergedParams.accountId && mergedParams.accountId !== 'all'
                            ? String(mergedParams.accountId)
                            : accountScope || 'all';
                    jobs.push(
                        upsertJournalEntityInIDB(
                            userScope,
                            'daily',
                            `${effAcc}:${block.date}`,
                            block.note,
                            effAcc
                        )
                    );
                }
                if (Array.isArray(block?.trades)) {
                    for (const t of block.trades) {
                        allTrades.push(t);
                        if (t?.id && t?.tradeNote) {
                            jobs.push(
                                upsertJournalEntityInIDB(
                                    userScope,
                                    'trade',
                                    String(t.id),
                                    t.tradeNote,
                                    String(t.accountId || accountScope || 'all')
                                )
                            );
                        }
                    }
                }
            }
            if (allTrades.length > 0) {
                jobs.push(upsertTradesInIDB(userScope, allTrades));
            }
        }
        if (Array.isArray(data.generalNotes)) {
            for (const g of data.generalNotes) {
                if (g?.id) {
                    jobs.push(
                        upsertJournalEntityInIDB(
                            userScope,
                            'general',
                            String(g.id),
                            { ...g, isTemplate: false },
                            'all'
                        )
                    );
                }
            }
        }
        if (Array.isArray(data.templates)) {
            for (const tpl of data.templates) {
                if (tpl?.id) {
                    jobs.push(
                        upsertJournalEntityInIDB(
                            userScope,
                            'general',
                            String(tpl.id),
                            { ...tpl, isTemplate: true },
                            'all'
                        )
                    );
                }
            }
        }
        await Promise.all(jobs);
    }
}

api.interceptors.request.use((config) => {
    const isAdminRequest =
        config.url?.startsWith('/admin') ||
        window.location.pathname.startsWith('/admin');
    const token = isAdminRequest
        ? localStorage.getItem('adminToken') || localStorage.getItem('token')
        : localStorage.getItem('token') || localStorage.getItem('adminToken');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    if (!config.headers['x-account-id']) {
        const accountId = localStorage.getItem('torex_selected_account_id');
        if (accountId) {
            config.headers['x-account-id'] = accountId;
        }
    }
    return config;
});

api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            if ((error.config as any)?._isSyncEngineRequest) {
                useOfflineSyncStore
                    .getState()
                    .setSyncState({ syncStatus: 'paused_auth' });
                localStorage.removeItem('token');
                window.dispatchEvent(new Event('auth:unauthorized'));
                return Promise.reject(error);
            }

            const isAiChatRequest = Boolean(
                error.config?.url?.startsWith('/ai/chat')
            );
            if (!isAiChatRequest) {
                console.error(
                    `API Auth Error (401) on URL:`,
                    error.config?.url
                );
                const isAdminRequest =
                    error.config?.url?.startsWith('/admin') ||
                    window.location.pathname.startsWith('/admin');
                if (isAdminRequest) {
                    localStorage.removeItem('adminToken');
                    if (window.location.pathname !== '/admin') {
                        window.location.href = '/admin';
                    }
                } else {
                    localStorage.removeItem('token');
                    if (
                        !window.location.pathname.includes('/login') &&
                        !window.location.pathname.includes('/register')
                    ) {
                        try {
                            sessionStorage.setItem('torex_auth_expired', '1');
                        } catch {
                            // Ignore storage errors
                        }
                        window.dispatchEvent(new Event('auth:unauthorized'));
                    }
                }
            }
        }
        return Promise.reject(error);
    }
);

const rawGet = api.get.bind(api);

api.get = async function offlineAwareGet<
    T = any,
    R = AxiosResponse<T>,
    D = any,
>(url: string, config?: AxiosRequestConfig<D>): Promise<R> {
    const { urlPath, mergedParams } = parseUrlAndParams(
        url,
        config?.params as Record<string, any> | undefined
    );

    if (shouldSkipOfflineCache(urlPath, config)) {
        return rawGet<T, R, D>(url, config);
    }

    const userScope = getCurrentUserScope();
    const accountScope = String(
        mergedParams.accountId ||
            (config?.headers as any)?.['x-account-id'] ||
            localStorage.getItem('torex_selected_account_id') ||
            'all'
    );
    const paramsKey = stableSerializeParams(mergedParams);

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const offlineHit = await resolveOfflineGetFallback<T>(
            userScope,
            urlPath,
            mergedParams,
            accountScope,
            config
        );
        if (offlineHit) {
            return offlineHit as unknown as R;
        }
    }

    try {
        const response = await rawGet<T, R, D>(url, config);
        const syncState = useOfflineSyncStore.getState();
        if (!syncState.isOnline) {
            syncState.setOnlineStatus(true);
        }
        const axiosRes = response as unknown as AxiosResponse<T>;
        if (
            axiosRes &&
            typeof axiosRes.status === 'number' &&
            axiosRes.status >= 200 &&
            axiosRes.status < 300
        ) {
            void saveHttpGetCache(
                userScope,
                urlPath,
                paramsKey,
                accountScope,
                axiosRes.data
            );
            void persistEntitiesFromResponse(
                userScope,
                urlPath,
                mergedParams,
                accountScope,
                axiosRes.data
            );
        }
        return response;
    } catch (error: any) {
        if (isAxiosNetworkFailure(error)) {
            useOfflineSyncStore.getState().setOnlineStatus(false);
            const fallbackHit = await resolveOfflineGetFallback<T>(
                userScope,
                urlPath,
                mergedParams,
                accountScope,
                config
            );
            if (fallbackHit) {
                return fallbackHit as unknown as R;
            }
        }
        throw error;
    }
} as typeof api.get;

export default api;
