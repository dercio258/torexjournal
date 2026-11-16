import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Lock, Check, Plus, ChevronRight, Play, Trash2, Settings2, ListChecks, FolderKanban } from 'lucide-react';
import {
    AccountCurrencyCode,
    ALL_BACKTEST_SYMBOLS,
    BacktestReplaySession,
    BacktestStrategy,
    BacktestStrategyRule,
    generateUuid,
} from '../../services/backtestWorkspaceStore';
import { ConfirmDeleteButton, fmtMoney, inputCls, SubTabs } from './primitives';
import { sessionStats } from './metrics';
import { Button } from '../ui/Button';
import { cn } from '../../lib/cn';
import { useLocale } from '../../context/LocaleContext';

interface StrategyFormModalProps {
    initial?: BacktestStrategy | null;
    sessions?: BacktestReplaySession[];
    canDelete?: boolean;
    onDelete?: () => void;
    onClose: () => void;
    onSave: (payload: Partial<BacktestStrategy>) => void;
}

const TRADING_METHODS = [
    { value: 'Smart Money Concepts (SMC / ICT)', en: 'Smart Money Concepts (SMC / ICT)' },
    { value: 'Price Action Institucional', en: 'Institutional Price Action' },
    { value: 'Wyckoff & Liquidez', en: 'Wyckoff & Liquidity Sweep' },
    { value: 'Breakout & Momentum', en: 'Breakout & Momentum' },
    { value: 'Scalping de Fluxo (Order Flow)', en: 'Order Flow Scalping' },
    { value: 'Mean Reversion (Retorno à Média)', en: 'Mean Reversion' },
    { value: 'Trend Following (Seguidor de Tendência)', en: 'Trend Following' },
    { value: 'Supply & Demand (Oferta e Demanda)', en: 'Supply & Demand Zones' },
    { value: 'Outro Método Personalizado', en: 'Custom Methodology' },
];

const CURRENCIES: AccountCurrencyCode[] = ['USD', 'EUR', 'GBP', 'MZN'];
const CAPITAL_PRESETS = [5000, 10000, 25000, 50000, 100000, 200000];
const FEATURED_DEFAULT_SYMBOLS = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'NZDUSD', 'NAS100', 'US30', 'BTCUSD'];
const INITIAL_TIMEFRAMES = [
    { value: '1m', label: '1 minuto', labelEn: '1 minute' },
    { value: '5m', label: '5 minutos', labelEn: '5 minutes' },
    { value: '15m', label: '15 minutos', labelEn: '15 minutes' },
    { value: '30m', label: '30 minutos', labelEn: '30 minutes' },
    { value: '1h', label: '1 hora', labelEn: '1 hour' },
    { value: '4h', label: '4 horas', labelEn: '4 hours' },
    { value: 'D', label: 'Diário (1D)', labelEn: 'Daily (1D)' },
];

type SettingsTab = 'general' | 'rules' | 'sessions';

