import { useEffect, useState, useCallback } from 'react';
import { History, FileText, Server, Trash2, Wallet, Filter, Cloud } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAccount } from '../../context/AccountContext';
import api from '../../api';

interface ImportLog {
    id: number;
    method: 'EA' | 'FILE' | 'AUTO_SYNC' | 'MANUAL' | 'DERIV';
    status: 'SUCCESS' | 'FAILED' | 'PARTIAL';
    details?: string;
    fileName?: string;
    errorDetails?: string;
    tradesCount: number;
    skipsCount?: number;
    createdAt: string;
    accountId?: string;
    account?: {
        id: string;
        name: string;
        broker: string;
        type: string;
        login?: string;
    };
}

export const ImportHistory = () => {
    const [logs, setLogs] = useState<ImportLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterBySelectedAccount, setFilterBySelectedAccount] = useState(false);
    const queryClient = useQueryClient();
    const { accounts, selectedAccountId, selectedAccount, refreshAccounts } = useAccount();

    const fetchHistory = useCallback(async () => {
        setLoading(true);
        try {
            const params: any = {};
            if (filterBySelectedAccount && selectedAccountId && selectedAccountId !== 'all') {
                params.accountId = selectedAccountId;
            }
            const res = await api.get('/mt5/import-history', { params });
            if (Array.isArray(res.data)) {
                setLogs(res.data);
            }
        } catch (e) {
            console.error('Error fetching import history:', e);
        } finally {
            setLoading(false);
        }
    }, [filterBySelectedAccount, selectedAccountId]);

    useEffect(() => {
        fetchHistory();
    }, [fetchHistory]);

    // Listen for custom event or storage updates when trades are imported
    useEffect(() => {
        const handleRefresh = () => {
            fetchHistory();
        };
        window.addEventListener('trade-imported', handleRefresh);
        return () => window.removeEventListener('trade-imported', handleRefresh);
    }, [fetchHistory]);

    const handleRevert = async (id: number) => {
        if (!confirm('Tem certeza que deseja reverter esta importação? Isso deletará todos os trades importados nela.')) return;

        try {
            await api.delete(`/mt5/import-history/${id}/revert`);
            alert('Importação revertida com sucesso!');
            await fetchHistory();
            await refreshAccounts();
            queryClient.invalidateQueries({ queryKey: ['dashboard'] });
            queryClient.invalidateQueries({ queryKey: ['trades'] });
        } catch (e: any) {
            alert('Erro ao reverter: ' + (e.response?.data?.message || e.message));
        }
    };

    const getIcon = (method: string) => {
        switch (method) {
            case 'AUTO_SYNC': return <Cloud size={18} className="text-emerald-500 dark:text-emerald-400" />;
            case 'EA': return <Server size={18} className="text-indigo-500 dark:text-indigo-400" />;
            case 'FILE': return <FileText size={18} className="text-emerald-500 dark:text-emerald-400" />;
            default: return <History size={18} className="text-fg-subtle dark:text-slate-400" />;
        }
    };

    const getLogSummary = (log: ImportLog): string => {
        if (log.details) return log.details;
        if (log.status === 'FAILED') {
            return log.errorDetails || 'Falha na importação / autenticação MT5';
        }
        if (log.method === 'AUTO_SYNC') {
            if (log.tradesCount > 0) {
                return `Sincronização MT5 Cloud: ${log.tradesCount} trade(s) importado(s)${log.skipsCount ? ` (${log.skipsCount} já existentes)` : ''}`;
            }
            return log.errorDetails || `Sincronização MT5 Cloud concluída (${log.skipsCount || 0} trades no histórico)`;
        }
        if (log.fileName) {
            return `Arquivo: ${log.fileName} (${log.tradesCount} importados)`;
        }
        return `Importação via ${log.method}: ${log.tradesCount} trade(s) processado(s)`;
    };

    const getAccountNameForLog = (log: ImportLog): string => {
        if (log.account?.name) return log.account.name;
        if (log.accountId) {
            const match = accounts.find(a => a.id === log.accountId);
            if (match) return match.name;
        }
        return 'Conta Trading';
    };

    const getAccountBrokerForLog = (log: ImportLog): string => {
        if (log.account?.broker) return log.account.broker;
        if (log.accountId) {
            const match = accounts.find(a => a.id === log.accountId);
            if (match) return match.broker;
        }
        return '';
    };

    return (
        <div className="bg-surface backdrop-blur-xl border border-line rounded-3xl p-6 shadow-sm dark:shadow-lg transition-colors">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                    <h3 className="text-lg font-bold text-fg flex items-center gap-2">
                        <History className="text-indigo-500" /> Histórico de Importação
                    </h3>
                    <p className="text-xs text-fg-subtle dark:text-[#9CA3AF] mt-1">
                        Visualize as operações importadas vinculadas a cada conta trader.
                    </p>
                </div>

                {selectedAccountId && selectedAccountId !== 'all' && (
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setFilterBySelectedAccount(!filterBySelectedAccount)}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
 filterBySelectedAccount
 ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 shadow-sm'
 : 'bg-surface-2 border-line text-fg-muted hover:bg-slate-200 dark:hover:bg-[#1C1F2C]'
 }`}
                        >
                            <Filter size={13} />
                            {filterBySelectedAccount
                                ? `Filtrando: ${selectedAccount?.name || 'Conta Atual'}`
                                : 'Ver apenas conta selecionada'}
                        </button>
                    </div>
                )}
            </div>

            {loading ? (
                <div className="text-center text-fg-muted py-8">Carregando histórico...</div>
            ) : logs.length === 0 ? (
                <div className="text-center text-fg-subtle dark:text-[#9CA3AF] py-8 border border-dashed border-line rounded-2xl bg-slate-50/50 dark:bg-[#08090C]/40">
                    <p className="font-medium">Nenhuma importação registrada {filterBySelectedAccount ? 'para esta conta trade' : ''}.</p>
                    <p className="text-xs text-fg-muted mt-1">Importe arquivos CSV, HTML ou sincronize via EA para registrar operações.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {logs.map(log => {
                        const accName = getAccountNameForLog(log);
                        const accBroker = getAccountBrokerForLog(log);

                        return (
                            <div
                                key={log.id}
                                className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-slate-50/80 dark:bg-[#0C0D12]/70 border border-line rounded-2xl hover:bg-slate-100/80 dark:hover:bg-[#161822]/40 transition-colors"
                            >
                                <div className="flex items-start sm:items-center gap-3.5">
                                    <div className="p-2.5 bg-surface rounded-xl border border-line shrink-0 shadow-sm">
                                        {getIcon(log.method)}
                                    </div>

                                    <div className="space-y-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${
                                                log.status === 'SUCCESS'
                                                    ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50'
                                                    : 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800/50'
                                            }`}>
                                                {log.status === 'SUCCESS' ? 'Concluída' : 'Falha'}
                                            </span>

                                            {/* Conta Trade Badge */}
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/50">
                                                <Wallet size={12} className="text-indigo-500" />
                                                <span>{accName}</span>
                                                {accBroker && <span className="text-indigo-400 dark:text-indigo-400 font-mono text-[10px]">({accBroker})</span>}
                                            </span>

                                            <span className="text-[11px] text-fg-muted dark:text-[#6B7280]">
                                                • {new Date(log.createdAt).toLocaleString()}
                                            </span>
                                        </div>

                                        <p className="text-xs sm:text-sm text-fg-muted ">
                                            {getLogSummary(log)}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 border-line ">
                                    <div className="text-left sm:text-right">
                                        <span className="block text-xl font-bold text-fg leading-tight">
                                            {log.tradesCount}
                                        </span>
                                        <span className="text-[10px] text-fg-subtle font-bold uppercase tracking-wider">
                                            Trades
                                        </span>
                                    </div>

                                    <button
                                        onClick={() => handleRevert(log.id)}
                                        className="flex items-center gap-1 text-[11px] text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 font-semibold transition-colors mt-1.5"
                                        title="Reverter Importação"
                                    >
                                        <Trash2 size={13} />
                                        Reverter
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
