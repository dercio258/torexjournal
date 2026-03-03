import { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Activity, TrendingUp, TrendingDown } from 'lucide-react';
import api from '../../api';

interface Position {
    ticket: number;
    symbol: string;
    type: string;
    volume: number;
    open_price: number;
    current_price: number;
    profit: number;
    sl: number;
    tp: number;
    open_time: string;
}

export const OpenPositions = () => {
    const [positions, setPositions] = useState<Position[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        fetchPositions();

        const handleUpdate = (e: CustomEvent) => {
            if (e.detail && e.detail.positions) {
                setPositions(e.detail.positions);
            }
        };

        window.addEventListener('mt5_account_update', handleUpdate as EventListener);

        return () => {
            window.removeEventListener('mt5_account_update', handleUpdate as EventListener);
        };
    }, []);

    const fetchPositions = async () => {
        try {
            const res = await api.get('/account');
            if (res.data && res.data.positions) {
                setPositions(res.data.positions);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    // Debug logging removed to clean up


    if (!isLoading && positions.length === 0) {
        return (
            <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                        <Activity className="w-4 h-4 text-blue-400" /> Posições Abertas
                    </h2>
                </div>
                <div className="text-center py-8 text-slate-500">
                    <Activity className="w-12 h-12 mx-auto mb-2 opacity-30" />
                    <p>Nenhuma posição aberta no momento</p>
                </div>
            </Card>
        );
    }

    return (
        <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <Activity className="w-4 h-4 text-blue-400" /> Posições Abertas
                </h2>
                <span className="text-xs font-mono text-slate-500 bg-slate-800 px-2 py-1 rounded">
                    {positions.length} Ativa{positions.length !== 1 ? 's' : ''}
                </span>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead>
                        <tr className="border-b border-slate-700/50">
                            <th className="py-3 px-4 font-semibold text-slate-400 uppercase tracking-wider text-xs">Símbolo</th>
                            <th className="py-3 px-4 font-semibold text-slate-400 uppercase tracking-wider text-xs">Tipo</th>
                            <th className="text-right py-3 px-4 font-semibold text-slate-400 uppercase tracking-wider text-xs">Volume</th>
                            <th className="text-right py-3 px-4 font-semibold text-slate-400 uppercase tracking-wider text-xs">Entrada</th>
                            <th className="text-right py-3 px-4 font-semibold text-slate-400 uppercase tracking-wider text-xs">Atual</th>
                            <th className="text-right py-3 px-4 font-semibold text-slate-400 uppercase tracking-wider text-xs">Lucro</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/30">
                        {positions.map((pos) => {
                            const isWin = pos.profit >= 0;
                            return (
                                <tr key={pos.ticket} className="hover:bg-slate-800/30 transition-colors">
                                    <td className="py-3 px-4 font-medium text-slate-200">{pos.symbol}</td>
                                    <td className="py-3 px-4">
                                        <span className={`text-xs px-2 py-0.5 rounded-full ${pos.type === 'BUY' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'}`}>
                                            {pos.type}
                                        </span>
                                    </td>
                                    <td className="py-3 px-4 text-right text-slate-300">{Number(pos.volume).toFixed(2)}</td>
                                    <td className="py-3 px-4 text-right text-slate-300">{Number(pos.open_price).toFixed(5)}</td>
                                    <td className="py-3 px-4 text-right text-slate-300">{Number(pos.current_price).toFixed(5)}</td>
                                    <td className={`py-3 px-4 text-right font-bold ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        <div className="flex items-center justify-end gap-1">
                                            {isWin ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                                            {isWin ? '+' : ''}{Number(pos.profit).toFixed(2)}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </Card>
    );
};
