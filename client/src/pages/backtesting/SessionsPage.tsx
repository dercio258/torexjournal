import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, FolderKanban, Play, Plus, Search, ShieldCheck } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import {
    Badge,
    ChipGroup,
    ConfirmDeleteButton,
    EmptyState,
    fmtIsoDate,
    fmtMoney,
    fmtRelative,
    inputCls,
    pnlTone,
} from '../../components/backtesting/primitives';
import { fundedProgress, openOrders, sessionStats } from '../../components/backtesting/metrics';
import { AccountImportButton } from '../../components/backtesting/AccountImportButton';
import { useBacktestWorkspace } from './BacktestWorkspaceContext';
import type { BacktestReplaySession } from '../../services/backtestWorkspaceStore';

type StatusFilter = 'ALL' | 'ACTIVE' | 'COMPLETED';
type SortKey = 'activity' | 'created' | 'pnl';

const FundedBadge = ({ s }: { s: BacktestReplaySession }) => {
    const f = fundedProgress(s);
    if (!f) return null;
    const text = f.state === 'passed' ? 'Funded: aprovada' : f.state === 'failed' ? 'Funded: violada' : `Funded: ${f.profitPct}% de ${f.targetPct}%`;
    return (
        <Badge tone={f.state === 'failed' ? 'danger' : f.state === 'passed' ? 'accent' : 'warn'}>
            <ShieldCheck size={11} aria-hidden />
            {text}
        </Badge>
    );
};

const SessionRow = ({ s, onDelete }: { s: BacktestReplaySession; onDelete: () => void }) => {
    const navigate = useNavigate();
    const st = sessionStats(s);
    const open = openOrders(s.orders).length;
    const detail = `/backtesting/sessions/${s.id}`;

    return (
        <li className="group rounded-xl border border-line bg-surface transition-colors hover:border-line-strong">
            <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center">
                {/* Identity */}
                <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <Link to={detail} className="truncate text-base font-semibold text-fg hover:underline">
                            {s.name}
                        </Link>
                        <Badge tone={s.status === 'ACTIVE' ? 'accent' : 'neutral'}>{s.status === 'ACTIVE' ? 'Ativa' : 'Concluída'}</Badge>
                        <FundedBadge s={s} />
                    </div>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
                        <span className="font-medium text-fg">{s.strategyName}</span>
                        <span aria-hidden>·</span>
                        <span>{s.pairs.join(', ')}</span>
                        <span aria-hidden>·</span>
                        <span>{s.timeframe}</span>
                        <span aria-hidden>·</span>
                        <span>
                            {fmtIsoDate(s.fromDate)} → {s.keepEndFollowingToday ? 'hoje' : fmtIsoDate(s.toDate)}
                        </span>
                    </p>
                </div>

                {/* Numbers */}
                <dl className="grid shrink-0 grid-cols-4 gap-4 text-right lg:w-[26rem]">
                    <div>
                        <dt className="text-[11px] text-fg-subtle">P&L</dt>
                        <dd className={`text-sm font-semibold tabular-nums ${st.trades ? pnlTone(st.netProfit) : 'text-fg-subtle'}`}>
                            {st.trades ? fmtMoney(st.netProfit, { sign: true }) : '—'}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-[11px] text-fg-subtle">Trades</dt>
                        <dd className="text-sm font-semibold tabular-nums text-fg">
                            {st.trades}
                            {open > 0 && <span className="ml-1 text-[11px] font-normal text-fg-muted">+{open} abertas</span>}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-[11px] text-fg-subtle">Acerto</dt>
                        <dd className="text-sm font-semibold tabular-nums text-fg">{st.trades ? `${st.winRate}%` : '—'}</dd>
                    </div>
                    <div>
                        <dt className="text-[11px] text-fg-subtle">Atividade</dt>
                        <dd className="text-sm font-semibold text-fg">{fmtRelative(s.updatedAt)}</dd>
                    </div>
                </dl>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-2">
                    <Button variant="brand" size="sm" icon={<Play size={13} fill="currentColor" />} onClick={() => navigate(`/backtesting/replay/${s.id}`)}>
                        {s.status === 'ACTIVE' ? 'Continuar' : 'Rever'}
                    </Button>
                    <Button variant="outline" size="sm" iconRight={<ChevronRight size={14} />} onClick={() => navigate(detail)}>
                        Detalhes
                    </Button>
                    <ConfirmDeleteButton onConfirm={onDelete} label={`Excluir ${s.name}`} />
                </div>
            </div>
        </li>
    );
};

