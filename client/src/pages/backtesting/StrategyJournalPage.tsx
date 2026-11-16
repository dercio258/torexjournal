import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
    BookOpen,
    CheckCircle2,
    Crosshair,
    ExternalLink,
    FolderKanban,
    Image as ImageIcon,
    Layers,
    LayoutGrid,
    MessageSquare,
    Play,
    Star,
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import {
    Badge,
    ChipGroup,
    EmptyState,
    fmtDateTime,
    fmtMoney,
    fmtNum,
    Panel,
    pnlTone,
} from '../../components/backtesting/primitives';
import { aggregateStats } from '../../components/backtesting/metrics';
import {
    countAnsweredDailyQuestions,
    countAnsweredTradeQuestions,
    countRealImages,
    hasOrderJournalData,
    mapReplayOrderToJournalTradeRow,
    stripHtmlPreview,
    toEditorHtml,
    useBacktestJournalSupport,
} from '../../components/backtesting/useBacktestJournalSupport';
import { NoteWorkspaceEditor, type EditorSavePayload } from '../../components/journal/NoteWorkspaceEditor';
import { DAILY_PSYCH_DIMENSIONS, TRADE_PSYCH_QUESTIONS, type DailyPsychCheck } from '../../components/journal/types';
import { useBacktestWorkspace } from './BacktestWorkspaceContext';
import type { ReplayOrder } from '../../components/kline-replay/types';
import { cn } from '../../lib/cn';
import { useLocale } from '../../context/LocaleContext';

type TradeFilter = 'all' | 'win' | 'loss' | 'open';
type JournalScope = 'strategy' | 'session' | 'trade';

const SIDE_LABEL: Record<string, string> = { BUY: 'Compra', SELL: 'Venda' };
const SIDE_LABEL_EN: Record<string, string> = { BUY: 'Buy', SELL: 'Sell' };
const STATUS_LABEL: Record<ReplayOrder['status'], string> = {
    OPEN: 'Aberta',
    PENDING: 'Pendente',
    WIN: 'Ganho',
    LOSS: 'Perda',
    CANCELLED: 'Cancelada',
    CLOSED: 'Cancelada',
};
const STATUS_LABEL_EN: Record<ReplayOrder['status'], string> = {
    OPEN: 'Open',
    PENDING: 'Pending',
    WIN: 'Win',
    LOSS: 'Loss',
    CANCELLED: 'Cancelled',
    CLOSED: 'Canceled',
};

