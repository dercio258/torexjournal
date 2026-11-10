import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, ChevronRight, Layers, Pencil, Plus, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import {
    Badge,
    ConfirmDeleteButton,
    EmptyState,
    fmtIsoDate,
    fmtMoney,
    fmtNum,
    inputCls,
    KpiCard,
    Panel,
    pnlTone,
} from '../../components/backtesting/primitives';
import { aggregateStats } from '../../components/backtesting/metrics';
import { StrategyFormModal, StrategyFormValues } from '../../components/backtesting/StrategyFormModal';
import { useBacktestWorkspace } from './BacktestWorkspaceContext';
import type { BacktestStrategy } from '../../services/backtestWorkspaceStore';
import { cn } from '../../lib/cn';

const Rules = ({ strategy, onChange }: { strategy: BacktestStrategy; onChange: (rules: BacktestStrategy['rules']) => void }) => {
    const [text, setText] = useState('');
    const rules = strategy.rules || [];
    const add = () => {
        if (!text.trim()) return;
        onChange([...rules, { id: `rule_${Date.now()}`, text: text.trim(), required: true }]);
        setText('');
    };
    return (
        <Panel title="Plano de trading" subtitle={rules.length ? `${rules.length} ${rules.length === 1 ? 'regra' : 'regras'} para validar cada entrada` : 'Sem regras: nada é exigido ao operar.'}>
            <div className="space-y-3">
                {rules.length > 0 && (
                    <ol className="space-y-1.5">
                        {rules.map((r, i) => (
                            <li key={r.id} className="group flex items-start gap-2.5 rounded-lg border border-line bg-surface-2/40 px-3 py-2 text-sm">
                                <span className="mt-0.5 w-4 shrink-0 text-right text-[11px] tabular-nums text-fg-subtle">{i + 1}</span>
                                <span className="flex-1 text-fg">{r.text}</span>
                                <button
                                    type="button"
                                    onClick={() => onChange(rules.map((x) => (x.id === r.id ? { ...x, required: !x.required } : x)))}
                                    className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold', r.required ? 'bg-accent/10 text-accent-fg' : 'bg-surface-3 text-fg-muted')}
                                    title="Alternar obrigatória / opcional"
                                >
                                    {r.required ? 'Obrigatória' : 'Opcional'}
                                </button>
                                <button type="button" onClick={() => onChange(rules.filter((x) => x.id !== r.id))} aria-label={`Remover regra ${i + 1}`} className="shrink-0 rounded p-0.5 text-fg-subtle hover:text-danger-fg">
                                    <X size={14} />
                                </button>
                            </li>
                        ))}
                    </ol>
                )}
                <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                        e.preventDefault();
                        add();
                    }}
                >
                    <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Nova regra (ex.: só entrar após sweep da máxima asiática)" aria-label="Nova regra" className={inputCls} />
                    <Button type="submit" variant="outline" size="sm" icon={<Plus size={14} />} disabled={!text.trim()}>
                        Adicionar
                    </Button>
                </form>
            </div>
        </Panel>
    );
};

