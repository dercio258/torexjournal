import api from '../api';
import {
    ReplayOrder,
    ChartCandleStyleId,
    SessionScreenshotItem,
} from '../components/kline-replay/types';
import { DrawnObjectItem } from '../components/kline-replay/layers/RightSidePanelLayer';
import {
    DrawingStyleState,
    OverlayPointCoord,
} from '../components/kline-replay/layers/DrawingStyleToolbarLayer';
import { ChartLayoutMode } from '../components/kline-replay/layers/TopToolbarLayer';
import { DataSourceMode } from './klineDatafeed';
import { deleteEncryptedSessionFromIDB } from './historicalBatchCache';
import {
    BACKTEST_SNAPSHOT_SCHEMA_VERSION,
    clearLocalReplaySnapshot,
    DrawingEntityV2,
    DrawingToolsWorkspaceState,
    normalizeSnapshotToV2,
    readLocalReplaySnapshot,
    TicketDefaultsState,
    unpackDrawingsV2,
    writeLocalReplaySnapshot,
    YAxisSessionState,
} from './backtestSessionSnapshot';

export interface BacktestStrategyRule {
    id: string;
    text: string;
    required: boolean;
}

export type AccountCurrencyCode = 'USD' | 'EUR' | 'GBP' | 'MZN';

export interface BacktestStrategy {
    id: string;
    name: string;
    tradingMethod: string;
    description: string;
    sessionTag: string; // e.g. 'Asian', 'London', 'New York', 'Multi-Session'
    status: 'ACTIVE' | 'ARCHIVED';
    startingCapital: number;
    currency: AccountCurrencyCode;
    riskMode: 'FIXED_RISK' | 'COMPOUNDING' | 'DYNAMIC_RISK';
    riskPerTrade: number; // %
    defaultTimeframe: string; // e.g. '5m'
    rrTarget: number;
    primarySymbol: string;
    symbols: string[];
    rules: BacktestStrategyRule[];
    journalNotes?: string;
    journalTitle?: string | null;
    journalMarketBias?: string | null;
    journalPsychCheck?: Record<string, string | null>;
    journalImages?: string[];
    createdAt: string;
    updatedAt: string;
}

export interface FundedModeConfig {
    enabled: boolean;
    profitTargetPct: number; // e.g. 10%
    maxDailyLossPct: number; // e.g. 5%
    maxTotalLossPct: number; // e.g. 10%
}

export interface BacktestReplaySession {
    id: string;
    name: string;
    strategyId: string;
    strategyName: string;
    status: 'ACTIVE' | 'COMPLETED';
    primarySymbol: string;
    pairs: string[];
    timeframe: string;
    secondaryTimeframe: string;
    auxPeriodTexts?: string[];
    timezone?: string;
    fromDate: string; // YYYY-MM-DD
    toDate: string;   // YYYY-MM-DD
    keepEndFollowingToday: boolean;
    randomStartDate: boolean;
    startingCapital: number;
    riskPerTrade: number;
    rrTarget: number;
    fundedMode: FundedModeConfig;
    // Live session state updated from the Replay Terminal
    currentBalance: number;
    netPnl: number;
    closedTradesCount: number;
    winsCount: number;
    lossesCount: number;
    winRate: number;
    profitFactor: number;
    expectancy: number;
    avgR: number;
    maxDrawdown: number;
    maxDrawdownPct: number;
    timeInvestedSeconds: number;
    orders: ReplayOrder[];
    journalNotes: string;
    journalTitle?: string | null;
    journalMarketBias?: string | null;
    journalPsychCheck?: Record<string, string | null>;
    journalImages?: string[];
    replayTimestamp: number | null;
    spread: number;
    commission: number;
    // V2 Unified Workspace & Visual Layer Fields
    schemaVersion?: 2;
    revision?: number;
    dataSource?: DataSourceMode;
    layoutMode?: ChartLayoutMode;
    selectedCandleStyle?: ChartCandleStyleId;
    replayActive?: boolean;
    syncEnabled?: boolean;
    yAxis?: YAxisSessionState;
    drawingTools?: DrawingToolsWorkspaceState;
    ticketDefaults?: TicketDefaultsState;
    drawings?: DrawingEntityV2[];
    drawnItems?: DrawnObjectItem[];
    drawingStylesById?: Record<string, DrawingStyleState>;
    overlayGeometries?: Record<string, OverlayPointCoord[]>;
    activeIndicators?: string[];
    indicatorParamsByCode?: Record<string, string>;
    sessionScreenshots?: SessionScreenshotItem[];
    _isSlimSummary?: boolean;
    createdAt: string;
    updatedAt: string;
}

const STRATEGIES_STORAGE_KEY = 'torex_backtest_strategies_v1';
const SESSIONS_STORAGE_KEY = 'torex_backtest_sessions_v1';
const CLOUD_KNOWN_IDS_KEY = 'torex_backtest_cloud_known_ids_v1';

const SEED_STRATEGY_IDS = new Set(['f898c190-c127-43c8-9faf-ae317b063631']);
const SEED_SESSION_IDS = new Set([
    '79d78fe0-71ab-4441-9aec-73ee8c00c5bc',
    '92b41ce0-34cd-4912-8b1c-84ff9d11d7ea',
]);

interface CloudKnownIdsState {
    strategies: Set<string>;
    sessions: Set<string>;
}

function loadCloudKnownIds(): CloudKnownIdsState {
    try {
        const raw = localStorage.getItem(CLOUD_KNOWN_IDS_KEY);
        if (!raw) return { strategies: new Set(), sessions: new Set() };
        const parsed = JSON.parse(raw);
        return {
            strategies: new Set(Array.isArray(parsed?.strategies) ? parsed.strategies : []),
            sessions: new Set(Array.isArray(parsed?.sessions) ? parsed.sessions : []),
        };
    } catch (_) {
        return { strategies: new Set(), sessions: new Set() };
    }
}

function saveCloudKnownIds(state: CloudKnownIdsState): void {
    try {
        localStorage.setItem(
            CLOUD_KNOWN_IDS_KEY,
            JSON.stringify({
                strategies: Array.from(state.strategies).slice(-300),
                sessions: Array.from(state.sessions).slice(-300),
            })
        );
    } catch (_) {}
}

export function markSessionCloudSynced(sessionId?: string): void {
    if (!sessionId) return;
    const known = loadCloudKnownIds();
    known.sessions.add(sessionId);
    saveCloudKnownIds(known);
}

function hasAuthToken(): boolean {
    try {
        return Boolean(localStorage.getItem('token') || localStorage.getItem('adminToken'));
    } catch (_) {
        return false;
    }
}

