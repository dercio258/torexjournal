import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
    Activity,
    AlertTriangle,
    Building2,
    CheckCircle2,
    ChevronDown,
    Eye,
    EyeOff,
    KeyRound,
    LogOut,
    Plus,
    Power,
    RefreshCw,
    Server,
    ShieldCheck,
    TrendingDown,
    TrendingUp,
    X,
} from 'lucide-react';
import api from '../../api';
import { useAccount } from '../../context/AccountContext';
import { useLocale } from '../../context/LocaleContext';
import { MT5_BROKERS_CATALOG } from '../../constants/mt5ServersCatalog';
import { BrokerLogo } from '../../components/ui/BrokerLogo';
import { Button } from '../../components/ui/Button';
import { pullAccountHistoryInBatchesAndBuildUnifiedSession } from '../../services/historicalBatchCache';
import { formatTradeDateTime } from '../../utils/timezone';
import { Mt5ServerModal } from './Mt5ServerModal';
import { Mt5Icon } from './icons';

function cleanBackendMessage(raw?: string | null, isEn = false): string {
    if (!raw) return '';
    return raw
        .replace(/MT5 Cloud/gi, 'MetaTrader 5')
        .replace(/worker/gi, isEn ? 'service' : 'serviço')
        .replace(/null null/gi, '')
        .trim();
}

