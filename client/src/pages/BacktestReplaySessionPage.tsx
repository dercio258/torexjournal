import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { KLineChartProTerminal, SessionStateSyncPayload } from '../components/KLineChartProTerminal';
import {
    getBacktestSessionById,
    loadBacktestSessions,
    saveBacktestSessions,
    loadBacktestStrategies,
    updateBacktestSession,
    BacktestReplaySession,
} from '../services/backtestWorkspaceStore';
import {
    BACKTEST_SNAPSHOT_SCHEMA_VERSION,
    normalizeSnapshotToV2,
    pickNewestSnapshot,
    readLocalReplaySnapshot,
    writeLocalReplaySnapshot,
} from '../services/backtestSessionSnapshot';
import {
    fetchSessionFromBackendRedisPostgres,
    flushSessionBeforeUnload,
    loadEncryptedSessionFromIDB,
    saveEncryptedSessionToIDB,
    SessionVaultData,
    syncSessionToBackendRedisPostgres,
} from '../services/historicalBatchCache';
import { useAccount } from '../context/AccountContext';
import { getCurrentLocale } from '../context/LocaleContext';
import { ReplayTerminalSkeleton } from '../components/ui/Skeleton';
import api from '../api';

export const BacktestReplaySessionPage: React.FC = () => {
    const { sessionId } = useParams<{ sessionId: string }>();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { selectedAccountId } = useAccount();
    const [, setIsFullscreen] = useState(false);

    const deepLinkSymbol = searchParams.get('symbol')?.trim().toUpperCase() || undefined;
    const deepLinkTf = searchParams.get('tf')?.trim() || undefined;
    const deepLinkTradeId = searchParams.get('tradeId')?.trim() || undefined;
    const rawDeepLinkTs = Number(searchParams.get('ts'));
    const deepLinkTimestamp =
        Number.isFinite(rawDeepLinkTs) && rawDeepLinkTs > 0 ? rawDeepLinkTs : undefined;

    const { session, needsInitialPersist } = useMemo<{
        session: BacktestReplaySession;
        needsInitialPersist: boolean;
    }>(() => {
        const targetId = sessionId || '79d78fe0-71ab-4441-9aec-73ee8c00c5bc';
        const existing = getBacktestSessionById(targetId);
        if (existing) return { session: existing, needsInitialPersist: false };

        const isEn = getCurrentLocale() === 'en';
        const strategies = loadBacktestStrategies();
        const strat = strategies[0];
        const now = new Date();
        const twoWeeksAgo = new Date(Date.now() - 86400000 * 14);
        const created: BacktestReplaySession = {
            id: targetId,
            name: isEn
                ? `Replay Session #${targetId.slice(0, 6).toUpperCase()}`
                : `Sessão Replay #${targetId.slice(0, 6).toUpperCase()}`,
            strategyId: strat?.id || 'default-strategy',
            strategyName: strat?.name || 'Playbook',
            status: 'ACTIVE',
            primarySymbol: strat?.primarySymbol || 'XAUUSD',
            pairs: strat?.symbols?.length ? strat.symbols : ['XAUUSD', 'GBPUSD', 'EURUSD'],
            timeframe: strat?.defaultTimeframe || '15m',
            secondaryTimeframe: '1h',
            fromDate: twoWeeksAgo.toISOString().slice(0, 10),
            toDate: now.toISOString().slice(0, 10),
            keepEndFollowingToday: true,
            randomStartDate: false,
            startingCapital: strat?.startingCapital || 100000,
            riskPerTrade: strat?.riskPerTrade || 1.0,
            rrTarget: strat?.rrTarget || 2.0,
            fundedMode: {
                enabled: false,
                profitTargetPct: 10,
                maxDailyLossPct: 5,
                maxTotalLossPct: 10,
            },
            currentBalance: strat?.startingCapital || 100000,
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
        return { session: created, needsInitialPersist: true };
    }, [sessionId]);

    useEffect(() => {
        if (!needsInitialPersist) return;
        const alreadyStored = getBacktestSessionById(session.id);
        if (!alreadyStored) {
            const all = loadBacktestSessions();
            saveBacktestSessions([session, ...all]);
        }
    }, [needsInitialPersist, session]);

    const isHydratingRef = useRef<boolean>(true);
    const [resolvedSession, setResolvedSession] = useState<BacktestReplaySession | null>(null);

    const latestVaultRef = useRef<SessionVaultData>({
        schemaVersion: BACKTEST_SNAPSHOT_SCHEMA_VERSION,
        revision: session.revision ?? 0,
        sessionId: session.id,
        name: session.name,
        strategyName: session.strategyName,
        primarySymbol: session.primarySymbol,
        timeframe: session.timeframe,
        secondaryTimeframe: session.secondaryTimeframe,
        auxPeriodTexts: session.auxPeriodTexts,
        timezone: session.timezone,
        dataSource: session.dataSource,
        layoutMode: session.layoutMode,
        selectedCandleStyle: session.selectedCandleStyle,
        replayActive: session.replayActive,
        syncEnabled: session.syncEnabled,
        yAxis: session.yAxis,
        drawingTools: session.drawingTools,
        ticketDefaults: session.ticketDefaults,
        pairs: session.pairs,
        fromDate: session.fromDate,
        toDate: session.toDate,
        orders: session.orders,
        drawings: session.drawings,
        drawnItems: session.drawnItems,
        drawingStylesById: session.drawingStylesById,
        overlayGeometries: session.overlayGeometries,
        activeIndicators: session.activeIndicators,
        indicatorParamsByCode: session.indicatorParamsByCode,
        sessionScreenshots: session.sessionScreenshots,
        journalNotes: session.journalNotes,
        journalTitle: session.journalTitle,
        journalMarketBias: session.journalMarketBias,
        journalPsychCheck: session.journalPsychCheck,
        journalImages: session.journalImages,
        replayTimestamp: session.replayTimestamp,
        currentBalance: session.currentBalance,
        netPnl: session.netPnl,
        closedTradesCount: session.closedTradesCount,
        winsCount: session.winsCount,
        lossesCount: session.lossesCount,
        winRate: session.winRate,
        profitFactor: session.profitFactor,
        expectancy: session.expectancy,
        avgR: session.avgR,
        maxDrawdown: session.maxDrawdown,
        maxDrawdownPct: session.maxDrawdownPct,
        timeInvestedSeconds: session.timeInvestedSeconds,
        spread: session.spread,
        commission: session.commission,
    });

    // Deterministic Pre-Mount Hydration Gate:
    // Resolves max(revision, updatedAtMs) across Local Vault, Workspace Store, Encrypted IndexedDB, and Redis/PostgreSQL
    // BEFORE mounting KLineChartProTerminal so auto-save never overwrites newer state.
    useEffect(() => {
        let active = true;
        isHydratingRef.current = true;
        setResolvedSession(null);

        (async () => {
            const localTerminalSnap = readLocalReplaySnapshot(session.id);
            const workspaceHubSnap = normalizeSnapshotToV2(session, session.id);

            const timeoutFallback: [
                { data: SessionVaultData | null; digestHex: string; updatedAt: number | null },
                any | null,
            ] = [{ data: null, digestHex: '', updatedAt: null }, null];

            const knownFullRevision = session._isSlimSummary
                ? localTerminalSnap?.revision
                : Math.max(localTerminalSnap?.revision ?? 0, workspaceHubSnap?.revision ?? 0);

            const [idbVault, remoteSession] = await Promise.race([
                Promise.all([
                    loadEncryptedSessionFromIDB(session.id),
                    fetchSessionFromBackendRedisPostgres(session.id, knownFullRevision),
                ]),
                new Promise<typeof timeoutFallback>((resolve) =>
                    setTimeout(() => resolve(timeoutFallback), 6000)
                ),
            ]);
            if (!active) return;

            const vaultData = idbVault.data;
            const validRemoteSession =
                remoteSession && !remoteSession.unchanged ? remoteSession : null;
            const remoteCfg = validRemoteSession?.config || {};

            const idbSnap = vaultData
                ? normalizeSnapshotToV2(
                      {
                          ...vaultData,
                          updatedAtMs: idbVault.updatedAt ?? undefined,
                      },
                      session.id
                  )
                : null;

            const remoteSnap = validRemoteSession
                ? normalizeSnapshotToV2(
                      {
                          ...remoteCfg,
                          primarySymbol: validRemoteSession.symbol || remoteCfg.primarySymbol || session.primarySymbol,
                          journalNotes: validRemoteSession.notes ?? remoteCfg.journalNotes ?? session.journalNotes,
                          updatedAt: validRemoteSession.updatedAt,
                      },
                      session.id
                  )
                : null;

            const isSlimHubSnap =
                (session._isSlimSummary || (workspaceHubSnap?.orders?.length ?? 0) === 0) &&
                Boolean(localTerminalSnap || idbSnap || remoteSnap);

            const winner = pickNewestSnapshot(
                localTerminalSnap,
                idbSnap,
                remoteSnap,
                isSlimHubSnap ? null : workspaceHubSnap
            );

            if (winner) {
                // Preserve full IndexedDB screenshot set when localStorage capped inline screenshots to 3
                const bestScreenshots =
                    Array.isArray(vaultData?.sessionScreenshots) &&
                    vaultData.sessionScreenshots.length > winner.sessionScreenshots.length
                        ? vaultData.sessionScreenshots
                        : winner.sessionScreenshots;

                const canonicalWinner = {
                    ...winner,
                    sessionScreenshots: bestScreenshots,
                };

                const resolvedBalance =
                    vaultData?.currentBalance ??
                    validRemoteSession?.results?.currentBalance ??
                    session.currentBalance;
                const resolvedNetPnl =
                    vaultData?.netPnl ?? validRemoteSession?.results?.netPnl ?? session.netPnl;
                const resolvedTimeInvested = Math.max(
                    session.timeInvestedSeconds || 0,
                    vaultData?.timeInvestedSeconds || 0,
                    Number(remoteCfg.timeInvestedSeconds) || 0
                );

                const sessionPatch: Partial<BacktestReplaySession> = {
                    schemaVersion: BACKTEST_SNAPSHOT_SCHEMA_VERSION,
                    revision: canonicalWinner.revision,
                    primarySymbol: canonicalWinner.ticker || session.primarySymbol,
                    timeframe: canonicalWinner.periodText || session.timeframe,
                    secondaryTimeframe: canonicalWinner.secondaryPeriodText || session.secondaryTimeframe,
                    auxPeriodTexts: canonicalWinner.auxPeriodTexts ?? session.auxPeriodTexts,
                    timezone: canonicalWinner.timezone ?? session.timezone,
                    dataSource: canonicalWinner.dataSource,
                    layoutMode: canonicalWinner.layoutMode,
                    selectedCandleStyle: canonicalWinner.selectedCandleStyle,
                    replayActive: canonicalWinner.replayActive,
                    syncEnabled: canonicalWinner.syncEnabled,
                    yAxis: canonicalWinner.yAxis,
                    drawingTools: canonicalWinner.drawingTools,
                    ticketDefaults: canonicalWinner.ticketDefaults,
                    orders: canonicalWinner.orders,
                    drawings: canonicalWinner.drawings,
                    drawnItems: canonicalWinner.drawnItems,
                    drawingStylesById: canonicalWinner.drawingStylesById,
                    overlayGeometries: canonicalWinner.overlayGeometries,
                    activeIndicators: canonicalWinner.activeIndicators,
                    indicatorParamsByCode: canonicalWinner.indicatorParamsByCode,
                    sessionScreenshots: canonicalWinner.sessionScreenshots,
                    journalNotes: canonicalWinner.journalNotes,
                    journalTitle: canonicalWinner.journalTitle ?? session.journalTitle,
                    journalMarketBias: canonicalWinner.journalMarketBias ?? session.journalMarketBias,
                    journalPsychCheck: canonicalWinner.journalPsychCheck ?? session.journalPsychCheck,
                    journalImages: canonicalWinner.journalImages ?? session.journalImages,
                    replayTimestamp: canonicalWinner.replayTimestamp,
                    spread: canonicalWinner.spread,
                    commission: canonicalWinner.commission,
                    currentBalance: resolvedBalance,
                    netPnl: resolvedNetPnl,
                    timeInvestedSeconds: resolvedTimeInvested,
                    _isSlimSummary: false,
                };

                writeLocalReplaySnapshot(session.id, canonicalWinner);
                const persisted = updateBacktestSession(session.id, sessionPatch);
                const merged: BacktestReplaySession = persisted || { ...session, ...sessionPatch };

                latestVaultRef.current = {
                    ...latestVaultRef.current,
                    schemaVersion: BACKTEST_SNAPSHOT_SCHEMA_VERSION,
                    revision: merged.revision ?? 0,
                    primarySymbol: merged.primarySymbol,
                    timeframe: merged.timeframe,
                    secondaryTimeframe: merged.secondaryTimeframe,
                    dataSource: merged.dataSource,
                    layoutMode: merged.layoutMode,
                    selectedCandleStyle: merged.selectedCandleStyle,
                    replayActive: merged.replayActive,
                    syncEnabled: merged.syncEnabled,
                    yAxis: merged.yAxis,
                    drawingTools: merged.drawingTools,
                    ticketDefaults: merged.ticketDefaults,
                    orders: merged.orders,
                    drawings: merged.drawings,
                    drawnItems: merged.drawnItems,
                    drawingStylesById: merged.drawingStylesById,
                    overlayGeometries: merged.overlayGeometries,
                    activeIndicators: merged.activeIndicators,
                    indicatorParamsByCode: merged.indicatorParamsByCode,
                    sessionScreenshots: merged.sessionScreenshots,
                    journalNotes: merged.journalNotes,
                    replayTimestamp: merged.replayTimestamp,
                    currentBalance: merged.currentBalance,
                    netPnl: merged.netPnl,
                    timeInvestedSeconds: merged.timeInvestedSeconds,
                    spread: merged.spread,
                    commission: merged.commission,
                };

                isHydratingRef.current = false;
                setResolvedSession(merged);
            } else {
                isHydratingRef.current = false;
                setResolvedSession(session);
            }
        })();

        return () => {
            active = false;
        };
    }, [session.id]);

    const handleSessionStateSync = useCallback(
        async (payload: SessionStateSyncPayload): Promise<boolean> => {
            if (isHydratingRef.current) return false;
            const current = getBacktestSessionById(session.id);
            const prevTime = current?.timeInvestedSeconds || session.timeInvestedSeconds || 0;
            const nextTime = prevTime + (payload.deltaSeconds || 0);

            updateBacktestSession(session.id, {
                schemaVersion: BACKTEST_SNAPSHOT_SCHEMA_VERSION,
                revision: payload.revision,
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
                drawings: payload.drawings,
                drawnItems: payload.drawnItems,
                drawingStylesById: payload.drawingStylesById,
                overlayGeometries: payload.overlayGeometries,
                activeIndicators: payload.activeIndicators,
                indicatorParamsByCode: payload.indicatorParamsByCode,
                selectedCandleStyle: payload.selectedCandleStyle,
                layoutMode: payload.layoutMode,
                dataSource: payload.dataSource,
                replayActive: payload.replayActive,
                syncEnabled: payload.syncEnabled,
                yAxis: payload.yAxis,
                drawingTools: payload.drawingTools,
                ticketDefaults: payload.ticketDefaults,
                sessionScreenshots: payload.sessionScreenshots,
                journalNotes: payload.journalNotes,
                replayTimestamp: payload.replayTimestamp,
                primarySymbol: payload.primarySymbol,
                timeframe: payload.timeframe,
                secondaryTimeframe: payload.secondaryTimeframe || session.secondaryTimeframe,
                auxPeriodTexts: payload.auxPeriodTexts ?? session.auxPeriodTexts,
                timezone: payload.timezone ?? session.timezone,
                spread: payload.spread,
                commission: payload.commission,
                timeInvestedSeconds: nextTime,
            });

            const vaultPayload: SessionVaultData = {
                schemaVersion: BACKTEST_SNAPSHOT_SCHEMA_VERSION,
                revision: payload.revision,
                sessionId: session.id,
                name: session.name,
                strategyName: session.strategyName,
                primarySymbol: payload.primarySymbol,
                timeframe: payload.timeframe,
                secondaryTimeframe: payload.secondaryTimeframe || session.secondaryTimeframe,
                auxPeriodTexts: payload.auxPeriodTexts ?? session.auxPeriodTexts,
                timezone: payload.timezone ?? session.timezone,
                dataSource: payload.dataSource,
                layoutMode: payload.layoutMode,
                selectedCandleStyle: payload.selectedCandleStyle,
                replayActive: payload.replayActive,
                syncEnabled: payload.syncEnabled,
                yAxis: payload.yAxis,
                drawingTools: payload.drawingTools,
                ticketDefaults: payload.ticketDefaults,
                pairs: session.pairs,
                fromDate: session.fromDate,
                toDate: session.toDate,
                orders: payload.orders,
                drawings: payload.drawings,
                drawnItems: payload.drawnItems,
                drawingStylesById: payload.drawingStylesById,
                overlayGeometries: payload.overlayGeometries,
                activeIndicators: payload.activeIndicators,
                indicatorParamsByCode: payload.indicatorParamsByCode,
                sessionScreenshots: payload.sessionScreenshots,
                quantMetrics: payload.quantMetrics,
                journalNotes: payload.journalNotes,
                journalTitle: current?.journalTitle ?? session.journalTitle,
                journalMarketBias: current?.journalMarketBias ?? session.journalMarketBias,
                journalPsychCheck: current?.journalPsychCheck ?? session.journalPsychCheck,
                journalImages: current?.journalImages ?? session.journalImages,
                replayTimestamp: payload.replayTimestamp,
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
                timeInvestedSeconds: nextTime,
                spread: payload.spread,
                commission: payload.commission,
                updatedAt: new Date().toISOString(),
            };
            latestVaultRef.current = vaultPayload;

            // Encrypt per-session in IndexedDB (AES-256-GCM) and sync to Redis + PostgreSQL
            try {
                const { digestHex } = await saveEncryptedSessionToIDB(session.id, vaultPayload);
                return await syncSessionToBackendRedisPostgres(
                    { ...vaultPayload, encryptedDigest: digestHex },
                    selectedAccountId !== 'all' ? selectedAccountId : undefined
                );
            } catch (_) {
                return false;
            }
        },
        [session, selectedAccountId]
    );

    // Guaranteed flush on beforeunload, pagehide, visibilitychange (tab hidden), and unmount
    useEffect(() => {
        const accountParam = selectedAccountId !== 'all' ? selectedAccountId : undefined;

        const handleUnload = () => {
            if (isHydratingRef.current) return;
            if (!isHydratingRef.current) flushSessionBeforeUnload(latestVaultRef.current, accountParam);
        };

        const handleVisibilityChange = () => {
            if (isHydratingRef.current) return;
            if (document.visibilityState === 'hidden') {
                if (!isHydratingRef.current) flushSessionBeforeUnload(latestVaultRef.current, accountParam);
            }
        };

        window.addEventListener('beforeunload', handleUnload);
        window.addEventListener('pagehide', handleUnload);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            window.removeEventListener('beforeunload', handleUnload);
            window.removeEventListener('pagehide', handleUnload);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (!isHydratingRef.current) flushSessionBeforeUnload(latestVaultRef.current, accountParam);
        };
    }, [selectedAccountId]);

    const handleSaveReplaySessionToBackend = useCallback(
        async (sessionPayload: any) => {
            const { digestHex } = await saveEncryptedSessionToIDB(session.id, latestVaultRef.current);
            await api.post(
                '/dashboard/backtest/session-sync',
                {
                    ...latestVaultRef.current,
                    ...sessionPayload,
                    sessionId: session.id,
                    name: session.name,
                    strategy: session.strategyName,
                    encryptedDigest: digestHex,
                },
                {
                    params: { accountId: selectedAccountId !== 'all' ? selectedAccountId : undefined },
                }
            );
        },
        [session.id, session.name, session.strategyName, selectedAccountId]
    );

    if (!resolvedSession) {
        return <ReplayTerminalSkeleton />;
    }

    return (
        <div className="w-full h-screen overflow-hidden flex flex-col bg-surface">
            <KLineChartProTerminal
                key={resolvedSession.id}
                sessionId={resolvedSession.id}
                initialRevision={resolvedSession.revision}
                sessionName={resolvedSession.name}
                strategyName={resolvedSession.strategyName}
                sessionPairs={resolvedSession.pairs}
                sessionFromDate={resolvedSession.fromDate}
                sessionToDate={resolvedSession.toDate}
                initialSymbolTicker={resolvedSession.primarySymbol}
                initialPeriodText={resolvedSession.timeframe}
                initialSecondaryPeriodText={resolvedSession.secondaryTimeframe}
                initialAuxPeriodTexts={resolvedSession.auxPeriodTexts}
                initialTimezone={resolvedSession.timezone}
                initialDataSource={resolvedSession.dataSource}
                initialLayoutMode={resolvedSession.layoutMode}
                initialReplayActive={resolvedSession.replayActive}
                initialSyncEnabled={resolvedSession.syncEnabled}
                initialYAxis={resolvedSession.yAxis}
                initialDrawingTools={resolvedSession.drawingTools}
                initialTicketDefaults={resolvedSession.ticketDefaults}
                initialRiskPercent={resolvedSession.riskPerTrade}
                initialRrTarget={resolvedSession.rrTarget}
                initialSpread={resolvedSession.spread}
                initialCommission={resolvedSession.commission}
                initialOrders={resolvedSession.orders}
                initialDrawings={resolvedSession.drawings}
                initialDrawnItems={resolvedSession.drawnItems}
                initialDrawingStylesById={resolvedSession.drawingStylesById}
                initialOverlayGeometries={resolvedSession.overlayGeometries}
                initialActiveIndicators={resolvedSession.activeIndicators}
                initialIndicatorParamsByCode={resolvedSession.indicatorParamsByCode}
                initialCandleStyle={resolvedSession.selectedCandleStyle}
                initialScreenshots={resolvedSession.sessionScreenshots}
                initialJournalNotes={resolvedSession.journalNotes}
                initialReplayTimestamp={deepLinkTimestamp ?? resolvedSession.replayTimestamp}
                deepLinkSymbol={deepLinkSymbol}
                deepLinkPeriodText={deepLinkTf}
                deepLinkTimestamp={deepLinkTimestamp}
                deepLinkTradeId={deepLinkTradeId}
                initialBalance={resolvedSession.startingCapital}
                accountName={`${resolvedSession.name} (${resolvedSession.strategyName})`}
                onBackToHub={() => {
                    flushSessionBeforeUnload(
                        latestVaultRef.current,
                        selectedAccountId !== 'all' ? selectedAccountId : undefined
                    );
                    navigate(`/backtesting/sessions/${resolvedSession.id}`);
                }}
                onSessionStateSync={handleSessionStateSync}
                onSaveReplaySession={handleSaveReplaySessionToBackend}
                onFullscreenChange={setIsFullscreen}
            />
        </div>
    );
};
