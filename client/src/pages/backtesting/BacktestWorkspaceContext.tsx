import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
    BacktestReplaySession,
    BacktestStrategy,
    createBacktestSession,
    createBacktestStrategy,
    deleteBacktestSession,
    deleteBacktestStrategy,
    loadBacktestSessions,
    loadBacktestStrategies,
    updateBacktestSession,
    updateBacktestStrategy,
} from '../../services/backtestWorkspaceStore';

type CreateSessionInput = Parameters<typeof createBacktestSession>[0];

interface WorkspaceValue {
    strategies: BacktestStrategy[];
    sessions: BacktestReplaySession[];
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
 * Single in-memory view of the backtesting workspace (strategies + replay
 * sessions) shared by the hub header and every sub-page. The replay terminal
 * writes to the same store, so we re-read when the tab regains focus.
 */
export const BacktestWorkspaceProvider = ({ children }: { children: React.ReactNode }) => {
    const [strategies, setStrategies] = useState<BacktestStrategy[]>(() => loadBacktestStrategies());
    const [sessions, setSessions] = useState<BacktestReplaySession[]>(() => loadBacktestSessions());

    const refresh = useCallback(() => {
        setStrategies(loadBacktestStrategies());
        setSessions(loadBacktestSessions());
    }, []);

    useEffect(() => {
        const onVisible = () => document.visibilityState === 'visible' && refresh();
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('storage', refresh);
        return () => {
            window.removeEventListener('focus', refresh);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('storage', refresh);
        };
    }, [refresh]);

    const value = useMemo<WorkspaceValue>(
        () => ({
            strategies,
            sessions,
            refresh,
            strategyById: (id) => strategies.find((s) => s.id === id),
            sessionById: (id) => sessions.find((s) => s.id === id),
            createStrategy: (input) => {
                const created = createBacktestStrategy(input);
                setStrategies(loadBacktestStrategies());
                return created;
            },
            updateStrategy: (id, patch) => {
                setStrategies(updateBacktestStrategy(id, patch));
                // Sessions display the strategy name: keep it in sync.
                if (patch.name) {
                    loadBacktestSessions()
                        .filter((s) => s.strategyId === id)
                        .forEach((s) => updateBacktestSession(s.id, { strategyName: patch.name }));
                    setSessions(loadBacktestSessions());
                }
            },
            deleteStrategy: (id) => setStrategies(deleteBacktestStrategy(id)),
            createSession: (input) => {
                const created = createBacktestSession(input);
                setSessions(loadBacktestSessions());
                return created;
            },
            updateSession: (id, patch) => {
                updateBacktestSession(id, patch);
                setSessions(loadBacktestSessions());
            },
            deleteSession: (id) => setSessions(deleteBacktestSession(id)),
        }),
        [strategies, sessions, refresh]
    );

    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const useBacktestWorkspace = () => {
    const v = useContext(Ctx);
    if (!v) throw new Error('useBacktestWorkspace must be used inside BacktestWorkspaceProvider');
    return v;
};
