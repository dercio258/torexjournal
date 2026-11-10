import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Play, Search, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Breadcrumbs, Field, fmtIsoDate, fmtMoney, inputCls, Toggle } from '../../components/backtesting/primitives';
import { ALL_BACKTEST_SYMBOLS } from '../../services/backtestWorkspaceStore';
import { useBacktestWorkspace } from './BacktestWorkspaceContext';
import { cn } from '../../lib/cn';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', 'D'];
const CATEGORIES = ['Forex', 'Metais', 'Índices', 'Cripto'] as const;
const isoDay = (offsetDays = 0) => new Date(Date.now() - offsetDays * 86400000).toISOString().slice(0, 10);

const Section = ({ step, title, description, children }: { step: number; title: string; description?: string; children: React.ReactNode }) => (
    <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
        <header className="mb-4 flex items-start gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-fg text-[11px] font-bold text-canvas">{step}</span>
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
    const { strategies, createSession } = useBacktestWorkspace();

    const [name, setName] = useState('');
    const [strategyId, setStrategyId] = useState(() => params.get('strategy') || strategies[0]?.id || '');
    const strategy = useMemo(() => strategies.find((s) => s.id === strategyId) || strategies[0], [strategies, strategyId]);

    const [pairs, setPairs] = useState<string[]>(() => strategy?.symbols?.length ? strategy.symbols : ['XAUUSD']);
    const [pairQuery, setPairQuery] = useState('');
    const [timeframe, setTimeframe] = useState('15m');
    const [fromDate, setFromDate] = useState(isoDay(15));
    const [toDate, setToDate] = useState(isoDay(0));
    const [followToday, setFollowToday] = useState(false);
    const [randomStart, setRandomStart] = useState(false);
    const [risk, setRisk] = useState(strategy?.riskPerTrade ?? 1);
    const [funded, setFunded] = useState(false);
    const [target, setTarget] = useState(10);
    const [dailyLoss, setDailyLoss] = useState(5);
    const [totalLoss, setTotalLoss] = useState(10);

    // Strategy drives defaults (risk and its symbol list).
    useEffect(() => {
        if (!strategy) return;
        setRisk(strategy.riskPerTrade);
        if (strategy.symbols?.length) setPairs(strategy.symbols);
    }, [strategy?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const end = followToday ? isoDay(0) : toDate;
    const errors = {
        name: !name.trim() ? 'Dê um nome à sessão.' : '',
        dates: fromDate >= end ? 'A data de início tem de ser anterior à de fim.' : fromDate > isoDay(0) ? 'O início não pode estar no futuro.' : '',
        risk: !(risk > 0 && risk <= 10) ? 'Use um risco entre 0,1% e 10%.' : '',
    };
    const valid = !errors.name && !errors.dates && !errors.risk && pairs.length > 0;
    const [touched, setTouched] = useState(false);

    const matches = useMemo(() => {
        const q = pairQuery.trim().toUpperCase();
        return ALL_BACKTEST_SYMBOLS.filter((s) => !q || s.ticker.includes(q) || s.name.toUpperCase().includes(q));
    }, [pairQuery]);

    const togglePair = (t: string) => setPairs((p) => (p.includes(t) ? (p.length > 1 ? p.filter((x) => x !== t) : p) : [...p, t]));
    const movePair = (i: number, dir: -1 | 1) =>
        setPairs((p) => {
            const j = i + dir;
            if (j < 0 || j >= p.length) return p;
            const c = [...p];
            [c[i], c[j]] = [c[j], c[i]];
            return c;
        });

    const days = Math.max(0, Math.round((new Date(end).getTime() - new Date(fromDate).getTime()) / 86400000));

    const submit = (openReplay: boolean) => {
        setTouched(true);
        if (!valid || !strategy) return;
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
            fundedMode: { enabled: funded, profitTargetPct: target, maxDailyLossPct: dailyLoss, maxTotalLossPct: totalLoss },
        });
        navigate(openReplay ? `/backtesting/replay/${created.id}` : `/backtesting/sessions/${created.id}`);
    };

    return (
        <div className="space-y-4">
            <Breadcrumbs items={[{ label: 'Sessões', to: '/backtesting/sessions' }, { label: 'Nova sessão' }]} />

            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    submit(true);
                }}
                className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]"
                noValidate
            >
                <div className="space-y-4">
                    <Section step={1} title="Identificação" description="O nome ajuda a encontrar a sessão no journal e no dashboard.">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <Field label="Nome da sessão" htmlFor="ns-name" hint={touched && errors.name ? <span className="text-danger-fg">{errors.name}</span> : 'Ex.: Londres · janeiro 2026'}>
                                <input id="ns-name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Nome da sessão" autoFocus />
                            </Field>
                            <Field
                                label="Estratégia"
                                htmlFor="ns-strategy"
                                hint={
                                    <>
                                        Capital e alvo R:R vêm da estratégia.{' '}
                                        <Link to={`/backtesting/strategies?id=${strategy?.id}`} className="font-semibold text-fg underline">
                                            Editar estratégia
                                        </Link>
                                    </>
                                }
                            >
                                <select id="ns-strategy" value={strategy?.id} onChange={(e) => setStrategyId(e.target.value)} className={inputCls}>
                                    {strategies.map((s) => (
                                        <option key={s.id} value={s.id}>
                                            {s.name}
                                        </option>
                                    ))}
                                </select>
                            </Field>
                        </div>
                    </Section>

                    <Section step={2} title="Mercado" description="O primeiro ativo da lista abre no replay; os outros ficam a um clique.">
                        <Field label="Timeframe inicial">
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
                                            timeframe === tf ? 'border-fg bg-fg text-canvas' : 'border-line bg-surface-2 text-fg-muted hover:text-fg'
                                        )}
                                    >
                                        {tf}
                                    </button>
                                ))}
                            </div>
                        </Field>

                        <Field label="Ativos">
                            <div className="relative">
                                <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
                                <input value={pairQuery} onChange={(e) => setPairQuery(e.target.value)} placeholder="Procurar ativo" aria-label="Procurar ativo" className={`${inputCls} pl-9`} />
                            </div>
                            <div className="mt-2 space-y-2">
                                {CATEGORIES.map((cat) => {
                                    const items = matches.filter((m) => m.category === cat);
                                    if (!items.length) return null;
                                    return (
                                        <div key={cat} className="flex flex-wrap items-center gap-1.5">
                                            <span className="w-14 shrink-0 text-[11px] font-semibold text-fg-subtle">{cat}</span>
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
                                                            on ? 'border-accent/40 bg-accent/10 text-accent-fg' : 'border-line bg-surface-2 text-fg-muted hover:text-fg'
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
                                <li key={t} className="flex items-center justify-between gap-2 bg-surface-2/40 px-3 py-2">
                                    <span className="flex items-center gap-2 text-sm font-semibold text-fg">
                                        <span className="w-4 text-right text-[11px] tabular-nums text-fg-subtle">{i + 1}</span>
                                        {t}
                                        {i === 0 && <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold text-fg-muted">Principal</span>}
                                    </span>
                                    <span className="flex items-center gap-0.5">
                                        <button type="button" disabled={i === 0} onClick={() => movePair(i, -1)} aria-label={`Subir ${t}`} className="rounded p-1 text-fg-muted hover:bg-surface-3 disabled:opacity-30">
                                            <ArrowUp size={13} />
                                        </button>
                                        <button type="button" disabled={i === pairs.length - 1} onClick={() => movePair(i, 1)} aria-label={`Descer ${t}`} className="rounded p-1 text-fg-muted hover:bg-surface-3 disabled:opacity-30">
                                            <ArrowDown size={13} />
                                        </button>
                                        <button type="button" disabled={pairs.length === 1} onClick={() => togglePair(t)} aria-label={`Remover ${t}`} className="rounded p-1 text-fg-muted hover:bg-danger/10 hover:text-danger-fg disabled:opacity-30">
                                            <X size={13} />
                                        </button>
                                    </span>
                                </li>
                            ))}
                        </ol>
                    </Section>

                    <Section step={3} title="Período" description="O trecho do histórico que vai operar. O limite de dias depende do seu plano.">
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Field label="Início" htmlFor="ns-from">
                                <input id="ns-from" type="date" value={fromDate} max={isoDay(0)} onChange={(e) => setFromDate(e.target.value)} className={inputCls} />
                            </Field>
                            <Field label="Fim" htmlFor="ns-to">
                                <input id="ns-to" type="date" value={end} disabled={followToday} max={isoDay(0)} onChange={(e) => setToDate(e.target.value)} className={inputCls} />
                            </Field>
                        </div>
                        {touched && errors.dates && <p className="text-xs text-danger-fg">{errors.dates}</p>}
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                            <Toggle checked={followToday} onChange={setFollowToday} label="Fim acompanha a data de hoje" description="Útil para sessões contínuas que vão sendo retomadas." />
                            <Toggle checked={randomStart} onChange={setRandomStart} label="Começar numa data aleatória" description="Evita operar de memória um trecho que já conhece." />
                        </div>
                    </Section>

                    <Section step={4} title="Risco e regras" description="Pode ajustar o risco em cada trade dentro do replay.">
                        <Field label="Risco por trade (%)" htmlFor="ns-risk" hint={touched && errors.risk ? <span className="text-danger-fg">{errors.risk}</span> : `Padrão da estratégia: ${strategy?.riskPerTrade ?? 1}%`} className="max-w-xs">
                            <input id="ns-risk" type="number" step="0.25" min="0.1" max="10" value={risk} onChange={(e) => setRisk(parseFloat(e.target.value))} className={`${inputCls} tabular-nums`} />
                        </Field>
                        <Toggle checked={funded} onChange={setFunded} label="Simular desafio de mesa proprietária (funded)" description="A sessão mostra se a meta foi atingida e se algum limite de perda foi violado." />
                        {funded && (
                            <div className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-surface-2/40 p-3 sm:grid-cols-3">
                                <Field label="Meta de lucro (%)">
                                    <input type="number" step="0.5" min="0.5" value={target} onChange={(e) => setTarget(Number(e.target.value) || 10)} className={inputCls} />
                                </Field>
                                <Field label="Perda diária máx. (%)">
                                    <input type="number" step="0.5" min="0.5" value={dailyLoss} onChange={(e) => setDailyLoss(Number(e.target.value) || 5)} className={inputCls} />
                                </Field>
                                <Field label="Perda total máx. (%)">
                                    <input type="number" step="0.5" min="0.5" value={totalLoss} onChange={(e) => setTotalLoss(Number(e.target.value) || 10)} className={inputCls} />
                                </Field>
                            </div>
                        )}
                    </Section>
                </div>

                {/* Summary */}
                <aside className="space-y-3 rounded-xl border border-line bg-surface p-4 lg:sticky lg:top-4">
                    <h2 className="text-sm font-semibold text-fg">Resumo</h2>
                    <dl className="space-y-2.5 text-xs">
                        {[
                            ['Sessão', name.trim() || '—'],
                            ['Estratégia', strategy?.name || '—'],
                            ['Capital inicial', fmtMoney(strategy?.startingCapital || 0, { decimals: 0 })],
                            ['Risco por trade', `${Number.isFinite(risk) ? risk : '—'}% (${fmtMoney(((strategy?.startingCapital || 0) * (risk || 0)) / 100, { decimals: 0 })})`],
                            ['Alvo', `1:${strategy?.rrTarget ?? 2}`],
                            ['Ativos', pairs.join(', ')],
                            ['Timeframe', timeframe],
                            ['Período', `${fmtIsoDate(fromDate)} → ${followToday ? 'hoje' : fmtIsoDate(end)} (${days} dias)`],
                            ['Funded', funded ? `meta ${target}% · diário ${dailyLoss}% · total ${totalLoss}%` : 'Não'],
                        ].map(([k, v]) => (
                            <div key={k} className="flex justify-between gap-3">
                                <dt className="shrink-0 text-fg-subtle">{k}</dt>
                                <dd className="text-right font-medium text-fg">{v}</dd>
                            </div>
                        ))}
                    </dl>
                    <div className="space-y-2 border-t border-line pt-3">
                        <Button type="submit" variant="brand" fullWidth icon={<Play size={14} fill="currentColor" />} disabled={touched && !valid}>
                            Criar e abrir replay
                        </Button>
                        <Button type="button" variant="outline" fullWidth onClick={() => submit(false)} disabled={touched && !valid}>
                            Criar sem abrir
                        </Button>
                        <Button type="button" variant="ghost" fullWidth onClick={() => navigate('/backtesting/sessions')}>
                            Cancelar
                        </Button>
                    </div>
                </aside>
            </form>
        </div>
    );
};