export async function pushStrategyToBackend(
    strategy: BacktestStrategy,
    apiClient: { post?: (url: string, data?: any, config?: any) => Promise<any> } = api
): Promise<void> {
    if (!strategy?.id || typeof apiClient?.post !== 'function') return;
    await apiClient.post('/dashboard/backtest/strategy-sync', strategy);
    const known = loadCloudKnownIds();
    known.strategies.add(strategy.id);
    saveCloudKnownIds(known);
}

export async function removeStrategyFromBackend(
    strategyId: string,
    apiClient: { delete?: (url: string, config?: any) => Promise<any> } = api
): Promise<void> {
    if (!strategyId) return;
    const known = loadCloudKnownIds();
    known.strategies.delete(strategyId);
    saveCloudKnownIds(known);
    if (typeof apiClient?.delete === 'function') {
        await apiClient.delete(`/dashboard/backtest/strategy/${encodeURIComponent(strategyId)}`);
    }
}

export async function pushSessionToBackend(
    session: BacktestReplaySession,
    apiClient: { post?: (url: string, data?: any, config?: any) => Promise<any> } = api,
    accountId?: string
): Promise<void> {
    if (!session?.id || typeof apiClient?.post !== 'function') return;
    const params = accountId && accountId !== 'all' ? { accountId } : undefined;
    const payload = {
        sessionId: session.id,
        accountId: accountId && accountId !== 'all' ? accountId : undefined,
        name: session.name,
        mode: 'REPLAY_SESSION',
        strategy: session.strategyName,
        strategyId: session.strategyId,
        strategyName: session.strategyName,
        status: session.status,
        symbol: session.primarySymbol,
        primarySymbol: session.primarySymbol,
        pairs: session.pairs,
        timeframe: session.timeframe,
        secondaryTimeframe: session.secondaryTimeframe,
        auxPeriodTexts: session.auxPeriodTexts,
        timezone: session.timezone,
        fromDate: session.fromDate,
        toDate: session.toDate,
        keepEndFollowingToday: session.keepEndFollowingToday,
        randomStartDate: session.randomStartDate,
        startingCapital: session.startingCapital,
        riskPerTrade: session.riskPerTrade,
        rrTarget: session.rrTarget,
        fundedMode: session.fundedMode,
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
        orders: session.orders,
        notes: session.journalNotes,
        journalNotes: session.journalNotes,
        journalTitle: session.journalTitle,
        journalMarketBias: session.journalMarketBias,
        journalPsychCheck: session.journalPsychCheck,
        journalImages: session.journalImages,
        replayTimestamp: session.replayTimestamp,
        spread: session.spread,
        commission: session.commission,
        schemaVersion: BACKTEST_SNAPSHOT_SCHEMA_VERSION,
        revision: typeof session.revision === 'number' && Number.isFinite(session.revision) ? session.revision : 1,
        dataSource: session.dataSource,
        layoutMode: session.layoutMode,
        selectedCandleStyle: session.selectedCandleStyle,
        replayActive: session.replayActive,
        syncEnabled: session.syncEnabled,
        yAxis: session.yAxis,
        drawingTools: session.drawingTools,
        ticketDefaults: session.ticketDefaults,
        drawings: session.drawings,
        drawnItems: session.drawnItems,
        drawingStylesById: session.drawingStylesById,
        overlayGeometries: session.overlayGeometries,
        activeIndicators: session.activeIndicators,
        indicatorParamsByCode: session.indicatorParamsByCode,
        sessionScreenshots: session.sessionScreenshots,
    };
    await apiClient.post('/dashboard/backtest/session-sync', payload, params ? { params } : undefined);
    const known = loadCloudKnownIds();
    known.sessions.add(session.id);
    saveCloudKnownIds(known);
}

export async function removeSessionFromBackend(
    sessionId: string,
    apiClient: { delete?: (url: string, config?: any) => Promise<any> } = api
): Promise<void> {
    if (!sessionId) return;
    const known = loadCloudKnownIds();
    known.sessions.delete(sessionId);
    saveCloudKnownIds(known);
    if (typeof apiClient?.delete === 'function') {
        await apiClient.delete(`/dashboard/backtest/session/${encodeURIComponent(sessionId)}`);
    }
}

export const ALL_BACKTEST_SYMBOLS: { ticker: string; name: string; category: 'Forex' | 'Metais' | 'Cripto' | 'Índices' }[] = [
    { ticker: 'XAUUSD', name: 'Ouro vs Dólar (Spot Gold)', category: 'Metais' },
    { ticker: 'EURUSD', name: 'Euro vs Dólar Americano', category: 'Forex' },
    { ticker: 'GBPUSD', name: 'Libra Esterlina vs Dólar', category: 'Forex' },
    { ticker: 'USDJPY', name: 'Dólar Americano vs Iene', category: 'Forex' },
    { ticker: 'AUDUSD', name: 'Dólar Australiano vs USD', category: 'Forex' },
    { ticker: 'NZDUSD', name: 'Dólar Neozelandês vs USD', category: 'Forex' },
    { ticker: 'USDCAD', name: 'Dólar Americano vs CAD', category: 'Forex' },
    { ticker: 'USDCHF', name: 'Dólar Americano vs Franco Suíço', category: 'Forex' },
    { ticker: 'GBPJPY', name: 'Libra Esterlina vs Iene', category: 'Forex' },
    { ticker: 'EURJPY', name: 'Euro vs Iene Japonês', category: 'Forex' },
    { ticker: 'EURGBP', name: 'Euro vs Libra Esterlina', category: 'Forex' },
    { ticker: 'BTCUSD', name: 'Bitcoin vs Dólar', category: 'Cripto' },
    { ticker: 'ETHUSD', name: 'Ethereum vs Dólar', category: 'Cripto' },
    { ticker: 'SOLUSD', name: 'Solana vs Dólar', category: 'Cripto' },
    { ticker: 'NAS100', name: 'Nasdaq 100 Index', category: 'Índices' },
    { ticker: 'US30', name: 'Dow Jones 30 Index', category: 'Índices' },
    { ticker: 'SPX500', name: 'S&P 500 Index', category: 'Índices' },
    { ticker: 'GER40', name: 'DAX 40 Index', category: 'Índices' },
];

export function generateUuid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

const DEFAULT_STRATEGIES: BacktestStrategy[] = [
    {
        id: 'f898c190-c127-43c8-9faf-ae317b063631',
        name: 'Smart Money / Price Action Institucional',
        tradingMethod: 'Smart Money Concepts (SMC / ICT)',
        description: 'Liquidez de Sessão, FVG, Order Blocks e Quebra de Estrutura (BOS/CHoCH)',
        sessionTag: 'London & NY',
        status: 'ACTIVE',
        startingCapital: 100000,
        currency: 'USD',
        riskMode: 'FIXED_RISK',
        riskPerTrade: 1.0,
        defaultTimeframe: '5m',
        rrTarget: 2.5,
        primarySymbol: 'XAUUSD',
        symbols: ['XAUUSD', 'EURUSD', 'GBPUSD'],
        rules: [
            { id: 'r1', text: 'Aguardar varredura de liquidez (Sweep) de máxima/mínima da sessão anterior', required: true },
            { id: 'r2', text: 'Confirmar deslocamento com FVG (Fair Value Gap) a favor da estrutura HTF', required: true },
            { id: 'r3', text: 'Risco máximo fixo de 1R por entrada com alvo mínimo de 2R', required: true },
        ],
        createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
        updatedAt: new Date().toISOString(),
    },
];

