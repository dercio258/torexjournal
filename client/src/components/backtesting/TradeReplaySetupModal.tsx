import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Check,
    Download,
    FolderKanban,
    FolderPlus,
    Layers,
    Link2,
    Play,
    Plus,
    RefreshCw,
    Save,
    Search,
    Sparkles,
    TrendingDown,
    TrendingUp,
    Upload,
    X,
} from 'lucide-react';
import api from '../../api';
import { ReplayOrder } from '../kline-replay/types';
import {
    AccountCurrencyCode,
    BacktestReplaySession,
    BacktestStrategy,
    createBacktestStrategy,
    generateUuid,
    importStrategiesFromJson,
    loadBacktestSessions,
    loadBacktestStrategies,
    saveBacktestSessions,
    syncBacktestWorkspaceFromBackend,
} from '../../services/backtestWorkspaceStore';
import {
    prefetchSessionViaSharedDemoAccount,
    saveEncryptedSessionToIDB,
    SessionVaultData,
} from '../../services/historicalBatchCache';
import {
    BACKTEST_SNAPSHOT_SCHEMA_VERSION,
    normalizeSnapshotToV2,
    readLocalReplaySnapshot,
    writeLocalReplaySnapshot,
} from '../../services/backtestSessionSnapshot';
import { Field, fmtIsoDate, fmtMoney, inputCls, pnlTone, Toggle } from './primitives';
import { cn } from '../../lib/cn';
import { useLocale } from '../../context/LocaleContext';

const TRADING_METHODS: { value: string; en: string }[] = [
    { value: 'Smart Money Concepts (SMC / ICT)', en: 'Smart Money Concepts (SMC / ICT)' },
    { value: 'Price Action Institucional', en: 'Institutional Price Action' },
    { value: 'Wyckoff & Liquidez', en: 'Wyckoff & Liquidity' },
    { value: 'Breakout & Momentum', en: 'Breakout & Momentum' },
    { value: 'Scalping de Fluxo (Order Flow)', en: 'Order Flow Scalping' },
    { value: 'Mean Reversion (Retorno à Média)', en: 'Mean Reversion' },
    { value: 'Trend Following (Seguidor de Tendência)', en: 'Trend Following' },
    { value: 'Supply & Demand (Oferta e Demanda)', en: 'Supply & Demand' },
    { value: 'Outro Método Personalizado', en: 'Other Custom Playbook' },
];

const CURRENCIES: AccountCurrencyCode[] = ['USD', 'EUR', 'GBP', 'MZN'];
const CAPITAL_PRESETS = [5000, 10000, 25000, 50000, 100000, 200000];
const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h'];

export interface TradeReplaySourceData {
    id: string | number;
    ticket?: string | number;
    symbol: string;
    type: string;
    volume: number;
    openPrice: number;
    closePrice: number;
    sl?: number;
    tp?: number;
    openTime: string;
    closeTime?: string;
    profit: number;
    commission?: number;
    swap?: number;
    accountId?: string;
    currency?: string;
    setup?: string;
    lesson?: string;
}

interface TradeReplaySetupModalProps {
    isOpen: boolean;
    onClose: () => void;
    trade: TradeReplaySourceData;
    technicalNotes?: string;
    technicalStrategyUsed?: string;
    syncSourceLabel?: string;
    accountCurrency?: string;
    accountInitialBalance?: number;
    hasCachedMarketData?: boolean;
    onSavedToBacktest: (result: {
        session: BacktestReplaySession;
        strategy: BacktestStrategy;
        openedReplay: boolean;
    }) => void;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeReplaySymbol(raw: string): string {
    const clean = (raw || 'XAUUSD').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.startsWith('XAUUSD') || clean.startsWith('GOLD')) return 'XAUUSD';
    if (clean.startsWith('EURUSD')) return 'EURUSD';
    if (clean.startsWith('GBPUSD')) return 'GBPUSD';
    if (clean.startsWith('USDJPY')) return 'USDJPY';
    if (clean.startsWith('AUDUSD')) return 'AUDUSD';
    if (clean.startsWith('NZDUSD')) return 'NZDUSD';
    if (clean.startsWith('USDCAD')) return 'USDCAD';
    if (clean.startsWith('USDCHF')) return 'USDCHF';
    if (clean.startsWith('GBPJPY')) return 'GBPJPY';
    if (clean.startsWith('EURJPY')) return 'EURJPY';
    if (clean.startsWith('EURGBP')) return 'EURGBP';
    if (clean.startsWith('BTCUSD')) return 'BTCUSD';
    if (clean.startsWith('ETHUSD')) return 'ETHUSD';
    if (clean.startsWith('SOLUSD')) return 'SOLUSD';
    if (clean.startsWith('NAS100') || clean.startsWith('US100') || clean.startsWith('USTEC')) return 'NAS100';
    if (clean.startsWith('US30') || clean.startsWith('DJ30')) return 'US30';
    if (clean.startsWith('SPX500') || clean.startsWith('US500')) return 'SPX500';
    return clean || 'XAUUSD';
}

export function buildReplayOrderFromTrade(
    t: TradeReplaySourceData,
    startingCapital: number,
    riskPerTradePct: number
): ReplayOrder {
    const isBuy = String(t.type).toUpperCase().includes('BUY');
    const entry = Number(t.openPrice) || 100;
    const exit = Number(t.closePrice) || entry;
    const pnl = Number(t.profit || 0) + Number(t.commission || 0) + Number(t.swap || 0);

    const rawSl = Number(t.sl || 0);
    const rawTp = Number(t.tp || 0);
    const sl = rawSl > 0 ? Number(rawSl.toFixed(5)) : 0;
    const tp = rawTp > 0 ? Number(rawTp.toFixed(5)) : 0;

    const openTs = new Date(t.openTime).getTime() || Date.now() - 3600_000;
    const closeTs = new Date(t.closeTime || t.openTime).getTime() || openTs + 900_000;

    const riskDist = sl > 0 ? Math.abs(entry - sl) : 0;
    const rewardDist = tp > 0 ? Math.abs(tp - entry) : Math.abs(exit - entry);
    const rrRatio = riskDist > 0 && rewardDist > 0 ? Number(Math.max(0.5, rewardDist / riskDist).toFixed(2)) : 2;
    const plannedRisk = Math.max(10, Math.round((startingCapital * (riskPerTradePct || 1)) / 100));
    const riskAmount = sl > 0 ? plannedRisk : Math.max(10, Math.abs(pnl) || plannedRisk);
    const tol = Math.max(Math.abs(exit - entry) * 0.2, entry * 0.0002);
    const exitReason: 'TP' | 'SL' | 'MANUAL' =
        tp > 0 && Math.abs(exit - tp) <= tol
            ? 'TP'
            : sl > 0 && Math.abs(exit - sl) <= tol
              ? 'SL'
              : pnl >= 0
                ? 'TP'
                : 'SL';

    return {
        id: `mt5_${t.id || t.ticket || Math.random().toString(36).slice(2, 8)}`,
        symbol: normalizeReplaySymbol(t.symbol),
        side: isBuy ? 'BUY' : 'SELL',
        orderType: 'MARKET',
        entryPrice: entry,
        stopLoss: sl,
        initialStopLoss: sl,
        takeProfit: tp,
        lots: Number(t.volume) || 0.1,
        riskAmount,
        rrRatio,
        status: pnl >= 0 ? 'WIN' : 'LOSS',
        openedAt: openTs,
        filledAt: openTs,
        closedAt: closeTs,
        isImportedTrade: true,
        historicalExitPrice: exit,
        historicalClosedAt: closeTs,
        historicalPnl: Number(pnl.toFixed(2)),
        historicalExitReason: exitReason,
        exitPrice: exit,
        exitReason,
        pnl: Number(pnl.toFixed(2)),
        rMultiple: Number((pnl / riskAmount).toFixed(2)),
        setup: t.setup || null,
        journalContent: t.lesson || '',
    };
}