export const Mt5SyncPage = () => {
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const [searchParams] = useSearchParams();
    const initialServerParam = searchParams.get('server') || '';
    const initialBrokerParam = searchParams.get('broker') || '';
    const initialBrokerIdParam = searchParams.get('brokerId') || 'ALL';

    const { accounts, selectedAccountId, refreshAccounts, selectAccount } = useAccount();
    const validSelectedAccountId =
        selectedAccountId && selectedAccountId !== 'all' ? selectedAccountId : undefined;

    const [login, setLogin] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [server, setServer] = useState(initialServerParam);
    const [selectedBrokerLabel, setSelectedBrokerLabel] = useState(initialBrokerParam);
    const [isServerModalOpen, setIsServerModalOpen] = useState(false);
    const [showFormOverride, setShowFormOverride] = useState(Boolean(initialServerParam));

    const [isLoading, setIsLoading] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [confirmDisconnect, setConfirmDisconnect] = useState(false);
    const [status, setStatus] = useState<{
        type: 'success' | 'error' | 'info';
        message: string;
    } | null>(null);
    const [cloudState, setCloudState] = useState<any>(null);
    const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

    const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const hasPrefilledRef = useRef<boolean>(Boolean(initialServerParam));

    useEffect(() => {
        if (initialServerParam) {
            setServer(initialServerParam);
            setShowFormOverride(true);
            hasPrefilledRef.current = true;
        }
        if (initialBrokerParam) {
            setSelectedBrokerLabel(initialBrokerParam);
        }
    }, [initialServerParam, initialBrokerParam]);

    const matchedBroker = useMemo(() => {
        const clean = server.trim().toLowerCase();
        if (!clean) return null;
        for (const group of MT5_BROKERS_CATALOG) {
            const found = group.servers.find((s) => s.name.toLowerCase() === clean);
            if (found) {
                return { group, broker: group.broker, server: found };
            }
        }
        return null;
    }, [server]);

    const fetchCloudStatus = async (overrideLogin?: string) => {
        try {
            const params: Record<string, string> = {};
            if (overrideLogin && overrideLogin.trim()) {
                params.login = overrideLogin.trim();
            } else if (validSelectedAccountId) {
                params.accountId = validSelectedAccountId;
            }
            const res = await api.get('/mt5/cloud/status', { params });
            setCloudState(res.data);

            if (!hasPrefilledRef.current) {
                if (res.data?.account?.mt5Id && !login) {
                    setLogin(res.data.account.mt5Id);
                }
                if (res.data?.account?.server && !server) {
                    setServer(res.data.account.server);
                }
                if (res.data?.account?.mt5Id || res.data?.account?.server) {
                    hasPrefilledRef.current = true;
                }
            }
        } catch {
            // Ignore initial status check errors
        }
    };

    useEffect(() => {
        if (validSelectedAccountId && !initialServerParam) {
            const selAcc = accounts.find((a) => a.id === validSelectedAccountId);
            if (selAcc?.mt5Id) {
                setLogin(selAcc.mt5Id);
                if (selAcc.broker) setServer(selAcc.broker);
            }
        }
        fetchCloudStatus();
        const interval = setInterval(() => {
            fetchCloudStatus();
        }, 5000);
        return () => {
            clearInterval(interval);
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        };
    }, [selectedAccountId]);

    const startTaskPolling = (taskId: string, targetLogin: string) => {
        setActiveTaskId(taskId);
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);

        pollTimerRef.current = setInterval(async () => {
            try {
                const res = await api.get(`/mt5/cloud/task/${taskId}`);
                const task = res.data?.task;
                setCloudState((prev: any) => ({
                    ...(prev || {}),
                    account: res.data?.account || prev?.account,
                    worker: res.data?.worker || prev?.worker,
                    recentTrades: res.data?.recentTrades ?? prev?.recentTrades ?? [],
                    totalTradesCount: res.data?.totalTradesCount ?? prev?.totalTradesCount ?? 0,
                    activeTask: task,
                }));

                if (!task) return;

                if (task.status === 'IN_PROGRESS' || task.status === 'RECEIVED') {
                    setStatus({
                        type: 'info',
                        message:
                            cleanBackendMessage(task.message, isEn) ||
                            (isEn ? `Validating terminal login #${targetLogin}...` : `Validando acesso #${targetLogin}...`),
                    });
                } else if (task.status === 'SUCCESS') {
                    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
                    pollTimerRef.current = null;
                    setActiveTaskId(null);
                    setIsLoading(false);
                    setIsSyncing(false);
                    setShowFormOverride(false);
                    setPassword('');
                    setStatus({
                        type: 'success',
                        message:
                            cleanBackendMessage(task.message, isEn) ||
                            (isEn ? 'Account connected & synced successfully!' : 'Conta vinculada com sucesso!'),
                    });
                    await fetchCloudStatus(targetLogin);
                    if (refreshAccounts) await refreshAccounts();
                    if (res.data?.account?.id && selectAccount) {
                        selectAccount(res.data.account.id);
                    }
                    void pullAccountHistoryInBatchesAndBuildUnifiedSession({
                        accountId: res.data?.account?.id || validSelectedAccountId,
                        accountName: res.data?.account?.name || `MT5 #${targetLogin}`,
                        syncSourceLabel: `MT5 Sync (#${targetLogin})`,
                        triggerLiveBrokerSync: false,
                    }).catch(() => {});
                    window.dispatchEvent(new Event('trade-imported'));
                } else if (task.status === 'FAILED') {
                    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
                    pollTimerRef.current = null;
                    setActiveTaskId(null);
                    setIsLoading(false);
                    setIsSyncing(false);
                    setStatus({
                        type: 'error',
                        message:
                            cleanBackendMessage(task.errorMessage || task.message, isEn) ||
                            (isEn
                                ? 'Authentication failed. Check your login, investor password, and server name.'
                                : 'Dados incorretos. Confira login, senha e servidor.'),
                    });
                    await fetchCloudStatus(targetLogin);
                    window.dispatchEvent(new Event('trade-imported'));
                }
            } catch {
                // Keep polling on transient network hiccup
            }
        }, 1500);
    };

    const handleConnect = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!login.trim() || !password || !server.trim()) return;

        setIsLoading(true);
        setStatus({
            type: 'info',
            message: isEn ? 'Authenticating terminal credentials...' : 'Verificando credenciais...',
        });

        try {
            const res = await api.post('/mt5/cloud/connect', {
                login: login.trim(),
                pass: password,
                server: server.trim(),
            });

            if (res.data?.server) {
                setServer(res.data.server);
            }

            if (refreshAccounts) await refreshAccounts();
            if (res.data?.accountId && selectAccount) {
                selectAccount(res.data.accountId);
            }

            await fetchCloudStatus(login.trim());

            if (res.data?.taskId) {
                startTaskPolling(res.data.taskId, login.trim());
            } else {
                setIsLoading(false);
                setShowFormOverride(false);
                window.dispatchEvent(new Event('trade-imported'));
            }
        } catch (err: any) {
            setIsLoading(false);
            setStatus({
                type: 'error',
                message:
                    cleanBackendMessage(err.response?.data?.message || err.message, isEn) ||
                    (isEn ? 'Connection request failed.' : 'Falha ao solicitar conexão.'),
            });
        }
    };

    const handleForceSync = async (forceFull = false) => {
        const targetLogin = cloudState?.account?.mt5Id || login;
        if (!targetLogin) return;

        setIsSyncing(true);
        setStatus({
            type: 'info',
            message: forceFull
                ? (isEn ? 'Re-importing full trade history...' : 'Reimportando histórico completo...')
                : (isEn ? 'Fetching latest fills...' : 'Buscando novos registros...'),
        });

        try {
            const res = await api.post('/mt5/cloud/sync', {
                login: targetLogin,
                accountId: cloudState?.account?.id || validSelectedAccountId,
                forceFull,
            });
            await fetchCloudStatus(targetLogin);
            if (res.data?.taskId) {
                startTaskPolling(res.data.taskId, targetLogin);
            } else {
                setIsSyncing(false);
                window.dispatchEvent(new Event('trade-imported'));
            }
        } catch (err: any) {
            setIsSyncing(false);
            setStatus({
                type: 'error',
                message:
                    cleanBackendMessage(err.response?.data?.message, isEn) ||
                    (isEn ? 'Sync failed.' : 'Falha ao atualizar.'),
            });
        }
    };

    const handleDisconnect = async () => {
        const targetLogin = cloudState?.account?.mt5Id || login;
        if (!targetLogin) return;

        try {
            await api.post('/mt5/cloud/disconnect', {
                login: targetLogin,
                accountId: cloudState?.account?.id || validSelectedAccountId,
            });
            setConfirmDisconnect(false);
            setStatus({
                type: 'info',
                message: isEn ? `Connection #${targetLogin} disconnected.` : `Vínculo #${targetLogin} encerrado.`,
            });
            await fetchCloudStatus(targetLogin);
            if (refreshAccounts) await refreshAccounts();
        } catch (err: any) {
            setStatus({
                type: 'error',
                message:
                    cleanBackendMessage(err.response?.data?.message, isEn) ||
                    (isEn ? 'Failed to disconnect.' : 'Erro ao desconectar.'),
            });
        }
    };

    const acc = cloudState?.account;
    const activeTask = cloudState?.activeTask;
    const openPositions: any[] = cloudState?.positions || [];
    const recentTrades: any[] = cloudState?.recentTrades || [];
    const totalTradesCount: number = cloudState?.totalTradesCount ?? acc?.totalTradesCount ?? 0;
    const openPositionsCount: number = openPositions.length || (acc?.openPositionsCount ?? 0);
    const totalOperationsCount: number = openPositionsCount + totalTradesCount;
    const isAccConnected = Boolean(acc?.isConnected || acc?.connectionState === 'CONNECTED');

    const syncedMt5Accounts = useMemo(() => {
        const fromCloud: any[] = Array.isArray(cloudState?.mt5Accounts) ? cloudState.mt5Accounts : [];
        const fromContext = accounts.filter((a) => !a.isArchived && !!a.mt5Id);
        const mergedMap = new Map<string, any>();
        for (const item of fromContext) {
            if (item.mt5Id) mergedMap.set(item.mt5Id, item);
        }
        for (const item of fromCloud) {
            if (item.mt5Id) {
                mergedMap.set(item.mt5Id, { ...(mergedMap.get(item.mt5Id) || {}), ...item });
            }
        }
        return Array.from(mergedMap.values());
    }, [cloudState?.mt5Accounts, accounts]);

    const allSyncedOperations = useMemo(() => {
        const mappedOpen = openPositions.map((pos: any) => ({
            id: pos.id || `pos-${pos.ticket}`,
            ticket: pos.ticket,
            symbol: pos.symbol,
            type: (pos.type || 'BUY').toString().toUpperCase().includes('SELL') ? 'SELL' : 'BUY',
            volume: Number(pos.volume || 0),
            openPrice: Number(pos.openPrice ?? pos.priceOpen ?? 0),
            closePrice: Number(pos.currentPrice ?? pos.priceCurrent ?? pos.openPrice ?? 0),
            openTime: pos.openTime || pos.time || null,
            closeTime: null,
            profit: Number(pos.profit || 0),
            netPnl: Number(pos.profit || 0),
            isOpenPosition: true,
        }));
        const mappedClosed = recentTrades.map((tr: any) => ({
            ...tr,
            isOpenPosition: false,
        }));
        return [...mappedOpen, ...mappedClosed];
    }, [openPositions, recentTrades]);

    const connectionState = acc?.connectionState || (isAccConnected ? 'CONNECTED' : 'DISCONNECTED');
    const isBusyConnecting =
        Boolean(activeTaskId) || connectionState === 'CONNECTING' || connectionState === 'SYNCING';

    const showConnectionForm = !isAccConnected || showFormOverride;

    const headerTitle = matchedBroker?.broker || selectedBrokerLabel || 'MetaTrader 5';

    return (
        <div className="space-y-5 animate-fade-in-up">
            {/* Compact Account Switcher Bar (only when user already has MT5 accounts) */}
            {syncedMt5Accounts.length > 0 && (
                <div className="flex items-center justify-between gap-2 overflow-x-auto no-scrollbar pb-1">
                    <div className="flex items-center gap-2">
                        {syncedMt5Accounts.map((mt5Acc) => {
                            const isCurrent =
                                !showFormOverride &&
                                (acc?.mt5Id === mt5Acc.mt5Id || selectedAccountId === mt5Acc.id);
                            const isOnline =
                                mt5Acc.isConnected || mt5Acc.connectionState === 'CONNECTED';

                            return (
                                <button
                                    key={mt5Acc.id || mt5Acc.mt5Id}
                                    type="button"
                                    onClick={() => {
                                        setShowFormOverride(false);
                                        setStatus(null);
                                        if (mt5Acc.id && selectAccount) {
                                            selectAccount(mt5Acc.id);
                                        }
                                        if (mt5Acc.mt5Id) {
                                            setLogin(mt5Acc.mt5Id);
                                            if (mt5Acc.broker) setServer(mt5Acc.broker);
                                            fetchCloudStatus(mt5Acc.mt5Id);
                                        }
                                    }}
                                    className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-semibold transition-all shrink-0 ${
                                        isCurrent
                                            ? 'bg-accent/15 border-accent/40 text-fg'
                                            : 'bg-surface border-line text-fg-muted hover:text-fg'
                                    }`}
                                >
                                    <span
                                        className={`w-2 h-2 rounded-full ${
                                            isOnline ? 'bg-emerald-400' : 'bg-fg-disabled'
                                        }`}
                                    />
                                    <span>#{mt5Acc.mt5Id}</span>
                                </button>
                            );
                        })}
                    </div>

                    <button
                        type="button"
                        onClick={() => {
                            setLogin('');
                            setPassword('');
                            setServer('');
                            setSelectedBrokerLabel('');
                            setStatus(null);
                            setShowFormOverride(true);
                        }}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-dashed border-line-strong hover:border-accent/40 text-xs font-semibold text-accent-fg shrink-0 transition-colors"
                    >
                        <Plus size={14} />
                        {isEn ? 'New account' : 'Nova conta'}
                    </button>
                </div>
            )}

            {showConnectionForm ? (
                /* Connection Form View */
                <div className="rounded-2xl border border-line bg-surface p-5 sm:p-8 space-y-6">
                    <div className="flex items-center justify-between gap-4 pb-5 border-b border-line">
                        <div className="flex items-center gap-3.5 min-w-0">
                            {matchedBroker ? (
                                <BrokerLogo broker={matchedBroker.group} size="lg" />
                            ) : (
                                <div className="w-12 h-12 rounded-2xl bg-surface-2 border border-line-strong flex items-center justify-center shrink-0 p-2">
                                    <Mt5Icon className="w-full h-full" />
                                </div>
                            )}
                            <div className="min-w-0">
                                <h2 className="text-lg sm:text-xl font-bold text-fg truncate">
                                    {headerTitle}
                                </h2>
                                <p className="text-xs sm:text-sm text-fg-muted">
                                    {isEn ? 'Enter your MT5 account credentials' : 'Informe os dados de acesso da conta'}
                                </p>
                            </div>
                        </div>

                        {isAccConnected && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowFormOverride(false)}
                            >
                                {isEn ? 'Cancel' : 'Cancelar'}
                            </Button>
                        )}
                    </div>

                    <form onSubmit={handleConnect} className="space-y-5">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <label
                                    htmlFor="mt5-login"
                                    className="block text-xs font-semibold uppercase tracking-wider text-fg-muted"
                                >
                                    Login
                                </label>
                                <input
                                    id="mt5-login"
                                    type="text"
                                    inputMode="numeric"
                                    placeholder={isEn ? 'e.g., 202658742' : 'Ex: 202658742'}
                                    value={login}
                                    onChange={(e) => setLogin(e.target.value)}
                                    className="w-full bg-canvas border border-line hover:border-line-strong focus:border-accent/60 rounded-xl px-4 py-3 text-sm text-fg font-mono placeholder:font-sans placeholder:text-fg-subtle focus:outline-none transition-colors"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label
                                    htmlFor="mt5-password"
                                    className="block text-xs font-semibold uppercase tracking-wider text-fg-muted"
                                >
                                    {isEn ? 'Password' : 'Senha'}
                                </label>
                                <div className="relative">
                                    <input
                                        id="mt5-password"
                                        type={showPassword ? 'text' : 'password'}
                                        placeholder={isEn ? 'Investor or master password' : 'Investidor ou principal'}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full bg-canvas border border-line hover:border-line-strong focus:border-accent/60 rounded-xl px-4 py-3 pr-10 text-sm text-fg placeholder:text-fg-subtle focus:outline-none transition-colors"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg p-1"
                                        aria-label={showPassword ? (isEn ? 'Hide' : 'Ocultar') : (isEn ? 'Show' : 'Mostrar')}
                                    >
                                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <label
                                    htmlFor="mt5-server"
                                    className="block text-xs font-semibold uppercase tracking-wider text-fg-muted"
                                >
                                    {isEn ? 'Trade Server' : 'Servidor'}
                                </label>
                                {matchedBroker && (
                                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-accent/10 text-accent-fg border border-accent/25">
                                        {matchedBroker.broker} ·{' '}
                                        {matchedBroker.server.env === 'DEMO' ? 'Demo' : (isEn ? 'Live' : 'Real')}
                                    </span>
                                )}
                            </div>

                            <div className="flex flex-col sm:flex-row items-stretch gap-2">
                                <div className="relative flex-1">
                                    <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none flex items-center">
                                        {matchedBroker ? (
                                            <BrokerLogo broker={matchedBroker.group} size="sm" />
                                        ) : (
                                            <Server size={16} className="text-fg-subtle" />
                                        )}
                                    </div>
                                    <input
                                        id="mt5-server"
                                        type="text"
                                        placeholder={isEn ? 'e.g., FTMO-Server, Exness-MT5Real...' : 'Ex: FTMO-Server, Exness-MT5Real...'}
                                        value={server}
                                        onChange={(e) => setServer(e.target.value)}
                                        className="w-full bg-canvas border border-line hover:border-line-strong focus:border-accent/60 rounded-xl py-3 pl-11 pr-9 text-sm text-fg placeholder:text-fg-subtle focus:outline-none transition-colors"
                                    />
                                    {server && (
                                        <button
                                            type="button"
                                            onClick={() => setServer('')}
                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg p-1 rounded-lg"
                                            aria-label={isEn ? 'Clear' : 'Limpar'}
                                        >
                                            <X size={14} />
                                        </button>
                                    )}
                                </div>

                                <button
                                    type="button"
                                    onClick={() => setIsServerModalOpen(true)}
                                    className="px-4 py-3 rounded-xl border border-line-strong bg-surface-2 hover:bg-surface-3 hover:border-accent/40 text-xs font-semibold text-fg flex items-center justify-center gap-2 shrink-0 transition-colors"
                                >
                                    <Building2 size={15} className="text-accent-fg" />
                                    <span>{isEn ? 'Brokers' : 'Corretoras'}</span>
                                    <ChevronDown size={14} className="text-fg-subtle" />
                                </button>
                            </div>
                        </div>

                        <p className="text-xs text-fg-subtle flex items-center gap-1.5">
                            <ShieldCheck size={14} className="text-accent-fg shrink-0" />
                            {isEn
                                ? 'We recommend using your read-only investor password for security.'
                                : 'Recomendamos usar a senha de investidor (somente leitura).'}
                        </p>

                        {(status || activeTask) && (
                            <div
                                role="status"
                                className={`p-4 rounded-xl border flex items-start gap-2.5 text-xs sm:text-sm ${
                                    status?.type === 'error'
                                        ? 'bg-danger/10 border-danger/25 text-danger-fg'
                                        : status?.type === 'success'
                                          ? 'bg-accent/10 border-accent/25 text-accent-fg'
                                          : 'bg-canvas-subtle border-line text-fg'
                                }`}
                            >
                                {status?.type === 'success' ? (
                                    <CheckCircle2 size={17} className="shrink-0 mt-0.5 text-accent-fg" />
                                ) : status?.type === 'error' ? (
                                    <AlertTriangle size={17} className="shrink-0 mt-0.5 text-danger-fg" />
                                ) : (
                                    <Activity
                                        size={17}
                                        className="shrink-0 mt-0.5 text-accent-fg animate-pulse"
                                    />
                                )}
                                <span className="font-medium leading-relaxed">
                                    {status?.message || (isEn ? 'Connecting...' : 'Conectando...')}
                                </span>
                            </div>
                        )}

                        <Button
                            type="submit"
                            variant="brand"
                            size="lg"
                            fullWidth
                            isLoading={isLoading || Boolean(activeTaskId)}
                            disabled={!login.trim() || !password || !server.trim()}
                            icon={<Power size={17} />}
                        >
                            {isBusyConnecting
                                ? (isEn ? 'Validating...' : 'Validando...')
                                : (isEn ? 'Connect Account' : 'Conectar')}
                        </Button>
                    </form>
                </div>
            ) : (
                /* Connected Account Unified View */
                <div className="rounded-2xl border border-line bg-surface p-5 sm:p-8 space-y-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-line">
                        <div className="flex items-center gap-3.5 min-w-0">
                            {matchedBroker ? (
                                <BrokerLogo broker={matchedBroker.group} size="lg" />
                            ) : (
                                <div className="w-12 h-12 rounded-2xl bg-surface-2 border border-line-strong flex items-center justify-center shrink-0 p-2">
                                    <Mt5Icon className="w-full h-full" />
                                </div>
                            )}
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h2 className="text-lg sm:text-xl font-bold text-fg">
                                        {isEn ? `Account #${acc.mt5Id}` : `Conta #${acc.mt5Id}`}
                                    </h2>
                                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-accent/10 text-accent-fg border border-accent/25">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                        {isEn ? 'Connected' : 'Ativa'}
                                    </span>
                                </div>
                                <p className="text-xs sm:text-sm text-fg-muted truncate mt-0.5">
                                    {acc.company || acc.server || acc.broker}
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                variant="brand"
                                size="sm"
                                onClick={() => handleForceSync(false)}
                                isLoading={isSyncing}
                                icon={<RefreshCw size={14} />}
                            >
                                {isEn ? 'Sync Now' : 'Sincronizar'}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setShowFormOverride(true)}
                                icon={<KeyRound size={14} />}
                            >
                                {isEn ? 'Password' : 'Senha'}
                            </Button>
                            {!confirmDisconnect ? (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setConfirmDisconnect(true)}
                                    icon={<LogOut size={14} />}
                                    className="text-danger-fg hover:text-danger-fg hover:bg-danger/10"
                                >
                                    {isEn ? 'Disconnect' : 'Sair'}
                                </Button>
                            ) : (
                                <div className="flex items-center gap-1.5">
                                    <Button variant="danger" size="sm" onClick={handleDisconnect}>
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

                    {status && (
                        <div
                            role="status"
                            className={`p-3.5 rounded-xl border flex items-center gap-2.5 text-xs sm:text-sm ${
                                status.type === 'error'
                                    ? 'bg-danger/10 border-danger/25 text-danger-fg'
                                    : 'bg-accent/10 border-accent/25 text-fg'
                            }`}
                        >
                            {status.type === 'error' ? (
                                <AlertTriangle size={16} className="shrink-0 text-danger-fg" />
                            ) : (
                                <CheckCircle2 size={16} className="shrink-0 text-accent-fg" />
                            )}
                            <span>{status.message}</span>
                        </div>
                    )}

                    {/* Metrics */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="p-3.5 rounded-xl bg-canvas-subtle border border-line">
                            <span className="text-[11px] text-fg-subtle block">
                                {isEn ? 'Balance' : 'Saldo'}
                            </span>
                            <span className="font-bold text-fg text-sm sm:text-base tabular-nums mt-0.5 block">
                                {acc.currency || 'USD'}{' '}
                                {Number(acc.balance || 0).toLocaleString('en-US', {
                                    minimumFractionDigits: 2,
                                })}
                            </span>
                        </div>
                        <div className="p-3.5 rounded-xl bg-canvas-subtle border border-line">
                            <span className="text-[11px] text-fg-subtle block">
                                {isEn ? 'Equity' : 'Patrimônio'}
                            </span>
                            <span className="font-bold text-accent-fg text-sm sm:text-base tabular-nums mt-0.5 block">
                                {acc.currency || 'USD'}{' '}
                                {Number(acc.equity || 0).toLocaleString('en-US', {
                                    minimumFractionDigits: 2,
                                })}
                            </span>
                        </div>
                        <div className="p-3.5 rounded-xl bg-canvas-subtle border border-line">
                            <span className="text-[11px] text-fg-subtle block">
                                {isEn ? 'Closed' : 'Fechadas'}
                            </span>
                            <span className="font-bold text-fg text-sm sm:text-base tabular-nums mt-0.5 block">
                                {totalTradesCount}
                            </span>
                        </div>
                        <div className="p-3.5 rounded-xl bg-canvas-subtle border border-line">
                            <span className="text-[11px] text-fg-subtle block">
                                {isEn ? 'Open' : 'Em aberto'}
                            </span>
                            <span className="font-bold text-fg text-sm sm:text-base tabular-nums mt-0.5 block">
                                {openPositionsCount}
                            </span>
                        </div>
                    </div>

                    {/* Operations Preview */}
                    <div className="pt-2 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-fg-muted">
                                {isEn ? `Recent Executions (${totalOperationsCount})` : `Últimos registros (${totalOperationsCount})`}
                            </h3>
                            <div className="flex items-center gap-3 text-xs">
                                <button
                                    type="button"
                                    onClick={() => handleForceSync(true)}
                                    className="text-fg-muted hover:text-fg font-medium"
                                >
                                    {isEn ? 'Re-import full history' : 'Reimportar tudo'}
                                </button>
                                <Link
                                    to="/trades"
                                    className="font-semibold text-accent-fg hover:underline"
                                >
                                    {isEn ? 'View ledger →' : 'Ver todas →'}
                                </Link>
                            </div>
                        </div>

                        {allSyncedOperations.length === 0 ? (
                            <div className="p-6 text-center rounded-xl bg-canvas-subtle border border-line text-fg-muted text-xs sm:text-sm">
                                {isEn ? 'No executions synced yet.' : 'Nenhum registro encontrado até o momento.'}
                            </div>
                        ) : (
                            <>
                                {/* Mobile Cards */}
                                <div className="space-y-2 md:hidden">
                                    {allSyncedOperations.slice(0, 10).map((trade: any) => {
                                        const grossPnl = Number(trade.profit ?? trade.netPnl ?? 0);
                                        const isWin = grossPnl >= 0;
                                        const isOpen =
                                            trade.isOpenPosition ||
                                            (trade.status || '').toUpperCase() === 'OPEN';
                                        const isBuy = (trade.type || '').toUpperCase().includes('BUY');

                                        return (
                                            <div
                                                key={`m-${isOpen ? 'open' : 'closed'}-${trade.id || trade.ticket}`}
                                                className="p-3.5 rounded-xl bg-canvas-subtle border border-line space-y-1.5"
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-sm text-fg">
                                                            {trade.symbol}
                                                        </span>
                                                        <span
                                                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                                                isBuy
                                                                    ? 'bg-accent/15 text-accent-fg'
                                                                    : 'bg-danger/15 text-danger-fg'
                                                            }`}
                                                        >
                                                            {isBuy ? (isEn ? 'LONG' : 'COMPRA') : (isEn ? 'SHORT' : 'VENDA')}
                                                        </span>
                                                        {isOpen && (
                                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/15 text-sky-400">
                                                                {isEn ? 'Open' : 'Aberta'}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span
                                                        className={`text-sm font-bold tabular-nums ${
                                                            isWin ? 'text-accent-fg' : 'text-danger-fg'
                                                        }`}
                                                    >
                                                        {isWin ? '+' : ''}
                                                        {grossPnl.toFixed(2)}
                                                    </span>
                                                </div>

                                                <div className="flex items-center justify-between text-[11px] text-fg-muted tabular-nums">
                                                    <span>Vol: {Number(trade.volume || 0).toFixed(2)}</span>
                                                    <span>
                                                        {Number(trade.openPrice || 0)} →{' '}
                                                        {Number(trade.closePrice || 0)}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Desktop Table */}
                                <div className="hidden md:block overflow-x-auto">
                                    <table className="w-full text-left border-collapse text-xs">
                                        <thead>
                                            <tr className="border-b border-line text-fg-subtle uppercase">
                                                <th className="py-2 px-3">{isEn ? 'Symbol' : 'Ativo'}</th>
                                                <th className="py-2 px-3">{isEn ? 'Side' : 'Direção'}</th>
                                                <th className="py-2 px-3">{isEn ? 'Lots' : 'Volume'}</th>
                                                <th className="py-2 px-3">{isEn ? 'Prices' : 'Preços'}</th>
                                                <th className="py-2 px-3">{isEn ? 'Time' : 'Data'}</th>
                                                <th className="py-2 px-3 text-right">{isEn ? 'Net P&L' : 'Resultado'}</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-line">
                                            {allSyncedOperations.slice(0, 12).map((trade: any) => {
                                                const grossPnl = Number(trade.profit ?? trade.netPnl ?? 0);
                                                const isWin = grossPnl >= 0;
                                                const isOpen =
                                                    trade.isOpenPosition ||
                                                    (trade.status || '').toUpperCase() === 'OPEN';
                                                const isBuy = (trade.type || '').toUpperCase().includes('BUY');

                                                return (
                                                    <tr
                                                        key={`d-${isOpen ? 'open' : 'closed'}-${trade.id || trade.ticket}`}
                                                        className="hover:bg-surface-2/60 transition-colors"
                                                    >
                                                        <td className="py-2.5 px-3 font-bold text-fg">
                                                            {trade.symbol}
                                                            {isOpen && (
                                                                <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-500/15 text-sky-400">
                                                                    {isEn ? 'Open' : 'Aberta'}
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="py-2.5 px-3">
                                                            <span
                                                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-semibold ${
                                                                    isBuy
                                                                        ? 'bg-accent/15 text-accent-fg'
                                                                        : 'bg-danger/15 text-danger-fg'
                                                                }`}
                                                            >
                                                                {isBuy ? (
                                                                    <TrendingUp size={11} />
                                                                ) : (
                                                                    <TrendingDown size={11} />
                                                                )}
                                                                {isBuy ? (isEn ? 'Long' : 'Compra') : (isEn ? 'Short' : 'Venda')}
                                                            </span>
                                                        </td>
                                                        <td className="py-2.5 px-3 text-fg tabular-nums">
                                                            {Number(trade.volume || 0).toFixed(2)}
                                                        </td>
                                                        <td className="py-2.5 px-3 font-mono text-fg-muted">
                                                            {Number(trade.openPrice || 0)} →{' '}
                                                            {Number(trade.closePrice || 0)}
                                                        </td>
                                                        <td className="py-2.5 px-3 text-fg-muted tabular-nums whitespace-nowrap">
                                                            {trade.openTime
                                                                ? formatTradeDateTime(trade.openTime, { includeSeconds: false })
                                                                : trade.closeTime
                                                                  ? formatTradeDateTime(trade.closeTime, { includeSeconds: false })
                                                                  : '—'}
                                                        </td>
                                                        <td
                                                            className={`py-2.5 px-3 text-right font-bold tabular-nums ${
                                                                isWin ? 'text-accent-fg' : 'text-danger-fg'
                                                            }`}
                                                        >
                                                            {isWin ? '+' : ''}
                                                            {grossPnl.toFixed(2)} {acc.currency || 'USD'}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            <Mt5ServerModal
                isOpen={isServerModalOpen}
                currentServer={server}
                initialBrokerFilter={initialBrokerIdParam}
                onSelect={(chosenServer, chosenBroker) => {
                    setServer(chosenServer);
                    if (chosenBroker) setSelectedBrokerLabel(chosenBroker);
                }}
                onClose={() => setIsServerModalOpen(false)}
            />
        </div>
    );
};