export function loadBacktestStrategies(): BacktestStrategy[] {
    try {
        const raw = localStorage.getItem(STRATEGIES_STORAGE_KEY);
        if (!raw) {
            localStorage.setItem(STRATEGIES_STORAGE_KEY, JSON.stringify(DEFAULT_STRATEGIES));
            return DEFAULT_STRATEGIES;
        }
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (_) {}
    return DEFAULT_STRATEGIES;
}

export function saveBacktestStrategies(strategies: BacktestStrategy[]): void {
    try {
        localStorage.setItem(STRATEGIES_STORAGE_KEY, JSON.stringify(strategies));
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('torex:backtest-workspace-updated'));
        }
    } catch (_) {}
}

export function createBacktestStrategy(input: Partial<BacktestStrategy>): BacktestStrategy {
    const list = loadBacktestStrategies();
    const now = new Date().toISOString();
    const symbols = input.symbols && input.symbols.length > 0 ? input.symbols : [input.primarySymbol || 'XAUUSD'];
    const primarySymbol = input.primarySymbol && symbols.includes(input.primarySymbol) ? input.primarySymbol : symbols[0];
    const newStrategy: BacktestStrategy = {
        id: generateUuid(),
        name: input.name?.trim() || 'Nova Estratégia',
        tradingMethod: input.tradingMethod?.trim() || 'Smart Money Concepts (SMC / ICT)',
        description: input.description?.trim() || input.tradingMethod?.trim() || 'Operacional Técnico Personalizado',
        sessionTag: input.sessionTag || 'London & NY',
        status: 'ACTIVE',
        startingCapital: Number(input.startingCapital) || 100000,
        currency: input.currency || 'USD',
        riskMode: input.riskMode || 'FIXED_RISK',
        riskPerTrade: Number(input.riskPerTrade) || 1.0,
        defaultTimeframe: input.defaultTimeframe || '5m',
        rrTarget: Number(input.rrTarget) || 2.0,
        primarySymbol,
        symbols,
        rules: input.rules || [],
        journalNotes: input.journalNotes,
        createdAt: now,
        updatedAt: now,
    };
    const next = [newStrategy, ...list];
    saveBacktestStrategies(next);
    if (hasAuthToken()) {
        void pushStrategyToBackend(newStrategy).catch(() => {});
    }
    return newStrategy;
}

export function updateBacktestStrategy(id: string, patch: Partial<BacktestStrategy>): BacktestStrategy[] {
    const list = loadBacktestStrategies();
    let updatedStrategy: BacktestStrategy | null = null;
    const next = list.map((s) => {
        if (s.id !== id) return s;
        updatedStrategy = {
            ...s,
            ...patch,
            startingCapital: s.startingCapital,
            currency: s.currency || 'USD',
            riskMode: s.riskMode,
            updatedAt: new Date().toISOString(),
        };
        return updatedStrategy;
    });
    saveBacktestStrategies(next);
    if (updatedStrategy && hasAuthToken()) {
        void pushStrategyToBackend(updatedStrategy).catch(() => {});
    }
    return next;
}

export function deleteBacktestStrategy(id: string): BacktestStrategy[] {
    const list = loadBacktestStrategies();
    const filtered = list.filter((s) => s.id !== id);
    const next = filtered.length > 0 ? filtered : DEFAULT_STRATEGIES;
    saveBacktestStrategies(next);
    if (hasAuthToken()) {
        void removeStrategyFromBackend(id).catch(() => {});
    }
    return next;
}

export function loadBacktestSessions(): BacktestReplaySession[] {
    try {
        const raw = localStorage.getItem(SESSIONS_STORAGE_KEY);
        if (!raw) {
            const strategies = loadBacktestStrategies();
            const defaultStrat = strategies[0];
            const today = new Date();
            const twoWeeksAgo = new Date(Date.now() - 86400000 * 14);
            const seed: BacktestReplaySession[] = [
                {
                    id: '79d78fe0-71ab-4441-9aec-73ee8c00c5bc',
                    name: 'Sessão 1 — XAUUSD',
                    strategyId: defaultStrat.id,
                    strategyName: defaultStrat.name,
                    status: 'ACTIVE',
                    primarySymbol: 'XAUUSD',
                    pairs: ['XAUUSD', 'EURUSD', 'GBPUSD'],
                    timeframe: defaultStrat.defaultTimeframe || '5m',
                    secondaryTimeframe: '1h',
                    fromDate: twoWeeksAgo.toISOString().slice(0, 10),
                    toDate: today.toISOString().slice(0, 10),
                    keepEndFollowingToday: true,
                    randomStartDate: false,
                    startingCapital: defaultStrat.startingCapital,
                    riskPerTrade: defaultStrat.riskPerTrade,
                    rrTarget: defaultStrat.rrTarget,
                    fundedMode: {
                        enabled: false,
                        profitTargetPct: 10,
                        maxDailyLossPct: 5,
                        maxTotalLossPct: 10,
                    },
                    currentBalance: defaultStrat.startingCapital,
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
                    timeInvestedSeconds: 1140,
                    orders: [],
                    journalNotes: '',
                    replayTimestamp: null,
                    spread: 0,
                    commission: 0,
                    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
                    updatedAt: new Date().toISOString(),
                },
                {
                    id: '92b41ce0-34cd-4912-8b1c-84ff9d11d7ea',
                    name: 'Sessão 2 — EURUSD',
                    strategyId: defaultStrat.id,
                    strategyName: defaultStrat.name,
                    status: 'ACTIVE',
                    primarySymbol: 'EURUSD',
                    pairs: ['EURUSD', 'GBPUSD', 'XAUUSD'],
                    timeframe: defaultStrat.defaultTimeframe || '5m',
                    secondaryTimeframe: '1h',
                    fromDate: twoWeeksAgo.toISOString().slice(0, 10),
                    toDate: today.toISOString().slice(0, 10),
                    keepEndFollowingToday: true,
                    randomStartDate: false,
                    startingCapital: defaultStrat.startingCapital,
                    riskPerTrade: defaultStrat.riskPerTrade,
                    rrTarget: defaultStrat.rrTarget,
                    fundedMode: {
                        enabled: true,
                        profitTargetPct: 10,
                        maxDailyLossPct: 5,
                        maxTotalLossPct: 10,
                    },
                    currentBalance: defaultStrat.startingCapital,
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
                    timeInvestedSeconds: 420,
                    orders: [],
                    journalNotes: '',
                    replayTimestamp: null,
                    spread: 0,
                    commission: 0,
                    createdAt: new Date(Date.now() - 86400000).toISOString(),
                    updatedAt: new Date().toISOString(),
                },
            ];
            localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(seed));
            return seed;
        }
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
    return [];
}

