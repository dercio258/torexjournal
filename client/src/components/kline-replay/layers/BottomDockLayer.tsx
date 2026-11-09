import React, { useState, useMemo, memo } from 'react';
import { ChevronDown, ChevronUp, BarChart3 } from 'lucide-react';
import { ReplayOrder } from '../types';

interface BottomDockLayerProps {
    isLight: boolean;
    orders: ReplayOrder[];
    simBalance: number;
    floatingPnl: number;
    netProfit: number;
    formattedReplayClock: string;
    onCloseOrCancelOrder: (id: string) => void;
}

export const BottomDockLayer: React.FC<BottomDockLayerProps> = memo(({
    isLight,
    orders,
    simBalance,
    floatingPnl,
    netProfit,
    formattedReplayClock,
    onCloseOrCancelOrder,
}) => {
    const [bottomTab, setBottomTab] = useState<'positions' | 'pending' | 'history' | 'analytics'>('positions');
    const [bottomExpanded, setBottomExpanded] = useState<boolean>(false);

    const openPositions = useMemo(() => orders.filter(o => o.status === 'OPEN'), [orders]);
    const pendingOrders = useMemo(() => orders.filter(o => o.status === 'PENDING'), [orders]);
    const historyOrders = useMemo(
        () => orders.filter(o => o.status === 'WIN' || o.status === 'LOSS' || o.status === 'CLOSED'),
        [orders]
    );

    const sessionStats = useMemo(() => {
        const closedWithPnl = historyOrders.filter(o => o.status === 'WIN' || o.status === 'LOSS');
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

        // Calculate max drawdown over closed trades
        let peak = 0;
        let cum = 0;
        let maxDd = 0;
        [...closedWithPnl].reverse().forEach(ord => {
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

    return (
        <div className={`border-t text-xs ${
            isLight ? 'bg-white border-slate-200 text-slate-700' : 'bg-[#131722] border-slate-800 text-slate-300'
        }`}>
            <div className="h-10 px-4 flex items-center justify-between overflow-x-auto no-scrollbar">
                <div className="flex items-center gap-5 shrink-0">
                    <button
                        onClick={() => { setBottomTab('positions'); setBottomExpanded(e => bottomTab === 'positions' ? !e : true); }}
                        className={`flex items-center gap-1.5 font-semibold cursor-pointer ${
                            bottomTab === 'positions' ? (isLight ? 'text-slate-900 font-bold' : 'text-white font-bold') : 'opacity-60'
                        }`}
                    >
                        <span>Positions</span>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200/80 dark:bg-slate-800 font-mono">
                            {openPositions.length}
                        </span>
                    </button>

                    <button
                        onClick={() => { setBottomTab('pending'); setBottomExpanded(e => bottomTab === 'pending' ? !e : true); }}
                        className={`flex items-center gap-1.5 font-semibold cursor-pointer ${
                            bottomTab === 'pending' ? (isLight ? 'text-slate-900 font-bold' : 'text-white font-bold') : 'opacity-60'
                        }`}
                    >
                        <span>Pending</span>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200/80 dark:bg-slate-800 font-mono">
                            {pendingOrders.length}
                        </span>
                    </button>

                    <button
                        onClick={() => { setBottomTab('history'); setBottomExpanded(e => bottomTab === 'history' ? !e : true); }}
                        className={`flex items-center gap-1.5 font-semibold cursor-pointer ${
                            bottomTab === 'history' ? (isLight ? 'text-slate-900 font-bold' : 'text-white font-bold') : 'opacity-60'
                        }`}
                    >
                        <span>History</span>
                        {historyOrders.length > 0 && (
                            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200/80 dark:bg-slate-800 font-mono">
                                {historyOrders.length}
                            </span>
                        )}
                    </button>

                    <button
                        onClick={() => { setBottomTab('analytics'); setBottomExpanded(e => bottomTab === 'analytics' ? !e : true); }}
                        className={`flex items-center gap-1 font-semibold cursor-pointer ${
                            bottomTab === 'analytics' ? 'text-indigo-600 dark:text-indigo-400 font-bold' : 'opacity-60 hover:opacity-100'
                        }`}
                    >
                        <BarChart3 size={13} />
                        <span>Analytics</span>
                    </button>

                    <div className="hidden md:flex items-center gap-3 text-[11px] font-mono opacity-85 border-l pl-4 border-slate-200 dark:border-slate-800">
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

                <button
                    onClick={() => setBottomExpanded(e => !e)}
                    className="flex items-center gap-2 font-medium cursor-pointer opacity-80 hover:opacity-100 shrink-0 ml-2"
                >
                    <span>{formattedReplayClock}</span>
                    {bottomExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                </button>
            </div>

            {bottomExpanded && (
                <div className={`px-4 py-3 border-t max-h-48 overflow-y-auto font-mono text-xs ${
                    isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-900/60 border-slate-800'
                }`}>
                    {bottomTab === 'positions' && (
                        openPositions.length === 0 ? (
                            <div className="py-3 text-center opacity-50 font-sans">
                                Nenhuma posição aberta no momento. Clique em <strong>+ Trade</strong> à direita ou pressione <kbd className="px-1.5 py-0.5 rounded bg-slate-500/15 font-mono">Alt + B</kbd> / <kbd className="px-1.5 py-0.5 rounded bg-slate-500/15 font-mono">Alt + S</kbd>.
                            </div>
                        ) : (
                            <div className="divide-y divide-slate-200 dark:divide-slate-800">
                                {openPositions.map(ord => (
                                    <div key={ord.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex items-center gap-3">
                                            <span className="font-bold">{ord.id}</span>
                                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                                ord.side === 'BUY' ? 'bg-teal-500/20 text-teal-600' : 'bg-rose-500/20 text-rose-500'
                                            }`}>{ord.side} {ord.lots} lot</span>
                                            <span className="font-bold">{ord.symbol}</span>
                                            <span>Entry: {ord.entryPrice}</span>
                                            <span className="text-rose-500">SL: {ord.stopLoss}</span>
                                            <span className="text-teal-600">TP: {ord.takeProfit}</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className={`font-bold ${ord.pnl >= 0 ? 'text-teal-600' : 'text-rose-500'}`}>
                                                {ord.pnl >= 0 ? '+' : ''}${ord.pnl.toFixed(2)}
                                            </span>
                                            <button
                                                onClick={() => onCloseOrCancelOrder(ord.id)}
                                                className="px-2 py-0.5 rounded bg-rose-500 text-white text-[10px] font-sans font-bold cursor-pointer"
                                            >
                                                Fechar
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )
                    )}

                    {bottomTab === 'pending' && (
                        pendingOrders.length === 0 ? (
                            <div className="py-3 text-center opacity-50 font-sans">Nenhuma ordem pendente (Limit/Stop). Passe o mouse no eixo de preço à direita e clique em <strong>(+)</strong> para criar uma Limit rápida.</div>
                        ) : (
                            <div className="divide-y divide-slate-200 dark:divide-slate-800">
                                {pendingOrders.map(ord => (
                                    <div key={ord.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex items-center gap-3">
                                            <span className="font-bold">{ord.id}</span>
                                            <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600 text-[10px] font-bold">
                                                {ord.side} LIMIT
                                            </span>
                                            <span>Preço Alvo: {ord.entryPrice}</span>
                                            <span className="text-rose-500">SL: {ord.stopLoss}</span>
                                            <span className="text-teal-600">TP: {ord.takeProfit}</span>
                                        </div>
                                        <button
                                            onClick={() => onCloseOrCancelOrder(ord.id)}
                                            className="px-2 py-0.5 rounded bg-slate-500 text-white text-[10px] font-sans font-bold cursor-pointer"
                                        >
                                            Cancelar
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )
                    )}

                    {bottomTab === 'history' && (
                        historyOrders.length === 0 ? (
                            <div className="py-3 text-center opacity-50 font-sans">Nenhuma operação finalizada nesta sessão ainda.</div>
                        ) : (
                            <div className="divide-y divide-slate-200 dark:divide-slate-800">
                                {historyOrders.map(ord => (
                                    <div key={ord.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex items-center gap-3">
                                            <span className="font-bold">{ord.id}</span>
                                            <span className="font-bold">{ord.symbol} ({ord.side})</span>
                                            <span>Entrada: {ord.entryPrice} → Saída: {ord.exitPrice}</span>
                                        </div>
                                        <span className={`font-bold ${ord.pnl >= 0 ? 'text-teal-600' : 'text-rose-500'}`}>
                                            {ord.pnl >= 0 ? '+' : ''}${ord.pnl.toFixed(2)} ({ord.status})
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )
                    )}

                    {bottomTab === 'analytics' && (
                        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 font-sans py-1">
                            <div className={`p-2.5 rounded-xl border ${isLight ? 'bg-white border-slate-200' : 'bg-slate-800/70 border-slate-700'}`}>
                                <div className="text-[10px] opacity-60 uppercase">Trades Fechados</div>
                                <div className="text-sm font-black mt-0.5">{sessionStats.totalClosed} ({sessionStats.winsCount}W / {sessionStats.lossesCount}L)</div>
                            </div>
                            <div className={`p-2.5 rounded-xl border ${isLight ? 'bg-white border-slate-200' : 'bg-slate-800/70 border-slate-700'}`}>
                                <div className="text-[10px] opacity-60 uppercase">Win Rate</div>
                                <div className={`text-sm font-black mt-0.5 ${sessionStats.winRate >= 50 ? 'text-teal-600' : 'text-amber-500'}`}>
                                    {sessionStats.winRate}%
                                </div>
                            </div>
                            <div className={`p-2.5 rounded-xl border ${isLight ? 'bg-white border-slate-200' : 'bg-slate-800/70 border-slate-700'}`}>
                                <div className="text-[10px] opacity-60 uppercase">Profit Factor</div>
                                <div className="text-sm font-black mt-0.5">{sessionStats.profitFactor}</div>
                            </div>
                            <div className={`p-2.5 rounded-xl border ${isLight ? 'bg-white border-slate-200' : 'bg-slate-800/70 border-slate-700'}`}>
                                <div className="text-[10px] opacity-60 uppercase">Max Drawdown</div>
                                <div className="text-sm font-black text-rose-500 mt-0.5">-${sessionStats.maxDrawdown.toFixed(2)}</div>
                            </div>
                            <div className={`p-2.5 rounded-xl border ${isLight ? 'bg-white border-slate-200' : 'bg-slate-800/70 border-slate-700'}`}>
                                <div className="text-[10px] opacity-60 uppercase">Média R:R</div>
                                <div className="text-sm font-black text-indigo-500 mt-0.5">1 : {sessionStats.avgRr}</div>
                            </div>
                            <div className={`p-2.5 rounded-xl border ${isLight ? 'bg-white border-slate-200' : 'bg-slate-800/70 border-slate-700'}`}>
                                <div className="text-[10px] opacity-60 uppercase">Resultado Líquido</div>
                                <div className={`text-sm font-black mt-0.5 ${netProfit >= 0 ? 'text-teal-600' : 'text-rose-500'}`}>
                                    {netProfit >= 0 ? '+' : ''}${netProfit.toFixed(2)}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
});
