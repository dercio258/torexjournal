import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientRoot = path.resolve(__dirname, '..');
const tmpBundlePath = path.join(__dirname, '.tmp_offline_bundle.mjs');

const require = createRequire(import.meta.url);
const esbuild = require(path.join(clientRoot, 'node_modules', 'esbuild'));

// ============================================================================
// In-Memory Browser + IndexedDB Environment Setup
// ============================================================================

function clonePreservingBlobs(value) {
    if (value === null || typeof value !== 'object') return value;
    if (typeof Blob !== 'undefined' && value instanceof Blob) return value;
    if (value instanceof Date) return new Date(value.getTime());
    if (Array.isArray(value)) return value.map((item) => clonePreservingBlobs(item));
    const copy = {};
    for (const key of Object.keys(value)) {
        copy[key] = clonePreservingBlobs(value[key]);
    }
    return copy;
}

function extractKeyPath(record, keyPath) {
    if (Array.isArray(keyPath)) {
        return keyPath.map((part) => extractKeyPath(record, part));
    }
    if (typeof keyPath !== 'string') return undefined;
    const parts = keyPath.split('.');
    let curr = record;
    for (const part of parts) {
        if (curr === null || curr === undefined) return undefined;
        curr = curr[part];
    }
    return curr;
}

function compareKeys(a, b) {
    if (a === b) return 0;
    if (a === undefined || a === null) return -1;
    if (b === undefined || b === null) return 1;
    if (Array.isArray(a) && Array.isArray(b)) {
        const len = Math.min(a.length, b.length);
        for (let i = 0; i < len; i += 1) {
            const cmp = compareKeys(a[i], b[i]);
            if (cmp !== 0) return cmp;
        }
        return a.length - b.length;
    }
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a) < String(b) ? -1 : 1;
}

function keyMatchesQuery(key, query) {
    if (query === undefined || query === null) return true;
    if (typeof query === 'object' && !Array.isArray(query) && !(query instanceof Date)) {
        if ('__only' in query) return compareKeys(key, query.__only) === 0;
        if ('__lower' in query) {
            const [low, open] = query.__lower;
            const cmp = compareKeys(key, low);
            return open ? cmp > 0 : cmp >= 0;
        }
        if ('__upper' in query) {
            const [high, open] = query.__upper;
            const cmp = compareKeys(key, high);
            return open ? cmp < 0 : cmp <= 0;
        }
        if ('__bound' in query) {
            const [low, high, lowOpen, highOpen] = query.__bound;
            const cmpLow = compareKeys(key, low);
            const cmpHigh = compareKeys(key, high);
            return (lowOpen ? cmpLow > 0 : cmpLow >= 0) && (highOpen ? cmpHigh < 0 : cmpHigh <= 0);
        }
    }
    return compareKeys(key, query) === 0;
}

function serializeKey(key) {
    return JSON.stringify(key);
}

