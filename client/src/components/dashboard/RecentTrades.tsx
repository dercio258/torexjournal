import { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Clock, TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../../api';
import { Trade } from '../../types';

export const RecentTrades = () => {
    const [trades, setTrades] = useState<Trade[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchTrades();

        const handleUpdate = () => {
            // Simple re-fetch strategy to ensure consistency
            fetchTrades();
        };

        window.addEventListener('mt5_history_update', handleUpdate);
        return () => window.removeEventListener('mt5_history_update', handleUpdate);
    }, []);

    const fetchTrades = async () => {
        try {
            const res = await api.get('/dashboard/trades/recent?limit=5');
            setTrades(res.data);
        } catch (err) {
            console.error(err);
            setError('Falha ao carregar trades');
        } finally {
            setIsLoading(false);
        }
    };

    if (error) {
        return (
            <Card className="p-6" style={{ display: 'none' }}> {/* Hide on error as per requirement or show error? Original hides if empty. */}
                {/* Original code hid the section if empty, but showed error message in container if error. */}
                <div className="text-center py-8 text-slate-500">
                    <AlertCircle className="w-12 h-12 mx-auto mb-2 opacity-50 text-rose-400" />
                    <p>Erro ao carregar trades</p>
                </div>
            </Card>
        );
    }

    if (!isLoading && trades.length === 0) return null; // Hide if no trades

    return (
        <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <Clock className="w-4 h-4 text-emerald-400" /> Trades Recentes
                </h2>
                <Link to="/journal" className="text-sm text-emerald-400 hover:text-emerald-300 font-medium">Ver todos →</Link>
            </div>

            <div className="space-y-3">
                {isLoading ? (
                    <div className="text-center py-8 text-slate-500">
                        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400"></div>
                        <p className="mt-2">Carregando trades...</p>
                    </div>
                ) : (
                    trades.map((trade: Trade) => {
                        const isWin = trade.profit >= 0;
                        const date = new Date(trade.close_time || (trade.sell_time ? trade.sell_time * 1000 : Date.now()));

                        return (
                            <div key={trade.ticket} className="bg-slate-800/40 p-4 rounded-lg border border-slate-800/50 hover:border-emerald-500/30 transition-all">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-10 h-10 rounded-lg ${isWin ? 'bg-emerald-500/10' : 'bg-rose-500/10'} flex items-center justify-center`}>
                                            {isWin ? <TrendingUp className="w-5 h-5 text-emerald-400" /> : <TrendingDown className="w-5 h-5 text-rose-400" />}
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="font-bold text-sm text-slate-200">{trade.symbol || trade.shortcode?.split('_')[0]}</span>
                                                <span className={`text-xs px-2 py-0.5 rounded-full ${trade.contract_type === 'BUY' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'}`}>
                                                    {trade.type || trade.contract_type}
                                                </span>
                                            </div>
                                            <div className="text-xs text-slate-500 mt-0.5">
                                                {date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className={`font-bold text-sm ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {isWin ? '+' : ''}${Math.abs(trade.profit).toFixed(2)}
                                        </div>
                                        <div className="text-xs text-slate-500">Vol: {Number(trade.volume).toFixed(2)}</div>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </Card>
    );
};
