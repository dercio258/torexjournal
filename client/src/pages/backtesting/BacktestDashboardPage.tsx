import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Check, ChevronRight, LayoutGrid, Plus, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { PnLChart } from '../../components/charts/PnLChart';
import { Segmented } from '../../components/charts/ChartCard';
import { ChipGroup, EmptyState, fmtDuration, fmtMoney, fmtNum, fmtRelative, KpiCard, Panel, pnlTone } from '../../components/backtesting/primitives';
import { aggregateStats, dailyPoints } from '../../components/backtesting/metrics';
import { useBacktestWorkspace } from './BacktestWorkspaceContext';
import { cn } from '../../lib/cn';

type Period = 'ALL' | '7D' | '30D' | '90D';
const PERIOD_DAYS: Record<Exclude<Period, 'ALL'>, number> = { '7D': 7, '30D': 30, '90D': 90 };
const GUIDE_KEY = 'torex_backtest_guide_dismissed';

const readDismissed = () => {
    try {
        return localStorage.getItem(GUIDE_KEY) === '1';
    } catch {
        return false;
    }
};

/** Onboarding that reflects real progress, and hides itself once done. */
const Guide = () => {
    const { strategies, sessions } = useBacktestWorkspace();
    const [dismissed, setDismissed] = useState(readDismissed);
    const steps = [
        { done: strategies.some((s) => (s.rules || []).length > 0), title: 'Escreva o plano da estratégia', text: 'Regras objetivas para validar cada entrada.', to: '/backtesting/strategies' },
        { done: sessions.length > 0, title: 'Crie uma sessão', text: 'Ativos, período e risco que vai treinar.', to: '/backtesting/sessions/new' },
        { done: sessions.some((s) => (s.orders || []).some((o) => o.status === 'WIN' || o.status === 'LOSS')), title: 'Feche o primeiro trade no replay', text: 'Avance as velas e deixe o stop ou o alvo decidir.', to: sessions[0] ? `/backtesting/replay/${sessions[0].id}` : '/backtesting/sessions/new' },
        { done: sessions.some((s) => (s.journalNotes || '').trim().length > 0), title: 'Registe as lições no journal', text: 'Notas por sessão, ao lado dos trades.', to: sessions[0] ? `/backtesting/sessions/${sessions[0].id}?view=journal` : '/backtesting/sessions' },
    ];
    const doneCount = steps.filter((s) => s.done).length;
    if (dismissed || doneCount === steps.length) return null;

    return (
        <Panel
            title="Primeiros passos"
            subtitle={`${doneCount} de ${steps.length} concluídos`}
            actions={
                <button
                    type="button"
                    aria-label="Ocultar primeiros passos"
                    onClick={() => {
                        setDismissed(true);
                        try {
                            localStorage.setItem(GUIDE_KEY, '1');
                        } catch {}
                    }}
                    className="rounded p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg"
                >
                    <X size={15} />
                </button>
            }
        >
            <ol className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
                {steps.map((s, i) => (
                    <li key={s.title}>
                        <Link to={s.to} className="flex h-full items-start gap-3 rounded-lg border border-line p-3 transition-colors hover:border-line-strong hover:bg-surface-2/50">
                            <span
                                className={cn(
                                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                                    s.done ? 'bg-accent text-accent-on' : 'bg-surface-3 text-fg-muted'
                                )}
                            >
                                {s.done ? <Check size={12} aria-label="Concluído" /> : i + 1}
                            </span>
                            <span className="min-w-0">
                                <span className={cn('block text-xs font-semibold', s.done ? 'text-fg-muted line-through' : 'text-fg')}>{s.title}</span>
                                <span className="mt-0.5 block text-[11px] text-fg-muted">{s.text}</span>
                            </span>
                        </Link>
                    </li>
                ))}
            </ol>
        </Panel>
    );
};