function createMemoryIndexedDB() {
    const databases = new Map();

    const makeDomStringList = (getNames) => ({
        get length() {
            return getNames().length;
        },
        contains(name) {
            return getNames().includes(name);
        },
        item(idx) {
            return getNames()[idx] ?? null;
        },
        [Symbol.iterator]() {
            return getNames()[Symbol.iterator]();
        },
    });

    const createObjectStoreWrapper = (storeData, tx, scheduleOp) => {
        const getMatchingEntries = (query, indexMeta = null, direction = 'next') => {
            const entries = [];
            for (const [serializedKey, record] of storeData.records.entries()) {
                const rawKey = indexMeta
                    ? extractKeyPath(record, indexMeta.keyPath)
                    : storeData.keyPath
                        ? extractKeyPath(record, storeData.keyPath)
                        : serializedKey;
                if (rawKey === undefined && indexMeta) continue;
                if (keyMatchesQuery(rawKey, query)) {
                    entries.push({ serializedKey, sortKey: rawKey, record });
                }
            }
            entries.sort((a, b) => compareKeys(a.sortKey, b.sortKey));
            if (direction === 'prev' || direction === 'prevunique') {
                entries.reverse();
            }
            return entries;
        };

        const runCursor = (query, direction, indexMeta) => {
            const req = {
                result: null,
                error: null,
                onsuccess: null,
                onerror: null,
            };
            let idx = 0;
            let cachedEntries = null;

            const step = () => {
                scheduleOp(() => {
                    if (cachedEntries === null) {
                        cachedEntries = getMatchingEntries(query, indexMeta, direction);
                    }
                    if (idx >= cachedEntries.length) {
                        req.result = null;
                        req.onsuccess?.({ target: req });
                        return;
                    }
                    const current = cachedEntries[idx];
                    const cursor = {
                        key: current.sortKey,
                        primaryKey: storeData.keyPath
                            ? extractKeyPath(current.record, storeData.keyPath)
                            : current.serializedKey,
                        value: clonePreservingBlobs(current.record),
                        continue() {
                            idx += 1;
                            step();
                        },
                        delete() {
                            storeData.records.delete(current.serializedKey);
                            return createDoneRequest(undefined, scheduleOp);
                        },
                        update(newVal) {
                            storeData.records.set(current.serializedKey, clonePreservingBlobs(newVal));
                            return createDoneRequest(current.serializedKey, scheduleOp);
                        },
                    };
                    req.result = cursor;
                    req.onsuccess?.({ target: req });
                }, req);
            };
            step();
            return req;
        };

        return {
            get name() {
                return storeData.name;
            },
            get indexNames() {
                return makeDomStringList(() => Array.from(storeData.indexes.keys()));
            },
            createIndex(indexName, keyPath, options = {}) {
                const idxMeta = { name: indexName, keyPath, unique: !!options.unique };
                storeData.indexes.set(indexName, idxMeta);
                return idxMeta;
            },
            put(value, explicitKey) {
                const req = { result: undefined, error: null, onsuccess: null, onerror: null };
                scheduleOp(() => {
                    const cloned = clonePreservingBlobs(value);
                    const key = storeData.keyPath
                        ? extractKeyPath(cloned, storeData.keyPath)
                        : explicitKey;
                    const sKey = serializeKey(key);
                    storeData.records.set(sKey, cloned);
                    req.result = key;
                    req.onsuccess?.({ target: req });
                }, req);
                return req;
            },
            add(value, explicitKey) {
                const req = { result: undefined, error: null, onsuccess: null, onerror: null };
                scheduleOp(() => {
                    const cloned = clonePreservingBlobs(value);
                    const key = storeData.keyPath
                        ? extractKeyPath(cloned, storeData.keyPath)
                        : explicitKey;
                    const sKey = serializeKey(key);
                    if (storeData.records.has(sKey)) {
                        const err = new Error(`Key already exists in ${storeData.name}: ${sKey}`);
                        req.error = err;
                        tx.error = err;
                        req.onerror?.({ target: req });
                        return;
                    }
                    storeData.records.set(sKey, cloned);
                    req.result = key;
                    req.onsuccess?.({ target: req });
                }, req);
                return req;
            },
            get(key) {
                const req = { result: undefined, error: null, onsuccess: null, onerror: null };
                scheduleOp(() => {
                    const sKey = serializeKey(key);
                    const hit = storeData.records.get(sKey);
                    req.result = hit === undefined ? undefined : clonePreservingBlobs(hit);
                    req.onsuccess?.({ target: req });
                }, req);
                return req;
            },
            delete(key) {
                const req = { result: undefined, error: null, onsuccess: null, onerror: null };
                scheduleOp(() => {
                    storeData.records.delete(serializeKey(key));
                    req.result = undefined;
                    req.onsuccess?.({ target: req });
                }, req);
                return req;
            },
            clear() {
                const req = { result: undefined, error: null, onsuccess: null, onerror: null };
                scheduleOp(() => {
                    storeData.records.clear();
                    req.result = undefined;
                    req.onsuccess?.({ target: req });
                }, req);
                return req;
            },
            getAll(query) {
                const req = { result: [], error: null, onsuccess: null, onerror: null };
                scheduleOp(() => {
                    const entries = getMatchingEntries(query, null, 'next');
                    req.result = entries.map((e) => clonePreservingBlobs(e.record));
                    req.onsuccess?.({ target: req });
                }, req);
                return req;
            },
            count(query) {
                const req = { result: 0, error: null, onsuccess: null, onerror: null };
                scheduleOp(() => {
                    req.result = getMatchingEntries(query, null, 'next').length;
                    req.onsuccess?.({ target: req });
                }, req);
                return req;
            },
            openCursor(query, direction = 'next') {
                return runCursor(query, direction, null);
            },
            index(indexName) {
                const indexMeta = storeData.indexes.get(indexName);
                if (!indexMeta) {
                    throw new Error(`Index "${indexName}" not found in store "${storeData.name}"`);
                }
                return {
                    getAll(query) {
                        const req = { result: [], error: null, onsuccess: null, onerror: null };
                        scheduleOp(() => {
                            const entries = getMatchingEntries(query, indexMeta, 'next');
                            req.result = entries.map((e) => clonePreservingBlobs(e.record));
                            req.onsuccess?.({ target: req });
                        }, req);
                        return req;
                    },
                    get(query) {
                        const req = { result: undefined, error: null, onsuccess: null, onerror: null };
                        scheduleOp(() => {
                            const entries = getMatchingEntries(query, indexMeta, 'next');
                            req.result = entries.length > 0 ? clonePreservingBlobs(entries[0].record) : undefined;
                            req.onsuccess?.({ target: req });
                        }, req);
                        return req;
                    },
                    count(query) {
                        const req = { result: 0, error: null, onsuccess: null, onerror: null };
                        scheduleOp(() => {
                            req.result = getMatchingEntries(query, indexMeta, 'next').length;
                            req.onsuccess?.({ target: req });
                        }, req);
                        return req;
                    },
                    openCursor(query, direction = 'next') {
                        return runCursor(query, direction, indexMeta);
                    },
                };
            },
        };
    };

    function createDoneRequest(resultValue, scheduleOp) {
        const req = { result: undefined, error: null, onsuccess: null, onerror: null };
        scheduleOp(() => {
            req.result = resultValue;
            req.onsuccess?.({ target: req });
        }, req);
        return req;
    }

    const createDatabaseWrapper = (dbRecord) => {
        const txObjectStores = new Map();
        const dbWrapper = {
            get name() {
                return dbRecord.name;
            },
            get version() {
                return dbRecord.version;
            },
            get objectStoreNames() {
                return makeDomStringList(() => Array.from(dbRecord.stores.keys()));
            },
            close() {},
            createObjectStore(storeName, options = {}) {
                const storeData = {
                    name: storeName,
                    keyPath: options.keyPath ?? null,
                    autoIncrement: !!options.autoIncrement,
                    records: new Map(),
                    indexes: new Map(),
                };
                dbRecord.stores.set(storeName, storeData);
                return createObjectStoreWrapper(storeData, { error: null }, (fn) => queueMicrotask(fn));
            },
            deleteObjectStore(storeName) {
                dbRecord.stores.delete(storeName);
            },
            transaction(storeNames, mode = 'readonly') {
                const allowed = Array.isArray(storeNames) ? storeNames : [storeNames];
                let pendingOps = 0;
                let completionScheduled = false;
                let aborted = false;

                const tx = {
                    mode,
                    error: null,
                    oncomplete: null,
                    onerror: null,
                    onabort: null,
                    objectStore(name) {
                        if (!allowed.includes(name)) {
                            throw new Error(`Store "${name}" not included in transaction`);
                        }
                        const storeData = dbRecord.stores.get(name);
                        if (!storeData) {
                            throw new Error(`ObjectStore "${name}" does not exist`);
                        }
                        let wrapper = txObjectStores.get(`${name}:${mode}`);
                        if (!wrapper) {
                            wrapper = createObjectStoreWrapper(storeData, tx, scheduleOp);
                            txObjectStores.set(`${name}:${mode}`, wrapper);
                        }
                        return wrapper;
                    },
                    abort() {
                        aborted = true;
                        tx.onabort?.({ target: tx });
                    },
                };

                function maybeComplete() {
                    if (aborted || pendingOps > 0 || completionScheduled) return;
                    completionScheduled = true;
                    queueMicrotask(() => {
                        completionScheduled = false;
                        if (!aborted && pendingOps === 0) {
                            tx.oncomplete?.({ target: tx });
                        }
                    });
                }

                function scheduleOp(fn, req) {
                    pendingOps += 1;
                    queueMicrotask(() => {
                        try {
                            if (!aborted) {
                                fn();
                            }
                        } catch (err) {
                            if (req) {
                                req.error = err;
                                req.onerror?.({ target: req });
                            }
                            tx.error = err;
                            tx.onerror?.({ target: tx });
                        } finally {
                            pendingOps -= 1;
                            maybeComplete();
                        }
                    });
                }

                // Clear cached per-transaction wrappers after microtask frame if reused
                queueMicrotask(() => {
                    txObjectStores.clear();
                    if (pendingOps === 0) maybeComplete();
                });

                return tx;
            },
        };
        return dbWrapper;
    };

    return {
        open(name, requestedVersion = 1) {
            const req = {
                result: null,
                error: null,
                transaction: null,
                onsuccess: null,
                onerror: null,
                onupgradeneeded: null,
                onblocked: null,
            };

            queueMicrotask(() => {
                try {
                    let dbRecord = databases.get(name);
                    const oldVersion = dbRecord ? dbRecord.version : 0;
                    const needsUpgrade = !dbRecord || requestedVersion > dbRecord.version;

                    if (!dbRecord) {
                        dbRecord = {
                            name,
                            version: requestedVersion,
                            stores: new Map(),
                        };
                        databases.set(name, dbRecord);
                    } else if (requestedVersion > dbRecord.version) {
                        dbRecord.version = requestedVersion;
                    }

                    const dbWrapper = createDatabaseWrapper(dbRecord);
                    req.result = dbWrapper;

                    if (needsUpgrade) {
                        req.transaction = {
                            objectStore(storeName) {
                                const storeData = dbRecord.stores.get(storeName);
                                if (!storeData) throw new Error(`Missing store ${storeName}`);
                                return createObjectStoreWrapper(storeData, { error: null }, (fn) => queueMicrotask(fn));
                            },
                        };
                        req.onupgradeneeded?.({
                            target: req,
                            oldVersion,
                            newVersion: dbRecord.version,
                        });
                    }

                    req.onsuccess?.({ target: req });
                } catch (err) {
                    req.error = err;
                    req.onerror?.({ target: req });
                }
            });

            return req;
        },
        deleteDatabase(name) {
            const req = { result: undefined, error: null, onsuccess: null, onerror: null };
            queueMicrotask(() => {
                databases.delete(name);
                req.onsuccess?.({ target: req });
            });
            return req;
        },
        _dumpStores(name) {
            const db = databases.get(name);
            if (!db) return [];
            return Array.from(db.stores.keys());
        },
    };
}