export function saveBacktestSessions(sessions: BacktestReplaySession[]): void {
    try {
        localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('torex:backtest-workspace-updated'));
        }
    } catch (_) {}
}

export function getBacktestSessionById(sessionId: string): BacktestReplaySession | null {
    const sessions = loadBacktestSessions();
    return sessions.find((s) => s.id === sessionId) || null;
}

export function createBacktestSession(input: {
    name: string;
    strategyId: string;
    pairs: string[];
    primarySymbol?: string;
    timeframe?: string;
    fromDate: string;
    toDate: string;
    keepEndFollowingToday: boolean;
    randomStartDate: boolean;
    riskPerTrade?: number;
    fundedMode: FundedModeConfig;
}): BacktestReplaySession {
    const strategies = loadBacktestStrategies();
    const strat = strategies.find((s) => s.id === input.strategyId) || strategies[0];
    const sessions = loadBacktestSessions();
    const now = new Date().toISOString();
    const pairs = input.pairs.length > 0 ? input.pairs : [strat.primarySymbol || 'XAUUSD'];
    const primarySymbol = input.primarySymbol && pairs.includes(input.primarySymbol) ? input.primarySymbol : pairs[0];

    let initialReplayTs: number | null = null;
    const fromMs = input.fromDate ? new Date(`${input.fromDate}T08:00:00`).getTime() : NaN;
    const rawToMs = input.toDate ? new Date(`${input.toDate}T20:00:00`).getTime() : NaN;
    const toMs = Number.isFinite(rawToMs) ? Math.min(Date.now(), rawToMs) : Date.now();
    if (Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs > fromMs) {
        const span = toMs - fromMs;
        if (input.randomStartDate) {
            const minStart = fromMs + span * 0.15;
            const maxStart = Math.max(minStart, toMs - span * 0.15);
            initialReplayTs = Math.round(minStart + Math.random() * (maxStart - minStart));
        } else {
            initialReplayTs = Math.round(fromMs + Math.min(span * 0.25, 3 * 86_400_000));
        }
    }

    const newSession: BacktestReplaySession = {
        id: generateUuid(),
        name: input.name.trim(),
        strategyId: strat.id,
        strategyName: strat.name,
        status: 'ACTIVE',
        primarySymbol,
        pairs,
        timeframe: input.timeframe || strat.defaultTimeframe || '5m',
        secondaryTimeframe: '1h',
        fromDate: input.fromDate,
        toDate: input.toDate,
        keepEndFollowingToday: input.keepEndFollowingToday,
        randomStartDate: input.randomStartDate,
        startingCapital: strat.startingCapital,
        riskPerTrade: input.riskPerTrade ?? strat.riskPerTrade,
        rrTarget: strat.rrTarget,
        fundedMode: input.fundedMode,
        currentBalance: strat.startingCapital,
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
        replayTimestamp: initialReplayTs,
        spread: 0,
        commission: 0,
        schemaVersion: BACKTEST_SNAPSHOT_SCHEMA_VERSION,
        revision: 1,
        createdAt: now,
        updatedAt: now,
    };

    const next = [newSession, ...sessions];
    saveBacktestSessions(next);
    if (hasAuthToken()) {
        void pushSessionToBackend(newSession).catch(() => {});
    }
    return newSession;
}

export function updateBacktestSession(
    sessionId: string,
    patch: Partial<BacktestReplaySession>
): BacktestReplaySession | null {
    const sessions = loadBacktestSessions();
    let updatedItem: BacktestReplaySession | null = null;
    const next = sessions.map((s) => {
        if (s.id !== sessionId) return s;
        let nextScreenshots = s.sessionScreenshots;
        if (Array.isArray(patch.sessionScreenshots)) {
            let inlineCount = 0;
            nextScreenshots = patch.sessionScreenshots.filter((shot) => {
                if (!shot?.dataUrl) return false;
                if (shot.dataUrl.startsWith('data:')) {
                    if (inlineCount >= 3) return false;
                    inlineCount += 1;
                }
                return true;
            }).slice(0, 50);
        }
        const nextRevision =
            typeof patch.revision === 'number' && Number.isFinite(patch.revision)
                ? Math.max(0, Math.floor(patch.revision))
                : Math.max(
                      typeof s.revision === 'number' && Number.isFinite(s.revision) ? s.revision : 0,
                      readLocalReplaySnapshot(sessionId)?.revision ?? 0
                  ) + 1;
        const preserveLocalOrders =
            (s.orders?.length ?? 0) > 0 &&
            patch._isSlimSummary === true &&
            (!patch.orders || patch.orders.length === 0);
        updatedItem = {
            ...s,
            ...patch,
            ...(preserveLocalOrders ? { orders: s.orders, _isSlimSummary: false } : {}),
            schemaVersion: BACKTEST_SNAPSHOT_SCHEMA_VERSION,
            revision: nextRevision,
            sessionScreenshots: nextScreenshots,
            updatedAt: new Date().toISOString(),
        };
        return updatedItem;
    });
    if (updatedItem) {
        saveBacktestSessions(next);
        // Keep localStorage Replay Snapshot synchronized if one exists so edits in /backtesting/journal
        // or /backtesting/sessions/:id are immediately authoritative when opening Replay.
        const existingLocalSnap = readLocalReplaySnapshot(sessionId);
        if (existingLocalSnap) {
            const refreshedSnap = normalizeSnapshotToV2(
                {
                    ...existingLocalSnap,
                    ...(updatedItem as Record<string, any>),
                    ticker: (updatedItem as BacktestReplaySession).primarySymbol || existingLocalSnap.ticker,
                    periodText: (updatedItem as BacktestReplaySession).timeframe || existingLocalSnap.periodText,
                    secondaryPeriodText:
                        (updatedItem as BacktestReplaySession).secondaryTimeframe ||
                        existingLocalSnap.secondaryPeriodText,
                    updatedAtMs: Date.now(),
                },
                sessionId
            );
            if (refreshedSnap) {
                writeLocalReplaySnapshot(sessionId, refreshedSnap);
            }
        }
    }
    return updatedItem;
}

export function deleteBacktestSession(sessionId: string): BacktestReplaySession[] {
    const sessions = loadBacktestSessions();
    const next = sessions.filter((s) => s.id !== sessionId);
    saveBacktestSessions(next);
    clearLocalReplaySnapshot(sessionId);
    void deleteEncryptedSessionFromIDB(sessionId).catch(() => {});
    if (hasAuthToken()) {
        void removeSessionFromBackend(sessionId).catch(() => {});
    }
    return next;
}

