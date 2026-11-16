import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    AlertCircle,
    CheckCircle2,
    ExternalLink,
    Eye,
    EyeOff,
    RefreshCw,
    ShieldCheck,
} from 'lucide-react';
import api from '../../api';
import { useAccount } from '../../context/AccountContext';
import { useLocale } from '../../context/LocaleContext';
import { Button } from '../../components/ui/Button';
import { pullAccountHistoryInBatchesAndBuildUnifiedSession } from '../../services/historicalBatchCache';
import { DerivIcon } from './icons';

interface DerivStatus {
    isConnected: boolean;
    isStreaming: boolean;
    accountId: string | null;
    currency: string | null;
    balance: number;
    equity: number;
    accountName: string | null;
    lastSyncAt: string | null;
}

export const DerivSyncPage = () => {
    const { selectedAccountId, refreshAccounts } = useAccount();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const [derivStatus, setDerivStatus] = useState<DerivStatus | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isConnecting, setIsConnecting] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [confirmDisconnect, setConfirmDisconnect] = useState(false);
    const [tokenInput, setTokenInput] = useState('');
    const [showToken, setShowToken] = useState(false);
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const fetchDerivStatus = async () => {
        setIsLoading(true);
        try {
            const res = await api.get('/integrations/deriv/status');
            setDerivStatus(res.data);
        } catch (err) {
            console.error('Failed to fetch Deriv status', err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchDerivStatus();
    }, []);

    const handleConnect = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!tokenInput.trim()) {
            setFeedback({
                type: 'error',
                text: isEn ? 'Enter your Deriv API token to continue.' : 'Informe a chave de acesso para continuar.',
            });
            return;
        }

        setIsConnecting(true);
        setFeedback(null);

        try {
            const res = await api.post('/integrations/deriv/connect', { token: tokenInput.trim() });
            setFeedback({
                type: 'success',
                text: isEn
                    ? `Account ${res.data.account} linked successfully!`
                    : `Conta ${res.data.account} vinculada com sucesso!`,
            });
            setTokenInput('');
            await fetchDerivStatus();
            await refreshAccounts();
        } catch (err: any) {
            setFeedback({
                type: 'error',
                text:
                    err.response?.data?.message ||
                    (isEn
                        ? 'Invalid or expired API token. Please check the token scopes and try again.'
                        : 'Chave inválida ou expirada. Confira o código e tente novamente.'),
            });
        } finally {
            setIsConnecting(false);
        }
    };

    const handleSync = async () => {
        setIsSyncing(true);
        setFeedback(null);
        try {
            await api.post('/integrations/deriv/sync');
            void pullAccountHistoryInBatchesAndBuildUnifiedSession({
                accountId: selectedAccountId && selectedAccountId !== 'all' ? selectedAccountId : undefined,
                accountName: derivStatus?.accountName || 'Deriv',
                syncSourceLabel: 'Deriv Sync',
                isDeriv: true,
                triggerLiveBrokerSync: false,
            }).catch(() => {});
            setFeedback({
                type: 'success',
                text: isEn
                    ? 'Sync triggered. New executions will appear in your ledger momentarily.'
                    : 'Histórico em atualização. Novos registros aparecerão em instantes.',
            });
            await fetchDerivStatus();
            await refreshAccounts();
        } catch (err: any) {
            setFeedback({
                type: 'error',
                text:
                    err.response?.data?.message ||
                    (isEn
                        ? 'Sync failed right now. Please retry in a few seconds.'
                        : 'Falha ao atualizar agora. Tente em alguns segundos.'),
            });
        } finally {
            setIsSyncing(false);
        }
    };

    const handleDisconnect = async () => {
        setIsLoading(true);
        setFeedback(null);
        try {
            await api.delete('/integrations/deriv/disconnect');
            setConfirmDisconnect(false);
            setFeedback({
                type: 'success',
                text: isEn ? 'Broker link disconnected.' : 'Vínculo removido.',
            });
            await fetchDerivStatus();
            await refreshAccounts();
        } catch (err: any) {
            setFeedback({
                type: 'error',
                text:
                    err.response?.data?.message ||
                    (isEn
                        ? 'Unable to disconnect right now.'
                        : 'Não foi possível desconectar no momento.'),
            });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="rounded-2xl border border-line bg-surface p-5 sm:p-8 space-y-6 animate-fade-in-up">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-line">
                <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-surface-2 border border-line-strong flex items-center justify-center shrink-0 p-2">
                        <DerivIcon className="w-full h-full" />
                    </div>
                    <div>
                        <h2 className="text-lg sm:text-xl font-bold text-fg">Deriv</h2>
                        <p className="text-xs sm:text-sm text-fg-muted">
                            {isEn ? 'Read-only automated account sync' : 'Leitura automática da sua conta'}
                        </p>
                    </div>
                </div>

                <div className="self-start sm:self-auto">
                    {derivStatus?.isConnected ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-accent/10 border border-accent/25 text-accent-fg font-semibold text-xs rounded-full">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            {isEn ? 'Connected' : 'Ativa'}
                        </span>
                    ) : (
                        <span className="text-xs font-medium px-3 py-1 bg-surface-2 border border-line text-fg-muted rounded-full">
                            {isLoading ? (isEn ? 'Checking...' : 'Verificando...') : (isEn ? 'Disconnected' : 'Desconectada')}
                        </span>
                    )}
                </div>
            </div>

            {/* Feedback */}
            {feedback && (
                <div
                    role="alert"
                    className={`p-4 rounded-xl flex items-start gap-3 text-xs sm:text-sm border ${
                        feedback.type === 'success'
                            ? 'bg-accent/10 border-accent/25 text-fg'
                            : 'bg-danger/10 border-danger/25 text-fg'
                    }`}
                >
                    {feedback.type === 'success' ? (
                        <CheckCircle2 size={18} className="shrink-0 mt-0.5 text-accent-fg" />
                    ) : (
                        <AlertCircle size={18} className="shrink-0 mt-0.5 text-danger-fg" />
                    )}
                    <p className="flex-1 leading-relaxed">{feedback.text}</p>
                </div>
            )}

            {derivStatus?.isConnected ? (
                <div className="space-y-6">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="bg-canvas-subtle border border-line rounded-xl p-3.5">
                            <span className="text-[11px] text-fg-subtle font-medium block">
                                {isEn ? 'Account ID' : 'Conta'}
                            </span>
                            <span className="text-sm font-bold text-fg font-mono mt-1 block truncate">
                                {derivStatus.accountId || '—'}
                            </span>
                        </div>

                        <div className="bg-canvas-subtle border border-line rounded-xl p-3.5">
                            <span className="text-[11px] text-fg-subtle font-medium block">
                                {isEn ? 'Balance' : 'Saldo'}
                            </span>
                            <span className="text-sm font-bold text-accent-fg tabular-nums mt-1 block truncate">
                                {new Intl.NumberFormat('en-US', {
                                    style: 'currency',
                                    currency: derivStatus.currency || 'USD',
                                }).format(derivStatus.balance || 0)}
                            </span>
                        </div>

                        <div className="bg-canvas-subtle border border-line rounded-xl p-3.5">
                            <span className="text-[11px] text-fg-subtle font-medium block">
                                {isEn ? 'Currency' : 'Moeda'}
                            </span>
                            <span className="text-sm font-bold text-fg mt-1 block">
                                {derivStatus.currency || 'USD'}
                            </span>
                        </div>

                        <div className="bg-canvas-subtle border border-line rounded-xl p-3.5">
                            <span className="text-[11px] text-fg-subtle font-medium block">
                                {isEn ? 'Last Sync' : 'Última leitura'}
                            </span>
                            <span className="text-sm font-semibold text-fg mt-1 block truncate">
                                {derivStatus.lastSyncAt
                                    ? new Date(derivStatus.lastSyncAt).toLocaleTimeString([], {
                                          hour: '2-digit',
                                          minute: '2-digit',
                                      })
                                    : (isEn ? 'Just now' : 'Agora')}
                            </span>
                        </div>
                    </div>

                    <Button
                        variant="brand"
                        size="lg"
                        fullWidth
                        onClick={handleSync}
                        isLoading={isSyncing}
                        icon={<RefreshCw size={16} />}
                    >
                        {isSyncing ? (isEn ? 'Syncing...' : 'Sincronizando...') : (isEn ? 'Sync Now' : 'Sincronizar agora')}
                    </Button>

                    <div className="pt-4 border-t border-line flex flex-wrap items-center justify-between gap-3">
                        <Link
                            to="/trades"
                            className="text-xs font-semibold text-accent-fg hover:underline"
                        >
                            {isEn ? 'Open Execution Ledger →' : 'Ver operações →'}
                        </Link>

                        {!confirmDisconnect ? (
                            <button
                                type="button"
                                onClick={() => setConfirmDisconnect(true)}
                                disabled={isLoading}
                                className="text-xs text-danger-fg hover:underline font-medium"
                            >
                                {isEn ? 'Disconnect' : 'Desconectar'}
                            </button>
                        ) : (
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="danger"
                                    size="sm"
                                    onClick={handleDisconnect}
                                    isLoading={isLoading}
                                >
                                    {isEn ? 'Confirm' : 'Confirmar'}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setConfirmDisconnect(false)}
                                >
                                    {isEn ? 'Cancel' : 'Cancelar'}
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <div className="space-y-6">
                    <ol className="bg-canvas-subtle border border-line rounded-xl p-4 sm:p-5 text-xs sm:text-sm text-fg-muted space-y-2 list-decimal list-inside leading-relaxed">
                        <li>
                            {isEn ? 'Open the ' : 'Abra o '}
                            <a
                                href="https://app.deriv.com/account/api-token"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-accent-fg hover:underline font-semibold inline-flex items-center gap-1"
                            >
                                {isEn ? 'Deriv API Token Settings' : 'painel de chaves da Deriv'} <ExternalLink size={12} />
                            </a>
                        </li>
                        <li>
                            {isEn ? (
                                <>
                                    Enable <strong className="text-fg font-semibold">Read</strong> and{' '}
                                    <strong className="text-fg font-semibold">Trade</strong> scopes.
                                </>
                            ) : (
                                <>
                                    Marque <strong className="text-fg font-semibold">Read</strong> e{' '}
                                    <strong className="text-fg font-semibold">Trade</strong>.
                                </>
                            )}
                        </li>
                        <li>
                            {isEn
                                ? 'Name your token, generate it, and paste it below.'
                                : 'Crie um nome, gere o código e cole no campo abaixo.'}
                        </li>
                    </ol>

                    <form onSubmit={handleConnect} className="space-y-4">
                        <div className="space-y-1.5">
                            <label
                                htmlFor="deriv-access-key"
                                className="block text-xs font-semibold uppercase tracking-wider text-fg-muted"
                            >
                                {isEn ? 'API Token' : 'Chave de acesso'}
                            </label>
                            <div className="relative">
                                <input
                                    id="deriv-access-key"
                                    type={showToken ? 'text' : 'password'}
                                    placeholder={isEn ? 'Paste your API token here' : 'Cole o código aqui'}
                                    value={tokenInput}
                                    onChange={(e) => setTokenInput(e.target.value)}
                                    disabled={isConnecting}
                                    className="w-full bg-canvas border border-line hover:border-line-strong focus:border-accent/60 rounded-xl px-4 py-3.5 pr-11 text-sm text-fg focus:outline-none transition-colors font-mono placeholder:font-sans placeholder:text-fg-subtle"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowToken(!showToken)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg transition-colors p-1"
                                    aria-label={showToken ? (isEn ? 'Hide' : 'Ocultar') : (isEn ? 'Show' : 'Mostrar')}
                                >
                                    {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                            <p className="text-xs text-fg-subtle flex items-center gap-1.5 pt-0.5">
                                <ShieldCheck size={14} className="text-accent-fg shrink-0" />
                                {isEn
                                    ? 'Read-only access used solely to sync your execution history.'
                                    : 'Usado apenas para ler seu histórico.'}
                            </p>
                        </div>

                        <Button
                            type="submit"
                            variant="brand"
                            size="lg"
                            fullWidth
                            disabled={!tokenInput.trim()}
                            isLoading={isConnecting}
                        >
                            {isConnecting ? (isEn ? 'Connecting...' : 'Conectando...') : (isEn ? 'Connect Account' : 'Conectar')}
                        </Button>
                    </form>
                </div>
            )}
        </div>
    );
};
