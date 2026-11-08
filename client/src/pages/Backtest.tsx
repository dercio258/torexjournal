import { useState, useEffect } from 'react';
import { 
    FlaskConical, Play, Save, History, Activity, TrendingUp,
    Briefcase, RefreshCw, CheckCircle2, Sliders, BarChart2, Sparkles
} from 'lucide-react';
import { useAccount } from '../context/AccountContext';
import { Button } from '../components/ui/Button';
import api from '../api';

export const Backtest = () => {
    const { selectedAccountId, selectedAccount, accounts, isConsolidated, selectAccount } = useAccount();

    const [activeTab, setActiveTab] = useState<'what_if' | 'strategy_lab' | 'saved_history'>('what_if');
    const [running, setRunning] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);

    // Mode A: What-If Settings
    const [whatIfConfig, setWhatIfConfig] = useState({
        initialBalance: selectedAccount?.initialBalance || selectedAccount?.balance || 10000,
        riskPerTrade: 1.0,
        rrTarget: 2.0,
        excludeAsian: false,
        excludeFridays: false,
    });

    // Mode B: Strategy Lab Settings
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
        rsiPeriod: 14
    });

    // Results state
    const [simulationResult, setSimulationResult] = useState<any>(null);
    const [savedSessions, setSavedSessions] = useState<any[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);

    // Update initial balance when active account changes
    useEffect(() => {
        const bal = selectedAccount?.initialBalance || selectedAccount?.balance || 10000;
        setWhatIfConfig(prev => ({ ...prev, initialBalance: bal }));
        setStrategyConfig(prev => ({ ...prev, initialBalance: bal }));
    }, [selectedAccount]);

    // Load saved history when switching to that tab or account changes
    useEffect(() => {
        if (activeTab === 'saved_history') {
            fetchSavedHistory();
        }
    }, [activeTab, selectedAccountId]);

    const fetchSavedHistory = async () => {
        try {
            setLoadingHistory(true);
            const params: any = {};
            if (selectedAccountId && selectedAccountId !== 'all') {
                params.accountId = selectedAccountId;
            }
            const res = await api.get('/dashboard/backtest/history', { params });
            if (res.data) setSavedSessions(res.data);
        } catch (error) {
            console.error('Erro ao carregar histórico de backtest:', error);
        } finally {
            setLoadingHistory(false);
        }
    };

    const handleRunWhatIf = async () => {
        try {
            setRunning(true);
            setSaveSuccess(false);
            const payload = {
                mode: 'ACCOUNT_HISTORY',
                accountId: selectedAccountId !== 'all' ? selectedAccountId : selectedAccount?.id,
                ...whatIfConfig
            };

            const res = await api.post('/dashboard/backtest/simulate', payload, {
                params: { accountId: selectedAccountId !== 'all' ? selectedAccountId : undefined }
            });

            if (res.data) {
                setSimulationResult(res.data);
            }
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
                ...strategyConfig
            };

            const res = await api.post('/dashboard/backtest/simulate', payload, {
                params: { accountId: selectedAccountId !== 'all' ? selectedAccountId : undefined }
            });

            if (res.data) {
                setSimulationResult(res.data);
            }
        } catch (error) {
            console.error('Falha ao simular estratégia:', error);
        } finally {
            setRunning(false);
        }
    };

    const handleSaveSession = async () => {
        if (!simulationResult) return;
        try {
            setSaving(true);
            const payload = {
                name: activeTab === 'what_if' 
                    ? `What-If R:R 1:${whatIfConfig.rrTarget} (${selectedAccount?.name || 'Conta'})`
                    : `${strategyConfig.strategy} ${strategyConfig.symbol} (${selectedAccount?.name || 'Conta'})`,
                mode: simulationResult.mode,
                strategy: activeTab === 'what_if' ? 'What-If Historical Optimization' : strategyConfig.strategy,
                symbol: activeTab === 'what_if' ? 'ALL' : strategyConfig.symbol,
                config: activeTab === 'what_if' ? whatIfConfig : strategyConfig,
                results: simulationResult.comparison,
                notes: simulationResult.insights?.join(' ') || ''
            };

            await api.post('/dashboard/backtest/save', payload, {
                params: { accountId: selectedAccountId !== 'all' ? selectedAccountId : undefined }
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

    return (
        <div className="space-y-6 max-w-[1600px] mx-auto pb-12">
            {/* Header Bar */}
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-line pb-5">
                <div>
                    <h1 className="text-2xl md:text-3xl font-black text-fg flex items-center gap-2.5 tracking-tight">
                        <FlaskConical className="text-accent-fg" size={28} />
                        Laboratório de Backtesting
                    </h1>
                    <p className="text-fg-muted text-sm mt-0.5">
                        Simule hipóteses sobre o histórico real da conta ou teste estratégias quantitativas.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    {/* Account Selector Toolbar */}
                    <div className="flex items-center gap-2 bg-surface/70 border border-line p-1.5 rounded-xl shadow-lg shadow-black/20">
                        <div className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-fg/80">
                            <Briefcase size={14} className="text-indigo-400" />
                            <span>Conta:</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => selectAccount('all')}
                                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                                    isConsolidated
                                        ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30'
                                        : 'text-fg-muted hover:text-fg hover:bg-surface-2/60'
                                }`}
                            >
                                Todas
                            </button>
                            {accounts.map((acc) => (
                                <button
                                    key={acc.id}
                                    onClick={() => selectAccount(acc.id)}
                                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                                        selectedAccountId === acc.id
                                            ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30'
                                            : 'text-fg-muted hover:text-fg hover:bg-surface-2/60'
                                    }`}
                                >
                                    <span>{acc.name}</span>
                                    <span className={`text-[9px] px-1 py-0.2 rounded font-mono uppercase ${
                                        String(acc.type).toUpperCase() === 'LIVE' ? 'bg-rose-500/20 text-rose-300' : 'bg-blue-500/20 text-blue-300'
                                    }`}>
                                        {acc.type}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </header>

            {/* Mode Navigation Tabs */}
            <div className="flex items-center gap-2 border-b border-line">
                <button
                    onClick={() => { setActiveTab('what_if'); setSimulationResult(null); }}
                    className={`flex items-center gap-2 px-5 py-3 text-sm font-bold border-b-2 transition-all cursor-pointer ${
                        activeTab === 'what_if'
                            ? 'border-emerald-500 text-accent-fg'
                            : 'border-transparent text-fg-muted hover:text-fg'
                    }`}
                >
                    <Sliders size={16} />
                    What-If: Histórico Real da Conta
                </button>
                <button
                    onClick={() => { setActiveTab('strategy_lab'); setSimulationResult(null); }}
                    className={`flex items-center gap-2 px-5 py-3 text-sm font-bold border-b-2 transition-all cursor-pointer ${
                        activeTab === 'strategy_lab'
                            ? 'border-emerald-500 text-accent-fg'
                            : 'border-transparent text-fg-muted hover:text-fg'
                    }`}
                >
                    <BarChart2 size={16} />
                    Laboratório de Estratégias
                </button>
                <button
                    onClick={() => setActiveTab('saved_history')}
                    className={`flex items-center gap-2 px-5 py-3 text-sm font-bold border-b-2 transition-all cursor-pointer ${
                        activeTab === 'saved_history'
                            ? 'border-emerald-500 text-accent-fg'
                            : 'border-transparent text-fg-muted hover:text-fg'
                    }`}
                >
                    <History size={16} />
                    Simulações Salvas
                </button>
            </div>

            {/* TAB 1: WHAT-IF HISTORICAL SIMULATION */}
            {activeTab === 'what_if' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Controls Column */}
                    <div className="lg:col-span-1 bg-surface/60 backdrop-blur-xl border border-line rounded-2xl p-6 space-y-6">
                        <div>
                            <h3 className="text-base font-bold text-fg flex items-center gap-2 mb-1">
                                <Sparkles size={18} className="text-accent-fg" />
                                Hipóteses de Otimização
                            </h3>
                            <p className="text-xs text-fg-muted">
                                Aplique novas regras sobre os trades reais de <strong>{selectedAccount?.name || 'Todas as Contas'}</strong>.
                            </p>
                        </div>

                        {/* Parameter: R:R Target */}
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-fg/80 uppercase tracking-wider block">
                                Relação Risco:Retorno Alvo
                            </label>
                            <div className="grid grid-cols-4 gap-2">
                                {[1.5, 2.0, 2.5, 3.0].map(rr => (
                                    <button
                                        key={rr}
                                        onClick={() => setWhatIfConfig(prev => ({ ...prev, rrTarget: rr }))}
                                        className={`py-2 text-xs font-bold rounded-lg border transition-all ${
                                            whatIfConfig.rrTarget === rr
                                                ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                                                : 'bg-surface-2 border-line-strong text-fg/80 hover:bg-surface-3'
                                        }`}
                                    >
                                        1:{rr}
                                    </button>
                                ))}
                            </div>
                            <span className="text-[10px] text-fg-subtle block">
                                Limita perdas a 1R e expande os trades vencedores para {whatIfConfig.rrTarget}R.
                            </span>
                        </div>

                        {/* Parameter: Fixed Risk Per Trade */}
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
                                onChange={(e) => setWhatIfConfig(prev => ({ ...prev, riskPerTrade: parseFloat(e.target.value) }))}
                                className="w-full accent-emerald-500 bg-surface-2 h-1.5 rounded-lg appearance-none cursor-pointer"
                            />
                            <div className="flex justify-between text-[10px] text-fg-subtle">
                                <span>0.5% (Conservador)</span>
                                <span>3.0% (Agressivo)</span>
                            </div>
                        </div>

                        {/* Parameter: Initial Balance */}
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-fg/80 uppercase tracking-wider block">
                                Saldo Inicial da Simulação ($)
                            </label>
                            <input
                                type="number"
                                value={whatIfConfig.initialBalance}
                                onChange={(e) => setWhatIfConfig(prev => ({ ...prev, initialBalance: parseFloat(e.target.value) || 0 }))}
                                className="w-full bg-surface-2 border border-line-strong rounded-lg px-3 py-2 text-sm text-fg font-mono font-bold focus:outline-none focus:border-emerald-500"
                            />
                        </div>

                        {/* Behavioral / Session Filters */}
                        <div className="space-y-3 pt-3 border-t border-line">
                            <h4 className="text-xs font-bold text-fg-muted uppercase tracking-wider">Filtros de Disciplina</h4>

                            <label className="flex items-center gap-3 p-3 rounded-lg bg-surface-2/50 border border-line-strong cursor-pointer hover:bg-surface-2 transition-colors">
                                <input
                                    type="checkbox"
                                    checked={whatIfConfig.excludeAsian}
                                    onChange={(e) => setWhatIfConfig(prev => ({ ...prev, excludeAsian: e.target.checked }))}
                                    className="accent-emerald-500 rounded"
                                />
                                <div className="text-xs">
                                    <span className="font-semibold text-fg block">Eliminar Sessão Asiática</span>
                                    <span className="text-fg-subtle text-[11px]">Evita operações no pregão asiático de baixa volatilidade.</span>
                                </div>
                            </label>

                            <label className="flex items-center gap-3 p-3 rounded-lg bg-surface-2/50 border border-line-strong cursor-pointer hover:bg-surface-2 transition-colors">
                                <input
                                    type="checkbox"
                                    checked={whatIfConfig.excludeFridays}
                                    onChange={(e) => setWhatIfConfig(prev => ({ ...prev, excludeFridays: e.target.checked }))}
                                    className="accent-emerald-500 rounded"
                                />
                                <div className="text-xs">
                                    <span className="font-semibold text-fg block">Eliminar Sextas-feiras</span>
                                    <span className="text-fg-subtle text-[11px]">Protege contra spreads altos e gaps de fim de semana.</span>
                                </div>
                            </label>
                        </div>

                        {/* Execute Button */}
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

                    {/* Results Column */}
                    <div className="lg:col-span-2 space-y-6">
                        {!simulationResult ? (
                            <div className="bg-surface/40 border border-line rounded-2xl p-16 text-center space-y-3">
                                <Sliders size={44} className="mx-auto text-slate-600" />
                                <h3 className="text-lg font-bold text-fg">Pronto para simular</h3>
                                <p className="text-fg-muted text-xs max-w-md mx-auto">
                                    Ajuste os parâmetros à esquerda e clique em <strong>"Executar Simulação What-If"</strong> para comparar o resultado real da conta com as regras testadas.
                                </p>
                            </div>
                        ) : (
                            <>
                                {/* Comparison Header Cards */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    {/* Real Result */}
                                    <div className="bg-surface/70 border border-line rounded-xl p-4">
                                        <span className="text-xs text-fg-subtle uppercase font-semibold block mb-1">Resultado Real da Conta</span>
                                        <div className={`text-2xl font-black ${comparison?.realNetProfit >= 0 ? 'text-accent-fg' : 'text-danger-fg'}`}>
                                            {comparison?.realNetProfit >= 0 ? '+' : ''}${comparison?.realNetProfit?.toFixed(2)}
                                        </div>
                                        <span className="text-[11px] text-fg-muted block mt-1">
                                            {comparison?.realTrades} trades executados
                                        </span>
                                    </div>

                                    {/* Simulated Result */}
                                    <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-xl p-4">
                                        <span className="text-xs text-accent-fg uppercase font-semibold block mb-1">Resultado com What-If</span>
                                        <div className={`text-2xl font-black ${comparison?.simulatedNetProfit >= 0 ? 'text-accent-fg' : 'text-danger-fg'}`}>
                                            {comparison?.simulatedNetProfit >= 0 ? '+' : ''}${comparison?.simulatedNetProfit?.toFixed(2)}
                                        </div>
                                        <span className="text-[11px] text-fg/80 block mt-1">
                                            Saldo Final: ${comparison?.finalBalance?.toFixed(2)}
                                        </span>
                                    </div>

                                    {/* Delta / Improvement */}
                                    <div className="bg-surface/70 border border-line rounded-xl p-4">
                                        <span className="text-xs text-fg-subtle uppercase font-semibold block mb-1">Impacto da Otimização</span>
                                        <div className={`text-2xl font-black ${comparison?.profitDelta >= 0 ? 'text-accent-fg' : 'text-danger-fg'}`}>
                                            {comparison?.profitDelta >= 0 ? '+' : ''}${comparison?.profitDelta?.toFixed(2)}
                                        </div>
                                        <span className="text-[11px] text-fg-muted block mt-1">
                                            Win Rate: {comparison?.simulatedWinRate}% • PF: {comparison?.simulatedProfitFactor}
                                        </span>
                                    </div>
                                </div>

                                {/* Equity Curves Comparison */}
                                <div className="bg-surface/60 backdrop-blur-xl border border-line rounded-2xl p-5">
                                    <div className="flex justify-between items-center mb-4">
                                        <div>
                                            <h3 className="text-sm font-bold text-fg flex items-center gap-2">
                                                <TrendingUp size={16} className="text-accent-fg" />
                                                Comparativo de Curva de Capital (Real vs Simulado)
                                            </h3>
                                            <p className="text-[11px] text-fg-subtle">
                                                Linha verde: simulação What-If • Linha roxa: patrimônio real da conta
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                onClick={handleSaveSession}
                                                isLoading={saving}
                                                variant="secondary"
                                                icon={saveSuccess ? <CheckCircle2 size={14} className="text-accent-fg" /> : <Save size={14} />}
                                                className="bg-surface-2 hover:bg-surface-3 text-fg border border-line-strong text-xs font-semibold py-2 px-3"
                                            >
                                                {saveSuccess ? 'Simulação Salva!' : 'Salvar Simulação'}
                                            </Button>
                                        </div>
                                    </div>

                                    {/* SVG Chart Comparison */}
                                    <div className="h-56 w-full relative flex items-end gap-1 pb-2">
                                        {simulationResult.equityCurve?.map((pt: any, idx: number) => {
                                            const allVals = simulationResult.equityCurve.flatMap((p: any) => [p.realEquity, p.simulatedEquity]);
                                            const min = Math.min(...allVals);
                                            const max = Math.max(...allVals);
                                            const range = Math.max(max - min, 1);

                                            const simHeight = Math.max(8, ((pt.simulatedEquity - min) / range) * 90);
                                            const realHeight = Math.max(8, ((pt.realEquity - min) / range) * 90);

                                            return (
                                                <div key={idx} className="flex-1 flex items-end justify-center gap-0.5 h-full group relative">
                                                    {/* Real Bar */}
                                                    <div 
                                                        style={{ height: `${realHeight}%` }} 
                                                        className="w-1/2 bg-indigo-500/50 group-hover:bg-indigo-400 rounded-t-xs transition-all" 
                                                    />
                                                    {/* Simulated Bar */}
                                                    <div 
                                                        style={{ height: `${simHeight}%` }} 
                                                        className="w-1/2 bg-emerald-500/70 group-hover:bg-emerald-400 rounded-t-xs transition-all" 
                                                    />

                                                    {/* Tooltip */}
                                                    <div className="absolute bottom-full mb-2 hidden group-hover:flex flex-col bg-surface border border-line-strong text-[10px] p-2 rounded shadow-2xl z-20 whitespace-nowrap pointer-events-none">
                                                        <span className="font-bold text-fg">{pt.date}</span>
                                                        <span className="text-accent-fg font-mono">Simulado: ${pt.simulatedEquity}</span>
                                                        <span className="text-indigo-300 font-mono">Real: ${pt.realEquity}</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div className="flex justify-between text-[10px] text-fg-subtle mt-2 border-t border-line pt-2">
                                        <span>Primeiro trade</span>
                                        <span>Evolução sequencial</span>
                                        <span>Último trade</span>
                                    </div>
                                </div>

                                {/* AI Insights */}
                                {simulationResult.insights?.length > 0 && (
                                    <div className="bg-surface/60 border border-line rounded-xl p-4">
                                        <h4 className="text-xs font-bold text-fg/80 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                            <Sparkles size={14} className="text-yellow-400" />
                                            Diagnóstico da Simulação
                                        </h4>
                                        <ul className="space-y-1.5 text-xs text-fg-muted">
                                            {simulationResult.insights.map((ins: string, idx: number) => (
                                                <li key={idx} className="flex items-start gap-2">
                                                    <span className="text-accent-fg">•</span>
                                                    <span>{ins}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* TAB 2: STRATEGY LAB */}
            {activeTab === 'strategy_lab' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Strategy Config */}
                    <div className="lg:col-span-1 bg-surface/60 backdrop-blur-xl border border-line rounded-2xl p-6 space-y-6">
                        <div>
                            <h3 className="text-base font-bold text-fg flex items-center gap-2 mb-1">
                                <Activity size={18} className="text-indigo-400" />
                                Parâmetros da Estratégia
                            </h3>
                            <p className="text-xs text-fg-muted">
                                Simule modelos técnicos com as especificações da sua conta de trading.
                            </p>
                        </div>

                        {/* Strategy Select */}
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-fg/80 uppercase tracking-wider block">
                                Estratégia
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                                {['MACD Cross', 'RSI Reversal', 'Trend Following', 'Breakout'].map(strat => (
                                    <button
                                        key={strat}
                                        onClick={() => setStrategyConfig(prev => ({ ...prev, strategy: strat }))}
                                        className={`py-2 text-xs font-bold rounded-lg border transition-all ${
                                            strategyConfig.strategy === strat
                                                ? 'bg-indigo-600 text-white border-indigo-500'
                                                : 'bg-surface-2 border-line-strong text-fg/80 hover:bg-surface-3'
                                        }`}
                                    >
                                        {strat}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Asset Select */}
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-fg/80 uppercase tracking-wider block">
                                Ativo / Símbolo
                            </label>
                            <select
                                value={strategyConfig.symbol}
                                onChange={(e) => setStrategyConfig(prev => ({ ...prev, symbol: e.target.value }))}
                                className="w-full bg-surface-2 border border-line-strong rounded-lg px-3 py-2 text-xs text-fg font-bold focus:outline-none focus:border-indigo-500"
                            >
                                {['EURUSD', 'GBPUSD', 'XAUUSD', 'BTCUSD', 'US30', 'NAS100', 'USDJPY'].map(s => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                        </div>

                        {/* Target R:R & Target WinRate */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-fg-muted block">R:R Alvo</label>
                                <input
                                    type="number"
                                    step="0.5"
                                    value={strategyConfig.rrTarget}
                                    onChange={(e) => setStrategyConfig(prev => ({ ...prev, rrTarget: parseFloat(e.target.value) || 2 }))}
                                    className="w-full bg-surface-2 border border-line-strong rounded-lg p-2 text-xs text-fg font-bold font-mono"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-fg-muted block">Win Rate Alvo (%)</label>
                                <input
                                    type="number"
                                    value={strategyConfig.targetWinRate}
                                    onChange={(e) => setStrategyConfig(prev => ({ ...prev, targetWinRate: parseInt(e.target.value) || 50 }))}
                                    className="w-full bg-surface-2 border border-line-strong rounded-lg p-2 text-xs text-fg font-bold font-mono"
                                />
                            </div>
                        </div>

                        {/* Trades Count & Risk */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-fg-muted block">Trades a Simular</label>
                                <input
                                    type="number"
                                    value={strategyConfig.totalTrades}
                                    onChange={(e) => setStrategyConfig(prev => ({ ...prev, totalTrades: parseInt(e.target.value) || 30 }))}
                                    className="w-full bg-surface-2 border border-line-strong rounded-lg p-2 text-xs text-fg font-bold font-mono"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-fg-muted block">Risco (%)</label>
                                <input
                                    type="number"
                                    step="0.5"
                                    value={strategyConfig.riskPerTrade}
                                    onChange={(e) => setStrategyConfig(prev => ({ ...prev, riskPerTrade: parseFloat(e.target.value) || 1 }))}
                                    className="w-full bg-surface-2 border border-line-strong rounded-lg p-2 text-xs text-fg font-bold font-mono"
                                />
                            </div>
                        </div>

                        {/* Execute Button */}
                        <Button
                            onClick={handleRunStrategyLab}
                            isLoading={running}
                            variant="gradient"
                            className="w-full py-3.5 font-bold shadow-lg shadow-indigo-500/20"
                            icon={<Play size={16} />}
                        >
                            Simular Estratégia
                        </Button>
                    </div>

                    {/* Results Column */}
                    <div className="lg:col-span-2 space-y-6">
                        {!simulationResult ? (
                            <div className="bg-surface/40 border border-line rounded-2xl p-16 text-center space-y-3">
                                <BarChart2 size={44} className="mx-auto text-slate-600" />
                                <h3 className="text-lg font-bold text-fg">Simulador Pronto</h3>
                                <p className="text-fg-muted text-xs max-w-md mx-auto">
                                    Escolha a estratégia técnica e clique em <strong>"Simular Estratégia"</strong> para gerar curvas de patrimônio e métricas probabilísticas.
                                </p>
                            </div>
                        ) : (
                            <>
                                {/* KPIs Cards */}
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                    <div className="bg-surface/70 border border-line rounded-xl p-4">
                                        <span className="text-xs text-fg-subtle uppercase font-semibold block mb-1">Lucro Projetado</span>
                                        <span className={`text-2xl font-black ${comparison?.simulatedNetProfit >= 0 ? 'text-accent-fg' : 'text-danger-fg'}`}>
                                            {comparison?.simulatedNetProfit >= 0 ? '+' : ''}${comparison?.simulatedNetProfit?.toFixed(2)}
                                        </span>
                                    </div>
                                    <div className="bg-surface/70 border border-line rounded-xl p-4">
                                        <span className="text-xs text-fg-subtle uppercase font-semibold block mb-1">Taxa de Acerto</span>
                                        <span className="text-2xl font-black text-fg">
                                            {comparison?.simulatedWinRate}%
                                        </span>
                                    </div>
                                    <div className="bg-surface/70 border border-line rounded-xl p-4">
                                        <span className="text-xs text-fg-subtle uppercase font-semibold block mb-1">Fator de Lucro</span>
                                        <span className="text-2xl font-black text-fg">
                                            {comparison?.simulatedProfitFactor}
                                        </span>
                                    </div>
                                    <div className="bg-surface/70 border border-line rounded-xl p-4">
                                        <span className="text-xs text-fg-subtle uppercase font-semibold block mb-1">Max Drawdown</span>
                                        <span className="text-2xl font-black text-danger-fg">
                                            -{comparison?.simulatedMaxDrawdownPercent}%
                                        </span>
                                    </div>
                                </div>

                                {/* Equity Curve */}
                                <div className="bg-surface/60 backdrop-blur-xl border border-line rounded-2xl p-5">
                                    <div className="flex justify-between items-center mb-4">
                                        <h3 className="text-sm font-bold text-fg flex items-center gap-2">
                                            <TrendingUp size={16} className="text-indigo-400" />
                                            Projeção de Patrimônio da Estratégia
                                        </h3>
                                        <Button
                                            onClick={handleSaveSession}
                                            isLoading={saving}
                                            variant="secondary"
                                            icon={saveSuccess ? <CheckCircle2 size={14} className="text-accent-fg" /> : <Save size={14} />}
                                            className="bg-surface-2 hover:bg-surface-3 text-fg border border-line-strong text-xs font-semibold py-2 px-3"
                                        >
                                            {saveSuccess ? 'Salva!' : 'Salvar Simulação'}
                                        </Button>
                                    </div>

                                    <div className="h-52 w-full relative flex items-end gap-1 pb-2">
                                        {simulationResult.equityCurve?.map((pt: any, idx: number) => {
                                            const allVals = simulationResult.equityCurve.map((p: any) => p.equity);
                                            const min = Math.min(...allVals);
                                            const max = Math.max(...allVals);
                                            const range = Math.max(max - min, 1);
                                            const height = Math.max(10, ((pt.equity - min) / range) * 90);

                                            return (
                                                <div key={idx} className="flex-1 flex items-end justify-center h-full group relative">
                                                    <div 
                                                        style={{ height: `${height}%` }} 
                                                        className="w-full bg-indigo-500/70 group-hover:bg-indigo-400 rounded-t-xs transition-all" 
                                                    />
                                                    <div className="absolute bottom-full mb-2 hidden group-hover:flex flex-col bg-surface border border-line-strong text-[10px] p-2 rounded shadow-2xl z-20 whitespace-nowrap pointer-events-none">
                                                        <span className="font-bold text-fg">Trade #{pt.trade}</span>
                                                        <span className="text-indigo-300 font-mono">Saldo: ${pt.equity}</span>
                                                        <span className={pt.pnl >= 0 ? 'text-accent-fg' : 'text-danger-fg'}>
                                                            PnL: {pt.pnl >= 0 ? '+' : ''}${pt.pnl}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Insights */}
                                {simulationResult.insights?.length > 0 && (
                                    <div className="bg-surface/60 border border-line rounded-xl p-4">
                                        <h4 className="text-xs font-bold text-fg/80 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                            <Sparkles size={14} className="text-indigo-400" />
                                            Relatório da Estratégia
                                        </h4>
                                        <ul className="space-y-1.5 text-xs text-fg-muted">
                                            {simulationResult.insights.map((ins: string, idx: number) => (
                                                <li key={idx} className="flex items-start gap-2">
                                                    <span className="text-indigo-400">•</span>
                                                    <span>{ins}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* TAB 3: SAVED HISTORY */}
            {activeTab === 'saved_history' && (
                <div className="bg-surface/60 backdrop-blur-xl border border-line rounded-2xl p-6">
                    <div className="flex justify-between items-center mb-6">
                        <div>
                            <h3 className="text-base font-bold text-fg flex items-center gap-2">
                                <History size={18} className="text-purple-400" />
                                Histórico de Simulações de Backtest
                            </h3>
                            <p className="text-xs text-fg-muted">
                                Simulações registradas para <strong>{selectedAccount?.name || 'Todas as Contas'}</strong>.
                            </p>
                        </div>
                        <Button
                            onClick={fetchSavedHistory}
                            variant="secondary"
                            icon={<RefreshCw size={13} className={loadingHistory ? 'animate-spin' : ''} />}
                            className="bg-surface-2 hover:bg-surface-3 text-fg/80 border border-line-strong text-xs py-2 px-3"
                        >
                            Atualizar
                        </Button>
                    </div>

                    {loadingHistory ? (
                        <div className="py-16 text-center text-fg-subtle text-xs">Carregando histórico...</div>
                    ) : savedSessions.length === 0 ? (
                        <div className="py-16 text-center space-y-2">
                            <FlaskConical size={36} className="mx-auto text-slate-600" />
                            <h4 className="text-sm font-bold text-fg/80">Nenhuma simulação salva</h4>
                            <p className="text-xs text-fg-subtle">
                                Execute uma simulação nas abas anteriores e clique em "Salvar Simulação" para catalogar seus testes.
                            </p>
                        </div>
                    ) : (
                        <div className="divide-y divide-line">
                            {savedSessions.map((session) => (
                                <div key={session.id} className="py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 hover:bg-surface-2/20 px-3 rounded-xl transition-colors">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h4 className="text-sm font-bold text-fg">{session.name}</h4>
                                            <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 font-bold uppercase">
                                                {session.mode}
                                            </span>
                                            {session.account?.name && (
                                                <span className="text-[10px] px-2 py-0.5 rounded bg-surface-2 text-fg-muted border border-line-strong">
                                                    {session.account.name}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-fg-muted mt-1">
                                            Estratégia: <span className="text-fg/80 font-medium">{session.strategy}</span> • Ativo: <span className="text-fg/80 font-medium">{session.symbol}</span> • Criado em: {new Date(session.createdAt).toLocaleDateString('pt-BR')}
                                        </p>
                                    </div>

                                    <div className="flex items-center gap-4 text-xs font-mono">
                                        {session.results?.simulatedNetProfit !== undefined && (
                                            <div>
                                                <span className="text-[10px] text-fg-subtle block uppercase font-sans">Lucro Simulado</span>
                                                <span className={`font-bold ${session.results.simulatedNetProfit >= 0 ? 'text-accent-fg' : 'text-danger-fg'}`}>
                                                    {session.results.simulatedNetProfit >= 0 ? '+' : ''}${session.results.simulatedNetProfit}
                                                </span>
                                            </div>
                                        )}
                                        {session.results?.simulatedWinRate !== undefined && (
                                            <div>
                                                <span className="text-[10px] text-fg-subtle block uppercase font-sans">Win Rate</span>
                                                <span className="text-fg font-bold">
                                                    {session.results.simulatedWinRate}%
                                                </span>
                                            </div>
                                        )}
                                        {session.results?.simulatedProfitFactor !== undefined && (
                                            <div>
                                                <span className="text-[10px] text-fg-subtle block uppercase font-sans">Profit Factor</span>
                                                <span className="text-indigo-300 font-bold">
                                                    {session.results.simulatedProfitFactor}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
