import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, FolderKanban, Play, Plus, Search, ShieldCheck } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import {
    Badge,
    ChipGroup,
    ConfirmDeleteButton,
    EmptyState,
    fmtMoney,
    inputCls,
    pnlTone,
} from '../../components/backtesting/primitives';
import { fundedProgress, openOrders, sessionStats } from '../../components/backtesting/metrics';
import { AccountImportButton } from '../../components/backtesting/AccountImportButton';
import { useBacktestWorkspace } from './BacktestWorkspaceContext';
import { useLocale } from '../../context/LocaleContext';
import type { BacktestReplaySession } from '../../services/backtestWorkspaceStore';
import { QuickSessionModal } from '../../components/backtesting/QuickSessionModal';

type StatusFilter = 'ALL' | 'ACTIVE' | 'COMPLETED';
type SortKey = 'activity' | 'created' | 'pnl';

const FundedBadge = ({ s, isEn }: { s: BacktestReplaySession; isEn: boolean }) => {
    const f = fundedProgress(s);
    if (!f) return null;
    const text =
        f.state === 'passed'
            ? isEn
                ? 'Prop Challenge: Passed'
                : 'Funded: aprovada'
            : f.state === 'failed'
              ? isEn
                  ? 'Prop Challenge: Breached'
                  : 'Funded: violada'
              : `${isEn ? 'Funded' : 'Funded'}: ${f.profitPct}%/${f.targetPct}%`;
    return (
        <Badge tone={f.state === 'failed' ? 'danger' : f.state === 'passed' ? 'accent' : 'warn'}>
            <ShieldCheck size={11} aria-hidden />
            {text}
        </Badge>
    );
};

const SessionRow = ({
    s,
    currency,
    onDelete,
    isEn,
}: {
    s: BacktestReplaySession;
    currency: string;
    onDelete: () => void;
    isEn: boolean;
}) => {
    const navigate = useNavigate();
    const st = sessionStats(s);
    const open = openOrders(s.orders).length;
    const total = st.trades + open;
    const detail = `/backtesting/sessions/${s.id}`;
    const extraSymbols = Math.max(0, (s.pairs?.length || 1) - 1);

    return (
        <li className="group rounded-2xl border border-line bg-surface transition-colors hover:border-line-strong">
            <div className="flex flex-col gap-4 p-4 sm:px-5 sm:py-4 lg:flex-row lg:items-center">
                {/* Identity: Nome, Símbolo e Estratégia */}
                <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <Link to={detail} className="truncate text-sm sm:text-base font-bold text-fg hover:text-accent-fg">
                            {s.name}
                        </Link>
                        <span className="rounded-md border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-fg">
                            {s.primarySymbol}
                            {extraSymbols > 0 && <span className="ml-1 font-medium text-fg-subtle">+{extraSymbols}</span>}
                        </span>
                        <Badge tone={s.status === 'ACTIVE' ? 'accent' : 'neutral'}>
                            {s.status === 'ACTIVE' ? (isEn ? 'Active' : 'Ativa') : isEn ? 'Completed' : 'Concluída'}
                        </Badge>
                        <FundedBadge s={s} isEn={isEn} />
                    </div>
                    <p className="text-xs text-fg-muted">
                        <Link to={`/backtesting/strategies?id=${s.strategyId}`} className="hover:text-fg hover:underline">
                            {s.strategyName}
                        </Link>
                        {' · '}
                        {s.timeframe}
                    </p>
                </div>

                {/* Essential Numbers: Capital / Saldo, P&L, Trades / Fechadas */}
                <dl className="grid shrink-0 grid-cols-3 gap-4 text-right lg:w-[22rem]">
                    <div>
                        <dt className="text-[11px] text-fg-subtle">{isEn ? 'Capital / Equity' : 'Capital / Saldo'}</dt>
                        <dd className="text-sm font-bold tabular-nums text-fg">
                            {fmtMoney(st.realizedBalance, { currency })}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-[11px] text-fg-subtle">{isEn ? 'Net P&L' : 'Trade P&L'}</dt>
                        <dd
                            className={`text-sm font-bold tabular-nums ${
                                st.trades ? pnlTone(st.netProfit) : 'text-fg-subtle'
                            }`}
                        >
                            {st.trades ? fmtMoney(st.netProfit, { sign: true, currency }) : '—'}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-[11px] text-fg-subtle">{isEn ? 'Trades / Closed' : 'Trades / Fechadas'}</dt>
                        <dd className="text-sm font-semibold tabular-nums text-fg">
                            {total} <span className="text-xs font-normal text-fg-muted">({st.trades})</span>
                        </dd>
                    </div>
                </dl>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-2">
                    <Button
                        variant="brand"
                        size="sm"
                        icon={<Play size={12} fill="currentColor" />}
                        onClick={() => navigate(`/backtesting/replay/${s.id}`)}
                    >
                        Replay
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        iconRight={<ChevronRight size={14} />}
                        onClick={() => navigate(detail)}
                    >
                        {isEn ? 'Session' : 'Sessão'}
                    </Button>
                    <ConfirmDeleteButton onConfirm={onDelete} label={`${isEn ? 'Delete' : 'Excluir'} ${s.name}`} />
                </div>
            </div>
        </li>
    );
};

