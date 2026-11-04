import { useState, useEffect, useRef } from 'react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
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
    Clock
} from 'lucide-react';
import api from '../../api';
import { useAccount } from '../../context/AccountContext';

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
    const [isLoading, setIsLoading] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [requestFeedback, setRequestFeedback] = useState<string | null>(null);
    const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
    const [cloudState, setCloudState] = useState<any>(null);
    const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
    const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
    const pollTimerRef = useRef<any>(null);

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
                        message: task.message || `Worker processando conexão para ${targetLogin}...`
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
            message: 'Enviando solicitação de conexão ao servidor Windows MT5...'
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
                'Solicitação de conexão enviada com sucesso! O worker está iniciando a sincronização.';
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
        const syncMsg = 'Solicitação de conexão enviada com sucesso! O worker está iniciando a sincronização.';
        setRequestFeedback(syncMsg);
        setStatus({
            type: 'info',
            message: forceFull
                ? 'Solicitando sincronização completa de histórico ao servidor Windows...'
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
                message: `Monitoramento da conta ${targetLogin} desconectado.`
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
                label: 'FALHA DE AUTENTICAÇÃO',
                className: 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
            };
        }
        return {
            label: 'DESCONECTADO',
            className: 'bg-slate-500/15 text-slate-400 border border-slate-500/30'
        };
    };

    const connectionBadge = getConnectionBadge();

    // Cálculo das 4 etapas visuais de comunicação bidirecional
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

                {/* Status do Worker Windows em Tempo Real */}
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${
                    worker?.isOnline
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                }`}>
                    {worker?.isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
                    <span>
                        {worker?.isOnline
                            ? `Servidor MT5 Online (${worker.workerId || 'VPS'} • CPU ${worker.cpuPercent ?? 0}%)`
                            : 'Aguardando Servidor Windows MT5...'}
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
                            Insira as credenciais para o servidor Windows MT5 autenticar e sincronizar em tempo real.
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
                        Suas credenciais são transmitidas via token único temporário e criptografadas no cofre da VPS.
                    </p>

                    <Input
                        label="Servidor da Corretora"
                        placeholder="Ex: Deriv-Demo, Deriv-Server, Exness-MT5Real"
                        value={server}
                        onChange={(e) => setServer(e.target.value)}
                        className="bg-[#08090C] border-white/[0.08]"
                    />

                    {/* Banner de Confirmação Exata Solicitação Enviada */}
                    {requestFeedback && (
                        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-3">
                            <CheckCircle size={20} className="text-emerald-400 shrink-0 mt-0.5" />
                            <div className="space-y-1 flex-1">
                                <p className="text-sm font-semibold text-emerald-300">
                                    {requestFeedback}
                                </p>
                                <p className="text-xs text-emerald-200/80">
                                    Comunicação bidirecional ativa {lastUpdatedAt ? `(última leitura: ${lastUpdatedAt})` : ''}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Status Dinâmico em Tempo Real do Worker */}
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

                    {/* Pipeline Visual Bidirecional de 4 Etapas */}
                    {(requestFeedback || activeTask || acc?.mt5Id) && (
                        <div className="p-4 rounded-xl bg-[#08090C] border border-white/[0.06] space-y-3">
                            <div className="flex items-center justify-between text-xs text-slate-400">
                                <span className="font-semibold text-slate-200">Progresso da Comunicação Bidirecional</span>
                                <span>Worker: {worker?.isOnline ? 'CONECTADO' : 'AGUARDANDO VPS'}</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
                                <div className={`p-2.5 rounded-lg border ${step1Done ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-[#111319] border-white/[0.05] text-slate-500'}`}>
                                    <span className="font-bold block">1. Backend Linux</span>
                                    <span>{step1Done ? 'Solicitação registrada' : 'Aguardando envio'}</span>
                                </div>
                                <div className={`p-2.5 rounded-lg border ${step2Done ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : step1Done ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300 animate-pulse' : 'bg-[#111319] border-white/[0.05] text-slate-500'}`}>
                                    <span className="font-bold block">2. Worker Windows</span>
                                    <span>{step2Done ? 'Tarefa recebida' : 'Aguardando Worker...'}</span>
                                </div>
                                <div className={`p-2.5 rounded-lg border ${step3Failed ? 'bg-rose-500/15 border-rose-500/30 text-rose-300' : step3Done ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : step2Done ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300 animate-pulse' : 'bg-[#111319] border-white/[0.05] text-slate-500'}`}>
                                    <span className="font-bold block">3. Login no MT5</span>
                                    <span>{step3Failed ? 'Falha de login' : step3Done ? 'Conta autenticada' : 'Autenticando...'}</span>
                                </div>
                                <div className={`p-2.5 rounded-lg border ${step4Done ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : step3Done ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300 animate-pulse' : 'bg-[#111319] border-white/[0.05] text-slate-500'}`}>
                                    <span className="font-bold block">4. Dados &amp; Trades</span>
                                    <span>{step4Done ? `${totalTradesCount} trade(s) no histórico` : 'Sincronizando...'}</span>
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
                        {activeTaskId ? 'Autenticando e Sincronizando na VPS...' : 'Conectar e Sincronizar Agora'}
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
                                        MT5 #{acc.mt5Id}
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
                                    {acc.pingMs ? ` • Ping: ${acc.pingMs} ms` : ''}
                                </p>
                                {acc.statusMessage && (
                                    <p className="text-xs text-indigo-300 mt-1">
                                        Status: {acc.statusMessage}
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
                                Sincronizar Agora
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
                            <span className="text-xs text-slate-400 block">Saldo (Balance)</span>
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
                            <span className="text-xs text-slate-400 block">Posições Abertas</span>
                            <span className="font-bold text-slate-100 text-base">
                                {acc.openPositionsCount ?? 0} ativas
                            </span>
                        </div>
                    </div>

                    {acc.lastSyncAt && (
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                            <span>Última sincronização com a VPS: {new Date(acc.lastSyncAt).toLocaleString()}</span>
                            <button
                                onClick={() => handleForceSync(true)}
                                className="text-indigo-400 hover:underline"
                            >
                                Forçar reimportação completa de histórico
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
                                Trades Importados ({totalTradesCount})
                            </h3>
                        </div>
                        <span className="text-xs text-slate-400">
                            Conta MT5 #{acc.mt5Id}
                        </span>
                    </div>

                    {recentTrades.length === 0 ? (
                        <div className="p-6 text-center rounded-xl bg-[#08090C] border border-white/[0.05] text-slate-400 text-sm">
                            Nenhum trade fechado encontrado no histórico desta conta MT5 até o momento. Assim que novas operações forem realizadas no MT5, elas serão importadas automaticamente.
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
                                        <th className="py-2.5 px-3 text-right">Resultado (P&amp;L)</th>
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

            {/* Logs de Auditoria de Conexão e Sincronização (Backend Audit Trail) */}
            {(auditLogs.length > 0 || recentEvents.length > 0) && (
                <Card className="p-6 bg-[#111319] border-white/[0.08] shadow-xl">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2.5">
                            <Clock size={18} className="text-indigo-400" />
                            <h3 className="text-base font-bold text-slate-100">
                                Logs de Auditoria da Conexão MT5
                            </h3>
                        </div>
                        <span className="text-xs text-slate-400">
                            Registros do Backend &amp; Worker
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
                                                : 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30'
                                        }`}>
                                            {ev.eventType}
                                        </span>
                                        <span className="text-slate-500 font-mono text-[11px]">
                                            [{ev.workerId}]
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
                                            AUDITORIA DB • {log.status === 'SUCCESS' ? 'SUCESSO' : 'FALHA'}
                                        </span>
                                        <span className="text-slate-400 font-medium">
                                            {log.tradesCount} novos trades
                                        </span>
                                    </div>
                                    <p className="text-slate-300 mt-1">
                                        {log.details || log.errorDetails || log.fileName || `Sincronização automática (${log.method})`}
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