export const StrategyFormModal: React.FC<StrategyFormModalProps> = ({
    initial,
    sessions = [],
    canDelete = false,
    onDelete,
    onClose,
    onSave,
}) => {
    const navigate = useNavigate();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const isEditing = Boolean(initial);
    const [tab, setTab] = useState<SettingsTab>('general');

    const [name, setName] = useState(initial?.name || '');
    const [tradingMethod, setTradingMethod] = useState(initial?.tradingMethod || TRADING_METHODS[0].value);
    const [description] = useState(initial?.description || '');
    const [sessionTag] = useState(initial?.sessionTag || 'London & NY');
    const [currency, setCurrency] = useState<AccountCurrencyCode>(initial?.currency || 'USD');
    const [startingCapital, setStartingCapital] = useState(initial?.startingCapital || 100000);
    const [riskMode, setRiskMode] = useState<'FIXED_RISK' | 'COMPOUNDING' | 'DYNAMIC_RISK'>(
        initial?.riskMode === 'DYNAMIC_RISK' ? 'COMPOUNDING' : initial?.riskMode || 'FIXED_RISK'
    );
    const [defaultTimeframe, setDefaultTimeframe] = useState(initial?.defaultTimeframe || '5m');
    const [riskPerTrade, setRiskPerTrade] = useState(initial?.riskPerTrade || 1);
    const [rrTarget, setRrTarget] = useState(initial?.rrTarget || 2.5);
    const [selectedSymbols, setSelectedSymbols] = useState<string[]>(
        initial?.symbols && initial.symbols.length > 0 ? initial.symbols : ['XAUUSD', 'EURUSD', 'GBPUSD']
    );
    const [primarySymbol, setPrimarySymbol] = useState(
        initial?.primarySymbol ||
            (initial?.symbols && initial.symbols.includes('XAUUSD') ? 'XAUUSD' : initial?.symbols?.[0] || 'XAUUSD')
    );
    const [rules, setRules] = useState<BacktestStrategyRule[]>(
        initial?.rules || [
            {
                id: generateUuid(),
                text: isEn ? 'Confirm HTF market structure and session liquidity' : 'Confirmar estrutura HTF e liquidez da sessão',
                required: true,
            },
            {
                id: generateUuid(),
                text: isEn ? 'Enforce configured risk-per-trade limit' : 'Respeitar limite de risco configurado por operação',
                required: true,
            },
        ]
    );
    const [newRuleText, setNewRuleText] = useState('');

    const toggleSymbol = (ticker: string) => {
        setSelectedSymbols((prev) => {
            if (prev.includes(ticker)) {
                if (prev.length === 1) return prev;
                const next = prev.filter((item) => item !== ticker);
                if (primarySymbol === ticker) {
                    setPrimarySymbol(next.includes('XAUUSD') ? 'XAUUSD' : next[0]);
                }
                return next;
            }
            const next = [...prev, ticker];
            if (!next.includes(primarySymbol)) {
                setPrimarySymbol(ticker);
            }
            return next;
        });
    };

    const effectivePrimarySymbol = selectedSymbols.includes(primarySymbol)
        ? primarySymbol
        : selectedSymbols.includes('XAUUSD')
          ? 'XAUUSD'
          : selectedSymbols[0] || 'XAUUSD';

    const illustrativeRiskAmount = Math.round((startingCapital * (Number(riskPerTrade) || 1)) / 100);

    const addRule = () => {
        if (!newRuleText.trim()) return;
        setRules((prev) => [...prev, { id: generateUuid(), text: newRuleText.trim(), required: true }]);
        setNewRuleText('');
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        const chosenMethod = tradingMethod || TRADING_METHODS[0].value;
        onSave({
            name: name.trim(),
            tradingMethod: chosenMethod,
            description: description.trim() || chosenMethod,
            sessionTag,
            currency,
            startingCapital,
            riskMode,
            defaultTimeframe,
            riskPerTrade,
            rrTarget,
            primarySymbol: effectivePrimarySymbol,
            symbols: selectedSymbols,
            rules,
        });
        onClose();
    };

    const extraCatalogSymbols = ALL_BACKTEST_SYMBOLS.map((s) => s.ticker).filter(
        (t) => !FEATURED_DEFAULT_SYMBOLS.includes(t)
    );
    const allSymbolOptions = [...FEATURED_DEFAULT_SYMBOLS, ...extraCatalogSymbols];

    return (
        <div
            className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={onClose}
        >
            <div
                className="w-full max-w-2xl rounded-2xl border border-line bg-surface shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-line">
                    <div className="min-w-0">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-accent-fg">
                            {isEditing ? (isEn ? 'Playbook Settings' : 'Definições da estratégia') : (isEn ? 'New Playbook' : 'Nova estratégia')}
                        </span>
                        <h3 className="text-lg font-bold text-fg mt-0.5 truncate">
                            {isEditing ? initial?.name : (isEn ? 'Create Playbook' : 'Criar estratégia')}
                        </h3>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={isEn ? 'Close modal' : 'Fechar modal'}
                        className="p-1.5 rounded-lg text-fg-subtle hover:text-fg hover:bg-surface-2 transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {isEditing && (
                    <div className="px-6 bg-surface-2/30">
                        <SubTabs
                            label={isEn ? 'Settings sections' : 'Secções das definições'}
                            value={tab}
                            onChange={setTab}
                            options={[
                                { value: 'general', label: isEn ? 'General & Risk' : 'Geral & Risco', icon: <Settings2 size={14} /> },
                                { value: 'rules', label: isEn ? 'Plan & Rules' : 'Plano & Regras', icon: <ListChecks size={14} />, count: rules.length },
                                { value: 'sessions', label: isEn ? 'Sessions' : 'Sessões', icon: <FolderKanban size={14} />, count: sessions.length },
                            ]}
                        />
                    </div>
                )}

                <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[78vh] overflow-y-auto">
                    {tab === 'general' && (
                        <>
                            {/* 1. Nome & Método */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-semibold text-fg mb-1.5">
                                        {isEn ? 'Playbook Name' : 'Nome da estratégia'}
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder={isEn ? 'e.g. Smart Money London Sweep' : 'Ex: Smart Money London Sweep'}
                                        className={inputCls}
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-semibold text-fg mb-1.5">
                                        {isEn ? 'Trading Methodology' : 'Método operacional'}
                                    </label>
                                    <select
                                        value={tradingMethod}
                                        onChange={(e) => setTradingMethod(e.target.value)}
                                        className={inputCls}
                                    >
                                        {TRADING_METHODS.map((method) => (
                                            <option key={method.value} value={method.value}>
                                                {isEn ? method.en : method.value}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* 2. Capital inicial & Moeda */}
                            <div className="rounded-xl border border-line p-4 space-y-3 bg-surface-2/40">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-semibold text-fg">{isEn ? 'Starting Capital' : 'Capital inicial'}</span>
                                        {isEditing && (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold">
                                                <Lock className="w-2.5 h-2.5" /> {isEn ? 'Locked after creation' : 'Fixo após criação'}
                                            </span>
                                        )}
                                    </div>

                                    <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
                                        {CURRENCIES.map((curr) => {
                                            const active = currency === curr;
                                            return (
                                                <button
                                                    key={curr}
                                                    type="button"
                                                    disabled={isEditing}
                                                    onClick={() => setCurrency(curr)}
                                                    className={cn(
                                                        'px-2.5 py-1 rounded-md text-[11px] font-bold transition-all',
                                                        active ? 'bg-accent text-accent-on shadow-sm' : 'text-fg-muted hover:text-fg',
                                                        isEditing && 'opacity-60 cursor-not-allowed'
                                                    )}
                                                >
                                                    {curr}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                                    {CAPITAL_PRESETS.map((preset) => {
                                        const active = startingCapital === preset;
                                        return (
                                            <button
                                                key={preset}
                                                type="button"
                                                disabled={isEditing}
                                                onClick={() => setStartingCapital(preset)}
                                                className={cn(
                                                    'py-2 px-2 rounded-lg border text-xs font-bold tabular-nums transition-all',
                                                    active
                                                        ? 'border-accent bg-accent/10 text-accent-fg'
                                                        : 'border-line bg-surface text-fg-muted hover:text-fg',
                                                    isEditing && 'opacity-60 cursor-not-allowed'
                                                )}
                                            >
                                                {preset.toLocaleString('en-US')}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* 3. Modelo de risco */}
                            <div className="space-y-2.5">
                                <div className="flex items-center justify-between">
                                    <label className="block text-xs font-semibold text-fg">{isEn ? 'Risk Model' : 'Modelo de risco'}</label>
                                    {isEditing && (
                                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-fg-subtle">
                                            <Lock className="w-2.5 h-2.5" /> {isEn ? 'Locked after creation' : 'Fixo após criação'}
                                        </span>
                                    )}
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                    {[
                                        {
                                            id: 'FIXED_RISK' as const,
                                            title: isEn ? 'Fixed Risk' : 'Risco Fixo',
                                            desc: isEn
                                                ? 'Constant dollar risk anchored to starting balance.'
                                                : 'Risco monetário constante sobre o saldo inicial.',
                                        },
                                        {
                                            id: 'COMPOUNDING' as const,
                                            title: 'Compounding',
                                            desc: isEn
                                                ? 'Risk recalculated dynamically from live account equity.'
                                                : 'Risco recalculado sobre o saldo atual da conta.',
                                        },
                                    ].map((opt) => (
                                        <button
                                            key={opt.id}
                                            type="button"
                                            disabled={isEditing}
                                            onClick={() => setRiskMode(opt.id)}
                                            className={cn(
                                                'p-3 rounded-xl border text-left transition-all',
                                                riskMode === opt.id
                                                    ? 'border-accent bg-accent/10 text-fg'
                                                    : 'border-line bg-surface-2/40 text-fg-muted hover:text-fg',
                                                isEditing && 'opacity-60 cursor-not-allowed'
                                            )}
                                        >
                                            <div className="text-xs font-bold">{opt.title}</div>
                                            <div className="text-[11px] text-fg-muted mt-0.5">{opt.desc}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* 4. Defaults das sessões */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div>
                                    <label className="block text-xs font-semibold text-fg mb-1.5">{isEn ? 'Default Timeframe' : 'Timeframe padrão'}</label>
                                    <select
                                        value={defaultTimeframe}
                                        onChange={(e) => setDefaultTimeframe(e.target.value)}
                                        className={inputCls}
                                    >
                                        {INITIAL_TIMEFRAMES.map((tf) => (
                                            <option key={tf.value} value={tf.value}>
                                                {isEn ? tf.labelEn : tf.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-semibold text-fg mb-1.5">
                                        {isEn ? 'Risk per trade (%)' : 'Risco por trade (%)'}
                                    </label>
                                    <input
                                        type="number"
                                        min={0.1}
                                        max={20}
                                        step={0.1}
                                        value={riskPerTrade}
                                        onChange={(e) => setRiskPerTrade(Number(e.target.value))}
                                        className={cn(inputCls, 'tabular-nums')}
                                    />
                                    <p className="mt-1 text-[10px] text-fg-subtle tabular-nums">
                                        ≈ {fmtMoney(illustrativeRiskAmount, { decimals: 0, currency })} {isEn ? 'per trade' : 'por trade'}
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-xs font-semibold text-fg mb-1.5">{isEn ? 'Default Target R:R' : 'Alvo R:R padrão'}</label>
                                    <input
                                        type="number"
                                        min={0.5}
                                        max={20}
                                        step={0.5}
                                        value={rrTarget}
                                        onChange={(e) => setRrTarget(Number(e.target.value) || 2)}
                                        className={cn(inputCls, 'tabular-nums')}
                                    />
                                    <p className="mt-1 text-[10px] text-fg-subtle">{isEn ? 'Session' : 'Sessão'}: {sessionTag}</p>
                                </div>
                            </div>

                            {/* 5. Ativos padrão */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                    <label className="block text-xs font-semibold text-fg">{isEn ? 'Default Symbols' : 'Ativos padrão'}</label>
                                    {selectedSymbols.length > 1 && (
                                        <select
                                            value={effectivePrimarySymbol}
                                            onChange={(e) => setPrimarySymbol(e.target.value)}
                                            className="px-2 py-1 rounded-lg border border-line bg-surface-2 text-[11px] font-semibold text-fg"
                                        >
                                            {selectedSymbols.map((sym) => (
                                                <option key={sym} value={sym}>
                                                    {isEn ? 'Primary' : 'Principal'}: {sym}
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {allSymbolOptions.map((ticker) => {
                                        const isSelected = selectedSymbols.includes(ticker);
                                        const isPrimary = effectivePrimarySymbol === ticker;
                                        return (
                                            <button
                                                key={ticker}
                                                type="button"
                                                onClick={() => toggleSymbol(ticker)}
                                                className={cn(
                                                    'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors',
                                                    isSelected
                                                        ? isPrimary
                                                            ? 'border-accent bg-accent text-accent-on'
                                                            : 'border-accent/40 bg-accent/10 text-accent-fg'
                                                        : 'border-line bg-surface-2 text-fg-muted hover:text-fg'
                                                )}
                                            >
                                                <span>{ticker}</span>
                                                {isSelected ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3 opacity-60" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </>
                    )}

                    {tab === 'rules' && (
                        <div className="space-y-4">
                            <div>
                                <h4 className="text-sm font-semibold text-fg">{isEn ? 'Playbook Execution Checklist' : 'Checklist operacional da estratégia'}</h4>
                                <p className="text-xs text-fg-muted mt-0.5">
                                    {isEn
                                        ? 'Define objective entry criteria to score setups during Market Replay.'
                                        : 'Defina regras objetivas para validar entradas durante o replay.'}
                                </p>
                            </div>

                            {rules.length === 0 ? (
                                <p className="rounded-xl border border-dashed border-line py-8 text-center text-xs text-fg-muted">
                                    {isEn ? 'No rules defined for this Playbook yet.' : 'Ainda não existem regras definidas para esta estratégia.'}
                                </p>
                            ) : (
                                <ol className="space-y-2">
                                    {rules.map((r, i) => (
                                        <li
                                            key={r.id}
                                            className="flex items-start gap-2.5 rounded-xl border border-line bg-surface-2/40 px-3 py-2.5 text-sm"
                                        >
                                            <span className="mt-0.5 w-4 shrink-0 text-right text-[11px] tabular-nums text-fg-subtle">
                                                {i + 1}.
                                            </span>
                                            <span className="flex-1 text-fg text-xs leading-relaxed">{r.text}</span>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setRules((prev) =>
                                                        prev.map((x) => (x.id === r.id ? { ...x, required: !x.required } : x))
                                                    )
                                                }
                                                className={cn(
                                                    'shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold',
                                                    r.required ? 'bg-accent/15 text-accent-fg' : 'bg-surface-3 text-fg-muted'
                                                )}
                                            >
                                                {r.required ? (isEn ? 'Required' : 'Obrigatória') : (isEn ? 'Optional' : 'Opcional')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setRules((prev) => prev.filter((x) => x.id !== r.id))}
                                                aria-label={isEn ? 'Remove rule' : 'Remover regra'}
                                                className="shrink-0 rounded p-1 text-fg-subtle hover:text-danger-fg"
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        </li>
                                    ))}
                                </ol>
                            )}

                            <div className="flex gap-2">
                                <input
                                    value={newRuleText}
                                    onChange={(e) => setNewRuleText(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            addRule();
                                        }
                                    }}
                                    placeholder={isEn ? 'Add a new Playbook rule...' : 'Adicionar nova regra ao plano...'}
                                    className={inputCls}
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    icon={<Plus size={14} />}
                                    onClick={addRule}
                                    disabled={!newRuleText.trim()}
                                >
                                    {isEn ? 'Add' : 'Adicionar'}
                                </Button>
                            </div>
                        </div>
                    )}

                    {tab === 'sessions' && initial && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between gap-2">
                                <div>
                                    <h4 className="text-sm font-semibold text-fg">{isEn ? 'Playbook Sessions' : 'Sessões desta estratégia'}</h4>
                                    <p className="text-xs text-fg-muted">
                                        {isEn
                                            ? 'Select a session to inspect metrics or jump straight into Replay.'
                                            : 'Clique numa sessão para abrir os seus detalhes ou ir direto para o replay.'}
                                    </p>
                                </div>
                                <Button
                                    type="button"
                                    variant="brand"
                                    size="sm"
                                    icon={<Plus size={13} />}
                                    onClick={() => {
                                        onClose();
                                        navigate(`/backtesting/sessions/new?strategy=${initial.id}`);
                                    }}
                                >
                                    {isEn ? 'New Session' : 'Nova sessão'}
                                </Button>
                            </div>

                            {sessions.length === 0 ? (
                                <p className="rounded-xl border border-dashed border-line py-8 text-center text-xs text-fg-muted">
                                    {isEn ? 'No sessions created for this Playbook yet.' : 'Nenhuma sessão criada ainda para esta estratégia.'}
                                </p>
                            ) : (
                                <ul className="divide-y divide-line rounded-xl border border-line overflow-hidden">
                                    {sessions.map((s) => {
                                        const st = sessionStats(s);
                                        return (
                                            <li
                                                key={s.id}
                                                className="flex items-center justify-between gap-3 px-3.5 py-2.5 hover:bg-surface-2/50 transition-colors"
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        onClose();
                                                        navigate(`/backtesting/sessions/${s.id}`);
                                                    }}
                                                    className="min-w-0 flex-1 flex items-center gap-2.5 text-left"
                                                >
                                                    <span className="truncate text-xs font-semibold text-fg hover:text-accent-fg">
                                                        {s.name}
                                                    </span>
                                                    <span className="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-bold text-fg-muted">
                                                        {s.primarySymbol}
                                                    </span>
                                                </button>
                                                <div className="flex items-center gap-2.5 shrink-0">
                                                    <span className="text-xs font-semibold tabular-nums text-fg">
                                                        {fmtMoney(st.realizedBalance, { currency })}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        title={isEn ? 'Launch Replay' : 'Abrir replay'}
                                                        onClick={() => {
                                                            onClose();
                                                            navigate(`/backtesting/replay/${s.id}`);
                                                        }}
                                                        className="inline-flex items-center gap-1 rounded-lg bg-accent/10 px-2 py-1 text-[11px] font-semibold text-accent-fg hover:bg-accent/20"
                                                    >
                                                        <Play size={11} fill="currentColor" /> Replay
                                                    </button>
                                                    <button
                                                        type="button"
                                                        title={isEn ? 'Open Session' : 'Ir para a sessão'}
                                                        onClick={() => {
                                                            onClose();
                                                            navigate(`/backtesting/sessions/${s.id}`);
                                                        }}
                                                        className="rounded-lg border border-line p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
                                                    >
                                                        <ChevronRight size={13} />
                                                    </button>
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}

                            {canDelete && onDelete && (
                                <div className="flex items-center justify-between gap-3 rounded-xl border border-danger/25 bg-danger/5 px-4 py-3">
                                    <div>
                                        <p className="text-xs font-semibold text-fg">{isEn ? 'Delete Playbook' : 'Excluir estratégia'}</p>
                                        <p className="text-[11px] text-fg-muted">
                                            {isEn ? 'Removes this Playbook from your active list.' : 'Remove esta estratégia da lista ativa.'}
                                        </p>
                                    </div>
                                    <ConfirmDeleteButton
                                        label={isEn ? 'Delete Playbook' : 'Excluir estratégia'}
                                        onConfirm={() => {
                                            onDelete();
                                            onClose();
                                        }}
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    {/* Footer */}
                    <div className="pt-3 border-t border-line flex items-center justify-between gap-3">
                        <span className="text-[11px] text-fg-subtle">
                            {isEditing
                                ? isEn
                                    ? 'Changes take effect immediately.'
                                    : 'As alterações são aplicadas imediatamente.'
                                : isEn
                                ? 'Starting capital and currency stay locked after creation.'
                                : 'Capital e moeda ficam fixos após criar.'}
                        </span>
                        <div className="flex items-center gap-2">
                            <Button type="button" variant="outline" size="sm" onClick={onClose}>
                                {isEn ? 'Cancel' : 'Cancelar'}
                            </Button>
                            <Button type="submit" variant="brand" size="sm" disabled={!name.trim()}>
                                {isEditing ? (isEn ? 'Save Settings' : 'Guardar definições') : (isEn ? 'Create Playbook' : 'Criar estratégia')}
                            </Button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
};