function setupBrowserGlobals() {
    const storageMap = new Map();
    const localStorageMock = {
        get length() {
            return storageMap.size;
        },
        key(index) {
            return Array.from(storageMap.keys())[index] ?? null;
        },
        getItem(key) {
            return storageMap.has(String(key)) ? storageMap.get(String(key)) : null;
        },
        setItem(key, value) {
            storageMap.set(String(key), String(value));
        },
        removeItem(key) {
            storageMap.delete(String(key));
        },
        clear() {
            storageMap.clear();
        },
    };

    const listeners = new Map();
    const memIndexedDB = createMemoryIndexedDB();

    globalThis.IDBKeyRange = {
        only: (v) => ({ __only: v }),
        lowerBound: (low, open = false) => ({ __lower: [low, open] }),
        upperBound: (high, open = false) => ({ __upper: [high, open] }),
        bound: (low, high, lowOpen = false, highOpen = false) => ({
            __bound: [low, high, lowOpen, highOpen],
        }),
    };

    Object.defineProperty(globalThis, 'navigator', {
        value: { onLine: true },
        writable: true,
        configurable: true,
    });

    globalThis.localStorage = localStorageMock;
    globalThis.indexedDB = memIndexedDB;

    globalThis.document = {
        visibilityState: 'visible',
        addEventListener() {},
        removeEventListener() {},
    };

    globalThis.addEventListener = (type, fn) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
    };
    globalThis.removeEventListener = (type, fn) => {
        listeners.get(type)?.delete(fn);
    };
    globalThis.dispatchEvent = (event) => {
        const set = listeners.get(event?.type);
        if (set) {
            for (const fn of set) fn(event);
        }
        return true;
    };
    globalThis.window = globalThis;

    globalThis.__mockApi = {
        post: async () => ({ data: {} }),
        request: async () => ({ data: {} }),
        get: async () => ({ data: {} }),
        put: async () => ({ data: {} }),
        patch: async () => ({ data: {} }),
        delete: async () => ({ data: {} }),
    };

    return { memIndexedDB, localStorageMock };
}