const VALID_CURRENCIES: AccountCurrencyCode[] = ['USD', 'EUR', 'GBP', 'MZN'];

function normalizeStrategyRecord(raw: any): BacktestStrategy | null {
    if (!raw || typeof raw !== 'object') return null;
    const name = String(raw.name || raw.strategy || raw.strategyName || '').trim();
    if (!name) return null;

    const now = new Date().toISOString();
    const rawCurr = String(raw.currency || raw.strategyCurrency || 'USD').toUpperCase() as AccountCurrencyCode;
    const currency: AccountCurrencyCode = VALID_CURRENCIES.includes(rawCurr) ? rawCurr : 'USD';
    const rawSymbols = Array.isArray(raw.symbols)
        ? raw.symbols.map((s: any) => String(s).toUpperCase().trim()).filter(Boolean)
        : Array.isArray(raw.pairs)
          ? raw.pairs.map((s: any) => String(s).toUpperCase().trim()).filter(Boolean)
          : [];
    const primarySymbol = String(raw.primarySymbol || raw.symbol || rawSymbols[0] || 'XAUUSD')
        .toUpperCase()
        .trim();
    const symbols = rawSymbols.length > 0 ? Array.from(new Set([primarySymbol, ...rawSymbols])) : [primarySymbol];

    const riskMode: BacktestStrategy['riskMode'] =
        raw.riskMode === 'COMPOUNDING'
            ? 'COMPOUNDING'
            : raw.riskMode === 'DYNAMIC_RISK'
              ? 'DYNAMIC_RISK'
              : 'FIXED_RISK';

    return {
        id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : generateUuid(),
        name,
        tradingMethod: String(raw.tradingMethod || raw.strategyMethod || 'Smart Money Concepts (SMC / ICT)').trim(),
        description: String(raw.description ?? raw.notes ?? raw.tradingMethod ?? name).trim(),
        sessionTag: String(raw.sessionTag || 'London & NY').trim(),
        status: raw.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
        startingCapital: Number(raw.startingCapital || raw.initialBalance) || 100000,
        currency,
        riskMode,
        riskPerTrade: Number(raw.riskPerTrade) || 1.0,
        defaultTimeframe: String(raw.defaultTimeframe || raw.timeframe || '15m').trim(),
        rrTarget: Number(raw.rrTarget) || 2.0,
        primarySymbol,
        symbols,
        rules: Array.isArray(raw.rules) ? raw.rules : [],
        journalNotes: typeof raw.journalNotes === 'string' ? raw.journalNotes : undefined,
        journalTitle: typeof raw.journalTitle === 'string' ? raw.journalTitle : null,
        journalMarketBias: typeof raw.journalMarketBias === 'string' ? raw.journalMarketBias : null,
        journalPsychCheck:
            raw.journalPsychCheck && typeof raw.journalPsychCheck === 'object'
                ? { ...raw.journalPsychCheck }
                : undefined,
        journalImages: Array.isArray(raw.journalImages) ? raw.journalImages : undefined,
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
    };
}

/**
 * Imports one or more strategies (and optional sessions) from a JSON string.
 * Accepts a single strategy object, `BacktestStrategy[]`, or `{ strategies, sessions }`.
 */
export function importStrategiesFromJson(rawJsonText: string): {
    importedStrategies: BacktestStrategy[];
    strategies: BacktestStrategy[];
    sessions: BacktestReplaySession[];
} {
    const parsed = JSON.parse(rawJsonText);
    const candidateList: any[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.strategies)
          ? parsed.strategies
          : parsed && typeof parsed === 'object'
            ? [parsed]
            : [];

    const existingStrategies = loadBacktestStrategies();
    const mergedStrategies = [...existingStrategies];
    const importedStrategies: BacktestStrategy[] = [];

    for (const item of candidateList) {
        const normalized = normalizeStrategyRecord(item);
        if (!normalized) continue;

        const existingIndex = mergedStrategies.findIndex(
            (s) => s.id === normalized.id || s.name.toLowerCase() === normalized.name.toLowerCase()
        );
        if (existingIndex >= 0) {
            const updated: BacktestStrategy = {
                ...mergedStrategies[existingIndex],
                ...normalized,
                id: mergedStrategies[existingIndex].id,
                updatedAt: new Date().toISOString(),
            };
            mergedStrategies[existingIndex] = updated;
            importedStrategies.push(updated);
        } else {
            mergedStrategies.unshift(normalized);
            importedStrategies.push(normalized);
        }
    }

    if (importedStrategies.length > 0) {
        saveBacktestStrategies(mergedStrategies);
        if (hasAuthToken()) {
            importedStrategies.forEach((st) => {
                void pushStrategyToBackend(st).catch(() => {});
            });
        }
    }

    let mergedSessions = loadBacktestSessions();
    const newlyImportedSessions: BacktestReplaySession[] = [];
    if (Array.isArray(parsed?.sessions) && parsed.sessions.length > 0) {
        const byId = new Map(mergedSessions.map((s) => [s.id, s]));
        for (const rawSess of parsed.sessions) {
            if (!rawSess || typeof rawSess !== 'object' || !rawSess.name) continue;
            const id = String(rawSess.id || generateUuid());
            if (!byId.has(id)) {
                const matchedStrat =
                    mergedStrategies.find(
                        (st) =>
                            st.id === rawSess.strategyId ||
                            st.name.toLowerCase() === String(rawSess.strategyName || '').toLowerCase()
                    ) || mergedStrategies[0];
                const hydrated: BacktestReplaySession = {
                    ...rawSess,
                    id,
                    strategyId: matchedStrat.id,
                    strategyName: matchedStrat.name,
                    schemaVersion: BACKTEST_SNAPSHOT_SCHEMA_VERSION,
                    revision: typeof rawSess.revision === 'number' ? rawSess.revision : 1,
                } as BacktestReplaySession;
                byId.set(id, hydrated);
                newlyImportedSessions.push(hydrated);
            }
        }
        mergedSessions = Array.from(byId.values());
        saveBacktestSessions(mergedSessions);
        if (hasAuthToken() && newlyImportedSessions.length > 0) {
            newlyImportedSessions.forEach((sess) => {
                void pushSessionToBackend(sess).catch(() => {});
            });
        }
    }

    return {
        importedStrategies,
        strategies: mergedStrategies,
        sessions: mergedSessions,
    };
}

function isUntouchedSeedSession(s: BacktestReplaySession): boolean {
    if (!SEED_SESSION_IDS.has(s.id)) return false;
    return (
        (s.revision ?? 0) === 0 &&
        (!Array.isArray(s.orders) || s.orders.length === 0) &&
        (!Array.isArray(s.drawnItems) || s.drawnItems.length === 0) &&
        (!Array.isArray(s.drawings) || s.drawings.length === 0) &&
        !s.journalNotes
    );
}

