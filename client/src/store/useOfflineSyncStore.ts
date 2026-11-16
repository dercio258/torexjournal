import { create } from 'zustand';
import {
    getCurrentUserScope,
    listPendingMediaOutbox,
    listSyncOutbox,
    removeSyncOutboxItem,
    SyncOutboxItem,
    updateSyncOutboxItem,
} from '../services/offlineDb';
import { getPendingSyncOutboxCount } from '../services/historicalBatchCache';

export type OfflineSyncStatus =
    | 'idle'
    | 'syncing'
    | 'offline'
    | 'paused_auth'
    | 'has_errors';

interface OfflineSyncStoreState {
    isOnline: boolean;
    isSyncing: boolean;
    syncStatus: OfflineSyncStatus;
    pendingMutationsCount: number;
    pendingMediaCount: number;
    backtestPendingCount: number;
    failedMutations: SyncOutboxItem[];
    lastSyncedAt: number | null;
    justSyncedBannerUntil: number | null;

    setOnlineStatus: (online: boolean) => void;
    setSyncState: (
        patch: Partial<
            Pick<
                OfflineSyncStoreState,
                | 'isSyncing'
                | 'syncStatus'
                | 'lastSyncedAt'
                | 'justSyncedBannerUntil'
            >
        >
    ) => void;
    refreshCounts: () => Promise<void>;
    triggerSync: () => Promise<void>;
    retryFailedMutation: (mutationId: string) => Promise<void>;
    discardFailedMutation: (mutationId: string) => Promise<void>;
}

let syncTriggerCallback: (() => Promise<void>) | null = null;

export function registerSyncTriggerHandler(handler: () => Promise<void>) {
    syncTriggerCallback = handler;
}

export const useOfflineSyncStore = create<OfflineSyncStoreState>((set, get) => ({
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    isSyncing: false,
    syncStatus:
        typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'idle',
    pendingMutationsCount: 0,
    pendingMediaCount: 0,
    backtestPendingCount: 0,
    failedMutations: [],
    lastSyncedAt: null,
    justSyncedBannerUntil: null,

    setOnlineStatus: (online) => {
        set((state) => {
            let nextStatus = state.syncStatus;
            if (!online) {
                nextStatus = 'offline';
            } else if (state.syncStatus === 'offline') {
                if (state.isSyncing) nextStatus = 'syncing';
                else if (state.failedMutations.length > 0) nextStatus = 'has_errors';
                else nextStatus = 'idle';
            }
            return { isOnline: online, syncStatus: nextStatus };
        });
    },

    setSyncState: (patch) => set((state) => ({ ...state, ...patch })),

    refreshCounts: async () => {
        const userScope = getCurrentUserScope();
        const [queue, pendingMedia, backtestCount] = await Promise.all([
            listSyncOutbox(userScope),
            listPendingMediaOutbox(userScope),
            getPendingSyncOutboxCount(),
        ]);

        const pendingOutbox = queue.filter((q) => q.status === 'pending');
        const failed = queue.filter((q) => q.status === 'failed_permanent');
        const totalPending = pendingOutbox.length + backtestCount;

        set((state) => {
            let nextStatus = state.syncStatus;
            if (!state.isOnline) {
                nextStatus = 'offline';
            } else if (state.isSyncing) {
                nextStatus = 'syncing';
            } else if (state.syncStatus === 'paused_auth' && totalPending > 0) {
                nextStatus = 'paused_auth';
            } else if (failed.length > 0) {
                nextStatus = 'has_errors';
            } else {
                nextStatus = 'idle';
            }

            return {
                pendingMutationsCount: totalPending,
                pendingMediaCount: pendingMedia.length,
                backtestPendingCount: backtestCount,
                failedMutations: failed,
                syncStatus: nextStatus,
            };
        });
    },

    triggerSync: async () => {
        if (syncTriggerCallback) {
            await syncTriggerCallback();
        }
    },

    retryFailedMutation: async (mutationId) => {
        const userScope = getCurrentUserScope();
        const queue = await listSyncOutbox(userScope);
        const target = queue.find((item) => item.mutationId === mutationId);
        if (!target) return;

        await updateSyncOutboxItem({
            ...target,
            status: 'pending',
            attempts: 0,
            lastError: undefined,
        });
        await get().refreshCounts();
        await get().triggerSync();
    },

    discardFailedMutation: async (mutationId) => {
        await removeSyncOutboxItem(mutationId);
        await get().refreshCounts();
    },
}));
