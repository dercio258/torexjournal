import React, { useState, useMemo, useRef, useEffect, memo } from 'react';
import { ChevronDown, ChevronUp, BarChart3, Cpu, Sparkles, Clock, Calendar, Check, Crosshair, Tag, Star } from 'lucide-react';
import { ReplayOrder, REPLAY_TIMEZONES } from '../types';
import { QuantMathEngine } from '../indicators/quantMathEngine';
import { useLocale } from '../../../context/LocaleContext';

function toLocalDateTimeInput(ts: number): string {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface BottomDockLayerProps {
    orders: ReplayOrder[];
    initialBalance?: number;
    simBalance: number;
    floatingPnl: number;
    netProfit: number;
    formattedReplayClock: string;
    timezone?: string;
    currentReplayTimestamp?: number | null;
    onChangeTimezone?: (tz: string) => void;
    onJumpToTimestamp?: (timestampMs: number) => void;
    onJumpToTrade?: (trade: ReplayOrder) => void;
    onMoveOrderToBreakEven?: (id: string) => void;
    onPartialCloseOrder?: (id: string) => void;
    onCloseOrCancelOrder: (id: string) => void;
    onQuickTagTrade?: (trade: ReplayOrder) => void;
}

export const BottomDockLayer: React.FC<BottomDockLayerProps> = memo(({
    orders,
    initialBalance = 100000,
    simBalance,
    floatingPnl,
    netProfit,
    formattedReplayClock,
    timezone = 'local',
    currentReplayTimestamp,
    onChangeTimezone,
    onJumpToTimestamp,
    onJumpToTrade,
    onMoveOrderToBreakEven,
    onPartialCloseOrder,
    onCloseOrCancelOrder,
    onQuickTagTrade,
}) => {
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const [bottomTab, setBottomTab] = useState<'positions' | 'pending' | 'history' | 'analytics' | 'quant'>('positions');
    const [bottomExpanded, setBottomExpanded] = useState<boolean>(false);
    const [clockMenuOpen, setClockMenuOpen] = useState<boolean>(false);
    const [jumpInput, setJumpInput] = useState<string>('');
    const clockPopoverRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!clockMenuOpen) return;
        if (currentReplayTimestamp) {
            setJumpInput(toLocalDateTimeInput(currentReplayTimestamp));
        }
        const onPointerDown = (e: PointerEvent) => {
            if (clockPopoverRef.current && !clockPopoverRef.current.contains(e.target as Node)) {
                setClockMenuOpen(false);
            }
        };
        window.addEventListener('pointerdown', onPointerDown, true);
        return () => window.removeEventListener('pointerdown', onPointerDown, true);
    }, [clockMenuOpen, currentReplayTimestamp]);

    const handleQuickJump = () => {
        if (!jumpInput || !onJumpToTimestamp) return;
        const ts = new Date(jumpInput).getTime();
        if (!Number.isNaN(ts) && ts > 0) {
            setClockMenuOpen(false);
            onJumpToTimestamp(ts);
        }
    };

    const quantReport = useMemo(
        () => QuantMathEngine.analyzeSession(orders, initialBalance, isEn),
        [orders, initialBalance, isEn]
    );

    const openPositions = useMemo(() => orders.filter(o => o.status === 'OPEN'), [orders]);
    const pendingOrders = useMemo(() => orders.filter(o => o.status === 'PENDING'), [orders]);
    const historyOrders = useMemo(
        () => orders.filter(o => o.status === 'WIN' || o.status === 'LOSS' || o.status === 'CANCELLED' || o.status === 'CLOSED'),
        [orders]
    );

    const sessionStats = useMemo(() => {
        const closedWithPnl = historyOrders
            .filter(o => o.status === 'WIN' || o.status === 'LOSS')
            .sort((a, b) => (a.closedAt ?? a.openedAt ?? 0) - (b.closedAt ?? b.openedAt ?? 0));
        const wins = closedWithPnl.filter(o => o.pnl > 0);
        const losses = closedWithPnl.filter(o => o.pnl < 0);

        const winRate = closedWithPnl.length > 0
            ? Number(((wins.length / closedWithPnl.length) * 100).toFixed(1))
            : 0;

        const grossProfit = wins.reduce((acc, o) => acc + o.pnl, 0);
        const grossLoss = Math.abs(losses.reduce((acc, o) => acc + o.pnl, 0));
        const profitFactor = grossLoss > 0
            ? Number((grossProfit / grossLoss).toFixed(2))
            : grossProfit > 0 ? 9.99 : 0;

        // Calculate max drawdown over chronologically sorted closed trades
        let peak = 0;
        let cum = 0;
        let maxDd = 0;
        closedWithPnl.forEach(ord => {
            cum += ord.pnl;
            if (cum > peak) peak = cum;
            const dd = peak - cum;
            if (dd > maxDd) maxDd = dd;
        });

        const avgRr = closedWithPnl.length > 0
            ? Number((closedWithPnl.reduce((a, o) => a + (o.rrRatio || 2), 0) / closedWithPnl.length).toFixed(2))
            : 2.0;

        return {
            totalClosed: closedWithPnl.length,
            winsCount: wins.length,
            lossesCount: losses.length,
            winRate,
            profitFactor,
            maxDrawdown: Number(maxDd.toFixed(2)),
            avgRr,
        };
    }, [historyOrders]);

    const currentTzMeta = REPLAY_TIMEZONES.find(t => t.id === timezone) || REPLAY_TIMEZONES[0];

    return (
        <div className="relative z-40 border-t text-xs bg-surface border-line text-fg-muted shrink-0">
            <div className="h-9 px-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-4 overflow-x-auto no-scrollbar min-w-0">
                    <button
                        onClick={() => { setBottomTab('positions'); setBottomExpanded(e => bottomTab === 'positions' ? !e : true); }}
                        className={`flex items-center gap-1.5 font-semibold cursor-pointer shrink-0 ${
                            bottomTab === 'positions' ? 'text-fg font-bold' : 'opacity-60 hover:opacity-100'
                        }`}
                    >
                        <span>{isEn ? 'Positions' : 'Posições'}</span>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-surface-3/80 font-mono dark:bg-surface-2">
                            {openPositions.length}
                        </span>
                    </button>

                    <button
                        onClick={() => { setBottomTab('pending'); setBottomExpanded(e => bottomTab === 'pending' ? !e : true); }}
                        className={`flex items-center gap-1.5 font-semibold cursor-pointer shrink-0 ${
                            bottomTab === 'pending' ? 'text-fg font-bold' : 'opacity-60 hover:opacity-100'
                        }`}
                    >
                        <span>{isEn ? 'Pending' : 'Pendentes'}</span>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-surface-3/80 font-mono dark:bg-surface-2">
                            {pendingOrders.length}
                        </span>
                    </button>

                    <button
                        onClick={() => { setBottomTab('history'); setBottomExpanded(e => bottomTab === 'history' ? !e : true); }}
                        className={`flex items-center gap-1.5 font-semibold cursor-pointer shrink-0 ${
                            bottomTab === 'history' ? 'text-fg font-bold' : 'opacity-60 hover:opacity-100'
                        }`}
                    >
                        <span>{isEn ? 'History' : 'Histórico'}</span>
                        {historyOrders.length > 0 && (
                            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-surface-3/80 font-mono dark:bg-surface-2">
                                {historyOrders.length}
                            </span>
                        )}
                    </button>

                    <button
                        onClick={() => { setBottomTab('analytics'); setBottomExpanded(e => bottomTab === 'analytics' ? !e : true); }}
                        className={`flex items-center gap-1 font-semibold cursor-pointer shrink-0 ${
                            bottomTab === 'analytics' ? 'text-accent-fg font-bold' : 'opacity-60 hover:opacity-100'
                        }`}
                    >
                        <BarChart3 size={13} />
                        <span>{isEn ? 'Analytics' : 'Análise'}</span>
                    </button>

                    <button
                        onClick={() => { setBottomTab('quant'); setBottomExpanded(e => bottomTab === 'quant' ? !e : true); }}
                        className={`flex items-center gap-1 font-semibold cursor-pointer shrink-0 ${
                            bottomTab === 'quant' ? 'text-emerald-500 font-bold' : 'opacity-60 hover:opacity-100'
                        }`}
                        title={isEn ? 'Quantitative Math Engine: Sharpe, Sortino, Kelly, SQN & Risk of Ruin' : 'Motor Matemático Quantitativo: Sharpe, Sortino, Kelly, SQN e Risco de Ruína'}
                    >
                        <Cpu size={13} className="text-emerald-500" />
                        <span>Quant Math</span>
                        {quantReport.closedTrades > 0 && (
                            <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-emerald-500/15 text-emerald-500 font-bold">
                                SQN {quantReport.sqn}
                            </span>
                        )}
                    </button>

                    <div className="hidden lg:flex items-center gap-3 text-[11px] font-mono opacity-85 border-l pl-3 border-line shrink-0">
                        <span>
                            Equity: <strong>${(simBalance + floatingPnl).toFixed(2)}</strong> ({netProfit >= 0 ? '+' : ''}${netProfit.toFixed(2)})
                        </span>
                        <span>·</span>
                        <span>
                            Win Rate: <strong className={sessionStats.winRate >= 50 ? 'text-teal-600' : ''}>{sessionStats.winRate}%</strong>
                        </span>
                        <span>·</span>
                        <span>
                            PF: <strong>{sessionStats.profitFactor}</strong>
                        </span>
                    </div>
                </div>

                {/* Interactive Timestamp & Timezone Controls + Expand Dock */}
                <div className="flex items-center gap-1.5 shrink-0" ref={clockPopoverRef}>
                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => setClockMenuOpen(o => !o)}
                            title={isEn ? 'Replay Timestamp & Timezone (Click to change timezone or jump to date/time)' : 'Timestamp do Replay & Fuso Horário (Clique para alterar fuso ou ir para data/hora)'}
                            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg font-mono text-[11px] transition-colors cursor-pointer ${
                                clockMenuOpen
                                    ? 'bg-accent/15 text-accent font-semibold'
                                    : 'text-fg-muted hover:text-fg hover:bg-surface-2'
                            }`}
                        >
                            <Clock size={12} className="text-accent shrink-0" />
                            <span>{formattedReplayClock}</span>
                            <span className="px-1 py-0.2 rounded bg-surface-3 text-[9px] font-bold text-fg">
                                {currentTzMeta.shortLabel}
                            </span>
                        </button>

                        {clockMenuOpen && (
                            <div className="absolute right-0 bottom-full mb-1.5 w-72 rounded-xl border border-line bg-surface text-fg shadow-2xl p-2.5 z-[130] space-y-2">
                                {onJumpToTimestamp && (
                                    <div className="space-y-1 pb-2 border-b border-line">
                                        <label className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-fg-muted">
                                            <Calendar size={11} /> {isEn ? 'Jump to Exact Timestamp' : 'Ir para Timestamp Exato'}
                                        </label>
                                        <div className="flex items-center gap-1">
                                            <input
                                                type="datetime-local"
                                                value={jumpInput}
                                                onChange={e => setJumpInput(e.target.value)}
                                                className="flex-1 px-2 py-1 rounded-lg border border-line bg-surface-2 text-[11px] font-mono text-fg focus:outline-none focus:border-accent"
                                            />
                                            <button
                                                type="button"
                                                onClick={handleQuickJump}
                                                className="px-2.5 py-1 rounded-lg bg-accent hover:opacity-95 text-accent-on font-bold text-[11px] cursor-pointer"
                                            >
                                                {isEn ? 'Go' : 'Ir'}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-0.5">
                                    <div className="px-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-fg-muted">
                                        {isEn ? 'Chart Timezone' : 'Fuso Horário do Gráfico'}
                                    </div>
                                    {REPLAY_TIMEZONES.map(tz => {
                                        const active = tz.id === timezone;
                                        return (
                                            <button
                                                key={tz.id}
                                                type="button"
                                                onClick={() => {
                                                    onChangeTimezone?.(tz.id);
                                                    setClockMenuOpen(false);
                                                }}
                                                className={`w-full px-2 py-1.5 rounded-lg flex items-center justify-between text-xs cursor-pointer transition-colors ${
                                                    active
                                                        ? 'bg-accent/15 text-accent font-semibold'
                                                        : 'text-fg hover:bg-surface-2'
                                                }`}
                                            >
                                                <span>{isEn ? (tz.labelEn || tz.label) : tz.label}</span>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-[10px] font-mono opacity-70">{tz.shortLabel}</span>
                                                    {active && <Check size={12} />}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    <button
                        type="button"
                        onClick={() => setBottomExpanded(e => !e)}
                        title={bottomExpanded ? (isEn ? 'Collapse Bottom Panel' : 'Recolher Painel Inferior') : (isEn ? 'Expand Bottom Panel' : 'Expandir Painel Inferior')}
                        className="p-1 rounded-lg hover:bg-surface-2 text-fg-muted hover:text-fg cursor-pointer transition-colors"
                    >
                        {bottomExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                    </button>
                </div>
            </div>

            {bottomExpanded && (
                <div className={`px-4 py-3 border-t max-h-48 overflow-y-auto font-mono text-xs ${
                    'bg-surface-2 border-line'
                }`}>
                    {bottomTab === 'positions' && (
                        openPositions.length === 0 ? (
                            <div className="py-3 text-center opacity-50 font-sans">
                                {isEn ? (
                                    <>No open positions right now. Click <strong>+ Trade</strong> on the right or press <kbd className="px-1.5 py-0.5 rounded bg-surface-3 font-mono">Alt + B</kbd> / <kbd className="px-1.5 py-0.5 rounded bg-surface-3 font-mono">Alt + S</kbd>.</>
                                ) : (
                                    <>Nenhuma posição aberta no momento. Clique em <strong>+ Trade</strong> à direita ou pressione <kbd className="px-1.5 py-0.5 rounded bg-surface-3 font-mono">Alt + B</kbd> / <kbd className="px-1.5 py-0.5 rounded bg-surface-3 font-mono">Alt + S</kbd>.</>
                                )}
                            </div>
                        ) : (
                            <div className="divide-y divide-line">
                                {openPositions.map(ord => {
                                    const isAtBe = Math.abs(ord.stopLoss - ord.entryPrice) < 1e-7;
                                    const canMoveBe = !isAtBe && ord.pnl > 0;
                                    return (
                                        <div key={ord.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                                            <div className="flex flex-wrap items-center gap-2.5">
                                                <span className="font-bold">{ord.id}</span>
                                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                                    ord.side === 'BUY' ? 'bg-data-pos/15 text-accent-fg' : 'bg-data-neg/15 text-danger-fg'
                                                }`}>{ord.side}</span>
                                                <span className="font-bold">{ord.symbol}</span>
                                                <span className="px-1.5 py-0.5 rounded bg-surface-3 text-[10px] font-bold text-fg-muted">
                                                    {(ord.lots ?? 0.01).toFixed(2)}L
                                                </span>
                                                <span>Entry: {ord.entryPrice}</span>
                                                {ord.stopLoss > 0 && (
                                                    <span className={isAtBe ? 'text-amber-500 font-bold' : 'text-danger-fg'}>
                                                        SL: {ord.stopLoss}{isAtBe ? ' (BE)' : ''}
                                                    </span>
                                                )}
                                                {ord.takeProfit > 0 && (
                                                    <span className="text-teal-600">TP: {ord.takeProfit}</span>
                                                )}
                                                {(ord.mfe !== undefined || ord.mae !== undefined) && (
                                                    <span className="text-[10px] text-fg-muted hidden md:inline" title={isEn ? 'Maximum Favorable Excursion (MFE) / Adverse (MAE)' : 'Máxima Excursão Favorável (MFE) / Adversa (MAE)'}>
                                                        MFE +${(ord.mfe ?? 0).toFixed(0)} · MAE -${(ord.mae ?? 0).toFixed(0)}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <span className={`font-bold mr-1.5 ${ord.pnl >= 0 ? 'text-teal-600' : 'text-danger-fg'}`}>
                                                    {ord.pnl >= 0 ? '+' : ''}${ord.pnl.toFixed(2)} ({ord.rMultiple && ord.rMultiple > 0 ? '+' : ''}{ord.rMultiple ?? 0}R)
                                                </span>
                                                {onJumpToTrade && (
                                                    <button
                                                        type="button"
                                                        onClick={() => onJumpToTrade(ord)}
                                                        title={isEn ? 'Center this position on chart' : 'Centralizar esta posição no gráfico'}
                                                        className="px-1.5 py-0.5 rounded bg-surface-3 hover:bg-accent/20 text-fg-muted hover:text-accent-fg text-[10px] font-sans font-bold flex items-center gap-1 cursor-pointer transition-colors"
                                                    >
                                                        <Crosshair size={11} />
                                                        <span className="hidden sm:inline">{isEn ? 'Chart' : 'Gráfico'}</span>
                                                    </button>
                                                )}
                                                {onMoveOrderToBreakEven && (
                                                    <button
                                                        type="button"
                                                        disabled={isAtBe}
                                                        onClick={() => onMoveOrderToBreakEven(ord.id)}
                                                        title={
                                                            isAtBe
                                                                ? (isEn ? 'Stop Loss already protected at Break-Even' : 'Stop Loss já protegido no Break-Even')
                                                                : canMoveBe
                                                                  ? (isEn ? 'Move Stop Loss to Entry Price (Break-Even)' : 'Mover Stop Loss para o Preço de Entrada (Break-Even)')
                                                                  : (isEn ? 'Move Stop Loss to Entry (Break-Even)' : 'Mover Stop Loss para Entrada (Break-Even)')
                                                        }
                                                        className={`px-2 py-0.5 rounded text-[10px] font-sans font-bold transition-colors ${
                                                            isAtBe
                                                                ? 'bg-amber-500/15 text-amber-500 opacity-60 cursor-default'
                                                                : 'bg-surface-3 hover:bg-amber-500/20 text-fg hover:text-amber-500 cursor-pointer'
                                                        }`}
                                                    >
                                                        BE
                                                    </button>
                                                )}
                                                {onPartialCloseOrder && (
                                                    <button
                                                        type="button"
                                                        onClick={() => onPartialCloseOrder(ord.id)}
                                                        title={isEn ? 'Close 50% partial at current Replay price' : 'Realizar 50% da posição ao preço atual do Replay'}
                                                        className="px-2 py-0.5 rounded bg-surface-3 hover:bg-accent/20 text-fg hover:text-accent-fg text-[10px] font-sans font-bold cursor-pointer transition-colors"
                                                    >
                                                        50%
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => onCloseOrCancelOrder(ord.id)}
                                                    className="px-2 py-0.5 rounded bg-data-neg text-white hover:bg-data-neg/90 text-[10px] font-sans font-bold cursor-pointer"
                                                >
                                                    {isEn ? 'Close' : 'Fechar'}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )
                    )}

                    {bottomTab === 'pending' && (
                        pendingOrders.length === 0 ? (
                            <div className="py-3 text-center opacity-50 font-sans">
                                {isEn ? (
                                    <>No pending orders (Limit/Stop). Hover the right price axis and click <strong>(+)</strong> or open the Order Ticket.</>
                                ) : (
                                    <>Nenhuma ordem pendente (Limit/Stop). Passe o mouse no eixo de preço à direita e clique em <strong>(+)</strong> ou abra a Boleta.</>
                                )}
                            </div>
                        ) : (
                            <div className="divide-y divide-line">
                                {pendingOrders.map(ord => {
                                    const pendingTypeLabel = ord.orderType === 'STOP' ? 'STOP' : 'LIMIT';
                                    return (
                                        <div key={ord.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                                            <div className="flex flex-wrap items-center gap-2.5">
                                                <span className="font-bold">{ord.id}</span>
                                                <span
                                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                                        pendingTypeLabel === 'STOP'
                                                            ? 'bg-indigo-500/20 text-indigo-400'
                                                            : 'bg-amber-500/20 text-amber-500'
                                                    }`}
                                                >
                                                    {ord.side} {pendingTypeLabel}
                                                </span>
                                                <span className="font-bold">{ord.symbol}</span>
                                                <span className="px-1.5 py-0.5 rounded bg-surface-3 text-[10px] font-bold text-fg-muted">
                                                    {(ord.lots ?? 0.01).toFixed(2)}L
                                                </span>
                                                <span>{isEn ? 'Trigger:' : 'Gatilho:'} {ord.entryPrice}</span>
                                                {ord.stopLoss > 0 && <span className="text-danger-fg">SL: {ord.stopLoss}</span>}
                                                {ord.takeProfit > 0 && <span className="text-teal-600">TP: {ord.takeProfit}</span>}
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                {onJumpToTrade && (
                                                    <button
                                                        type="button"
                                                        onClick={() => onJumpToTrade(ord)}
                                                        title={isEn ? 'View order level on chart' : 'Ver nível desta ordem no gráfico'}
                                                        className="px-1.5 py-0.5 rounded bg-surface-3 hover:bg-accent/20 text-fg-muted hover:text-accent-fg text-[10px] font-sans font-bold flex items-center gap-1 cursor-pointer transition-colors"
                                                    >
                                                        <Crosshair size={11} />
                                                        <span className="hidden sm:inline">{isEn ? 'Chart' : 'Gráfico'}</span>
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => onCloseOrCancelOrder(ord.id)}
                                                    className="px-2 py-0.5 rounded bg-surface-3 text-fg hover:bg-line-strong text-[10px] font-sans font-bold cursor-pointer"
                                                >
                                                    {isEn ? 'Cancel' : 'Cancelar'}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )
                    )}

                    {bottomTab === 'history' && (
                        historyOrders.length === 0 ? (
                            <div className="py-3 text-center opacity-50 font-sans">
                                {isEn ? 'No closed trades in this session yet.' : 'Nenhuma operação finalizada nesta sessão ainda.'}
                            </div>
                        ) : (
                            <div className="divide-y divide-line">
                                {historyOrders.map(ord => (
                                    <div key={ord.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex flex-wrap items-center gap-2.5">
                                            <span className="font-bold">{ord.id}</span>
                                            <span
                                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                                    ord.side === 'BUY'
                                                        ? 'bg-data-pos/15 text-accent-fg'
                                                        : 'bg-data-neg/15 text-danger-fg'
                                                }`}
                                            >
                                                {ord.side} {ord.orderType}
                                            </span>
                                            <span className="font-bold">{ord.symbol}</span>
                                            <span className="px-1.5 py-0.5 rounded bg-surface-3 text-[10px] font-bold text-fg-muted">
                                                {(ord.lots ?? 0.01).toFixed(2)}L
                                            </span>
                                            <span>
                                                {ord.entryPrice} → {ord.exitPrice ?? ord.entryPrice}
                                            </span>
                                            {ord.exitReason && (
                                                <span className="px-1.5 py-0.5 rounded bg-surface-3 text-[9px] font-bold uppercase text-fg-muted">
                                                    {ord.isImportedTrade ? 'MT5' : ord.exitReason}
                                                </span>
                                            )}
                                            {typeof ord.rating === 'number' && ord.rating > 0 && (
                                                <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 text-[9px] font-bold inline-flex items-center gap-0.5">
                                                    <Star size={9} className="fill-amber-400 text-amber-400" />
                                                    {ord.rating}
                                                </span>
                                            )}
                                            {ord.setup && (
                                                <span className="px-1.5 py-0.5 rounded bg-accent/15 text-accent-fg text-[9px] font-bold">
                                                    {ord.setup}
                                                </span>
                                            )}
                                            {(ord.mfe !== undefined || ord.mae !== undefined) && (
                                                <span className="text-[10px] text-fg-muted hidden lg:inline">
                                                    MFE +${(ord.mfe ?? 0).toFixed(0)} · MAE -${(ord.mae ?? 0).toFixed(0)}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {ord.status === 'CANCELLED' || ord.status === 'CLOSED' ? (
                                                <span className="px-1.5 py-0.5 rounded bg-surface-3 text-[10px] font-bold text-fg-muted">
                                                    {isEn ? 'CANCELLED' : 'CANCELADA'}
                                                </span>
                                            ) : (
                                                <span className={`font-bold ${ord.pnl >= 0 ? 'text-teal-600' : 'text-danger-fg'}`}>
                                                    {ord.pnl >= 0 ? '+' : ''}${ord.pnl.toFixed(2)}
                                                    {ord.rMultiple !== undefined ? ` (${ord.rMultiple >= 0 ? '+' : ''}${ord.rMultiple}R)` : ` (${ord.status})`}
                                                </span>
                                            )}
                                            {onQuickTagTrade && (
                                                <button
                                                    type="button"
                                                    onClick={() => onQuickTagTrade(ord)}
                                                    title={isEn ? 'Quick-tag trade setup & quality' : 'Marcar setup e nota rápida do trade'}
                                                    className="px-1.5 py-0.5 rounded bg-surface-3 hover:bg-amber-500/20 text-fg-muted hover:text-amber-500 text-[10px] font-sans font-bold flex items-center gap-1 cursor-pointer transition-colors"
                                                >
                                                    <Tag size={11} />
                                                    <span className="hidden sm:inline">Tag</span>
                                                </button>
                                            )}
                                            {onJumpToTrade && (
                                                <button
                                                    type="button"
                                                    onClick={() => onJumpToTrade(ord)}
                                                    title={isEn ? 'Focus on Entry & Exit points on chart' : 'Focar nos pontos de Entrada e Saída no gráfico'}
                                                    className="px-1.5 py-0.5 rounded bg-surface-3 hover:bg-accent/20 text-fg-muted hover:text-accent-fg text-[10px] font-sans font-bold flex items-center gap-1 cursor-pointer transition-colors"
                                                >
                                                    <Crosshair size={11} />
                                                    <span className="hidden sm:inline">{isEn ? 'Chart' : 'Gráfico'}</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )
                    )}

                    {bottomTab === 'analytics' && (
                        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 font-sans py-1">
                            <div className={`p-2.5 rounded-xl border ${'bg-surface border-line'}`}>
                                <div className="text-[10px] opacity-60 uppercase">{isEn ? 'Closed Trades' : 'Trades Fechados'}</div>
                                <div className="text-sm font-black mt-0.5">{sessionStats.totalClosed} ({sessionStats.winsCount}W / {sessionStats.lossesCount}L)</div>
                            </div>
                            <div className={`p-2.5 rounded-xl border ${'bg-surface border-line'}`}>
                                <div className="text-[10px] opacity-60 uppercase">Win Rate</div>
                                <div className={`text-sm font-black mt-0.5 ${sessionStats.winRate >= 50 ? 'text-teal-600' : 'text-amber-500'}`}>
                                    {sessionStats.winRate}%
                                </div>
                            </div>
                            <div className={`p-2.5 rounded-xl border ${'bg-surface border-line'}`}>
                                <div className="text-[10px] opacity-60 uppercase">Profit Factor</div>
                                <div className="text-sm font-black mt-0.5">{sessionStats.profitFactor}</div>
                            </div>
                            <div className={`p-2.5 rounded-xl border ${'bg-surface border-line'}`}>
                                <div className="text-[10px] opacity-60 uppercase">Max Drawdown</div>
                                <div className="text-sm font-black text-danger-fg mt-0.5">-${sessionStats.maxDrawdown.toFixed(2)}</div>
                            </div>
                            <div className={`p-2.5 rounded-xl border ${'bg-surface border-line'}`}>
                                <div className="text-[10px] opacity-60 uppercase">{isEn ? 'Avg R:R' : 'Média R:R'}</div>
                                <div className="text-sm font-black text-accent-fg mt-0.5">1 : {sessionStats.avgRr}</div>
                            </div>
                            <div className={`p-2.5 rounded-xl border ${'bg-surface border-line'}`}>
                                <div className="text-[10px] opacity-60 uppercase">{isEn ? 'Net P&L' : 'Resultado Líquido'}</div>
                                <div className={`text-sm font-black mt-0.5 ${netProfit >= 0 ? 'text-teal-600' : 'text-danger-fg'}`}>
                                    {netProfit >= 0 ? '+' : ''}${netProfit.toFixed(2)}
                                </div>
                            </div>
                        </div>
                    )}

                    {bottomTab === 'quant' && (
                        <div className="space-y-2.5 font-sans py-1">
                            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                                <div className="p-2 rounded-xl border bg-surface border-line">
                                    <div className="text-[9px] opacity-60 uppercase font-bold">Sharpe Ratio</div>
                                    <div className="text-xs font-black mt-0.5 text-fg font-mono">{quantReport.sharpeRatio}</div>
                                </div>
                                <div className="p-2 rounded-xl border bg-surface border-line">
                                    <div className="text-[9px] opacity-60 uppercase font-bold">Sortino Ratio</div>
                                    <div className="text-xs font-black mt-0.5 text-fg font-mono">{quantReport.sortinoRatio}</div>
                                </div>
                                <div className="p-2 rounded-xl border bg-surface border-line">
                                    <div className="text-[9px] opacity-60 uppercase font-bold">Calmar Ratio</div>
                                    <div className="text-xs font-black mt-0.5 text-fg font-mono">{quantReport.calmarRatio}</div>
                                </div>
                                <div className="p-2 rounded-xl border bg-surface border-line">
                                    <div className="text-[9px] opacity-60 uppercase font-bold">SQN (Van Tharp)</div>
                                    <div className="text-xs font-black mt-0.5 text-emerald-500 font-mono">
                                        {quantReport.sqn} <span className="text-[9px] font-sans opacity-80">({quantReport.sqnLabel})</span>
                                    </div>
                                </div>
                                <div className="p-2 rounded-xl border bg-surface border-line">
                                    <div className="text-[9px] opacity-60 uppercase font-bold">{isEn ? 'Optimal Half-Kelly' : 'Half-Kelly Ótimo'}</div>
                                    <div className="text-xs font-black mt-0.5 text-accent-fg font-mono">{quantReport.kellyHalfPct}% / trade</div>
                                </div>
                                <div className="p-2 rounded-xl border bg-surface border-line">
                                    <div className="text-[9px] opacity-60 uppercase font-bold">{isEn ? 'Risk of Ruin' : 'Risco de Ruína'}</div>
                                    <div className={`text-xs font-black mt-0.5 font-mono ${quantReport.riskOfRuinPct < 10 ? 'text-emerald-500' : 'text-danger-fg'}`}>
                                        {quantReport.riskOfRuinPct}%
                                    </div>
                                </div>
                                <div className="p-2 rounded-xl border bg-surface border-line">
                                    <div className="text-[9px] opacity-60 uppercase font-bold">Z-Score Streaks</div>
                                    <div className="text-xs font-black mt-0.5 text-fg font-mono">
                                        {quantReport.zScoreStreaks} ({quantReport.maxConsecutiveWins}W / {quantReport.maxConsecutiveLosses}L)
                                    </div>
                                </div>
                                <div className="p-2 rounded-xl border bg-surface border-line">
                                    <div className="text-[9px] opacity-60 uppercase font-bold">{isEn ? 'Consistency' : 'Consistência'}</div>
                                    <div className="text-xs font-black mt-0.5 text-emerald-500 font-mono">{quantReport.consistencyScore}/100</div>
                                </div>
                            </div>

                            <div className="px-3 py-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 flex items-center gap-2 text-[11px] text-fg">
                                <Sparkles size={14} className="text-emerald-500 shrink-0" />
                                <span>
                                    <strong className="text-emerald-500">{isEn ? 'Quant Diagnostics:' : 'Diagnóstico Quant:'}</strong> {quantReport.smartRecommendation}
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
});
