import { useCallback, useEffect, useState } from 'react';
import {
    AlertCircle,
    CheckCircle2,
    FileText,
    Filter,
    History,
    Monitor,
    Trash2,
    Wallet,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAccount } from '../../context/AccountContext';
import { useLocale } from '../../context/LocaleContext';
import { Button } from '../ui/Button';
import { DerivIcon, Mt5Icon } from '../../pages/add-trades/icons';
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

const getMethodLabel = (isEn: boolean): Record<string, string> => ({
    AUTO_SYNC: 'MetaTrader 5',
    DERIV: 'Deriv',
    EA: isEn ? 'PC Connector' : 'Computador',
    FILE: isEn ? 'File Upload' : 'Arquivo',
    MANUAL: 'Manual',
});

function cleanSummaryText(raw: string, isEn = false): string {
    return raw
        .replace(/MT5 Cloud/gi, 'MetaTrader 5')
        .replace(/via AUTO_SYNC/gi, isEn ? 'auto-sync' : 'automática')
        .replace(/via EA/gi, isEn ? 'via desktop EA' : 'pelo computador')
        .replace(/via FILE/gi, isEn ? 'via file upload' : 'por arquivo')
        .replace(/trade\(s\)/gi, isEn ? 'executions' : 'registros')
        .trim();
}

