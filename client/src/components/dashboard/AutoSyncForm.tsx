import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { BrokerLogo } from '../ui/BrokerLogo';
import {
    Cloud,
    Power,
    AlertTriangle,
    CheckCircle,
    ArrowLeft,
    RefreshCw,
    Activity,
    Server,
    Wifi,
    WifiOff,
    ShieldCheck,
    LogOut,
    TrendingUp,
    TrendingDown,
    FileCheck,
    Clock,
    Search,
    ChevronDown,
    Building2,
    Check,
    X
} from 'lucide-react';
import api from '../../api';
import { useAccount } from '../../context/AccountContext';
import { MT5_BROKERS_CATALOG } from '../../constants/mt5ServersCatalog';

interface AutoSyncFormProps {
    brokerName: string;
    serverName?: string;
    onBack: () => void;
}

export const AutoSyncForm = ({ brokerName, serverName = '', onBack }: AutoSyncFormProps) => {
    const { selectedAccountId, refreshAccounts } = useAccount();
    const [login, setLogin] = useState('');
    const [password, setPassword] = useState('');
    const [server, setServer] = useState(serverName);
    const [isServerDropdownOpen, setIsServerDropdownOpen] = useState(false);
    const [brokerSearchQuery, setBrokerSearchQuery] = useState('');
    const [selectedBrokerFilter, setSelectedBrokerFilter] = useState<string>('ALL');
    const [selectedEnvFilter, setSelectedEnvFilter] = useState<'ALL' | 'DEMO' | 'REAL'>('ALL');
    const serverDropdownRef = useRef<HTMLDivElement>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [requestFeedback, setRequestFeedback] = useState<string | null>(null);
    const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
    const [cloudState, setCloudState] = useState<any>(null);
    const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
    const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
    const pollTimerRef = useRef<any>(null);

    useEffect(() => {
        if (!isServerDropdownOpen) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsServerDropdownOpen(false);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isServerDropdownOpen]);

    const filteredBrokerGroups = useMemo(() => {
        const q = brokerSearchQuery.trim().toLowerCase();
        return MT5_BROKERS_CATALOG.map((group) => {
            if (selectedBrokerFilter !== 'ALL' && group.id !== selectedBrokerFilter && group.category !== selectedBrokerFilter) {
                return null;
            }
            const brokerMatches =
                !q ||
                group.broker.toLowerCase().includes(q) ||
                group.id.toLowerCase().includes(q) ||
                group.category.toLowerCase().includes(q);

            const matchingServers = group.servers.filter((srv) => {
                if (selectedEnvFilter !== 'ALL' && srv.env !== selectedEnvFilter) return false;
                if (!q || brokerMatches) return true;
                return (
                    srv.name.toLowerCase().includes(q) ||
                    (srv.description && srv.description.toLowerCase().includes(q))
                );
            });

            if (matchingServers.length === 0) return null;
            return {
                ...group,
                servers: matchingServers,
            };
        }).filter(Boolean) as typeof MT5_BROKERS_CATALOG;
    }, [brokerSearchQuery, selectedBrokerFilter, selectedEnvFilter]);

    const matchedBrokerForCurrentServer = useMemo(() => {
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
            if (selectedAccountId) params.accountId = selectedAccountId;
            if (overrideLogin || login) params.login = (overrideLogin || login).trim();
            const res = await api.get('/mt5/cloud/status', { params });
            setCloudState(res.data);
            setLastUpdatedAt(new Date().toLocaleTimeString());

            if (res.data?.account?.mt5Id && !login) {
                setLogin(res.data.account.mt5Id);
            }
            if (res.data?.account?.server && !server) {
                setServer(res.data.account.server);
            }
        } catch (err) {
            // Ignore initial status errors
        }
    };

    useEffect(() => {
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
                setLastUpdatedAt(new Date().toLocaleTimeString());
                setCloudState((prev: any) => ({
                    ...(prev || {}),
                    account: res.data?.account || prev?.account,
                    worker: res.data?.worker || prev?.worker,
                    recentTrades: res.data?.recentTrades ?? prev?.recentTrades ?? [],
                    totalTradesCount: res.data?.totalTradesCount ?? prev?.totalTradesCount ?? 0,
                    auditLogs: res.data?.auditLogs ?? prev?.auditLogs ?? [],
                    recentEvents: res.data?.recentEvents ?? prev?.recentEvents ?? [],
                    activeTask: task,
                }));

                if (!task) return;

                if (task.status === 'IN_PROGRESS' || task.status === 'RECEIVED') {
                    setStatus({
                        type: 'info',
                        message: task.message || `Conectando à conta ${targetLogin}...`
                    });
                } else if (task.status === 'SUCCESS') {
                    clearInterval(pollTimerRef.current);
                    pollTimerRef.current = null;
                    setActiveTaskId(null);
                    setIsLoading(false);
                    setIsSyncing(false);
                    setStatus({
                        type: 'success',
                        message: task.message || 'Conta MT5 conectada e sincronizada com sucesso!'
                    });
                    await fetchCloudStatus(targetLogin);
                    if (refreshAccounts) await refreshAccounts();
                    window.dispatchEvent(new Event('trade-imported'));
                } else if (task.status === 'FAILED') {
                    clearInterval(pollTimerRef.current);
                    pollTimerRef.current = null;
                    setActiveTaskId(null);
                    setIsLoading(false);
                    setIsSyncing(false);
                    setStatus({
                        type: 'error',
                        message: task.errorMessage || task.message || 'Falha ao autenticar no servidor MT5. Verifique login, senha e nome do servidor.'
                    });
                    await fetchCloudStatus(targetLogin);
                    window.dispatchEvent(new Event('trade-imported'));
                }
            } catch (err) {
                // Keep polling on transient error
            }
        }, 1500);
    };

    const handleConnect = async () => {
        if (!login || !password || !server) return;

        setIsLoading(true);
        setRequestFeedback(null);
        setStatus({
            type: 'info',
            message: 'Iniciando conexão com a sua conta...'
        });

        try {
            const res = await api.post('/mt5/cloud/connect', {
                login: login.trim(),
                pass: password,
                server: server.trim(),
                accountId: selectedAccountId || undefined
            });

            if (res.data?.server) {
                setServer(res.data.server);
            }

            const confirmationMsg =
                'Solicitação de conexão enviada com sucesso! Sincronizando sua conta...';
            setRequestFeedback(confirmationMsg);
            setStatus({
                type: 'info',
                message: confirmationMsg
            });

            // Carrega imediatamente o estado inicial do backend
            await fetchCloudStatus(login.trim());

            if (res.data?.taskId) {
                startTaskPolling(res.data.taskId, login.trim());
            } else {
                setIsLoading(false);
                if (refreshAccounts) await refreshAccounts();
                window.dispatchEvent(new Event('trade-imported'));
            }
        } catch (e: any) {
            setIsLoading(false);
            setStatus({
                type: 'error',
                message: e.response?.data?.message || e.message || 'Falha ao enviar solicitação de conexão.'
            });
        }
    };

    const handleForceSync = async (forceFull = false) => {
        const targetLogin = cloudState?.account?.mt5Id || login;
        if (!targetLogin) return;

        setIsSyncing(true);
        const syncMsg = 'Solicitação de conexão enviada com sucesso! Sincronizando sua conta...';
        setRequestFeedback(syncMsg);
        setStatus({
            type: 'info',
            message: forceFull
                ? 'Atualizando todo o histórico de operações da sua conta...'
                : syncMsg
        });

        try {
            const res = await api.post('/mt5/cloud/sync', {
                login: targetLogin,
                accountId: cloudState?.account?.id || selectedAccountId,
                forceFull
            });
            await fetchCloudStatus(targetLogin);
            if (res.data?.taskId) {
                startTaskPolling(res.data.taskId, targetLogin);
            } else {
                setIsSyncing(false);
                window.dispatchEvent(new Event('trade-imported'));
            }
        } catch (e: any) {
            setIsSyncing(false);
            setStatus({
                type: 'error',
                message: e.response?.data?.message || 'Erro ao solicitar sincronização.'
            });
        }
    };

    const handleDisconnect = async () => {
        const targetLogin = cloudState?.account?.mt5Id || login;
        if (!targetLogin) return;

        try {
            await api.post('/mt5/cloud/disconnect', {
                login: targetLogin,
                accountId: cloudState?.account?.id || selectedAccountId
            });
            setRequestFeedback(null);
            setStatus({
                type: 'info',
                message: `Conta ${targetLogin} desconectada.`
            });
            await fetchCloudStatus(targetLogin);
            if (refreshAccounts) await refreshAccounts();
        } catch (e: any) {
            setStatus({
                type: 'error',
                message: e.response?.data?.message || 'Erro ao desconectar conta.'
            });
        }
    };

    const worker = cloudState?.worker;
    const acc = cloudState?.account;
    const activeTask = cloudState?.activeTask;
    const recentTrades: any[] = cloudState?.recentTrades || [];
    const totalTradesCount: number = cloudState?.totalTradesCount ?? acc?.totalTradesCount ?? 0;
    const auditLogs: any[] = cloudState?.auditLogs || [];
    const recentEvents: any[] = cloudState?.recentEvents || [];
    const isAccConnected = acc?.isConnected || acc?.connectionState === 'CONNECTED';

    const getConnectionBadge = () => {
        const state = acc?.connectionState || (isAccConnected ? 'CONNECTED' : 'DISCONNECTED');
        if (activeTaskId || state === 'CONNECTING' || state === 'SYNCING') {
            return {
                label: state === 'SYNCING' ? 'SINCRONIZANDO' : 'CONECTANDO...',
                className: 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 animate-pulse'
            };
        }
        if (state === 'CONNECTED' || isAccConnected) {
            return {
                label: 'CONECTADO',
                className: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
            };
        }
        if (state === 'AUTH_FAILED') {
            return {
                label: 'SENHA OU SERVIDOR INVÁLIDO',
                className: 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
            };
        }
        return {
            label: 'DESCONECTADO',
            className: 'bg-slate-500/15 text-slate-400 border border-slate-500/30'
        };
    };

    const connectionBadge = getConnectionBadge();

    // Cálculo das 4 etapas visuais
    const taskStatus = activeTask?.status;
    const step1Done = !!requestFeedback || !!activeTask || isAccConnected;
    const step2Done = taskStatus === 'IN_PROGRESS' || taskStatus === 'SUCCESS' || taskStatus === 'FAILED' || isAccConnected;
    const step3Done = isAccConnected || taskStatus === 'SUCCESS';
    const step3Failed = taskStatus === 'FAILED' || acc?.connectionState === 'AUTH_FAILED';
    const step4Done = taskStatus === 'SUCCESS' || (isAccConnected && !!acc?.lastSyncAt);

    return (
        <div className="max-w-3xl mx-auto animate-in fade-in slide-in-from-right-4 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                    onClick={onBack}
                    className="flex items-center gap-2 text-[#9CA3AF] hover:text-[#F3F4F6] transition-colors text-sm"
                >
                    <ArrowLeft size={16} />
                    Voltar às opções
                </button>

                {/* Status da Sincronização */}
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${
                    worker?.isOnline
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                }`}>
                    {worker?.isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
                    <span>
                        {worker?.isOnline
                            ? 'Sincronização Automática Online'
                            : 'Conectando ao serviço...'}
                    </span>
                </div>
            </div>

            {/* Formulário de Conexão / Atualização de Credenciais MT5 */}
            <Card className="p-8 bg-[#111319] border-white/[0.08] shadow-2xl">
                <div className="flex items-center gap-4 mb-8">
                    <div className="w-12 h-12 bg-emerald-500/10 rounded-full flex items-center justify-center text-emerald-400">
                        <Cloud size={24} />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-[#F3F4F6]">Conectar {brokerName}</h2>
                        <p className="text-sm text-[#9CA3AF]">
                            Insira os dados da sua conta para importar suas operações automaticamente.
                        </p>
                    </div>
                </div>

                <div className="space-y-6">
                    <Input
                        label="Número da Conta (Login MT5)"
                        placeholder="Ex: 202658742"
                        value={login}
                        onChange={(e) => setLogin(e.target.value)}
                        className="bg-[#08090C] border-white/[0.08]"
                    />

                    <Input
                        label="Senha da Conta / Investidor"
                        type="password"
                        placeholder="Digite a senha da conta MT5"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="bg-[#08090C] border-white/[0.08]"
                    />
                    <p className="text-xs text-[#6B7280] -mt-4 flex items-center gap-1.5">
                        <ShieldCheck size={14} className="text-emerald-400" />
                        Seus dados são protegidos com segurança e usados exclusivamente para sincronizar seus trades.
                    </p>

                    {/* Campo Híbrido: Servidor da Corretora (Campo Livre + Dropdown com Busca de Corretoras) */}
                    <div className="space-y-2.5" ref={serverDropdownRef}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <label className="block text-sm font-medium text-[#D1D5DB]">
                                Servidor da Corretora <span className="text-xs font-normal text-[#9CA3AF]">(Selecione na lista ou digite livremente)</span>
                            </label>
                            {matchedBrokerForCurrentServer ? (
                                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                                    <BrokerLogo broker={matchedBrokerForCurrentServer.group} size="xs" />
                                    {matchedBrokerForCurrentServer.broker} • {matchedBrokerForCurrentServer.server.env}
                                </span>
                            ) : server.trim() ? (
                                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/25">
                                    <Server size={12} />
                                    Servidor Personalizado
                                </span>
                            ) : null}
                        </div>

                        <div className="relative">
                            <div className="flex flex-col sm:flex-row items-stretch gap-2">
                                <div className="relative flex-1">
                                    <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none flex items-center">
                                        {matchedBrokerForCurrentServer ? (
                                            <BrokerLogo broker={matchedBrokerForCurrentServer.group} size="sm" />
                                        ) : (
                                            <Server size={16} className="text-[#6B7280] ml-0.5" />
                                        )}
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="Digite o servidor ou escolha no modal (Ex: Deriv-Demo, Exness-MT5Real...)"
                                        value={server}
                                        onChange={(e) => {
                                            setServer(e.target.value);
                                        }}
                                        className="w-full bg-[#08090C] border border-white/[0.08] focus:border-emerald-500/60 rounded-xl py-3 pl-11 pr-9 text-sm text-[#F3F4F6] placeholder:text-[#6B7280] focus:outline-none transition-all"
                                    />
                                    {server && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setServer('');
                                                setBrokerSearchQuery('');
                                            }}
                                            title="Limpar servidor"
                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#F3F4F6] p-1 rounded-lg transition-colors"
                                        >
                                            <X size={14} />
                                        </button>
                                    )}
                                </div>

                                <button
                                    type="button"
                                    onClick={() => {
                                        setBrokerSearchQuery('');
                                        setIsServerDropdownOpen(true);
                                    }}
                                    className={`px-4 py-3 sm:py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 shrink-0 transition-all shadow-lg ${
                                        isServerDropdownOpen
                                            ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 ring-2 ring-emerald-500/20'
                                            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 hover:border-emerald-500/50'
                                    }`}
                                >
                                    <Building2 size={15} className="text-emerald-400" />
                                    <span>Corretoras &amp; Servidores ({MT5_BROKERS_CATALOG.length})</span>
                                    <ChevronDown size={15} className={`transition-transform duration-200 ${isServerDropdownOpen ? 'rotate-180 text-emerald-400' : ''}`} />
                                </button>
                            </div>

                            {/* Modal Responsivo em Destaque Acima de Todas as Divs */}
                            {isServerDropdownOpen && typeof document !== 'undefined' && createPortal(
                                <div
                                    className="fixed inset-0 z-[9999] flex items-center justify-center p-2 sm:p-4 md:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-150"
                                    onClick={() => setIsServerDropdownOpen(false)}
                                >
                                    <div
                                        className="relative w-full max-w-4xl max-h-[92vh] sm:max-h-[88vh] flex flex-col bg-[#0D0F14] border border-emerald-500/30 rounded-2xl shadow-[0_25px_70px_rgba(0,0,0,0.85)] overflow-hidden animate-in zoom-in-95 duration-150"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        {/* Cabeçalho do Modal */}
                                        <div className="px-4 sm:px-6 py-4 bg-gradient-to-r from-emerald-500/10 via-[#111319] to-[#111319] border-b border-white/[0.08] flex items-center justify-between gap-3 shrink-0">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                                                    <Building2 size={20} />
                                                </div>
                                                <div className="min-w-0">
                                                    <h3 className="text-sm sm:text-base font-bold text-slate-100 truncate">
                                                        Selecionar Corretora &amp; Servidor MT5
                                                    </h3>
                                                    <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                                                        Escolha um servidor oficial abaixo ou pesquise pelo nome da sua corretora
                                                    </p>
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setIsServerDropdownOpen(false)}
                                                className="p-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 hover:text-white border border-white/[0.08] transition-colors shrink-0"
                                                title="Fechar modal"
                                            >
                                                <X size={18} />
                                            </button>
                                        </div>

                                        {/* Barra de Busca e Filtros no Topo do Modal */}
                                        <div className="p-3.5 sm:p-4 bg-[#111319] border-b border-white/[0.08] space-y-3 shrink-0">
                                            <div className="flex flex-col sm:flex-row gap-2">
                                                {/* Input de busca rápida */}
                                                <div className="relative flex-1">
                                                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                                                    <input
                                                        type="text"
                                                        autoFocus
                                                        placeholder="Buscar corretora ou servidor (ex: Deriv, Exness, XM, FTMO, IC Markets)..."
                                                        value={brokerSearchQuery}
                                                        onChange={(e) => setBrokerSearchQuery(e.target.value)}
                                                        className="w-full bg-[#08090C] border border-white/[0.1] focus:border-emerald-500/60 rounded-xl py-2.5 pl-9 pr-8 text-xs sm:text-sm text-[#F3F4F6] placeholder:text-[#6B7280] focus:outline-none"
                                                    />
                                                    {brokerSearchQuery && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setBrokerSearchQuery('')}
                                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-white"
                                                        >
                                                            <X size={14} />
                                                        </button>
                                                    )}
                                                </div>

                                                {/* Select para listar todas as corretoras diretamente */}
                                                <select
                                                    value={selectedBrokerFilter}
                                                    onChange={(e) => setSelectedBrokerFilter(e.target.value)}
                                                    className="bg-[#08090C] border border-white/[0.1] focus:border-emerald-500/60 rounded-xl py-2.5 px-3 text-xs sm:text-sm text-[#F3F4F6] focus:outline-none sm:w-64"
                                                >
                                                    <option value="ALL">Todas as Corretoras ({MT5_BROKERS_CATALOG.length})</option>
                                                    <optgroup label="Categorias">
                                                        <option value="Deriv">Somente Deriv</option>
                                                        <option value="Forex / ECN">Corretoras Forex / ECN</option>
                                                        <option value="Prop Firm">Prop Firms (Mesas Proprietárias)</option>
                                                        <option value="MetaQuotes">MetaQuotes Oficial</option>
                                                    </optgroup>
                                                    <optgroup label="Lista Completa de Corretoras">
                                                        {MT5_BROKERS_CATALOG.map((b) => (
                                                            <option key={b.id} value={b.id}>
                                                                {b.broker} ({b.servers.length} servidores)
                                                            </option>
                                                        ))}
                                                    </optgroup>
                                                </select>
                                            </div>

                                            {/* Pílulas de Filtro Rápido (Ambiente + Categorias) */}
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    {[
                                                        { id: 'ALL', label: 'Todas' },
                                                        { id: 'Deriv', label: 'Deriv' },
                                                        { id: 'Forex / ECN', label: 'Forex / ECN' },
                                                        { id: 'Prop Firm', label: 'Prop Firms' },
                                                    ].map((tab) => (
                                                        <button
                                                            key={tab.id}
                                                            type="button"
                                                            onClick={() => setSelectedBrokerFilter(tab.id)}
                                                            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                                                                selectedBrokerFilter === tab.id
                                                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                                                    : 'bg-[#08090C] text-[#9CA3AF] hover:text-white border border-white/[0.06]'
                                                            }`}
                                                        >
                                                            {tab.label}
                                                        </button>
                                                    ))}
                                                </div>

                                                <div className="flex items-center gap-1 bg-[#08090C] p-0.5 rounded-lg border border-white/[0.06]">
                                                    {(['ALL', 'DEMO', 'REAL'] as const).map((env) => (
                                                        <button
                                                            key={env}
                                                            type="button"
                                                            onClick={() => setSelectedEnvFilter(env)}
                                                            className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-colors ${
                                                                selectedEnvFilter === env
                                                                    ? env === 'DEMO'
                                                                        ? 'bg-cyan-500/20 text-cyan-300'
                                                                        : env === 'REAL'
                                                                            ? 'bg-emerald-500/20 text-emerald-300'
                                                                            : 'bg-white/10 text-white'
                                                                    : 'text-[#6B7280] hover:text-slate-300'
                                                            }`}
                                                        >
                                                            {env === 'ALL' ? 'DEMO + REAL' : env}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Opção de usar valor digitado manualmente caso seja customizado */}
                                        {(brokerSearchQuery.trim() || server.trim()) && (
                                            <div className="px-4 py-2.5 bg-indigo-500/10 border-b border-indigo-500/20 flex items-center justify-between gap-2 shrink-0">
                                                <span className="text-xs text-indigo-200 truncate">
                                                    Campo livre: <strong>{(brokerSearchQuery.trim() || server.trim())}</strong>
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const customVal = brokerSearchQuery.trim() || server.trim();
                                                        setServer(customVal);
                                                        setIsServerDropdownOpen(false);
                                                    }}
                                                    className="px-3 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 text-[11px] font-semibold shrink-0 transition-colors"
                                                >
                                                    Usar este nome exato
                                                </button>
                                            </div>
                                        )}

                                        {/* Lista Agrupada de Corretoras e Servidores (Responsiva e em Destaque) */}
                                        <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-white/[0.05] custom-scrollbar">
                                            {filteredBrokerGroups.length === 0 ? (
                                                <div className="p-8 text-center space-y-2">
                                                    <p className="text-sm text-slate-300 font-medium">
                                                        Nenhum servidor pré-cadastrado encontrado para &ldquo;{brokerSearchQuery}&rdquo;.
                                                    </p>
                                                    <p className="text-xs text-slate-500">
                                                        Você pode usar o nome digitado acima ou digitar qualquer servidor manualmente.
                                                    </p>
                                                    {brokerSearchQuery.trim() && (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setServer(brokerSearchQuery.trim());
                                                                setIsServerDropdownOpen(false);
                                                            }}
                                                            className="mt-2 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-xs font-semibold"
                                                        >
                                                            <Check size={14} />
                                                            Usar &ldquo;{brokerSearchQuery.trim()}&rdquo; como servidor
                                                        </button>
                                                    )}
                                                </div>
                                            ) : (
                                                filteredBrokerGroups.map((group) => (
                                                    <div key={group.id} className="p-3.5 sm:p-4 hover:bg-white/[0.01]">
                                                        <div className="flex items-center justify-between mb-3 px-1">
                                                            <div className="flex items-center gap-2.5">
                                                                <BrokerLogo broker={group} size="md" />
                                                                <div>
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-xs sm:text-sm font-bold text-slate-100">
                                                                            {group.broker}
                                                                        </span>
                                                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.05] text-slate-400">
                                                                            {group.category}
                                                                        </span>
                                                                    </div>
                                                                    <span className="text-[10px] text-slate-500">
                                                                        {group.domain}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <span className="text-[10px] sm:text-xs font-medium text-slate-400 bg-white/[0.03] px-2.5 py-1 rounded-lg border border-white/[0.05]">
                                                                {group.servers.length} servidor(es)
                                                            </span>
                                                        </div>

                                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                                            {group.servers.map((srv) => {
                                                                const isSelected = server.trim().toLowerCase() === srv.name.toLowerCase();
                                                                return (
                                                                    <button
                                                                        key={srv.name}
                                                                        type="button"
                                                                        onClick={() => {
                                                                            setServer(srv.name);
                                                                            setIsServerDropdownOpen(false);
                                                                        }}
                                                                        className={`text-left px-3 py-2.5 rounded-xl border transition-all flex items-center justify-between gap-2.5 ${
                                                                            isSelected
                                                                                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 shadow-sm'
                                                                                : 'bg-[#111319] border-white/[0.05] hover:border-emerald-500/30 hover:bg-[#161922] text-slate-200'
                                                                        }`}
                                                                    >
                                                                        <div className="flex items-center gap-2.5 min-w-0">
                                                                            <BrokerLogo broker={group} size="sm" />
                                                                            <div className="min-w-0">
                                                                                <div className="flex items-center gap-1.5">
                                                                                    <span className="text-xs font-mono font-semibold truncate">
                                                                                        {srv.name}
                                                                                    </span>
                                                                                    {isSelected && <Check size={13} className="text-emerald-400 shrink-0" />}
                                                                                </div>
                                                                                {srv.description && (
                                                                                    <p className="text-[10px] text-slate-400 truncate mt-0.5">
                                                                                        {srv.description}
                                                                                    </p>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                        <span
                                                                            className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                                                                                srv.env === 'DEMO'
                                                                                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/25'
                                                                                    : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25'
                                                                            }`}
                                                                        >
                                                                            {srv.env}
                                                                        </span>
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                </div>,
                                document.body
                            )}
                        </div>
                    </div>

                    {/* Banner de Confirmação Solicitação Enviada */}
                    {requestFeedback && (
                        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-3">
                            <CheckCircle size={20} className="text-emerald-400 shrink-0 mt-0.5" />
                            <div className="space-y-1 flex-1">
                                <p className="text-sm font-semibold text-emerald-300">
                                    {requestFeedback}
                                </p>
                                <p className="text-xs text-emerald-200/80">
                                    Sincronização automática ativa {lastUpdatedAt ? `(atualizado às ${lastUpdatedAt})` : ''}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Status Dinâmico em Tempo Real */}
                    {status && (
                        <div className={`p-4 rounded-xl flex items-center justify-between gap-3 text-sm ${
                            status.type === 'success'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : status.type === 'info'
                                    ? 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/20'
                                    : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        }`}>
                            <div className="flex items-center gap-3">
                                {status.type === 'success' ? (
                                    <CheckCircle size={18} className="shrink-0" />
                                ) : status.type === 'info' ? (
                                    <Activity size={18} className="shrink-0 animate-pulse" />
                                ) : (
                                    <AlertTriangle size={18} className="shrink-0" />
                                )}
                                <span>{status.message}</span>
                            </div>
                            <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full shrink-0 ${connectionBadge.className}`}>
                                {connectionBadge.label}
                            </span>
                        </div>
                    )}

                    {/* Pipeline Visual de 4 Etapas */}
                    {(requestFeedback || activeTask || acc?.mt5Id) && (
                        <div className="p-4 rounded-xl bg-[#08090C] border border-white/[0.06] space-y-3">
                            <div className="flex items-center justify-between text-xs text-slate-400">
                                <span className="font-semibold text-slate-200">Progresso da Conexão</span>
                                <span>{worker?.isOnline ? 'Serviço Online' : 'Conectando...'}</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
                                <div className={`p-2.5 rounded-lg border ${step1Done ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-[#111319] border-white/[0.05] text-slate-500'}`}>
                                    <span className="font-bold block">1. Solicitação</span>
                                    <span>{step1Done ? 'Recebida' : 'Aguardando envio'}</span>
                                </div>
                                <div className={`p-2.5 rounded-lg border ${step2Done ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : step1Done ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300 animate-pulse' : 'bg-[#111319] border-white/[0.05] text-slate-500'}`}>
                                    <span className="font-bold block">2. Processamento</span>
                                    <span>{step2Done ? 'Em andamento' : 'Iniciando...'}</span>
                                </div>
                                <div className={`p-2.5 rounded-lg border ${step3Failed ? 'bg-rose-500/15 border-rose-500/30 text-rose-300' : step3Done ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : step2Done ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300 animate-pulse' : 'bg-[#111319] border-white/[0.05] text-slate-500'}`}>
                                    <span className="font-bold block">3. Conta MT5</span>
                                    <span>{step3Failed ? 'Dados incorretos' : step3Done ? 'Conta conectada' : 'Verificando...'}</span>
                                </div>
                                <div className={`p-2.5 rounded-lg border ${step4Done ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : step3Done ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300 animate-pulse' : 'bg-[#111319] border-white/[0.05] text-slate-500'}`}>
                                    <span className="font-bold block">4. Operações</span>
                                    <span>{step4Done ? `${totalTradesCount} trade(s) importado(s)` : 'Importando...'}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    <Button
                        variant="gradient"
                        className="w-full py-6 text-base"
                        onClick={handleConnect}
                        isLoading={isLoading || !!activeTaskId}
                        disabled={!login || !password || !server || isLoading || !!activeTaskId}
                        icon={<Power size={18} />}
                    >
                        {activeTaskId ? 'Conectando e Importando Operações...' : 'Conectar e Sincronizar Agora'}
                    </Button>
                </div>
            </Card>

            {/* Painel de Status da Conexão e Métricas da Conta MT5 */}
            {acc && acc.mt5Id && (
                <Card className="p-6 bg-[#111319] border-white/[0.08] shadow-xl">
                    <div className="flex flex-wrap items-center justify-between gap-4 pb-4 mb-4 border-b border-white/[0.06]">
                        <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                                isAccConnected
                                    ? 'bg-emerald-500/15 text-emerald-400'
                                    : 'bg-slate-800 text-slate-400'
                            }`}>
                                <Server size={20} />
                            </div>
                            <div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="font-bold text-slate-100">
                                        Conta #{acc.mt5Id}
                                    </h3>
                                    <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${connectionBadge.className}`}>
                                        {connectionBadge.label}
                                    </span>
                                    {acc.tradeMode && (
                                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                                            {acc.tradeMode}
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    {acc.company || acc.server || acc.broker}
                                    {acc.accountHolderName ? ` • ${acc.accountHolderName}` : ''}
                                </p>
                                {acc.statusMessage && (
                                    <p className="text-xs text-indigo-300 mt-1">
                                        {acc.statusMessage}
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <Button
                                variant="secondary"
                                className="text-xs px-3 py-2"
                                onClick={() => handleForceSync(false)}
                                isLoading={isSyncing}
                                icon={<RefreshCw size={14} />}
                            >
                                Atualizar Agora
                            </Button>
                            {isAccConnected && (
                                <Button
                                    variant="secondary"
                                    className="text-xs px-3 py-2 text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
                                    onClick={handleDisconnect}
                                    icon={<LogOut size={14} />}
                                >
                                    Desconectar
                                </Button>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                        <div className="p-3 rounded-xl bg-[#08090C] border border-white/[0.05]">
                            <span className="text-xs text-slate-400 block">Saldo</span>
                            <span className="font-bold text-slate-100 text-base">
                                {acc.currency || 'USD'} {Number(acc.balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </span>
                        </div>
                        <div className="p-3 rounded-xl bg-[#08090C] border border-white/[0.05]">
                            <span className="text-xs text-slate-400 block">Patrimônio (Equity)</span>
                            <span className="font-bold text-emerald-400 text-base">
                                {acc.currency || 'USD'} {Number(acc.equity || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </span>
                        </div>
                        <div className="p-3 rounded-xl bg-[#08090C] border border-white/[0.05]">
                            <span className="text-xs text-slate-400 block">Trades Importados</span>
                            <span className="font-bold text-indigo-400 text-base">
                                {totalTradesCount} operações
                            </span>
                        </div>
                        <div className="p-3 rounded-xl bg-[#08090C] border border-white/[0.05]">
                            <span className="text-xs text-slate-400 block">Posições em Aberto</span>
                            <span className="font-bold text-slate-100 text-base">
                                {acc.openPositionsCount ?? 0} ativas
                            </span>
                        </div>
                    </div>

                    {acc.lastSyncAt && (
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                            <span>Última atualização: {new Date(acc.lastSyncAt).toLocaleString()}</span>
                            <button
                                onClick={() => handleForceSync(true)}
                                className="text-indigo-400 hover:underline"
                            >
                                Reimportar histórico completo
                            </button>
                        </div>
                    )}
                </Card>
            )}

            {/* Painel de Trades Importados da Conta */}
            {acc && acc.mt5Id && (
                <Card className="p-6 bg-[#111319] border-white/[0.08] shadow-xl">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2.5">
                            <FileCheck size={18} className="text-emerald-400" />
                            <h3 className="text-base font-bold text-slate-100">
                                Operações Sincronizadas ({totalTradesCount})
                            </h3>
                        </div>
                        <span className="text-xs text-slate-400">
                            Conta #{acc.mt5Id}
                        </span>
                    </div>

                    {recentTrades.length === 0 ? (
                        <div className="p-6 text-center rounded-xl bg-[#08090C] border border-white/[0.05] text-slate-400 text-sm">
                            Nenhuma operação fechada encontrada nesta conta até o momento. Assim que novas operações forem encerradas, elas aparecerão aqui automaticamente.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                    <tr className="border-b border-white/[0.06] text-slate-400 uppercase">
                                        <th className="py-2.5 px-3">Ticket</th>
                                        <th className="py-2.5 px-3">Ativo</th>
                                        <th className="py-2.5 px-3">Tipo</th>
                                        <th className="py-2.5 px-3">Volume</th>
                                        <th className="py-2.5 px-3">Preço</th>
                                        <th className="py-2.5 px-3">Data Fechamento</th>
                                        <th className="py-2.5 px-3 text-right">Resultado</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/[0.04]">
                                    {recentTrades.map((trade: any) => {
                                        const pnl = Number(trade.netPnl ?? trade.profit ?? 0);
                                        const isWin = pnl >= 0;
                                        return (
                                            <tr key={trade.id || trade.ticket} className="hover:bg-white/[0.02]">
                                                <td className="py-2.5 px-3 font-mono text-slate-300">
                                                    #{trade.ticket || trade.contractId}
                                                </td>
                                                <td className="py-2.5 px-3 font-bold text-slate-100">
                                                    {trade.symbol}
                                                </td>
                                                <td className="py-2.5 px-3">
                                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-semibold ${
                                                        (trade.type || '').toUpperCase().includes('BUY')
                                                            ? 'bg-emerald-500/15 text-emerald-400'
                                                            : 'bg-rose-500/15 text-rose-400'
                                                    }`}>
                                                        {(trade.type || '').toUpperCase().includes('BUY') ? (
                                                            <TrendingUp size={11} />
                                                        ) : (
                                                            <TrendingDown size={11} />
                                                        )}
                                                        {trade.type}
                                                    </span>
                                                </td>
                                                <td className="py-2.5 px-3 text-slate-300">
                                                    {Number(trade.volume || 0).toFixed(2)}
                                                </td>
                                                <td className="py-2.5 px-3 font-mono text-slate-400">
                                                    {Number(trade.openPrice || 0)} → {Number(trade.closePrice || 0)}
                                                </td>
                                                <td className="py-2.5 px-3 text-slate-400">
                                                    {trade.closeTime
                                                        ? new Date(trade.closeTime).toLocaleString()
                                                        : trade.openTime
                                                            ? new Date(trade.openTime).toLocaleString()
                                                            : '-'}
                                                </td>
                                                <td className={`py-2.5 px-3 text-right font-bold ${
                                                    isWin ? 'text-emerald-400' : 'text-rose-400'
                                                }`}>
                                                    {isWin ? '+' : ''}{pnl.toFixed(2)} {acc.currency || 'USD'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Card>
            )}

            {/* Histórico de Sincronização (Sem termos técnicos) */}
            {(auditLogs.length > 0 || recentEvents.length > 0) && (
                <Card className="p-6 bg-[#111319] border-white/[0.08] shadow-xl">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2.5">
                            <Clock size={18} className="text-indigo-400" />
                            <h3 className="text-base font-bold text-slate-100">
                                Histórico de Sincronização
                            </h3>
                        </div>
                        <span className="text-xs text-slate-400">
                            Atividades recentes
                        </span>
                    </div>

                    <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                        {recentEvents.map((ev: any) => (
                            <div
                                key={ev.id}
                                className="flex items-start justify-between gap-3 p-3 rounded-xl bg-[#08090C] border border-white/[0.05] text-xs"
                            >
                                <div className="space-y-0.5">
                                    <div className="flex items-center gap-2">
                                        <span className={`px-2 py-0.5 rounded font-semibold text-[10px] ${
                                            ev.severity === 'ERROR'
                                                ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                                                : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                        }`}>
                                            {ev.severity === 'ERROR' ? 'Atenção' : 'Conectado'}
                                        </span>
                                    </div>
                                    <p className="text-slate-300 mt-1">{ev.message}</p>
                                </div>
                                <span className="text-slate-500 shrink-0 text-[11px]">
                                    {new Date(ev.timestamp).toLocaleTimeString()}
                                </span>
                            </div>
                        ))}

                        {auditLogs.map((log: any) => (
                            <div
                                key={`audit-${log.id}`}
                                className="flex items-start justify-between gap-3 p-3 rounded-xl bg-[#08090C] border border-white/[0.05] text-xs"
                            >
                                <div className="space-y-0.5">
                                    <div className="flex items-center gap-2">
                                        <span className={`px-2 py-0.5 rounded font-semibold text-[10px] ${
                                            log.status === 'SUCCESS'
                                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                                : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                                        }`}>
                                            {log.status === 'SUCCESS' ? 'Sincronizado' : 'Falha'}
                                        </span>
                                        {log.tradesCount > 0 && (
                                            <span className="text-slate-400 font-medium">
                                                {log.tradesCount} {log.tradesCount === 1 ? 'nova operação' : 'novas operações'}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-slate-300 mt-1">
                                        {log.details || log.errorDetails || log.fileName || 'Sincronização automática concluída'}
                                    </p>
                                </div>
                                <span className="text-slate-500 shrink-0 text-[11px]">
                                    {new Date(log.createdAt).toLocaleString()}
                                </span>
                            </div>
                        ))}
                    </div>
                </Card>
            )}
        </div>
    );
};