function computeConsolidatedSessionMetrics(orders: ReplayOrder[], startingCapital: number) {
    const closed = orders.filter((o) => o.status === 'WIN' || o.status === 'LOSS' || o.closedAt);
    const closedCount = closed.length;
    const netPnl = Number(closed.reduce((sum, o) => sum + Number(o.pnl || 0), 0).toFixed(2));
    const winsCount = closed.filter((o) => Number(o.pnl || 0) >= 0).length;
    const lossesCount = closed.filter((o) => Number(o.pnl || 0) < 0).length;
    const winRate = closedCount > 0 ? Number(((winsCount / closedCount) * 100).toFixed(1)) : 0;

    const grossWin = closed.filter((o) => o.pnl > 0).reduce((s, o) => s + o.pnl, 0);
    const grossLoss = Math.abs(closed.filter((o) => o.pnl < 0).reduce((s, o) => s + o.pnl, 0));
    const profitFactor =
        grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? 2.5 : 0;

    const expectancy = closedCount > 0 ? Number((netPnl / closedCount).toFixed(2)) : 0;
    const avgR =
        closedCount > 0
            ? Number(
                  (closed.reduce((s, o) => s + Number(o.rMultiple || 0), 0) / closedCount).toFixed(2)
              )
            : 0;

    let equity = startingCapital;
    let peak = startingCapital;
    let maxDrawdown = 0;
    for (const ord of [...closed].sort((a, b) => a.openedAt - b.openedAt)) {
        equity += Number(ord.pnl || 0);
        if (equity > peak) peak = equity;
        const dd = peak - equity;
        if (dd > maxDrawdown) maxDrawdown = dd;
    }
    const maxDrawdownPct = peak > 0 ? Number(((maxDrawdown / peak) * 100).toFixed(2)) : 0;

    return {
        currentBalance: Number((startingCapital + netPnl).toFixed(2)),
        netPnl,
        closedTradesCount: closedCount,
        winsCount,
        lossesCount,
        winRate,
        profitFactor,
        expectancy,
        avgR,
        maxDrawdown: Number(maxDrawdown.toFixed(2)),
        maxDrawdownPct,
    };
}

