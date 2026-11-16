import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Layers, Play, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { Field, inputCls, Toggle } from './primitives';
import { useBacktestWorkspace } from '../../pages/backtesting/BacktestWorkspaceContext';
import { prefetchSessionViaSharedDemoAccount } from '../../services/historicalBatchCache';
import { useLocale } from '../../context/LocaleContext';
import { cn } from '../../lib/cn';

const QUICK_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', 'D'] as const;
const QUICK_SYMBOLS = ['XAUUSD', 'EURUSD', 'NAS100', 'GBPUSD', 'BTCUSD', 'US30'] as const;

type DatePreset = '15D' | '30D' | '90D' | 'YTD' | 'CUSTOM';

const isoDay = (offsetDays = 0) => new Date(Date.now() - offsetDays * 86400000).toISOString().slice(0, 10);

function presetRange(preset: DatePreset): { from: string; to: string } {
    const today = isoDay(0);
    if (preset === '15D') return { from: isoDay(15), to: today };
    if (preset === '90D') return { from: isoDay(90), to: today };
    if (preset === 'YTD') {
        const yearStart = `${new Date().getUTCFullYear()}-01-01`;
        return { from: yearStart < today ? yearStart : isoDay(15), to: today };
    }
    return { from: isoDay(30), to: today };
}

interface QuickSessionModalProps {
    open: boolean;
    initialStrategyId?: string | null;
    onClose: () => void;
}

