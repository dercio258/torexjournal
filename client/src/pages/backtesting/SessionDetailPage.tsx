import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
    BarChart3,
    BookOpen,
    CheckCircle2,
    Crosshair,
    FolderKanban,
    Image as ImageIcon,
    LayoutGrid,
    MessageSquare,
    Play,
    RotateCcw,
    Settings2,
    ShieldCheck,
    Star,
} from 'lucide-react';
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
import {
    countAnsweredDailyQuestions,
    countAnsweredTradeQuestions,
    countRealImages,
    mapReplayOrderToJournalTradeRow,
    stripHtmlPreview,
    toEditorHtml,
    useBacktestJournalSupport,
} from '../../components/backtesting/useBacktestJournalSupport';
import { NoteWorkspaceEditor, type EditorSavePayload } from '../../components/journal/NoteWorkspaceEditor';
import { DAILY_PSYCH_DIMENSIONS, TRADE_PSYCH_QUESTIONS, type DailyPsychCheck } from '../../components/journal/types';
import { QuantTearSheetPanel } from '../../components/backtesting/QuantTearSheetPanel';
import { useBacktestWorkspace } from './BacktestWorkspaceContext';
import {
    fetchFullBacktestSessionById,
    type BacktestReplaySession,
} from '../../services/backtestWorkspaceStore';
import type { ReplayOrder } from '../../components/kline-replay/types';
import { cn } from '../../lib/cn';
import { useLocale } from '../../context/LocaleContext';

type View = 'overview' | 'journal' | 'tearsheet' | 'settings';

/* --------------------------------------------------------------- overview */

