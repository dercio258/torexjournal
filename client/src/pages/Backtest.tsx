import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    FlaskConical,
    Play,
    Save,
    History,
    Activity,
    RefreshCw,
    CheckCircle2,
    Sliders,
    BarChart2,
    Sparkles,
    Plus,
    Trash2,
    Layers,
    LayoutGrid,
    Calendar,
    ArrowUpRight,
    ArrowUp,
    ArrowDown,
    X,
    Search,
    ShieldCheck,
    Clock,
    Target,
    ChevronDown,
    ChevronUp,
    Check,
    FolderKanban,
} from 'lucide-react';
import { useAccount } from '../context/AccountContext';
import { Button } from '../components/ui/Button';
import api from '../api';
import {
    ALL_BACKTEST_SYMBOLS,
    BacktestReplaySession,
    BacktestStrategy,
    createBacktestSession,
    createBacktestStrategy,
    deleteBacktestSession,
    loadBacktestSessions,
    loadBacktestStrategies,
    updateBacktestSession,
    updateBacktestStrategy,
} from '../services/backtestWorkspaceStore';

type HubLayerTab = 'dashboard' | 'sessions' | 'strategies' | 'new_session' | 'what_if';

export const Backtest: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { selectedAccountId, selectedAccount } = useAccount();

    const initialTab = (searchParams.get('tab') as HubLayerTab) || 'sessions';
    const [activeTab, setActiveTab] = useState<HubLayerTab>(
        ['dashboard', 'sessions', 'strategies', 'new_session', 'what_if'].includes(initialTab)
            ? initialTab
            : 'sessions'
    );

    const changeTab = (tab: HubLayerTab) => {
        setActiveTab(tab);
        setSearchParams({ tab });
    };

    // Workspace Store State (Strategies & Replay Sessions)
    const [strategies, setStrategies] = useState<BacktestStrategy[]>(() => loadBacktestStrategies());
    const [sessions, setSessions] = useState<BacktestReplaySession[]>(() => loadBacktestSessions());
    const [selectedStrategyFilter, setSelectedStrategyFilter] = useState<string>('ALL');
    const [activeStrategyId, setActiveStrategyId] = useState<string>(() => strategies[0]?.id || '');
    const [dashboardPeriodFilter, setDashboardPeriodFilter] = useState<'ALL' | '7D' | '30D' | '90D' | '1Y'>('ALL');
    const [gettingStartedOpen, setGettingStartedOpen] = useState<boolean>(true);
    const [strategyDetailsExpanded, setStrategyDetailsExpanded] = useState<boolean>(false);

    // New Strategy Modal State
    const [newStrategyModalOpen, setNewStrategyModalOpen] = useState<boolean>(false);
    const [newStratName, setNewStratName] = useState<string>('');
    const [newStratDesc, setNewStratDesc] = useState<string>('');
    const [newStratSessionTag, setNewStratSessionTag] = useState<string>('London & NY');
    const [newStratCapital, setNewStratCapital] = useState<number>(100000);
    const [newStratRisk, setNewStratRisk] = useState<number>(1.0);
    const [newStratRr, setNewStratRr] = useState<number>(2.0);
    const [newStratPrimarySymbol, setNewStratPrimarySymbol] = useState<string>('XAUUSD');
    const [newRuleText, setNewRuleText] = useState<string>('');

    // New Session Form State (Layer 4 — Image 5)
    const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
    const defaultFromStr = useMemo(() => new Date(Date.now() - 86400000 * 15).toISOString().slice(0, 10), []);
    const [sessionName, setSessionName] = useState<string>('');
    const [sessionStrategyId, setSessionStrategyId] = useState<string>(() => strategies[0]?.id || '');
    const [pairSearch, setPairSearch] = useState<string>('');
    const [selectedPairs, setSelectedPairs] = useState<string[]>(['XAUUSD']);
    const [sessionTimeframe, setSessionTimeframe] = useState<string>('15m');
    const [fromDate, setFromDate] = useState<string>(defaultFromStr);
    const [toDate, setToDate] = useState<string>(todayStr);
    const [keepEndFollowingToday, setKeepEndFollowingToday] = useState<boolean>(false);
    const [randomStartDate, setRandomStartDate] = useState<boolean>(false);
    const [sessionRiskPct, setSessionRiskPct] = useState<number>(1.0);
    const [fundedEnabled, setFundedEnabled] = useState<boolean>(false);
    const [fundedProfitTarget, setFundedProfitTarget] = useState<number>(10);
    const [fundedMaxDailyLoss, setFundedMaxDailyLoss] = useState<number>(5);
    const [fundedMaxTotalLoss, setFundedMaxTotalLoss] = useState<number>(10);

    // Reload sessions & strategies whenever returning to this page
    useEffect(() => {
        setStrategies(loadBacktestStrategies());
        setSessions(loadBacktestSessions());
    }, [activeTab]);

    const activeStrategy = useMemo(
        () => strategies.find((s) => s.id === activeStrategyId) || strategies[0],
        [strategies, activeStrategyId]
    );

    const sessionCreationStrategy = useMemo(
        () => strategies.find((s) => s.id === sessionStrategyId) || strategies[0],
        [strategies, sessionStrategyId]
    );

    useEffect(() => {
        if (sessionCreationStrategy) {
            setSessionRiskPct(sessionCreationStrategy.riskPerTrade);
            if (selectedPairs.length === 0 && sessionCreationStrategy.symbols.length > 0) {
                setSelectedPairs(sessionCreationStrategy.symbols);
            }
        }
    }, [sessionCreationStrategy]);

    // Filtered sessions for Sessions Tab & Dashboard Tab
    const filteredSessions = useMemo(() => {
        let list = sessions;
        if (selectedStrategyFilter !== 'ALL') {
            list = list.filter((s) => s.strategyId === selectedStrategyFilter);
        }
        if (dashboardPeriodFilter !== 'ALL') {
            const daysMap = { '7D': 7, '30D': 30, '90D': 90, '1Y': 365 };
            const cutoff = Date.now() - daysMap[dashboardPeriodFilter] * 86400000;
            list = list.filter((s) => new Date(s.createdAt).getTime() >= cutoff);
        }
        return list;
    }, [sessions, selectedStrategyFilter, dashboardPeriodFilter]);

    // Aggregated Dashboard Metrics
    const dashboardStats = useMemo(() => {
        const targetStrat =
            selectedStrategyFilter !== 'ALL'
                ? strategies.find((s) => s.id === selectedStrategyFilter)
                : strategies[0];
        const baseCapital = targetStrat?.startingCapital || 100000;
        const totalNetPnl = filteredSessions.reduce((acc, s) => acc + (s.netPnl || 0), 0);
        const currentTotalBalance = baseCapital + totalNetPnl;
        const totalClosedTrades = filteredSessions.reduce((acc, s) => acc + (s.closedTradesCount || 0), 0);
        const totalWins = filteredSessions.reduce((acc, s) => acc + (s.winsCount || 0), 0);
        const totalLosses = filteredSessions.reduce((acc, s) => acc + (s.lossesCount || 0), 0);
        const winRate = totalClosedTrades > 0 ? Number(((totalWins / totalClosedTrades) * 100).toFixed(1)) : 0;

        const allClosedOrders = filteredSessions.flatMap((s) =>
            (s.orders || []).filter((o) => o.status === 'WIN' || o.status === 'LOSS')
        );
        const winOrders = allClosedOrders.filter((o) => o.pnl > 0);
        const lossOrders = allClosedOrders.filter((o) => o.pnl < 0);
        const grossWin = winOrders.reduce((a, o) => a + o.pnl, 0);
        const grossLoss = Math.abs(lossOrders.reduce((a, o) => a + o.pnl, 0));
        const profitFactor = grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? 9.99 : 0;
        const avgWin = winOrders.length > 0 ? Number((grossWin / winOrders.length).toFixed(2)) : 0;
        const avgLoss = lossOrders.length > 0 ? Number((grossLoss / lossOrders.length).toFixed(2)) : 0;
        const expectancy = totalClosedTrades > 0 ? Number((totalNetPnl / totalClosedTrades).toFixed(2)) : 0;
        const avgR =
            allClosedOrders.length > 0
                ? Number(
                      (
                          allClosedOrders.reduce((a, o) => a + (o.rMultiple || 0), 0) /
                          allClosedOrders.length
                      ).toFixed(2)
                  )
                : 0;
        const maxDrawdown = filteredSessions.reduce((max, s) => Math.max(max, s.maxDrawdown || 0), 0);
        const maxDrawdownPct = filteredSessions.reduce((max, s) => Math.max(max, s.maxDrawdownPct || 0), 0);
        const bestSessionPnl = filteredSessions.reduce((best, s) => Math.max(best, s.netPnl || 0), 0);
        const totalSeconds = filteredSessions.reduce((acc, s) => acc + (s.timeInvestedSeconds || 0), 0);
        const totalMinutes = Math.max(1, Math.round(totalSeconds / 60));

        const uniqueDays = new Set(
            filteredSessions.map((s) => new Date(s.updatedAt || s.createdAt).toISOString().slice(0, 10))
        ).size;

        return {
            baseCapital,
            currentTotalBalance,
            totalNetPnl,
            totalClosedTrades,
            totalWins,
            totalLosses,
            winRate,
            profitFactor,
            avgWin,
            avgLoss,
            expectancy,
            avgR,
            maxDrawdown,
            maxDrawdownPct,
            bestSessionPnl,
            totalMinutes,
            uniqueDays: Math.max(1, uniqueDays),
            allClosedOrders,
        };
    }, [filteredSessions, selectedStrategyFilter, strategies]);

    // Handlers for Strategy Creation & Management
    const handleCreateStrategy = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newStratName.trim()) return;
        const created = createBacktestStrategy({
            name: newStratName.trim(),
            description: newStratDesc.trim() || 'Estratégia institucional de backtest',
            sessionTag: newStratSessionTag,
            startingCapital: newStratCapital,
            riskPerTrade: newStratRisk,
            rrTarget: newStratRr,
            primarySymbol: newStratPrimarySymbol,
            symbols: [newStratPrimarySymbol, 'EURUSD', 'GBPUSD'],
        });
        const updated = loadBacktestStrategies();
        setStrategies(updated);
        setActiveStrategyId(created.id);
        setSessionStrategyId(created.id);
        setNewStratName('');
        setNewStratDesc('');
        setNewStrategyModalOpen(false);
    };

    const handleAddRuleToStrategy = () => {
        if (!activeStrategy || !newRuleText.trim()) return;
        const nextRules = [
            ...(activeStrategy.rules || []),
            { id: `rule_${Date.now()}`, text: newRuleText.trim(), required: true },
        ];
        const next = updateBacktestStrategy(activeStrategy.id, { rules: nextRules });
        setStrategies(next);
        setNewRuleText('');
    };

    const handleRemoveRuleFromStrategy = (ruleId: string) => {
        if (!activeStrategy) return;
        const nextRules = (activeStrategy.rules || []).filter((r) => r.id !== ruleId);
        const next = updateBacktestStrategy(activeStrategy.id, { rules: nextRules });
        setStrategies(next);
    };

    // Handlers for New Session Creation (Image 5)
    const handleTogglePair = (ticker: string) => {
        setSelectedPairs((prev) => {
            if (prev.includes(ticker)) {
                if (prev.length === 1) return prev; // Keep at least 1 pair
                return prev.filter((p) => p !== ticker);
            }
            return [...prev, ticker];
        });
    };

    const handleMovePair = (index: number, direction: -1 | 1) => {
        setSelectedPairs((prev) => {
            const target = index + direction;
            if (target < 0 || target >= prev.length) return prev;
            const copy = [...prev];
            const temp = copy[index];
            copy[index] = copy[target];
            copy[target] = temp;
            return copy;
        });
    };

    const handleCreateAndOpenSession = (e: React.FormEvent) => {
        e.preventDefault();
        if (!sessionName.trim()) return;
        const created = createBacktestSession({
            name: sessionName.trim(),
            strategyId: sessionCreationStrategy?.id || strategies[0].id,
            pairs: selectedPairs,
            primarySymbol: selectedPairs[0] || 'XAUUSD',
            timeframe: sessionTimeframe,
            fromDate,
            toDate: keepEndFollowingToday ? todayStr : toDate,
            keepEndFollowingToday,
            randomStartDate,
            riskPerTrade: sessionRiskPct,
            fundedMode: {
                enabled: fundedEnabled,
                profitTargetPct: fundedProfitTarget,
                maxDailyLossPct: fundedMaxDailyLoss,
                maxTotalLossPct: fundedMaxTotalLoss,
            },
        });
        setSessions(loadBacktestSessions());
        navigate(`/backtesting/replay/${created.id}`);
    };

    const handleDeleteSession = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const next = deleteBacktestSession(id);
        setSessions(next);
    };

    const handleChangeSessionEndDate = (id: string, newEndDate: string) => {
        updateBacktestSession(id, { toDate: newEndDate });
        setSessions(loadBacktestSessions());
    };

    // What-If & Strategy Sim State (Preserved Layer 5)
    const [whatIfSubMode, setWhatIfSubMode] = useState<'what_if' | 'strategy_lab' | 'saved_history'>('what_if');
    const [running, setRunning] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [whatIfConfig, setWhatIfConfig] = useState({
        initialBalance: selectedAccount?.initialBalance || selectedAccount?.balance || 10000,
        riskPerTrade: 1.0,
        rrTarget: 2.0,
        excludeAsian: false,
        excludeFridays: false,
    });
    const [strategyConfig, setStrategyConfig] = useState({
        strategy: 'MACD Cross',
        symbol: 'EURUSD',
        initialBalance: selectedAccount?.initialBalance || selectedAccount?.balance || 10000,
        riskPerTrade: 1.5,
        rrTarget: 2.0,
        targetWinRate: 55,
        totalTrades: 40,
        fastMa: 12,
        slowMa: 26,
        rsiPeriod: 14,
    });
    const [simulationResult, setSimulationResult] = useState<any>(null);
    const [savedSessionsBackend, setSavedSessionsBackend] = useState<any[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);

    useEffect(() => {
        const bal = selectedAccount?.initialBalance || selectedAccount?.balance || 10000;
        setWhatIfConfig((prev) => ({ ...prev, initialBalance: bal }));
        setStrategyConfig((prev) => ({ ...prev, initialBalance: bal }));
    }, [selectedAccount]);

    const fetchSavedHistory = async () => {
        try {
            setLoadingHistory(true);
            const params: any = {};
            if (selectedAccountId && selectedAccountId !== 'all') {
                params.accountId = selectedAccountId;
            }
            const res = await api.get('/dashboard/backtest/history', { params });
            if (res.data) setSavedSessionsBackend(res.data);
        } catch (error) {
            console.error('Erro ao carregar histórico de backtest:', error);
        } finally {
            setLoadingHistory(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'what_if' && whatIfSubMode === 'saved_history') {
            fetchSavedHistory();
        }
    }, [activeTab, whatIfSubMode, selectedAccountId]);

    const handleRunWhatIf = async () => {
        try {
            setRunning(true);
            setSaveSuccess(false);
            const payload = {
                mode: 'ACCOUNT_HISTORY',
                accountId: selectedAccountId !== 'all' ? selectedAccountId : selectedAccount?.id,
                ...whatIfConfig,
            };
            const res = await api.post('/dashboard/backtest/simulate', payload, {
                params: { accountId: selectedAccountId !== 'all' ? selectedAccountId : undefined },
            });
            if (res.data) setSimulationResult(res.data);
        } catch (error) {
            console.error('Falha ao executar simulação what-if:', error);
        } finally {
            setRunning(false);
        }
    };

    const handleRunStrategyLab = async () => {
        try {
            setRunning(true);
            setSaveSuccess(false);
            const payload = {
                mode: 'STRATEGY_SIM',
                accountId: selectedAccountId !== 'all' ? selectedAccountId : selectedAccount?.id,
                ...strategyConfig,
            };
            const res = await api.post('/dashboard/backtest/simulate', payload, {
                params: { accountId: selectedAccountId !== 'all' ? selectedAccountId : undefined },
            });
            if (res.data) setSimulationResult(res.data);
        } catch (error) {
            console.error('Falha ao simular estratégia:', error);
        } finally {
            setRunning(false);
        }
    };

    const handleSaveWhatIfSession = async () => {
        if (!simulationResult) return;
        try {
            setSaving(true);
            const payload = {
                name:
                    whatIfSubMode === 'what_if'
                        ? `What-If R:R 1:${whatIfConfig.rrTarget} (${selectedAccount?.name || 'Conta'})`
                        : `${strategyConfig.strategy} ${strategyConfig.symbol} (${selectedAccount?.name || 'Conta'})`,
                mode: simulationResult.mode,
                strategy: whatIfSubMode === 'what_if' ? 'What-If Historical Optimization' : strategyConfig.strategy,
                symbol: whatIfSubMode === 'what_if' ? 'ALL' : strategyConfig.symbol,
                config: whatIfSubMode === 'what_if' ? whatIfConfig : strategyConfig,
                results: simulationResult.comparison,
                notes: simulationResult.insights?.join(' ') || '',
            };
            await api.post('/dashboard/backtest/save', payload, {
                params: { accountId: selectedAccountId !== 'all' ? selectedAccountId : undefined },
            });
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (error) {
            console.error('Erro ao salvar sessão de backtest:', error);
        } finally {
            setSaving(false);
        }
    };

    const comparison = simulationResult?.comparison;

    const matchingSymbolList = useMemo(() => {
        const q = pairSearch.trim().toUpperCase();
        if (!q) return ALL_BACKTEST_SYMBOLS;
        return ALL_BACKTEST_SYMBOLS.filter(
            (s) => s.ticker.includes(q) || s.name.toUpperCase().includes(q) || s.category.toUpperCase().includes(q)
        );
    }, [pairSearch]);

    const formatDateDisplay = (isoDate: string) => {
        if (!isoDate) return '—';
        const parts = isoDate.split('-');
        if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
        return isoDate;
    };

    return (
        <div className="space-y-6 w-full mx-auto pb-10">
            {/* TOP HEADER & MULTI-LAYER NAVIGATION BAR */}
            <div className="bg-surface/80 backdrop-blur-xl border border-line rounded-2xl p-5 shadow-sm">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-line">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-500">
                            <FlaskConical size={14} />
                            <span>Central de Backtesting & Replay</span>
                        </div>
                        <h1 className="text-2xl sm:text-3xl font-black text-fg tracking-tight">
                            Backtesting
                        </h1>
                        <p className="text-xs sm:text-sm text-fg-muted">
                            Gerencie suas estratégias, crie sessões históricas de replay vela a vela e acompanhe sua evolução estatística.
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5">
                        <button
                            type="button"
                            onClick={() => setNewStrategyModalOpen(true)}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-2 hover:bg-surface-3 border border-line-strong text-fg text-xs font-bold cursor-pointer transition-all"
                        >
                            <Layers size={15} className="text-emerald-500" />
                            <span>Nova Estratégia</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => changeTab('new_session')}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 text-xs font-black shadow-lg shadow-emerald-500/20 cursor-pointer transition-all"
                        >
                            <Plus size={16} />
                            <span>Nova Sessão de Replay</span>
                        </button>
                    </div>
                </div>

                {/* LAYER TABS */}
                <div className="flex flex-wrap items-center gap-1.5 pt-3">
                    <button
                        type="button"
                        onClick={() => changeTab('sessions')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                            activeTab === 'sessions'
                                ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 shadow-2xs'
                                : 'text-fg-muted hover:text-fg hover:bg-surface-2 border border-transparent'
                        }`}
                    >
                        <FolderKanban size={15} />
                        <span>Sessões</span>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-surface-3 text-fg font-mono">
                            {sessions.length}
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() => changeTab('strategies')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                            activeTab === 'strategies'
                                ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 shadow-2xs'
                                : 'text-fg-muted hover:text-fg hover:bg-surface-2 border border-transparent'
                        }`}
                    >
                        <Layers size={15} />
                        <span>Estratégias</span>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-surface-3 text-fg font-mono">
                            {strategies.length}
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() => changeTab('dashboard')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                            activeTab === 'dashboard'
                                ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 shadow-2xs'
                                : 'text-fg-muted hover:text-fg hover:bg-surface-2 border border-transparent'
                        }`}
                    >
                        <LayoutGrid size={15} />
                        <span>Visão Geral & Métricas</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => changeTab('new_session')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                            activeTab === 'new_session'
                                ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 shadow-2xs'
                                : 'text-fg-muted hover:text-fg hover:bg-surface-2 border border-transparent'
                        }`}
                    >
                        <Plus size={15} />
                        <span>Criar Nova Sessão</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => changeTab('what_if')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                            activeTab === 'what_if'
                                ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 shadow-2xs'
                                : 'text-fg-muted hover:text-fg hover:bg-surface-2 border border-transparent'
                        }`}
                    >
                        <Sliders size={15} />
                        <span>Otimizador What-If & Quant</span>
                    </button>
                </div>
            </div>

            {/* =====================================================================
                LAYER 1: SESSIONS LIST & HISTORY (Screenshot 1)
               ===================================================================== */}
            {activeTab === 'sessions' && (
                <div className="space-y-5">
                    {/* Header & Strategy Filter Pills */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                            <h2 className="text-xl font-black text-fg">Sessões de Replay</h2>
                            <p className="text-xs text-fg-muted">
                                {filteredSessions.length}{' '}
                                {filteredSessions.length === 1 ? 'sessão no total' : 'sessões no total'}
                            </p>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => changeTab('strategies')}
                                className="px-3.5 py-2 rounded-xl bg-surface border border-line hover:bg-surface-2 text-xs font-bold text-fg cursor-pointer transition-colors"
                            >
                                Escolher estratégia
                            </button>
                            <button
                                type="button"
                                onClick={() => changeTab('new_session')}
                                className="px-4 py-2 rounded-xl bg-fg text-canvas hover:opacity-90 text-xs font-bold cursor-pointer transition-opacity flex items-center gap-1.5"
                            >
                                <Plus size={14} />
                                <span>Nova sessão</span>
                            </button>
                        </div>
                    </div>

                    {/* Strategy Filter Bar */}
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setSelectedStrategyFilter('ALL')}
                            className={`px-3.5 py-1.5 rounded-full text-xs font-bold cursor-pointer transition-all ${
                                selectedStrategyFilter === 'ALL'
                                    ? 'bg-fg text-canvas shadow-xs'
                                    : 'bg-surface border border-line text-fg-muted hover:text-fg'
                            }`}
                        >
                            Todas as estratégias
                        </button>
                        {strategies.map((strat) => (
                            <button
                                key={strat.id}
                                type="button"
                                onClick={() => setSelectedStrategyFilter(strat.id)}
                                className={`px-3.5 py-1.5 rounded-full text-xs font-bold cursor-pointer transition-all ${
                                    selectedStrategyFilter === strat.id
                                        ? 'bg-fg text-canvas shadow-xs'
                                        : 'bg-surface border border-line text-fg-muted hover:text-fg'
                                }`}
                            >
                                {strat.name}
                            </button>
                        ))}
                        <button
                            type="button"
                            onClick={() => changeTab('strategies')}
                            className="px-3 py-1.5 text-xs font-semibold text-fg-muted hover:text-emerald-500 cursor-pointer transition-colors"
                        >
                            Gerenciar
                        </button>
                    </div>

                    {/* Sessions List */}
                    {filteredSessions.length === 0 ? (
                        <div className="bg-surface border border-line rounded-2xl p-12 text-center space-y-4">
                            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 mx-auto">
                                <Play size={22} />
                            </div>
                            <div className="space-y-1">
                                <h3 className="text-base font-bold text-fg">Nenhuma sessão encontrada</h3>
                                <p className="text-xs text-fg-muted max-w-md mx-auto">
                                    Crie sua primeira sessão de replay definindo os ativos, o período histórico e a estratégia para treinar vela a vela.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => changeTab('new_session')}
                                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs cursor-pointer transition-all"
                            >
                                <Plus size={15} />
                                <span>Criar Nova Sessão</span>
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {filteredSessions.map((sess) => {
                                const pnlPositive = (sess.netPnl || 0) >= 0;
                                return (
                                    <div
                                        key={sess.id}
                                        onClick={() => navigate(`/backtesting/replay/${sess.id}`)}
                                        className="group bg-surface hover:bg-surface-2/50 border border-line hover:border-emerald-500/40 rounded-2xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 cursor-pointer transition-all shadow-xs"
                                    >
                                        <div className="space-y-2">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <h3 className="text-base font-black text-fg group-hover:text-emerald-500 transition-colors">
                                                    {sess.name}
                                                </h3>
                                                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">
                                                    {sess.status === 'ACTIVE' ? 'Ativa' : 'Concluída'}
                                                </span>
                                                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-surface-2 text-fg-muted border border-line">
                                                    {sess.strategyName}
                                                </span>
                                                {sess.fundedMode?.enabled && (
                                                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                                                        <ShieldCheck size={12} />
                                                        Funded ({sess.fundedMode.profitTargetPct}% / -{sess.fundedMode.maxDailyLossPct}%)
                                                    </span>
                                                )}
                                            </div>

                                            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                                                <span className="font-bold text-fg/90">
                                                    {sess.pairs.join(' · ')}
                                                </span>
                                                <span>·</span>
                                                <span>
                                                    {formatDateDisplay(sess.fromDate)} → {formatDateDisplay(sess.toDate)}
                                                </span>
                                                <span>·</span>
                                                <span className="font-mono text-[11px]">
                                                    Capital: ${sess.startingCapital.toLocaleString('en-US')}
                                                </span>
                                                {sess.closedTradesCount > 0 && (
                                                    <>
                                                        <span>·</span>
                                                        <span
                                                            className={`font-mono font-bold ${
                                                                pnlPositive ? 'text-emerald-500' : 'text-rose-500'
                                                            }`}
                                                        >
                                                            P&L: {pnlPositive ? '+' : ''}${sess.netPnl.toFixed(2)} ({sess.closedTradesCount} trades · {sess.winRate}% WR)
                                                        </span>
                                                    </>
                                                )}
                                            </div>
                                        </div>

                                        <div
                                            className="flex flex-wrap items-center gap-3"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <div className="flex items-center gap-2 text-xs text-fg-muted bg-surface-2 px-3 py-1.5 rounded-xl border border-line">
                                                <span className="text-[11px] text-fg-subtle">Alterar fim:</span>
                                                <span className="text-[11px] text-fg-muted">Até</span>
                                                <input
                                                    type="date"
                                                    value={sess.toDate}
                                                    onChange={(e) => handleChangeSessionEndDate(sess.id, e.target.value)}
                                                    className="bg-transparent font-bold text-fg text-xs focus:outline-none cursor-pointer"
                                                />
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => navigate(`/backtesting/replay/${sess.id}`)}
                                                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer transition-all shadow-sm"
                                            >
                                                <Play size={13} fill="currentColor" />
                                                <span>Abrir Replay</span>
                                                <ArrowUpRight size={14} />
                                            </button>

                                            <button
                                                type="button"
                                                onClick={(e) => handleDeleteSession(sess.id, e)}
                                                title="Excluir sessão"
                                                className="w-9 h-9 rounded-xl bg-surface-2 hover:bg-rose-500/15 text-fg-muted hover:text-rose-500 border border-line flex items-center justify-center cursor-pointer transition-colors"
                                            >
                                                <Trash2 size={15} />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* =====================================================================
                LAYER 2: STRATEGIES MANAGEMENT & STRATEGY DETAILS (Screenshot 2)
               ===================================================================== */}
            {activeTab === 'strategies' && activeStrategy && (
                <div className="space-y-6">
                    {/* Strategy Selector Pills + Create Button */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                            {strategies.map((strat) => (
                                <button
                                    key={strat.id}
                                    type="button"
                                    onClick={() => setActiveStrategyId(strat.id)}
                                    className={`px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-all flex items-center gap-2 ${
                                        activeStrategy.id === strat.id
                                            ? 'bg-fg text-canvas shadow-sm'
                                            : 'bg-surface border border-line text-fg-muted hover:text-fg'
                                    }`}
                                >
                                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                                    <span>{strat.name}</span>
                                </button>
                            ))}
                        </div>

                        <button
                            type="button"
                            onClick={() => setNewStrategyModalOpen(true)}
                            className="px-3.5 py-2 rounded-xl bg-surface border border-line hover:bg-surface-2 text-xs font-bold text-fg flex items-center gap-1.5 cursor-pointer"
                        >
                            <Plus size={14} className="text-emerald-500" />
                            <span>Criar nova estratégia</span>
                        </button>
                    </div>

                    {/* Selected Strategy Header (Matching Screenshot 2) */}
                    <div className="bg-surface border border-line rounded-2xl p-6 space-y-6">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div className="space-y-1">
                                <div className="text-xs font-semibold text-fg-muted flex items-center gap-1">
                                    <span>&lt; Estratégias</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <h2 className="text-2xl sm:text-3xl font-black text-fg">
                                        {activeStrategy.name}
                                    </h2>
                                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                        Ativa
                                    </span>
                                </div>
                                <p className="text-xs text-fg-muted">
                                    {activeStrategy.sessionTag} · {activeStrategy.description}
                                </p>
                            </div>

                            <div className="flex items-center gap-2.5">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSelectedStrategyFilter(activeStrategy.id);
                                        changeTab('dashboard');
                                    }}
                                    className="px-4 py-2.5 rounded-xl bg-surface-2 hover:bg-surface-3 border border-line text-xs font-bold text-fg cursor-pointer transition-colors"
                                >
                                    Dashboard
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSessionStrategyId(activeStrategy.id);
                                        setSelectedPairs(activeStrategy.symbols || [activeStrategy.primarySymbol]);
                                        changeTab('new_session');
                                    }}
                                    className="px-4 py-2.5 rounded-xl bg-fg text-canvas hover:opacity-90 text-xs font-bold cursor-pointer transition-opacity"
                                >
                                    Nova sessão
                                </button>
                            </div>
                        </div>

                        {/* 4 Strategy Summary Cards (Starting capital, Balance, Trading P&L, Closed trades) */}
                        {(() => {
                            const stratSessions = sessions.filter((s) => s.strategyId === activeStrategy.id);
                            const stratPnl = stratSessions.reduce((a, s) => a + (s.netPnl || 0), 0);
                            const stratTrades = stratSessions.reduce((a, s) => a + (s.closedTradesCount || 0), 0);
                            const stratBalance = activeStrategy.startingCapital + stratPnl;

                            return (
                                <>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                        <div className="bg-surface-2/40 border border-line rounded-2xl p-5 space-y-2">
                                            <span className="text-xs text-fg-muted font-medium block">
                                                Capital inicial
                                            </span>
                                            <div className="text-2xl font-black text-fg font-mono">
                                                ${activeStrategy.startingCapital.toLocaleString('en-US')}
                                            </div>
                                            <span className="text-[11px] text-fg-subtle block">
                                                {activeStrategy.riskMode === 'FIXED_RISK' ? 'Risco fixo' : 'Risco dinâmico'}
                                            </span>
                                        </div>

                                        <div className="bg-surface-2/40 border border-line rounded-2xl p-5 space-y-2">
                                            <span className="text-xs text-fg-muted font-medium block">
                                                Saldo Atual
                                            </span>
                                            <div className="text-2xl font-black text-fg font-mono">
                                                ${stratBalance.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                                            </div>
                                            <span className="text-[11px] text-fg-subtle block">
                                                Em {stratSessions.length} {stratSessions.length === 1 ? 'sessão' : 'sessões'}
                                            </span>
                                        </div>

                                        <div className="bg-surface-2/40 border border-line rounded-2xl p-5 space-y-2">
                                            <span className="text-xs text-fg-muted font-medium block">
                                                Trading P&L
                                            </span>
                                            <div
                                                className={`text-2xl font-black font-mono ${
                                                    stratTrades === 0
                                                        ? 'text-fg'
                                                        : stratPnl >= 0
                                                          ? 'text-emerald-500'
                                                          : 'text-rose-500'
                                                }`}
                                            >
                                                {stratTrades === 0
                                                    ? '—'
                                                    : `${stratPnl >= 0 ? '+' : ''}$${stratPnl.toFixed(2)}`}
                                            </div>
                                            <span className="text-[11px] text-fg-subtle block">
                                                Resultado líquido acumulado
                                            </span>
                                        </div>

                                        <div className="bg-surface-2/40 border border-line rounded-2xl p-5 space-y-2">
                                            <span className="text-xs text-fg-muted font-medium block">
                                                Trades fechados
                                            </span>
                                            <div className="text-2xl font-black text-fg font-mono">
                                                {stratTrades}
                                            </div>
                                            <span className="text-[11px] text-fg-subtle block">
                                                Execuções finalizadas no Replay
                                            </span>
                                        </div>
                                    </div>

                                    {/* Trading Plan / Checklist Rules */}
                                    <div className="bg-surface-2/30 border border-line rounded-2xl p-4 space-y-3">
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                            <div className="text-xs text-fg-muted">
                                                {activeStrategy.rules?.length ? (
                                                    <span>
                                                        Plano Operacional Ativo:{' '}
                                                        <strong className="text-fg">
                                                            {activeStrategy.rules.length} regras de validação
                                                        </strong>
                                                    </span>
                                                ) : (
                                                    <span>
                                                        Sem plano: nada será exigido ao operar.{' '}
                                                        <strong className="text-fg">Adicione regras abaixo</strong>
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="text"
                                                    value={newRuleText}
                                                    onChange={(e) => setNewRuleText(e.target.value)}
                                                    placeholder="Nova regra do plano (ex: Aguardar sweep de liquidez)..."
                                                    className="px-3 py-1.5 rounded-lg bg-surface border border-line text-xs text-fg w-64 sm:w-80 focus:outline-none focus:border-emerald-500"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={handleAddRuleToStrategy}
                                                    className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs cursor-pointer"
                                                >
                                                    + Regra
                                                </button>
                                            </div>
                                        </div>

                                        {activeStrategy.rules && activeStrategy.rules.length > 0 && (
                                            <div className="space-y-1.5 pt-1">
                                                {activeStrategy.rules.map((r) => (
                                                    <div
                                                        key={r.id}
                                                        className="flex items-center justify-between px-3 py-2 rounded-xl bg-surface border border-line text-xs"
                                                    >
                                                        <div className="flex items-center gap-2 text-fg">
                                                            <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                                                            <span>{r.text}</span>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRemoveRuleFromStrategy(r.id)}
                                                            className="text-fg-subtle hover:text-rose-500 cursor-pointer"
                                                        >
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {/* Sessions of this strategy */}
                                    <div className="space-y-3">
                                        <h3 className="text-sm font-black text-fg">Sessões</h3>
                                        {stratSessions.length === 0 ? (
                                            <div className="p-6 rounded-xl border border-line bg-surface-2/20 text-center text-xs text-fg-muted">
                                                Nenhuma sessão criada para esta estratégia ainda. Clique em{' '}
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setSessionStrategyId(activeStrategy.id);
                                                        changeTab('new_session');
                                                    }}
                                                    className="text-emerald-500 font-bold underline cursor-pointer"
                                                >
                                                    Nova sessão
                                                </button>{' '}
                                                para iniciar.
                                            </div>
                                        ) : (
                                            stratSessions.map((sess) => (
                                                <div
                                                    key={sess.id}
                                                    onClick={() => navigate(`/backtesting/replay/${sess.id}`)}
                                                    className="p-4 rounded-xl border border-line bg-surface-2/30 hover:border-emerald-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer transition-all"
                                                >
                                                    <div className="space-y-1">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-bold text-sm text-fg">
                                                                {sess.name}
                                                            </span>
                                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-500">
                                                                Ativa
                                                            </span>
                                                        </div>
                                                        <div className="text-xs text-fg-muted">
                                                            {sess.pairs.join(' · ')} · {formatDateDisplay(sess.fromDate)} →{' '}
                                                            {formatDateDisplay(sess.toDate)}
                                                        </div>
                                                    </div>

                                                    <div
                                                        className="flex items-center gap-3"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        <span className="text-xs text-fg-muted">
                                                            Até <strong className="text-fg">{formatDateDisplay(sess.toDate)}</strong>
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => navigate(`/backtesting/replay/${sess.id}`)}
                                                            className="px-3.5 py-1.5 rounded-lg bg-emerald-500 text-slate-950 font-bold text-xs cursor-pointer"
                                                        >
                                                            Abrir Replay
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={(e) => handleDeleteSession(sess.id, e)}
                                                            className="p-2 rounded-lg bg-surface hover:bg-rose-500/15 text-fg-muted hover:text-rose-500 border border-line cursor-pointer"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>

                                    {/* Strategy Details Accordion (Matching Screenshot 2) */}
                                    <div className="space-y-2">
                                        <h3 className="text-sm font-black text-fg">Detalhes da estratégia</h3>
                                        <div className="border border-line rounded-2xl overflow-hidden bg-surface-2/20">
                                            <button
                                                type="button"
                                                onClick={() => setStrategyDetailsExpanded((v) => !v)}
                                                className="w-full p-4 flex items-center justify-between text-left text-xs font-bold text-fg cursor-pointer hover:bg-surface-2/50 transition-colors"
                                            >
                                                <span>
                                                    {activeStrategy.primarySymbol} · {activeStrategy.riskPerTrade}% risco por trade ·{' '}
                                                    {activeStrategy.riskMode === 'FIXED_RISK' ? 'Risco fixo' : 'Risco dinâmico'}
                                                </span>
                                                {strategyDetailsExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                            </button>

                                            {strategyDetailsExpanded && (
                                                <div className="p-4 border-t border-line grid grid-cols-1 sm:grid-cols-3 gap-4 bg-surface">
                                                    <div>
                                                        <label className="text-[11px] text-fg-muted font-semibold block mb-1">
                                                            Capital Inicial ($)
                                                        </label>
                                                        <input
                                                            type="number"
                                                            value={activeStrategy.startingCapital}
                                                            onChange={(e) => {
                                                                const next = updateBacktestStrategy(activeStrategy.id, {
                                                                    startingCapital: Number(e.target.value) || 100000,
                                                                });
                                                                setStrategies(next);
                                                            }}
                                                            className="w-full px-3 py-2 rounded-xl bg-surface-2 border border-line text-xs font-mono font-bold text-fg"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-[11px] text-fg-muted font-semibold block mb-1">
                                                            Risco por Trade (%)
                                                        </label>
                                                        <input
                                                            type="number"
                                                            step="0.25"
                                                            value={activeStrategy.riskPerTrade}
                                                            onChange={(e) => {
                                                                const next = updateBacktestStrategy(activeStrategy.id, {
                                                                    riskPerTrade: Number(e.target.value) || 1,
                                                                });
                                                                setStrategies(next);
                                                            }}
                                                            className="w-full px-3 py-2 rounded-xl bg-surface-2 border border-line text-xs font-mono font-bold text-fg"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-[11px] text-fg-muted font-semibold block mb-1">
                                                            Alvo Padrão (R:R)
                                                        </label>
                                                        <input
                                                            type="number"
                                                            step="0.5"
                                                            value={activeStrategy.rrTarget}
                                                            onChange={(e) => {
                                                                const next = updateBacktestStrategy(activeStrategy.id, {
                                                                    rrTarget: Number(e.target.value) || 2,
                                                                });
                                                                setStrategies(next);
                                                            }}
                                                            className="w-full px-3 py-2 rounded-xl bg-surface-2 border border-line text-xs font-mono font-bold text-fg"
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                </div>
            )}

            {/* =====================================================================
                LAYER 3: DASHBOARD & PERFORMANCE OVERVIEW (Screenshots 3 & 4)
               ===================================================================== */}
            {activeTab === 'dashboard' && (
                <div className="space-y-6">
                    {/* Top Strategy Context & Period Filter */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setSelectedStrategyFilter('ALL')}
                                className={`px-3.5 py-1.5 rounded-full text-xs font-bold cursor-pointer ${
                                    selectedStrategyFilter === 'ALL'
                                        ? 'bg-fg text-canvas'
                                        : 'bg-surface border border-line text-fg-muted hover:text-fg'
                                }`}
                            >
                                Todas
                            </button>
                            {strategies.map((s) => (
                                <button
                                    key={s.id}
                                    type="button"
                                    onClick={() => setSelectedStrategyFilter(s.id)}
                                    className={`px-3.5 py-1.5 rounded-full text-xs font-bold cursor-pointer ${
                                        selectedStrategyFilter === s.id
                                            ? 'bg-fg text-canvas'
                                            : 'bg-surface border border-line text-fg-muted hover:text-fg'
                                    }`}
                                >
                                    {s.name}
                                </button>
                            ))}
                        </div>

                        <div className="flex items-center gap-1 bg-surface border border-line rounded-xl p-1">
                            {(
                                [
                                    { id: 'ALL', label: 'Tudo' },
                                    { id: '7D', label: '7 dias' },
                                    { id: '30D', label: '30 dias' },
                                    { id: '90D', label: 'Trimestre' },
                                    { id: '1Y', label: 'Ano' },
                                ] as const
                            ).map((p) => (
                                <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => setDashboardPeriodFilter(p.id)}
                                    className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                                        dashboardPeriodFilter === p.id
                                            ? 'bg-surface-2 text-fg shadow-2xs'
                                            : 'text-fg-muted hover:text-fg'
                                    }`}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Getting Started Guide (Screenshot 3) */}
                    <div className="bg-surface border border-line rounded-2xl p-6 space-y-5">
                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <span className="text-[11px] text-fg-muted font-semibold">
                                    Seu guia de início rápido
                                </span>
                                <h3 className="text-lg font-black text-fg">
                                    Fluxo Estruturado de Backtesting no Torex Journal
                                </h3>
                                <p className="text-xs text-fg-muted">
                                    Seis passos para configurar seu ambiente e validar seu operacional.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setGettingStartedOpen((v) => !v)}
                                className="p-2 rounded-xl bg-surface-2 hover:bg-surface-3 text-fg-muted cursor-pointer"
                            >
                                {gettingStartedOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </button>
                        </div>

                        {gettingStartedOpen && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-line">
                                <div className="p-4 rounded-xl bg-surface-2/30 border border-line flex items-start gap-3">
                                    <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center shrink-0 mt-0.5">
                                        <Check size={14} />
                                    </div>
                                    <div className="space-y-2">
                                        <h4 className="text-xs font-bold text-fg">1. Crie sua primeira estratégia</h4>
                                        <p className="text-[11px] text-fg-muted">
                                            Nomeie seu método operacional e defina o capital inicial e risco fixo por trade.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => setNewStrategyModalOpen(true)}
                                            className="px-3 py-1.5 rounded-full bg-emerald-500/15 text-emerald-500 text-[11px] font-bold cursor-pointer hover:bg-emerald-500/25"
                                        >
                                            Criar estratégia →
                                        </button>
                                    </div>
                                </div>

                                <div className="p-4 rounded-xl bg-surface-2/30 border border-line flex items-start gap-3">
                                    <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center shrink-0 mt-0.5">
                                        <Check size={14} />
                                    </div>
                                    <div className="space-y-2">
                                        <h4 className="text-xs font-bold text-fg">2. Crie uma sessão de backtesting</h4>
                                        <p className="text-[11px] text-fg-muted">
                                            Escolha os pares (ex: XAUUSD, GBPUSD) e o período histórico para testar em replay.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => changeTab('new_session')}
                                            className="px-3 py-1.5 rounded-full bg-emerald-500/15 text-emerald-500 text-[11px] font-bold cursor-pointer hover:bg-emerald-500/25"
                                        >
                                            Nova sessão →
                                        </button>
                                    </div>
                                </div>

                                <div className="p-4 rounded-xl bg-surface-2/30 border border-line flex items-start gap-3">
                                    <div className="w-6 h-6 rounded-full bg-fg text-canvas text-xs font-black flex items-center justify-center shrink-0 mt-0.5">
                                        3
                                    </div>
                                    <div className="space-y-2">
                                        <h4 className="text-xs font-bold text-fg">3. Execute seu primeiro trade no Replay</h4>
                                        <p className="text-[11px] text-fg-muted">
                                            Abra o terminal gráfico de Replay, posicione sua ordem Buy/Sell e avance as velas.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const firstSess = sessions[0];
                                                if (firstSess) navigate(`/backtesting/replay/${firstSess.id}`);
                                                else changeTab('new_session');
                                            }}
                                            className="px-3.5 py-1.5 rounded-full bg-fg text-canvas text-[11px] font-bold cursor-pointer hover:opacity-90"
                                        >
                                            Abrir replay →
                                        </button>
                                    </div>
                                </div>

                                <div className="p-4 rounded-xl bg-surface-2/30 border border-line flex items-start gap-3">
                                    <div className="w-6 h-6 rounded-full bg-surface-3 text-fg-muted text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                                        4
                                    </div>
                                    <div className="space-y-2">
                                        <h4 className="text-xs font-bold text-fg">4. Adicione regras ao Plano de Trading</h4>
                                        <p className="text-[11px] text-fg-muted">
                                            Defina gatilhos objetivos na aba Estratégias para manter consistência e disciplina.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => changeTab('strategies')}
                                            className="px-3 py-1.5 rounded-full bg-surface-3 text-fg text-[11px] font-bold cursor-pointer hover:bg-surface-2"
                                        >
                                            Escrever minha regra →
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Hero Performance & Time Invested Cards (Screenshot 4) */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                        {/* Card 1: Performance */}
                        <div className="bg-gradient-to-br from-emerald-500/10 via-surface to-surface border border-emerald-500/25 rounded-2xl p-6 flex flex-col justify-between min-h-[260px]">
                            <div className="space-y-1">
                                <span className="text-xs text-fg-muted font-medium">
                                    Performance · de ${dashboardStats.baseCapital.toLocaleString('en-US')}
                                </span>
                                <div className="text-3xl sm:text-4xl font-black text-fg font-mono tracking-tight">
                                    ${dashboardStats.currentTotalBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>
                            </div>

                            {/* Mini Equity Line Visual */}
                            <div className="my-6 h-24 flex items-end gap-1.5 border-b border-line/60 pb-2">
                                {dashboardStats.allClosedOrders.length === 0 ? (
                                    <div className="w-full h-full flex items-center justify-center text-xs text-fg-subtle border border-dashed border-line rounded-xl">
                                        Execute trades no Replay para construir a curva de patrimônio
                                    </div>
                                ) : (
                                    dashboardStats.allClosedOrders.slice(-24).map((o, i) => {
                                        const isWin = o.pnl >= 0;
                                        return (
                                            <div
                                                key={o.id || i}
                                                className={`flex-1 rounded-t-xs transition-all ${
                                                    isWin ? 'bg-emerald-500/70' : 'bg-rose-500/70'
                                                }`}
                                                style={{
                                                    height: `${Math.min(100, Math.max(18, Math.abs(o.rMultiple || 1) * 32))}%`,
                                                }}
                                                title={`${o.symbol}: ${o.pnl >= 0 ? '+' : ''}$${o.pnl.toFixed(2)}`}
                                            />
                                        );
                                    })
                                )}
                            </div>

                            <div className="flex items-center justify-between text-xs text-fg-muted">
                                <span>
                                    Retorno Líquido:{' '}
                                    <strong
                                        className={
                                            dashboardStats.totalNetPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'
                                        }
                                    >
                                        {dashboardStats.totalNetPnl >= 0 ? '+' : ''}$
                                        {dashboardStats.totalNetPnl.toFixed(2)}
                                    </strong>
                                </span>
                                <span>{filteredSessions.length} sessões analisadas</span>
                            </div>
                        </div>

                        {/* Card 2: Time Invested & Practice Consistency Grid */}
                        <div className="bg-surface border border-line rounded-2xl p-6 flex flex-col justify-between min-h-[260px]">
                            <div className="space-y-1">
                                <span className="text-xs text-fg-muted font-medium flex items-center gap-1.5">
                                    <Clock size={13} className="text-emerald-500" />
                                    Tempo investido — toda a estratégia
                                </span>
                                <div className="text-3xl sm:text-4xl font-black text-fg tracking-tight">
                                    {dashboardStats.totalMinutes} min
                                </div>
                                <span className="text-[11px] text-fg-subtle block">
                                    Em {filteredSessions.length}{' '}
                                    {filteredSessions.length === 1 ? 'sessão' : 'sessões'} de prática
                                </span>
                            </div>

                            <div className="grid grid-cols-4 gap-3 my-4 py-3 border-y border-line">
                                <div>
                                    <span className="text-[10px] text-fg-muted block">Dias praticados</span>
                                    <span className="text-sm font-black text-fg">
                                        {dashboardStats.uniqueDays} dias
                                    </span>
                                </div>
                                <div>
                                    <span className="text-[10px] text-fg-muted block">Média por dia</span>
                                    <span className="text-sm font-black text-fg">
                                        {Math.max(1, Math.round(dashboardStats.totalMinutes / dashboardStats.uniqueDays))} min
                                    </span>
                                </div>
                                <div>
                                    <span className="text-[10px] text-fg-muted block">Sequência atual</span>
                                    <span className="text-sm font-black text-fg">
                                        {dashboardStats.uniqueDays} dias
                                    </span>
                                </div>
                                <div>
                                    <span className="text-[10px] text-fg-muted block">Melhor sequência</span>
                                    <span className="text-sm font-black text-fg">
                                        {dashboardStats.uniqueDays} dias
                                    </span>
                                </div>
                            </div>

                            {/* Consistency Heatmap Grid */}
                            <div className="flex items-center justify-between gap-2">
                                <div className="grid grid-cols-16 gap-1 flex-1">
                                    {Array.from({ length: 48 }).map((_, idx) => {
                                        const active = idx >= 45 || (idx % 11 === 0 && filteredSessions.length > 1);
                                        return (
                                            <div
                                                key={idx}
                                                className={`h-3 rounded-2xs ${
                                                    active
                                                        ? 'bg-emerald-500 shadow-2xs'
                                                        : 'bg-surface-2 border border-line/50'
                                                }`}
                                            />
                                        );
                                    })}
                                </div>
                                <span className="text-[10px] text-fg-subtle shrink-0">Menos → Mais</span>
                            </div>
                        </div>
                    </div>

                    {/* 8 KPI Cards Grid (Screenshot 4) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="bg-surface border border-line rounded-2xl p-5 space-y-2">
                            <span className="text-xs text-fg-muted font-medium">P&L Líquido Acumulado</span>
                            <div
                                className={`text-2xl font-black font-mono ${
                                    dashboardStats.totalClosedTrades === 0
                                        ? 'text-fg'
                                        : dashboardStats.totalNetPnl >= 0
                                          ? 'text-emerald-500'
                                          : 'text-rose-500'
                                }`}
                            >
                                {dashboardStats.totalClosedTrades === 0
                                    ? '—'
                                    : `${dashboardStats.totalNetPnl >= 0 ? '+' : ''}$${dashboardStats.totalNetPnl.toFixed(2)}`}
                            </div>
                            <span className="text-[11px] text-fg-subtle block">
                                {dashboardStats.totalClosedTrades === 0
                                    ? 'Você ainda não fechou trades'
                                    : `${dashboardStats.totalClosedTrades} trades encerrados`}
                            </span>
                        </div>

                        <div className="bg-surface border border-line rounded-2xl p-5 space-y-2">
                            <span className="text-xs text-fg-muted font-medium">Média R (Average R)</span>
                            <div className="text-2xl font-black text-fg font-mono">
                                {dashboardStats.totalClosedTrades === 0 ? '—' : `${dashboardStats.avgR}R`}
                            </div>
                            <span className="text-[11px] text-fg-subtle block">
                                Retorno médio em unidades de risco
                            </span>
                        </div>

                        <div className="bg-surface border border-line rounded-2xl p-5 flex items-center justify-between">
                            <div className="space-y-2">
                                <span className="text-xs text-fg-muted font-medium">Taxa de Acerto (Win rate)</span>
                                <div className="text-2xl font-black text-fg font-mono">
                                    {dashboardStats.totalClosedTrades === 0 ? '—' : `${dashboardStats.winRate}%`}
                                </div>
                                <div className="text-[11px] space-x-2">
                                    <span className="text-emerald-500 font-semibold">{dashboardStats.totalWins} wins</span>
                                    <span className="text-rose-500 font-semibold">{dashboardStats.totalLosses} losses</span>
                                </div>
                            </div>
                            <div className="w-14 h-14 rounded-full border-4 border-surface-3 flex items-center justify-center text-xs font-bold text-fg-muted">
                                {dashboardStats.totalClosedTrades === 0 ? '—' : `${Math.round(dashboardStats.winRate)}%`}
                            </div>
                        </div>

                        <div className="bg-surface border border-line rounded-2xl p-5 space-y-2">
                            <span className="text-xs text-fg-muted font-medium">Média Ganho / Perda</span>
                            <div className="text-2xl font-black text-fg font-mono">
                                {dashboardStats.totalClosedTrades === 0
                                    ? '—'
                                    : `$${dashboardStats.avgWin} / -$${dashboardStats.avgLoss}`}
                            </div>
                            <span className="text-[11px] text-fg-subtle block">
                                Payoff médio por operação
                            </span>
                        </div>

                        <div className="bg-surface border border-line rounded-2xl p-5 space-y-2">
                            <span className="text-xs text-fg-muted font-medium">Fator de Lucro (Profit factor)</span>
                            <div className="text-2xl font-black text-fg font-mono">
                                {dashboardStats.totalClosedTrades === 0 ? '—' : dashboardStats.profitFactor}
                            </div>
                            <span className="text-[11px] text-fg-subtle block">
                                Lucro Bruto / Prejuízo Bruto
                            </span>
                        </div>

                        <div className="bg-surface border border-line rounded-2xl p-5 space-y-2">
                            <span className="text-xs text-fg-muted font-medium">Expectativa por trade</span>
                            <div className="text-2xl font-black text-fg font-mono">
                                {dashboardStats.totalClosedTrades === 0 ? '—' : `$${dashboardStats.expectancy}`}
                            </div>
                            <span className="text-[11px] text-fg-subtle block">
                                Valor matemático esperado por ordem
                            </span>
                        </div>

                        <div className="bg-surface border border-line rounded-2xl p-5 space-y-2">
                            <span className="text-xs text-fg-muted font-medium">Melhor Sessão</span>
                            <div className="text-2xl font-black text-emerald-500 font-mono">
                                {dashboardStats.bestSessionPnl <= 0 ? '—' : `+$${dashboardStats.bestSessionPnl.toFixed(2)}`}
                            </div>
                            <span className="text-[11px] text-fg-subtle block">
                                Maior lucro líquido em uma sessão
                            </span>
                        </div>

                        <div className="bg-surface border border-line rounded-2xl p-5 space-y-2">
                            <span className="text-xs text-fg-muted font-medium">Drawdown Máximo</span>
                            <div className="text-2xl font-black text-rose-500 font-mono">
                                {dashboardStats.maxDrawdown <= 0
                                    ? '—'
                                    : `-$${dashboardStats.maxDrawdown.toFixed(2)} (${dashboardStats.maxDrawdownPct}%)`}
                            </div>
                            <span className="text-[11px] text-fg-subtle block">
                                Maior recuo do pico de capital
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {/* =====================================================================
                LAYER 4: CREATE NEW REPLAY SESSION (Screenshot 5)
               ===================================================================== */}
            {activeTab === 'new_session' && (
                <div className="max-w-3xl mx-auto space-y-6">
                    <div className="space-y-1">
                        <button
                            type="button"
                            onClick={() => changeTab('sessions')}
                            className="text-xs font-bold text-fg-muted hover:text-fg cursor-pointer mb-1 inline-block"
                        >
                            &lt; Voltar para Sessões
                        </button>
                        <h2 className="text-2xl sm:text-3xl font-black text-fg">Nova sessão</h2>
                        <p className="text-xs sm:text-sm text-fg-muted">
                            O trecho do histórico que você vai operar. O capital inicial e a gestão vêm da estratégia selecionada.
                        </p>
                    </div>

                    <form
                        onSubmit={handleCreateAndOpenSession}
                        className="bg-surface border border-line rounded-3xl p-6 sm:p-8 space-y-7 shadow-lg"
                    >
                        {/* Row 1: Session Name & Strategy Starting Capital (Matching Screenshot 5) */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-fg block">Nome da Sessão</label>
                                <input
                                    type="text"
                                    value={sessionName}
                                    onChange={(e) => setSessionName(e.target.value)}
                                    placeholder="Ex: Londres, Janeiro 2026"
                                    className="w-full px-4 py-3 rounded-xl bg-surface-2 border border-line-strong text-sm text-fg font-semibold focus:outline-none focus:border-emerald-500"
                                />
                                <div className="pt-2">
                                    <label className="text-[11px] font-bold text-fg-muted block mb-1">
                                        Estratégia Vinculada
                                    </label>
                                    <select
                                        value={sessionStrategyId}
                                        onChange={(e) => setSessionStrategyId(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl bg-surface-2 border border-line text-xs font-bold text-fg focus:outline-none focus:border-emerald-500"
                                    >
                                        {strategies.map((s) => (
                                            <option key={s.id} value={s.id}>
                                                {s.name} (${s.startingCapital.toLocaleString('en-US')})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="space-y-2 bg-surface-2/40 border border-line rounded-2xl p-4">
                                <span className="text-xs font-bold text-fg block">Capital inicial</span>
                                <div className="flex items-baseline gap-2">
                                    <span className="text-2xl font-black text-fg font-mono">
                                        ${(sessionCreationStrategy?.startingCapital || 100000).toLocaleString('en-US')}
                                    </span>
                                    <span className="text-xs text-fg-muted">
                                        de "{sessionCreationStrategy?.name}".{' '}
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (sessionCreationStrategy) setActiveStrategyId(sessionCreationStrategy.id);
                                                changeTab('strategies');
                                            }}
                                            className="underline text-fg hover:text-emerald-500 cursor-pointer"
                                        >
                                            Alterar lá
                                        </button>
                                    </span>
                                </div>
                                <span className="inline-block px-2 py-0.5 rounded bg-surface-3 text-[10px] font-bold text-fg-muted">
                                    Risco fixo
                                </span>
                                <p className="text-[11px] text-fg-muted leading-relaxed">
                                    O risco de cada trade vem do capital inicial. 1R vale o mesmo do primeiro ao último trade.
                                </p>
                            </div>
                        </div>

                        {/* Row 2: Pairs Selection & Primary Ordering (Matching Screenshot 5) */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-bold text-fg">Pares / Ativos</label>
                                <span className="text-[11px] text-fg-muted">
                                    Timeframe inicial:{' '}
                                    <select
                                        value={sessionTimeframe}
                                        onChange={(e) => setSessionTimeframe(e.target.value)}
                                        className="bg-surface-2 border border-line rounded px-2 py-0.5 font-bold text-fg ml-1"
                                    >
                                        {['1m', '5m', '15m', '1h', '4h', 'D'].map((tf) => (
                                            <option key={tf} value={tf}>
                                                {tf}
                                            </option>
                                        ))}
                                    </select>
                                </span>
                            </div>

                            <div className="relative">
                                <Search
                                    size={15}
                                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none"
                                />
                                <input
                                    type="text"
                                    value={pairSearch}
                                    onChange={(e) => setPairSearch(e.target.value)}
                                    placeholder="Pesquisar entre os símbolos disponíveis (EURUSD, XAUUSD, BTCUSD, NAS100)..."
                                    className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface-2 border border-line text-xs text-fg focus:outline-none focus:border-emerald-500"
                                />
                            </div>

                            {/* Quick Pair Chips */}
                            <div className="flex flex-wrap items-center gap-1.5">
                                {matchingSymbolList.map((sym) => {
                                    const isSelected = selectedPairs.includes(sym.ticker);
                                    return (
                                        <button
                                            key={sym.ticker}
                                            type="button"
                                            onClick={() => handleTogglePair(sym.ticker)}
                                            className={`px-3 py-1 rounded-full text-xs font-bold cursor-pointer transition-all border ${
                                                isSelected
                                                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                                                    : 'bg-surface-2 hover:bg-surface-3 text-fg-muted border-line'
                                            }`}
                                        >
                                            {sym.ticker}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Selected Pairs Ordered List with Primary Badge */}
                            <div className="space-y-1.5 pt-1">
                                {selectedPairs.map((ticker, idx) => (
                                    <div
                                        key={ticker}
                                        className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-surface-2/60 border border-line"
                                    >
                                        <div className="flex items-center gap-2.5">
                                            <span className="font-black text-xs text-fg">{ticker}</span>
                                            {idx === 0 && (
                                                <span className="px-2 py-0.5 rounded-md bg-surface-3 text-[10px] font-bold text-fg-muted">
                                                    Principal
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-1.5">
                                            <button
                                                type="button"
                                                disabled={idx === 0}
                                                onClick={() => handleMovePair(idx, -1)}
                                                title="Mover para cima"
                                                className="p-1 rounded hover:bg-surface-3 text-fg-muted disabled:opacity-30 cursor-pointer"
                                            >
                                                <ArrowUp size={13} />
                                            </button>
                                            <button
                                                type="button"
                                                disabled={idx === selectedPairs.length - 1}
                                                onClick={() => handleMovePair(idx, 1)}
                                                title="Mover para baixo"
                                                className="p-1 rounded hover:bg-surface-3 text-fg-muted disabled:opacity-30 cursor-pointer"
                                            >
                                                <ArrowDown size={13} />
                                            </button>
                                            {selectedPairs.length > 1 && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleTogglePair(ticker)}
                                                    title="Remover ativo"
                                                    className="p-1 rounded hover:bg-rose-500/15 text-fg-muted hover:text-rose-500 cursor-pointer"
                                                >
                                                    <X size={13} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Row 3: Date Range (From / To) & Risk Per Trade (%) */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-fg block flex items-center gap-1.5">
                                    <Calendar size={13} className="text-emerald-500" />
                                    De (Início)
                                </label>
                                <input
                                    type="date"
                                    value={fromDate}
                                    onChange={(e) => setFromDate(e.target.value)}
                                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface-2 border border-line text-xs font-bold text-fg focus:outline-none focus:border-emerald-500"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-fg block flex items-center gap-1.5">
                                    <Calendar size={13} className="text-emerald-500" />
                                    Até (Fim)
                                </label>
                                <input
                                    type="date"
                                    value={keepEndFollowingToday ? todayStr : toDate}
                                    disabled={keepEndFollowingToday}
                                    onChange={(e) => setToDate(e.target.value)}
                                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface-2 border border-line text-xs font-bold text-fg disabled:opacity-50 focus:outline-none focus:border-emerald-500"
                                />
                                <label className="flex items-center gap-2 text-[11px] text-fg-muted cursor-pointer pt-0.5">
                                    <input
                                        type="checkbox"
                                        checked={keepEndFollowingToday}
                                        onChange={(e) => setKeepEndFollowingToday(e.target.checked)}
                                        className="accent-emerald-500 rounded"
                                    />
                                    <span>Manter o fim acompanhando a data de hoje</span>
                                </label>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-fg block flex items-center gap-1.5">
                                    <Target size={13} className="text-emerald-500" />
                                    Risco por trade (%)
                                </label>
                                <input
                                    type="number"
                                    step="0.25"
                                    min="0.1"
                                    max="10"
                                    value={sessionRiskPct}
                                    onChange={(e) => setSessionRiskPct(parseFloat(e.target.value) || 1)}
                                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface-2 border border-line text-xs font-mono font-black text-fg focus:outline-none focus:border-emerald-500"
                                />
                                <span className="text-[10px] text-fg-subtle block">
                                    Definido pela estratégia. Você pode ajustar o risco em cada trade.
                                </span>
                            </div>
                        </div>

                        {/* Row 4: Random Start Date Toggle */}
                        <label className="flex items-center gap-3 p-3.5 rounded-2xl bg-surface-2/40 border border-line cursor-pointer hover:bg-surface-2/70 transition-colors">
                            <input
                                type="checkbox"
                                checked={randomStartDate}
                                onChange={(e) => setRandomStartDate(e.target.checked)}
                                className="accent-emerald-500 w-4 h-4 rounded"
                            />
                            <div className="text-xs">
                                <span className="font-bold text-fg block">
                                    Iniciar em uma data aleatória dentro do período
                                </span>
                                <span className="text-[11px] text-fg-muted">
                                    Evita que você opere de memória ao iniciar o Replay em um ponto cego do histórico.
                                </span>
                            </div>
                        </label>

                        {/* Row 5: Funded Mode (Prop Firm Challenge Simulation) */}
                        <div className="space-y-3">
                            <span className="text-xs font-bold text-fg block">Modo Mesa Proprietária (Funded mode)</span>
                            <div className="p-4 rounded-2xl bg-surface-2/40 border border-line space-y-4">
                                <label className="flex items-center gap-3 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={fundedEnabled}
                                        onChange={(e) => setFundedEnabled(e.target.checked)}
                                        className="accent-emerald-500 w-4 h-4 rounded"
                                    />
                                    <span className="text-xs font-semibold text-fg">
                                        Simular uma conta Funded (Prop Firm) com limites estritos de perda e meta
                                    </span>
                                </label>

                                {fundedEnabled && (
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-line">
                                        <div>
                                            <label className="text-[11px] text-fg-muted font-semibold block mb-1">
                                                Meta de Lucro (%)
                                            </label>
                                            <input
                                                type="number"
                                                step="0.5"
                                                value={fundedProfitTarget}
                                                onChange={(e) => setFundedProfitTarget(Number(e.target.value) || 10)}
                                                className="w-full px-3 py-2 rounded-xl bg-surface border border-line text-xs font-mono font-bold text-emerald-500"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[11px] text-fg-muted font-semibold block mb-1">
                                                Perda Máxima Diária (%)
                                            </label>
                                            <input
                                                type="number"
                                                step="0.5"
                                                value={fundedMaxDailyLoss}
                                                onChange={(e) => setFundedMaxDailyLoss(Number(e.target.value) || 5)}
                                                className="w-full px-3 py-2 rounded-xl bg-surface border border-line text-xs font-mono font-bold text-rose-500"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[11px] text-fg-muted font-semibold block mb-1">
                                                Drawdown Máximo Total (%)
                                            </label>
                                            <input
                                                type="number"
                                                step="0.5"
                                                value={fundedMaxTotalLoss}
                                                onChange={(e) => setFundedMaxTotalLoss(Number(e.target.value) || 10)}
                                                className="w-full px-3 py-2 rounded-xl bg-surface border border-line text-xs font-mono font-bold text-rose-500"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Form Actions Footer */}
                        <div className="flex items-center justify-end gap-3 pt-3 border-t border-line">
                            <button
                                type="button"
                                onClick={() => changeTab('sessions')}
                                className="px-5 py-2.5 rounded-xl bg-surface-2 hover:bg-surface-3 text-xs font-bold text-fg cursor-pointer transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                disabled={!sessionName.trim()}
                                className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${
                                    sessionName.trim()
                                        ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/20 cursor-pointer'
                                        : 'bg-surface-3 text-fg-subtle cursor-not-allowed'
                                }`}
                            >
                                <span>
                                    {sessionName.trim() ? 'Criar Sessão e Abrir Replay →' : 'Informe o nome da sessão'}
                                </span>
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* =====================================================================
                LAYER 5: WHAT-IF OPTIMIZER & QUANT STRATEGY SIMULATOR
               ===================================================================== */}
            {activeTab === 'what_if' && (
                <div className="space-y-5">
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                setWhatIfSubMode('what_if');
                                setSimulationResult(null);
                            }}
                            className={`px-4 py-2 rounded-xl text-xs font-bold cursor-pointer ${
                                whatIfSubMode === 'what_if'
                                    ? 'bg-fg text-canvas'
                                    : 'bg-surface border border-line text-fg-muted hover:text-fg'
                            }`}
                        >
                            What-If: Histórico Real da Conta
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setWhatIfSubMode('strategy_lab');
                                setSimulationResult(null);
                            }}
                            className={`px-4 py-2 rounded-xl text-xs font-bold cursor-pointer ${
                                whatIfSubMode === 'strategy_lab'
                                    ? 'bg-fg text-canvas'
                                    : 'bg-surface border border-line text-fg-muted hover:text-fg'
                            }`}
                        >
                            Simulador Quantitativo de Estratégias
                        </button>
                        <button
                            type="button"
                            onClick={() => setWhatIfSubMode('saved_history')}
                            className={`px-4 py-2 rounded-xl text-xs font-bold cursor-pointer ${
                                whatIfSubMode === 'saved_history'
                                    ? 'bg-fg text-canvas'
                                    : 'bg-surface border border-line text-fg-muted hover:text-fg'
                            }`}
                        >
                            Histórico Salvo no Servidor
                        </button>
                    </div>

                    {whatIfSubMode === 'what_if' && (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <div className="lg:col-span-1 bg-surface/60 backdrop-blur-xl border border-line rounded-2xl p-6 space-y-6">
                                <div>
                                    <h3 className="text-base font-bold text-fg flex items-center gap-2 mb-1">
                                        <Sparkles size={18} className="text-accent-fg" />
                                        Hipóteses de Otimização
                                    </h3>
                                    <p className="text-xs text-fg-muted">
                                        Aplique novas regras sobre os trades reais de{' '}
                                        <strong>{selectedAccount?.name || 'Todas as Contas'}</strong>.
                                    </p>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-semibold text-fg/80 uppercase tracking-wider block">
                                        Relação Risco:Retorno Alvo
                                    </label>
                                    <div className="grid grid-cols-4 gap-2">
                                        {[1.5, 2.0, 2.5, 3.0].map((rr) => (
                                            <button
                                                key={rr}
                                                onClick={() => setWhatIfConfig((prev) => ({ ...prev, rrTarget: rr }))}
                                                className={`py-2 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                                                    whatIfConfig.rrTarget === rr
                                                        ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                                                        : 'bg-surface-2 border-line-strong text-fg/80 hover:bg-surface-3'
                                                }`}
                                            >
                                                1:{rr}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <div className="flex justify-between items-center text-xs">
                                        <label className="font-semibold text-fg/80 uppercase tracking-wider">
                                            Risco por Trade (% do Capital)
                                        </label>
                                        <span className="font-bold text-accent-fg">{whatIfConfig.riskPerTrade}%</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0.5"
                                        max="3.0"
                                        step="0.5"
                                        value={whatIfConfig.riskPerTrade}
                                        onChange={(e) =>
                                            setWhatIfConfig((prev) => ({
                                                ...prev,
                                                riskPerTrade: parseFloat(e.target.value),
                                            }))
                                        }
                                        className="w-full accent-emerald-500 bg-surface-2 h-1.5 rounded-lg appearance-none cursor-pointer"
                                    />
                                </div>

                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-fg/80 uppercase tracking-wider block">
                                        Saldo Inicial da Simulação ($)
                                    </label>
                                    <input
                                        type="number"
                                        value={whatIfConfig.initialBalance}
                                        onChange={(e) =>
                                            setWhatIfConfig((prev) => ({
                                                ...prev,
                                                initialBalance: parseFloat(e.target.value) || 0,
                                            }))
                                        }
                                        className="w-full bg-surface-2 border border-line-strong rounded-lg px-3 py-2 text-sm text-fg font-mono font-bold focus:outline-none focus:border-emerald-500"
                                    />
                                </div>

                                <div className="space-y-3 pt-3 border-t border-line">
                                    <label className="flex items-center gap-3 p-3 rounded-lg bg-surface-2/50 border border-line-strong cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={whatIfConfig.excludeAsian}
                                            onChange={(e) =>
                                                setWhatIfConfig((prev) => ({ ...prev, excludeAsian: e.target.checked }))
                                            }
                                            className="accent-emerald-500 rounded"
                                        />
                                        <div className="text-xs">
                                            <span className="font-semibold text-fg block">Eliminar Sessão Asiática</span>
                                        </div>
                                    </label>

                                    <label className="flex items-center gap-3 p-3 rounded-lg bg-surface-2/50 border border-line-strong cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={whatIfConfig.excludeFridays}
                                            onChange={(e) =>
                                                setWhatIfConfig((prev) => ({
                                                    ...prev,
                                                    excludeFridays: e.target.checked,
                                                }))
                                            }
                                            className="accent-emerald-500 rounded"
                                        />
                                        <div className="text-xs">
                                            <span className="font-semibold text-fg block">Eliminar Sextas-feiras</span>
                                        </div>
                                    </label>
                                </div>

                                <Button
                                    onClick={handleRunWhatIf}
                                    isLoading={running}
                                    variant="gradient"
                                    className="w-full py-3.5 font-bold shadow-lg shadow-emerald-500/20"
                                    icon={<Play size={16} />}
                                >
                                    Executar Simulação What-If
                                </Button>
                            </div>

                            <div className="lg:col-span-2 space-y-6">
                                {!simulationResult ? (
                                    <div className="bg-surface/40 border border-line rounded-2xl p-16 text-center space-y-3">
                                        <Sliders size={44} className="mx-auto text-slate-600" />
                                        <h3 className="text-lg font-bold text-fg">Pronto para simular</h3>
                                        <p className="text-fg-muted text-xs max-w-md mx-auto">
                                            Ajuste os parâmetros à esquerda e clique em{' '}
                                            <strong>"Executar Simulação What-If"</strong>.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                            <div className="bg-surface/70 border border-line rounded-xl p-4">
                                                <span className="text-xs text-fg-subtle uppercase font-semibold block mb-1">
                                                    Resultado Real
                                                </span>
                                                <div className="text-2xl font-black text-fg">
                                                    ${comparison?.realNetProfit?.toFixed(2)}
                                                </div>
                                            </div>
                                            <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-xl p-4">
                                                <span className="text-xs text-accent-fg uppercase font-semibold block mb-1">
                                                    Resultado com What-If
                                                </span>
                                                <div className="text-2xl font-black text-emerald-500">
                                                    ${comparison?.simulatedNetProfit?.toFixed(2)}
                                                </div>
                                            </div>
                                            <div className="bg-surface/70 border border-line rounded-xl p-4">
                                                <span className="text-xs text-fg-subtle uppercase font-semibold block mb-1">
                                                    Impacto da Otimização
                                                </span>
                                                <div className="text-2xl font-black text-emerald-500">
                                                    +${comparison?.profitDelta?.toFixed(2)}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex justify-end">
                                            <Button
                                                onClick={handleSaveWhatIfSession}
                                                isLoading={saving}
                                                variant="secondary"
                                                icon={
                                                    saveSuccess ? (
                                                        <CheckCircle2 size={14} className="text-accent-fg" />
                                                    ) : (
                                                        <Save size={14} />
                                                    )
                                                }
                                            >
                                                {saveSuccess ? 'Simulação Salva!' : 'Salvar Simulação'}
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {whatIfSubMode === 'strategy_lab' && (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <div className="lg:col-span-1 bg-surface/60 border border-line rounded-2xl p-6 space-y-5">
                                <h3 className="text-base font-bold text-fg flex items-center gap-2">
                                    <Activity size={18} className="text-indigo-400" />
                                    Parâmetros Quantitativos
                                </h3>
                                <div className="grid grid-cols-2 gap-2">
                                    {['MACD Cross', 'RSI Reversal', 'Trend Following', 'Breakout'].map((strat) => (
                                        <button
                                            key={strat}
                                            onClick={() => setStrategyConfig((prev) => ({ ...prev, strategy: strat }))}
                                            className={`py-2 text-xs font-bold rounded-lg border cursor-pointer ${
                                                strategyConfig.strategy === strat
                                                    ? 'bg-indigo-600 text-white border-indigo-500'
                                                    : 'bg-surface-2 border-line text-fg'
                                            }`}
                                        >
                                            {strat}
                                        </button>
                                    ))}
                                </div>
                                <Button
                                    onClick={handleRunStrategyLab}
                                    isLoading={running}
                                    variant="gradient"
                                    className="w-full py-3 font-bold"
                                    icon={<Play size={16} />}
                                >
                                    Simular Estratégia
                                </Button>
                            </div>
                            <div className="lg:col-span-2 bg-surface/40 border border-line rounded-2xl p-10 text-center">
                                {!simulationResult ? (
                                    <div className="space-y-2">
                                        <BarChart2 size={40} className="mx-auto text-slate-600" />
                                        <p className="text-xs text-fg-muted">
                                            Execute o simulador quantitativo para projetar curvas de capital.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-left">
                                        <div className="p-4 rounded-xl bg-surface border border-line">
                                            <span className="text-[11px] text-fg-muted block">Lucro Projetado</span>
                                            <span className="text-xl font-black text-emerald-500">
                                                ${comparison?.simulatedNetProfit?.toFixed(2)}
                                            </span>
                                        </div>
                                        <div className="p-4 rounded-xl bg-surface border border-line">
                                            <span className="text-[11px] text-fg-muted block">Win Rate</span>
                                            <span className="text-xl font-black text-fg">
                                                {comparison?.simulatedWinRate}%
                                            </span>
                                        </div>
                                        <div className="p-4 rounded-xl bg-surface border border-line">
                                            <span className="text-[11px] text-fg-muted block">Profit Factor</span>
                                            <span className="text-xl font-black text-fg">
                                                {comparison?.simulatedProfitFactor}
                                            </span>
                                        </div>
                                        <div className="p-4 rounded-xl bg-surface border border-line">
                                            <span className="text-[11px] text-fg-muted block">Max Drawdown</span>
                                            <span className="text-xl font-black text-rose-500">
                                                -{comparison?.simulatedMaxDrawdownPercent}%
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {whatIfSubMode === 'saved_history' && (
                        <div className="bg-surface border border-line rounded-2xl p-6 space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-bold text-fg flex items-center gap-2">
                                    <History size={16} className="text-purple-400" />
                                    Histórico de Simulações Salvas no Servidor
                                </h3>
                                <Button
                                    onClick={fetchSavedHistory}
                                    variant="secondary"
                                    icon={<RefreshCw size={13} className={loadingHistory ? 'animate-spin' : ''} />}
                                >
                                    Atualizar
                                </Button>
                            </div>
                            {savedSessionsBackend.length === 0 ? (
                                <p className="text-xs text-fg-muted py-8 text-center">
                                    Nenhuma simulação salva no servidor ainda.
                                </p>
                            ) : (
                                <div className="divide-y divide-line">
                                    {savedSessionsBackend.map((s) => (
                                        <div key={s.id} className="py-3 flex items-center justify-between text-xs">
                                            <div>
                                                <span className="font-bold text-fg">{s.name}</span>
                                                <span className="text-fg-muted ml-2">
                                                    ({s.strategy} · {s.symbol})
                                                </span>
                                            </div>
                                            <span className="font-mono font-bold text-emerald-500">
                                                ${s.results?.simulatedNetProfit ?? 0}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* =====================================================================
                MODAL: CREATE NEW STRATEGY
               ===================================================================== */}
            {newStrategyModalOpen && (
                <div
                    className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
                    onClick={() => setNewStrategyModalOpen(false)}
                >
                    <div
                        className="bg-surface border border-line rounded-3xl max-w-lg w-full p-6 space-y-5 shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-line pb-3">
                            <div>
                                <h3 className="text-lg font-black text-fg">Nova Estratégia de Backtest</h3>
                                <p className="text-xs text-fg-muted">
                                    Defina o capital base e os parâmetros de risco herdados pelas sessões.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setNewStrategyModalOpen(false)}
                                className="p-1.5 rounded-xl text-fg-muted hover:text-fg hover:bg-surface-2 cursor-pointer"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <form onSubmit={handleCreateStrategy} className="space-y-4">
                            <div>
                                <label className="text-xs font-bold text-fg block mb-1">Nome da Estratégia</label>
                                <input
                                    type="text"
                                    required
                                    value={newStratName}
                                    onChange={(e) => setNewStratName(e.target.value)}
                                    placeholder="Ex: ICT Silver Bullet / Asian Breakout"
                                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface-2 border border-line text-xs font-bold text-fg focus:outline-none focus:border-emerald-500"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-bold text-fg block mb-1">Sessão / Janela</label>
                                    <input
                                        type="text"
                                        value={newStratSessionTag}
                                        onChange={(e) => setNewStratSessionTag(e.target.value)}
                                        placeholder="Asian, London, NY..."
                                        className="w-full px-3.5 py-2 rounded-xl bg-surface-2 border border-line text-xs text-fg"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-fg block mb-1">Ativo Principal</label>
                                    <select
                                        value={newStratPrimarySymbol}
                                        onChange={(e) => setNewStratPrimarySymbol(e.target.value)}
                                        className="w-full px-3.5 py-2 rounded-xl bg-surface-2 border border-line text-xs font-bold text-fg"
                                    >
                                        {ALL_BACKTEST_SYMBOLS.map((s) => (
                                            <option key={s.ticker} value={s.ticker}>
                                                {s.ticker}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="text-xs font-bold text-fg block mb-1">Capital Inicial ($)</label>
                                    <input
                                        type="number"
                                        value={newStratCapital}
                                        onChange={(e) => setNewStratCapital(Number(e.target.value) || 100000)}
                                        className="w-full px-3 py-2 rounded-xl bg-surface-2 border border-line text-xs font-mono font-bold text-fg"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-fg block mb-1">Risco Fixo (%)</label>
                                    <input
                                        type="number"
                                        step="0.25"
                                        value={newStratRisk}
                                        onChange={(e) => setNewStratRisk(Number(e.target.value) || 1)}
                                        className="w-full px-3 py-2 rounded-xl bg-surface-2 border border-line text-xs font-mono font-bold text-fg"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-fg block mb-1">Alvo (R:R)</label>
                                    <input
                                        type="number"
                                        step="0.5"
                                        value={newStratRr}
                                        onChange={(e) => setNewStratRr(Number(e.target.value) || 2)}
                                        className="w-full px-3 py-2 rounded-xl bg-surface-2 border border-line text-xs font-mono font-bold text-fg"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="text-xs font-bold text-fg block mb-1">Descrição / Conceito</label>
                                <input
                                    type="text"
                                    value={newStratDesc}
                                    onChange={(e) => setNewStratDesc(e.target.value)}
                                    placeholder="Resumo das confluências da estratégia..."
                                    className="w-full px-3.5 py-2 rounded-xl bg-surface-2 border border-line text-xs text-fg"
                                />
                            </div>

                            <div className="flex justify-end gap-2 pt-3 border-t border-line">
                                <button
                                    type="button"
                                    onClick={() => setNewStrategyModalOpen(false)}
                                    className="px-4 py-2 rounded-xl bg-surface-2 text-xs font-bold text-fg cursor-pointer"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black cursor-pointer"
                                >
                                    Salvar Estratégia
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