export const BacktestDashboardPage = () => {
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const { sessions, strategies } = useBacktestWorkspace();
    const strategy = params.get('strategy') || 'ALL';
    const [period, setPeriod] = useState<Period>('ALL');

    const scoped = useMemo(() => {
        const cutoff = period === 'ALL' ? 0 : Date.now() - PERIOD_DAYS[period] * 86400000;
        return sessions.filter((s) => (strategy === 'ALL' || s.strategyId === strategy) && new Date(s.updatedAt || s.createdAt).getTime() >= cutoff);
    }, [sessions, strategy, period]);

    const st = useMemo(() => aggregateStats(scoped), [scoped]);
    const daily = useMemo(() => dailyPoints(scoped.flatMap((s) => s.orders || [])), [scoped]);
    const seconds = scoped.reduce((a, s) => a + (s.timeInvestedSeconds || 0), 0);
    const none = st.trades === 0;
    const dash = (v: React.ReactNode) => (none ? '—' : v);

    const byStrategy = useMemo(
        () =>
            strategies
                .map((stg) => {
                    const ss = scoped.filter((s) => s.strategyId === stg.id);
                    return { strategy: stg, sessions: ss.length, ...aggregateStats(ss) };
                })
                .filter((r) => r.sessions > 0)
                .sort((a, b) => b.netProfit - a.netProfit),
        [strategies, scoped]
    );

    const recent = [...scoped].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 5);

    return (
        <div className="space-y-4">
            <Guide />

            <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 sm:p-4 md:flex-row md:items-center md:justify-between">
                <ChipGroup
                    label="Estratégia"
                    value={strategy}
                    onChange={(v) => setParams(v === 'ALL' ? {} : { strategy: v }, { replace: true })}
                    options={[{ value: 'ALL', label: 'Todas as estratégias' }, ...strategies.map((s) => ({ value: s.id, label: s.name }))]}
                />
                <div className="flex items-center gap-2">
                    <span className="text-[11px] text-fg-subtle">Sessões com atividade em</span>
                    <Segmented
                        label="Período"
                        value={period}
                        onChange={setPeriod}
                        options={[
                            { value: 'ALL', label: 'Tudo' },
                            { value: '7D', label: '7 d' },
                            { value: '30D', label: '30 d' },
                            { value: '90D', label: '90 d' },
                        ]}
                    />
                </div>
            </div>

            {scoped.length === 0 ? (
                <EmptyState
                    icon={<LayoutGrid size={20} />}
                    title="Sem sessões neste filtro"
                    description="Escolha outra estratégia ou período, ou crie uma sessão para começar a medir."
                    action={
                        <Button variant="brand" icon={<Plus size={15} />} onClick={() => navigate('/backtesting/sessions/new')}>
                            Nova sessão
                        </Button>
                    }
                />
            ) : (
                <>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        <KpiCard label="P&L líquido" value={dash(fmtMoney(st.netProfit, { sign: true }))} tone={none ? undefined : pnlTone(st.netProfit)} hint={`${scoped.length} ${scoped.length === 1 ? 'sessão' : 'sessões'}`} />
                        <KpiCard label="Trades fechados" value={st.trades} hint={none ? 'Nenhum ainda' : `${st.wins} ganhos · ${st.losses} perdas`} />
                        <KpiCard label="Taxa de acerto" value={dash(`${fmtNum(st.winRate, 1)}%`)} />
                        <KpiCard label="Profit factor" value={dash(st.profitFactor === null ? 'Sem perdas' : fmtNum(st.profitFactor))} hint="Lucro bruto ÷ perda bruta" />
                        <KpiCard label="Expectativa" value={dash(fmtMoney(st.expectancy, { sign: true }))} tone={none ? undefined : pnlTone(st.expectancy)} hint="Média por trade" />
                        <KpiCard label="R médio" value={dash(`${fmtNum(st.avgR)}R`)} tone={none ? undefined : pnlTone(st.avgR)} />
                        <KpiCard label="Pior drawdown" value={dash(st.maxDrawdown > 0 ? `−${fmtMoney(st.maxDrawdown)}` : fmtMoney(0))} hint={none ? undefined : `${fmtNum(st.maxDrawdownPct)}% numa sessão`} />
                        <KpiCard label="Tempo de prática" value={fmtDuration(seconds)} hint="Tempo com o replay aberto" />
                    </div>

                    <div className="space-y-1">
                        <PnLChart data={daily} />
                        <p className="px-1 text-[11px] text-fg-subtle">Soma de todas as sessões filtradas, pela data de mercado do fecho de cada trade (UTC).</p>
                    </div>

                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
                        <Panel title="Comparação de estratégias" subtitle="Ordenado por P&L líquido" bodyClassName="p-0">
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[560px] text-sm">
                                    <thead>
                                        <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-fg-subtle">
                                            <th className="px-4 py-2 font-semibold">Estratégia</th>
                                            <th className="px-3 py-2 text-right font-semibold">Sessões</th>
                                            <th className="px-3 py-2 text-right font-semibold">Trades</th>
                                            <th className="px-3 py-2 text-right font-semibold">Acerto</th>
                                            <th className="px-3 py-2 text-right font-semibold">PF</th>
                                            <th className="px-3 py-2 text-right font-semibold">R médio</th>
                                            <th className="px-4 py-2 text-right font-semibold">P&L</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-line">
                                        {byStrategy.map((r) => (
                                            <tr key={r.strategy.id} className="hover:bg-surface-2/50">
                                                <td className="px-4 py-2">
                                                    <Link to={`/backtesting/strategies?id=${r.strategy.id}`} className="font-semibold text-fg hover:underline">
                                                        {r.strategy.name}
                                                    </Link>
                                                </td>
                                                <td className="px-3 py-2 text-right tabular-nums">{r.sessions}</td>
                                                <td className="px-3 py-2 text-right tabular-nums">{r.trades}</td>
                                                <td className="px-3 py-2 text-right tabular-nums">{r.trades ? `${fmtNum(r.winRate, 1)}%` : '—'}</td>
                                                <td className="px-3 py-2 text-right tabular-nums">{r.trades ? (r.profitFactor === null ? '∞' : fmtNum(r.profitFactor)) : '—'}</td>
                                                <td className={cn('px-3 py-2 text-right tabular-nums', r.trades ? pnlTone(r.avgR) : '')}>{r.trades ? `${fmtNum(r.avgR)}R` : '—'}</td>
                                                <td className={cn('px-4 py-2 text-right font-semibold tabular-nums', r.trades ? pnlTone(r.netProfit) : 'text-fg-subtle')}>
                                                    {r.trades ? fmtMoney(r.netProfit, { sign: true }) : '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </Panel>

                        <Panel title="Atividade recente" bodyClassName="p-0">
                            <ul className="divide-y divide-line">
                                {recent.map((s) => {
                                    const ss = aggregateStats([s]);
                                    return (
                                        <li key={s.id}>
                                            <Link to={`/backtesting/sessions/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/50">
                                                <div className="min-w-0 flex-1">
                                                    <p className="truncate text-sm font-semibold text-fg">{s.name}</p>
                                                    <p className="truncate text-[11px] text-fg-muted">
                                                        {s.strategyName} · {fmtRelative(s.updatedAt)}
                                                    </p>
                                                </div>
                                                <span className={cn('text-sm font-semibold tabular-nums', ss.trades ? pnlTone(ss.netProfit) : 'text-fg-subtle')}>
                                                    {ss.trades ? fmtMoney(ss.netProfit, { sign: true, decimals: 0 }) : '—'}
                                                </span>
                                                <ChevronRight size={15} className="text-fg-subtle" aria-hidden />
                                            </Link>
                                        </li>
                                    );
                                })}
                            </ul>
                        </Panel>
                    </div>
                </>
            )}
        </div>
    );
};