function hydrateRemoteReplaySession(rec: any, strat: BacktestStrategy): BacktestReplaySession {
    const cfg = rec?.config || {};
    const res = rec?.results || {};
    const sessionId = String(rec?.id || cfg.clientSessionId || generateUuid());
    const startCap = Number(cfg.startingCapital || strat?.startingCapital || 100000);
    const orders = Array.isArray(cfg.orders) ? cfg.orders : [];
    const netPnl = Number(res.netPnl ?? res.simulatedNetProfit ?? 0);
    const pairs =
        Array.isArray(cfg.pairs) && cfg.pairs.length > 0
            ? cfg.pairs
            : [String(rec.symbol || strat?.primarySymbol || 'XAUUSD')];
    const todayIso = new Date().toISOString().slice(0, 10);
    const twoWeeksAgoIso = new Date(Date.now() - 86400_000 * 14).toISOString().slice(0, 10);

    const drawings: DrawingEntityV2[] | undefined = Array.isArray(cfg.drawings) ? cfg.drawings : undefined;
    let drawnItems: DrawnObjectItem[] | undefined = Array.isArray(cfg.drawnItems) ? cfg.drawnItems : undefined;
    let drawingStylesById: Record<string, DrawingStyleState> | undefined =
        cfg.drawingStylesById && typeof cfg.drawingStylesById === 'object' ? cfg.drawingStylesById : undefined;
    let overlayGeometries: Record<string, OverlayPointCoord[]> | undefined =
        cfg.overlayGeometries && typeof cfg.overlayGeometries === 'object' ? cfg.overlayGeometries : undefined;

    if (drawings && drawings.length > 0 && (!drawnItems || drawnItems.length === 0)) {
        const unpacked = unpackDrawingsV2({
            drawings,
            drawnItems,
            drawingStylesById,
            overlayGeometries,
        });
        drawnItems = unpacked.drawnItems;
        drawingStylesById = { ...unpacked.drawingStylesById, ...(drawingStylesById || {}) };
        overlayGeometries = { ...unpacked.overlayGeometries, ...(overlayGeometries || {}) };
    }

    const closedOrders = orders.filter((o: any) => o?.status === 'WIN' || o?.status === 'LOSS');

    return {
        id: sessionId,
        name: String(rec.name || `Sessão Replay — ${pairs[0]}`),
        strategyId: String(cfg.strategyId || strat.id),
        strategyName: String(cfg.strategyName || rec.strategy || strat.name),
        status: cfg.status === 'COMPLETED' ? 'COMPLETED' : 'ACTIVE',
        primarySymbol: String(rec.symbol || pairs[0] || 'XAUUSD'),
        pairs,
        timeframe: String(cfg.timeframe || strat.defaultTimeframe || '15m'),
        secondaryTimeframe: String(cfg.secondaryTimeframe || '1h'),
        auxPeriodTexts: Array.isArray(cfg.auxPeriodTexts) ? cfg.auxPeriodTexts : undefined,
        timezone: typeof cfg.timezone === 'string' ? cfg.timezone : undefined,
        fromDate: String(cfg.fromDate || twoWeeksAgoIso),
        toDate: String(cfg.toDate || todayIso),
        keepEndFollowingToday: Boolean(cfg.keepEndFollowingToday ?? false),
        randomStartDate: Boolean(cfg.randomStartDate ?? false),
        startingCapital: startCap,
        riskPerTrade: Number(cfg.riskPerTrade || strat.riskPerTrade || 1.0),
        rrTarget: Number(cfg.rrTarget || strat.rrTarget || 2.0),
        fundedMode: cfg.fundedMode || {
            enabled: false,
            profitTargetPct: 10,
            maxDailyLossPct: 5,
            maxTotalLossPct: 10,
        },
        currentBalance: Number(res.currentBalance ?? startCap + netPnl),
        netPnl,
        closedTradesCount: Number(res.closedTradesCount ?? closedOrders.length),
        winsCount: Number(
            res.winsCount ?? closedOrders.filter((o: any) => Number(o?.pnl || 0) >= 0).length
        ),
        lossesCount: Number(
            res.lossesCount ?? closedOrders.filter((o: any) => Number(o?.pnl || 0) < 0).length
        ),
        winRate: Number(res.winRate ?? res.simulatedWinRate ?? 0),
        profitFactor: Number(res.profitFactor ?? res.simulatedProfitFactor ?? 0),
        expectancy: Number(res.expectancy ?? 0),
        avgR: Number(res.avgR ?? 0),
        maxDrawdown: Number(res.maxDrawdown ?? 0),
        maxDrawdownPct: Number(res.maxDrawdownPct ?? 0),
        timeInvestedSeconds: Number(cfg.timeInvestedSeconds ?? 0),
        orders,
        journalNotes: String(rec.notes || cfg.journalNotes || ''),
        journalTitle: typeof cfg.journalTitle === 'string' ? cfg.journalTitle : null,
        journalMarketBias: typeof cfg.journalMarketBias === 'string' ? cfg.journalMarketBias : null,
        journalPsychCheck:
            cfg.journalPsychCheck && typeof cfg.journalPsychCheck === 'object'
                ? cfg.journalPsychCheck
                : undefined,
        journalImages: Array.isArray(cfg.journalImages) ? cfg.journalImages : undefined,
        replayTimestamp: cfg.replayTimestamp ?? null,
        spread: Number(cfg.spread ?? 0),
        commission: Number(cfg.commission ?? 0),
        schemaVersion: BACKTEST_SNAPSHOT_SCHEMA_VERSION,
        revision: Number.isFinite(Number(cfg.revision)) ? Math.max(0, Math.floor(Number(cfg.revision))) : 0,
        dataSource: cfg.dataSource,
        layoutMode: cfg.layoutMode,
        selectedCandleStyle: cfg.selectedCandleStyle,
        replayActive: typeof cfg.replayActive === 'boolean' ? cfg.replayActive : undefined,
        syncEnabled: typeof cfg.syncEnabled === 'boolean' ? cfg.syncEnabled : undefined,
        yAxis: cfg.yAxis ?? undefined,
        drawingTools: cfg.drawingTools ?? undefined,
        ticketDefaults: cfg.ticketDefaults ?? undefined,
        drawings,
        drawnItems,
        drawingStylesById,
        overlayGeometries,
        activeIndicators: Array.isArray(cfg.activeIndicators) ? cfg.activeIndicators : undefined,
        indicatorParamsByCode:
            cfg.indicatorParamsByCode && typeof cfg.indicatorParamsByCode === 'object'
                ? cfg.indicatorParamsByCode
                : undefined,
        sessionScreenshots: Array.isArray(cfg.sessionScreenshots) ? cfg.sessionScreenshots : undefined,
        ...(cfg._slimHistory === true ? { _isSlimSummary: true } : {}),
        createdAt: rec.createdAt ? new Date(rec.createdAt).toISOString() : new Date().toISOString(),
        updatedAt: rec.updatedAt
            ? new Date(rec.updatedAt).toISOString()
            : typeof cfg.syncedAt === 'string'
              ? cfg.syncedAt
              : new Date().toISOString(),
    };
}

