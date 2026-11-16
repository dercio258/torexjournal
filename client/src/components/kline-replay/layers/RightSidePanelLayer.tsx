import React, { memo, useMemo } from 'react';
import {
    X,
    CheckCircle2,
    Save,
    Layers,
    PlusCircle,
    FileEdit,
    Trash2,
    CandlestickChart,
    Activity,
    Eye,
    EyeOff,
    Lock,
    Unlock,
    Download,
    Camera,
    AlertTriangle,
    Zap,
} from 'lucide-react';
import { SessionScreenshotItem } from '../types';
import { buildMarketExecutionPreview } from '../../../schemas/backtestContracts';
import { useLocale } from '../../../context/LocaleContext';

export interface DrawnObjectItem {
    id: string;
    name: string;
    label: string;
    visible?: boolean;
    locked?: boolean;
    color?: string;
    extendData?: string;
}

export type RightDrawerMode = 'none' | 'trade' | 'journal' | 'objects';

interface RightSidePanelLayerProps {
    ticker: string;
    periodText?: string;
    rightDrawer: RightDrawerMode;
    orderSide: 'BUY' | 'SELL';
    orderType: 'MARKET' | 'LIMIT' | 'STOP';
    limitEntryPrice: string;
    currentBid?: number;
    decimals?: number;
    riskPercent: number;
    slDistancePct: number;
    rrTarget: number;
    spread: number;
    commission: number;
    journalNotes: string;
    simBalance: number;
    floatingPnl: number;
    netProfit: number;
    savingSession: boolean;
    savedSuccess: boolean;
    drawnItems?: DrawnObjectItem[];
    selectedDrawingId?: string | null;
    activeIndicators?: string[];
    sessionScreenshots?: SessionScreenshotItem[];
    onSetRightDrawer: React.Dispatch<React.SetStateAction<RightDrawerMode>>;
    onSetOrderSide: (side: 'BUY' | 'SELL') => void;
    onSetOrderType: (type: 'MARKET' | 'LIMIT' | 'STOP') => void;
    onSetLimitEntryPrice: (val: string) => void;
    onSetRiskPercent: (val: number) => void;
    onSetSlDistancePct: (val: number) => void;
    onSetRrTarget: (val: number) => void;
    onSetSpread: (val: number) => void;
    onSetCommission: (val: number) => void;
    onSetJournalNotes: (val: string) => void;
    onExecuteOrder: () => void;
    onSaveSession: () => void;
    onClearDrawings: () => void;
    onRemoveDrawingById?: (id: string) => void;
    onSelectDrawingById?: (id: string) => void;
    onToggleDrawingVisibleById?: (id: string) => void;
    onToggleDrawingLockById?: (id: string) => void;
    onRemoveIndicatorByCode?: (code: string) => void;
    onRemoveScreenshot?: (id: string) => void;
    onOpenScreenshotModal?: () => void;
    showChartOrderPreview?: boolean;
    onToggleChartOrderPreview?: () => void;
}

