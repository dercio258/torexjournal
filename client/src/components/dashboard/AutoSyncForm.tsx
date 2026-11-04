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
    LogOut
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
    const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
    const [cloudState, setCloudState] = useState<any>(null);
    const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
    const pollTimerRef = useRef<any>(null);

    const fetchCloudStatus = async (overrideLogin?: string) => {
        try {
            const params: Record<string, string> = {};
            if (selectedAccountId) params.accountId = selectedAccountId;
            if (overrideLogin || login) params.login = overrideLogin || login;
            const res = await api.get('/mt5/cloud/status', { params });
            setCloudState(res.data);

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
        }, 10000);
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
                if (res.data?.account || res.data?.worker) {
                    setCloudState((prev: any) => ({
                        ...(prev || {}),
                        account: res.data.account || prev?.account,
                        worker: res.data.worker || prev?.worker,
                        activeTask: task,
                    }));
                }

                if (!task) return;

                if (task.status === 'IN_PROGRESS' || task.status === 'RECEIVED') {
                    setStatus({
                        type: 'info',
                        message: task.message || `Autenticando conta ${targetLogin} no servidor MT5...`
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
                }
            } catch (err) {
                // Keep polling on transient error
            }
        }, 2000);
    };

    const handleConnect = async () => {
        if (!login || !password || !server) return;

        setIsLoading(true);
        setStatus({
            type: 'info',
            message: 'Enviando credenciais seguras ao servidor Windows MT5...'
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

            setStatus({
                type: 'info',
                message: res.data?.message || 'O servidor Windows está inicializando o MT5 e autenticando sua conta...'
            });

            if (res.data?.taskId) {
                startTaskPolling(res.data.taskId, login.trim());
            } else {
                setIsLoading(false);
                await fetchCloudStatus(login.trim());
                if (refreshAccounts) await refreshAccounts();
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
        setStatus({
            type: 'info',
            message: forceFull
                ? 'Solicitando sincronização completa de histórico ao servidor Windows...'
                : 'Solicitando atualização imediata de saldo, posições e trades...'
        });

        try {
            const res = await api.post('/mt5/cloud/sync', {
                login: targetLogin,
                accountId: cloudState?.account?.id || selectedAccountId,
                forceFull
            });
            if (res.data?.taskId) {
                startTaskPolling(res.data.taskId, targetLogin);
            } else {
                setIsSyncing(false);
                await fetchCloudStatus(targetLogin);
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
    const isAccConnected = acc?.isConnected || acc?.connectionState === 'CONNECTED';

    return (
        <div className="max-w-2xl mx-auto animate-in fade-in slide-in-from-right-4 space-y-6">
            <div className="flex items-center justify-between">
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

            {/* Painel de Status da Conta Conectada */}
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
                                <div className="flex items-center gap-2">
                                    <h3 className="font-bold text-slate-100">
                                        MT5 #{acc.mt5Id}
                                    </h3>
                                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                                        isAccConnected
                                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                            : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                                    }`}>
                                        {isAccConnected ? 'CONECTADO' : (acc.connectionState || 'DESCONECTADO')}
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
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                className="text-xs px-3 py-2"
                                onClick={() => handleForceSync(false)}
                                isLoading={isSyncing}
                                icon={<RefreshCw size={14} />}
                            >
                                Sincronizar Agora
                            </Button>
                            {isAccConnected && (
                                <Button
                                    variant="outline"
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
                            <span className="text-xs text-slate-400 block">Alavancagem / Margem</span>
                            <span className="font-bold text-slate-100 text-base">
                                1:{acc.leverage || 100}
                            </span>
                        </div>
                        <div className="p-3 rounded-xl bg-[#08090C] border border-white/[0.05]">
                            <span className="text-xs text-slate-400 block">Posições Abertas</span>
                            <span className="font-bold text-indigo-400 text-base">
                                {acc.openPositionsCount ?? 0} ativas
                            </span>
                        </div>
                    </div>

                    {acc.lastSyncAt && (
                        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
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

                    {status && (
                        <div className={`p-4 rounded-lg flex items-center gap-3 text-sm ${
                            status.type === 'success'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : status.type === 'info'
                                    ? 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/20'
                                    : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        }`}>
                            {status.type === 'success' ? (
                                <CheckCircle size={18} className="shrink-0" />
                            ) : status.type === 'info' ? (
                                <Activity size={18} className="shrink-0 animate-pulse" />
                            ) : (
                                <AlertTriangle size={18} className="shrink-0" />
                            )}
                            <span>{status.message}</span>
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
        </div>
    );
};