export const SessionsPage = () => {
    const navigate = useNavigate();
    const { sessions, strategies, deleteSession, refresh } = useBacktestWorkspace();
    const [query, setQuery] = useState('');
    const [strategy, setStrategy] = useState('ALL');
    const [status, setStatus] = useState<StatusFilter>('ALL');
    const [sort, setSort] = useState<SortKey>('activity');

    const list = useMemo(() => {
        const q = query.trim().toLowerCase();
        const filtered = sessions.filter(
            (s) =>
                (strategy === 'ALL' || s.strategyId === strategy) &&
                (status === 'ALL' || s.status === status) &&
                (!q || s.name.toLowerCase().includes(q) || s.pairs.some((p) => p.toLowerCase().includes(q)) || s.strategyName.toLowerCase().includes(q))
        );
        const pnl = (s: BacktestReplaySession) => sessionStats(s).netProfit;
        return [...filtered].sort((a, b) =>
            sort === 'pnl'
                ? pnl(b) - pnl(a)
                : sort === 'created'
                  ? b.createdAt.localeCompare(a.createdAt)
                  : (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt)
        );
    }, [sessions, query, strategy, status, sort]);

    if (sessions.length === 0) {
        return (
            <EmptyState
                icon={<FolderKanban size={20} />}
                title="Ainda não há sessões"
                description="Uma sessão é um trecho do histórico que vai operar em replay: escolha a estratégia, os ativos e o período."
                action={
                    <div className="flex flex-col items-center gap-3">
                        <Button variant="brand" icon={<Plus size={15} />} onClick={() => navigate('/backtesting/sessions/new')}>
                            Criar a primeira sessão
                        </Button>
                        <AccountImportButton onDone={refresh} />
                    </div>
                }
            />
        );
    }

    const countBy = (st: StatusFilter) => sessions.filter((s) => st === 'ALL' || s.status === st).length;

    return (
        <div className="space-y-4">
            {/* Toolbar */}
            <div className="space-y-3 rounded-xl border border-line bg-surface p-3 sm:p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                    <div className="relative flex-1">
                        <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
                        <input
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Procurar por nome, ativo ou estratégia"
                            aria-label="Procurar sessões"
                            className={`${inputCls} pl-9`}
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <ChipGroup
                            label="Estado"
                            value={status}
                            onChange={setStatus}
                            options={[
                                { value: 'ALL', label: 'Todas', count: countBy('ALL') },
                                { value: 'ACTIVE', label: 'Ativas', count: countBy('ACTIVE') },
                                { value: 'COMPLETED', label: 'Concluídas', count: countBy('COMPLETED') },
                            ]}
                        />
                        <select
                            value={sort}
                            onChange={(e) => setSort(e.target.value as SortKey)}
                            aria-label="Ordenar"
                            className={`${inputCls} w-auto py-1.5 text-xs`}
                        >
                            <option value="activity">Atividade recente</option>
                            <option value="created">Mais recentes</option>
                            <option value="pnl">Maior P&L</option>
                        </select>
                    </div>
                </div>
                {strategies.length > 1 && (
                    <ChipGroup
                        label="Estratégia"
                        value={strategy}
                        onChange={setStrategy}
                        options={[
                            { value: 'ALL', label: 'Todas as estratégias' },
                            ...strategies.map((st) => ({ value: st.id, label: st.name, count: sessions.filter((s) => s.strategyId === st.id).length })),
                        ]}
                    />
                )}
            </div>

            <div className="flex flex-wrap items-start justify-between gap-2 px-1">
                <p className="pt-1.5 text-xs text-fg-muted">
                    {list.length} {list.length === 1 ? 'sessão' : 'sessões'}
                    {list.length !== sessions.length && ` de ${sessions.length}`}
                </p>
                <AccountImportButton onDone={refresh} />
            </div>

            {list.length === 0 ? (
                <EmptyState title="Nenhuma sessão corresponde aos filtros" description="Limpe a pesquisa ou escolha outra estratégia." />
            ) : (
                <ul className="space-y-2.5">
                    {list.map((s) => (
                        <SessionRow key={s.id} s={s} onDelete={() => deleteSession(s.id)} />
                    ))}
                </ul>
            )}
        </div>
    );
};