export const RightSidePanelLayer: React.FC<RightSidePanelLayerProps> = memo(({
    ticker,
    periodText = '15m',
    rightDrawer,
    orderSide,
    orderType,
    limitEntryPrice,
    currentBid = 0,
    decimals = 2,
    riskPercent,
    slDistancePct,
    rrTarget,
    spread,
    commission,
    journalNotes,
    simBalance,
    floatingPnl,
    netProfit,
    savingSession,
    savedSuccess,
    drawnItems = [],
    selectedDrawingId = null,
    activeIndicators = [],
    sessionScreenshots = [],
    onSetRightDrawer,
    onSetOrderSide,
    onSetOrderType,
    onSetLimitEntryPrice,
    onSetRiskPercent,
    onSetSlDistancePct,
    onSetRrTarget,
    onSetSpread,
    onSetCommission,
    onSetJournalNotes,
    onExecuteOrder,
    onSaveSession,
    onClearDrawings,
    onRemoveDrawingById,
    onSelectDrawingById,
    onToggleDrawingVisibleById,
    onToggleDrawingLockById,
    onRemoveIndicatorByCode,
    onRemoveScreenshot,
    onOpenScreenshotModal,
    showChartOrderPreview = true,
    onToggleChartOrderPreview,
}) => {
    const { locale } = useLocale();
    const isEn = locale === 'en';

    const executionPreview = useMemo(() => {
        const parsedEntry = parseFloat(limitEntryPrice);
        return buildMarketExecutionPreview({
            symbol: ticker,
            side: orderSide,
            orderType,
            bid: currentBid,
            requestedPrice: Number.isFinite(parsedEntry) && parsedEntry > 0 ? parsedEntry : undefined,
            balance: simBalance,
            riskPercent,
            slDistancePct,
            rrTarget,
            spread,
            commission,
            decimals,
        });
    }, [
        ticker,
        orderSide,
        orderType,
        currentBid,
        limitEntryPrice,
        simBalance,
        riskPercent,
        slDistancePct,
        rrTarget,
        spread,
        commission,
        decimals,
    ]);

    return (
        <>
            {/* SLIDE-OVER DRAWER (TRADE / JOURNAL / OBJECT TREE) */}
            {rightDrawer !== 'none' && (
                <div className="w-72 border-l flex flex-col z-30 shadow-xl bg-surface border-line">
                    <div className="px-4 py-3 border-b flex items-center justify-between border-line">
                        <span className="font-bold text-xs uppercase tracking-wider">
                            {rightDrawer === 'trade'
                                ? (isEn ? 'Order Ticket' : 'Boleta de Ordem')
                                : rightDrawer === 'journal'
                                    ? (isEn ? 'Replay Journal' : 'Diário do Replay')
                                    : (isEn ? 'Object Tree (Layers)' : 'Object tree (Camadas)')}
                        </span>
                        <button
                            onClick={() => onSetRightDrawer('none')}
                            className="opacity-60 hover:opacity-100 cursor-pointer"
                        >
                            <X size={15} />
                        </button>
                    </div>

                    {rightDrawer === 'objects' ? (
                        <div className="p-3 flex-1 flex flex-col justify-between overflow-y-auto">
                            <div className="space-y-1">
                                {/* Primary Instrument Row */}
                                <div className="px-2.5 py-2 rounded-lg flex items-center gap-2.5 text-xs font-bold bg-surface-2 text-fg">
                                    <CandlestickChart size={15} className="text-accent shrink-0" />
                                    <span>{ticker} · {periodText.toUpperCase()}</span>
                                </div>

                                {/* Default Volume & Active Indicators */}
                                <div className="px-2.5 py-1.5 rounded-lg flex items-center justify-between text-xs text-fg-muted">
                                    <div className="flex items-center gap-2.5">
                                        <Activity size={14} className="shrink-0 opacity-70" />
                                        <span>Volume</span>
                                    </div>
                                    <span className="text-[10px] opacity-60">Base</span>
                                </div>
                                {activeIndicators.map(ind => (
                                    <div
                                        key={ind}
                                        className="px-2.5 py-1.5 rounded-lg flex items-center justify-between text-xs text-fg hover:bg-surface-2 group"
                                    >
                                        <div className="flex items-center gap-2.5">
                                            <Activity size={14} className="shrink-0 text-accent" />
                                            <span>{isEn ? `Indicator: ${ind}` : `Indicador: ${ind}`}</span>
                                        </div>
                                        {onRemoveIndicatorByCode && (
                                            <button
                                                onClick={() => onRemoveIndicatorByCode(ind)}
                                                className="opacity-60 hover:opacity-100 hover:text-neg p-1 rounded cursor-pointer"
                                                title={isEn ? `Remove indicator ${ind}` : `Remover indicador ${ind}`}
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        )}
                                    </div>
                                ))}

                                <div className="pt-2 pb-1 px-2 text-[10px] font-bold uppercase tracking-wider text-fg-muted flex items-center justify-between">
                                    <span>{isEn ? `Objects on Chart (${drawnItems.length})` : `Objetos na Tela (${drawnItems.length})`}</span>
                                    {drawnItems.length > 0 && (
                                        <button
                                            onClick={onClearDrawings}
                                            className="text-neg hover:underline cursor-pointer"
                                        >
                                            {isEn ? 'Clear all' : 'Limpar tudo'}
                                        </button>
                                    )}
                                </div>

                                {drawnItems.length === 0 ? (
                                    <div className="px-2.5 py-6 text-center text-xs text-fg-muted border border-dashed border-line rounded-xl">
                                        {isEn
                                            ? 'No drawings yet. Select a tool from the left bar.'
                                            : 'Nenhum objeto desenhado ainda. Selecione uma ferramenta à esquerda.'}
                                    </div>
                                ) : (
                                    drawnItems.map(item => {
                                        const isSelected = selectedDrawingId === item.id;
                                        const isVis = item.visible !== false;
                                        const isLock = item.locked === true;
                                        return (
                                            <div
                                                key={item.id}
                                                onClick={() => onSelectDrawingById?.(item.id)}
                                                className={`px-2.5 py-1.5 rounded-lg flex items-center justify-between text-xs cursor-pointer transition-colors group border ${
                                                    isSelected
                                                        ? 'bg-[#2962ff]/14 border-[#2962ff]/35 text-[#2962ff] font-semibold'
                                                        : 'border-transparent hover:bg-surface-2 text-fg'
                                                }`}
                                            >
                                                <div className="flex items-center gap-2 min-w-0">
                                                    {item.name === 'tvEmojiMarker' && item.extendData ? (
                                                        <span className="text-sm leading-none shrink-0">{item.extendData}</span>
                                                    ) : (
                                                        <span
                                                            className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/15 dark:border-white/20"
                                                            style={{ backgroundColor: item.color || '#2962ff' }}
                                                        />
                                                    )}
                                                    <span className={`truncate ${!isVis ? 'line-through opacity-50' : ''}`}>
                                                        {item.label}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                                                    {onToggleDrawingVisibleById && (
                                                        <button
                                                            onClick={() => onToggleDrawingVisibleById(item.id)}
                                                            className="opacity-60 hover:opacity-100 p-1 rounded cursor-pointer hover:bg-surface-3"
                                                            title={isVis ? (isEn ? 'Hide layer' : 'Ocultar camada') : (isEn ? 'Show layer' : 'Mostrar camada')}
                                                        >
                                                            {isVis ? <Eye size={12} /> : <EyeOff size={12} className="text-neg" />}
                                                        </button>
                                                    )}
                                                    {onToggleDrawingLockById && (
                                                        <button
                                                            onClick={() => onToggleDrawingLockById(item.id)}
                                                            className="opacity-60 hover:opacity-100 p-1 rounded cursor-pointer hover:bg-surface-3"
                                                            title={isLock ? (isEn ? 'Unlock layer' : 'Desbloquear camada') : (isEn ? 'Lock layer' : 'Bloquear camada')}
                                                        >
                                                            {isLock ? <Lock size={12} className="text-warn" /> : <Unlock size={12} />}
                                                        </button>
                                                    )}
                                                    {onRemoveDrawingById && (
                                                        <button
                                                            onClick={() => onRemoveDrawingById(item.id)}
                                                            className="opacity-60 hover:opacity-100 hover:text-neg p-1 rounded cursor-pointer hover:bg-surface-3"
                                                            title={isEn ? 'Delete object' : 'Apagar objeto'}
                                                        >
                                                            <Trash2 size={12} />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    ) : rightDrawer === 'trade' ? (
                        <div className="p-4 space-y-4 flex-1 overflow-y-auto">
                            {/* Live Bid / Ask Market Strip */}
                            {currentBid > 0 && (
                                <div className="grid grid-cols-2 gap-1.5 px-2.5 py-2 rounded-xl border border-line bg-surface-2/70 text-[11px] font-mono">
                                    <div className="flex flex-col">
                                        <span className="text-[9px] uppercase font-sans font-bold text-fg-muted">{isEn ? 'BID Quote (Sell)' : 'Cotação BID (Venda)'}</span>
                                        <span className="font-bold text-rose-500">{executionPreview.bid.toFixed(decimals)}</span>
                                    </div>
                                    <div className="flex flex-col text-right">
                                        <span className="text-[9px] uppercase font-sans font-bold text-fg-muted">{isEn ? 'ASK Quote (Buy)' : 'Cotação ASK (Compra)'}</span>
                                        <span className="font-bold text-emerald-500">{executionPreview.ask.toFixed(decimals)}</span>
                                    </div>
                                </div>
                            )}

                            {/* Buy / Sell Side */}
                            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-black/5 dark:bg-white/5">
                                <button
                                    onClick={() => onSetOrderSide('BUY')}
                                    className={`py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                        orderSide === 'BUY'
                                            ? 'bg-emerald-600 text-white shadow-sm'
                                            : 'text-slate-400 hover:text-emerald-500'
                                    }`}
                                >
                                    BUY / LONG
                                </button>
                                <button
                                    onClick={() => onSetOrderSide('SELL')}
                                    className={`py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                        orderSide === 'SELL'
                                            ? 'bg-rose-600 text-white shadow-sm'
                                            : 'text-slate-400 hover:text-rose-500'
                                    }`}
                                >
                                    SELL / SHORT
                                </button>
                            </div>

                            {/* Market / Limit / Stop */}
                            <div className="grid grid-cols-3 gap-1.5 text-xs">
                                <button
                                    type="button"
                                    onClick={() => onSetOrderType('MARKET')}
                                    className={`py-1.5 rounded-lg font-semibold border cursor-pointer transition-colors ${
                                        orderType === 'MARKET'
                                            ? 'border-accent bg-accent/10 text-accent-fg font-bold'
                                            : 'border-line/60 opacity-70 hover:opacity-100'
                                    }`}
                                >
                                    {isEn ? 'Market' : 'Mercado'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        onSetOrderType('LIMIT');
                                        if (!limitEntryPrice && currentBid > 0) {
                                            const suggested =
                                                orderSide === 'BUY'
                                                    ? currentBid * 0.9985
                                                    : (currentBid + spread) * 1.0015;
                                            onSetLimitEntryPrice(suggested.toFixed(decimals));
                                        }
                                    }}
                                    className={`py-1.5 rounded-lg font-semibold border cursor-pointer transition-colors ${
                                        orderType === 'LIMIT'
                                            ? 'border-amber-500/70 bg-amber-500/12 text-amber-500 font-bold'
                                            : 'border-line/60 opacity-70 hover:opacity-100'
                                    }`}
                                >
                                    Limit
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        onSetOrderType('STOP');
                                        if (!limitEntryPrice && currentBid > 0) {
                                            const suggested =
                                                orderSide === 'BUY'
                                                    ? (currentBid + spread) * 1.0015
                                                    : currentBid * 0.9985;
                                            onSetLimitEntryPrice(suggested.toFixed(decimals));
                                        }
                                    }}
                                    className={`py-1.5 rounded-lg font-semibold border cursor-pointer transition-colors ${
                                        orderType === 'STOP'
                                            ? 'border-indigo-500/70 bg-indigo-500/12 text-indigo-400 font-bold'
                                            : 'border-line/60 opacity-70 hover:opacity-100'
                                    }`}
                                >
                                    Stop
                                </button>
                            </div>

                            {(orderType === 'LIMIT' || orderType === 'STOP') && (
                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <label className="text-[11px] opacity-75 font-medium">
                                            {orderType === 'LIMIT'
                                                ? (isEn ? 'Limit Price (Pullback)' : 'Preço Limite (Recuo)')
                                                : (isEn ? 'Stop Trigger Price (Breakout)' : 'Preço Gatilho Stop (Rompimento)')}
                                        </label>
                                        {currentBid > 0 && (
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    onSetLimitEntryPrice(
                                                        (orderSide === 'BUY' ? executionPreview.ask : executionPreview.bid).toFixed(decimals)
                                                    )
                                                }
                                                className="text-[10px] font-bold text-accent-fg hover:underline cursor-pointer"
                                            >
                                                {isEn ? 'Current Quote' : 'Cotação Atual'}
                                            </button>
                                        )}
                                    </div>
                                    <input
                                        type="number"
                                        step="any"
                                        value={limitEntryPrice}
                                        onChange={e => onSetLimitEntryPrice(e.target.value)}
                                        className="w-full px-3 py-1.5 rounded-lg border text-xs font-mono bg-surface-2 border-line text-fg focus:outline-none focus:border-accent"
                                    />
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-2.5">
                                <div>
                                    <label className="text-[11px] opacity-70 block mb-1">{isEn ? 'Risk (%)' : 'Risco (%)'}</label>
                                    <input
                                        type="number"
                                        step="0.25"
                                        min="0.1"
                                        max="10"
                                        value={riskPercent}
                                        onChange={e => onSetRiskPercent(parseFloat(e.target.value) || 1)}
                                        className="w-full px-2.5 py-1.5 rounded-lg border text-xs font-mono bg-surface-2 border-line text-fg"
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] opacity-70 block mb-1">{isEn ? 'R:R Target (1:X)' : 'Alvo R:R (1:X)'}</label>
                                    <input
                                        type="number"
                                        step="0.5"
                                        min="0.5"
                                        max="20"
                                        value={rrTarget}
                                        onChange={e => onSetRrTarget(parseFloat(e.target.value) || 2)}
                                        className="w-full px-2.5 py-1.5 rounded-lg border text-xs font-mono bg-surface-2 border-line text-fg"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="text-[11px] opacity-70 block mb-1">{isEn ? 'Stop Loss Distance (%)' : 'Distância Stop Loss (%)'}</label>
                                <input
                                    type="number"
                                    step="0.05"
                                    min="0.05"
                                    max="5"
                                    value={slDistancePct}
                                    onChange={e => onSetSlDistancePct(parseFloat(e.target.value) || 0.3)}
                                    className="w-full px-2.5 py-1.5 rounded-lg border text-xs font-mono bg-surface-2 border-line text-fg"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-2.5">
                                <div>
                                    <label className="text-[11px] opacity-70 block mb-1" title={isEn ? 'Spread in price units' : 'Spread em unidades de preço'}>
                                        {isEn ? 'Spread (price)' : 'Spread (preço)'}
                                    </label>
                                    <input
                                        type="number"
                                        step="any"
                                        min="0"
                                        value={spread}
                                        onChange={e => onSetSpread(Math.max(0, parseFloat(e.target.value) || 0))}
                                        className="w-full px-2.5 py-1.5 rounded-lg border text-xs font-mono bg-surface-2 border-line text-fg"
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] opacity-70 block mb-1" title={isEn ? 'Flat commission charged on open ($)' : 'Comissão fixa cobrada na abertura ($)'}>
                                        {isEn ? 'Commission ($)' : 'Comissão ($)'}
                                    </label>
                                    <input
                                        type="number"
                                        step="0.5"
                                        min="0"
                                        value={commission}
                                        onChange={e => onSetCommission(Math.max(0, parseFloat(e.target.value) || 0))}
                                        className="w-full px-2.5 py-1.5 rounded-lg border text-xs font-mono bg-surface-2 border-line text-fg"
                                    />
                                </div>
                            </div>

                            {/* LIVE EXECUTION PREVIEW & ZOD VALIDATION CARD */}
                            <div className="p-2.5 rounded-xl border border-line bg-surface-2/50 space-y-1.5 text-[11px]">
                                <div className="flex items-center justify-between border-b border-line/70 pb-1 gap-1">
                                    <span className="font-bold uppercase tracking-wider text-[9px] text-fg-muted flex items-center gap-1">
                                        <Zap size={11} className="text-accent-fg" />
                                        {isEn ? 'Live Execution Summary' : 'Resumo de Execução Real'}
                                    </span>
                                    <div className="flex items-center gap-1.5">
                                        {onToggleChartOrderPreview && (
                                            <button
                                                type="button"
                                                onClick={onToggleChartOrderPreview}
                                                title={
                                                    showChartOrderPreview
                                                        ? isEn
                                                            ? 'Hide draggable preview lines on chart'
                                                            : 'Ocultar linhas de preview arrastáveis no gráfico'
                                                        : isEn
                                                          ? 'Show draggable preview lines on chart'
                                                          : 'Mostrar linhas de preview arrastáveis no gráfico'
                                                }
                                                className={`px-1.5 py-0.5 rounded border text-[9px] font-bold flex items-center gap-1 cursor-pointer transition-colors ${
                                                    showChartOrderPreview
                                                        ? 'border-accent/40 bg-accent/15 text-accent-fg'
                                                        : 'border-line bg-surface text-fg-muted hover:text-fg'
                                                }`}
                                            >
                                                {showChartOrderPreview ? <Eye size={10} /> : <EyeOff size={10} />}
                                                <span>{isEn ? 'Preview' : 'Preview'}</span>
                                            </button>
                                        )}
                                        <span className="font-mono font-bold text-accent-fg">
                                            {executionPreview.lots.toFixed(2)} {isEn ? 'Lots' : 'Lotes'}
                                        </span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-3 gap-1 font-mono text-[10px] pt-0.5">
                                    <div>
                                        <div className="text-[9px] font-sans text-fg-muted">{isEn ? 'Entry' : 'Entrada'}</div>
                                        <div className="font-bold text-fg">
                                            {executionPreview.entryPrice > 0 ? executionPreview.entryPrice.toFixed(decimals) : '—'}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-[9px] font-sans text-rose-500">Stop Loss</div>
                                        <div className="font-bold text-rose-500">
                                            {executionPreview.stopLoss > 0 ? executionPreview.stopLoss.toFixed(decimals) : '—'}
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-[9px] font-sans text-emerald-500">Take Profit</div>
                                        <div className="font-bold text-emerald-500">
                                            {executionPreview.takeProfit > 0 ? executionPreview.takeProfit.toFixed(decimals) : '—'}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between text-[10px] pt-1 border-t border-line/60 font-mono">
                                    <span className="text-rose-500 font-semibold" title={isEn ? 'Maximum net loss at Stop Loss (incl. commission)' : 'Perda líquida máxima no Stop Loss (incluindo comissão)'}>
                                        {isEn ? 'Risk:' : 'Risco:'} -${executionPreview.netLossAtSl.toFixed(2)}
                                    </span>
                                    <span className="text-emerald-500 font-semibold" title={isEn ? 'Projected net profit at Take Profit (after commission)' : 'Lucro líquido projetado no Take Profit (após comissão)'}>
                                        {isEn ? 'Target:' : 'Alvo:'} +${executionPreview.netRewardAtTp.toFixed(2)} ({executionPreview.effectiveRr}R)
                                    </span>
                                </div>

                                {executionPreview.validationError ? (
                                    <div className="px-2 py-1.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-500 text-[10px] flex items-start gap-1.5">
                                        <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                                        <span>{executionPreview.validationError}</span>
                                    </div>
                                ) : (
                                    <>
                                        {executionPreview.executionHint && (
                                            <div className="text-[10px] text-fg-muted leading-snug pt-0.5">
                                                {executionPreview.executionHint} · <span className="font-mono">{executionPreview.unitLabel}</span>
                                            </div>
                                        )}
                                        {showChartOrderPreview && executionPreview.valid && (
                                            <div className="text-[9px] text-accent-fg/90 font-semibold leading-snug">
                                                {isEn
                                                    ? 'Drag Entry / SL / TP on chart to adjust'
                                                    : 'Arraste Entrada / SL / TP no gráfico para ajustar'}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>

                            <button
                                type="button"
                                disabled={!executionPreview.valid}
                                onClick={onExecuteOrder}
                                className={`w-full py-2.5 rounded-xl font-bold text-xs text-white shadow-md cursor-pointer transition-transform active:scale-98 disabled:opacity-40 disabled:cursor-not-allowed ${
                                    orderSide === 'BUY' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-600 hover:bg-rose-500'
                                }`}
                            >
                                {orderType === 'MARKET'
                                    ? (isEn
                                        ? `Execute ${orderSide} Market (${executionPreview.lots.toFixed(2)}L)`
                                        : `Executar ${orderSide} a Mercado (${executionPreview.lots.toFixed(2)}L)`)
                                    : orderType === 'STOP'
                                      ? (isEn
                                          ? `Place ${orderSide} Stop (${executionPreview.lots.toFixed(2)}L)`
                                          : `Posicionar ${orderSide} Stop (${executionPreview.lots.toFixed(2)}L)`)
                                      : (isEn
                                          ? `Place ${orderSide} Limit (${executionPreview.lots.toFixed(2)}L)`
                                          : `Posicionar ${orderSide} Limit (${executionPreview.lots.toFixed(2)}L)`)}
                            </button>

                            <div className="p-3 rounded-xl border text-xs space-y-1.5 bg-surface-2 border-line">
                                <div className="flex justify-between">
                                    <span className="opacity-60">{isEn ? 'Realized Balance:' : 'Saldo Realizado:'}</span>
                                    <span className="font-mono font-bold">${simBalance.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="opacity-60">{isEn ? 'Floating P&L:' : 'P&L Flutuante:'}</span>
                                    <span className={`font-mono font-bold ${floatingPnl >= 0 ? 'text-pos' : 'text-neg'}`}>
                                        {floatingPnl >= 0 ? '+' : ''}${floatingPnl.toFixed(2)}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="opacity-60">{isEn ? 'Net P&L:' : 'Lucro Líquido:'}</span>
                                    <span className={`font-mono font-bold ${netProfit >= 0 ? 'text-pos' : 'text-neg'}`}>
                                        {netProfit >= 0 ? '+' : ''}${netProfit.toFixed(2)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="p-4 space-y-3 flex-1 flex flex-col overflow-y-auto">
                            <p className="text-xs opacity-70">
                                {isEn
                                    ? 'Log Fibonacci confluences, SMC market structure, or execution triggers observed in this replay:'
                                    : 'Anote confluências de Fibonacci, estrutura SMC ou gatilhos observados neste replay:'}
                            </p>
                            <textarea
                                value={journalNotes}
                                onChange={e => onSetJournalNotes(e.target.value)}
                                placeholder={
                                    isEn
                                        ? 'e.g. 61.8% retracement respected on M15 after liquidity sweep...'
                                        : 'Ex: Retração de 61.8% respeitada no M15 após sweep de liquidez...'
                                }
                                className="w-full min-h-[120px] flex-1 rounded-xl border p-3 text-xs resize-none bg-surface-2 border-line text-fg"
                            />

                            {/* Galeria de Capturas Salvas no Journal da Sessão */}
                            <div className="border-t border-line pt-2.5 space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">
                                        {isEn ? `Session Snapshots (${sessionScreenshots.length})` : `Capturas da Sessão (${sessionScreenshots.length})`}
                                    </span>
                                    {onOpenScreenshotModal && (
                                        <button
                                            type="button"
                                            onClick={onOpenScreenshotModal}
                                            className="flex items-center gap-1 px-2 py-0.5 rounded bg-accent/15 hover:bg-accent/25 text-accent-fg text-[10px] font-bold cursor-pointer transition-colors"
                                        >
                                            <Camera size={11} />
                                            <span>{isEn ? 'Capture' : 'Capturar'}</span>
                                        </button>
                                    )}
                                </div>

                                {sessionScreenshots.length === 0 ? (
                                    <div className="p-3 rounded-xl border border-dashed border-line text-[11px] text-fg-subtle text-center">
                                        {isEn
                                            ? 'No snapshots saved yet. Click the camera icon to save to the Journal.'
                                            : 'Nenhuma captura salva ainda. Clique no ícone de câmera para salvar no Journal.'}
                                    </div>
                                ) : (
                                    <div className="space-y-2 max-h-56 overflow-y-auto pr-0.5">
                                        {sessionScreenshots.map(shot => (
                                            <div
                                                key={shot.id}
                                                className="rounded-xl border border-line bg-surface-2 p-2 space-y-1.5"
                                            >
                                                <div className="relative rounded-lg overflow-hidden border border-line-subtle bg-black/20">
                                                    <img
                                                        src={shot.dataUrl}
                                                        alt={shot.caption || shot.symbol}
                                                        className="w-full h-24 object-cover"
                                                    />
                                                    <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/70 text-white text-[9px] font-mono font-bold">
                                                        {shot.symbol} · {shot.timeframe}
                                                    </div>
                                                </div>
                                                {shot.caption && (
                                                    <div className="text-[11px] text-fg leading-snug">
                                                        {shot.caption}
                                                    </div>
                                                )}
                                                <div className="flex items-center justify-between text-[10px] text-fg-subtle pt-0.5">
                                                    <span>
                                                        {new Date(shot.createdAt).toLocaleTimeString(isEn ? 'en-US' : 'pt-BR', {
                                                            hour: '2-digit',
                                                            minute: '2-digit',
                                                        })}
                                                    </span>
                                                    <div className="flex items-center gap-1">
                                                        <a
                                                            href={shot.dataUrl}
                                                            download={`Journal_${shot.symbol}_${shot.timeframe}_${shot.id}.png`}
                                                            className="p-1 rounded hover:bg-surface-3 text-fg-muted hover:text-fg"
                                                            title={isEn ? 'Download image' : 'Baixar imagem'}
                                                        >
                                                            <Download size={12} />
                                                        </a>
                                                        {onRemoveScreenshot && (
                                                            <button
                                                                type="button"
                                                                onClick={() => onRemoveScreenshot(shot.id)}
                                                                className="p-1 rounded hover:bg-surface-3 text-fg-muted hover:text-neg cursor-pointer"
                                                                title={isEn ? 'Remove snapshot from Journal' : 'Remover captura do Journal'}
                                                            >
                                                                <Trash2 size={12} />
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <button
                                onClick={onSaveSession}
                                disabled={savingSession}
                                className="w-full py-2.5 rounded-xl bg-accent hover:opacity-95 text-accent-on font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
                            >
                                {savedSuccess ? <CheckCircle2 size={14} /> : <Save size={14} />}
                                {savingSession
                                    ? (isEn ? 'Saving...' : 'Salvando...')
                                    : savedSuccess
                                      ? (isEn ? 'Saved to History!' : 'Salvo no Histórico!')
                                      : (isEn ? 'Save Session' : 'Salvar Sessão')}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* RIGHT MINI ACTION BAR (Compact w-10 Interactive Rail) */}
            <div className="w-10 border-l flex flex-col items-center justify-between py-2.5 z-30 bg-surface border-line shrink-0">
                <button
                    onClick={() => onSetRightDrawer(d => (d === 'objects' ? 'none' : 'objects'))}
                    title={isEn ? 'Layers & Drawn Objects' : 'Camadas e Objetos Desenhados'}
                    className={`p-1.5 rounded-lg transition-colors cursor-pointer relative ${
                        rightDrawer === 'objects'
                            ? 'bg-accent/15 text-accent'
                            : 'text-fg-muted hover:text-fg hover:bg-surface-2'
                    }`}
                >
                    <Layers size={16} />
                    {drawnItems.length > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 min-w-[13px] h-[13px] px-0.5 rounded-full bg-accent text-accent-on text-[8px] font-bold flex items-center justify-center">
                            {drawnItems.length}
                        </span>
                    )}
                </button>

                <div className="flex flex-col items-center gap-2">
                    <button
                        onClick={() => onSetRightDrawer(d => (d === 'trade' ? 'none' : 'trade'))}
                        title={isEn ? 'Order Ticket (+ Trade)' : 'Boleta de Ordem (+ Trade)'}
                        className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                            rightDrawer === 'trade'
                                ? 'text-accent bg-accent/15'
                                : 'text-fg-muted hover:text-fg hover:bg-surface-2'
                        }`}
                    >
                        <PlusCircle size={17} />
                    </button>

                    <button
                        onClick={() => onSetRightDrawer(d => (d === 'journal' ? 'none' : 'journal'))}
                        title={isEn ? 'Replay Journal (Notes & Snapshots)' : 'Diário do Replay (Journal & Capturas)'}
                        className={`p-1.5 rounded-lg cursor-pointer transition-colors relative ${
                            rightDrawer === 'journal'
                                ? 'text-accent bg-accent/15'
                                : 'text-fg-muted hover:text-fg hover:bg-surface-2'
                        }`}
                    >
                        <FileEdit size={16} />
                        {sessionScreenshots.length > 0 && (
                            <span className="absolute -top-0.5 -right-0.5 min-w-[13px] h-[13px] px-0.5 rounded-full bg-emerald-500 text-white text-[8px] font-bold flex items-center justify-center">
                                {sessionScreenshots.length}
                            </span>
                        )}
                    </button>
                </div>
            </div>
        </>
    );
});

RightSidePanelLayer.displayName = 'RightSidePanelLayer';
