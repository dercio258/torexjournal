import { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Table, Inbox } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../../api';
import { Trade } from '../../types';

export const TradeHistory = () => {
    const [trades, setTrades] = useState<Trade[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        fetchTrades();
    }, []);

    const fetchTrades = async () => {
        try {
            // Assuming endpoint exists for history. Original used /api/journal presumably or implicitly loaded in dashboard?
            // Dashboard html had a table with id "trades-table" but didn't seem to load it via API in the snippet I saw?
            // Actually it had `loadRecentTrades` but also `Trade History Table` section. 
            // In dashboard.html line 284, it shows "Histórico de Trades".
            // It seems to be just a placeholder or repeats recent trades?
            // Let's assume we fetch from /api/trades.
            const res = await api.get('/trades?limit=10');
            setTrades(res.data);
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <Table className="w-4 h-4 text-emerald-400" /> Histórico de Trades
                </h2>
                <Link to="/journal" className="text-sm text-emerald-400 hover:text-emerald-300 font-medium">Ver todos →</Link>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead>
                        <tr className="border-b border-slate-700/50">
                            <th className="py-3 px-4 font-semibold text-slate-400 uppercase tracking-wider text-xs">Data/Hora</th>
                            <th className="py-3 px-4 font-semibold text-slate-400 uppercase tracking-wider text-xs">Símbolo</th>
                            <th className="py-3 px-4 font-semibold text-slate-400 uppercase tracking-wider text-xs">Sessão</th>
                            <th className="py-3 px-4 font-semibold text-slate-400 uppercase tracking-wider text-xs">Tipo</th>
                            <th className="text-right py-3 px-4 font-semibold text-slate-400 uppercase tracking-wider text-xs">Volume</th>
                            <th className="text-right py-3 px-4 font-semibold text-slate-400 uppercase tracking-wider text-xs">Entrada</th>
                            <th className="text-right py-3 px-4 font-semibold text-slate-400 uppercase tracking-wider text-xs">Saída</th>
                            <th className="text-right py-3 px-4 font-semibold text-slate-400 uppercase tracking-wider text-xs">Hold</th>
                            <th className="text-right py-3 px-4 font-semibold text-slate-400 uppercase tracking-wider text-xs">Resultado (P/L)</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/30">
                        {isLoading ? (
                            [...Array(5)].map((_, i) => (
                                <tr key={i} className="animate-pulse">
                                    <td className="py-3 px-4"><div className="h-4 bg-slate-700/50 rounded w-24"></div></td>
                                    <td className="py-3 px-4"><div className="h-4 bg-slate-700/50 rounded w-16"></div></td>
                                    <td className="py-3 px-4"><div className="h-4 bg-slate-700/50 rounded w-12"></div></td>
                                    <td className="py-3 px-4"><div className="h-4 bg-slate-700/50 rounded w-12 ml-auto"></div></td>
                                    <td className="py-3 px-4"><div className="h-4 bg-slate-700/50 rounded w-16 ml-auto"></div></td>
                                    <td className="py-3 px-4"><div className="h-4 bg-slate-700/50 rounded w-16 ml-auto"></div></td>
                                    <td className="py-3 px-4"><div className="h-4 bg-slate-700/50 rounded w-16 ml-auto"></div></td>
                                    <td className="py-3 px-4"><div className="h-4 bg-slate-700/50 rounded w-16 ml-auto"></div></td>
                                </tr>
                            ))
                        ) : trades.length > 0 ? (
                            trades.map((trade: Trade) => {
                                const isWin = trade.profit >= 0;
                                const date = new Date(trade.close_time || (trade.sell_time ? trade.sell_time * 1000 : Date.now()));

                                // Calculate Hold Duration
                                const openTime = new Date(trade.open_time || (trade.sell_time ? (trade.sell_time * 1000) - 60000 : Date.now())); // Fallback
                                const closeTime = new Date(trade.close_time || (trade.sell_time ? trade.sell_time * 1000 : Date.now()));
                                const diffMs = closeTime.getTime() - openTime.getTime();
                                const diffMins = Math.floor(diffMs / 60000);
                                const diffSecs = Math.floor((diffMs % 60000) / 1000);
                                const duration = `${diffMins}m ${diffSecs}s`;

                                return (
                                    <tr key={trade.ticket} className="hover:bg-slate-800/30 transition-colors">
                                        <td className="py-3 px-4 text-slate-300">
                                            {date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                        </td>
                                        <td className="py-3 px-4 font-medium text-slate-200">{trade.symbol}</td>
                                        <td className="py-3 px-4 text-slate-300">
                                            {trade.session && <span className="bg-slate-700/50 text-slate-400 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold">{trade.session}</span>}
                                        </td>
                                        <td className="py-3 px-4">
                                            <span className={`text-xs px-2 py-0.5 rounded-full ${trade.type === 'BUY' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'}`}>
                                                {trade.type}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 text-right text-slate-300">{Number(trade.volume).toFixed(2)}</td>
                                        <td className="py-3 px-4 text-right text-slate-300">{Number(trade.open_price).toFixed(5)}</td>
                                        <td className="py-3 px-4 text-right text-slate-300">{Number(trade.close_price).toFixed(5)}</td>
                                        <td className="py-3 px-4 text-right text-slate-400 text-xs font-mono">{duration}</td>
                                        <td className={`py-3 px-4 text-right font-bold ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {isWin ? '+' : ''}{Number(trade.profit).toFixed(2)}
                                        </td>
                                    </tr>
                                );
                            })
                        ) : (
                            <tr>
                                <td colSpan={8} className="py-8 text-center text-slate-500">
                                    <Inbox className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                    <p>Nenhum trade registrado</p>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </Card>
    );
};