/**
 * Bidirectional Multi-Device Workspace Sync:
 * - Pulls strategies (`/dashboard/backtest/strategies`), replay sessions (`/dashboard/backtest/history`),
 *   and discovered account setups (`/dashboard/performance`).
 * - Updates existing local strategies & sessions whenever the cloud has a higher `revision` or `updatedAt`.
 * - Prunes local items that were previously synced to the cloud and subsequently deleted on another device.
 * - Bootstrap-pushes offline/unsynced local strategies & sessions to PostgreSQL + Redis.
 */
export async function syncBacktestWorkspaceFromBackend(
    apiClient: {
        get: (url: string, config?: any) => Promise<{ data: any }>;
        post?: (url: string, data?: any, config?: any) => Promise<any>;
        delete?: (url: string, config?: any) => Promise<any>;
    },
    accountId?: string
): Promise<{
    strategies: BacktestStrategy[];
    sessions: BacktestReplaySession[];
    discoveredAccountSetups: { setup: string; count: number; pnl: number }[];
    importedCount: number;
}> {
    const isGlobalSync = !accountId || accountId === 'all';
    const historyParams = isGlobalSync ? { accountId: 'all', slim: '1' } : { accountId, slim: '1' };
    const perfParams = isGlobalSync ? undefined : { accountId };

    const [strategiesRes, historyRes, perfRes] = await Promise.allSettled([
        apiClient.get('/dashboard/backtest/strategies'),
        apiClient.get('/dashboard/backtest/history', { params: historyParams }),
        apiClient.get('/dashboard/performance', { params: perfParams }),
    ]);

    const knownCloud = loadCloudKnownIds();
    let mergedStrategies = [...loadBacktestStrategies()];
    let mergedSessions = [...loadBacktestSessions()];
    let importedCount = 0;

    const strategiesToPush: BacktestStrategy[] = [];
    const sessionsToPush: BacktestReplaySession[] = [];

    // 1. Reconcile Strategies (`GET /dashboard/backtest/strategies`)
    if (strategiesRes.status === 'fulfilled' && Array.isArray(strategiesRes.value?.data)) {
        const remoteStrategyIds = new Set<string>();

        for (const rawStrat of strategiesRes.value.data) {
            const remoteStrat = normalizeStrategyRecord(rawStrat);
            if (!remoteStrat) continue;
            remoteStrategyIds.add(remoteStrat.id);
            knownCloud.strategies.add(remoteStrat.id);

            const idx = mergedStrategies.findIndex(
                (s) => s.id === remoteStrat.id || s.name.toLowerCase() === remoteStrat.name.toLowerCase()
            );
            if (idx === -1) {
                mergedStrategies.push(remoteStrat);
                importedCount++;
            } else {
                const localStrat = mergedStrategies[idx];
                const remoteMs = Date.parse(remoteStrat.updatedAt || '') || 0;
                const localMs = Date.parse(localStrat.updatedAt || '') || 0;
                if (remoteMs > localMs + 1000) {
                    mergedStrategies[idx] = remoteStrat;
                    importedCount++;
                } else if (localMs > remoteMs + 1000) {
                    strategiesToPush.push(localStrat);
                }
            }
        }

        // Prune strategies deleted on another device, or bootstrap-push unsynced local custom strategies
        const reconciledStrategies: BacktestStrategy[] = [];
        for (const localStrat of mergedStrategies) {
            if (remoteStrategyIds.has(localStrat.id)) {
                reconciledStrategies.push(localStrat);
                continue;
            }
            if (knownCloud.strategies.has(localStrat.id) && !SEED_STRATEGY_IDS.has(localStrat.id)) {
                knownCloud.strategies.delete(localStrat.id);
                continue;
            }
            reconciledStrategies.push(localStrat);
            if (!SEED_STRATEGY_IDS.has(localStrat.id)) {
                strategiesToPush.push(localStrat);
            }
        }
        mergedStrategies = reconciledStrategies.length > 0 ? reconciledStrategies : [...DEFAULT_STRATEGIES];
    }

    // 2. Reconcile Replay Sessions (`GET /dashboard/backtest/history`)
    if (historyRes.status === 'fulfilled' && Array.isArray(historyRes.value?.data)) {
        const remoteSessionIds = new Set<string>();

        for (const rec of historyRes.value.data) {
            if (!rec || rec.mode === 'STRATEGY_DEFINITION') continue;
            const cfg = rec?.config || {};
            const res = rec?.results || {};
            const stratName = String(rec?.strategy || cfg?.strategyName || '').trim();

            let matchedStrategy = mergedStrategies.find(
                (s) =>
                    (cfg?.strategyId && s.id === cfg.strategyId) ||
                    (stratName && s.name.toLowerCase() === stratName.toLowerCase())
            );

            if (!matchedStrategy && stratName) {
                const createdStrat = normalizeStrategyRecord({
                    id: cfg.strategyId || generateUuid(),
                    name: stratName,
                    tradingMethod: cfg.strategyMethod || 'Smart Money Concepts (SMC / ICT)',
                    currency: cfg.strategyCurrency || 'USD',
                    startingCapital: cfg.startingCapital || res.initialBalance || 100000,
                    riskMode: cfg.riskMode || 'FIXED_RISK',
                    riskPerTrade: cfg.riskPerTrade || 1.0,
                    rrTarget: cfg.rrTarget || 2.0,
                    timeframe: cfg.timeframe || '15m',
                    primarySymbol: rec.symbol || cfg.pairs?.[0] || 'XAUUSD',
                    pairs: cfg.pairs,
                    createdAt: rec.createdAt,
                    updatedAt: rec.updatedAt,
                });
                if (createdStrat) {
                    mergedStrategies.push(createdStrat);
                    matchedStrategy = createdStrat;
                    strategiesToPush.push(createdStrat);
                    importedCount++;
                }
            }

            const clientSessionId = String(cfg.clientSessionId || '').trim();
            const canonicalId = String(rec?.id || clientSessionId || '').trim();
            if (!canonicalId || rec?.mode !== 'REPLAY_SESSION') continue;

            remoteSessionIds.add(canonicalId);
            if (clientSessionId) remoteSessionIds.add(clientSessionId);
            knownCloud.sessions.add(canonicalId);
            if (clientSessionId) knownCloud.sessions.add(clientSessionId);

            const strat = matchedStrategy || mergedStrategies[0] || DEFAULT_STRATEGIES[0];
            const remoteSession = hydrateRemoteReplaySession(rec, strat);

            const existingIdx = mergedSessions.findIndex(
                (s) =>
                    s.id === remoteSession.id ||
                    (clientSessionId && s.id === clientSessionId)
            );

            if (existingIdx === -1) {
                mergedSessions.push(remoteSession);
                importedCount++;
            } else {
                const localSession = mergedSessions[existingIdx];
                const localTerminalSnap = readLocalReplaySnapshot(localSession.id);
                const localEffectiveRev = Math.max(
                    localSession.revision ?? 0,
                    localTerminalSnap?.revision ?? 0
                );
                const remoteRev = remoteSession.revision ?? 0;
                const localMs = Math.max(
                    Date.parse(localSession.updatedAt || '') || 0,
                    localTerminalSnap?.updatedAtMs ?? 0
                );
                const remoteMs = Date.parse(remoteSession.updatedAt || '') || 0;

                if (
                    remoteRev > localEffectiveRev ||
                    (remoteRev === localEffectiveRev && remoteMs > localMs + 1000)
                ) {
                    const keepLocalOrders =
                        cfg?._slimHistory === true &&
                        (remoteSession.orders?.length ?? 0) === 0 &&
                        (localSession.orders?.length ?? 0) > 0;
                    const mergedRemote: BacktestReplaySession =
                        cfg?._slimHistory === true
                            ? {
                                  ...remoteSession,
                                  orders: keepLocalOrders ? localSession.orders : remoteSession.orders,
                                  _isSlimSummary: keepLocalOrders ? false : remoteSession._isSlimSummary,
                                  drawings: remoteSession.drawings ?? localSession.drawings,
                                  drawnItems: remoteSession.drawnItems ?? localSession.drawnItems,
                                  drawingStylesById:
                                      remoteSession.drawingStylesById ?? localSession.drawingStylesById,
                                  overlayGeometries:
                                      remoteSession.overlayGeometries ?? localSession.overlayGeometries,
                                  sessionScreenshots:
                                      remoteSession.sessionScreenshots ?? localSession.sessionScreenshots,
                              }
                            : remoteSession;
                    mergedSessions[existingIdx] = mergedRemote;
                    importedCount++;
                } else if (localEffectiveRev > remoteRev) {
                    sessionsToPush.push(localSession);
                }
            }
        }

        // Prune sessions deleted on another device (on global sync), or bootstrap-push unsynced local sessions
        const reconciledSessions: BacktestReplaySession[] = [];
        for (const localSess of mergedSessions) {
            if (remoteSessionIds.has(localSess.id)) {
                reconciledSessions.push(localSess);
                continue;
            }
            if (isGlobalSync && knownCloud.sessions.has(localSess.id)) {
                knownCloud.sessions.delete(localSess.id);
                clearLocalReplaySnapshot(localSess.id);
                void deleteEncryptedSessionFromIDB(localSess.id).catch(() => {});
                continue;
            }
            // If user already has real cloud sessions on a fresh device, drop untouched demo seeds
            if (remoteSessionIds.size > 0 && isUntouchedSeedSession(localSess)) {
                continue;
            }
            reconciledSessions.push(localSess);
            if (!isUntouchedSeedSession(localSess)) {
                sessionsToPush.push(localSess);
            }
        }

        reconciledSessions.sort(
            (a, b) => (Date.parse(b.updatedAt || '') || 0) - (Date.parse(a.updatedAt || '') || 0)
        );
        mergedSessions = reconciledSessions;
    }

    saveCloudKnownIds(knownCloud);
    saveBacktestStrategies(mergedStrategies);
    saveBacktestSessions(mergedSessions);

    // 3. Fire non-blocking background pushes for any local items newer than or missing from cloud
    if (typeof apiClient?.post === 'function' && hasAuthToken()) {
        const uniqueStrats = Array.from(new Map(strategiesToPush.map((s) => [s.id, s])).values()).slice(0, 15);
        const uniqueSessions = Array.from(new Map(sessionsToPush.map((s) => [s.id, s])).values()).slice(0, 15);
        if (uniqueStrats.length > 0 || uniqueSessions.length > 0) {
            void Promise.allSettled([
                ...uniqueStrats.map((st) => pushStrategyToBackend(st, apiClient)),
                ...uniqueSessions.map((se) =>
                    pushSessionToBackend(se, apiClient, isGlobalSync ? undefined : accountId)
                ),
            ]);
        }
    }

    const ignoredSetupNames = new Set(['', '-', 'sem setup', 'none', 'unknown', 'n/a', 'null']);
    const rawSetups =
        perfRes.status === 'fulfilled' && Array.isArray(perfRes.value?.data?.bySetup)
            ? perfRes.value.data.bySetup
            : [];
    const discoveredAccountSetups = rawSetups
        .map((item: any) => ({
            setup: String(item?.setup || '').trim(),
            count: Number(item?.count || 0),
            pnl: Number(item?.pnl || 0),
        }))
        .filter((item: { setup: string }) => !ignoredSetupNames.has(item.setup.toLowerCase()));

    return {
        strategies: mergedStrategies,
        sessions: mergedSessions,
        discoveredAccountSetups,
        importedCount,
    };
}