export const StrategiesPage = () => {
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const { strategies, sessions, createStrategy, updateStrategy, deleteStrategy } = useBacktestWorkspace();

    const selectedId = params.get('id') || strategies[0]?.id;
    const selected = strategies.find((s) => s.id === selectedId) || strategies[0];
    const creating = params.get('new') === '1';
    const [editing, setEditing] = useState(false);

    const statsById = useMemo(() => {
        const m = new Map<string, ReturnType<typeof aggregateStats> & { sessions: number }>();
        strategies.forEach((st) => {
            const ss = sessions.filter((s) => s.strategyId === st.id);
            m.set(st.id, { ...aggregateStats(ss), sessions: ss.length });
        });
        return m;
    }, [strategies, sessions]);

    const select = (id: string) => setParams({ id }, { replace: true });
    const closeModal = () => {
        setEditing(false);
        if (creating) setParams(selected ? { id: selected.id } : {}, { replace: true });
    };
    const submit = (v: StrategyFormValues) => {
        if (editing && selected) {
            updateStrategy(selected.id, v);
            setEditing(false);
        } else {
            const created = createStrategy({ ...v, symbols: [v.primarySymbol] });
            setParams({ id: created.id }, { replace: true });
        }
    };

    const modal = <StrategyFormModal open={creating || editing} initial={editing ? selected : undefined} onClose={closeModal} onSubmit={submit} />;

    if (!selected) {
        return (
            <>
                <EmptyState icon={<Layers size={20} />} title="Sem estratégias" action={<Button variant="brand" onClick={() => setParams({ new: '1' })}>Criar estratégia</Button>} />
                {modal}
            </>
        );
    }

    const st = statsById.get(selected.id)!;
    const stratSessions = sessions.filter((s) => s.strategyId === selected.id);
    const none = st.trades === 0;

    return (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
            {/* List */}
            <aside className="rounded-xl border border-line bg-surface p-2">
                <div className="flex items-center justify-between px-2 py-1.5">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">Estratégias</h2>
                    <button type="button" onClick={() => setParams({ new: '1' })} aria-label="Nova estratégia" className="rounded p-1 text-fg-muted hover:bg-surface-2 hover:text-fg">
                        <Plus size={15} />
                    </button>
                </div>
                <ul className="space-y-0.5">
                    {strategies.map((s) => {
                        const ss = statsById.get(s.id)!;
                        const active = s.id === selected.id;
                        return (
                            <li key={s.id}>
                                <button
                                    type="button"
                                    onClick={() => select(s.id)}
                                    aria-current={active || undefined}
                                    className={cn('w-full rounded-lg px-2.5 py-2 text-left transition-colors', active ? 'bg-surface-2' : 'hover:bg-surface-2/60')}
                                >
                                    <span className={cn('block truncate text-sm font-semibold', active ? 'text-fg' : 'text-fg-muted')}>{s.name}</span>
                                    <span className="mt-0.5 flex justify-between gap-2 text-[11px] text-fg-subtle">
                                        <span>
                                            {ss.sessions} {ss.sessions === 1 ? 'sessão' : 'sessões'} · {ss.trades} trades
                                        </span>
                                        {ss.trades > 0 && <span className={cn('tabular-nums', pnlTone(ss.netProfit))}>{fmtMoney(ss.netProfit, { sign: true, decimals: 0 })}</span>}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </aside>

            {/* Detail */}
            <div className="min-w-0 space-y-4">
                <header className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 sm:p-5 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                            <h2 className="truncate text-xl font-bold text-fg">{selected.name}</h2>
                            <Badge tone="neutral">{selected.sessionTag}</Badge>
                        </div>
                        {selected.description && <p className="max-w-2xl text-sm text-fg-muted">{selected.description}</p>}
                        <p className="text-xs text-fg-subtle">
                            {selected.primarySymbol} · risco {selected.riskPerTrade}% · alvo 1:{selected.rrTarget} · capital {fmtMoney(selected.startingCapital, { decimals: 0 })}
                        </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <Button variant="outline" size="sm" icon={<Pencil size={13} />} onClick={() => setEditing(true)}>
                            Editar
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => navigate(`/backtesting/dashboard?strategy=${selected.id}`)}>
                            Dashboard
                        </Button>
                        <Button variant="brand" size="sm" icon={<Plus size={14} />} onClick={() => navigate(`/backtesting/sessions/new?strategy=${selected.id}`)}>
                            Nova sessão
                        </Button>
                        {strategies.length > 1 && (
                            <ConfirmDeleteButton
                                label="Excluir estratégia"
                                onConfirm={() => {
                                    deleteStrategy(selected.id);
                                    setParams({}, { replace: true });
                                }}
                            />
                        )}
                    </div>
                </header>

                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <KpiCard label="Sessões" value={st.sessions} hint={`${stratSessions.filter((s) => s.status === 'ACTIVE').length} ativas`} />
                    <KpiCard label="Trades fechados" value={st.trades} hint={none ? '—' : `${st.wins} ganhos · ${st.losses} perdas`} />
                    <KpiCard label="P&L líquido" value={none ? '—' : fmtMoney(st.netProfit, { sign: true })} tone={none ? undefined : pnlTone(st.netProfit)} hint="Soma das sessões" />
                    <KpiCard
                        label="Acerto · PF"
                        value={none ? '—' : `${fmtNum(st.winRate, 1)}% · ${st.profitFactor === null ? '∞' : fmtNum(st.profitFactor)}`}
                        hint={none ? undefined : `R médio ${fmtNum(st.avgR)}R`}
                    />
                </div>

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <Rules strategy={selected} onChange={(rules) => updateStrategy(selected.id, { rules })} />

                    <Panel
                        title="Sessões desta estratégia"
                        actions={
                            stratSessions.length > 0 && (
                                <Link to="/backtesting/sessions" className="text-xs font-semibold text-fg-muted hover:text-fg">
                                    Ver todas
                                </Link>
                            )
                        }
                        bodyClassName="p-0"
                    >
                        {stratSessions.length === 0 ? (
                            <p className="px-5 py-8 text-center text-xs text-fg-muted">
                                Ainda sem sessões.{' '}
                                <Link to={`/backtesting/sessions/new?strategy=${selected.id}`} className="font-semibold text-accent-fg hover:underline">
                                    Criar a primeira
                                </Link>
                            </p>
                        ) : (
                            <ul className="divide-y divide-line">
                                {stratSessions.map((s) => {
                                    const ss = aggregateStats([s]);
                                    return (
                                        <li key={s.id}>
                                            <Link to={`/backtesting/sessions/${s.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/50">
                                                <div className="min-w-0 flex-1">
                                                    <p className="flex items-center gap-2 truncate text-sm font-semibold text-fg">
                                                        {s.name}
                                                        {s.status === 'COMPLETED' && <CheckCircle2 size={13} className="shrink-0 text-fg-subtle" aria-label="Concluída" />}
                                                    </p>
                                                    <p className="truncate text-[11px] text-fg-muted">
                                                        {s.pairs.join(', ')} · {fmtIsoDate(s.fromDate)} → {s.keepEndFollowingToday ? 'hoje' : fmtIsoDate(s.toDate)}
                                                    </p>
                                                </div>
                                                <span className={cn('shrink-0 text-sm font-semibold tabular-nums', ss.trades ? pnlTone(ss.netProfit) : 'text-fg-subtle')}>
                                                    {ss.trades ? fmtMoney(ss.netProfit, { sign: true }) : '—'}
                                                </span>
                                                <ChevronRight size={15} className="shrink-0 text-fg-subtle" aria-hidden />
                                            </Link>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </Panel>
                </div>
            </div>
            {modal}
        </div>
    );
};
