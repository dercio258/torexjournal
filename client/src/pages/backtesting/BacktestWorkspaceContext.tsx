import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { useAccount } from '../../context/AccountContext';
import {
    BacktestReplaySession,
    BacktestStrategy,
    createBacktestSession,
} from '../../services/backtestWorkspaceStore';
import { LocalDbStorageStats } from '../../services/historicalBatchCache';
import { useBacktestWorkspaceStore } from '../../store/useBacktestWorkspaceStore';
import { subscribeBacktestCrossTabEvents } from '../../store/useReplaySessionStore';

type CreateSessionInput = Parameters<typeof createBacktestSession>[0];

interface WorkspaceValue {
    strategies: BacktestStrategy[];
    sessions: BacktestReplaySession[];
    isCloudSyncing: boolean;
    localDbStats: LocalDbStorageStats;
    refresh: () => void;
    strategyById: (id?: string | null) => BacktestStrategy | undefined;
    sessionById: (id?: string | null) => BacktestReplaySession | undefined;
    createStrategy: (input: Partial<BacktestStrategy>) => BacktestStrategy;
    updateStrategy: (id: string, patch: Partial<BacktestStrategy>) => void;
    deleteStrategy: (id: string) => void;
    createSession: (input: CreateSessionInput) => BacktestReplaySession;
    updateSession: (id: string, patch: Partial<BacktestReplaySession>) => void;
    deleteSession: (id: string) => void;
}

const Ctx = createContext<WorkspaceValue | null>(null);

/**
 * Unified Zustand-backed provider of the Backtesting Workspace (strategies + replay
 * sessions + Local IndexedDB telemetry + Redis/PostgreSQL sync + Cross-Tab BroadcastChannel).
 */
export const BacktestWorkspaceProvider = ({ children }: { children: React.ReactNode }) => {
    const { selectedAccountId } = useAccount();
    const strategies = useBacktestWorkspaceStore((s) => s.strategies);
    const sessions = useBacktestWorkspaceStore((s) => s.sessions);
    const isCloudSyncing = useBacktestWorkspaceStore((s) => s.isCloudSyncing);
    const localDbStats = useBacktestWorkspaceStore((s) => s.localDbStats);
    const refreshFromLocal = useBacktestWorkspaceStore((s) => s.refreshFromLocal);
    const refreshLocalDbStats = useBacktestWorkspaceStore((s) => s.refreshLocalDbStats);
    const syncWithBackendRedis = useBacktestWorkspaceStore((s) => s.syncWithBackendRedis);
    const createStrategyAction = useBacktestWorkspaceStore((s) => s.createStrategy);
    const updateStrategyAction = useBacktestWorkspaceStore((s) => s.updateStrategy);
    const deleteStrategyAction = useBacktestWorkspaceStore((s) => s.deleteStrategy);
    const createSessionAction = useBacktestWorkspaceStore((s) => s.createSession);
    const updateSessionAction = useBacktestWorkspaceStore((s) => s.updateSession);
    const deleteSessionAction = useBacktestWorkspaceStore((s) => s.deleteSession);

    useEffect(() => {
        void syncWithBackendRedis(true);
        void refreshLocalDbStats();
    }, [selectedAccountId, syncWithBackendRedis, refreshLocalDbStats]);

    useEffect(() => {
        const onFocus = () => {
            refreshFromLocal();
            void syncWithBackendRedis(false);
        };
        const onVisible = () => {
            if (document.visibilityState === 'visible') {
                refreshFromLocal();
                void syncWithBackendRedis(false);
            }
        };
        const unsubscribeCrossTab = subscribeBacktestCrossTabEvents(() => {
            refreshFromLocal();
            void refreshLocalDbStats();
        });

        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('storage', refreshFromLocal);
        window.addEventListener('torex:backtest-workspace-updated', refreshFromLocal);

        return () => {
            unsubscribeCrossTab();
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('storage', refreshFromLocal);
            window.removeEventListener('torex:backtest-workspace-updated', refreshFromLocal);
        };
    }, [refreshFromLocal, refreshLocalDbStats, syncWithBackendRedis]);

    const accountParam =
        selectedAccountId && selectedAccountId !== 'all' ? selectedAccountId : undefined;

    const value = useMemo<WorkspaceValue>(
        () => ({
            strategies,
            sessions,
            isCloudSyncing,
            localDbStats,
            refresh: refreshFromLocal,
            strategyById: (id) => strategies.find((s) => s.id === id),
            sessionById: (id) => sessions.find((s) => s.id === id),
            createStrategy: (input) => createStrategyAction(input),
            updateStrategy: (id, patch) => updateStrategyAction(id, patch, accountParam),
            deleteStrategy: (id) => deleteStrategyAction(id),
            createSession: (input) => createSessionAction(input),
            updateSession: (id, patch) => updateSessionAction(id, patch, accountParam),
            deleteSession: (id) => deleteSessionAction(id),
        }),
        [
            strategies,
            sessions,
            isCloudSyncing,
            localDbStats,
            refreshFromLocal,
            createStrategyAction,
            updateStrategyAction,
            deleteStrategyAction,
            createSessionAction,
            updateSessionAction,
            deleteSessionAction,
            accountParam,
        ]
    );

    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const useBacktestWorkspace = () => {
    const v = useContext(Ctx);
    if (!v) throw new Error('useBacktestWorkspace must be used inside BacktestWorkspaceProvider');
    return v;
};