/**
 * Fetches a single full Replay Session (orders, drawings, screenshots, quantMetrics)
 * from Redis/PostgreSQL and hydrates local workspace stores, clearing `_isSlimSummary`.
 */
export async function fetchFullBacktestSessionById(
    sessionId: string,
    apiClient: { get: (url: string, config?: any) => Promise<{ data: any }> } = api
): Promise<BacktestReplaySession | null> {
    if (!sessionId || !hasAuthToken()) return null;
    try {
        const res = await apiClient.get(`/dashboard/backtest/session/${encodeURIComponent(sessionId)}`);
        const raw = res?.data;
        if (!raw || !raw.config || raw.unchanged) return null;
        const strategies = loadBacktestStrategies();
        const cfg = raw.config || {};
        const stratName = String(raw.strategy || cfg.strategyName || '').trim().toLowerCase();
        const strat =
            strategies.find(
                (s) =>
                    (cfg.strategyId && s.id === cfg.strategyId) ||
                    (stratName && s.name.toLowerCase() === stratName)
            ) ||
            strategies[0] ||
            DEFAULT_STRATEGIES[0];
        const hydrated = hydrateRemoteReplaySession(
            {
                ...raw,
                config: {
                    ...cfg,
                    _slimHistory: false,
                },
            },
            strat
        );
        updateBacktestSession(sessionId, {
            ...hydrated,
            _isSlimSummary: false,
        });
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('torex:backtest-workspace-updated'));
        }
        return { ...hydrated, _isSlimSummary: false };
    } catch {
        return null;
    }
}