export const StrategyJournalPage = () => {
    const navigate = useNavigate();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const [params, setParams] = useSearchParams();
    const { strategies, sessions, updateStrategy, updateSession } = useBacktestWorkspace();
    const { customTemplates, onUploadImage, onSaveTemplate, onDeleteTemplate } = useBacktestJournalSupport();

    const urlStrategy = params.get('strategy') || params.get('estrategia');
    const urlSession = params.get('session');
    const urlOrder = params.get('order');

    const selectedStrategy =
        strategies.find((s) => s.id === urlStrategy) || strategies[0];

    const [sessionFilter, setSessionFilter] = useState<string>(() => urlSession || 'ALL');
    const [tradeFilter, setTradeFilter] = useState<TradeFilter>('all');
    const [scope, setScope] = useState<JournalScope>(() =>
        urlOrder ? 'trade' : urlSession ? 'session' : 'strategy'
    );
    const [activeSessionId, setActiveSessionId] = useState<string | null>(() => urlSession || null);
    const [selectedOrderRef, setSelectedOrderRef] = useState<{
        sessionId: string;
        orderId: string;
    } | null>(() => (urlSession && urlOrder ? { sessionId: urlSession, orderId: urlOrder } : null));
    const [isSaving, setIsSaving] = useState(false);

    const stratSessions = useMemo(
        () => (selectedStrategy ? sessions.filter((s) => s.strategyId === selectedStrategy.id) : []),
        [sessions, selectedStrategy]
    );

    useEffect(() => {
        if (!selectedStrategy) return;
        const validSession =
            urlSession && stratSessions.some((s) => s.id === urlSession) ? urlSession : null;
        if (validSession) {
            setSessionFilter(validSession);
            setActiveSessionId(validSession);
            if (urlOrder) {
                setSelectedOrderRef({ sessionId: validSession, orderId: urlOrder });
                setScope('trade');
            }
        } else {
            setSessionFilter('ALL');
            setActiveSessionId(stratSessions[0]?.id || null);
            setSelectedOrderRef(null);
            setScope('strategy');
        }
    }, [selectedStrategy?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const filteredSessions = useMemo(
        () =>
            sessionFilter === 'ALL'
                ? stratSessions
                : stratSessions.filter((s) => s.id === sessionFilter),
        [stratSessions, sessionFilter]
    );

    const allTaggedOrders = useMemo(
        () =>
            filteredSessions
                .flatMap((s) =>
                    (s.orders || [])
                        .filter((o) => o.status !== 'CLOSED')
                        .map((order) => ({ order, session: s }))
                )
                .sort((a, b) => b.order.openedAt - a.order.openedAt),
        [filteredSessions]
    );

    const aggStats = useMemo(
        () => aggregateStats(filteredSessions, selectedStrategy?.startingCapital),
        [filteredSessions, selectedStrategy?.startingCapital]
    );

    const activeSession = useMemo(() => {
        if (activeSessionId) {
            const found = stratSessions.find((s) => s.id === activeSessionId);
            if (found) return found;
        }
        if (sessionFilter !== 'ALL') {
            const found = stratSessions.find((s) => s.id === sessionFilter);
            if (found) return found;
        }
        return stratSessions[0] || null;
    }, [stratSessions, activeSessionId, sessionFilter]);

    const resolvedSelectedOrder = useMemo(() => {
        if (selectedOrderRef) {
            const sess = stratSessions.find((s) => s.id === selectedOrderRef.sessionId);
            const ord = sess?.orders?.find((o) => o.id === selectedOrderRef.orderId);
            if (sess && ord) return { order: ord, session: sess };
        }
        if (allTaggedOrders.length > 0) {
            return allTaggedOrders[0];
        }
        return null;
    }, [selectedOrderRef, stratSessions, allTaggedOrders]);

    const selectedJournalTrade = useMemo(() => {
        if (!resolvedSelectedOrder) return null;
        return mapReplayOrderToJournalTradeRow(
            resolvedSelectedOrder.order,
            resolvedSelectedOrder.session
        );
    }, [resolvedSelectedOrder]);

    const handleSaveEditor = useCallback(
        async (payload: EditorSavePayload) => {
            if (!selectedStrategy) return;
            setIsSaving(true);
            try {
                if (scope === 'strategy') {
                    updateStrategy(selectedStrategy.id, {
                        journalTitle: payload.title ?? null,
                        journalNotes: payload.content,
                        journalMarketBias: payload.marketBias ?? null,
                        journalPsychCheck: (payload.psychCheck || {}) as Record<string, string | null>,
                        journalImages: payload.images || [],
                    });
                    return;
                }

                if (scope === 'session' && activeSession) {
                    updateSession(activeSession.id, {
                        journalTitle: payload.title ?? null,
                        journalNotes: payload.content,
                        journalMarketBias: payload.marketBias ?? null,
                        journalPsychCheck: (payload.psychCheck || {}) as Record<string, string | null>,
                        journalImages: payload.images || [],
                    });
                    return;
                }

                if (scope === 'trade' && resolvedSelectedOrder) {
                    const { session: targetSess, order: targetOrd } = resolvedSelectedOrder;
                    const nextOrders = (targetSess.orders || []).map((o) => {
                        if (o.id !== targetOrd.id) return o;
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
                    updateSession(targetSess.id, { orders: nextOrders });
                }
            } finally {
                setIsSaving(false);
            }
        },
        [scope, selectedStrategy, activeSession, resolvedSelectedOrder, updateStrategy, updateSession]
    );

    const handleClearCurrentNote = useCallback(async () => {
        if (!selectedStrategy) return;
        setIsSaving(true);
        try {
            if (scope === 'strategy') {
                updateStrategy(selectedStrategy.id, {
                    journalTitle: null,
                    journalNotes: '',
                    journalMarketBias: null,
                    journalPsychCheck: {},
                    journalImages: [],
                });
                return;
            }
            if (scope === 'session' && activeSession) {
                updateSession(activeSession.id, {
                    journalTitle: null,
                    journalNotes: '',
                    journalMarketBias: null,
                    journalPsychCheck: {},
                    journalImages: [],
                });
                return;
            }
            if (scope === 'trade' && resolvedSelectedOrder) {
                const { session: targetSess, order: targetOrd } = resolvedSelectedOrder;
                const nextOrders = (targetSess.orders || []).map((o) =>
                    o.id === targetOrd.id
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
                updateSession(targetSess.id, { orders: nextOrders });
            }
        } finally {
            setIsSaving(false);
        }
    }, [scope, selectedStrategy, activeSession, resolvedSelectedOrder, updateStrategy, updateSession]);

    if (!selectedStrategy) {
        return (
            <EmptyState
                icon={<BookOpen size={20} />}
                title={isEn ? 'No strategies registered' : 'Sem estratégias registadas'}
                description={isEn ? 'Create a strategy first to use the consolidated journal.' : 'Crie uma estratégia primeiro para utilizar o diário consolidado.'}
                action={
                    <Button variant="brand" onClick={() => navigate('/backtesting/strategies?new=1')}>
                        {isEn ? 'New strategy' : 'Nova estratégia'}
                    </Button>
                }
            />
        );
    }

    const currency = selectedStrategy.currency || 'USD';

    const countBy = (f: TradeFilter) =>
        allTaggedOrders.filter(
            ({ order: o }) =>
                f === 'all' ||
                (f === 'win' && o.status === 'WIN') ||
                (f === 'loss' && o.status === 'LOSS') ||
                (f === 'open' && (o.status === 'OPEN' || o.status === 'PENDING'))
        ).length;

    const visibleOrders = allTaggedOrders.filter(
        ({ order: o }) =>
            tradeFilter === 'all' ||
            (tradeFilter === 'win' && o.status === 'WIN') ||
            (tradeFilter === 'loss' && o.status === 'LOSS') ||
            (tradeFilter === 'open' && (o.status === 'OPEN' || o.status === 'PENDING'))
    );

    const fmtPrice = (v?: number) =>
        v === undefined || v === null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 5 });

    const stratAnswered = countAnsweredDailyQuestions(selectedStrategy.journalPsychCheck);
    const annotatedTradesCount = allTaggedOrders.filter(({ order }) => hasOrderJournalData(order)).length;
    const todayIso = new Date().toISOString().slice(0, 10);

    return (
        <div className="space-y-4">
            {/* Context & KPI Summary Bar */}
            <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2.5">
                    <label htmlFor="jrn-strategy" className="text-xs font-semibold text-fg-subtle">
                        {isEn ? 'Strategy' : 'Estratégia'}
                    </label>
                    <select
                        id="jrn-strategy"
                        value={selectedStrategy.id}
                        onChange={(e) => setParams({ strategy: e.target.value }, { replace: true })}
                        className="rounded-xl border border-line bg-surface-2 px-3 py-1.5 text-xs font-bold text-fg focus:border-accent focus:outline-none"
                    >
                        {strategies.map((s) => (
                            <option key={s.id} value={s.id}>
                                {s.name}
                            </option>
                        ))}
                    </select>

                    {stratSessions.length > 0 && (
                        <select
                            aria-label={isEn ? 'Filter by session' : 'Filtrar por sessão'}
                            value={sessionFilter}
                            onChange={(e) => {
                                const val = e.target.value;
                                setSessionFilter(val);
                                if (val !== 'ALL') {
                                    setActiveSessionId(val);
                                    if (scope === 'strategy') setScope('session');
                                }
                            }}
                            className="rounded-xl border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium text-fg focus:border-accent focus:outline-none"
                        >
                            <option value="ALL">
                                {isEn ? `All sessions (${stratSessions.length})` : `Todas as sessões (${stratSessions.length})`}
                            </option>
                            {stratSessions.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {s.name} ({s.primarySymbol})
                                </option>
                            ))}
                        </select>
                    )}

                    {/* Quick KPI Pills */}
                    <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-line-subtle text-xs">
                        <span className="px-2 py-0.5 rounded-md bg-canvas-subtle border border-line-subtle text-fg-muted tabular-nums">
                            {isEn ? 'Win rate' : 'Acerto'}: <strong className="text-fg">{fmtNum(aggStats.winRate, 1)}%</strong>
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-canvas-subtle border border-line-subtle text-fg-muted tabular-nums">
                            {isEn ? 'Net P&L' : 'Resultado'}:{' '}
                            <strong className={pnlTone(aggStats.netProfit)}>
                                {fmtMoney(aggStats.netProfit, { sign: true, currency })}
                            </strong>
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-canvas-subtle border border-line-subtle text-fg-muted tabular-nums">
                            {isEn ? 'Reviewed' : 'Revisadas'}:{' '}
                            <strong className="text-fg">
                                {annotatedTradesCount}/{allTaggedOrders.length}
                            </strong>
                        </span>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        icon={<LayoutGrid size={13} />}
                        onClick={() => navigate(`/backtesting/analytics?strategy=${selectedStrategy.id}`)}
                    >
                        {isEn ? 'Strategy analytics' : 'Analytics da estratégia'}
                    </Button>
                    {(activeSession || stratSessions[0]) && (
                        <Button
                            variant="brand"
                            size="sm"
                            icon={<Play size={12} fill="currentColor" />}
                            onClick={() =>
                                navigate(`/backtesting/replay/${(activeSession || stratSessions[0]).id}`)
                            }
                        >
                            {isEn ? 'Open replay' : 'Abrir replay'}
                        </Button>
                    )}
                </div>
            </div>

            {/* Rich Workspace Split Grid */}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.95fr)] items-start">
                {/* LEFT COLUMN: Scope Switcher + Rich NoteWorkspaceEditor + Strategy Rules */}
                <div className="space-y-4 min-w-0">
                    {/* Scope Switcher Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface p-2">
                        <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label={isEn ? 'Journal scope' : 'Nível do diário'}>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={scope === 'strategy'}
                                onClick={() => setScope('strategy')}
                                className={cn(
                                    'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer',
                                    scope === 'strategy'
                                        ? 'bg-surface-2 text-fg border border-line'
                                        : 'text-fg-muted hover:text-fg border border-transparent'
                                )}
                            >
                                <Layers size={13} className={scope === 'strategy' ? 'text-accent' : 'text-fg-subtle'} />
                                <span>{isEn ? 'Strategy Journal' : 'Diário da Estratégia'}</span>
                                {stratAnswered > 0 && (
                                    <span className="rounded px-1.5 py-0.5 text-[10px] font-mono bg-accent/15 text-accent">
                                        {stratAnswered}/{DAILY_PSYCH_DIMENSIONS.length}
                                    </span>
                                )}
                            </button>

                            <button
                                type="button"
                                role="tab"
                                aria-selected={scope === 'session'}
                                disabled={stratSessions.length === 0}
                                onClick={() => {
                                    if (!activeSessionId && stratSessions[0]) {
                                        setActiveSessionId(stratSessions[0].id);
                                    }
                                    setScope('session');
                                }}
                                className={cn(
                                    'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
                                    scope === 'session'
                                        ? 'bg-surface-2 text-fg border border-line'
                                        : 'text-fg-muted hover:text-fg border border-transparent'
                                )}
                            >
                                <FolderKanban size={13} className={scope === 'session' ? 'text-accent' : 'text-fg-subtle'} />
                                <span>{isEn ? 'Session Journal' : 'Diário da Sessão'}</span>
                                {activeSession && countAnsweredDailyQuestions(activeSession.journalPsychCheck) > 0 && (
                                    <span className="rounded px-1.5 py-0.5 text-[10px] font-mono bg-accent/15 text-accent">
                                        {countAnsweredDailyQuestions(activeSession.journalPsychCheck)}/{DAILY_PSYCH_DIMENSIONS.length}
                                    </span>
                                )}
                            </button>

                            <button
                                type="button"
                                role="tab"
                                aria-selected={scope === 'trade'}
                                disabled={allTaggedOrders.length === 0}
                                onClick={() => {
                                    if (!selectedOrderRef && allTaggedOrders[0]) {
                                        setSelectedOrderRef({
                                            sessionId: allTaggedOrders[0].session.id,
                                            orderId: allTaggedOrders[0].order.id,
                                        });
                                    }
                                    setScope('trade');
                                }}
                                className={cn(
                                    'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
                                    scope === 'trade'
                                        ? 'bg-surface-2 text-fg border border-line'
                                        : 'text-fg-muted hover:text-fg border border-transparent'
                                )}
                            >
                                <Crosshair size={13} className={scope === 'trade' ? 'text-accent' : 'text-fg-subtle'} />
                                <span>{isEn ? 'Trade Review' : 'Revisão da Operação'}</span>
                                {resolvedSelectedOrder &&
                                    countAnsweredTradeQuestions(resolvedSelectedOrder.order.psychCheck) > 0 && (
                                        <span className="rounded px-1.5 py-0.5 text-[10px] font-mono bg-accent/15 text-accent">
                                            {countAnsweredTradeQuestions(resolvedSelectedOrder.order.psychCheck)}/{TRADE_PSYCH_QUESTIONS.length}
                                        </span>
                                    )}
                            </button>
                        </div>

                        {scope === 'session' && stratSessions.length > 1 && activeSession && (
                            <select
                                aria-label={isEn ? 'Active session in editor' : 'Sessão ativa no editor'}
                                value={activeSession.id}
                                onChange={(e) => setActiveSessionId(e.target.value)}
                                className="rounded-lg border border-line-subtle bg-canvas-subtle px-2.5 py-1 text-xs font-medium text-fg focus:border-accent focus:outline-none"
                            >
                                {stratSessions.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.name} ({s.primarySymbol})
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>

                    {/* Rich Editor + Guided Questions + ANTES / DEPOIS */}
                    {scope === 'strategy' && (
                        <NoteWorkspaceEditor
                            mode="daily"
                            activeKey={`bt-strat-${selectedStrategy.id}`}
                            selectedDate={selectedStrategy.updatedAt?.slice(0, 10) || todayIso}
                            customContextBadge={isEn ? 'Strategy' : 'Estratégia'}
                            customContextTitle={`${selectedStrategy.name} · ${selectedStrategy.primarySymbol} (${selectedStrategy.defaultTimeframe})`}
                            initialTitle={selectedStrategy.journalTitle ?? selectedStrategy.name}
                            initialContent={toEditorHtml(selectedStrategy.journalNotes)}
                            initialMood={
                                (selectedStrategy.journalPsychCheck as DailyPsychCheck | undefined)?.moodState ?? null
                            }
                            initialMarketBias={selectedStrategy.journalMarketBias ?? null}
                            initialPsychCheck={
                                (selectedStrategy.journalPsychCheck as DailyPsychCheck | undefined) || {}
                            }
                            initialImages={selectedStrategy.journalImages || []}
                            customTemplates={customTemplates}
                            isSaving={isSaving}
                            onSave={handleSaveEditor}
                            onDeleteNote={handleClearCurrentNote}
                            onUploadImage={onUploadImage}
                            onSaveTemplate={onSaveTemplate}
                            onDeleteTemplate={onDeleteTemplate}
                        />
                    )}

                    {scope === 'session' && activeSession && (
                        <NoteWorkspaceEditor
                            mode="daily"
                            activeKey={`bt-sess-${activeSession.id}`}
                            selectedDate={activeSession.toDate || todayIso}
                            customContextBadge={isEn ? 'Session' : 'Sessão'}
                            customContextTitle={`${activeSession.name} · ${activeSession.primarySymbol} (${activeSession.timeframe})`}
                            initialTitle={activeSession.journalTitle ?? activeSession.name}
                            initialContent={toEditorHtml(activeSession.journalNotes)}
                            initialMood={
                                (activeSession.journalPsychCheck as DailyPsychCheck | undefined)?.moodState ?? null
                            }
                            initialMarketBias={activeSession.journalMarketBias ?? null}
                            initialPsychCheck={
                                (activeSession.journalPsychCheck as DailyPsychCheck | undefined) || {}
                            }
                            initialImages={activeSession.journalImages || []}
                            customTemplates={customTemplates}
                            isSaving={isSaving}
                            onSave={handleSaveEditor}
                            onDeleteNote={handleClearCurrentNote}
                            onUploadImage={onUploadImage}
                            onSaveTemplate={onSaveTemplate}
                            onDeleteTemplate={onDeleteTemplate}
                        />
                    )}

                    {scope === 'trade' && (
                        <NoteWorkspaceEditor
                            mode="trade"
                            activeKey={
                                resolvedSelectedOrder
                                    ? `bt-trade-${resolvedSelectedOrder.session.id}-${resolvedSelectedOrder.order.id}`
                                    : 'bt-trade-none'
                            }
                            selectedDate={selectedJournalTrade?.dateKey || todayIso}
                            initialTitle={null}
                            initialContent={selectedJournalTrade?.tradeNote?.content || ''}
                            initialMood={null}
                            initialMarketBias={null}
                            initialImages={selectedJournalTrade?.tradeNote?.screenshots || []}
                            selectedTrade={selectedJournalTrade}
                            customTemplates={customTemplates}
                            isSaving={isSaving}
                            onSave={handleSaveEditor}
                            onDeleteNote={handleClearCurrentNote}
                            onUploadImage={onUploadImage}
                            onSaveTemplate={onSaveTemplate}
                            onDeleteTemplate={onDeleteTemplate}
                            openTradeActionLabel={isEn ? 'Open in Replay' : 'Abrir no Replay'}
                            onOpenTradeDetails={
                                resolvedSelectedOrder
                                    ? () => navigate(`/backtesting/replay/${resolvedSelectedOrder.session.id}`)
                                    : undefined
                            }
                        />
                    )}

                    {/* Strategy Rules Reference Card */}
                    {selectedStrategy.rules && selectedStrategy.rules.length > 0 && (
                        <Panel
                            title={isEn ? 'Strategy Playbook & Rules' : 'Plano e regras da estratégia'}
                            subtitle={`${selectedStrategy.tradingMethod} · ${isEn ? 'Target' : 'Alvo'} ${selectedStrategy.rrTarget}R · ${isEn ? 'Risk' : 'Risco'} ${selectedStrategy.riskPerTrade}%`}
                            actions={
                                <Link
                                    to={`/backtesting/strategies?id=${selectedStrategy.id}`}
                                    className="inline-flex items-center gap-1 text-xs font-semibold text-accent-fg hover:underline"
                                >
                                    <span>{isEn ? 'Edit rules' : 'Editar regras'}</span>
                                    <ExternalLink size={12} />
                                </Link>
                            }
                        >
                            <ul className="space-y-2">
                                {selectedStrategy.rules.map((rule, idx) => (
                                    <li
                                        key={rule.id || idx}
                                        className="flex items-start justify-between gap-3 rounded-lg border border-line-subtle bg-canvas-subtle px-3 py-2 text-xs"
                                    >
                                        <div className="flex items-start gap-2 min-w-0">
                                            <CheckCircle2
                                                size={14}
                                                className={cn(
                                                    'mt-0.5 shrink-0',
                                                    rule.required ? 'text-accent' : 'text-fg-subtle'
                                                )}
                                            />
                                            <span className="text-fg leading-relaxed">{rule.text}</span>
                                        </div>
                                        <Badge tone={rule.required ? 'accent' : 'neutral'}>
                                            {rule.required ? (isEn ? 'Required' : 'Obrigatória') : (isEn ? 'Optional' : 'Opcional')}
                                        </Badge>
                                    </li>
                                ))}
                            </ul>
                        </Panel>
                    )}
                </div>

                {/* RIGHT COLUMN: Interactive Strategy Trades + Session Journals */}
                <div className="space-y-4 min-w-0">
                    <Panel
                        title={isEn ? 'Strategy Executions' : 'Operações da estratégia'}
                        subtitle={
                            isEn
                                ? 'Click a trade to answer the 4 execution checks and attach BEFORE / AFTER chart captures.'
                                : 'Clique numa operação para responder às 4 perguntas de execução e anexar imagens ANTES / DEPOIS.'
                        }
                        actions={
                            <ChipGroup
                                label={isEn ? 'Trade status' : 'Estado da trade'}
                                value={tradeFilter}
                                onChange={setTradeFilter}
                                options={[
                                    { value: 'all', label: isEn ? 'All' : 'Todas', count: countBy('all') },
                                    { value: 'win', label: isEn ? 'Wins' : 'Ganhos', count: countBy('win') },
                                    { value: 'loss', label: isEn ? 'Losses' : 'Perdas', count: countBy('loss') },
                                    { value: 'open', label: isEn ? 'Open' : 'Abertas', count: countBy('open') },
                                ]}
                            />
                        }
                        bodyClassName="p-0"
                    >
                        {allTaggedOrders.length === 0 ? (
                            <div className="p-6">
                                <EmptyState
                                    title={isEn ? 'No trades logged in this strategy' : 'Nenhuma operação registada nesta estratégia'}
                                    description={
                                        isEn
                                            ? 'Executions taken inside replay sessions appear here automatically for technical and behavioral review.'
                                            : 'As entradas executadas nas sessões de replay aparecem automaticamente aqui para revisão técnica e emocional.'
                                    }
                                    action={
                                        stratSessions[0] ? (
                                            <Button
                                                variant="brand"
                                                size="sm"
                                                icon={<Play size={12} fill="currentColor" />}
                                                onClick={() => navigate(`/backtesting/replay/${stratSessions[0].id}`)}
                                            >
                                                {isEn ? 'Open replay' : 'Abrir replay'}
                                            </Button>
                                        ) : (
                                            <Button
                                                variant="brand"
                                                size="sm"
                                                onClick={() =>
                                                    navigate(`/backtesting/sessions/new?strategy=${selectedStrategy.id}`)
                                                }
                                            >
                                                {isEn ? 'Create session' : 'Criar sessão'}
                                            </Button>
                                        )
                                    }
                                    className="border-0 py-8"
                                />
                            </div>
                        ) : visibleOrders.length === 0 ? (
                            <p className="px-5 py-10 text-center text-xs text-fg-muted">
                                {isEn ? 'No trades match the selected filter.' : 'Nenhuma operação corresponde ao filtro selecionado.'}
                            </p>
                        ) : (
                            <div className="overflow-x-auto max-h-[32rem] overflow-y-auto">
                                <table className="w-full min-w-[640px] text-sm">
                                    <thead className="sticky top-0 bg-surface z-10">
                                        <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-fg-subtle">
                                            <th className="px-4 py-2.5 font-semibold">{isEn ? 'Date' : 'Data'}</th>
                                            <th className="px-3 py-2.5 font-semibold">{isEn ? 'Session / Symbol' : 'Sessão / Ativo'}</th>
                                            <th className="px-3 py-2.5 font-semibold">{isEn ? 'Side' : 'Lado'}</th>
                                            <th className="px-3 py-2.5 text-right font-semibold">{isEn ? 'Entry / Exit' : 'Entrada / Saída'}</th>
                                            <th className="px-3 py-2.5 text-center font-semibold">{isEn ? 'Journal' : 'Diário'}</th>
                                            <th className="px-3 py-2.5 text-right font-semibold">R</th>
                                            <th className="px-4 py-2.5 text-right font-semibold">P&amp;L</th>
                                            <th className="px-2 py-2.5 text-right font-semibold" aria-label={isEn ? 'Replay' : 'Replay'} />
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-line">
                                        {visibleOrders.map(({ order: o, session }) => {
                                            const isClosed = o.status === 'WIN' || o.status === 'LOSS';
                                            const isSelected =
                                                scope === 'trade' &&
                                                resolvedSelectedOrder?.order.id === o.id &&
                                                resolvedSelectedOrder?.session.id === session.id;
                                            const qCount = countAnsweredTradeQuestions(o.psychCheck);
                                            const imgCount = countRealImages(o.journalImages);
                                            const hasText = Boolean(stripHtmlPreview(o.journalContent));

                                            return (
                                                <tr
                                                    key={`${session.id}-${o.id}`}
                                                    onClick={() => {
                                                        setSelectedOrderRef({
                                                            sessionId: session.id,
                                                            orderId: o.id,
                                                        });
                                                        setScope('trade');
                                                    }}
                                                    className={cn(
                                                        'cursor-pointer transition-colors',
                                                        isSelected
                                                            ? 'bg-accent/10 hover:bg-accent/15'
                                                            : 'hover:bg-surface-2/60'
                                                    )}
                                                >
                                                    <td className="whitespace-nowrap px-4 py-2.5 text-xs tabular-nums text-fg-muted">
                                                        <div>{fmtDateTime(o.openedAt)}</div>
                                                        <div className="text-[10px] text-fg-subtle">
                                                            {(isEn ? STATUS_LABEL_EN : STATUS_LABEL)[o.status]}
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-2.5">
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="font-bold text-xs text-fg">{o.symbol}</span>
                                                            {o.setup && (
                                                                <span className="rounded bg-canvas-subtle border border-line-subtle px-1.5 py-0.5 text-[10px] text-fg-muted truncate max-w-[6rem]">
                                                                    {o.setup}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="max-w-[10rem] truncate text-[11px] text-fg-subtle">
                                                            {session.name}
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-2.5 text-xs">
                                                        <span
                                                            className={cn(
                                                                'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase',
                                                                o.side === 'BUY'
                                                                    ? 'bg-accent/15 text-accent'
                                                                    : 'bg-danger/15 text-danger'
                                                            )}
                                                        >
                                                            {(isEn ? SIDE_LABEL_EN : SIDE_LABEL)[o.side] || o.side}
                                                        </span>
                                                    </td>
                                                    <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs tabular-nums text-fg-muted">
                                                        {fmtPrice(o.entryPrice)} → {fmtPrice(o.exitPrice)}
                                                    </td>
                                                    <td className="px-3 py-2.5">
                                                        <div className="flex items-center justify-center gap-1.5 text-[11px]">
                                                            {qCount > 0 && (
                                                                <span
                                                                    title={isEn ? `${qCount}/${TRADE_PSYCH_QUESTIONS.length} checks answered` : `${qCount}/${TRADE_PSYCH_QUESTIONS.length} perguntas respondidas`}
                                                                    className="inline-flex items-center gap-0.5 rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[10px] text-accent"
                                                                >
                                                                    <MessageSquare size={10} />
                                                                    {qCount}/{TRADE_PSYCH_QUESTIONS.length}
                                                                </span>
                                                            )}
                                                            {imgCount > 0 && (
                                                                <span
                                                                    title={isEn ? `${imgCount} image(s) attached` : `${imgCount} imagem(ns) anexada(s)`}
                                                                    className="inline-flex items-center gap-0.5 text-fg-muted"
                                                                >
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
                                                    <td
                                                        className={cn(
                                                            'px-3 py-2.5 text-right text-xs font-semibold tabular-nums',
                                                            isClosed ? pnlTone(o.rMultiple ?? 0) : 'text-fg-subtle'
                                                        )}
                                                    >
                                                        {isClosed && o.rMultiple !== undefined
                                                            ? `${o.rMultiple > 0 ? '+' : ''}${fmtNum(o.rMultiple)}R`
                                                            : '—'}
                                                    </td>
                                                    <td
                                                        className={cn(
                                                            'px-4 py-2.5 text-right text-xs font-bold tabular-nums',
                                                            isClosed ? pnlTone(o.pnl) : 'text-fg-subtle'
                                                        )}
                                                    >
                                                        {isClosed ? fmtMoney(o.pnl, { sign: true, currency }) : '—'}
                                                    </td>
                                                    <td className="px-2 py-2.5 text-right">
                                                        <button
                                                            type="button"
                                                            title={isEn ? 'Inspect bar in Replay' : 'Rever vela no Replay'}
                                                            aria-label={isEn ? 'Inspect bar in Replay' : 'Rever vela no Replay'}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                const ts = o.filledAt || o.openedAt;
                                                                navigate(
                                                                    `/backtesting/replay/${session.id}?symbol=${encodeURIComponent(o.symbol)}&tf=${encodeURIComponent(session.timeframe)}&ts=${ts}&tradeId=${encodeURIComponent(o.id)}`
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

                    {/* Session Journals List */}
                    {stratSessions.length > 0 && (
                        <Panel
                            title={isEn ? 'Session Journals' : 'Diário por sessão'}
                            subtitle={
                                isEn
                                    ? 'Select a session to edit its check-in and notes or open the session workspace.'
                                    : 'Selecione uma sessão para editar o check-in e notas dessa sessão ou abrir no detalhe.'
                            }
                            bodyClassName="p-0"
                        >
                            <ul className="divide-y divide-line">
                                {stratSessions.map((s) => {
                                    const preview = stripHtmlPreview(s.journalNotes);
                                    const sessQ = countAnsweredDailyQuestions(s.journalPsychCheck);
                                    const sessImgs = countRealImages(s.journalImages);
                                    const isSessActive = scope === 'session' && activeSession?.id === s.id;

                                    return (
                                        <li
                                            key={s.id}
                                            className={cn(
                                                'flex items-center justify-between gap-3 px-4 py-3 transition-colors',
                                                isSessActive ? 'bg-accent/10' : 'hover:bg-surface-2/50'
                                            )}
                                        >
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setActiveSessionId(s.id);
                                                    setScope('session');
                                                }}
                                                className="min-w-0 flex-1 text-left cursor-pointer"
                                            >
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <p className="truncate text-xs font-semibold text-fg">{s.name}</p>
                                                    <span className="text-[10px] text-fg-subtle font-mono">
                                                        {s.primarySymbol} · {s.timeframe}
                                                    </span>
                                                    {s.journalMarketBias && (
                                                        <span className="rounded bg-canvas-subtle border border-line-subtle px-1.5 py-0.5 text-[10px] font-medium text-fg-muted">
                                                            {s.journalMarketBias}
                                                        </span>
                                                    )}
                                                    {sessQ > 0 && (
                                                        <span className="rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[10px] text-accent">
                                                            {sessQ}/{DAILY_PSYCH_DIMENSIONS.length} check-in
                                                        </span>
                                                    )}
                                                    {sessImgs > 0 && (
                                                        <span className="inline-flex items-center gap-0.5 text-[10px] text-fg-muted">
                                                            <ImageIcon size={10} />
                                                            {sessImgs}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="mt-0.5 truncate text-[11px] text-fg-subtle">
                                                    {preview || (isEn ? 'No notes logged — click to fill out the journal' : 'Sem notas registadas — clique para preencher o diário')}
                                                </p>
                                            </button>

                                            <div className="flex shrink-0 items-center gap-1.5">
                                                <Link
                                                    to={`/backtesting/sessions/${s.id}?view=journal`}
                                                    title={isEn ? 'Open session page' : 'Abrir página da sessão'}
                                                    className="inline-flex items-center gap-1 rounded-lg border border-line-subtle bg-canvas-subtle px-2 py-1 text-[11px] font-medium text-fg-muted hover:text-fg transition-colors"
                                                >
                                                    <span>{isEn ? 'Session' : 'Sessão'}</span>
                                                    <ExternalLink size={11} />
                                                </Link>
                                                <button
                                                    type="button"
                                                    title={isEn ? 'Open in Replay' : 'Abrir no Replay'}
                                                    onClick={() => navigate(`/backtesting/replay/${s.id}`)}
                                                    className="inline-flex items-center justify-center rounded-lg border border-line-subtle bg-canvas-subtle p-1.5 text-fg-muted hover:text-accent transition-colors cursor-pointer"
                                                >
                                                    <Play size={12} fill="currentColor" />
                                                </button>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </Panel>
                    )}
                </div>
            </div>
        </div>
    );
};
