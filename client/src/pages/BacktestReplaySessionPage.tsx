import React, { useMemo, useCallback, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { KLineChartProTerminal, SessionStateSyncPayload } from '../components/KLineChartProTerminal';
import {
    getBacktestSessionById,
    loadBacktestSessions,
    saveBacktestSessions,
    loadBacktestStrategies,
    updateBacktestSession,
    BacktestReplaySession,
} from '../services/backtestWorkspaceStore';
import { useAccount } from '../context/AccountContext';
import api from '../api';

export const BacktestReplaySessionPage: React.FC = () => {
    const { sessionId } = useParams<{ sessionId: string }>();
    const navigate = useNavigate();
    const { selectedAccountId } = useAccount();
    const [isFullscreen, setIsFullscreen] = useState(false);

    const session = useMemo<BacktestReplaySession>(() => {
        const targetId = sessionId || '79d78fe0-71ab-4441-9aec-73ee8c00c5bc';
        const existing = getBacktestSessionById(targetId);
        if (existing) return existing;

        const strategies = loadBacktestStrategies();
        const strat = strategies[0];
        const now = new Date();
        const twoWeeksAgo = new Date(Date.now() - 86400000 * 14);
        const created: BacktestReplaySession = {
            id: targetId,
            name: `Sessão Replay #${targetId.slice(0, 6).toUpperCase()}`,
            strategyId: strat.id,
            strategyName: strat.name,
            status: 'ACTIVE',
            primarySymbol: strat.primarySymbol || 'XAUUSD',
            pairs: strat.symbols?.length ? strat.symbols : ['XAUUSD', 'GBPUSD', 'EURUSD'],
            timeframe: '15m',
            secondaryTimeframe: '1h',
            fromDate: twoWeeksAgo.toISOString().slice(0, 10),
            toDate: now.toISOString().slice(0, 10),
            keepEndFollowingToday: true,
            randomStartDate: false,
            startingCapital: strat.startingCapital || 100000,
            riskPerTrade: strat.riskPerTrade || 1.0,
            rrTarget: strat.rrTarget || 2.0,
            fundedMode: {
                enabled: false,
                profitTargetPct: 10,
                maxDailyLossPct: 5,
                maxTotalLossPct: 10,
            },
            currentBalance: strat.startingCapital || 100000,
            netPnl: 0,
            closedTradesCount: 0,
            winsCount: 0,
            lossesCount: 0,
            winRate: 0,
            profitFactor: 0,
            expectancy: 0,
            avgR: 0,
            maxDrawdown: 0,
            maxDrawdownPct: 0,
            timeInvestedSeconds: 0,
            orders: [],
            journalNotes: '',
            replayTimestamp: null,
            spread: 0,
            commission: 0,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
        };
        const all = loadBacktestSessions();
        saveBacktestSessions([created, ...all]);
        return created;
    }, [sessionId]);

    const handleSessionStateSync = useCallback(
        (payload: SessionStateSyncPayload) => {
            const current = getBacktestSessionById(session.id);
            const prevTime = current?.timeInvestedSeconds || session.timeInvestedSeconds || 0;
            updateBacktestSession(session.id, {
                currentBalance: payload.currentBalance,
                netPnl: payload.netPnl,
                closedTradesCount: payload.closedTradesCount,
                winsCount: payload.winsCount,
                lossesCount: payload.lossesCount,
                winRate: payload.winRate,
                profitFactor: payload.profitFactor,
                expectancy: payload.expectancy,
                avgR: payload.avgR,
                maxDrawdown: payload.maxDrawdown,
                maxDrawdownPct: payload.maxDrawdownPct,
                orders: payload.orders,
                journalNotes: payload.journalNotes,
                replayTimestamp: payload.replayTimestamp,
                primarySymbol: payload.primarySymbol,
                timeframe: payload.timeframe,
                spread: payload.spread,
                commission: payload.commission,
                timeInvestedSeconds: prevTime + (payload.deltaSeconds || 0),
            });
        },
        [session.id, session.timeInvestedSeconds]
    );

    const handleSaveReplaySessionToBackend = useCallback(
        async (sessionPayload: any) => {
            await api.post(
                '/dashboard/backtest/save',
                {
                    ...sessionPayload,
                    name: session.name,
                    strategy: session.strategyName,
                },
                {
                    params: { accountId: selectedAccountId !== 'all' ? selectedAccountId : undefined },
                }
            );
        },
        [session.name, session.strategyName, selectedAccountId]
    );

    return (
        <div className={isFullscreen ? 'w-full h-full' : 'w-full mx-auto'}>
            <KLineChartProTerminal
                key={session.id}
                sessionId={session.id}
                sessionName={session.name}
                strategyName={session.strategyName}
                sessionPairs={session.pairs}
                initialSymbolTicker={session.primarySymbol}
                initialPeriodText={session.timeframe}
                initialRiskPercent={session.riskPerTrade}
                initialRrTarget={session.rrTarget}
                initialOrders={session.orders}
                initialJournalNotes={session.journalNotes}
                initialReplayTimestamp={session.replayTimestamp}
                initialBalance={session.startingCapital}
                accountName={`${session.name} (${session.strategyName})`}
                onBackToHub={() => navigate('/backtesting?tab=sessions')}
                onSessionStateSync={handleSessionStateSync}
                onSaveReplaySession={handleSaveReplaySessionToBackend}
                onFullscreenChange={setIsFullscreen}
            />
        </div>
    );
};