export const QuickSessionModal: React.FC<QuickSessionModalProps> = ({
    open,
    initialStrategyId,
    onClose,
}) => {
    const navigate = useNavigate();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const { strategies, sessions, createStrategy, createSession } = useBacktestWorkspace();

    const [strategyId, setStrategyId] = useState<string>(
        () => initialStrategyId || strategies[0]?.id || ''
    );
    const activeStrategy = useMemo(
        () => strategies.find((s) => s.id === strategyId) || strategies[0] || null,
        [strategies, strategyId]
    );

    const symbolChoices = useMemo(() => {
        const stratSyms = activeStrategy?.symbols?.length ? activeStrategy.symbols : [];
        return Array.from(new Set([...stratSyms, ...QUICK_SYMBOLS])).slice(0, 8);
    }, [activeStrategy]);

    const [selectedSymbol, setSelectedSymbol] = useState<string>(
        () => activeStrategy?.primarySymbol || 'XAUUSD'
    );
    const [timeframe, setTimeframe] = useState<string>(
        () => activeStrategy?.defaultTimeframe || '15m'
    );
    const [datePreset, setDatePreset] = useState<DatePreset>('30D');
    const [customFrom, setCustomFrom] = useState<string>(() => isoDay(30));
    const [customTo, setCustomTo] = useState<string>(() => isoDay(0));
    const [advancedOpen, setAdvancedOpen] = useState<boolean>(false);
    const [customName, setCustomName] = useState<string>('');
    const [riskPerTrade, setRiskPerTrade] = useState<number>(activeStrategy?.riskPerTrade ?? 1);
    const [fundedEnabled, setFundedEnabled] = useState<boolean>(false);
    const [submitting, setSubmitting] = useState<boolean>(false);

    useEffect(() => {
        if (!open) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open, onClose]);

    useEffect(() => {
        if (!open) return;
        if (initialStrategyId && strategies.some((s) => s.id === initialStrategyId)) {
            setStrategyId(initialStrategyId);
        } else if (!strategyId && strategies[0]?.id) {
            setStrategyId(strategies[0].id);
        }
    }, [open, initialStrategyId, strategies, strategyId]);

    useEffect(() => {
        if (!activeStrategy) return;
        setSelectedSymbol(activeStrategy.primarySymbol || activeStrategy.symbols?.[0] || 'XAUUSD');
        setTimeframe(activeStrategy.defaultTimeframe || '15m');
        setRiskPerTrade(activeStrategy.riskPerTrade ?? 1);
    }, [activeStrategy?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!open) return null;

    const resolvedWindow =
        datePreset === 'CUSTOM' ? { from: customFrom, to: customTo } : presetRange(datePreset);
    const validDates = resolvedWindow.from < resolvedWindow.to && resolvedWindow.from <= isoDay(0);
    const validRisk = Number.isFinite(riskPerTrade) && riskPerTrade > 0 && riskPerTrade <= 10;

    const handleLaunch = (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting || !validDates || !validRisk) return;
        setSubmitting(true);

        let targetStrategy = activeStrategy;
        if (!targetStrategy) {
            targetStrategy = createStrategy({
                name: isEn ? 'General Playbook' : 'Playbook Geral',
                tradingMethod: 'Smart Money / Price Action',
                startingCapital: 10000,
                currency: 'USD',
                riskMode: 'FIXED_RISK',
                riskPerTrade,
                defaultTimeframe: timeframe,
                rrTarget: 2,
                primarySymbol: selectedSymbol,
                symbols: [selectedSymbol, ...QUICK_SYMBOLS.filter((x) => x !== selectedSymbol).slice(0, 2)],
            });
        }

        const nextNum = sessions.filter((s) => s.strategyId === targetStrategy!.id).length + 1;
        const pairs = Array.from(
            new Set([selectedSymbol, ...(targetStrategy.symbols || []).filter((x) => x !== selectedSymbol)])
        ).slice(0, 5);

        const sessionName =
            customName.trim() || `${selectedSymbol} · ${timeframe} — #${nextNum}`;

        const created = createSession({
            name: sessionName,
            strategyId: targetStrategy.id,
            pairs,
            primarySymbol: selectedSymbol,
            timeframe,
            fromDate: resolvedWindow.from,
            toDate: resolvedWindow.to,
            keepEndFollowingToday: datePreset !== 'CUSTOM',
            randomStartDate: false,
            riskPerTrade,
            fundedMode: {
                enabled: fundedEnabled,
                profitTargetPct: 10,
                maxDailyLossPct: 5,
                maxTotalLossPct: 10,
            },
        });

        void prefetchSessionViaSharedDemoAccount({
            sessionId: created.id,
            symbols: pairs,
            timeframe,
            fromDate: resolvedWindow.from,
            toDate: resolvedWindow.to,
        }).catch(() => {});

        setSubmitting(false);
        onClose();
        navigate(`/backtesting/replay/${created.id}`);
    };

    const fullFormUrl = activeStrategy
        ? `/backtesting/sessions/new?strategy=${encodeURIComponent(activeStrategy.id)}`
        : '/backtesting/sessions/new';

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/75 p-4 backdrop-blur-xs"
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-session-title"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
                <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
                    <div>
                        <h2 id="quick-session-title" className="text-sm font-bold text-fg">
                            {isEn ? 'Quick Start Replay Session' : 'Nova Sessão Rápida'}
                        </h2>
                        <p className="text-xs text-fg-muted">
                            {isEn
                                ? 'Pick instrument, timeframe, and range to launch in seconds.'
                                : 'Escolha o ativo, timeframe e janela histórica para abrir o replay.'}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={isEn ? 'Close' : 'Fechar'}
                        className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg transition-colors cursor-pointer"
                    >
                        <X size={16} />
                    </button>
                </header>

                <form onSubmit={handleLaunch} className="space-y-4 p-5">
                    {/* 1. Playbook */}
                    {strategies.length > 0 ? (
                        <Field label={isEn ? '1. Playbook' : '1. Estratégia'} htmlFor="qs-strategy">
                            <select
                                id="qs-strategy"
                                value={activeStrategy?.id || ''}
                                onChange={(e) => setStrategyId(e.target.value)}
                                className={inputCls}
                            >
                                {strategies.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.name} ({s.currency || 'USD'} {(s.startingCapital || 10000).toLocaleString('en-US')})
                                    </option>
                                ))}
                            </select>
                        </Field>
                    ) : (
                        <div className="flex items-center gap-2.5 rounded-xl border border-accent/30 bg-accent/10 px-3.5 py-2.5 text-xs text-fg">
                            <Layers size={15} className="shrink-0 text-accent-fg" />
                            <span>
                                {isEn
                                    ? 'No playbook yet — a General Playbook ($10,000 USD) will be created automatically.'
                                    : 'Sem estratégia criada — vamos criar um Playbook Geral ($10,000 USD) automaticamente.'}
                            </span>
                        </div>
                    )}

                    {/* 2. Symbol + Timeframe */}
                    <div className="space-y-3">
                        <Field label={isEn ? '2. Instrument & Timeframe' : '2. Ativo e Timeframe'}>
                            <div className="flex flex-wrap gap-1.5">
                                {symbolChoices.map((sym) => {
                                    const active = selectedSymbol === sym;
                                    return (
                                        <button
                                            key={sym}
                                            type="button"
                                            onClick={() => setSelectedSymbol(sym)}
                                            className={cn(
                                                'rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer',
                                                active
                                                    ? 'border-accent/50 bg-accent/15 text-accent-fg'
                                                    : 'border-line bg-surface-2 text-fg-muted hover:text-fg'
                                            )}
                                        >
                                            {sym}
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {QUICK_TIMEFRAMES.map((tf) => {
                                    const active = timeframe === tf;
                                    return (
                                        <button
                                            key={tf}
                                            type="button"
                                            onClick={() => setTimeframe(tf)}
                                            className={cn(
                                                'min-w-[2.75rem] rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer',
                                                active
                                                    ? 'border-fg bg-fg text-canvas'
                                                    : 'border-line bg-surface-2 text-fg-muted hover:text-fg'
                                            )}
                                        >
                                            {tf}
                                        </button>
                                    );
                                })}
                            </div>
                        </Field>
                    </div>

                    {/* 3. Date window preset */}
                    <Field label={isEn ? '3. Historical Window' : '3. Janela Histórica'}>
                        <div className="flex flex-wrap gap-1.5">
                            {(
                                [
                                    ['15D', isEn ? '15 days' : '15 dias'],
                                    ['30D', isEn ? '30 days' : '30 dias'],
                                    ['90D', isEn ? '90 days' : '90 dias'],
                                    ['YTD', 'YTD'],
                                    ['CUSTOM', isEn ? 'Custom' : 'Personalizado'],
                                ] as [DatePreset, string][]
                            ).map(([preset, label]) => {
                                const active = datePreset === preset;
                                return (
                                    <button
                                        key={preset}
                                        type="button"
                                        onClick={() => setDatePreset(preset)}
                                        className={cn(
                                            'rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer',
                                            active
                                                ? 'border-fg bg-fg text-canvas'
                                                : 'border-line bg-surface-2 text-fg-muted hover:text-fg'
                                        )}
                                    >
                                        {label}
                                    </button>
                                );
                            })}
                        </div>
                        {datePreset === 'CUSTOM' && (
                            <div className="mt-2 grid grid-cols-2 gap-2.5">
                                <input
                                    type="date"
                                    value={customFrom}
                                    max={isoDay(0)}
                                    onChange={(e) => setCustomFrom(e.target.value)}
                                    aria-label={isEn ? 'Start date' : 'Início'}
                                    className={inputCls}
                                />
                                <input
                                    type="date"
                                    value={customTo}
                                    max={isoDay(0)}
                                    onChange={(e) => setCustomTo(e.target.value)}
                                    aria-label={isEn ? 'End date' : 'Fim'}
                                    className={inputCls}
                                />
                            </div>
                        )}
                        {!validDates && (
                            <p className="mt-1 text-xs text-danger-fg">
                                {isEn ? 'Start date must precede end date.' : 'A data inicial deve ser anterior à final.'}
                            </p>
                        )}
                    </Field>

                    {/* Collapsible advanced */}
                    <div className="rounded-xl border border-line bg-canvas-subtle/60">
                        <button
                            type="button"
                            onClick={() => setAdvancedOpen((v) => !v)}
                            className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-fg-muted hover:text-fg cursor-pointer"
                        >
                            <span className="inline-flex items-center gap-1.5">
                                <SlidersHorizontal size={13} />
                                {isEn ? 'Advanced options (name, risk, funded)' : 'Opções avançadas (nome, risco, funded)'}
                            </span>
                            {advancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                        {advancedOpen && (
                            <div className="space-y-3 border-t border-line px-3 py-3">
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <Field label={isEn ? 'Session name (optional)' : 'Nome (opcional)'} htmlFor="qs-name">
                                        <input
                                            id="qs-name"
                                            value={customName}
                                            onChange={(e) => setCustomName(e.target.value)}
                                            placeholder={`${selectedSymbol} · ${timeframe}`}
                                            className={inputCls}
                                        />
                                    </Field>
                                    <Field label={isEn ? 'Risk / trade (%)' : 'Risco / trade (%)'} htmlFor="qs-risk">
                                        <input
                                            id="qs-risk"
                                            type="number"
                                            step="0.25"
                                            min="0.1"
                                            max="10"
                                            value={riskPerTrade}
                                            onChange={(e) => setRiskPerTrade(parseFloat(e.target.value))}
                                            className={`${inputCls} tabular-nums`}
                                        />
                                    </Field>
                                </div>
                                <Toggle
                                    checked={fundedEnabled}
                                    onChange={setFundedEnabled}
                                    label={isEn ? 'Funded Challenge (10% target / 5% daily DD)' : 'Funded Mode (10% meta / 5% DD diário)'}
                                />
                            </div>
                        )}
                    </div>

                    <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3.5">
                        <Link
                            to={fullFormUrl}
                            onClick={onClose}
                            className="text-xs font-semibold text-fg-muted hover:text-fg hover:underline"
                        >
                            {isEn ? 'Full setup form →' : 'Configuração completa →'}
                        </Link>
                        <div className="flex items-center gap-2">
                            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                                {isEn ? 'Cancel' : 'Cancelar'}
                            </Button>
                            <Button
                                type="submit"
                                variant="brand"
                                size="sm"
                                icon={<Play size={13} fill="currentColor" />}
                                disabled={!validDates || !validRisk || submitting}
                            >
                                {isEn ? 'Launch Replay' : 'Iniciar Replay'}
                            </Button>
                        </div>
                    </footer>
                </form>
            </div>
        </div>
    );
};
