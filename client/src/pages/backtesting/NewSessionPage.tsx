import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Layers, Play, Search, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Breadcrumbs, EmptyState, Field, fmtIsoDate, fmtMoney, inputCls, Toggle } from '../../components/backtesting/primitives';
import { ALL_BACKTEST_SYMBOLS } from '../../services/backtestWorkspaceStore';
import { prefetchSessionViaSharedDemoAccount } from '../../services/historicalBatchCache';
import { useBacktestWorkspace } from './BacktestWorkspaceContext';
import { cn } from '../../lib/cn';
import { useLocale } from '../../context/LocaleContext';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', 'D'];
const CATEGORIES = ['Forex', 'Metais', 'Índices', 'Cripto'] as const;
const CATEGORY_LABELS_EN: Record<(typeof CATEGORIES)[number], string> = {
    Forex: 'FX',
    Metais: 'Metals',
    Índices: 'Indices',
    Cripto: 'Crypto',
};
const isoDay = (offsetDays = 0) => new Date(Date.now() - offsetDays * 86400000).toISOString().slice(0, 10);

const Section = ({
    step,
    title,
    description,
    children,
}: {
    step: number;
    title: string;
    description?: string;
    children: React.ReactNode;
}) => (
    <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
        <header className="mb-4 flex items-start gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-fg text-[11px] font-bold text-canvas">
                {step}
            </span>
            <div>
                <h2 className="text-sm font-semibold text-fg">{title}</h2>
                {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
            </div>
        </header>
        <div className="space-y-4">{children}</div>
    </section>
);

export const NewSessionPage = () => {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const { strategies, sessions, createSession } = useBacktestWorkspace();

    const [strategyId, setStrategyId] = useState(() => params.get('strategy') || strategies[0]?.id || '');
    const strategy = useMemo(
        () => strategies.find((s) => s.id === strategyId) || strategies[0],
        [strategies, strategyId]
    );

    const orderedStrategySymbols = useMemo(() => {
        if (!strategy) return ['XAUUSD', 'EURUSD', 'GBPUSD'];
        const list = strategy.symbols?.length ? [...strategy.symbols] : [strategy.primarySymbol || 'XAUUSD'];
        if (strategy.primarySymbol && list.includes(strategy.primarySymbol)) {
            return [strategy.primarySymbol, ...list.filter((s) => s !== strategy.primarySymbol)];
        }
        return list;
    }, [strategy]);

    const nextSessionNumber = useMemo(() => {
        if (!strategy) return sessions.length + 1;
        return sessions.filter((s) => s.strategyId === strategy.id).length + 1;
    }, [sessions, strategy]);

    const [pairs, setPairs] = useState<string[]>(orderedStrategySymbols);
    const [name, setName] = useState(() => `${isEn ? 'Session' : 'Sessão'} ${nextSessionNumber} — ${orderedStrategySymbols[0] || 'XAUUSD'}`);
    const [pairQuery, setPairQuery] = useState('');
    const [timeframe, setTimeframe] = useState(() => strategy?.defaultTimeframe || '5m');
    const [fromDate, setFromDate] = useState(isoDay(15));
    const [toDate, setToDate] = useState(isoDay(0));
    const [followToday, setFollowToday] = useState(false);
    const [randomStart, setRandomStart] = useState(false);
    const [risk, setRisk] = useState(strategy?.riskPerTrade ?? 1);
    const [funded, setFunded] = useState(false);
    const [target, setTarget] = useState(10);
    const [dailyLoss, setDailyLoss] = useState(5);
    const [totalLoss, setTotalLoss] = useState(10);
    const [isCreatingSession, setIsCreatingSession] = useState(false);
    const [touched, setTouched] = useState(false);

    const matches = useMemo(() => {
        const q = pairQuery.trim().toUpperCase();
        return ALL_BACKTEST_SYMBOLS.filter((s) => !q || s.ticker.includes(q) || s.name.toUpperCase().includes(q));
    }, [pairQuery]);

    // Strategy drives defaults (timeframe, risk, and ordered default symbols).
    useEffect(() => {
        if (!strategy) return;
        setRisk(strategy.riskPerTrade ?? 1);
        setTimeframe(strategy.defaultTimeframe || '5m');
        setPairs(orderedStrategySymbols);
        setName(`${isEn ? 'Session' : 'Sessão'} ${nextSessionNumber} — ${orderedStrategySymbols[0] || 'XAUUSD'}`);
    }, [strategy?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!strategy) {
        return (
            <EmptyState
                icon={<Layers size={20} />}
                title={isEn ? 'Create a Playbook before launching a session' : 'Crie uma estratégia antes de iniciar uma sessão'}
                description={
                    isEn
                        ? 'Every replay session belongs to a Playbook defining starting capital, currency, and risk model.'
                        : 'Toda sessão de replay pertence a uma estratégia que define o capital inicial, a moeda e o modelo de risco.'
                }
                action={
                    <Button variant="brand" onClick={() => navigate('/backtesting/strategies?new=1')}>
                        {isEn ? 'Create Playbook' : 'Criar estratégia'}
                    </Button>
                }
            />
        );
    }

    const end = followToday ? isoDay(0) : toDate;
    const errors = {
        name: !name.trim() ? (isEn ? 'Enter a session name.' : 'Dê um nome à sessão.') : '',
        dates:
            fromDate >= end
                ? isEn
                    ? 'Start date must precede the end date.'
                    : 'A data de início tem de ser anterior à de fim.'
                : fromDate > isoDay(0)
                ? isEn
                    ? 'Start date cannot be in the future.'
                    : 'O início não pode estar no futuro.'
                : '',
        risk: !(risk > 0 && risk <= 10)
            ? isEn
                ? 'Set risk between 0.1% and 10%.'
                : 'Use um risco entre 0,1% e 10%.'
            : '',
    };
    const valid = !errors.name && !errors.dates && !errors.risk && pairs.length > 0;

    const togglePair = (t: string) =>
        setPairs((p) => (p.includes(t) ? (p.length > 1 ? p.filter((x) => x !== t) : p) : [...p, t]));
    const movePair = (i: number, dir: -1 | 1) =>
        setPairs((p) => {
            const j = i + dir;
            if (j < 0 || j >= p.length) return p;
            const c = [...p];
            [c[i], c[j]] = [c[j], c[i]];
            return c;
        });

    const days = Math.max(0, Math.round((new Date(end).getTime() - new Date(fromDate).getTime()) / 86400000));
    const currencyCode = strategy.currency || 'USD';
    const riskModeLabel =
        strategy.riskMode === 'COMPOUNDING' || strategy.riskMode === 'DYNAMIC_RISK' ? 'Compounding' : 'Fixed Risk';

    const submit = (openReplay: boolean) => {
        setTouched(true);
        if (!valid || !strategy || isCreatingSession) return;
        setIsCreatingSession(true);

        const created = createSession({
            name: name.trim(),
            strategyId: strategy.id,
            pairs,
            primarySymbol: pairs[0],
            timeframe,
            fromDate,
            toDate: end,
            keepEndFollowingToday: followToday,
            randomStartDate: randomStart,
            riskPerTrade: risk,
            fundedMode: {
                enabled: funded,
                profitTargetPct: target,
                maxDailyLossPct: dailyLoss,
                maxTotalLossPct: totalLoss,
            },
        });

        // Fire background multi-timeframe warm-up without blocking instant navigation to Market Replay
        void prefetchSessionViaSharedDemoAccount({
            sessionId: created.id,
            symbols: pairs,
            timeframe,
            fromDate,
            toDate: end,
        }).catch(() => {});

        navigate(openReplay ? `/backtesting/replay/${created.id}` : `/backtesting/strategies?id=${strategy.id}`);
    };

    return (
        <div className="space-y-4">
            <Breadcrumbs
                items={[
                    { label: isEn ? 'Playbooks' : 'Estratégias', to: `/backtesting/strategies?id=${strategy.id}` },
                    { label: strategy.name, to: `/backtesting/strategies?id=${strategy.id}` },
                    { label: isEn ? 'New Session' : 'Nova sessão' },
                ]}
            />

            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    void submit(true);
                }}
                className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]"
                noValidate
            >
                <div className="space-y-4">
                    <Section
                        step={1}
                        title={isEn ? 'Playbook & Identification' : 'Estratégia e Identificação'}
                        description={
                            isEn
                                ? 'The session inherits starting capital, currency, and risk model from the selected Playbook.'
                                : 'A sessão herda o capital, a moeda e o modelo de risco fixos da estratégia selecionada.'
                        }
                    >
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <Field
                                label={isEn ? 'Playbook' : 'Estratégia'}
                                htmlFor="ns-strategy"
                                hint={
                                    <>
                                        {isEn ? 'Capital' : 'Capital'} ({currencyCode} {strategy.startingCapital.toLocaleString('en-US')}){' '}
                                        {isEn ? 'and model' : 'e modelo'} ({riskModeLabel}){' '}
                                        {isEn ? 'from Playbook.' : 'vêm da estratégia.'}{' '}
                                        <Link
                                            to={`/backtesting/strategies?id=${strategy.id}`}
                                            className="font-semibold text-fg underline"
                                        >
                                            {isEn ? 'View Playbook' : 'Ver estratégia'}
                                        </Link>
                                    </>
                                }
                            >
                                <select
                                    id="ns-strategy"
                                    value={strategy.id}
                                    onChange={(e) => setStrategyId(e.target.value)}
                                    className={inputCls}
                                >
                                    {strategies.map((s) => (
                                        <option key={s.id} value={s.id}>
                                            {s.name} ({s.currency || 'USD'}{' '}
                                            {(s.startingCapital || 100000).toLocaleString('en-US')})
                                        </option>
                                    ))}
                                </select>
                            </Field>

                            <Field
                                label={isEn ? 'Session Name' : 'Nome da sessão'}
                                htmlFor="ns-name"
                                hint={
                                    touched && errors.name ? (
                                        <span className="text-danger-fg">{errors.name}</span>
                                    ) : (
                                        `${isEn ? 'e.g. Session' : 'Ex.: Sessão'} ${nextSessionNumber} — ${pairs[0] || 'XAUUSD'}`
                                    )
                                }
                            >
                                <input
                                    id="ns-name"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className={inputCls}
                                    placeholder={isEn ? 'Session name' : 'Nome da sessão'}
                                    autoFocus
                                />
                            </Field>
                        </div>
                    </Section>

                    <Section
                        step={2}
                        title={isEn ? 'Markets & Instruments' : 'Mercado e Ativos'}
                        description={
                            isEn
                                ? 'Default Playbook symbols are pre-selected. Multi-timeframe market batches sync automatically upon creation.'
                                : 'Os ativos padrão da estratégia já vêm pré-selecionados. Ao criar a sessão, múltiplos lotes e timeframes são sincronizados automaticamente para o workspace.'
                        }
                    >
                        <Field
                            label={isEn ? 'Initial Timeframe' : 'Timeframe inicial'}
                            hint={
                                isEn
                                    ? 'Switch freely inside Market Replay between 1m, 5m, 15m, 1h, 4h, and Daily.'
                                    : 'Dentro do workspace de replay poderá alternar livremente entre 1m, 5m, 15m, 1h, 4h e Diário.'
                            }
                        >
                            <div role="radiogroup" aria-label="Timeframe" className="flex flex-wrap gap-1.5">
                                {TIMEFRAMES.map((tf) => (
                                    <button
                                        key={tf}
                                        type="button"
                                        role="radio"
                                        aria-checked={timeframe === tf}
                                        onClick={() => setTimeframe(tf)}
                                        className={cn(
                                            'min-w-[3rem] rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
                                            timeframe === tf
                                                ? 'border-fg bg-fg text-canvas'
                                                : 'border-line bg-surface-2 text-fg-muted hover:text-fg'
                                        )}
                                    >
                                        {tf}
                                    </button>
                                ))}
                            </div>
                        </Field>

                        <Field label={isEn ? 'Session Instruments' : 'Ativos da sessão'}>
                            <div className="relative">
                                <Search
                                    size={15}
                                    aria-hidden
                                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
                                />
                                <input
                                    value={pairQuery}
                                    onChange={(e) => setPairQuery(e.target.value)}
                                    placeholder={isEn ? 'Search ticker or instrument' : 'Procurar ativo'}
                                    aria-label={isEn ? 'Search instrument' : 'Procurar ativo'}
                                    className={`${inputCls} pl-9`}
                                />
                            </div>
                            <div className="mt-2 space-y-2">
                                {CATEGORIES.map((cat) => {
                                    const items = matches.filter((m) => m.category === cat);
                                    if (!items.length) return null;
                                    return (
                                        <div key={cat} className="flex flex-wrap items-center gap-1.5">
                                            <span className="w-14 shrink-0 text-[11px] font-semibold text-fg-subtle">
                                                {isEn ? CATEGORY_LABELS_EN[cat] : cat}
                                            </span>
                                            {items.map((sym) => {
                                                const on = pairs.includes(sym.ticker);
                                                return (
                                                    <button
                                                        key={sym.ticker}
                                                        type="button"
                                                        aria-pressed={on}
                                                        title={sym.name}
                                                        onClick={() => togglePair(sym.ticker)}
                                                        className={cn(
                                                            'rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors',
                                                            on
                                                                ? 'border-accent/40 bg-accent/10 text-accent-fg'
                                                                : 'border-line bg-surface-2 text-fg-muted hover:text-fg'
                                                        )}
                                                    >
                                                        {sym.ticker}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    );
                                })}
                            </div>
                        </Field>

                        <ol className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                            {pairs.map((t, i) => (
                                <li
                                    key={t}
                                    className="flex items-center justify-between gap-2 bg-surface-2/40 px-3 py-2"
                                >
                                    <span className="flex items-center gap-2 text-sm font-semibold text-fg">
                                        <span className="w-4 text-right text-[11px] tabular-nums text-fg-subtle">
                                            {i + 1}
                                        </span>
                                        {t}
                                        {i === 0 && (
                                            <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold text-fg-muted">
                                                {isEn ? 'Primary' : 'Principal'}
                                            </span>
                                        )}
                                    </span>
                                    <span className="flex items-center gap-0.5">
                                        <button
                                            type="button"
                                            disabled={i === 0}
                                            onClick={() => movePair(i, -1)}
                                            aria-label={`${isEn ? 'Move up' : 'Subir'} ${t}`}
                                            className="rounded p-1 text-fg-muted hover:bg-surface-3 disabled:opacity-30"
                                        >
                                            <ArrowUp size={13} />
                                        </button>
                                        <button
                                            type="button"
                                            disabled={i === pairs.length - 1}
                                            onClick={() => movePair(i, 1)}
                                            aria-label={`${isEn ? 'Move down' : 'Descer'} ${t}`}
                                            className="rounded p-1 text-fg-muted hover:bg-surface-3 disabled:opacity-30"
                                        >
                                            <ArrowDown size={13} />
                                        </button>
                                        <button
                                            type="button"
                                            disabled={pairs.length === 1}
                                            onClick={() => togglePair(t)}
                                            aria-label={`${isEn ? 'Remove' : 'Remover'} ${t}`}
                                            className="rounded p-1 text-fg-muted hover:bg-danger/10 hover:text-danger-fg disabled:opacity-30"
                                        >
                                            <X size={13} />
                                        </button>
                                    </span>
                                </li>
                            ))}
                        </ol>
                    </Section>

                    <Section
                        step={3}
                        title={isEn ? 'Date Range & Random Replay' : 'Período e Random Replay'}
                        description={
                            isEn
                                ? 'Select the historical date window for bar replay batches.'
                                : 'Escolha o intervalo histórico para os lotes de velas desta sessão.'
                        }
                    >
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Field label={isEn ? 'Start Date' : 'Início'} htmlFor="ns-from">
                                <input
                                    id="ns-from"
                                    type="date"
                                    value={fromDate}
                                    max={isoDay(0)}
                                    onChange={(e) => setFromDate(e.target.value)}
                                    className={inputCls}
                                />
                            </Field>
                            <Field label={isEn ? 'End Date' : 'Fim'} htmlFor="ns-to">
                                <input
                                    id="ns-to"
                                    type="date"
                                    value={end}
                                    disabled={followToday}
                                    max={isoDay(0)}
                                    onChange={(e) => setToDate(e.target.value)}
                                    className={inputCls}
                                />
                            </Field>
                        </div>
                        {touched && errors.dates && <p className="text-xs text-danger-fg">{errors.dates}</p>}
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                            <Toggle
                                checked={followToday}
                                onChange={setFollowToday}
                                label={isEn ? 'End tracks today' : 'Fim acompanha a data de hoje'}
                                description={
                                    isEn
                                        ? 'Useful for ongoing sessions that keep appending bars.'
                                        : 'Útil para sessões contínuas que vão sendo retomadas.'
                                }
                            />
                            <Toggle
                                checked={randomStart}
                                onChange={setRandomStart}
                                label={isEn ? 'Random Replay (blind start)' : 'Random Replay (data aleatória)'}
                                description={
                                    isEn
                                        ? 'Prevents hindsight bias on price action you already recognize.'
                                        : 'Evita operar de memória um trecho que já conhece.'
                                }
                            />
                        </div>
                    </Section>

                    <Section
                        step={4}
                        title={isEn ? 'Risk & Prop Challenge Mode' : 'Risco e Funded Mode'}
                        description={
                            isEn
                                ? 'Set session risk per trade and optionally enable prop firm evaluation guardrails.'
                                : 'Ajuste o risco inicial desta sessão e ative regras de mesa proprietária se desejar.'
                        }
                    >
                        <Field
                            label={isEn ? 'Risk per trade (%)' : 'Risco por trade (%)'}
                            htmlFor="ns-risk"
                            hint={
                                touched && errors.risk ? (
                                    <span className="text-danger-fg">{errors.risk}</span>
                                ) : (
                                    `${isEn ? 'Playbook default' : 'Default da estratégia'}: ${strategy.riskPerTrade ?? 1}% (${currencyCode} ${Math.round(
                                        ((strategy.startingCapital || 100000) * (risk || 1)) / 100
                                    ).toLocaleString('en-US')})`
                                )
                            }
                            className="max-w-xs"
                        >
                            <input
                                id="ns-risk"
                                type="number"
                                step="0.25"
                                min="0.1"
                                max="10"
                                value={risk}
                                onChange={(e) => setRisk(parseFloat(e.target.value))}
                                className={`${inputCls} tabular-nums`}
                            />
                        </Field>
                        <Toggle
                            checked={funded}
                            onChange={setFunded}
                            label={isEn ? 'Funded Mode (Simulate prop firm challenge)' : 'Funded Mode (Simular desafio de mesa proprietária)'}
                            description={
                                isEn
                                    ? 'Tracks profit target, max daily loss limit, and total drawdown rules.'
                                    : 'A sessão monitoriza meta de lucro, perda diária máxima e drawdown total.'
                            }
                        />
                        {funded && (
                            <div className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-surface-2/40 p-3 sm:grid-cols-3">
                                <Field label={isEn ? 'Profit target (%)' : 'Meta de lucro (%)'}>
                                    <input
                                        type="number"
                                        step="0.5"
                                        min="0.5"
                                        value={target}
                                        onChange={(e) => setTarget(Number(e.target.value) || 10)}
                                        className={inputCls}
                                    />
                                </Field>
                                <Field label={isEn ? 'Max daily loss (%)' : 'Perda diária máx. (%)'}>
                                    <input
                                        type="number"
                                        step="0.5"
                                        min="0.5"
                                        value={dailyLoss}
                                        onChange={(e) => setDailyLoss(Number(e.target.value) || 5)}
                                        className={inputCls}
                                    />
                                </Field>
                                <Field label={isEn ? 'Max total drawdown (%)' : 'Perda total máx. (%)'}>
                                    <input
                                        type="number"
                                        step="0.5"
                                        min="0.5"
                                        value={totalLoss}
                                        onChange={(e) => setTotalLoss(Number(e.target.value) || 10)}
                                        className={inputCls}
                                    />
                                </Field>
                            </div>
                        )}
                    </Section>
                </div>

                {/* Summary Sidebar */}
                <aside className="space-y-3 rounded-xl border border-line bg-surface p-4 lg:sticky lg:top-4">
                    <h2 className="text-sm font-semibold text-fg">{isEn ? 'Session Summary' : 'Resumo da sessão'}</h2>
                    <dl className="space-y-2.5 text-xs">
                        {[
                            [isEn ? 'Session' : 'Sessão', name.trim() || '—'],
                            [isEn ? 'Playbook' : 'Estratégia', strategy.name],
                            [isEn ? 'Methodology' : 'Método', strategy.tradingMethod || 'Smart Money / ICT'],
                            [
                                isEn ? 'Starting Capital' : 'Capital inicial',
                                `${currencyCode} ${(strategy.startingCapital || 100000).toLocaleString('en-US')}`,
                            ],
                            [isEn ? 'Risk Model' : 'Modelo de risco', riskModeLabel],
                            [
                                isEn ? 'Risk / Trade' : 'Risco por trade',
                                `${Number.isFinite(risk) ? risk : '—'}% (${currencyCode} ${fmtMoney(
                                    ((strategy.startingCapital || 0) * (risk || 0)) / 100,
                                    { decimals: 0 }
                                )})`,
                            ],
                            [isEn ? 'Instruments' : 'Ativos', pairs.join(', ')],
                            [isEn ? 'Initial Timeframe' : 'Timeframe inicial', `${timeframe} (${isEn ? 'Multi-TF active' : 'Multi-TF ativo'})`],
                            [isEn ? 'Date Range' : 'Período', `${fmtIsoDate(fromDate)} → ${followToday ? (isEn ? 'today' : 'hoje') : fmtIsoDate(end)} (${days} ${isEn ? 'days' : 'dias'})`],
                            ['Random Replay', randomStart ? (isEn ? 'Yes' : 'Sim') : (isEn ? 'No' : 'Não')],
                            [
                                'Funded Mode',
                                funded
                                    ? isEn
                                        ? `Target ${target}% · Daily ${dailyLoss}% · Total ${totalLoss}%`
                                        : `Meta ${target}% · Diário ${dailyLoss}% · Total ${totalLoss}%`
                                    : isEn
                                    ? 'Off'
                                    : 'Não',
                            ],
                        ].map(([k, v]) => (
                            <div key={k} className="flex justify-between gap-3">
                                <dt className="shrink-0 text-fg-subtle">{k}</dt>
                                <dd className="text-right font-medium text-fg">{v}</dd>
                            </div>
                        ))}
                    </dl>
                    <div className="space-y-2 border-t border-line pt-3">
                        <Button
                            type="submit"
                            variant="brand"
                            fullWidth
                            icon={<Play size={14} fill="currentColor" />}
                            disabled={(touched && !valid) || isCreatingSession}
                        >
                            {isCreatingSession
                                ? isEn
                                    ? 'Prefetching multi-timeframe bars...'
                                    : 'Carregando lotes multi-timeframe...'
                                : isEn
                                ? 'Create & Launch Replay'
                                : 'Criar e abrir replay'}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            fullWidth
                            onClick={() => void submit(false)}
                            disabled={(touched && !valid) || isCreatingSession}
                        >
                            {isEn ? 'Save Session Only' : 'Criar sem abrir'}
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            fullWidth
                            onClick={() => navigate(`/backtesting/strategies?id=${strategy.id}`)}
                        >
                            {isEn ? 'Cancel' : 'Cancelar'}
                        </Button>
                    </div>
                </aside>
            </form>
        </div>
    );
};
