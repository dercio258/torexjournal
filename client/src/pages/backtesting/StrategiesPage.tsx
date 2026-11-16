import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
    BookOpen,
    Calendar,
    ChevronRight,
    Layers,
    LayoutGrid,
    Play,
    Plus,
    Settings2,
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import {
    Badge,
    EmptyState,
    fmtIsoDate,
    fmtMoney,
    pnlTone,
} from '../../components/backtesting/primitives';
import { sessionStats, strategySummary } from '../../components/backtesting/metrics';
import { StrategyFormModal } from '../../components/backtesting/StrategyFormModal';
import { useBacktestWorkspace } from './BacktestWorkspaceContext';
import { useLocale } from '../../context/LocaleContext';
import type { BacktestStrategy } from '../../services/backtestWorkspaceStore';
import { cn } from '../../lib/cn';

export const StrategiesPage = () => {
    const navigate = useNavigate();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const [params, setParams] = useSearchParams();
    const { strategies, sessions, createStrategy, updateStrategy, deleteStrategy } = useBacktestWorkspace();

    const creating = params.get('new') === '1';
    const focusedId = params.get('id');
    const [editingStrategy, setEditingStrategy] = useState<BacktestStrategy | null>(null);

    const closeModal = () => {
        setEditingStrategy(null);
        if (creating) {
            const next = new URLSearchParams(params);
            next.delete('new');
            setParams(next, { replace: true });
        }
    };

    const handleSaveStrategy = (payload: Partial<BacktestStrategy>) => {
        if (editingStrategy) {
            updateStrategy(editingStrategy.id, payload);
            setEditingStrategy(null);
        } else {
            createStrategy(payload);
        }
    };

    const modal =
        creating || editingStrategy ? (
            <StrategyFormModal
                initial={editingStrategy}
                sessions={editingStrategy ? sessions.filter((s) => s.strategyId === editingStrategy.id) : []}
                canDelete={strategies.length > 1}
                onDelete={
                    editingStrategy
                        ? () => {
                              deleteStrategy(editingStrategy.id);
                              setEditingStrategy(null);
                          }
                        : undefined
                }
                onClose={closeModal}
                onSave={handleSaveStrategy}
            />
        ) : null;

    if (strategies.length === 0) {
        return (
            <>
                <EmptyState
                    icon={<Layers size={20} />}
                    title={isEn ? 'Create your first Playbook' : 'Crie a sua primeira estratégia'}
                    description={
                        isEn
                            ? 'Set starting capital, base currency, and trading framework to organize your replay sessions.'
                            : 'Defina o capital inicial, a moeda e o método operacional para organizar as suas sessões de replay.'
                    }
                    action={
                        <Button variant="brand" icon={<Plus size={14} />} onClick={() => setParams({ new: '1' })}>
                            {isEn ? 'New Playbook' : 'Nova estratégia'}
                        </Button>
                    }
                />
                {modal}
            </>
        );
    }

    return (
        <div className="space-y-3">
            {strategies.map((strategy) => {
                const summary = strategySummary(strategy, sessions);
                const currency = strategy.currency || 'USD';
                const hasClosed = summary.closedTrades > 0;
                const isHighlighted = focusedId === strategy.id && strategies.length > 1;

                return (
                    <article
                        key={strategy.id}
                        className={cn(
                            'rounded-xl border bg-surface transition-colors overflow-hidden',
                            isHighlighted ? 'border-accent/50 ring-1 ring-accent/20' : 'border-line'
                        )}
                    >
                        {/* Strategy Header & Primary Actions */}
                        <div className="flex flex-col gap-3 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
                            <div className="min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h2 className="truncate text-base sm:text-lg font-bold tracking-tight text-fg">
                                        {strategy.name}
                                    </h2>
                                    <Badge tone="neutral">{currency}</Badge>
                                    {strategy.tradingMethod && (
                                        <span className="truncate text-xs text-fg-muted">
                                            {strategy.tradingMethod}
                                        </span>
                                    )}
                                </div>
                                <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
                                    <Calendar size={12} aria-hidden />
                                    <span>{isEn ? 'Created' : 'Criada em'} {fmtIsoDate(strategy.createdAt)}</span>
                                </p>
                            </div>

                            {/* Dedicated Strategy Action Buttons */}
                            <div className="flex shrink-0 flex-wrap items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    icon={<LayoutGrid size={14} />}
                                    onClick={() => navigate(`/backtesting/analytics?strategy=${strategy.id}`)}
                                >
                                    Analytics
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    icon={<BookOpen size={14} />}
                                    onClick={() => navigate(`/backtesting/journal?strategy=${strategy.id}`)}
                                >
                                    {isEn ? 'Journal' : 'Diário'}
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    icon={<Settings2 size={14} />}
                                    onClick={() => setEditingStrategy(strategy)}
                                >
                                    {isEn ? 'Settings' : 'Definições'}
                                </Button>
                                <Button
                                    variant="brand"
                                    size="sm"
                                    icon={<Plus size={14} />}
                                    onClick={() => navigate(`/backtesting/sessions/new?strategy=${strategy.id}`)}
                                >
                                    {isEn ? 'New Session' : 'Nova sessão'}
                                </Button>
                            </div>
                        </div>

                        {/* Essential Data Preview Strip */}
                        <dl className="grid grid-cols-2 gap-px border-y border-line-subtle bg-line-subtle sm:grid-cols-5">
                            <div className="bg-surface px-4 py-3">
                                <dt className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                                    {isEn ? 'Balance / Starting' : 'Saldo / Inicial'}
                                </dt>
                                <dd className="mt-1 flex items-baseline gap-1.5 tabular-nums">
                                    <span className="text-sm font-bold text-fg">
                                        {fmtMoney(summary.currentBalance, { currency })}
                                    </span>
                                </dd>
                                <span className="mt-0.5 block text-[11px] tabular-nums text-fg-muted">
                                    {isEn ? 'of' : 'de'} {fmtMoney(summary.capital, { decimals: 0, currency })}
                                </span>
                            </div>

                            <div className="bg-surface px-4 py-3">
                                <dt className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                                    {isEn ? 'Net P&L' : 'Trade P&L'}
                                </dt>
                                <dd
                                    className={cn(
                                        'mt-1 text-sm font-bold tabular-nums',
                                        hasClosed ? pnlTone(summary.netProfit) : 'text-fg-subtle'
                                    )}
                                >
                                    {hasClosed ? fmtMoney(summary.netProfit, { sign: true, currency }) : '—'}
                                </dd>
                                <span className="mt-0.5 block text-[11px] text-fg-muted">
                                    {hasClosed
                                        ? `${summary.winRate}% ${isEn ? 'win rate' : 'acerto'}`
                                        : isEn
                                          ? 'No closes'
                                          : 'Sem fechos'}
                                </span>
                            </div>

                            <div className="bg-surface px-4 py-3">
                                <dt className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                                    {isEn ? 'Trades / Closed' : 'Trades / Fechadas'}
                                </dt>
                                <dd className="mt-1 text-sm font-bold tabular-nums text-fg">
                                    {summary.totalTrades}{' '}
                                    <span className="text-xs font-medium text-fg-muted">
                                        ({summary.closedTrades}{' '}
                                        {isEn ? 'closed' : summary.closedTrades === 1 ? 'fechada' : 'fechadas'})
                                    </span>
                                </dd>
                                <span className="mt-0.5 block text-[11px] text-fg-muted">
                                    {summary.openTrades > 0
                                        ? isEn
                                            ? `${summary.openTrades} open`
                                            : `${summary.openTrades} em aberto`
                                        : isEn
                                          ? 'None open'
                                          : 'Nenhuma em aberto'}
                                </span>
                            </div>

                            <div className="bg-surface px-4 py-3">
                                <dt className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                                    {isEn ? 'Sessions' : 'Sessões'}
                                </dt>
                                <dd className="mt-1 text-sm font-bold tabular-nums text-fg">
                                    {summary.sessionsCount}
                                </dd>
                                <span className="mt-0.5 block text-[11px] text-fg-muted">
                                    {summary.sessionsCount === 0
                                        ? isEn
                                            ? 'None created'
                                            : 'Nenhuma criada'
                                        : `${summary.activeSessionsCount} ${
                                              isEn
                                                  ? 'active'
                                                  : summary.activeSessionsCount === 1
                                                    ? 'ativa'
                                                    : 'ativas'
                                          }`}
                                </span>
                            </div>

                            <div className="col-span-2 sm:col-span-1 bg-surface px-4 py-3">
                                <dt className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                                    {isEn ? 'Created' : 'Criação'}
                                </dt>
                                <dd className="mt-1 text-sm font-bold tabular-nums text-fg">
                                    {fmtIsoDate(strategy.createdAt)}
                                </dd>
                                <span className="mt-0.5 block text-[11px] text-fg-muted">
                                    {isEn ? 'Risk' : 'Risco'} {strategy.riskPerTrade}% · {strategy.defaultTimeframe || '5m'}
                                </span>
                            </div>
                        </dl>

                        {/* Clean Sessions Preview List (Nome, Símbolo e Capital + Redirecionamento) */}
                        <div className="bg-surface-2/25">
                            <div className="flex items-center justify-between px-4 py-2 border-b border-line-subtle">
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                                    {isEn ? 'Sessions' : 'Sessões'} ({summary.sessions.length})
                                </span>
                                {summary.sessions.length > 0 && (
                                    <Link
                                        to={`/backtesting/sessions?strategy=${strategy.id}`}
                                        className="text-xs font-semibold text-fg-muted hover:text-fg transition-colors"
                                    >
                                        {isEn ? 'View all' : 'Ver todas'}
                                    </Link>
                                )}
                            </div>

                            {summary.sessions.length === 0 ? (
                                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-4">
                                    <p className="text-xs text-fg-muted">
                                        {isEn
                                            ? 'No replay sessions created for this playbook yet.'
                                            : 'Ainda não existem sessões nesta estratégia.'}
                                    </p>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        icon={<Plus size={13} />}
                                        onClick={() => navigate(`/backtesting/sessions/new?strategy=${strategy.id}`)}
                                    >
                                        {isEn ? 'Create First Session' : 'Criar primeira sessão'}
                                    </Button>
                                </div>
                            ) : (
                                <ul className="divide-y divide-line-subtle">
                                    {summary.sessions.map((session) => {
                                        const st = sessionStats(session);
                                        const extraSymbols = Math.max(0, (session.pairs?.length || 1) - 1);
                                        return (
                                            <li key={session.id}>
                                                <div
                                                    role="link"
                                                    tabIndex={0}
                                                    onClick={() => navigate(`/backtesting/sessions/${session.id}`)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                            e.preventDefault();
                                                            navigate(`/backtesting/sessions/${session.id}`);
                                                        }
                                                    }}
                                                    className="group flex items-center justify-between gap-3 px-5 py-3 cursor-pointer transition-colors hover:bg-surface-2/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
                                                >
                                                    {/* Nome & Símbolo */}
                                                    <div className="min-w-0 flex items-center gap-2.5">
                                                        <span className="truncate text-sm font-semibold text-fg group-hover:text-accent-fg transition-colors">
                                                            {session.name}
                                                        </span>
                                                        <span className="shrink-0 rounded-md border border-line bg-surface px-2 py-0.5 text-[11px] font-bold text-fg">
                                                            {session.primarySymbol}
                                                            {extraSymbols > 0 && (
                                                                <span className="ml-1 font-medium text-fg-subtle">
                                                                    +{extraSymbols}
                                                                </span>
                                                            )}
                                                        </span>
                                                    </div>

                                                    {/* Capital & Redirecionamento */}
                                                    <div className="flex shrink-0 items-center gap-3">
                                                        <div className="text-right tabular-nums">
                                                            <span className="text-sm font-semibold text-fg">
                                                                {fmtMoney(st.realizedBalance, { currency })}
                                                            </span>
                                                            {st.trades > 0 && (
                                                                <span
                                                                    className={cn(
                                                                        'ml-2 text-xs font-semibold',
                                                                        pnlTone(st.netProfit)
                                                                    )}
                                                                >
                                                                    ({fmtMoney(st.netProfit, { sign: true, decimals: 0, currency })})
                                                                </span>
                                                            )}
                                                        </div>

                                                        <button
                                                            type="button"
                                                            title={isEn ? 'Open replay' : 'Abrir replay'}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                navigate(`/backtesting/replay/${session.id}`);
                                                            }}
                                                            className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-fg-muted hover:border-accent/40 hover:text-accent-fg transition-colors"
                                                        >
                                                            <Play size={11} fill="currentColor" />
                                                            <span className="hidden sm:inline">Replay</span>
                                                        </button>

                                                        <ChevronRight
                                                            size={15}
                                                            aria-hidden
                                                            className="text-fg-subtle group-hover:translate-x-0.5 group-hover:text-fg transition-all"
                                                        />
                                                    </div>
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                    </article>
                );
            })}

            {modal}
        </div>
    );
};