async function bundleAndLoadModules() {
    const entrySource = `
export * from './src/services/offlineDb.ts';
export * from './src/services/syncEngine.ts';
export { useOfflineSyncStore } from './src/store/useOfflineSyncStore.ts';
`;

    const mockPlugin = {
        name: 'offline-test-mocks',
        setup(build) {
            build.onResolve({ filter: /(^|\/)api$/ }, () => ({
                path: 'mock-api',
                namespace: 'mock-api-ns',
            }));
            build.onLoad({ filter: /.*/, namespace: 'mock-api-ns' }, () => ({
                contents: `
const proxy = {
    get: (...args) => globalThis.__mockApi.get(...args),
    post: (...args) => globalThis.__mockApi.post(...args),
    put: (...args) => globalThis.__mockApi.put(...args),
    patch: (...args) => globalThis.__mockApi.patch(...args),
    delete: (...args) => globalThis.__mockApi.delete(...args),
    request: (...args) => globalThis.__mockApi.request(...args),
};
export default proxy;
`,
                loader: 'js',
            }));

            build.onResolve({ filter: /historicalBatchCache/ }, () => ({
                path: 'mock-historical-batch-cache',
                namespace: 'mock-hbc-ns',
            }));
            build.onLoad({ filter: /.*/, namespace: 'mock-hbc-ns' }, () => ({
                contents: `
export const getPendingSyncOutboxCount = async () => 0;
export const flushPendingSessionSyncQueue = async () => 0;
`,
                loader: 'js',
            }));
        },
    };

    await esbuild.build({
        stdin: {
            contents: entrySource,
            resolveDir: clientRoot,
            loader: 'ts',
        },
        bundle: true,
        format: 'esm',
        platform: 'node',
        outfile: tmpBundlePath,
        plugins: [mockPlugin],
        logLevel: 'silent',
    });

    return import(`${pathToFileURL(tmpBundlePath).href}?t=${Date.now()}`);
}

