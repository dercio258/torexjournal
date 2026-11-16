import { create } from 'zustand';
import api from '../api';
import {
    BacktestReplaySession,
    BacktestStrategy,
    createBacktestSession,
    createBacktestStrategy,
    deleteBacktestSession,
    deleteBacktestStrategy,
    loadBacktestSessions,
    loadBacktestStrategies,
    pushSessionToBackend,
    syncBacktestWorkspaceFromBackend,
    updateBacktestSession,
    updateBacktestStrategy,
} from '../services/backtestWorkspaceStore';
import {
    flushPendingSessionSyncQueue,
    getLocalDbStorageStats,
    LocalDbStorageStats,
} from '../services/historicalBatchCache';
import { publishBacktestCrossTabEvent } from './useReplaySessionStore';

type CreateSessionInput = Parameters<typeof createBacktestSession>[0];

interface BacktestWorkspaceZustandState {
    strategies: BacktestStrategy[];
    sessions: BacktestReplaySession[];
    isCloudSyncing: boolean;
    lastCloudSyncedAt: number | null;
    localDbStats: LocalDbStorageStats;

    refreshFromLocal: () => void;
    refreshLocalDbStats: () => Promise<void>;
    syncWithBackendRedis: (force?: boolean) => Promise<void>;
    createStrategy: (input: Partial<BacktestStrategy>) => BacktestStrategy;
    updateStrategy: (id: string, patch: Partial<BacktestStrategy>, accountParam?: string) => void;
    deleteStrategy: (id: string) => void;
    createSession: (input: CreateSessionInput) => BacktestReplaySession;
    updateSession: (id: string, patch: Partial<BacktestReplaySession>, accountParam?: string) => void;
    deleteSession: (id: string) => void;
}

const FOCUS_CLOUD_SYNC_THROTTLE_MS = 10_000;
let syncInFlight = false;

export const useBacktestWorkspaceStore = create<BacktestWorkspaceZustandState>((set, get) => ({
    strategies: loadBacktestStrategies(),
    sessions: loadBacktestSessions(),
    isCloudSyncing: false,
    lastCloudSyncedAt: null,
    localDbStats: {
        candleBatchesCount: 0,
        totalCachedCandles: 0,
        encryptedSessionsCount: 0,
        pendingOutboxCount: 0,
    },

    refreshFromLocal: () => {
        set({
            strategies: loadBacktestStrategies(),
            sessions: loadBacktestSessions(),
        });
    },

    refreshLocalDbStats: async () => {
        const stats = await getLocalDbStorageStats();
        set({ localDbStats: stats });
    },

    syncWithBackendRedis: async (force = false) => {
        const now = Date.now();
        const { lastCloudSyncedAt } = get();
        if (syncInFlight) return;
        if (!force && lastCloudSyncedAt && now - lastCloudSyncedAt < FOCUS_CLOUD_SYNC_THROTTLE_MS) {
            return;
        }

        syncInFlight = true;
        set({ isCloudSyncing: true });
        try {
            await flushPendingSessionSyncQueue();
            const { strategies, sessions } = await syncBacktestWorkspaceFromBackend(api);
            const stats = await getLocalDbStorageStats();
            set({
                strategies,
                sessions,
                lastCloudSyncedAt: Date.now(),
                localDbStats: stats,
            });
        } catch (_) {
            const stats = await getLocalDbStorageStats();
            set({ localDbStats: stats });
        } finally {
            syncInFlight = false;
            set({ isCloudSyncing: false });
        }
    },

    createStrategy: (input) => {
        const created = createBacktestStrategy(input);
        set({ strategies: loadBacktestStrategies() });
        publishBacktestCrossTabEvent({
            type: 'SESSION_UPDATED',
            sessionId: created.id,
            revision: 1,
            updatedAtMs: Date.now(),
        });
        return created;
    },

    updateStrategy: (id, patch, accountParam) => {
        const nextStrategies = updateBacktestStrategy(id, patch);
        set({ strategies: nextStrategies });

        if (patch.name) {
            loadBacktestSessions()
                .filter((s) => s.strategyId === id)
                .forEach((s) => {
                    const updatedSess = updateBacktestSession(s.id, { strategyName: patch.name });
                    if (updatedSess) {
                        void pushSessionToBackend(updatedSess, api, accountParam).catch(() => {});
                    }
                });
            set({ sessions: loadBacktestSessions() });
        }

        publishBacktestCrossTabEvent({
            type: 'SESSION_UPDATED',
            sessionId: id,
            revision: Date.now(),
            updatedAtMs: Date.now(),
        });
    },

    deleteStrategy: (id) => {
        set({ strategies: deleteBacktestStrategy(id) });
        publishBacktestCrossTabEvent({
            type: 'SESSION_UPDATED',
            sessionId: id,
            revision: Date.now(),
            updatedAtMs: Date.now(),
        });
    },

    createSession: (input) => {
        const created = createBacktestSession(input);
        set({ sessions: loadBacktestSessions() });
        publishBacktestCrossTabEvent({
            type: 'SESSION_UPDATED',
            sessionId: created.id,
            revision: created.revision || 1,
            updatedAtMs: Date.now(),
        });
        return created;
    },

    updateSession: (id, patch, accountParam) => {
        const updated = updateBacktestSession(id, patch);
        set({ sessions: loadBacktestSessions() });
        if (updated) {
            void pushSessionToBackend(updated, api, accountParam).catch(() => {});
            publishBacktestCrossTabEvent({
                type: 'SESSION_UPDATED',
                sessionId: id,
                revision: updated.revision || 1,
                updatedAtMs: Date.now(),
            });
        }
    },

    deleteSession: (id) => {
        set({ sessions: deleteBacktestSession(id) });
        publishBacktestCrossTabEvent({
            type: 'SESSION_UPDATED',
            sessionId: id,
            revision: Date.now(),
            updatedAtMs: Date.now(),
        });
    },
}));
