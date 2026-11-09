import React, { memo } from 'react';
import { Layers, Plus, FileText, X } from 'lucide-react';

interface RightSidePanelLayerProps {
    ticker: string;
    rightDrawer: 'none' | 'trade' | 'journal';
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
    onSetRightDrawer: (drawer: 'none' | 'trade' | 'journal') => void;
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
}

export const RightSidePanelLayer: React.FC<RightSidePanelLayerProps> = memo(({
    ticker,
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
}) => {
    return (
        <>
            {rightDrawer !== 'none' && (
                <div className={`w-72 shrink-0 border-l p-4 flex flex-col justify-between z-30 transition-all ${
                    'bg-surface border-line text-fg'
                }`}>
                    {rightDrawer === 'trade' && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between border-b pb-2.5 border-line">
                                <h4 className="font-bold text-sm">Boleta de Execução ({ticker})</h4>
                                <button onClick={() => onSetRightDrawer('none')} className="opacity-60 hover:opacity-100 cursor-pointer">
                                    <X size={15} />
                                </button>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => onSetOrderSide('BUY')}
                                    className={`py-2 rounded-xl font-black text-xs cursor-pointer border transition-all ${
                                        orderSide === 'BUY'
                                            ? 'bg-data-pos text-white border-data-pos shadow-md'
                                            : 'border-line-strong opacity-70'
                                    }`}
                                >
                                    BUY / COMPRAR
                                </button>
                                <button
                                    onClick={() => onSetOrderSide('SELL')}
                                    className={`py-2 rounded-xl font-black text-xs cursor-pointer border transition-all ${
                                        orderSide === 'SELL'
                                            ? 'bg-data-neg text-white border-data-neg shadow-md'
                                            : 'border-line-strong opacity-70'
                                    }`}
                                >
                                    SELL / VENDER
                                </button>
                            </div>

                            <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-surface-2 text-xs font-semibold">
                                <button
                                    onClick={() => onSetOrderType('MARKET')}
                                    className={`py-1 rounded-md cursor-pointer ${
                                        orderType === 'MARKET' ? 'bg-surface shadow-xs font-bold' : 'opacity-60'
                                    }`}
                                >
                                    Market (Mercado)
                                </button>
                                <button
                                    onClick={() => onSetOrderType('LIMIT')}
                                    className={`py-1 rounded-md cursor-pointer ${
                                        orderType === 'LIMIT' ? 'bg-surface shadow-xs font-bold' : 'opacity-60'
                                    }`}
                                >
                                    Limit / Pendente
                                </button>
                            </div>

                            {orderType === 'LIMIT' && (
                                <div className="space-y-1 text-xs">
                                    <label className="font-semibold opacity-75">Preço de Entrada (Limit):</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={limitEntryPrice}
                                        onChange={e => onSetLimitEntryPrice(e.target.value)}
                                        className="w-full px-2.5 py-1.5 rounded-lg border border-line-strong bg-transparent font-mono font-bold"
                                    />
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="space-y-1">
                                    <label className="font-semibold opacity-75" title="Diferença ask − bid, em unidades de preço. Compra paga na entrada, venda na saída.">Spread (preço):</label>
                                    <input
                                        type="number"
                                        step="any"
                                        min="0"
                                        value={spread}
                                        onChange={e => onSetSpread(Math.max(0, parseFloat(e.target.value) || 0))}
                                        className="w-full px-2.5 py-1.5 rounded-lg border border-line-strong bg-transparent font-mono font-bold"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="font-semibold opacity-75">Risco (% Banca):</label>
                                    <input
                                        type="number"
                                        step="0.25"
                                        min="0.1"
                                        value={riskPercent}
                                        onChange={e => onSetRiskPercent(parseFloat(e.target.value) || 1)}
                                        className="w-full px-2.5 py-1.5 rounded-lg border border-line-strong bg-transparent font-mono font-bold"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="space-y-1">
                                    <label className="font-semibold opacity-75">Distância Stop (%):</label>
                                    <input
                                        type="number"
                                        step="0.05"
                                        min="0.05"
                                        value={slDistancePct}
                                        onChange={e => onSetSlDistancePct(parseFloat(e.target.value) || 0.3)}
                                        className="w-full px-2.5 py-1.5 rounded-lg border border-line-strong bg-transparent font-mono font-bold"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="font-semibold opacity-75">Alvo R:R:</label>
                                    <select
                                        value={rrTarget}
                                        onChange={e => onSetRrTarget(parseFloat(e.target.value))}
                                        className="w-full px-2.5 py-1.5 rounded-lg border border-line-strong bg-transparent font-mono font-bold"
                                    >
                                        <option value={1}>1:1</option>
                                        <option value={1.5}>1:1.5</option>
                                        <option value={2}>1:2</option>
                                        <option value={3}>1:3</option>
                                        <option value={4}>1:4</option>
                                    </select>
                                </div>
                            </div>

                            <div className="space-y-1 text-xs">
                                <label className="font-semibold opacity-75">Comissão por trade ($):</label>
                                <input
                                    type="number"
                                    step="0.5"
                                    min="0"
                                    value={commission}
                                    onChange={e => onSetCommission(Math.max(0, parseFloat(e.target.value) || 0))}
                                    className="w-full px-2.5 py-1.5 rounded-lg border border-line-strong bg-transparent font-mono font-bold"
                                />
                                <p className="text-[10.5px] opacity-60">Tamanho calculado pelo risco %: o stop custa exatamente o risco definido.</p>
                            </div>

                            <button
                                onClick={onExecuteOrder}
                                className={`w-full py-2.5 rounded-xl font-black text-xs text-white shadow-lg cursor-pointer transition-transform active:scale-98 ${
                                    orderSide === 'BUY' ? 'bg-data-pos hover:bg-data-pos/90' : 'bg-data-neg hover:bg-data-neg/90'
                                }`}
                            >
                                Enviar Ordem {orderSide} ({orderType})
                            </button>
                        </div>
                    )}

                    {rightDrawer === 'journal' && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between border-b pb-2.5 border-line">
                                <h4 className="font-bold text-sm">Diário da Sessão (Journal)</h4>
                                <button onClick={() => onSetRightDrawer('none')} className="opacity-60 hover:opacity-100 cursor-pointer">
                                    <X size={15} />
                                </button>
                            </div>
                            <textarea
                                rows={8}
                                value={journalNotes}
                                onChange={e => onSetJournalNotes(e.target.value)}
                                placeholder="Anote o racional da entrada (ex: Retração de 61.8% da Fibonacci + Order Block no M15)..."
                                className="w-full p-3 rounded-xl border border-line-strong bg-transparent text-xs focus:outline-none"
                            />
                            <button
                                onClick={onSaveSession}
                                disabled={savingSession}
                                className="w-full py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-accent-on font-bold text-xs cursor-pointer"
                            >
                                {savedSuccess ? 'Sessão Salva no Histórico!' : 'Salvar Sessão e Notas'}
                            </button>
                        </div>
                    )}

                    <div className="pt-3 border-t border-line text-[11px] space-y-1 font-mono">
                        <div className="flex justify-between">
                            <span className="opacity-60">Saldo da Sessão:</span>
                            <span className="font-bold">${(simBalance + floatingPnl).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="opacity-60">P&L Acumulado:</span>
                            <span className={`font-bold ${netProfit >= 0 ? 'text-accent-fg' : 'text-danger-fg'}`}>
                                {netProfit >= 0 ? '+' : ''}${netProfit.toFixed(2)}
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {/* Right Vertical Mini Bar */}
            <div className={`w-12 shrink-0 border-l flex flex-col items-center justify-between py-3 z-20 ${
                'bg-surface border-line text-fg-muted'
            }`}>
                <button
                    onClick={onClearDrawings}
                    className="p-2 rounded-lg hover:bg-surface-2 cursor-pointer"
                    title="Camadas / Limpar Objetos"
                >
                    <Layers size={16} />
                </button>

                <div className="flex flex-col items-center gap-3">
                    <button
                        onClick={() => onSetRightDrawer(rightDrawer === 'trade' ? 'none' : 'trade')}
                        className={`flex flex-col items-center gap-0.5 p-1.5 rounded-xl cursor-pointer transition-colors ${
                            rightDrawer === 'trade' ? 'text-accent-fg bg-accent/10 font-bold' : 'hover:text-fg'
                        }`}
                    >
                        <Plus size={18} className="border border-current rounded-full p-0.5" />
                        <span className="text-[10px]">Trade</span>
                    </button>

                    <button
                        onClick={() => onSetRightDrawer(rightDrawer === 'journal' ? 'none' : 'journal')}
                        className={`flex flex-col items-center gap-0.5 p-1.5 rounded-xl cursor-pointer transition-colors ${
                            rightDrawer === 'journal' ? 'text-accent-fg bg-accent/10 font-bold' : 'hover:text-fg'
                        }`}
                    >
                        <FileText size={16} />
                        <span className="text-[10px]">Journal</span>
                    </button>
                </div>
            </div>
        </>
    );
});
