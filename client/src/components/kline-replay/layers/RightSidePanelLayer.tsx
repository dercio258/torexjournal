import React, { memo } from 'react';
import { Layers, Plus, FileText, X } from 'lucide-react';

interface RightSidePanelLayerProps {
    isLight: boolean;
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
    isLight,
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
                    isLight ? 'bg-white border-slate-200 text-slate-800' : 'bg-[#181c27] border-slate-800 text-slate-100'
                }`}>
                    {rightDrawer === 'trade' && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between border-b pb-2.5 border-slate-200 dark:border-slate-800">
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
                                            ? 'bg-[#26a69a] text-white border-[#26a69a] shadow-md'
                                            : 'border-slate-300 dark:border-slate-700 opacity-70'
                                    }`}
                                >
                                    BUY / COMPRAR
                                </button>
                                <button
                                    onClick={() => onSetOrderSide('SELL')}
                                    className={`py-2 rounded-xl font-black text-xs cursor-pointer border transition-all ${
                                        orderSide === 'SELL'
                                            ? 'bg-[#ef5350] text-white border-[#ef5350] shadow-md'
                                            : 'border-slate-300 dark:border-slate-700 opacity-70'
                                    }`}
                                >
                                    SELL / VENDER
                                </button>
                            </div>

                            <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-semibold">
                                <button
                                    onClick={() => onSetOrderType('MARKET')}
                                    className={`py-1 rounded-md cursor-pointer ${
                                        orderType === 'MARKET' ? 'bg-white dark:bg-slate-900 shadow-xs font-bold' : 'opacity-60'
                                    }`}
                                >
                                    Market (Mercado)
                                </button>
                                <button
                                    onClick={() => onSetOrderType('LIMIT')}
                                    className={`py-1 rounded-md cursor-pointer ${
                                        orderType === 'LIMIT' ? 'bg-white dark:bg-slate-900 shadow-xs font-bold' : 'opacity-60'
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
                                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono font-bold"
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
                                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono font-bold"
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
                                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono font-bold"
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
                                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono font-bold"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="font-semibold opacity-75">Alvo R:R:</label>
                                    <select
                                        value={rrTarget}
                                        onChange={e => onSetRrTarget(parseFloat(e.target.value))}
                                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono font-bold"
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
                                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono font-bold"
                                />
                                <p className="text-[10.5px] opacity-60">Tamanho calculado pelo risco %: o stop custa exatamente o risco definido.</p>
                            </div>

                            <button
                                onClick={onExecuteOrder}
                                className={`w-full py-2.5 rounded-xl font-black text-xs text-white shadow-lg cursor-pointer transition-transform active:scale-98 ${
                                    orderSide === 'BUY' ? 'bg-[#26a69a] hover:bg-teal-600' : 'bg-[#ef5350] hover:bg-rose-600'
                                }`}
                            >
                                Enviar Ordem {orderSide} ({orderType})
                            </button>
                        </div>
                    )}

                    {rightDrawer === 'journal' && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between border-b pb-2.5 border-slate-200 dark:border-slate-800">
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
                                className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-xs focus:outline-none"
                            />
                            <button
                                onClick={onSaveSession}
                                disabled={savingSession}
                                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs cursor-pointer"
                            >
                                {savedSuccess ? 'Sessão Salva no Histórico!' : 'Salvar Sessão e Notas'}
                            </button>
                        </div>
                    )}

                    <div className="pt-3 border-t border-slate-200 dark:border-slate-800 text-[11px] space-y-1 font-mono">
                        <div className="flex justify-between">
                            <span className="opacity-60">Saldo da Sessão:</span>
                            <span className="font-bold">${(simBalance + floatingPnl).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="opacity-60">P&L Acumulado:</span>
                            <span className={`font-bold ${netProfit >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
                                {netProfit >= 0 ? '+' : ''}${netProfit.toFixed(2)}
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {/* Right Vertical Mini Bar */}
            <div className={`w-12 shrink-0 border-l flex flex-col items-center justify-between py-3 z-20 ${
                isLight ? 'bg-white border-slate-200 text-slate-600' : 'bg-[#131722] border-slate-800 text-slate-400'
            }`}>
                <button
                    onClick={onClearDrawings}
                    className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    title="Camadas / Limpar Objetos"
                >
                    <Layers size={16} />
                </button>

                <div className="flex flex-col items-center gap-3">
                    <button
                        onClick={() => onSetRightDrawer(rightDrawer === 'trade' ? 'none' : 'trade')}
                        className={`flex flex-col items-center gap-0.5 p-1.5 rounded-xl cursor-pointer transition-colors ${
                            rightDrawer === 'trade' ? 'text-indigo-600 bg-indigo-500/10 font-bold' : 'hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        <Plus size={18} className="border border-current rounded-full p-0.5" />
                        <span className="text-[10px]">Trade</span>
                    </button>

                    <button
                        onClick={() => onSetRightDrawer(rightDrawer === 'journal' ? 'none' : 'journal')}
                        className={`flex flex-col items-center gap-0.5 p-1.5 rounded-xl cursor-pointer transition-colors ${
                            rightDrawer === 'journal' ? 'text-indigo-600 bg-indigo-500/10 font-bold' : 'hover:text-slate-900 dark:hover:text-white'
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