export const TradeReplaySetupModal: React.FC<TradeReplaySetupModalProps> = ({
    isOpen,
    onClose,
    trade,
    technicalNotes,
    technicalStrategyUsed,
    syncSourceLabel = 'MT5 Sync',
    accountCurrency,
    accountInitialBalance,
    hasCachedMarketData = false,
    onSavedToBacktest,
}) => {
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const fileInputRef = useRef<HTMLInputElement>(null);

    const normSymbol = useMemo(() => normalizeReplaySymbol(trade.symbol), [trade.symbol]);
    const ticketLabel = useMemo(
        () => String(trade.ticket || (typeof trade.id === 'string' ? trade.id.split('-')[0] : trade.id)),
        [trade.id, trade.ticket]
    );
    const netProfit = useMemo(
        () => Number(trade.profit || 0) + Number(trade.commission || 0) + Number(trade.swap || 0),
        [trade.profit, trade.commission, trade.swap]
    );
    const isBuy = String(trade.type).toUpperCase().includes('BUY');

    const [strategies, setStrategies] = useState<BacktestStrategy[]>([]);
    const [sessions, setSessions] = useState<BacktestReplaySession[]>([]);
    const [discoveredSetups, setDiscoveredSetups] = useState<{ setup: string; count: number; pnl: number }[]>([]);
    const [isLoadingStrategies, setIsLoadingStrategies] = useState(false);
    const [statusToast, setStatusToast] = useState<string | null>(null);

    // 1. Strategy selection vs quick creation
    const [strategyMode, setStrategyMode] = useState<'existing' | 'create'>('existing');
    const [strategySearch, setStrategySearch] = useState('');
    const [selectedStrategyId, setSelectedStrategyId] = useState<string>('');

    // Quick strategy form state
    const [newStratName, setNewStratName] = useState('');
    const [newStratMethod, setNewStratMethod] = useState(TRADING_METHODS[0].value);
    const [newStratCurrency, setNewStratCurrency] = useState<AccountCurrencyCode>('USD');
    const [newStratCapital, setNewStratCapital] = useState<number>(100000);
    const [newStratRiskMode, setNewStratRiskMode] = useState<'FIXED_RISK' | 'COMPOUNDING'>('FIXED_RISK');
    const [newStratRiskPct, setNewStratRiskPct] = useState<number>(1.0);
    const [newStratRr, setNewStratRr] = useState<number>(2.0);

    // 2. Session association mode: create new session vs associate to an existing session
    const [sessionMode, setSessionMode] = useState<'new' | 'existing'>('new');
    const [selectedExistingSessionId, setSelectedExistingSessionId] = useState<string>('');

    // New session configuration state
    const [sessionName, setSessionName] = useState('');
    const [timeframe, setTimeframe] = useState('15m');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [includeExecutedOrder, setIncludeExecutedOrder] = useState(true);
    const [syncTradeSetupField, setSyncTradeSetupField] = useState(true);
    const [journalNotes, setJournalNotes] = useState('');

    const [error, setError] = useState<string | null>(null);
    const [savingAction, setSavingAction] = useState<'save' | 'replay' | null>(null);

    const loadAndSyncExistingStrategies = async (showFeedback = false) => {
        setIsLoadingStrategies(true);
        setError(null);
        try {
            const result = await syncBacktestWorkspaceFromBackend(
                api,
                trade.accountId ? String(trade.accountId) : undefined
            );
            setStrategies(result.strategies);
            setSessions(result.sessions);
            setDiscoveredSetups(result.discoveredAccountSetups);

            if (!selectedStrategyId && result.strategies.length > 0) {
                setSelectedStrategyId(result.strategies[0].id);
            }
            if (showFeedback) {
                setStatusToast(
                    result.importedCount > 0
                        ? isEn
                            ? `${result.importedCount} item(s) synced from Backtesting.`
                            : `${result.importedCount} item(ns) sincronizado(s) do Backtest.`
                        : isEn
                          ? `${result.strategies.length} strategy(ies) and ${result.sessions.length} session(s) loaded.`
                          : `${result.strategies.length} estratégia(s) e ${result.sessions.length} sessão(ões) carregadas.`
                );
                setTimeout(() => setStatusToast(null), 3500);
            }
        } catch (_) {
            setStrategies(loadBacktestStrategies());
            setSessions(loadBacktestSessions());
        } finally {
            setIsLoadingStrategies(false);
        }
    };

    // Hydrate modal defaults whenever opened
    useEffect(() => {
        if (!isOpen) return;
        setError(null);
        setStatusToast(null);
        setSavingAction(null);
        setStrategySearch('');

        const localStrategies = loadBacktestStrategies();
        const localSessions = loadBacktestSessions();
        setStrategies(localStrategies);
        setSessions(localSessions);

        const orderIdTag = `mt5_${trade.id}`;
        const matchedSession =
            localSessions.find(
                (s) =>
                    String(s.id) === String(trade.id) ||
                    s.orders?.some((o) => o.id === orderIdTag || String(o.id) === String(trade.id))
            ) || null;

        // Match strategy by existing session -> trade.setup -> technicalStrategyUsed -> first strategy
        const hintName = (trade.setup || technicalStrategyUsed || '').trim().toLowerCase();
        const matchedStrat =
            (matchedSession && localStrategies.find((s) => s.id === matchedSession.strategyId)) ||
            (hintName
                ? localStrategies.find(
                      (s) => s.name.toLowerCase() === hintName || s.name.toLowerCase().includes(hintName)
                  )
                : undefined) ||
            localStrategies[0];

        setStrategyMode(localStrategies.length === 0 ? 'create' : 'existing');
        setSelectedStrategyId(matchedStrat?.id || '');

        if (matchedSession) {
            setSessionMode('existing');
            setSelectedExistingSessionId(matchedSession.id);
        } else {
            setSessionMode('new');
            const firstStratSession = localSessions.find((s) => s.strategyId === matchedStrat?.id);
            setSelectedExistingSessionId(firstStratSession?.id || localSessions[0]?.id || '');
        }

        // Quick strategy defaults
        const suggestedNewName =
            trade.setup?.trim() || technicalStrategyUsed?.trim() || (isEn ? `${normSymbol} Playbook` : `Operacional ${normSymbol}`);
        setNewStratName(suggestedNewName);
        setNewStratMethod(TRADING_METHODS[0].value);

        const normalizedAccCurr = (accountCurrency || trade.currency || 'USD').toUpperCase() as AccountCurrencyCode;
        setNewStratCurrency(CURRENCIES.includes(normalizedAccCurr) ? normalizedAccCurr : 'USD');

        const rawAccBalance = Number(accountInitialBalance || 0);
        setNewStratCapital(rawAccBalance >= 100 ? Math.round(rawAccBalance) : 100000);
        setNewStratRiskMode('FIXED_RISK');
        setNewStratRiskPct(1.0);
        setNewStratRr(2.0);

        // Session defaults
        const openDate = new Date(trade.openTime || Date.now());
        const closeDate = new Date(trade.closeTime || openDate.getTime() + 3600_000);
        const todayIso = new Date().toISOString().slice(0, 10);
        const defaultFrom = new Date(openDate.getTime() - 86400_000 * 3).toISOString().slice(0, 10);
        const rawTo = new Date(closeDate.getTime() + 86400_000 * 2).toISOString().slice(0, 10);
        const defaultTo = rawTo > todayIso ? todayIso : rawTo < defaultFrom ? todayIso : rawTo;

        setSessionName(matchedSession?.name || `Replay Trade #${ticketLabel} · ${normSymbol}`);
        setTimeframe(matchedSession?.timeframe || matchedStrat?.defaultTimeframe || '15m');
        setFromDate(matchedSession?.fromDate || defaultFrom);
        setToDate(matchedSession?.toDate || defaultTo);
        setIncludeExecutedOrder(true);
        setSyncTradeSetupField(!trade.setup);
        setJournalNotes(
            matchedSession?.journalNotes ||
                trade.lesson ||
                technicalNotes ||
                (isEn
                    ? `Replay for Trade #${ticketLabel} (${normSymbol}) synced via ${syncSourceLabel}.`
                    : `Replay do Trade #${ticketLabel} (${normSymbol}) sincronizado via ${syncSourceLabel}.`)
        );

        // Pull any additional strategies & sessions stored in backend
        void loadAndSyncExistingStrategies(false);
    }, [
        isOpen,
        trade,
        normSymbol,
        ticketLabel,
        technicalNotes,
        technicalStrategyUsed,
        syncSourceLabel,
        accountCurrency,
        accountInitialBalance,
    ]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!isOpen) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !savingAction) onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => {
            document.body.style.overflow = prev;
            window.removeEventListener('keydown', onKey);
        };
    }, [isOpen, onClose, savingAction]);

    const activeExistingStrategy = useMemo(
        () => strategies.find((s) => s.id === selectedStrategyId) || strategies[0],
        [strategies, selectedStrategyId]
    );

    const filteredStrategies = useMemo(() => {
        const q = strategySearch.trim().toLowerCase();
        if (!q) return strategies;
        return strategies.filter(
            (s) =>
                s.name.toLowerCase().includes(q) ||
                (s.tradingMethod || '').toLowerCase().includes(q) ||
                (s.symbols || []).some((sym) => sym.toLowerCase().includes(q))
        );
    }, [strategies, strategySearch]);

    // Setups from real account trades not yet registered as a BacktestStrategy
    const unimportedAccountSetups = useMemo(() => {
        const existingNames = new Set(strategies.map((s) => s.name.trim().toLowerCase()));
        return discoveredSetups.filter((item) => !existingNames.has(item.setup.trim().toLowerCase()));
    }, [discoveredSetups, strategies]);

    // Order existing sessions: sessions of the chosen strategy first, then others
    const orderedExistingSessions = useMemo(() => {
        if (!activeExistingStrategy || strategyMode === 'create') return sessions;
        const matching = sessions.filter((s) => s.strategyId === activeExistingStrategy.id);
        const others = sessions.filter((s) => s.strategyId !== activeExistingStrategy.id);
        return [...matching, ...others];
    }, [sessions, activeExistingStrategy, strategyMode]);

    const selectedExistingSession = useMemo(
        () =>
            orderedExistingSessions.find((s) => s.id === selectedExistingSessionId) ||
            orderedExistingSessions[0] ||
            null,
        [orderedExistingSessions, selectedExistingSessionId]
    );

    const handleImportStrategyFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;

        setError(null);
        try {
            const text = await file.text();
            const { importedStrategies, strategies: nextStrategies, sessions: nextSessions } =
                importStrategiesFromJson(text);
            if (importedStrategies.length === 0) {
                setError(isEn ? 'The JSON file does not contain valid strategies.' : 'O ficheiro JSON não contém estratégias válidas.');
                return;
            }
            setStrategies(nextStrategies);
            setSessions(nextSessions);
            setSelectedStrategyId(importedStrategies[0].id);
            setStrategyMode('existing');
            setStatusToast(
                isEn
                    ? `${importedStrategies.length} strategy(ies) imported: ${importedStrategies
                          .map((s) => s.name)
                          .join(', ')}`
                    : `${importedStrategies.length} estratégia(s) importada(s): ${importedStrategies
                          .map((s) => s.name)
                          .join(', ')}`
            );
            setTimeout(() => setStatusToast(null), 4000);
        } catch (_) {
            setError(isEn ? 'Unable to read the strategy JSON file.' : 'Não foi possível ler o ficheiro JSON de estratégias.');
        }
    };

    const handleImportAccountSetup = (setupName: string) => {
        const normalizedCurr = (accountCurrency || trade.currency || 'USD').toUpperCase() as AccountCurrencyCode;
        const created = createBacktestStrategy({
            name: setupName,
            tradingMethod: isEn ? 'Account Imported Setup' : 'Operacional Importado da Conta',
            description: isEn
                ? `Setup imported from trade history (${setupName})`
                : `Setup importado do histórico de trades (${setupName})`,
            sessionTag: 'London & NY',
            currency: CURRENCIES.includes(normalizedCurr) ? normalizedCurr : 'USD',
            startingCapital: Number(accountInitialBalance) >= 100 ? Math.round(Number(accountInitialBalance)) : 100000,
            riskMode: 'FIXED_RISK',
            defaultTimeframe: timeframe,
            riskPerTrade: 1.0,
            rrTarget: 2.0,
            primarySymbol: normSymbol,
            symbols: Array.from(new Set([normSymbol, 'XAUUSD', 'EURUSD', 'GBPUSD'])),
        });
        const refreshed = loadBacktestStrategies();
        setStrategies(refreshed);
        setSelectedStrategyId(created.id);
        setStrategyMode('existing');
        setStatusToast(
            isEn
                ? `Strategy "${created.name}" imported and selected.`
                : `Estratégia "${created.name}" importada e selecionada.`
        );
        setTimeout(() => setStatusToast(null), 3500);
    };

    const handleQuickCreateInline = () => {
        if (!newStratName.trim()) {
            setError(isEn ? 'Enter a name for the new strategy.' : 'Informe um nome para a nova estratégia.');
            return;
        }
        setError(null);
        const created = createBacktestStrategy({
            name: newStratName.trim(),
            tradingMethod: newStratMethod,
            description: isEn
                ? `${newStratMethod} · Created from Trade #${ticketLabel}`
                : `${newStratMethod} · Criada a partir do Trade #${ticketLabel}`,
            sessionTag: 'London & NY',
            currency: newStratCurrency,
            startingCapital: Number(newStratCapital) || 100000,
            riskMode: newStratRiskMode,
            defaultTimeframe: timeframe,
            riskPerTrade: Number(newStratRiskPct) || 1.0,
            rrTarget: Number(newStratRr) || 2.0,
            primarySymbol: normSymbol,
            symbols: Array.from(new Set([normSymbol, 'XAUUSD', 'EURUSD', 'GBPUSD'])),
        });
        const refreshed = loadBacktestStrategies();
        setStrategies(refreshed);
        setSelectedStrategyId(created.id);
        setTimeframe(created.defaultTimeframe || timeframe);
        setStrategyMode('existing');
        setSessionMode('new');
        setStatusToast(
            isEn
                ? `Strategy "${created.name}" created and ready to attach to a session.`
                : `Estratégia "${created.name}" criada e pronta para associar à sessão.`
        );
        setTimeout(() => setStatusToast(null), 3500);
    };

    const handlePersistSession = async (openReplayAfterSave: boolean) => {
        if (savingAction) return;
        setError(null);

        if (sessionMode === 'new') {
            if (!sessionName.trim()) {
                setError(isEn ? 'Give the new replay session a name.' : 'Dê um nome à nova sessão de replay.');
                return;
            }
            if (fromDate && toDate && fromDate > toDate) {
                setError(
                    isEn
                        ? 'Historical start date must be on or before end date.'
                        : 'A data inicial do período deve ser anterior ou igual à data final.'
                );
                return;
            }
        } else if (!selectedExistingSession) {
            setError(
                isEn
                    ? 'Select an existing session or switch to creating a new session.'
                    : 'Selecione uma sessão existente ou mude para criar nova sessão.'
            );
            return;
        }

        let targetStrategy: BacktestStrategy | undefined = activeExistingStrategy;

        if (strategyMode === 'create') {
            if (!newStratName.trim()) {
                setError(isEn ? 'Enter the new strategy name to continue.' : 'Informe o nome da nova estratégia para continuar.');
                return;
            }
            targetStrategy = createBacktestStrategy({
                name: newStratName.trim(),
                tradingMethod: newStratMethod,
                description: isEn
                    ? `${newStratMethod} · Created from Trade #${ticketLabel}`
                    : `${newStratMethod} · Criada a partir do Trade #${ticketLabel}`,
                sessionTag: 'London & NY',
                currency: newStratCurrency,
                startingCapital: Number(newStratCapital) || 100000,
                riskMode: newStratRiskMode,
                defaultTimeframe: timeframe,
                riskPerTrade: Number(newStratRiskPct) || 1.0,
                rrTarget: Number(newStratRr) || 2.0,
                primarySymbol: normSymbol,
                symbols: Array.from(new Set([normSymbol, 'XAUUSD', 'EURUSD', 'GBPUSD'])),
            });
            setStrategies(loadBacktestStrategies());
            setSelectedStrategyId(targetStrategy.id);
        }

        if (!targetStrategy) {
            setError(
                isEn
                    ? 'Select an existing strategy or create a new quick strategy.'
                    : 'Selecione uma estratégia existente ou crie uma nova estratégia rápida.'
            );
            return;
        }

        setSavingAction(openReplayAfterSave ? 'replay' : 'save');

        try {
            const allSessions = loadBacktestSessions();
            const nowIso = new Date().toISOString();
            const openDateMs = new Date(trade.openTime || Date.now()).getTime();
            const closeDateMs = new Date(trade.closeTime || trade.openTime || Date.now()).getTime();
            const activeTf =
                sessionMode === 'existing' && selectedExistingSession
                    ? selectedExistingSession.timeframe || timeframe
                    : timeframe;
            const tfStepMs =
                activeTf === '1m'
                    ? 60_000
                    : activeTf === '5m'
                      ? 300_000
                      : activeTf === '1h' || activeTf === '1H'
                        ? 3_600_000
                        : activeTf === '4h' || activeTf === '4H'
                          ? 14_400_000
                          : 900_000;
            const tradeEndMs =
                Number.isFinite(closeDateMs) && closeDateMs >= openDateMs
                    ? closeDateMs
                    : openDateMs + tfStepMs * 4;
            // Position initial cutoff 8 candles AFTER closeTime so BOTH Entry and Exit markers are immediately visible on screen
            const initialReplayTs = Number.isFinite(openDateMs)
                ? Math.min(Date.now(), tradeEndMs + tfStepMs * 8)
                : Date.now() - 3600_000;

            let sessionObj: BacktestReplaySession;

            if (sessionMode === 'existing' && selectedExistingSession) {
                // Associate to an existing session & bind it to the selected strategy
                const base = selectedExistingSession;
                const startCap = Number(targetStrategy.startingCapital || base.startingCapital || 100000);
                const riskPct = Number(base.riskPerTrade || targetStrategy.riskPerTrade || 1.0);
                const rrTarget = Number(base.rrTarget || targetStrategy.rrTarget || 2.0);

                const replayOrder = buildReplayOrderFromTrade(trade, startCap, riskPct);
                const existingOrders = Array.isArray(base.orders) ? base.orders : [];
                const mergedOrders = includeExecutedOrder
                    ? [
                          ...existingOrders.filter(
                              (o) => o.id !== replayOrder.id && String(o.id) !== String(trade.id)
                          ),
                          replayOrder,
                      ].sort((a, b) => a.openedAt - b.openedAt)
                    : existingOrders;

                const metrics = computeConsolidatedSessionMetrics(mergedOrders, startCap);
                const mergedPairs = Array.from(
                    new Set([normSymbol, ...(base.pairs || []), ...(targetStrategy.symbols || [])])
                );

                const tradeFromIso = new Date(openDateMs - 86400_000 * 2).toISOString().slice(0, 10);
                const tradeToIso = new Date(
                    Math.min(Date.now(), (new Date(trade.closeTime || trade.openTime).getTime() || openDateMs) + 86400_000 * 2)
                )
                    .toISOString()
                    .slice(0, 10);

                const nextFromDate =
                    base.fromDate && base.fromDate < tradeFromIso ? base.fromDate : tradeFromIso;
                const nextToDate =
                    base.toDate && base.toDate > tradeToIso ? base.toDate : tradeToIso;

                const appendedNotes = journalNotes.trim()
                    ? base.journalNotes && !base.journalNotes.includes(journalNotes.trim())
                        ? `${base.journalNotes}\n\n[Trade #${ticketLabel}]: ${journalNotes.trim()}`
                        : journalNotes.trim()
                    : base.journalNotes || '';

                const prevSnapRev = readLocalReplaySnapshot(base.id)?.revision ?? 0;
                const nextRev = Math.max(base.revision ?? 0, prevSnapRev) + 1;

                sessionObj = {
                    ...base,
                    schemaVersion: BACKTEST_SNAPSHOT_SCHEMA_VERSION,
                    revision: nextRev,
                    strategyId: targetStrategy.id,
                    strategyName: targetStrategy.name,
                    primarySymbol: normSymbol,
                    pairs: mergedPairs,
                    fromDate: nextFromDate,
                    toDate: nextToDate,
                    startingCapital: startCap,
                    riskPerTrade: riskPct,
                    rrTarget,
                    ...metrics,
                    orders: mergedOrders,
                    journalNotes: appendedNotes,
                    replayTimestamp: initialReplayTs,
                    updatedAt: nowIso,
                };
            } else {
                // Create a new session associated with targetStrategy
                const tradeIdStr = String(trade.id || '');
                const targetSessionId =
                    UUID_REGEX.test(tradeIdStr) && !allSessions.some((s) => s.id === tradeIdStr)
                        ? tradeIdStr
                        : generateUuid();

                const startCap = Number(targetStrategy.startingCapital) || 100000;
                const riskPct = Number(targetStrategy.riskPerTrade) || 1.0;
                const rrTarget = Number(targetStrategy.rrTarget) || 2.0;

                const replayOrder = buildReplayOrderFromTrade(trade, startCap, riskPct);
                const orders = includeExecutedOrder ? [replayOrder] : [];
                const metrics = computeConsolidatedSessionMetrics(orders, startCap);

                const pairs = Array.from(
                    new Set([
                        normSymbol,
                        ...(targetStrategy.symbols?.length
                            ? targetStrategy.symbols
                            : ['XAUUSD', 'EURUSD', 'GBPUSD']),
                    ])
                );

                sessionObj = {
                    id: targetSessionId,
                    name: sessionName.trim(),
                    strategyId: targetStrategy.id,
                    strategyName: targetStrategy.name,
                    status: 'ACTIVE',
                    primarySymbol: normSymbol,
                    pairs,
                    timeframe,
                    secondaryTimeframe: '1h',
                    fromDate,
                    toDate,
                    keepEndFollowingToday: false,
                    randomStartDate: false,
                    startingCapital: startCap,
                    riskPerTrade: riskPct,
                    rrTarget,
                    fundedMode: {
                        enabled: false,
                        profitTargetPct: 10,
                        maxDailyLossPct: 5,
                        maxTotalLossPct: 10,
                    },
                    ...metrics,
                    timeInvestedSeconds: 0,
                    orders,
                    journalNotes: journalNotes.trim(),
                    replayTimestamp: initialReplayTs,
                    spread: 0,
                    commission: Number(trade.commission || 0),
                    schemaVersion: BACKTEST_SNAPSHOT_SCHEMA_VERSION,
                    revision: 1,
                    createdAt: nowIso,
                    updatedAt: nowIso,
                };
            }

            // 1. Save in Backtest Workspace Store (localStorage) + synchronize V2 Local Replay Snapshot
            const remainingSessions = allSessions.filter((s) => s.id !== sessionObj.id);
            saveBacktestSessions([sessionObj, ...remainingSessions]);
            const syncedLocalSnap = normalizeSnapshotToV2(
                {
                    ...(readLocalReplaySnapshot(sessionObj.id) || {}),
                    ...(sessionObj as Record<string, any>),
                    ticker: sessionObj.primarySymbol,
                    periodText: sessionObj.timeframe,
                    secondaryPeriodText: sessionObj.secondaryTimeframe,
                    revision: sessionObj.revision ?? 1,
                    updatedAtMs: Date.now(),
                },
                sessionObj.id
            );
            if (syncedLocalSnap) {
                writeLocalReplaySnapshot(sessionObj.id, syncedLocalSnap);
            }

            // 2. Save in Encrypted IndexedDB Session Vault (AES-256-GCM)
            const vaultPayload: SessionVaultData = {
                sessionId: sessionObj.id,
                name: sessionObj.name,
                strategyName: sessionObj.strategyName,
                primarySymbol: sessionObj.primarySymbol,
                timeframe: sessionObj.timeframe,
                secondaryTimeframe: sessionObj.secondaryTimeframe,
                pairs: sessionObj.pairs,
                fromDate: sessionObj.fromDate,
                toDate: sessionObj.toDate,
                orders: sessionObj.orders,
                drawnItems: sessionObj.drawnItems,
                drawingStylesById: sessionObj.drawingStylesById,
                overlayGeometries: sessionObj.overlayGeometries,
                activeIndicators: sessionObj.activeIndicators,
                indicatorParamsByCode: sessionObj.indicatorParamsByCode,
                sessionScreenshots: sessionObj.sessionScreenshots,
                journalNotes: sessionObj.journalNotes,
                replayTimestamp: sessionObj.replayTimestamp,
                currentBalance: sessionObj.currentBalance,
                netPnl: sessionObj.netPnl,
                closedTradesCount: sessionObj.closedTradesCount,
                winsCount: sessionObj.winsCount,
                lossesCount: sessionObj.lossesCount,
                winRate: sessionObj.winRate,
                profitFactor: sessionObj.profitFactor,
                expectancy: sessionObj.expectancy,
                avgR: sessionObj.avgR,
                maxDrawdown: sessionObj.maxDrawdown,
                maxDrawdownPct: sessionObj.maxDrawdownPct,
                timeInvestedSeconds: sessionObj.timeInvestedSeconds,
                spread: sessionObj.spread,
                commission: sessionObj.commission,
                updatedAt: nowIso,
            };

            const { digestHex } = await saveEncryptedSessionToIDB(sessionObj.id, vaultPayload);

            // 3. Persist to Backend Redis + PostgreSQL (`backtest_sessions`)
            const targetAccountId =
                trade.accountId && trade.accountId !== 'all' ? String(trade.accountId) : undefined;

            await api
                .post(
                    '/dashboard/backtest/session-sync',
                    {
                        ...vaultPayload,
                        sessionId: sessionObj.id,
                        name: sessionObj.name,
                        mode: 'REPLAY_SESSION',
                        strategy: targetStrategy.name,
                        strategyName: targetStrategy.name,
                        symbol: normSymbol,
                        encryptedDigest: digestHex,
                        config: {
                            strategyId: targetStrategy.id,
                            strategyName: targetStrategy.name,
                            strategyMethod: targetStrategy.tradingMethod,
                            strategyCurrency: targetStrategy.currency,
                            startingCapital: sessionObj.startingCapital,
                            riskMode: targetStrategy.riskMode,
                            riskPerTrade: sessionObj.riskPerTrade,
                            rrTarget: sessionObj.rrTarget,
                            sourceTradeId: trade.id,
                            sourceTradeTicket: trade.ticket,
                            pairs: sessionObj.pairs,
                            fromDate: sessionObj.fromDate,
                            toDate: sessionObj.toDate,
                            timeframe: sessionObj.timeframe,
                            secondaryTimeframe: sessionObj.secondaryTimeframe,
                            replayTimestamp: sessionObj.replayTimestamp,
                            orders: sessionObj.orders,
                        },
                        results: {
                            initialBalance: sessionObj.startingCapital,
                            finalBalance: sessionObj.currentBalance,
                            currentBalance: sessionObj.currentBalance,
                            netPnl: sessionObj.netPnl,
                            simulatedNetProfit: sessionObj.netPnl,
                            closedTradesCount: sessionObj.closedTradesCount,
                            simulatedTrades: sessionObj.closedTradesCount,
                            winRate: sessionObj.winRate,
                            simulatedWinRate: sessionObj.winRate,
                            profitFactor: sessionObj.profitFactor,
                            simulatedProfitFactor: sessionObj.profitFactor,
                            expectancy: sessionObj.expectancy,
                            avgR: sessionObj.avgR,
                            maxDrawdown: sessionObj.maxDrawdown,
                            maxDrawdownPct: sessionObj.maxDrawdownPct,
                        },
                        notes: sessionObj.journalNotes,
                    },
                    {
                        params: { accountId: targetAccountId },
                    }
                )
                .catch(() => {});

            // 4. Optional: keep trade.setup synchronized with chosen strategy name
            if (syncTradeSetupField && trade.id) {
                void api
                    .patch(`/dashboard/trades/${trade.id}`, { setup: targetStrategy.name })
                    .catch(() => {});
            }

            // 5. Ensure historical OHLCV batches around the trade window are cached before opening terminal
            if (openReplayAfterSave && !hasCachedMarketData) {
                await prefetchSessionViaSharedDemoAccount({
                    sessionId: sessionObj.id,
                    symbols: [normSymbol],
                    timeframe: sessionObj.timeframe,
                    fromDate: sessionObj.fromDate,
                    toDate: sessionObj.toDate,
                }).catch(() => {});
            }

            onSavedToBacktest({
                session: sessionObj,
                strategy: targetStrategy,
                openedReplay: openReplayAfterSave,
            });
        } catch (e: any) {
            setError(
                e?.message ||
                    (isEn
                        ? 'Unable to save session to Backtesting.'
                        : 'Não foi possível salvar a sessão no Backtest.')
            );
        } finally {
            setSavingAction(null);
        }
    };

    if (!isOpen) return null;

    const effectiveStrategyLabel =
        strategyMode === 'create'
            ? newStratName.trim() || (isEn ? 'New strategy' : 'Nova estratégia')
            : activeExistingStrategy?.name || (isEn ? 'Selected strategy' : 'Estratégia selecionada');

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/75 backdrop-blur-sm transition-opacity"
                onClick={() => !savingAction && onClose()}
            />

            {/* Hidden File Input for Strategy JSON Import */}
            <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleImportStrategyFile}
                className="hidden"
            />

            {/* Modal Dialog */}
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="replay-setup-modal-title"
                className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl animate-in fade-in zoom-in-95 duration-150"
            >
                {/* Header */}
                <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
                    <div className="min-w-0">
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-500">
                            <Play size={11} fill="currentColor" />
                            Replay & Backtest · {normSymbol} #{ticketLabel}
                        </span>
                        <h2 id="replay-setup-modal-title" className="mt-0.5 text-lg font-bold text-fg">
                            {isEn
                                ? 'Link Trade to Backtesting Strategy & Session'
                                : 'Associar Trade a Estratégia e Sessão de Backtest'}
                        </h2>
                        <p className="mt-0.5 text-xs text-fg-muted">
                            {isEn
                                ? 'Load or import an existing playbook, spin up a new one, and bind this execution to a replay session.'
                                : 'Carregue ou importe uma estratégia existente, crie uma nova de forma rápida e associe a sessão para salvar no Backtest.'}
                        </p>
                    </div>
                    <button
                        type="button"
                        disabled={Boolean(savingAction)}
                        onClick={onClose}
                        aria-label={isEn ? 'Close modal' : 'Fechar modal'}
                        className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Scrollable Body */}
                <div className="space-y-5 overflow-y-auto px-6 py-5">
                    {/* Trade Snapshot Strip */}
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-2/50 px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2.5">
                            <span className="text-sm font-bold text-fg">{normSymbol}</span>
                            <span
                                className={cn(
                                    'rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase',
                                    isBuy
                                        ? 'border-blue-500/25 bg-blue-500/10 text-blue-400'
                                        : 'border-rose-500/25 bg-rose-500/10 text-danger-fg'
                                )}
                            >
                                {isBuy ? 'BUY' : 'SELL'} · {Number(trade.volume || 0).toFixed(2)} {isEn ? 'lots' : 'lotes'}
                            </span>
                            <span className="font-mono text-xs text-fg-muted">
                                {Number(trade.openPrice)} → {Number(trade.closePrice)}
                            </span>
                        </div>

                        <div
                            className={cn(
                                'inline-flex items-center gap-1.5 font-mono text-sm font-bold',
                                netProfit >= 0 ? 'text-emerald-500' : 'text-danger-fg'
                            )}
                        >
                            {netProfit >= 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
                            {netProfit >= 0 ? '+' : ''}
                            {netProfit.toFixed(2)}
                        </div>
                    </div>

                    {statusToast && (
                        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs font-semibold text-emerald-500">
                            <Check size={14} className="shrink-0" />
                            <span>{statusToast}</span>
                        </div>
                    )}

                    {/* 1. Strategy Selection, Import/Load, or Fast Creation */}
                    <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-fg">
                                <Layers size={14} className="text-emerald-500" />
                                {isEn ? '1. Backtesting Strategy' : '1. Estratégia de Backtest'}
                            </span>

                            <div className="flex flex-wrap items-center gap-1.5">
                                <button
                                    type="button"
                                    disabled={isLoadingStrategies}
                                    onClick={() => void loadAndSyncExistingStrategies(true)}
                                    title={
                                        isEn
                                            ? 'Reload and sync strategies and sessions saved on the server'
                                            : 'Recarregar e sincronizar estratégias e sessões salvas no servidor'
                                    }
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[11px] font-bold text-fg-muted transition-colors hover:text-fg disabled:opacity-50 cursor-pointer"
                                >
                                    <RefreshCw size={12} className={isLoadingStrategies ? 'animate-spin text-emerald-500' : ''} />
                                    <span>{isEn ? 'Load saved' : 'Carregar existentes'}</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    title={isEn ? 'Import strategies JSON file' : 'Importar ficheiro JSON de estratégias'}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[11px] font-bold text-fg-muted transition-colors hover:text-fg cursor-pointer"
                                >
                                    <Upload size={12} />
                                    <span>{isEn ? 'Import JSON' : 'Importar JSON'}</span>
                                </button>

                                <div className="inline-flex rounded-xl border border-line bg-surface-2 p-0.5">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setError(null);
                                            setStrategyMode('existing');
                                        }}
                                        disabled={strategies.length === 0}
                                        className={cn(
                                            'flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all cursor-pointer',
                                            strategyMode === 'existing'
                                                ? 'bg-surface text-fg shadow-sm'
                                                : 'text-fg-muted hover:text-fg disabled:opacity-40'
                                        )}
                                    >
                                        {isEn ? 'Saved' : 'Existentes'} ({strategies.length})
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setError(null);
                                            setStrategyMode('create');
                                        }}
                                        className={cn(
                                            'flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all cursor-pointer',
                                            strategyMode === 'create'
                                                ? 'bg-emerald-500 text-slate-950 shadow-sm'
                                                : 'text-emerald-500 hover:bg-emerald-500/10'
                                        )}
                                    >
                                        <Plus size={12} />
                                        {isEn ? 'Quick create' : 'Nova rápida'}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* One-click import of setups discovered in the user's real trades */}
                        {unimportedAccountSetups.length > 0 && (
                            <div className="rounded-xl border border-line bg-surface-2/40 px-3.5 py-2.5 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-fg-muted">
                                        <Download size={12} className="text-emerald-500" />
                                        {isEn
                                            ? 'Import setup already used in account trades:'
                                            : 'Importar setup já usado nos trades da conta:'}
                                    </span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {unimportedAccountSetups.slice(0, 6).map((item) => (
                                        <button
                                            key={item.setup}
                                            type="button"
                                            onClick={() => handleImportAccountSetup(item.setup)}
                                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-500 hover:bg-emerald-500/20 transition-colors cursor-pointer"
                                        >
                                            <Plus size={11} />
                                            <span>{item.setup}</span>
                                            <span className="opacity-70">({item.count})</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {strategyMode === 'existing' && activeExistingStrategy ? (
                            <div className="space-y-2.5 rounded-xl border border-line bg-surface-2/30 p-3.5">
                                {strategies.length >= 3 && (
                                    <div className="relative">
                                        <Search
                                            size={14}
                                            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
                                        />
                                        <input
                                            type="search"
                                            value={strategySearch}
                                            onChange={(e) => setStrategySearch(e.target.value)}
                                            placeholder={
                                                isEn
                                                    ? 'Filter saved strategies by name, method, or symbol...'
                                                    : 'Filtrar estratégias existentes por nome, método ou ativo...'
                                            }
                                            className={cn(inputCls, 'py-1.5 pl-8 text-xs')}
                                        />
                                    </div>
                                )}

                                <div className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto pr-1">
                                    {filteredStrategies.length === 0 ? (
                                        <p className="py-4 text-center text-xs text-fg-muted">
                                            {isEn ? 'No strategies match your search.' : 'Nenhuma estratégia corresponde à pesquisa.'}
                                        </p>
                                    ) : (
                                        filteredStrategies.map((st) => {
                                            const active = st.id === activeExistingStrategy.id;
                                            const stratSessionsCount = sessions.filter(
                                                (s) => s.strategyId === st.id
                                            ).length;
                                            return (
                                                <button
                                                    key={st.id}
                                                    type="button"
                                                    onClick={() => {
                                                        setSelectedStrategyId(st.id);
                                                        if (st.defaultTimeframe) setTimeframe(st.defaultTimeframe);
                                                        const firstSess = sessions.find((s) => s.strategyId === st.id);
                                                        if (firstSess) setSelectedExistingSessionId(firstSess.id);
                                                    }}
                                                    className={cn(
                                                        'flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-all cursor-pointer',
                                                        active
                                                            ? 'border-emerald-500 bg-emerald-500/10 shadow-xs'
                                                            : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2/60'
                                                    )}
                                                >
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <span className="truncate text-sm font-bold text-fg">
                                                                {st.name}
                                                            </span>
                                                            {active && (
                                                                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-black text-slate-950">
                                                                    <Check size={10} /> {isEn ? 'Selected' : 'Selecionada'}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="mt-0.5 truncate text-[11px] text-fg-muted">
                                                            {st.tradingMethod || 'Smart Money / ICT'} ·{' '}
                                                            {st.riskMode === 'COMPOUNDING'
                                                                ? 'Compounding'
                                                                : 'Fixed Risk'}{' '}
                                                            · {st.riskPerTrade}% · {stratSessionsCount}{' '}
                                                            {isEn
                                                                ? stratSessionsCount === 1
                                                                    ? 'session'
                                                                    : 'sessions'
                                                                : stratSessionsCount === 1
                                                                  ? 'sessão'
                                                                  : 'sessões'}
                                                        </p>
                                                    </div>
                                                    <div className="shrink-0 text-right">
                                                        <span className="rounded-md bg-surface-2 px-2 py-1 font-mono text-xs font-bold text-fg">
                                                            {st.currency || 'USD'}{' '}
                                                            {(st.startingCapital || 100000).toLocaleString('en-US')}
                                                        </span>
                                                    </div>
                                                </button>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-500">
                                        <Sparkles size={13} /> {isEn ? 'Quick strategy setup' : 'Criação rápida de estratégia'}
                                    </span>
                                    <span className="text-[11px] text-fg-muted">
                                        {isEn ? 'Primary symbol:' : 'Ativo principal:'}{' '}
                                        <strong className="text-fg">{normSymbol}</strong>
                                    </span>
                                </div>

                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <Field label={isEn ? 'New strategy name *' : 'Nome da nova estratégia *'} htmlFor="qr-strat-name">
                                        <input
                                            id="qr-strat-name"
                                            type="text"
                                            value={newStratName}
                                            onChange={(e) => setNewStratName(e.target.value)}
                                            placeholder={isEn ? `e.g. NY Breakout — ${normSymbol}` : `Ex.: Breakout NY — ${normSymbol}`}
                                            className={inputCls}
                                            autoFocus
                                        />
                                    </Field>

                                    <Field label={isEn ? 'Trading methodology' : 'Método operacional'} htmlFor="qr-strat-method">
                                        <select
                                            id="qr-strat-method"
                                            value={newStratMethod}
                                            onChange={(e) => setNewStratMethod(e.target.value)}
                                            className={inputCls}
                                        >
                                            {TRADING_METHODS.map((m) => (
                                                <option key={m.value} value={m.value}>
                                                    {isEn ? m.en : m.value}
                                                </option>
                                            ))}
                                        </select>
                                    </Field>
                                </div>

                                {/* Capital + Currency */}
                                <div className="space-y-2">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <label className="text-xs font-semibold text-fg">
                                            {isEn ? 'Starting strategy capital' : 'Capital inicial da estratégia'}
                                        </label>
                                        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
                                            {CURRENCIES.map((curr) => (
                                                <button
                                                    key={curr}
                                                    type="button"
                                                    onClick={() => setNewStratCurrency(curr)}
                                                    className={cn(
                                                        'rounded-md px-2 py-0.5 text-[11px] font-bold transition-colors',
                                                        newStratCurrency === curr
                                                            ? 'bg-emerald-500 text-slate-950'
                                                            : 'text-fg-muted hover:text-fg'
                                                    )}
                                                >
                                                    {curr}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                                        {CAPITAL_PRESETS.map((preset) => (
                                            <button
                                                key={preset}
                                                type="button"
                                                onClick={() => setNewStratCapital(preset)}
                                                className={cn(
                                                    'rounded-lg border py-1.5 text-xs font-bold transition-all',
                                                    newStratCapital === preset
                                                        ? 'border-emerald-500 bg-emerald-500/15 text-emerald-500'
                                                        : 'border-line bg-surface text-fg-muted hover:text-fg'
                                                )}
                                            >
                                                {preset.toLocaleString('en-US')}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Risk Mode + Risk % + R:R */}
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                    <Field label={isEn ? 'Risk model' : 'Modelo de risco'}>
                                        <div className="grid grid-cols-2 gap-1.5">
                                            <button
                                                type="button"
                                                onClick={() => setNewStratRiskMode('FIXED_RISK')}
                                                className={cn(
                                                    'rounded-lg border py-2 text-[11px] font-bold transition-colors',
                                                    newStratRiskMode === 'FIXED_RISK'
                                                        ? 'border-emerald-500 bg-emerald-500/15 text-emerald-500'
                                                        : 'border-line bg-surface text-fg-muted hover:text-fg'
                                                )}
                                            >
                                                Fixed Risk
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setNewStratRiskMode('COMPOUNDING')}
                                                className={cn(
                                                    'rounded-lg border py-2 text-[11px] font-bold transition-colors',
                                                    newStratRiskMode === 'COMPOUNDING'
                                                        ? 'border-emerald-500 bg-emerald-500/15 text-emerald-500'
                                                        : 'border-line bg-surface text-fg-muted hover:text-fg'
                                                )}
                                            >
                                                Compounding
                                            </button>
                                        </div>
                                    </Field>

                                    <Field label={isEn ? 'Risk per trade (%)' : 'Risco por trade (%)'} htmlFor="qr-risk-pct">
                                        <input
                                            id="qr-risk-pct"
                                            type="number"
                                            min={0.1}
                                            max={10}
                                            step={0.25}
                                            value={newStratRiskPct}
                                            onChange={(e) => setNewStratRiskPct(Number(e.target.value) || 1)}
                                            className={inputCls}
                                        />
                                    </Field>

                                    <Field label={isEn ? 'Default R:R target' : 'Alvo R:R padrão'} htmlFor="qr-rr">
                                        <input
                                            id="qr-rr"
                                            type="number"
                                            min={0.5}
                                            max={20}
                                            step={0.5}
                                            value={newStratRr}
                                            onChange={(e) => setNewStratRr(Number(e.target.value) || 2)}
                                            className={inputCls}
                                        />
                                    </Field>
                                </div>

                                <div className="flex items-center justify-between gap-2 pt-1">
                                    <span className="text-[11px] text-fg-muted">
                                        {isEn
                                            ? 'Create now to select or save directly via the footer.'
                                            : 'Pode criar já para selecionar ou salvar diretamente no rodapé.'}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={handleQuickCreateInline}
                                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-surface px-3 py-1.5 text-xs font-bold text-emerald-500 transition-colors hover:bg-emerald-500/10 cursor-pointer"
                                    >
                                        <FolderPlus size={13} />
                                        {isEn ? 'Create & select' : 'Criar e selecionar'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 2. Session Association: Create New Session in Strategy OR Associate to Existing Session */}
                    <div className="space-y-3 border-t border-line pt-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-fg">
                                    <Link2 size={14} className="text-emerald-500" />
                                    {isEn
                                        ? `2. Bind Session to "${effectiveStrategyLabel}"`
                                        : `2. Associar Sessão a "${effectiveStrategyLabel}"`}
                                </span>
                            </div>

                            <div className="inline-flex rounded-xl border border-line bg-surface-2 p-0.5">
                                <button
                                    type="button"
                                    onClick={() => setSessionMode('new')}
                                    className={cn(
                                        'flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all cursor-pointer',
                                        sessionMode === 'new'
                                            ? 'bg-surface text-fg shadow-sm'
                                            : 'text-fg-muted hover:text-fg'
                                    )}
                                >
                                    <Plus size={12} />
                                    {isEn ? 'New session' : 'Nova sessão'}
                                </button>
                                <button
                                    type="button"
                                    disabled={orderedExistingSessions.length === 0}
                                    onClick={() => {
                                        setSessionMode('existing');
                                        if (!selectedExistingSessionId && orderedExistingSessions[0]) {
                                            setSelectedExistingSessionId(orderedExistingSessions[0].id);
                                        }
                                    }}
                                    className={cn(
                                        'flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all cursor-pointer',
                                        sessionMode === 'existing'
                                            ? 'bg-emerald-500 text-slate-950 shadow-sm'
                                            : 'text-fg-muted hover:text-fg disabled:opacity-40'
                                    )}
                                >
                                    <FolderKanban size={12} />
                                    {isEn ? 'Existing session' : 'Sessão existente'} ({orderedExistingSessions.length})
                                </button>
                            </div>
                        </div>

                        {sessionMode === 'existing' && orderedExistingSessions.length > 0 ? (
                            <div className="space-y-2.5 rounded-xl border border-line bg-surface-2/30 p-3.5">
                                <p className="text-[11px] text-fg-muted">
                                    {isEn ? (
                                        <>
                                            Select the existing session to bind this trade and the strategy{' '}
                                            <strong className="text-fg">{effectiveStrategyLabel}</strong>:
                                        </>
                                    ) : (
                                        <>
                                            Selecione a sessão existente à qual deseja associar este trade e a estratégia{' '}
                                            <strong className="text-fg">{effectiveStrategyLabel}</strong>:
                                        </>
                                    )}
                                </p>
                                <div className="grid max-h-44 grid-cols-1 gap-2 overflow-y-auto pr-1">
                                    {orderedExistingSessions.map((sess) => {
                                        const active = selectedExistingSession?.id === sess.id;
                                        const belongsToSelectedStrat =
                                            strategyMode === 'existing' &&
                                            activeExistingStrategy &&
                                            sess.strategyId === activeExistingStrategy.id;
                                        return (
                                            <button
                                                key={sess.id}
                                                type="button"
                                                onClick={() => setSelectedExistingSessionId(sess.id)}
                                                className={cn(
                                                    'flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-all cursor-pointer',
                                                    active
                                                        ? 'border-emerald-500 bg-emerald-500/10 shadow-xs'
                                                        : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2/60'
                                                )}
                                            >
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="truncate text-sm font-bold text-fg">
                                                            {sess.name}
                                                        </span>
                                                        {belongsToSelectedStrat ? (
                                                            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-500">
                                                                {isEn ? 'From this strategy' : 'Desta estratégia'}
                                                            </span>
                                                        ) : (
                                                            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-fg-muted">
                                                                {sess.strategyName}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="mt-0.5 truncate text-[11px] text-fg-muted">
                                                        {sess.pairs.join(', ')} · {sess.timeframe} ·{' '}
                                                        {fmtIsoDate(sess.fromDate)} → {fmtIsoDate(sess.toDate)}
                                                    </p>
                                                </div>
                                                <div className="shrink-0 text-right">
                                                    <span
                                                        className={cn(
                                                            'block font-mono text-xs font-bold',
                                                            sess.closedTradesCount > 0
                                                                ? pnlTone(sess.netPnl)
                                                                : 'text-fg-muted'
                                                        )}
                                                    >
                                                        {sess.closedTradesCount > 0
                                                            ? fmtMoney(sess.netPnl, { sign: true })
                                                            : isEn
                                                              ? 'No trades'
                                                              : 'Sem trades'}
                                                    </span>
                                                    <span className="text-[10px] text-fg-subtle">
                                                        {sess.closedTradesCount}{' '}
                                                        {sess.closedTradesCount === 1 ? 'trade' : 'trades'}
                                                    </span>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <Field label={isEn ? 'New session name' : 'Nome da nova sessão'} htmlFor="qr-session-name">
                                        <input
                                            id="qr-session-name"
                                            type="text"
                                            value={sessionName}
                                            onChange={(e) => setSessionName(e.target.value)}
                                            placeholder={`Replay Trade #${ticketLabel} · ${normSymbol}`}
                                            className={inputCls}
                                        />
                                    </Field>

                                    <Field label={isEn ? 'Initial timeframe' : 'Timeframe inicial'}>
                                        <div className="flex flex-wrap gap-1.5">
                                            {TIMEFRAMES.map((tf) => (
                                                <button
                                                    key={tf}
                                                    type="button"
                                                    onClick={() => setTimeframe(tf)}
                                                    className={cn(
                                                        'flex-1 rounded-lg border px-2.5 py-2 text-xs font-bold transition-colors cursor-pointer',
                                                        timeframe === tf
                                                            ? 'border-emerald-500 bg-emerald-500 text-slate-950'
                                                            : 'border-line bg-surface-2 text-fg-muted hover:text-fg'
                                                    )}
                                                >
                                                    {tf}
                                                </button>
                                            ))}
                                        </div>
                                    </Field>
                                </div>

                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <Field label={isEn ? 'History start' : 'Início do histórico'} htmlFor="qr-from">
                                        <input
                                            id="qr-from"
                                            type="date"
                                            value={fromDate}
                                            onChange={(e) => setFromDate(e.target.value)}
                                            className={inputCls}
                                        />
                                    </Field>
                                    <Field label={isEn ? 'History end' : 'Fim do histórico'} htmlFor="qr-to">
                                        <input
                                            id="qr-to"
                                            type="date"
                                            value={toDate}
                                            onChange={(e) => setToDate(e.target.value)}
                                            className={inputCls}
                                        />
                                    </Field>
                                </div>
                            </>
                        )}

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <Toggle
                                checked={includeExecutedOrder}
                                onChange={setIncludeExecutedOrder}
                                label={isEn ? 'Save trade execution into session' : 'Salvar execução do trade na sessão'}
                                description={
                                    isEn
                                        ? 'Logs this trade entry, exit, and P&L into Backtesting analytics.'
                                        : 'Regista a entrada, saída e P&L deste trade nas métricas do Backtest.'
                                }
                            />
                            <Toggle
                                checked={syncTradeSetupField}
                                onChange={setSyncTradeSetupField}
                                label={isEn ? 'Link strategy to trade Setup field' : 'Vincular estratégia ao Setup do trade'}
                                description={
                                    isEn
                                        ? 'Updates this trade Setup tag with the selected strategy name.'
                                        : 'Atualiza o campo Setup deste trade com o nome da estratégia.'
                                }
                            />
                        </div>

                        <Field label={isEn ? 'Notes / Lessons for Backtesting (optional)' : 'Notas / Lições para o Backtest (opcional)'} htmlFor="qr-notes">
                            <textarea
                                id="qr-notes"
                                rows={2}
                                value={journalNotes}
                                onChange={(e) => setJournalNotes(e.target.value)}
                                placeholder={
                                    isEn
                                        ? 'Market context, entry trigger, or key takeaway from this execution...'
                                        : 'Contexto técnico, gatilho de entrada ou lições desta operação...'
                                }
                                className={cn(inputCls, 'resize-none')}
                            />
                        </Field>
                    </div>

                    {error && (
                        <div
                            role="alert"
                            className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs font-semibold text-danger-fg"
                        >
                            {error}
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="flex flex-col-reverse gap-2.5 border-t border-line bg-surface-2/30 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <button
                        type="button"
                        disabled={Boolean(savingAction)}
                        onClick={onClose}
                        className="rounded-xl border border-line bg-surface px-4 py-2.5 text-xs font-bold text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50 cursor-pointer"
                    >
                        {isEn ? 'Cancel' : 'Cancelar'}
                    </button>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <button
                            type="button"
                            disabled={Boolean(savingAction)}
                            onClick={() => void handlePersistSession(false)}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-xs font-bold text-fg transition-colors hover:bg-surface-2 disabled:opacity-50 cursor-pointer"
                        >
                            <Save size={14} className="text-emerald-500" />
                            <span>
                                {savingAction === 'save'
                                    ? isEn
                                        ? 'Saving to Backtesting...'
                                        : 'Salvando no Backtest...'
                                    : sessionMode === 'existing'
                                      ? isEn
                                          ? 'Link & Save to Backtesting'
                                          : 'Associar e Salvar no Backtest'
                                      : isEn
                                        ? 'Save to Backtesting'
                                        : 'Salvar no Backtest'}
                            </span>
                        </button>

                        <button
                            type="button"
                            disabled={Boolean(savingAction)}
                            onClick={() => void handlePersistSession(true)}
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-black text-slate-950 shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-400 disabled:opacity-50 cursor-pointer"
                        >
                            <Play size={14} fill="currentColor" />
                            <span>
                                {savingAction === 'replay'
                                    ? isEn
                                        ? 'Preparing Replay...'
                                        : 'Preparando Replay...'
                                    : sessionMode === 'existing'
                                      ? isEn
                                          ? 'Link Session & Launch Replay'
                                          : 'Associar Sessão & Iniciar Replay'
                                      : strategyMode === 'create'
                                        ? isEn
                                            ? 'Create Strategy & Launch Replay'
                                            : 'Criar Estratégia & Iniciar Replay'
                                        : isEn
                                          ? 'Save & Launch Replay'
                                          : 'Salvar e Iniciar Replay'}
                            </span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