export const ImportHistory = () => {
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const METHOD_LABEL = getMethodLabel(isEn);
    const [logs, setLogs] = useState<ImportLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterBySelectedAccount, setFilterBySelectedAccount] = useState(false);
    const [confirmRevertId, setConfirmRevertId] = useState<number | null>(null);
    const [revertingId, setRevertingId] = useState<number | null>(null);
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const queryClient = useQueryClient();
    const { accounts, selectedAccountId, selectedAccount, refreshAccounts } = useAccount();

    const fetchHistory = useCallback(async () => {
        setLoading(true);
        try {
            const params: Record<string, string> = {};
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

    useEffect(() => {
        const handleRefresh = () => {
            fetchHistory();
        };
        window.addEventListener('trade-imported', handleRefresh);
        return () => window.removeEventListener('trade-imported', handleRefresh);
    }, [fetchHistory]);

    const handleRevert = async (id: number) => {
        setRevertingId(id);
        setFeedback(null);
        try {
            await api.delete(`/mt5/import-history/${id}/revert`);
            setConfirmRevertId(null);
            setFeedback({
                type: 'success',
                text: isEn ? 'Import reverted cleanly.' : 'Envio desfeito.',
            });
            await fetchHistory();
            await refreshAccounts();
            queryClient.invalidateQueries({ queryKey: ['dashboard'] });
            queryClient.invalidateQueries({ queryKey: ['trades'] });
        } catch (e: any) {
            setFeedback({
                type: 'error',
                text:
                    e.response?.data?.message ||
                    (isEn ? 'Unable to revert this import.' : 'Não foi possível desfazer.'),
            });
        } finally {
            setRevertingId(null);
        }
    };

    const getIcon = (method: string) => {
        switch (method) {
            case 'AUTO_SYNC':
                return <Mt5Icon className="w-4 h-4" />;
            case 'DERIV':
                return <DerivIcon className="w-4 h-4" />;
            case 'EA':
                return <Monitor size={16} className="text-fg" />;
            case 'FILE':
                return <FileText size={16} className="text-accent-fg" />;
            default:
                return <History size={16} className="text-fg-muted" />;
        }
    };

    const getLogSummary = (log: ImportLog): string => {
        if (log.details) return cleanSummaryText(log.details, isEn);
        if (log.status === 'FAILED') {
            return cleanSummaryText(log.errorDetails || (isEn ? 'Import parsing failed.' : 'Falha na leitura.'), isEn);
        }
        if (log.fileName) {
            return log.fileName;
        }
        return METHOD_LABEL[log.method] || (isEn ? 'Sync' : 'Sincronização');
    };

    const getAccountNameForLog = (log: ImportLog): string => {
        if (log.account?.name) return log.account.name;
        if (log.accountId) {
            const match = accounts.find((a) => a.id === log.accountId);
            if (match) return match.name;
        }
        return isEn ? 'Account' : 'Conta';
    };

    return (
        <div className="rounded-2xl border border-line bg-surface p-5 sm:p-8 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-line">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-surface-2 border border-line-strong flex items-center justify-center text-accent-fg shrink-0">
                        <History size={18} />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-fg">
                            {isEn ? 'Import & Sync Log' : 'Histórico'}
                        </h2>
                        <p className="text-xs text-fg-muted">
                            {isEn ? 'Recent broker syncs and file uploads' : 'Envios e leituras realizadas'}
                        </p>
                    </div>
                </div>

                {selectedAccountId && selectedAccountId !== 'all' && (
                    <button
                        type="button"
                        onClick={() => setFilterBySelectedAccount(!filterBySelectedAccount)}
                        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors self-start sm:self-auto ${
                            filterBySelectedAccount
                                ? 'bg-accent/15 border-accent/35 text-accent-fg'
                                : 'bg-canvas border-line text-fg-muted hover:text-fg'
                        }`}
                    >
                        <Filter size={13} />
                        {filterBySelectedAccount
                            ? selectedAccount?.name || (isEn ? 'Current account' : 'Conta atual')
                            : (isEn ? 'Current account only' : 'Apenas conta atual')}
                    </button>
                )}
            </div>

            {feedback && (
                <div
                    role="alert"
                    className={`p-3.5 rounded-xl border flex items-center gap-2.5 text-xs sm:text-sm ${
                        feedback.type === 'success'
                            ? 'bg-accent/10 border-accent/25 text-fg'
                            : 'bg-danger/10 border-danger/25 text-fg'
                    }`}
                >
                    {feedback.type === 'success' ? (
                        <CheckCircle2 size={16} className="text-accent-fg shrink-0" />
                    ) : (
                        <AlertCircle size={16} className="text-danger-fg shrink-0" />
                    )}
                    <span>{feedback.text}</span>
                </div>
            )}

            {loading ? (
                <div className="text-center text-fg-muted text-sm py-10">
                    {isEn ? 'Loading log...' : 'Carregando...'}
                </div>
            ) : logs.length === 0 ? (
                <div className="text-center py-10 px-4 border border-dashed border-line rounded-xl bg-canvas-subtle">
                    <p className="text-sm font-medium text-fg">
                        {isEn ? 'No import activity recorded yet.' : 'Nenhum registro até o momento.'}
                    </p>
                </div>
            ) : (
                <div className="space-y-2.5">
                    {logs.map((log) => {
                        const accName = getAccountNameForLog(log);
                        const isConfirming = confirmRevertId === log.id;

                        return (
                            <div
                                key={log.id}
                                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 p-4 bg-canvas-subtle border border-line rounded-xl hover:border-line-strong transition-colors"
                            >
                                <div className="flex items-start gap-3 min-w-0">
                                    <div className="w-9 h-9 bg-surface rounded-xl border border-line flex items-center justify-center shrink-0">
                                        {getIcon(log.method)}
                                    </div>

                                    <div className="min-w-0 space-y-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span
                                                className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border ${
                                                    log.status === 'SUCCESS'
                                                        ? 'bg-accent/10 text-accent-fg border-accent/25'
                                                        : 'bg-danger/10 text-danger-fg border-danger/25'
                                                }`}
                                            >
                                                {log.status === 'SUCCESS'
                                                    ? (isEn ? 'Completed' : 'Concluído')
                                                    : (isEn ? 'Failed' : 'Falhou')}
                                            </span>

                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-surface-2 text-fg border border-line">
                                                <Wallet size={11} className="text-fg-subtle" />
                                                <span className="truncate max-w-[140px]">{accName}</span>
                                            </span>

                                            <span className="text-[11px] text-fg-subtle tabular-nums">
                                                {new Date(log.createdAt).toLocaleString(isEn ? 'en-US' : 'pt-BR')}
                                            </span>
                                        </div>

                                        <p className="text-xs sm:text-sm text-fg-muted leading-relaxed truncate">
                                            {getLogSummary(log)}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 shrink-0 border-t sm:border-t-0 pt-2.5 sm:pt-0 border-line">
                                    <span className="text-sm font-bold text-fg tabular-nums">
                                        {log.tradesCount} {log.tradesCount === 1 ? 'trade' : 'trades'}
                                    </span>

                                    {log.tradesCount > 0 && !isConfirming && (
                                        <button
                                            type="button"
                                            onClick={() => setConfirmRevertId(log.id)}
                                            className="inline-flex items-center gap-1 text-xs text-danger-fg hover:underline font-medium"
                                        >
                                            <Trash2 size={12} />
                                            {isEn ? 'Revert' : 'Desfazer'}
                                        </button>
                                    )}

                                    {isConfirming && (
                                        <div className="flex items-center gap-1.5">
                                            <Button
                                                variant="danger"
                                                size="sm"
                                                onClick={() => handleRevert(log.id)}
                                                isLoading={revertingId === log.id}
                                            >
                                                {isEn ? 'Remove' : 'Remover'}
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => setConfirmRevertId(null)}
                                            >
                                                {isEn ? 'Cancel' : 'Cancelar'}
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