export const SessionsPage = () => {
    const navigate = useNavigate();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const [params, setParams] = useSearchParams();
    const { sessions, strategies, strategyById, deleteSession, refresh } = useBacktestWorkspace();
    const [query, setQuery] = useState('');
    const strategy = params.get('strategy') || 'ALL';
    const [status, setStatus] = useState<StatusFilter>('ALL');
    const [sort, setSort] = useState<SortKey>('activity');
    const [quickModalOpen, setQuickModalOpen] = useState(false);

    const setStrategy = (val: string) => {
        setParams(val === 'ALL' ? {} : { strategy: val }, { replace: true });
    };

    const recentActive = useMemo(() => {
        const actives = sessions.filter((s) => s.status === 'ACTIVE');
        if (actives.length === 0) return null;
        return [...actives].sort((a, b) =>
            (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt)
        )[0];
    }, [sessions]);

    const list = useMemo(() => {
        const q = query.trim().toLowerCase();
        const filtered = sessions.filter(
            (s) =>
                (strategy === 'ALL' || s.strategyId === strategy) &&
                (status === 'ALL' || s.status === status) &&
                (!q ||
                    s.name.toLowerCase().includes(q) ||
                    s.pairs.some((p) => p.toLowerCase().includes(q)) ||
                    s.strategyName.toLowerCase().includes(q))
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
            <>
                <EmptyState
                    icon={<FolderKanban size={20} />}
                    title={isEn ? 'No sessions yet' : 'Ainda não há sessões'}
                    description={
                        isEn
                            ? 'Create a replay session under a Playbook to start bar-by-bar execution testing.'
                            : 'Crie uma sessão a partir de uma estratégia para começar a operar em replay.'
                    }
                    action={
                        <div className="flex flex-col items-center gap-3">
                            <Button variant="brand" icon={<Plus size={15} />} onClick={() => setQuickModalOpen(true)}>
                                {isEn ? 'Create First Session' : 'Criar primeira sessão'}
                            </Button>
                            <AccountImportButton onDone={refresh} />
                        </div>
                    }
                />
                <QuickSessionModal
                    open={quickModalOpen}
                    initialStrategyId={strategy !== 'ALL' ? strategy : undefined}
                    onClose={() => setQuickModalOpen(false)}
                />
            </>
        );
    }

    const countBy = (st: StatusFilter) => sessions.filter((s) => st === 'ALL' || s.status === st).length;
    const recentStats = recentActive ? sessionStats(recentActive) : null;
    const recentCurrency = recentActive ? (strategyById(recentActive.strategyId)?.currency || 'USD') : 'USD';

    return (
        <div className="space-y-4">
            {recentActive && recentStats && (
                <section className="rounded-2xl border border-accent/30 bg-surface p-4 sm:px-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-accent-fg">
                                {isEn ? 'Resume Last Replay' : 'Continuar último replay'}
                            </span>
                            <span className="rounded-md border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-fg">
                                {recentActive.primarySymbol} · {recentActive.timeframe}
                            </span>
                        </div>
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <h2 className="truncate text-base font-bold text-fg">{recentActive.name}</h2>
                            <span className="text-xs text-fg-muted">{recentActive.strategyName}</span>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-4 lg:justify-end">
                        <dl className="flex items-center gap-5 text-right tabular-nums">
                            <div>
                                <dt className="text-[10px] uppercase tracking-wider text-fg-subtle">
                                    {isEn ? 'Equity' : 'Saldo'}
                                </dt>
                                <dd className="text-sm font-bold text-fg">
                                    {fmtMoney(recentStats.realizedBalance, { currency: recentCurrency })}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-[10px] uppercase tracking-wider text-fg-subtle">P&L</dt>
                                <dd className={`text-sm font-bold ${recentStats.trades ? pnlTone(recentStats.netProfit) : 'text-fg-subtle'}`}>
                                    {recentStats.trades ? fmtMoney(recentStats.netProfit, { sign: true, currency: recentCurrency }) : '—'}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-[10px] uppercase tracking-wider text-fg-subtle">Trades</dt>
                                <dd className="text-sm font-semibold text-fg">
                                    {recentStats.trades + openOrders(recentActive.orders).length}
                                </dd>
                            </div>
                        </dl>

                        <div className="flex shrink-0 items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => navigate(`/backtesting/sessions/${recentActive.id}`)}
                            >
                                {isEn ? 'Details' : 'Detalhes'}
                            </Button>
                            <Button
                                variant="brand"
                                size="sm"
                                icon={<Play size={12} fill="currentColor" />}
                                onClick={() => navigate(`/backtesting/replay/${recentActive.id}`)}
                            >
                                {isEn ? 'Resume Replay' : 'Continuar Replay'}
                            </Button>
                        </div>
                    </div>
                </section>
            )}
            {/* Compact Filter Toolbar */}
            <div className="space-y-3 rounded-2xl border border-line bg-surface p-3.5 sm:p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                    <div className="relative flex-1">
                        <Search
                            size={15}
                            aria-hidden
                            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
                        />
                        <input
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={isEn ? 'Search by name, symbol, or playbook' : 'Procurar por nome, símbolo ou estratégia'}
                            aria-label={isEn ? 'Search sessions' : 'Procurar sessões'}
                            className={`${inputCls} pl-9`}
                        />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <ChipGroup
                            label={isEn ? 'Status' : 'Estado'}
                            value={status}
                            onChange={setStatus}
                            options={[
                                { value: 'ALL', label: isEn ? 'All' : 'Todas', count: countBy('ALL') },
                                { value: 'ACTIVE', label: isEn ? 'Active' : 'Ativas', count: countBy('ACTIVE') },
                                { value: 'COMPLETED', label: isEn ? 'Completed' : 'Concluídas', count: countBy('COMPLETED') },
                            ]}
                        />
                        <select
                            value={sort}
                            onChange={(e) => setSort(e.target.value as SortKey)}
                            aria-label={isEn ? 'Sort by' : 'Ordenar'}
                            className={`${inputCls} w-auto py-1.5 text-xs`}
                        >
                            <option value="activity">{isEn ? 'Recent activity' : 'Atividade recente'}</option>
                            <option value="created">{isEn ? 'Newest first' : 'Mais recentes'}</option>
                            <option value="pnl">{isEn ? 'Highest P&L' : 'Maior P&L'}</option>
                        </select>
                    </div>
                </div>
                {strategies.length > 1 && (
                    <ChipGroup
                        label={isEn ? 'Playbook' : 'Estratégia'}
                        value={strategy}
                        onChange={setStrategy}
                        options={[
                            { value: 'ALL', label: isEn ? 'All playbooks' : 'Todas as estratégias' },
                            ...strategies.map((st) => ({
                                value: st.id,
                                label: st.name,
                                count: sessions.filter((s) => s.strategyId === st.id).length,
                            })),
                        ]}
                    />
                )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <p className="text-xs text-fg-muted">
                    {list.length} {isEn ? (list.length === 1 ? 'session' : 'sessions') : list.length === 1 ? 'sessão' : 'sessões'}
                </p>
                <AccountImportButton onDone={refresh} />
            </div>

            {list.length === 0 ? (
                <EmptyState
                    title={isEn ? 'No sessions found' : 'Nenhuma sessão encontrada'}
                    description={isEn ? 'Adjust your search query or select a different playbook.' : 'Ajuste a pesquisa ou escolha outra estratégia.'}
                />
            ) : (
                <ul className="space-y-2.5">
                    {list.map((s) => (
                        <SessionRow
                            key={s.id}
                            s={s}
                            currency={strategyById(s.strategyId)?.currency || 'USD'}
                            onDelete={() => deleteSession(s.id)}
                            isEn={isEn}
                        />
                    ))}
                </ul>
            )}
            <QuickSessionModal
                open={quickModalOpen}
                initialStrategyId={strategy !== 'ALL' ? strategy : undefined}
                onClose={() => setQuickModalOpen(false)}
            />
        </div>
    );
};
