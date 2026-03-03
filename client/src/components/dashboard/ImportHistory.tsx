import { useEffect, useState } from 'react';
import { History, FileText, Server, Trash2 } from 'lucide-react';
import api from '../../api';

interface ImportLog {
    id: number;
    method: 'EA' | 'FILE' | 'AUTO_SYNC';
    status: 'SUCCESS' | 'FAILED' | 'PARTIAL';
    details: string;
    tradesCount: number;
    createdAt: string;
}

export const ImportHistory = () => {
    const [logs, setLogs] = useState<ImportLog[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchHistory();
    }, []);

    const fetchHistory = async () => {
        try {
            const res = await api.get('/mt5/import-history');
            if (Array.isArray(res.data)) {
                setLogs(res.data);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleRevert = async (id: number) => {
        if (!confirm('Tem certeza que deseja reverter esta importação? Isso deletará todos os trades importados nela.')) return;

        try {
            await api.delete(`/mt5/import-history/${id}/revert`);
            alert('Importação revertida com sucesso!');
            fetchHistory();
        } catch (e: any) {
            alert('Erro ao reverter: ' + (e.response?.data?.message || e.message));
        }
    };

    const getIcon = (method: string) => {
        switch (method) {
            case 'EA': return <Server size={18} className="text-indigo-400" />;
            case 'FILE': return <FileText size={18} className="text-emerald-400" />;
            default: return <History size={18} className="text-slate-400" />;
        }
    };

    return (
        <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 shadow-lg">
            <h3 className="text-lg font-bold text-slate-200 mb-6 flex items-center gap-2">
                <History className="text-indigo-500" /> Histórico de Importação
            </h3>

            {loading ? (
                <div className="text-center text-slate-500 py-6">Carregando histórico...</div>
            ) : logs.length === 0 ? (
                <div className="text-center text-slate-500 py-6 border border-dashed border-slate-800 rounded-xl">
                    Nenhuma importação registrada.
                </div>
            ) : (
                <div className="space-y-4">
                    {logs.map(log => (
                        <div key={log.id} className="flex items-center justify-between p-4 bg-slate-950/30 border border-slate-800/50 rounded-xl hover:bg-slate-900/50 transition-colors">
                            <div className="flex items-center gap-4">
                                <div className="p-2 bg-slate-900 rounded-lg border border-slate-800">
                                    {getIcon(log.method)}
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className={`text-sm font-bold ${log.status === 'SUCCESS' ? 'text-emerald-400' : 'text-red-400'}`}>
                                            {log.status === 'SUCCESS' ? 'Importação Concluída' : 'Falha na Importação'}
                                        </span>
                                        <span className="text-xs text-slate-500">• {new Date(log.createdAt).toLocaleString()}</span>
                                    </div>
                                    <p className="text-sm text-slate-300">{log.details}</p>
                                </div>
                            </div>
                            <div className="text-right flex flex-col items-end gap-2">
                                <div>
                                    <span className="block text-2xl font-bold text-slate-200">{log.tradesCount}</span>
                                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Trades</span>
                                </div>
                                <button
                                    onClick={() => handleRevert(log.id)}
                                    className="flex items-center gap-1 text-[10px] text-rose-400 hover:text-rose-300 font-bold uppercase transition-colors"
                                    title="Reverter Importação"
                                >
                                    <Trash2 size={12} />
                                    Reverter
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
