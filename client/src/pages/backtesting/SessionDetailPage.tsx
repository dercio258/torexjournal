import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BookOpen, CheckCircle2, LayoutGrid, Play, RotateCcw, Settings2, ShieldCheck } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { PnLChart } from '../../components/charts/PnLChart';
import {
    Badge,
    Breadcrumbs,
    ChipGroup,
    ConfirmDeleteButton,
    EmptyState,
    Field,
    fmtDateTime,
    fmtDuration,
    fmtIsoDate,
    fmtMoney,
    fmtNum,
    fmtRelative,
    inputCls,
    KpiCard,
    Panel,
    pnlTone,
    SubTabs,
    Toggle,
} from '../../components/backtesting/primitives';
import { bySymbol, dailyPoints, FundedProgress, fundedProgress, openOrders, sessionStats } from '../../components/backtesting/metrics';
import { useBacktestWorkspace } from './BacktestWorkspaceContext';
import type { BacktestReplaySession } from '../../services/backtestWorkspaceStore';
import type { ReplayOrder } from '../../components/kline-replay/types';
import { cn } from '../../lib/cn';

type View = 'overview' | 'journal' | 'settings';

/* --------------------------------------------------------------- overview */

const Meter = ({ label, value, limit, kind }: { label: string; value: number; limit: number; kind: 'target' | 'limit' }) => {
    const pct = Math.max(0, Math.min(100, (Math.max(0, value) / (limit || 1)) * 100));
    const bad = kind === 'limit' && value >= limit;
    const good = kind === 'target' && value >= limit;
    return (
        <div>
            <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-semibold text-fg">{label}</span>
                <span className="tabular-nums text-fg-muted">
                    <strong className={cn('font-semibold', bad ? 'text-danger-fg' : good ? 'text-accent-fg' : 'text-fg')}>{fmtNum(value)}%</strong> de {fmtNum(limit, 1)}%
                </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3" role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={limit}>
                <div className={cn('h-full rounded-full', kind === 'target' ? 'bg-data-pos' : bad ? 'bg-data-neg' : 'bg-amber-500')} style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
};

const FundedPanel = ({ f }: { f: FundedProgress }) => (
    <Panel
        title={
            <span className="flex items-center gap-1.5">
                <ShieldCheck size={15} className="text-fg-subtle" aria-hidden /> Desafio funded
            </span>
        }
        actions={<Badge tone={f.state === 'failed' ? 'danger' : f.state === 'passed' ? 'accent' : 'warn'}>{f.state === 'failed' ? 'Violado' : f.state === 'passed' ? 'Aprovado' : 'Em curso'}</Badge>}
    >
        <div className="space-y-4">
            <Meter label="Meta de lucro" value={f.profitPct} limit={f.targetPct} kind="target" />
            <Meter label="Pior dia (perda)" value={f.worstDayPct} limit={f.maxDailyPct} kind="limit" />
            <Meter label="Queda abaixo do capital" value={f.totalDdPct} limit={f.maxTotalPct} kind="limit" />
            {f.breach && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger-fg">{f.breach}</p>}
            <p className="text-[11px] text-fg-subtle">Medido sobre o capital inicial, com o dia de mercado do fecho de cada trade.</p>
        </div>
    </Panel>
);

const Overview = ({ s }: { s: BacktestReplaySession }) => {
    const st = sessionStats(s);
    const daily = useMemo(() => dailyPoints(s.orders), [s.orders]);
    const symbols = useMemo(() => bySymbol(s.orders), [s.orders]);
    const f = fundedProgress(s);
    const none = st.trades === 0;
    const dash = (v: React.ReactNode) => (none ? '—' : v);

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <KpiCard label="Saldo" value={fmtMoney(st.realizedBalance)} hint={`Capital ${fmtMoney(s.startingCapital, { decimals: 0 })}`} />
                <KpiCard label="P&L líquido" value={dash(fmtMoney(st.netProfit, { sign: true }))} tone={none ? undefined : pnlTone(st.netProfit)} hint={none ? 'Sem trades fechados' : `${fmtNum((st.netProfit / (s.startingCapital || 1)) * 100)}% do capital`} />
                <KpiCard label="Trades" value={st.trades} hint={none ? '—' : `${st.wins} ganhos · ${st.losses} perdas`} />
                <KpiCard label="Taxa de acerto" value={dash(`${fmtNum(st.winRate, 1)}%`)} />
                <KpiCard label="Profit factor" value={dash(st.profitFactor === null ? 'Sem perdas' : fmtNum(st.profitFactor))} hint="Lucro bruto ÷ perda bruta" />
                <KpiCard label="Expectativa" value={dash(fmtMoney(st.expectancy, { sign: true }))} tone={none ? undefined : pnlTone(st.expectancy)} hint="Média por trade" />
                <KpiCard label="R médio" value={dash(`${fmtNum(st.avgR)}R`)} tone={none ? undefined : pnlTone(st.avgR)} />
                <KpiCard label="Drawdown máx." value={dash(st.maxDrawdown > 0 ? `−${fmtMoney(st.maxDrawdown)}` : fmtMoney(0))} hint={none ? undefined : `${fmtNum(st.maxDrawdownPct)}% do pico`} />
            </div>

            <div className={cn('grid grid-cols-1 gap-4', f && 'xl:grid-cols-[minmax(0,1fr)_20rem]')}>
                <div className="min-w-0 space-y-1">
                    <PnLChart data={daily} />
                    <p className="px-1 text-[11px] text-fg-subtle">Agrupado pela data de mercado em que cada trade fechou no replay (UTC).</p>
                </div>
                {f && <FundedPanel f={f} />}
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Panel title="Resultado por ativo" bodyClassName="p-0">
                    {symbols.length === 0 ? (
                        <p className="px-5 py-8 text-center text-xs text-fg-muted">Sem trades fechados ainda.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-fg-subtle">
                                        <th className="px-4 py-2 font-semibold">Ativo</th>
                                        <th className="px-4 py-2 text-right font-semibold">Trades</th>
                                        <th className="px-4 py-2 text-right font-semibold">Acerto</th>
                                        <th className="px-4 py-2 text-right font-semibold">R médio</th>
                                        <th className="px-4 py-2 text-right font-semibold">P&L</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-line">
                                    {symbols.map((r) => (
                                        <tr key={r.symbol}>
                                            <td className="px-4 py-2 font-semibold text-fg">{r.symbol}</td>
                                            <td className="px-4 py-2 text-right tabular-nums">{r.trades}</td>
                                            <td className="px-4 py-2 text-right tabular-nums">{Math.round((r.wins / r.trades) * 100)}%</td>
                                            <td className={cn('px-4 py-2 text-right tabular-nums', pnlTone(r.avgR))}>{fmtNum(r.avgR)}R</td>
                                            <td className={cn('px-4 py-2 text-right font-semibold tabular-nums', pnlTone(r.pnl))}>{fmtMoney(r.pnl, { sign: true })}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Panel>

                <Panel title="Sessão">
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                        {[
                            ['Estratégia', s.strategyName],
                            ['Ativos', s.pairs.join(', ')],
                            ['Timeframe', s.timeframe],
                            ['Período', `${fmtIsoDate(s.fromDate)} → ${s.keepEndFollowingToday ? 'hoje' : fmtIsoDate(s.toDate)}`],
                            ['Risco por trade', `${s.riskPerTrade}%`],
                            ['Alvo', `1:${s.rrTarget}`],
                            ['Custos', `spread ${s.spread || 0} · comissão ${fmtMoney(s.commission || 0)}`],
                            ['Ponto do replay', fmtDateTime(s.replayTimestamp)],
                            ['Tempo investido', fmtDuration(s.timeInvestedSeconds)],
                            ['Última atividade', fmtRelative(s.updatedAt)],
                        ].map(([k, v]) => (
                            <div key={k} className="min-w-0">
                                <dt className="text-[11px] text-fg-subtle">{k}</dt>
                                <dd className="mt-0.5 truncate font-medium text-fg" title={String(v)}>
                                    {v}
                                </dd>
                            </div>
                        ))}
                    </dl>
                </Panel>
            </div>
        </div>
    );
};

/* ---------------------------------------------------------------- journal */

type TradeFilter = 'all' | 'win' | 'loss' | 'open';

const SIDE: Record<string, string> = { BUY: 'Compra', SELL: 'Venda' };
const REASON: Record<string, string> = { SL: 'Stop', TP: 'Alvo', MANUAL: 'Manual' };
const STATUS: Record<ReplayOrder['status'], string> = { OPEN: 'Aberta', PENDING: 'Pendente', WIN: 'Ganho', LOSS: 'Perda', CLOSED: 'Cancelada' };

const Journal = ({ s, onSaveNotes }: { s: BacktestReplaySession; onSaveNotes: (n: string) => void }) => {
    const navigate = useNavigate();
    const [notes, setNotes] = useState(s.journalNotes || '');
    const [saved, setSaved] = useState(true);
    const [filter, setFilter] = useState<TradeFilter>('all');
    useEffect(() => {
        setNotes(s.journalNotes || '');
        setSaved(true);
    }, [s.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const orders = [...(s.orders || [])].sort((a, b) => b.openedAt - a.openedAt);
    const count = (f: TradeFilter) =>
        orders.filter((o) => f === 'all' || (f === 'win' && o.status === 'WIN') || (f === 'loss' && o.status === 'LOSS') || (f === 'open' && (o.status === 'OPEN' || o.status === 'PENDING'))).length;
    const rows = orders.filter(
        (o) => filter === 'all' || (filter === 'win' && o.status === 'WIN') || (filter === 'loss' && o.status === 'LOSS') || (filter === 'open' && (o.status === 'OPEN' || o.status === 'PENDING'))
    );
    const dp = (v?: number) => (v === undefined || v === null ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: 5 }));

    const save = () => {
        onSaveNotes(notes);
        setSaved(true);
    };

    return (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <Panel
                title="Trades da sessão"
                subtitle="Horários em data de mercado do replay."
                actions={
                    <ChipGroup
                        label="Filtrar trades"
                        value={filter}
                        onChange={setFilter}
                        options={[
                            { value: 'all', label: 'Todos', count: count('all') },
                            { value: 'win', label: 'Ganhos', count: count('win') },
                            { value: 'loss', label: 'Perdas', count: count('loss') },
                            { value: 'open', label: 'Abertas', count: count('open') },
                        ]}
                    />
                }
                bodyClassName="p-0"
            >
                {orders.length === 0 ? (
                    <div className="p-5">
                        <EmptyState
                            title="Nenhum trade registado"
                            description="Os trades feitos no replay aparecem aqui com entrada, saída, motivo e resultado em R."
                            action={
                                <Button variant="brand" size="sm" icon={<Play size={13} fill="currentColor" />} onClick={() => navigate(`/backtesting/replay/${s.id}`)}>
                                    Abrir replay
                                </Button>
                            }
                            className="border-0 py-8"
                        />
                    </div>
                ) : rows.length === 0 ? (
                    <p className="px-5 py-8 text-center text-xs text-fg-muted">Nenhum trade neste filtro.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[760px] text-sm">
                            <thead>
                                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-fg-subtle">
                                    <th className="px-4 py-2 font-semibold">Abertura</th>
                                    <th className="px-3 py-2 font-semibold">Ativo</th>
                                    <th className="px-3 py-2 font-semibold">Lado</th>
                                    <th className="px-3 py-2 text-right font-semibold">Entrada</th>
                                    <th className="px-3 py-2 text-right font-semibold">Stop / Alvo</th>
                                    <th className="px-3 py-2 text-right font-semibold">Saída</th>
                                    <th className="px-3 py-2 font-semibold">Estado</th>
                                    <th className="px-3 py-2 text-right font-semibold">R</th>
                                    <th className="px-4 py-2 text-right font-semibold">P&L</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                                {rows.map((o) => (
                                    <tr key={o.id} className="hover:bg-surface-2/50">
                                        <td className="whitespace-nowrap px-4 py-2 tabular-nums text-fg-muted">{fmtDateTime(o.openedAt)}</td>
                                        <td className="px-3 py-2 font-semibold text-fg">{o.symbol}</td>
                                        <td className="px-3 py-2">{SIDE[o.side]}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">{dp(o.entryPrice)}</td>
                                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-fg-muted">
                                            {dp(o.stopLoss)} / {dp(o.takeProfit)}
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums">{dp(o.exitPrice)}</td>
                                        <td className="whitespace-nowrap px-3 py-2">
                                            <span className="text-fg">{STATUS[o.status]}</span>
                                            {o.exitReason && <span className="text-fg-subtle"> · {REASON[o.exitReason]}</span>}
                                        </td>
                                        <td className={cn('px-3 py-2 text-right tabular-nums', pnlTone(o.rMultiple ?? 0, true))}>
                                            {o.rMultiple !== undefined ? `${o.rMultiple > 0 ? '+' : ''}${fmtNum(o.rMultiple)}R` : '—'}
                                        </td>
                                        <td className={cn('px-4 py-2 text-right font-semibold tabular-nums', pnlTone(o.pnl, true))}>{fmtMoney(o.pnl, { sign: true })}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Panel>

            <Panel
                title="Notas da sessão"
                subtitle="Racional, erros e lições. Também editável no replay."
                actions={
                    <Button variant={saved ? 'outline' : 'brand'} size="sm" onClick={save} disabled={saved}>
                        {saved ? 'Guardado' : 'Guardar'}
                    </Button>
                }
            >
                <textarea
                    value={notes}
                    onChange={(e) => {
                        setNotes(e.target.value);
                        setSaved(false);
                    }}
                    onBlur={() => !saved && save()}
                    rows={14}
                    placeholder="Ex.: entradas só após sweep da máxima asiática; evitei operar antes de notícia de alto impacto…"
                    className={`${inputCls} resize-y leading-relaxed`}
                    aria-label="Notas da sessão"
                />
            </Panel>
        </div>
    );
};

/* --------------------------------------------------------------- settings */

const SettingsView = ({ s, onSave, onDelete }: { s: BacktestReplaySession; onSave: (p: Partial<BacktestReplaySession>) => void; onDelete: () => void }) => {
    const [name, setName] = useState(s.name);
    const [toDate, setToDate] = useState(s.toDate);
    const [follow, setFollow] = useState(s.keepEndFollowingToday);
    const [risk, setRisk] = useState(s.riskPerTrade);
    const [rr, setRr] = useState(s.rrTarget);
    const [funded, setFunded] = useState(s.fundedMode);
    const [done, setDone] = useState(false);
    const today = new Date().toISOString().slice(0, 10);
    const invalid = !name.trim() || (!follow && toDate <= s.fromDate) || !(risk > 0 && risk <= 10) || !(rr > 0);

    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <Panel title="Configuração" subtitle="Ativos e início do período ficam fixos depois de criada a sessão.">
                <form
                    className="space-y-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (invalid) return;
                        onSave({ name: name.trim(), toDate: follow ? today : toDate, keepEndFollowingToday: follow, riskPerTrade: risk, rrTarget: rr, fundedMode: funded });
                        setDone(true);
                        setTimeout(() => setDone(false), 2000);
                    }}
                >
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <Field label="Nome" htmlFor="ss-name">
                            <input id="ss-name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
                        </Field>
                        <Field label="Fim do período" htmlFor="ss-to" hint={`Início: ${fmtIsoDate(s.fromDate)}`}>
                            <input id="ss-to" type="date" value={follow ? today : toDate} disabled={follow} min={s.fromDate} max={today} onChange={(e) => setToDate(e.target.value)} className={inputCls} />
                        </Field>
                        <Field label="Risco por trade (%)" htmlFor="ss-risk">
                            <input id="ss-risk" type="number" step="0.25" min="0.1" max="10" value={risk} onChange={(e) => setRisk(parseFloat(e.target.value))} className={inputCls} />
                        </Field>
                        <Field label="Alvo R:R" htmlFor="ss-rr">
                            <input id="ss-rr" type="number" step="0.5" min="0.5" value={rr} onChange={(e) => setRr(parseFloat(e.target.value))} className={inputCls} />
                        </Field>
                    </div>
                    <Toggle checked={follow} onChange={setFollow} label="Fim acompanha a data de hoje" />
                    <Toggle checked={funded.enabled} onChange={(v) => setFunded({ ...funded, enabled: v })} label="Desafio funded" description="Meta de lucro e limites de perda sobre o capital inicial." />
                    {funded.enabled && (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <Field label="Meta (%)">
                                <input type="number" step="0.5" value={funded.profitTargetPct} onChange={(e) => setFunded({ ...funded, profitTargetPct: Number(e.target.value) || 10 })} className={inputCls} />
                            </Field>
                            <Field label="Perda diária máx. (%)">
                                <input type="number" step="0.5" value={funded.maxDailyLossPct} onChange={(e) => setFunded({ ...funded, maxDailyLossPct: Number(e.target.value) || 5 })} className={inputCls} />
                            </Field>
                            <Field label="Perda total máx. (%)">
                                <input type="number" step="0.5" value={funded.maxTotalLossPct} onChange={(e) => setFunded({ ...funded, maxTotalLossPct: Number(e.target.value) || 10 })} className={inputCls} />
                            </Field>
                        </div>
                    )}
                    <div className="flex items-center justify-end gap-3 border-t border-line pt-4">
                        {done && <span className="text-xs text-accent-fg">Alterações guardadas</span>}
                        <Button type="submit" variant="brand" size="sm" disabled={invalid}>
                            Guardar alterações
                        </Button>
                    </div>
                </form>
            </Panel>

            <Panel title="Zona de perigo">
                <p className="mb-3 text-xs text-fg-muted">Excluir remove a sessão, os trades e as notas deste browser. Não há como desfazer.</p>
                <ConfirmDeleteButton onConfirm={onDelete} label="Excluir sessão" />
            </Panel>
        </div>
    );
};

/* ------------------------------------------------------------------- page */

export const SessionDetailPage = () => {
    const { sessionId } = useParams();
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const { sessionById, updateSession, deleteSession } = useBacktestWorkspace();
    const s = sessionById(sessionId);
    const view = (['overview', 'journal', 'settings'].includes(params.get('view') || '') ? params.get('view') : 'overview') as View;

    if (!s) {
        return (
            <EmptyState
                title="Sessão não encontrada"
                description="Pode ter sido excluída ou criada noutro browser (as sessões ficam guardadas localmente)."
                action={
                    <Link to="/backtesting/sessions" className="text-sm font-semibold text-accent-fg hover:underline">
                        Voltar às sessões
                    </Link>
                }
            />
        );
    }

    const st = sessionStats(s);
    const open = openOrders(s.orders).length;
    const remove = () => {
        deleteSession(s.id);
        navigate('/backtesting/sessions');
    };

    return (
        <div className="space-y-4">
            <Breadcrumbs items={[{ label: 'Sessões', to: '/backtesting/sessions' }, { label: s.name }]} />

            <header className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-xl font-bold text-fg">{s.name}</h2>
                        <Badge tone={s.status === 'ACTIVE' ? 'accent' : 'neutral'}>{s.status === 'ACTIVE' ? 'Ativa' : 'Concluída'}</Badge>
                    </div>
                    <p className="flex flex-wrap gap-x-2 text-xs text-fg-muted">
                        <Link to={`/backtesting/strategies?id=${s.strategyId}`} className="font-semibold text-fg hover:underline">
                            {s.strategyName}
                        </Link>
                        <span aria-hidden>·</span>
                        <span>{s.pairs.join(', ')}</span>
                        <span aria-hidden>·</span>
                        <span>{s.timeframe}</span>
                        <span aria-hidden>·</span>
                        <span className={cn('font-semibold tabular-nums', st.trades ? pnlTone(st.netProfit) : '')}>
                            {st.trades ? `${fmtMoney(st.netProfit, { sign: true })} em ${st.trades} trades` : 'sem trades fechados'}
                        </span>
                        {open > 0 && <span>· {open} em aberto</span>}
                    </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {s.status === 'ACTIVE' ? (
                        <Button variant="outline" size="sm" icon={<CheckCircle2 size={14} />} onClick={() => updateSession(s.id, { status: 'COMPLETED' })}>
                            Marcar concluída
                        </Button>
                    ) : (
                        <Button variant="outline" size="sm" icon={<RotateCcw size={14} />} onClick={() => updateSession(s.id, { status: 'ACTIVE' })}>
                            Reabrir
                        </Button>
                    )}
                    <Button variant="brand" size="sm" icon={<Play size={13} fill="currentColor" />} onClick={() => navigate(`/backtesting/replay/${s.id}`)}>
                        {s.status === 'ACTIVE' ? 'Continuar replay' : 'Rever no replay'}
                    </Button>
                </div>
            </header>

            <SubTabs
                label="Vistas da sessão"
                value={view}
                onChange={(v) => setParams(v === 'overview' ? {} : { view: v }, { replace: true })}
                options={[
                    { value: 'overview', label: 'Visão geral', icon: <LayoutGrid size={15} /> },
                    { value: 'journal', label: 'Journal', icon: <BookOpen size={15} />, count: (s.orders || []).length },
                    { value: 'settings', label: 'Configuração', icon: <Settings2 size={15} /> },
                ]}
            />

            {view === 'overview' && <Overview s={s} />}
            {view === 'journal' && <Journal s={s} onSaveNotes={(n) => updateSession(s.id, { journalNotes: n })} />}
            {view === 'settings' && <SettingsView key={s.id} s={s} onSave={(p) => updateSession(s.id, p)} onDelete={remove} />}
        </div>
    );
};
