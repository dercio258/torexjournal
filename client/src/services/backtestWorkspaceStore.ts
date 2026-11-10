import { ReplayOrder } from '../components/kline-replay/types';

export interface BacktestStrategyRule {
    id: string;
    text: string;
    required: boolean;
}

export interface BacktestStrategy {
    id: string;
    name: string;
    description: string;
    sessionTag: string; // e.g. 'Asian', 'London', 'New York', 'Multi-Session'
    status: 'ACTIVE' | 'ARCHIVED';
    startingCapital: number;
    riskMode: 'FIXED_RISK' | 'DYNAMIC_RISK';
    riskPerTrade: number; // %
    rrTarget: number;
    primarySymbol: string;
    symbols: string[];
    rules: BacktestStrategyRule[];
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
    replayTimestamp: number | null;
    spread: number;
    commission: number;
    createdAt: string;
    updatedAt: string;
}

const STRATEGIES_STORAGE_KEY = 'torex_backtest_strategies_v1';
const SESSIONS_STORAGE_KEY = 'torex_backtest_sessions_v1';

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
        description: 'Liquidez de Sessão, FVG, Order Blocks e Quebra de Estrutura (BOS/CHoCH)',
        sessionTag: 'London & NY',
        status: 'ACTIVE',
        startingCapital: 100000,
        riskMode: 'FIXED_RISK',
        riskPerTrade: 1.0,
        rrTarget: 2.5,
        primarySymbol: 'XAUUSD',
        symbols: ['XAUUSD', 'GBPUSD', 'EURUSD', 'USDJPY'],
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
    } catch (_) {}
}

export function createBacktestStrategy(input: Partial<BacktestStrategy>): BacktestStrategy {
    const list = loadBacktestStrategies();
    const now = new Date().toISOString();
    const newStrategy: BacktestStrategy = {
        id: generateUuid(),
        name: input.name?.trim() || 'Nova Estratégia',
        description: input.description?.trim() || 'Operacional Técnico Personalizado',
        sessionTag: input.sessionTag || 'London & NY',
        status: 'ACTIVE',
        startingCapital: Number(input.startingCapital) || 100000,
        riskMode: input.riskMode || 'FIXED_RISK',
        riskPerTrade: Number(input.riskPerTrade) || 1.0,
        rrTarget: Number(input.rrTarget) || 2.0,
        primarySymbol: input.primarySymbol || 'XAUUSD',
        symbols: input.symbols && input.symbols.length > 0 ? input.symbols : [input.primarySymbol || 'XAUUSD'],
        rules: input.rules || [],
        createdAt: now,
        updatedAt: now,
    };
    const next = [newStrategy, ...list];
    saveBacktestStrategies(next);
    return newStrategy;
}

export function updateBacktestStrategy(id: string, patch: Partial<BacktestStrategy>): BacktestStrategy[] {
    const list = loadBacktestStrategies();
    const next = list.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: new Date().toISOString() } : s));
    saveBacktestStrategies(next);
    return next;
}

export function deleteBacktestStrategy(id: string): BacktestStrategy[] {
    const list = loadBacktestStrategies();
    const filtered = list.filter((s) => s.id !== id);
    const next = filtered.length > 0 ? filtered : DEFAULT_STRATEGIES;
    saveBacktestStrategies(next);
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
                    name: 'Sessão Institucional London & NY',
                    strategyId: defaultStrat.id,
                    strategyName: defaultStrat.name,
                    status: 'ACTIVE',
                    primarySymbol: 'XAUUSD',
                    pairs: ['XAUUSD', 'GBPUSD', 'USDJPY'],
                    timeframe: '15m',
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
                    timeInvestedSeconds: 1140, // 19 min initial seed
                    orders: [],
                    journalNotes: '',
                    replayTimestamp: null,
                    spread: 0,
                    commission: 0,
                    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
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

    const newSession: BacktestReplaySession = {
        id: generateUuid(),
        name: input.name.trim(),
        strategyId: strat.id,
        strategyName: strat.name,
        status: 'ACTIVE',
        primarySymbol,
        pairs,
        timeframe: input.timeframe || '15m',
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
        replayTimestamp: null,
        spread: 0,
        commission: 0,
        createdAt: now,
        updatedAt: now,
    };

    const next = [newSession, ...sessions];
    saveBacktestSessions(next);
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
        updatedItem = {
            ...s,
            ...patch,
            updatedAt: new Date().toISOString(),
        };
        return updatedItem;
    });
    if (updatedItem) {
        saveBacktestSessions(next);
    }
    return updatedItem;
}

export function deleteBacktestSession(sessionId: string): BacktestReplaySession[] {
    const sessions = loadBacktestSessions();
    const next = sessions.filter((s) => s.id !== sessionId);
    saveBacktestSessions(next);
    return next;
}