const Meter = ({ label, value, limit, kind, isEn }: { label: string; value: number; limit: number; kind: 'target' | 'limit'; isEn: boolean }) => {
    const pct = Math.max(0, Math.min(100, (Math.max(0, value) / (limit || 1)) * 100));
    const bad = kind === 'limit' && value >= limit;
    const good = kind === 'target' && value >= limit;
    return (
        <div>
            <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-semibold text-fg">{label}</span>
                <span className="tabular-nums text-fg-muted">
                    <strong className={cn('font-semibold', bad ? 'text-danger-fg' : good ? 'text-accent-fg' : 'text-fg')}>{fmtNum(value)}%</strong> {isEn ? 'of' : 'de'} {fmtNum(limit, 1)}%
                </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3" role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={limit}>
                <div className={cn('h-full rounded-full', kind === 'target' ? 'bg-data-pos' : bad ? 'bg-data-neg' : 'bg-amber-500')} style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
};

const FundedPanel = ({ f, isEn }: { f: FundedProgress; isEn: boolean }) => (
    <Panel
        title={
            <span className="flex items-center gap-1.5">
                <ShieldCheck size={15} className="text-fg-subtle" aria-hidden /> {isEn ? 'Prop Challenge Guardrails' : 'Desafio funded'}
            </span>
        }
        actions={
            <Badge tone={f.state === 'failed' ? 'danger' : f.state === 'passed' ? 'accent' : 'warn'}>
                {f.state === 'failed'
                    ? isEn ? 'Breached' : 'Violado'
                    : f.state === 'passed'
                    ? isEn ? 'Passed' : 'Aprovado'
                    : isEn ? 'Active' : 'Em curso'}
            </Badge>
        }
    >
        <div className="space-y-4">
            <Meter label={isEn ? 'Profit target' : 'Meta de lucro'} value={f.profitPct} limit={f.targetPct} kind="target" isEn={isEn} />
            <Meter label={isEn ? 'Worst daily drawdown' : 'Pior dia (perda)'} value={f.worstDayPct} limit={f.maxDailyPct} kind="limit" isEn={isEn} />
            <Meter label={isEn ? 'Max equity drawdown' : 'Queda abaixo do capital'} value={f.totalDdPct} limit={f.maxTotalPct} kind="limit" isEn={isEn} />
            {f.breach && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger-fg">{f.breach}</p>}
            <p className="text-[11px] text-fg-subtle">
                {isEn
                    ? 'Calculated from starting capital using the market closing date of each replay trade.'
                    : 'Medido sobre o capital inicial, com o dia de mercado do fecho de cada trade.'}
            </p>
        </div>
    </Panel>
);

const Overview = ({ s, isEn }: { s: BacktestReplaySession; isEn: boolean }) => {
    const st = sessionStats(s);
    const daily = useMemo(() => dailyPoints(s.orders), [s.orders]);
    const symbols = useMemo(() => bySymbol(s.orders), [s.orders]);
    const f = fundedProgress(s);
    const none = st.trades === 0;
    const dash = (v: React.ReactNode) => (none ? '—' : v);

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <KpiCard label={isEn ? 'Balance' : 'Saldo'} value={fmtMoney(st.realizedBalance)} hint={`${isEn ? 'Capital' : 'Capital'} ${fmtMoney(s.startingCapital, { decimals: 0 })}`} />
                <KpiCard
                    label={isEn ? 'Net P&L' : 'P&L líquido'}
                    value={dash(fmtMoney(st.netProfit, { sign: true }))}
                    tone={none ? undefined : pnlTone(st.netProfit)}
                    hint={none ? (isEn ? 'No closed trades' : 'Sem trades fechados') : `${fmtNum((st.netProfit / (s.startingCapital || 1)) * 100)}% ${isEn ? 'of capital' : 'do capital'}`}
                />
                <KpiCard label={isEn ? 'Trades' : 'Trades'} value={st.trades} hint={none ? '—' : isEn ? `${st.wins} wins · ${st.losses} losses` : `${st.wins} ganhos · ${st.losses} perdas`} />
                <KpiCard label={isEn ? 'Win Rate' : 'Taxa de acerto'} value={dash(`${fmtNum(st.winRate, 1)}%`)} />
                <KpiCard label={isEn ? 'Profit Factor' : 'Profit factor'} value={dash(st.profitFactor === null ? (isEn ? 'No losses' : 'Sem perdas') : fmtNum(st.profitFactor))} hint={isEn ? 'Gross profit ÷ gross loss' : 'Lucro bruto ÷ perda bruta'} />
                <KpiCard label={isEn ? 'Expectancy' : 'Expectativa'} value={dash(fmtMoney(st.expectancy, { sign: true }))} tone={none ? undefined : pnlTone(st.expectancy)} hint={isEn ? 'Avg P&L per trade' : 'Média por trade'} />
                <KpiCard label={isEn ? 'Avg R-Multiple' : 'R médio'} value={dash(`${fmtNum(st.avgR)}R`)} tone={none ? undefined : pnlTone(st.avgR)} />
                <KpiCard label={isEn ? 'Max Drawdown' : 'Drawdown máx.'} value={dash(st.maxDrawdown > 0 ? `−${fmtMoney(st.maxDrawdown)}` : fmtMoney(0))} hint={none ? undefined : `${fmtNum(st.maxDrawdownPct)}% ${isEn ? 'from peak' : 'do pico'}`} />
            </div>

            <div className={cn('grid grid-cols-1 gap-4', f && 'xl:grid-cols-[minmax(0,1fr)_20rem]')}>
                <div className="min-w-0 space-y-1">
                    <PnLChart data={daily} />
                    <p className="px-1 text-[11px] text-fg-subtle">
                        {isEn
                            ? 'Grouped by the simulated market close date of each trade (UTC).'
                            : 'Agrupado pela data de mercado em que cada trade fechou no replay (UTC).'}
                    </p>
                </div>
                {f && <FundedPanel f={f} isEn={isEn} />}
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Panel title={isEn ? 'Performance by Symbol' : 'Resultado por ativo'} bodyClassName="p-0">
                    {symbols.length === 0 ? (
                        <p className="px-5 py-8 text-center text-xs text-fg-muted">{isEn ? 'No closed trades yet.' : 'Sem trades fechados ainda.'}</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-fg-subtle">
                                        <th className="px-4 py-2 font-semibold">{isEn ? 'Symbol' : 'Ativo'}</th>
                                        <th className="px-4 py-2 text-right font-semibold">Trades</th>
                                        <th className="px-4 py-2 text-right font-semibold">{isEn ? 'Win Rate' : 'Acerto'}</th>
                                        <th className="px-4 py-2 text-right font-semibold">{isEn ? 'Avg R' : 'R médio'}</th>
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

                <Panel title={isEn ? 'Session Telemetry' : 'Sessão'}>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                        {[
                            [isEn ? 'Playbook' : 'Estratégia', s.strategyName],
                            [isEn ? 'Instruments' : 'Ativos', s.pairs.join(', ')],
                            ['Timeframe', s.timeframe],
                            [isEn ? 'Date Range' : 'Período', `${fmtIsoDate(s.fromDate)} → ${s.keepEndFollowingToday ? (isEn ? 'today' : 'hoje') : fmtIsoDate(s.toDate)}`],
                            [isEn ? 'Risk / trade' : 'Risco por trade', `${s.riskPerTrade}%`],
                            [isEn ? 'Target R:R' : 'Alvo', `1:${s.rrTarget}`],
                            [isEn ? 'Execution Costs' : 'Custos', `spread ${s.spread || 0} · ${isEn ? 'comm.' : 'comissão'} ${fmtMoney(s.commission || 0)}`],
                            [isEn ? 'Replay cursor' : 'Ponto do replay', fmtDateTime(s.replayTimestamp)],
                            [isEn ? 'Time invested' : 'Tempo investido', fmtDuration(s.timeInvestedSeconds)],
                            [isEn ? 'Last activity' : 'Última atividade', fmtRelative(s.updatedAt)],
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

const SIDE_PT: Record<string, string> = { BUY: 'Compra', SELL: 'Venda' };
const SIDE_EN: Record<string, string> = { BUY: 'Long', SELL: 'Short' };
const REASON_PT: Record<string, string> = { SL: 'Stop', TP: 'Alvo', MANUAL: 'Manual' };
const REASON_EN: Record<string, string> = { SL: 'Stop Loss', TP: 'Take Profit', MANUAL: 'Manual' };
const STATUS_PT: Record<ReplayOrder['status'], string> = { OPEN: 'Aberta', PENDING: 'Pendente', WIN: 'Ganho', LOSS: 'Perda', CANCELLED: 'Cancelada', CLOSED: 'Cancelada' };
const STATUS_EN: Record<ReplayOrder['status'], string> = { OPEN: 'Open', PENDING: 'Pending', WIN: 'Win', LOSS: 'Loss', CANCELLED: 'Cancelled', CLOSED: 'Cancelled' };

const Journal = ({
    s,
    onUpdateSession,
    isEn,
}: {
    s: BacktestReplaySession;
    onUpdateSession: (patch: Partial<BacktestReplaySession>) => void;
    isEn: boolean;
}) => {
    const SIDE = isEn ? SIDE_EN : SIDE_PT;
    const REASON = isEn ? REASON_EN : REASON_PT;
    const STATUS = isEn ? STATUS_EN : STATUS_PT;
    const navigate = useNavigate();
    const { customTemplates, onUploadImage, onSaveTemplate, onDeleteTemplate } = useBacktestJournalSupport();
    const [filter, setFilter] = useState<TradeFilter>('all');
    const [editorScope, setEditorScope] = useState<'session' | 'trade'>('session');
    const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        setEditorScope('session');
        setSelectedOrderId(null);
    }, [s.id]);

    const orders = useMemo(
        () => [...(s.orders || [])].sort((a, b) => b.openedAt - a.openedAt),
        [s.orders]
    );
    const count = (f: TradeFilter) =>
        orders.filter(
            (o) =>
                f === 'all' ||
                (f === 'win' && o.status === 'WIN') ||
                (f === 'loss' && o.status === 'LOSS') ||
                (f === 'open' && (o.status === 'OPEN' || o.status === 'PENDING'))
        ).length;
    const rows = orders.filter(
        (o) =>
            filter === 'all' ||
            (filter === 'win' && o.status === 'WIN') ||
            (filter === 'loss' && o.status === 'LOSS') ||
            (filter === 'open' && (o.status === 'OPEN' || o.status === 'PENDING'))
    );
    const dp = (v?: number) =>
        v === undefined || v === null ? '—' : v.toLocaleString(isEn ? 'en-US' : 'pt-BR', { maximumFractionDigits: 5 });

    const activeOrder = useMemo(() => {
        if (selectedOrderId) {
            const found = orders.find((o) => o.id === selectedOrderId);
            if (found) return found;
        }
        return orders[0] || null;
    }, [orders, selectedOrderId]);

    const selectedJournalTrade = useMemo(
        () => (activeOrder ? mapReplayOrderToJournalTradeRow(activeOrder, s) : null),
        [activeOrder, s]
    );

    const handleSave = useCallback(
        async (payload: EditorSavePayload) => {
            setIsSaving(true);
            try {
                if (editorScope === 'session') {
                    onUpdateSession({
                        journalTitle: payload.title ?? null,
                        journalNotes: payload.content,
                        journalMarketBias: payload.marketBias ?? null,
                        journalPsychCheck: (payload.psychCheck || {}) as Record<string, string | null>,
                        journalImages: payload.images || [],
                    });
                    return;
                }
                if (editorScope === 'trade' && activeOrder) {
                    const nextOrders = (s.orders || []).map((o) => {
                        if (o.id !== activeOrder.id) return o;
                        return {
                            ...o,
                            journalContent: payload.content,
                            journalImages: payload.images || [],
                            setup: payload.setup ?? null,
                            rating: payload.rating ?? 0,
                            mfe: payload.mfe ?? null,
                            mae: payload.mae ?? null,
                            psychCheck: payload.tradePsychCheck
                                ? {
                                      feeling: payload.tradePsychCheck.feeling ?? null,
                                      followingPlan: payload.tradePsychCheck.followingPlan ?? null,
                                      entryDriver: payload.tradePsychCheck.entryDriver ?? null,
                                      riskComfort: payload.tradePsychCheck.riskComfort ?? null,
                                  }
                                : o.psychCheck,
                        };
                    });
                    onUpdateSession({ orders: nextOrders });
                }
            } finally {
                setIsSaving(false);
            }
        },
        [editorScope, activeOrder, s.orders, onUpdateSession]
    );

    const handleDeleteNote = useCallback(async () => {
        setIsSaving(true);
        try {
            if (editorScope === 'session') {
                onUpdateSession({
                    journalTitle: null,
                    journalNotes: '',
                    journalMarketBias: null,
                    journalPsychCheck: {},
                    journalImages: [],
                });
                return;
            }
            if (editorScope === 'trade' && activeOrder) {
                const nextOrders = (s.orders || []).map((o) =>
                    o.id === activeOrder.id
                        ? {
                              ...o,
                              journalContent: '',
                              journalImages: [],
                              setup: null,
                              rating: 0,
                              mfe: null,
                              mae: null,
                              psychCheck: {},
                          }
                        : o
                );
                onUpdateSession({ orders: nextOrders });
            }
        } finally {
            setIsSaving(false);
        }
    }, [editorScope, activeOrder, s.orders, onUpdateSession]);

    const todayIso = new Date().toISOString().slice(0, 10);
    const sessQ = countAnsweredDailyQuestions(s.journalPsychCheck);

    return (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.12fr)_minmax(0,0.95fr)] items-start">
            {/* Rich Session / Trade Editor */}
            <div className="space-y-3 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface p-2">
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => setEditorScope('session')}
                            className={cn(
                                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer',
                                editorScope === 'session'
                                    ? 'bg-surface-2 text-fg border border-line'
                                    : 'text-fg-muted hover:text-fg border border-transparent'
                            )}
                        >
                            <FolderKanban size={13} className={editorScope === 'session' ? 'text-accent' : 'text-fg-subtle'} />
                            <span>{isEn ? 'Session Log' : 'Diário da Sessão'}</span>
                            {sessQ > 0 && (
                                <span className="rounded px-1.5 py-0.5 text-[10px] font-mono bg-accent/15 text-accent">
                                    {sessQ}/{DAILY_PSYCH_DIMENSIONS.length}
                                </span>
                            )}
                        </button>
                        <button
                            type="button"
                            disabled={orders.length === 0}
                            onClick={() => {
                                if (!selectedOrderId && orders[0]) setSelectedOrderId(orders[0].id);
                                setEditorScope('trade');
                            }}
                            className={cn(
                                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
                                editorScope === 'trade'
                                    ? 'bg-surface-2 text-fg border border-line'
                                    : 'text-fg-muted hover:text-fg border border-transparent'
                            )}
                        >
                            <Crosshair size={13} className={editorScope === 'trade' ? 'text-accent' : 'text-fg-subtle'} />
                            <span>{isEn ? 'Trade Review' : 'Revisão da Trade'}</span>
                            {activeOrder && countAnsweredTradeQuestions(activeOrder.psychCheck) > 0 && (
                                <span className="rounded px-1.5 py-0.5 text-[10px] font-mono bg-accent/15 text-accent">
                                    {countAnsweredTradeQuestions(activeOrder.psychCheck)}/{TRADE_PSYCH_QUESTIONS.length}
                                </span>
                            )}
                        </button>
                    </div>

                    <Link
                        to={`/backtesting/journal?strategy=${s.strategyId}&session=${s.id}`}
                        className="text-xs font-semibold text-accent-fg hover:underline px-2"
                    >
                        {isEn ? 'Consolidated Playbook Journal →' : 'Diário consolidado da estratégia →'}
                    </Link>
                </div>

                {editorScope === 'session' ? (
                    <NoteWorkspaceEditor
                        mode="daily"
                        activeKey={`sess-detail-${s.id}`}
                        selectedDate={s.toDate || todayIso}
                        customContextBadge={isEn ? 'Session' : 'Sessão'}
                        customContextTitle={`${s.name} · ${s.primarySymbol} (${s.timeframe})`}
                        initialTitle={s.journalTitle ?? s.name}
                        initialContent={toEditorHtml(s.journalNotes)}
                        initialMood={(s.journalPsychCheck as DailyPsychCheck | undefined)?.moodState ?? null}
                        initialMarketBias={s.journalMarketBias ?? null}
                        initialPsychCheck={(s.journalPsychCheck as DailyPsychCheck | undefined) || {}}
                        initialImages={s.journalImages || []}
                        customTemplates={customTemplates}
                        isSaving={isSaving}
                        onSave={handleSave}
                        onDeleteNote={handleDeleteNote}
                        onUploadImage={onUploadImage}
                        onSaveTemplate={onSaveTemplate}
                        onDeleteTemplate={onDeleteTemplate}
                    />
                ) : (
                    <NoteWorkspaceEditor
                        mode="trade"
                        activeKey={activeOrder ? `sess-trade-${s.id}-${activeOrder.id}` : 'sess-trade-none'}
                        selectedDate={selectedJournalTrade?.dateKey || todayIso}
                        initialTitle={null}
                        initialContent={selectedJournalTrade?.tradeNote?.content || ''}
                        initialMood={null}
                        initialMarketBias={null}
                        initialImages={selectedJournalTrade?.tradeNote?.screenshots || []}
                        selectedTrade={selectedJournalTrade}
                        customTemplates={customTemplates}
                        isSaving={isSaving}
                        onSave={handleSave}
                        onDeleteNote={handleDeleteNote}
                        onUploadImage={onUploadImage}
                        onSaveTemplate={onSaveTemplate}
                        onDeleteTemplate={onDeleteTemplate}
                        openTradeActionLabel={isEn ? 'Open in Replay' : 'Abrir no Replay'}
                        onOpenTradeDetails={() => {
                            if (!activeOrder) {
                                navigate(`/backtesting/replay/${s.id}`);
                                return;
                            }
                            const ts = activeOrder.filledAt || activeOrder.openedAt;
                            navigate(
                                `/backtesting/replay/${s.id}?symbol=${encodeURIComponent(activeOrder.symbol)}&tf=${encodeURIComponent(s.timeframe)}&ts=${ts}&tradeId=${encodeURIComponent(activeOrder.id)}`
                            );
                        }}
                    />
                )}
            </div>

            {/* Session Trades Table */}
            <Panel
                title={isEn ? 'Session Executions' : 'Trades da sessão'}
                subtitle={
                    isEn
                        ? 'Select a row to log post-trade psych check and attach BEFORE / AFTER chart captures.'
                        : 'Clique numa linha para responder às 4 perguntas e anexar imagens ANTES / DEPOIS.'
                }
                actions={
                    <ChipGroup
                        label={isEn ? 'Filter trades' : 'Filtrar trades'}
                        value={filter}
                        onChange={setFilter}
                        options={[
                            { value: 'all', label: isEn ? 'All' : 'Todos', count: count('all') },
                            { value: 'win', label: isEn ? 'Wins' : 'Ganhos', count: count('win') },
                            { value: 'loss', label: isEn ? 'Losses' : 'Perdas', count: count('loss') },
                            { value: 'open', label: isEn ? 'Open' : 'Abertas', count: count('open') },
                        ]}
                    />
                }
                bodyClassName="p-0"
            >
                {orders.length === 0 ? (
                    <div className="p-5">
                        <EmptyState
                            title={isEn ? 'No executions logged yet' : 'Nenhum trade registado'}
                            description={
                                isEn
                                    ? 'Trades placed in Market Replay appear here with entry, exit, reason, and R-multiple.'
                                    : 'Os trades feitos no replay aparecem aqui com entrada, saída, motivo e resultado em R.'
                            }
                            action={
                                <Button variant="brand" size="sm" icon={<Play size={13} fill="currentColor" />} onClick={() => navigate(`/backtesting/replay/${s.id}`)}>
                                    {isEn ? 'Launch Replay' : 'Abrir replay'}
                                </Button>
                            }
                            className="border-0 py-8"
                        />
                    </div>
                ) : rows.length === 0 ? (
                    <p className="px-5 py-8 text-center text-xs text-fg-muted">{isEn ? 'No trades match this filter.' : 'Nenhum trade neste filtro.'}</p>
                ) : (
                    <div className="overflow-x-auto max-h-[34rem] overflow-y-auto">
                        <table className="w-full min-w-[660px] text-sm">
                            <thead className="sticky top-0 bg-surface z-10">
                                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-fg-subtle">
                                    <th className="px-4 py-2 font-semibold">{isEn ? 'Opened' : 'Abertura'}</th>
                                    <th className="px-3 py-2 font-semibold">{isEn ? 'Symbol' : 'Ativo'}</th>
                                    <th className="px-3 py-2 font-semibold">{isEn ? 'Side' : 'Lado'}</th>
                                    <th className="px-3 py-2 text-right font-semibold">{isEn ? 'Entry / Exit' : 'Entrada / Saída'}</th>
                                    <th className="px-3 py-2 text-center font-semibold">{isEn ? 'Journal' : 'Diário'}</th>
                                    <th className="px-3 py-2 text-right font-semibold">R</th>
                                    <th className="px-4 py-2 text-right font-semibold">P&L</th>
                                    <th className="px-2 py-2 text-right font-semibold" aria-label="Replay" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                                {rows.map((o) => {
                                    const isSelected = editorScope === 'trade' && activeOrder?.id === o.id;
                                    const qCount = countAnsweredTradeQuestions(o.psychCheck);
                                    const imgCount = countRealImages(o.journalImages);
                                    const hasText = Boolean(stripHtmlPreview(o.journalContent));
                                    return (
                                        <tr
                                            key={o.id}
                                            onClick={() => {
                                                setSelectedOrderId(o.id);
                                                setEditorScope('trade');
                                            }}
                                            className={cn(
                                                'cursor-pointer transition-colors',
                                                isSelected ? 'bg-accent/10 hover:bg-accent/15' : 'hover:bg-surface-2/50'
                                            )}
                                        >
                                            <td className="whitespace-nowrap px-4 py-2 text-xs tabular-nums text-fg-muted">
                                                <div>{fmtDateTime(o.openedAt)}</div>
                                                <div className="text-[10px] text-fg-subtle">
                                                    {STATUS[o.status]}
                                                    {o.exitReason ? ` · ${REASON[o.exitReason]}` : ''}
                                                </div>
                                            </td>
                                            <td className="px-3 py-2 font-semibold text-xs text-fg">{o.symbol}</td>
                                            <td className="px-3 py-2 text-xs">{SIDE[o.side]}</td>
                                            <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-fg-muted">
                                                {dp(o.entryPrice)} → {dp(o.exitPrice)}
                                            </td>
                                            <td className="px-3 py-2">
                                                <div className="flex items-center justify-center gap-1.5 text-[11px]">
                                                    {qCount > 0 && (
                                                        <span className="inline-flex items-center gap-0.5 rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[10px] text-accent">
                                                            <MessageSquare size={10} />
                                                            {qCount}/{TRADE_PSYCH_QUESTIONS.length}
                                                        </span>
                                                    )}
                                                    {imgCount > 0 && (
                                                        <span className="inline-flex items-center gap-0.5 text-fg-muted">
                                                            <ImageIcon size={11} />
                                                            <span className="font-mono text-[10px]">{imgCount}</span>
                                                        </span>
                                                    )}
                                                    {o.rating && o.rating > 0 ? (
                                                        <span className="inline-flex items-center gap-0.5 text-warning">
                                                            <Star size={11} className="fill-warning" />
                                                            <span className="font-mono text-[10px]">{o.rating}</span>
                                                        </span>
                                                    ) : null}
                                                    {!qCount && !imgCount && !(o.rating && o.rating > 0) && (
                                                        <span className="text-[10px] text-fg-subtle">
                                                            {hasText ? (isEn ? 'Note' : 'Nota') : (isEn ? 'Review' : 'Rever')}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className={cn('px-3 py-2 text-right text-xs tabular-nums', pnlTone(o.rMultiple ?? 0, true))}>
                                                {o.rMultiple !== undefined ? `${o.rMultiple > 0 ? '+' : ''}${fmtNum(o.rMultiple)}R` : '—'}
                                            </td>
                                            <td className={cn('px-4 py-2 text-right text-xs font-semibold tabular-nums', pnlTone(o.pnl, true))}>{fmtMoney(o.pnl, { sign: true })}</td>
                                            <td className="px-2 py-2 text-right">
                                                <button
                                                    type="button"
                                                    title={isEn ? 'Inspect bar in Replay' : 'Rever vela no Replay'}
                                                    aria-label={isEn ? 'Inspect bar in Replay' : 'Rever vela no Replay'}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        const ts = o.filledAt || o.openedAt;
                                                        navigate(
                                                            `/backtesting/replay/${s.id}?symbol=${encodeURIComponent(o.symbol)}&tf=${encodeURIComponent(s.timeframe)}&ts=${ts}&tradeId=${encodeURIComponent(o.id)}`
                                                        );
                                                    }}
                                                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface-2 text-fg-muted hover:border-accent/40 hover:text-accent-fg transition-colors cursor-pointer"
                                                >
                                                    <Play size={11} fill="currentColor" />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </Panel>
        </div>
    );
};

/* --------------------------------------------------------------- settings */

const SettingsView = ({
    s,
    onSave,
    onDelete,
    isEn,
}: {
    s: BacktestReplaySession;
    onSave: (p: Partial<BacktestReplaySession>) => void;
    onDelete: () => void;
    isEn: boolean;
}) => {
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
            <Panel
                title={isEn ? 'Session Settings' : 'Configuração'}
                subtitle={isEn ? 'Instruments and start date stay locked after creation.' : 'Ativos e início do período ficam fixos depois de criada a sessão.'}
            >
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
                        <Field label={isEn ? 'Name' : 'Nome'} htmlFor="ss-name">
                            <input id="ss-name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
                        </Field>
                        <Field label={isEn ? 'End Date' : 'Fim do período'} htmlFor="ss-to" hint={`${isEn ? 'Start' : 'Início'}: ${fmtIsoDate(s.fromDate)}`}>
                            <input id="ss-to" type="date" value={follow ? today : toDate} disabled={follow} min={s.fromDate} max={today} onChange={(e) => setToDate(e.target.value)} className={inputCls} />
                        </Field>
                        <Field label={isEn ? 'Risk per trade (%)' : 'Risco por trade (%)'} htmlFor="ss-risk">
                            <input id="ss-risk" type="number" step="0.25" min="0.1" max="10" value={risk} onChange={(e) => setRisk(parseFloat(e.target.value))} className={inputCls} />
                        </Field>
                        <Field label={isEn ? 'Target R:R' : 'Alvo R:R'} htmlFor="ss-rr">
                            <input id="ss-rr" type="number" step="0.5" min="0.5" value={rr} onChange={(e) => setRr(parseFloat(e.target.value))} className={inputCls} />
                        </Field>
                    </div>
                    <Toggle checked={follow} onChange={setFollow} label={isEn ? 'End date tracks today' : 'Fim acompanha a data de hoje'} />
                    <Toggle checked={funded.enabled} onChange={(v) => setFunded({ ...funded, enabled: v })} label={isEn ? 'Funded Challenge' : 'Desafio funded'} description={isEn ? 'Profit target and drawdown limits based on starting capital.' : 'Meta de lucro e limites de perda sobre o capital inicial.'} />
                    {funded.enabled && (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <Field label={isEn ? 'Target (%)' : 'Meta (%)'}>
                                <input type="number" step="0.5" value={funded.profitTargetPct} onChange={(e) => setFunded({ ...funded, profitTargetPct: Number(e.target.value) || 10 })} className={inputCls} />
                            </Field>
                            <Field label={isEn ? 'Max daily loss (%)' : 'Perda diária máx. (%)'}>
                                <input type="number" step="0.5" value={funded.maxDailyLossPct} onChange={(e) => setFunded({ ...funded, maxDailyLossPct: Number(e.target.value) || 5 })} className={inputCls} />
                            </Field>
                            <Field label={isEn ? 'Max total loss (%)' : 'Perda total máx. (%)'}>
                                <input type="number" step="0.5" value={funded.maxTotalLossPct} onChange={(e) => setFunded({ ...funded, maxTotalLossPct: Number(e.target.value) || 10 })} className={inputCls} />
                            </Field>
                        </div>
                    )}
                    <div className="flex items-center justify-end gap-3 border-t border-line pt-4">
                        {done && <span className="text-xs text-accent-fg">{isEn ? 'Settings saved' : 'Alterações guardadas'}</span>}
                        <Button type="submit" variant="brand" size="sm" disabled={invalid}>
                            {isEn ? 'Save Changes' : 'Guardar alterações'}
                        </Button>
                    </div>
                </form>
            </Panel>

            <Panel title={isEn ? 'Danger Zone' : 'Zona de perigo'}>
                <p className="mb-3 text-xs text-fg-muted">
                    {isEn
                        ? 'Deleting removes this session, all replay trades, and journal logs from this browser. Cannot be undone.'
                        : 'Excluir remove a sessão, os trades e as notas deste browser. Não há como desfazer.'}
                </p>
                <ConfirmDeleteButton onConfirm={onDelete} label={isEn ? 'Delete Session' : 'Excluir sessão'} />
            </Panel>
        </div>
    );
};

/* ------------------------------------------------------------------- page */

export const SessionDetailPage = () => {
    const { sessionId } = useParams();
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const { sessionById, updateSession, deleteSession, refresh } = useBacktestWorkspace();
    const s = sessionById(sessionId);
    const view = (['overview', 'journal', 'tearsheet', 'settings'].includes(params.get('view') || '') ? params.get('view') : 'overview') as View;

    useEffect(() => {
        if (!s?.id) return;
        const needsHydration =
            s._isSlimSummary || ((s.orders?.length ?? 0) === 0 && (s.closedTradesCount ?? 0) > 0);
        if (!needsHydration) return;
        let cancelled = false;
        void fetchFullBacktestSessionById(s.id)
            .then((hydrated) => {
                if (!cancelled && hydrated) {
                    refresh();
                }
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [s?.id, s?._isSlimSummary, s?.orders?.length, s?.closedTradesCount, refresh]);

    if (!s) {
        return (
            <EmptyState
                title={isEn ? 'Session not found' : 'Sessão não encontrada'}
                description={isEn ? 'It may have been deleted or created on another browser (sessions are stored locally).' : 'Pode ter sido excluída ou criada noutro browser (as sessões ficam guardadas localmente).'}
                action={
                    <Link to="/backtesting/sessions" className="text-sm font-semibold text-accent-fg hover:underline">
                        {isEn ? 'Back to sessions' : 'Voltar às sessões'}
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
            <Breadcrumbs items={[{ label: isEn ? 'Sessions' : 'Sessões', to: '/backtesting/sessions' }, { label: s.name }]} />

            <header className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-xl font-bold text-fg">{s.name}</h2>
                        <Badge tone={s.status === 'ACTIVE' ? 'accent' : 'neutral'}>
                            {s.status === 'ACTIVE' ? (isEn ? 'Active' : 'Ativa') : (isEn ? 'Completed' : 'Concluída')}
                        </Badge>
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
                            {st.trades
                                ? `${fmtMoney(st.netProfit, { sign: true })} ${isEn ? 'across' : 'em'} ${st.trades} trades`
                                : isEn
                                ? 'no closed trades'
                                : 'sem trades fechados'}
                        </span>
                        {open > 0 && <span>· {open} {isEn ? 'open' : 'em aberto'}</span>}
                    </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {s.status === 'ACTIVE' ? (
                        <Button variant="outline" size="sm" icon={<CheckCircle2 size={14} />} onClick={() => updateSession(s.id, { status: 'COMPLETED' })}>
                            {isEn ? 'Mark Completed' : 'Marcar concluída'}
                        </Button>
                    ) : (
                        <Button variant="outline" size="sm" icon={<RotateCcw size={14} />} onClick={() => updateSession(s.id, { status: 'ACTIVE' })}>
                            {isEn ? 'Reopen' : 'Reabrir'}
                        </Button>
                    )}
                    <Button variant="brand" size="sm" icon={<Play size={13} fill="currentColor" />} onClick={() => navigate(`/backtesting/replay/${s.id}`)}>
                        {s.status === 'ACTIVE' ? (isEn ? 'Resume Replay' : 'Continuar replay') : (isEn ? 'Review in Replay' : 'Rever no replay')}
                    </Button>
                </div>
            </header>

            <SubTabs
                label={isEn ? 'Session Views' : 'Vistas da sessão'}
                value={view}
                onChange={(v) => setParams(v === 'overview' ? {} : { view: v }, { replace: true })}
                options={[
                    { value: 'overview', label: isEn ? 'Overview' : 'Visão geral', icon: <LayoutGrid size={15} /> },
                    { value: 'journal', label: 'Journal', icon: <BookOpen size={15} />, count: (s.orders || []).length },
                    { value: 'tearsheet', label: isEn ? 'Quant Tear-Sheet' : 'Tear-Sheet Quant', icon: <BarChart3 size={15} /> },
                    { value: 'settings', label: isEn ? 'Settings' : 'Configuração', icon: <Settings2 size={15} /> },
                ]}
            />

            {view === 'overview' && <Overview s={s} isEn={isEn} />}
            {view === 'journal' && <Journal s={s} onUpdateSession={(p) => updateSession(s.id, p)} isEn={isEn} />}
            {view === 'tearsheet' && (
                <QuantTearSheetPanel
                    orders={s.orders || []}
                    initialBalance={s.startingCapital || 100000}
                    symbol={s.primarySymbol || 'XAUUSD'}
                    isEn={isEn}
                />
            )}
            {view === 'settings' && <SettingsView key={s.id} s={s} onSave={(p) => updateSession(s.id, p)} onDelete={remove} isEn={isEn} />}
        </div>
    );
};