describe('IndexedDB Offline Database & Sync Engine', () => {
    let mod;
    let memIndexedDB;

    before(async () => {
        const env = setupBrowserGlobals();
        memIndexedDB = env.memIndexedDB;
        mod = await bundleAndLoadModules();
    });

    after(() => {
        if (fs.existsSync(tmpBundlePath)) {
            fs.unlinkSync(tmpBundlePath);
        }
    });

    it('creates IndexedDB v2 stores and supports CRUD across all structured entity stores while preserving pending temp accounts', async () => {
        const userScope = 'user-1';
        mod.rememberUserScope(userScope);
        assert.equal(mod.getCurrentUserScope(), userScope);

        const db = await mod.openOfflineDatabase();
        assert.ok(db, 'IndexedDB should open');
        assert.equal(db.version, 2);

        const expectedStores = [
            mod.STORE_ENTITIES_ACCOUNTS,
            mod.STORE_ENTITIES_TRANSACTIONS,
            mod.STORE_ENTITIES_JOURNAL,
            mod.STORE_ENTITIES_TRADES,
            mod.STORE_ENTITIES_USER_PROFILE,
            mod.STORE_HTTP_GET_CACHE,
            mod.STORE_MEDIA_OUTBOX,
            mod.STORE_SYNC_OUTBOX,
            mod.STORE_ID_MAPPINGS,
        ];
        for (const storeName of expectedStores) {
            assert.ok(db.objectStoreNames.contains(storeName), `Expected store ${storeName} to exist`);
        }

        // User Profile CRUD
        await mod.saveUserProfileInIDB(userScope, { id: userScope, username: 'trader_pro', locale: 'pt' });
        const profile = await mod.getUserProfileFromIDB(userScope);
        assert.equal(profile?.username, 'trader_pro');

        // Trades CRUD
        await mod.upsertTradesInIDB(userScope, [{ id: 'tr-1', symbol: 'XAUUSD', profit: 250.5 }]);
        const trade = await mod.getTradeFromIDB(userScope, 'tr-1');
        assert.equal(trade?.symbol, 'XAUUSD');
        assert.equal(trade?.profit, 250.5);

        // Journal CRUD
        await mod.upsertJournalEntityInIDB(userScope, 'daily', '2026-11-14', { mood: 'focused', notes: 'Disciplined' }, 'acc-1');
        await mod.upsertJournalEntityInIDB(userScope, 'general', 'note-1', { title: 'Checklist', content: 'Follow rules' }, 'acc-1');
        const dailyEntries = await mod.listJournalEntitiesFromIDB(userScope, 'daily');
        const generalEntries = await mod.listJournalEntitiesFromIDB(userScope, 'general');
        assert.equal(dailyEntries.length, 1);
        assert.equal(dailyEntries[0].data.mood, 'focused');
        assert.equal(generalEntries.length, 1);
        assert.equal(generalEntries[0].data.title, 'Checklist');

        // Transactions CRUD
        await mod.upsertTransactionsInIDB(userScope, 'acc-1', [
            { id: 'tx-1', type: 'DEPOSIT', amount: 1000 },
            { id: 'tx-2', type: 'WITHDRAWAL', amount: 200 },
        ]);
        const txs = await mod.listAccountTransactionsFromIDB(userScope, 'acc-1');
        assert.equal(txs.length, 2);

        // Accounts CRUD + replaceUserAccountsInIDB preserves pending tempEntityId account
        await mod.upsertAccountsInIDB(userScope, [
            { id: 'acc-1', name: 'Live Broker', balance: 5000 },
            { id: 'temp_acc_1', name: 'Offline Funded Account', balance: 100000 },
        ]);
        await mod.enqueueSyncMutation({
            userScope,
            entityType: 'account',
            tempEntityId: 'temp_acc_1',
            method: 'POST',
            url: '/accounts',
            body: { name: 'Offline Funded Account', balance: 100000 },
        });

        await mod.replaceUserAccountsInIDB(userScope, [
            { id: 'acc-1', name: 'Live Broker Updated', balance: 5200 },
        ]);

        const accountsAfterReplace = await mod.listUserAccountsFromIDB(userScope);
        const ids = accountsAfterReplace.map((a) => a.id).sort();
        assert.deepEqual(ids, ['acc-1', 'temp_acc_1']);
        assert.equal(accountsAfterReplace.find((a) => a.id === 'acc-1')?.balance, 5200);
        assert.ok(memIndexedDB._dumpStores('torex_offline_db_v1').length >= 9);
    });

    it('coalesces PUT/PATCH mutations by coalesceKey, folds PATCH into pending temp POST, and cancels unsynced POST on DELETE', async () => {
        const userScope = 'user-coalesce';
        mod.rememberUserScope(userScope);

        // 1. Two PATCHes with same coalesceKey merge into one
        await mod.enqueueSyncMutation({
            userScope,
            entityType: 'trade_note',
            coalesceKey: 'trade_meta:tr-99',
            method: 'PATCH',
            url: '/dashboard/trades/tr-99',
            body: { strategy: 'Breakout' },
        });
        await mod.enqueueSyncMutation({
            userScope,
            entityType: 'trade_note',
            coalesceKey: 'trade_meta:tr-99',
            method: 'PATCH',
            url: '/dashboard/trades/tr-99',
            body: { notes: 'Clean retest', rating: 5 },
        });

        let outbox = await mod.listSyncOutbox(userScope);
        assert.equal(outbox.length, 1);
        assert.equal(outbox[0].body.strategy, 'Breakout');
        assert.equal(outbox[0].body.notes, 'Clean retest');
        assert.equal(outbox[0].body.rating, 5);

        // 2. PATCH folds into pending tempEntityId POST
        await mod.enqueueSyncMutation({
            userScope,
            entityType: 'general_note',
            tempEntityId: 'temp_note_1',
            method: 'POST',
            url: '/dashboard/journal/general',
            body: { title: 'Initial Draft', content: 'v1' },
        });
        await mod.enqueueSyncMutation({
            userScope,
            entityType: 'general_note',
            tempEntityId: 'temp_note_1',
            coalesceKey: 'general_note:temp_note_1',
            method: 'PATCH',
            url: '/dashboard/journal/general/temp_note_1',
            body: { content: 'v2 edited offline' },
        });

        outbox = await mod.listSyncOutbox(userScope);
        assert.equal(outbox.length, 2);
        const pendingPost = outbox.find((m) => m.tempEntityId === 'temp_note_1');
        assert.ok(pendingPost);
        assert.equal(pendingPost.method, 'POST');
        assert.equal(pendingPost.body.title, 'Initial Draft');
        assert.equal(pendingPost.body.content, 'v2 edited offline');

        // 3. DELETE removes unsynced tempEntityId POST without queuing DELETE
        await mod.enqueueSyncMutation({
            userScope,
            entityType: 'general_note',
            tempEntityId: 'temp_note_1',
            method: 'DELETE',
            url: '/dashboard/journal/general/temp_note_1',
        });

        outbox = await mod.listSyncOutbox(userScope);
        assert.equal(outbox.length, 1);
        assert.equal(outbox.find((m) => m.tempEntityId === 'temp_note_1'), undefined);
    });

    it('flushes media_outbox before sync_outbox, replaces previewDataUrl, and remaps tempEntityId across dependent mutations and IDB accounts', async () => {
        const userScope = 'user-flush';
        mod.rememberUserScope(userScope);
        globalThis.localStorage.setItem('token', 'valid-token');
        globalThis.navigator.onLine = true;

        const previewUrl = 'data:image/png;base64,ZmFrZV9pbWFnZQ==';
        await mod.saveMediaOutboxItem({
            mediaId: 'med_1',
            userScope,
            blob: new Blob(['fake-image-bytes'], { type: 'image/png' }),
            fileName: 'setup.png',
            mimeType: 'image/png',
            previewDataUrl: previewUrl,
            targetEndpoint: '/dashboard/upload',
            uploadedUrl: null,
            createdAt: Date.now(),
        });

        await mod.upsertAccountsInIDB(userScope, [
            { id: 'temp_acc_99', name: 'Offline Prop', balance: 10000 },
        ]);

        await mod.enqueueSyncMutation({
            userScope,
            entityType: 'account',
            tempEntityId: 'temp_acc_99',
            method: 'POST',
            url: '/accounts',
            body: { name: 'Offline Prop', initialBalance: 10000 },
        });

        await mod.enqueueSyncMutation({
            userScope,
            entityType: 'transaction',
            method: 'POST',
            url: '/accounts/temp_acc_99/transactions',
            accountHeader: 'temp_acc_99',
            body: {
                amount: 500,
                accountId: 'temp_acc_99',
                screenshotUrl: previewUrl,
            },
        });

        const callLog = [];
        globalThis.__mockApi.post = async (url) => {
            callLog.push({ kind: 'media', url });
            return { data: { url: '/uploads/setup_synced.png' } };
        };
        globalThis.__mockApi.request = async (cfg) => {
            callLog.push({
                kind: 'mutation',
                method: cfg.method,
                url: cfg.url,
                headers: cfg.headers,
                data: cfg.data,
            });
            if (cfg.url === '/accounts' && cfg.method === 'POST') {
                return { data: { id: 'srv_acc_99', name: 'Offline Prop', balance: 10000 } };
            }
            if (cfg.url === '/accounts/srv_acc_99/transactions' && cfg.method === 'POST') {
                return { data: { id: 'srv_tx_1' } };
            }
            throw new Error(`Unexpected API call: ${cfg.method} ${cfg.url}`);
        };

        await mod.flushAllOfflineQueues();

        // Media upload ran before mutations
        assert.equal(callLog.length, 3);
        assert.equal(callLog[0].kind, 'media');
        assert.equal(callLog[0].url, '/dashboard/upload');

        // Account creation ran second and got server ID
        assert.equal(callLog[1].kind, 'mutation');
        assert.equal(callLog[1].url, '/accounts');

        // Transaction mutation got remapped URL, header, body accountId, AND uploaded screenshot URL
        assert.equal(callLog[2].kind, 'mutation');
        assert.equal(callLog[2].url, '/accounts/srv_acc_99/transactions');
        assert.equal(callLog[2].headers?.['x-account-id'], 'srv_acc_99');
        assert.equal(callLog[2].data?.accountId, 'srv_acc_99');
        assert.equal(callLog[2].data?.screenshotUrl, '/uploads/setup_synced.png');

        assert.equal((await mod.listPendingMediaOutbox(userScope)).length, 0);
        assert.equal((await mod.listSyncOutbox(userScope)).length, 0);
        assert.equal(await mod.resolveServerId('temp_acc_99'), 'srv_acc_99');

        const syncedAccounts = await mod.listUserAccountsFromIDB(userScope);
        assert.equal(syncedAccounts.some((a) => a.id === 'srv_acc_99'), true);
        assert.equal(syncedAccounts.some((a) => a.id === 'temp_acc_99'), false);
    });

    it('pauses sync with paused_auth on 401 without dropping queued mutations and resumes cleanly once token is restored', async () => {
        const userScope = 'user-auth-pause';
        mod.rememberUserScope(userScope);
        globalThis.localStorage.setItem('token', 'expired-token');
        globalThis.navigator.onLine = true;

        await mod.enqueueSyncMutation({
            userScope,
            entityType: 'general_note',
            coalesceKey: 'general_note:auth-test',
            method: 'POST',
            url: '/dashboard/journal/general',
            body: { title: 'Saved before 401', content: 'Preserved offline' },
        });

        globalThis.__mockApi.request = async () => {
            const err = new Error('Request failed with status code 401');
            err.isAxiosError = true;
            err.response = { status: 401, data: { message: 'Unauthorized' } };
            throw err;
        };

        await mod.flushAllOfflineQueues();

        assert.equal(mod.useOfflineSyncStore.getState().syncStatus, 'paused_auth');
        const pendingAfter401 = await mod.listSyncOutbox(userScope);
        assert.equal(pendingAfter401.length, 1);
        assert.equal(pendingAfter401[0].body.title, 'Saved before 401');

        // Simulate user logging back in with valid token and triggering sync again
        globalThis.localStorage.setItem('token', 'fresh-valid-token');
        let syncedPayloads = 0;
        globalThis.__mockApi.request = async () => {
            syncedPayloads += 1;
            return { data: { id: 'srv_note_auth_1' } };
        };

        await mod.flushAllOfflineQueues();

        assert.equal(syncedPayloads, 1);
        assert.equal((await mod.listSyncOutbox(userScope)).length, 0);
        assert.equal(mod.useOfflineSyncStore.getState().syncStatus, 'idle');
    });
});
