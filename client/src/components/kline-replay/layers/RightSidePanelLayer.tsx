import React, { memo } from 'react';
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
} from 'lucide-react';

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
    orderType: 'MARKET' | 'LIMIT';
    limitEntryPrice: string;
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
    onSetRightDrawer: React.Dispatch<React.SetStateAction<RightDrawerMode>>;
    onSetOrderSide: (side: 'BUY' | 'SELL') => void;
    onSetOrderType: (type: 'MARKET' | 'LIMIT') => void;
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
}

export const RightSidePanelLayer: React.FC<RightSidePanelLayerProps> = memo(({
    ticker,
    periodText = '15m',
    rightDrawer,
    orderSide,
    orderType,
    limitEntryPrice,
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
}) => {
    return (
        <>
            {/* SLIDE-OVER DRAWER (TRADE / JOURNAL / OBJECT TREE) */}
            {rightDrawer !== 'none' && (
                <div className="w-72 border-l flex flex-col z-30 shadow-xl bg-surface border-line">
                    <div className="px-4 py-3 border-b flex items-center justify-between border-line">
                        <span className="font-bold text-xs uppercase tracking-wider">
                            {rightDrawer === 'trade'
                                ? 'Boleta de Ordem'
                                : rightDrawer === 'journal'
                                    ? 'Diário do Replay'
                                    : 'Object tree (Camadas)'}
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
                                            <span>Indicador: {ind}</span>
                                        </div>
                                        {onRemoveIndicatorByCode && (
                                            <button
                                                onClick={() => onRemoveIndicatorByCode(ind)}
                                                className="opacity-60 hover:opacity-100 hover:text-neg p-1 rounded cursor-pointer"
                                                title={`Remover indicador ${ind}`}
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        )}
                                    </div>
                                ))}

                                <div className="pt-2 pb-1 px-2 text-[10px] font-bold uppercase tracking-wider text-fg-muted flex items-center justify-between">
                                    <span>Objetos na Tela ({drawnItems.length})</span>
                                    {drawnItems.length > 0 && (
                                        <button
                                            onClick={onClearDrawings}
                                            className="text-neg hover:underline cursor-pointer"
                                        >
                                            Limpar tudo
                                        </button>
                                    )}
                                </div>

                                {drawnItems.length === 0 ? (
                                    <div className="px-2.5 py-6 text-center text-xs text-fg-muted border border-dashed border-line rounded-xl">
                                        Nenhum objeto desenhado ainda. Selecione uma ferramenta à esquerda.
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
                                                            title={isVis ? 'Ocultar camada' : 'Mostrar camada'}
                                                        >
                                                            {isVis ? <Eye size={12} /> : <EyeOff size={12} className="text-neg" />}
                                                        </button>
                                                    )}
                                                    {onToggleDrawingLockById && (
                                                        <button
                                                            onClick={() => onToggleDrawingLockById(item.id)}
                                                            className="opacity-60 hover:opacity-100 p-1 rounded cursor-pointer hover:bg-surface-3"
                                                            title={isLock ? 'Desbloquear camada' : 'Bloquear camada'}
                                                        >
                                                            {isLock ? <Lock size={12} className="text-warn" /> : <Unlock size={12} />}
                                                        </button>
                                                    )}
                                                    {onRemoveDrawingById && (
                                                        <button
                                                            onClick={() => onRemoveDrawingById(item.id)}
                                                            className="opacity-60 hover:opacity-100 hover:text-neg p-1 rounded cursor-pointer hover:bg-surface-3"
                                                            title="Apagar objeto"
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

                            {/* Market / Limit */}
                            <div className="flex items-center gap-2 text-xs">
                                <button
                                    onClick={() => onSetOrderType('MARKET')}
                                    className={`flex-1 py-1.5 rounded-lg font-semibold border cursor-pointer ${
                                        orderType === 'MARKET'
                                            ? 'border-accent bg-accent/10 text-accent-fg'
                                            : 'border-transparent opacity-60'
                                    }`}
                                >
                                    Mercado
                                </button>
                                <button
                                    onClick={() => onSetOrderType('LIMIT')}
                                    className={`flex-1 py-1.5 rounded-lg font-semibold border cursor-pointer ${
                                        orderType === 'LIMIT'
                                            ? 'border-accent bg-accent/10 text-accent-fg'
                                            : 'border-transparent opacity-60'
                                    }`}
                                >
                                    Ordem Limit
                                </button>
                            </div>

                            {orderType === 'LIMIT' && (
                                <div>
                                    <label className="text-[11px] opacity-70 block mb-1">Preço de Entrada Limit</label>
                                    <input
                                        type="number"
                                        step="any"
                                        value={limitEntryPrice}
                                        onChange={e => onSetLimitEntryPrice(e.target.value)}
                                        className="w-full px-3 py-1.5 rounded-lg border text-xs font-mono bg-surface-2 border-line text-fg"
                                    />
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-2.5">
                                <div>
                                    <label className="text-[11px] opacity-70 block mb-1">Risco (%)</label>
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
                                    <label className="text-[11px] opacity-70 block mb-1">Alvo R:R (1:X)</label>
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
                                <label className="text-[11px] opacity-70 block mb-1">Distância Stop Loss (%)</label>
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
                                    <label className="text-[11px] opacity-70 block mb-1" title="Spread em unidades de preço">Spread (preço)</label>
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
                                    <label className="text-[11px] opacity-70 block mb-1" title="Comissão fixa cobrada na abertura ($)">Comissão ($)</label>
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

                            <button
                                onClick={onExecuteOrder}
                                className={`w-full py-2.5 rounded-xl font-bold text-xs text-white shadow-md cursor-pointer transition-transform active:scale-98 ${
                                    orderSide === 'BUY' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-600 hover:bg-rose-500'
                                }`}
                            >
                                {orderType === 'MARKET'
                                    ? `Executar ${orderSide} a Mercado`
                                    : `Posicionar ${orderSide} Limit`}
                            </button>

                            <div className="p-3 rounded-xl border text-xs space-y-1.5 bg-surface-2 border-line">
                                <div className="flex justify-between">
                                    <span className="opacity-60">Saldo Realizado:</span>
                                    <span className="font-mono font-bold">${simBalance.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="opacity-60">P&L Flutuante:</span>
                                    <span className={`font-mono font-bold ${floatingPnl >= 0 ? 'text-pos' : 'text-neg'}`}>
                                        {floatingPnl >= 0 ? '+' : ''}${floatingPnl.toFixed(2)}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="opacity-60">Lucro Líquido:</span>
                                    <span className={`font-mono font-bold ${netProfit >= 0 ? 'text-pos' : 'text-neg'}`}>
                                        {netProfit >= 0 ? '+' : ''}${netProfit.toFixed(2)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="p-4 space-y-3 flex-1 flex flex-col">
                            <p className="text-xs opacity-70">
                                Anote confluências de Fibonacci, estrutura SMC ou gatilhos observados neste replay:
                            </p>
                            <textarea
                                value={journalNotes}
                                onChange={e => onSetJournalNotes(e.target.value)}
                                placeholder="Ex: Retração de 61.8% respeitada no M15 após sweep de liquidez..."
                                className="w-full flex-1 rounded-xl border p-3 text-xs resize-none bg-surface-2 border-line text-fg"
                            />
                            <button
                                onClick={onSaveSession}
                                disabled={savingSession}
                                className="w-full py-2.5 rounded-xl bg-accent hover:opacity-95 text-accent-on font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                                {savedSuccess ? <CheckCircle2 size={14} /> : <Save size={14} />}
                                {savingSession ? 'Salvando...' : savedSuccess ? 'Salvo no Histórico!' : 'Salvar Sessão'}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* RIGHT MINI ACTION BAR (Traynio Style: Object Tree on top, +Trade and Journal on bottom) */}
            <div className="w-12 border-l flex flex-col items-center justify-between py-3 z-20 bg-surface border-line">
                <button
                    onClick={() => onSetRightDrawer(d => (d === 'objects' ? 'none' : 'objects'))}
                    title="Object tree (Árvore de Objetos e Camadas)"
                    className={`p-2 rounded-lg transition-colors cursor-pointer relative ${
                        rightDrawer === 'objects'
                            ? 'bg-accent/15 text-accent'
                            : 'text-fg-muted hover:text-fg hover:bg-surface-2'
                    }`}
                >
                    <Layers size={17} />
                    {drawnItems.length > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-accent text-accent-on text-[9px] font-bold flex items-center justify-center">
                            {drawnItems.length}
                        </span>
                    )}
                </button>

                <div className="flex flex-col items-center gap-3">
                    <button
                        onClick={() => onSetRightDrawer(d => (d === 'trade' ? 'none' : 'trade'))}
                        className={`flex flex-col items-center gap-1 p-1.5 rounded-lg text-[10px] font-medium cursor-pointer transition-colors ${
                            rightDrawer === 'trade'
                                ? 'text-accent bg-accent/10'
                                : 'text-fg-muted hover:text-fg'
                        }`}
                    >
                        <PlusCircle size={18} />
                        <span>Trade</span>
                    </button>

                    <button
                        onClick={() => onSetRightDrawer(d => (d === 'journal' ? 'none' : 'journal'))}
                        className={`flex flex-col items-center gap-1 p-1.5 rounded-lg text-[10px] font-medium cursor-pointer transition-colors ${
                            rightDrawer === 'journal'
                                ? 'text-accent bg-accent/10'
                                : 'text-fg-muted hover:text-fg'
                        }`}
                    >
                        <FileEdit size={18} />
                        <span>Journal</span>
                    </button>
                </div>
            </div>
        </>
    );
});

RightSidePanelLayer.displayName = 'RightSidePanelLayer';
