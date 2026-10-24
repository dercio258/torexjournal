import { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { BrokerSelector } from '../components/dashboard/BrokerSelector';
import { AutoSyncForm } from '../components/dashboard/AutoSyncForm';
import { ManualImportForm } from '../components/dashboard/ManualImportForm';
import { ImportHistory } from '../components/dashboard/ImportHistory';
import { 
    Copy, 
    Terminal, 
    Cloud, 
    FileText, 
    Lock, 
    RefreshCw, 
    CheckCircle2, 
    AlertCircle, 
    ExternalLink, 
    Eye, 
    EyeOff, 
    ShieldCheck, 
    Zap 
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import api from '../api';
import { PlanModal } from '../components/dashboard/PlanModal';

export const AddTrades = () => {
    const { user } = useAuth();
    const { selectedAccountId, selectedAccount, openManageModal, refreshAccounts } = useAccount();
    const [step, setStep] = useState<'SELECT' | 'CONNECT_MT_CLOUD' | 'CONNECT_MT_OPTIONS' | 'CONNECT_MT_EA' | 'CONNECT_DERIV' | 'CONNECT_MANUAL' | 'CONNECT_MANUAL_MT'>('SELECT');
    const [mtVersion] = useState<'4' | '5'>('5');
    const [appToken, setAppToken] = useState<string | null>(null);
    const [showDevModal, setShowDevModal] = useState(false);

    // Deriv Integration States
    const [derivStatus, setDerivStatus] = useState<{
        isConnected: boolean;
        isStreaming: boolean;
        accountId: string | null;
        currency: string | null;
        balance: number;
        equity: number;
        accountName: string | null;
        lastSyncAt: string | null;
    } | null>(null);
    const [isDerivLoading, setIsDerivLoading] = useState(false);
    const [isDerivConnecting, setIsDerivConnecting] = useState(false);
    const [isDerivSyncing, setIsDerivSyncing] = useState(false);
    const [derivTokenInput, setDerivTokenInput] = useState('');
    const [showDerivToken, setShowDerivToken] = useState(false);
    const [derivMessage, setDerivMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const fetchDerivStatus = async () => {
        setIsDerivLoading(true);
        try {
            const res = await api.get('/integrations/deriv/status');
            setDerivStatus(res.data);
        } catch (err) {
            console.error('Failed to fetch Deriv status', err);
        } finally {
            setIsDerivLoading(false);
        }
    };

    useEffect(() => {
        if (step === 'CONNECT_DERIV') {
            fetchDerivStatus();
        }
    }, [step]);

    useEffect(() => {
        const fetchToken = async () => {
            try {
                const params: any = {};
                if (selectedAccountId) {
                    params.accountId = selectedAccountId;
                }
                const res = await api.get('/auth/app-token', { params });
                if (res.data?.token) {
                    setAppToken(res.data.token);
                    return;
                }
            } catch (e) {
                // Fallback to selectedAccount.appToken
            }
            if (selectedAccount?.appToken) {
                setAppToken(selectedAccount.appToken);
            } else {
                setAppToken(user?.id ? `ea-${user.id.substring(0, 8)}` : 'Loading...');
            }
        };
        fetchToken();
    }, [user, selectedAccountId, selectedAccount]);

    const [showUpgradeModal, setShowUpgradeModal] = useState(false);
    const [upgradeFeature, setUpgradeFeature] = useState('');

    const handleSelectBroker = (broker: any) => {
        if (broker.id === 'deriv') {
            setStep('CONNECT_DERIV');
            return;
        }
        if (broker.id === 'mt5') {
            setStep('CONNECT_MT_OPTIONS');
            return;
        }
        if (broker.id === 'mt4') {
            setUpgradeFeature('MetaTrader 4 Cloud');
            setShowDevModal(true);
            return;
        }
        setStep('CONNECT_MANUAL');
    };

    const handleDerivConnect = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!derivTokenInput.trim()) {
            setDerivMessage({ type: 'error', text: 'Por favor, insira o seu Personal Access Token da Deriv.' });
            return;
        }

        setIsDerivConnecting(true);
        setDerivMessage(null);

        try {
            const res = await api.post('/integrations/deriv/connect', { token: derivTokenInput.trim() });
            setDerivMessage({ type: 'success', text: `Conta Deriv (${res.data.account}) conectada com sucesso!` });
            setDerivTokenInput('');
            await fetchDerivStatus();
            await refreshAccounts();
        } catch (err: any) {
            setDerivMessage({ 
                type: 'error', 
                text: err.response?.data?.message || err.message || 'Falha ao conectar com a Deriv. Verifique o seu token.' 
            });
        } finally {
            setIsDerivConnecting(false);
        }
    };

    const handleDerivSync = async () => {
        setIsDerivSyncing(true);
        setDerivMessage(null);
        try {
            await api.post('/integrations/deriv/sync');
            setDerivMessage({ type: 'success', text: 'Sincronização em segundo plano iniciada! Seus trades serão atualizados.' });
            await fetchDerivStatus();
            await refreshAccounts();
        } catch (err: any) {
            setDerivMessage({ 
                type: 'error', 
                text: err.response?.data?.message || err.message || 'Falha ao sincronizar trades com a Deriv.' 
            });
        } finally {
            setIsDerivSyncing(false);
        }
    };

    const handleDerivDisconnect = async () => {
        if (!window.confirm('Tem certeza que deseja desconectar sua conta Deriv do Torex Journal?')) {
            return;
        }
        setIsDerivLoading(true);
        setDerivMessage(null);
        try {
            await api.delete('/integrations/deriv/disconnect');
            setDerivMessage({ type: 'success', text: 'Conta Deriv desconectada com sucesso.' });
            await fetchDerivStatus();
            await refreshAccounts();
        } catch (err: any) {
            setDerivMessage({ 
                type: 'error', 
                text: err.response?.data?.message || err.message || 'Falha ao desconectar conta.' 
            });
        } finally {
            setIsDerivLoading(false);
        }
    };

    const handleBack = () => {
        setStep('SELECT');
    };

    const copyToken = () => {
        if (appToken) {
            navigator.clipboard.writeText(appToken);
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-12">
            <header className="text-center">
                <h1 className="text-3xl font-bold text-slate-100">Adicionar Trades</h1>
                <p className="text-slate-400 mt-2">Conecte sua conta ou importe arquivos para sincronizar seu histórico.</p>
            </header>

            <div className="space-y-12">
                {/* Main Content Flow */}
                <div>
                    {step === 'SELECT' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4">
                            <BrokerSelector onSelect={handleSelectBroker} />
                        </div>
                    )}

                    {step === 'CONNECT_MT_OPTIONS' && (
                        <div className="animate-in fade-in slide-in-from-right-4">
                            <button onClick={handleBack} className="flex items-center gap-2 text-slate-400 hover:text-slate-100 transition-colors mb-6 text-sm">
                                Voltar
                            </button>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <Card className="p-8 cursor-pointer hover:border-indigo-500/50 transition-all group" onClick={() => setStep('CONNECT_MT_EA')}>
                                    <div className="w-16 h-16 bg-indigo-500/10 text-indigo-400 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                        <Terminal size={32} />
                                    </div>
                                    <h3 className="text-xl font-bold text-slate-100 mb-2">Usar Expert Advisor (EA)</h3>
                                    <p className="text-slate-400 text-sm">Obtenha um token exclusivo para conectar nosso EA diretamente no seu MetaTrader {mtVersion} rodando no seu computador ou VPS.</p>
                                </Card>
                                <Card className="p-8 cursor-pointer hover:border-emerald-500/50 transition-all group relative" onClick={() => setStep('CONNECT_MT_CLOUD')}>
                                    <div className="absolute top-4 right-4">
                                        <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                            Disponível
                                        </span>
                                    </div>
                                    <div className="w-16 h-16 bg-emerald-500/10 text-emerald-500 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                        <Cloud size={32} />
                                    </div>
                                    <h3 className="text-xl font-bold text-slate-100 mb-2">Sincronização em Nuvem</h3>
                                    <p className="text-slate-400 text-sm">Insira seus dados de leitura (Senha de Investidor) e nosso servidor fará a conexão com a corretora automaticamente para o MT{mtVersion}.</p>
                                </Card>
                                <Card className="p-8 cursor-pointer hover:border-amber-500/50 transition-all group" onClick={() => setStep('CONNECT_MANUAL_MT')}>
                                    <div className="w-16 h-16 bg-amber-500/10 text-amber-500 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                        <FileText size={32} />
                                    </div>
                                    <h3 className="text-xl font-bold text-slate-100 mb-2">Importar Arquivo</h3>
                                    <p className="text-slate-400 text-sm">Exporte o histórico do seu MT{mtVersion} em formato HTML ou CSV e faça o upload para sincronização das operações.</p>
                                </Card>
                            </div>
                        </div>
                    )}

                    {step === 'CONNECT_MT_EA' && (
                        <div className="animate-in fade-in slide-in-from-right-4 max-w-xl mx-auto">
                            <button onClick={() => setStep('CONNECT_MT_OPTIONS')} className="flex items-center gap-2 text-slate-400 hover:text-slate-100 transition-colors mb-6 text-sm">
                                Voltar as opções
                            </button>
                            <div className="bg-gradient-to-br from-indigo-900/40 to-purple-900/40 border border-indigo-500/30 rounded-3xl p-8 relative overflow-hidden group shadow-2xl">
                                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                    <Terminal size={150} />
                                </div>
                                <h3 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                                    <Terminal className="text-indigo-400" /> Auto-Importação via EA
                                </h3>
                                <p className="text-slate-400 mb-6">Use este token para conectar seu Expert Advisor (EA) no MetaTrader {mtVersion}.</p>

                                {/* Account Scoping Notice */}
                                <div className="bg-indigo-950/40 border border-indigo-500/20 rounded-2xl p-4 mb-6 flex items-center justify-between">
                                    <div>
                                        <span className="text-[11px] uppercase tracking-wider text-indigo-400 font-semibold block">
                                            Conta de Destino do EA
                                        </span>
                                        <p className="text-sm font-bold text-slate-100 mt-0.5">
                                            {selectedAccount?.name || 'Conta Principal'}
                                            <span className="text-xs text-slate-400 font-normal ml-2">
                                                ({selectedAccount?.broker || 'MetaTrader 5'} • {selectedAccount?.currency || 'USD'})
                                            </span>
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => openManageModal('accounts')}
                                        className="text-xs text-indigo-400 hover:text-indigo-300 underline font-medium"
                                    >
                                        Trocar conta
                                    </button>
                                </div>

                                <div className="bg-slate-950/80 rounded-2xl p-6 border border-indigo-500/20 mb-6 backdrop-blur-md">
                                    <span className="text-sm text-slate-500 font-bold uppercase tracking-wider block mb-2">Token Exclusivo da Conta</span>
                                    <div className="flex items-center justify-between gap-4">
                                        <code className="text-indigo-300 font-mono text-xl tracking-widest break-all">{appToken || 'Gerando...'}</code>
                                        <button onClick={copyToken} className="p-3 bg-indigo-500/10 hover:bg-indigo-500/20 rounded-xl text-indigo-400 transition-colors shrink-0" title="Copiar Token">
                                            <Copy size={24} />
                                        </button>
                                    </div>
                                    <p className="text-[11px] text-slate-500 mt-2">
                                        Este token direciona os trades recebidos exclusivamente para esta conta no TorexJournal.
                                    </p>
                                </div>

                                <div className="flex items-center justify-center gap-3 text-sm text-slate-400 bg-slate-900/50 p-4 rounded-xl">
                                    <div className="w-3 h-3 rounded-full bg-indigo-500 animate-pulse"></div>
                                    Aguardando conexão do EA...
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 'CONNECT_MT_CLOUD' && (
                        <AutoSyncForm brokerName={`MetaTrader ${mtVersion}`} onBack={() => setStep('CONNECT_MT_OPTIONS')} />
                    )}

                    {step === 'CONNECT_DERIV' && (
                        <div className="animate-in fade-in slide-in-from-right-4 max-w-2xl mx-auto">
                            <button onClick={handleBack} className="flex items-center gap-2 text-slate-400 hover:text-slate-100 transition-colors mb-6 text-sm">
                                ← Voltar para seleção de corretoras
                            </button>

                            <div className="bg-[#111319] border border-white/[0.08] shadow-2xl rounded-3xl p-8 relative overflow-hidden">
                                {/* Ambient glow */}
                                <div className="absolute -top-24 -right-24 w-64 h-64 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />

                                {/* Header */}
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-white/[0.08]">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center shrink-0">
                                            <img src="https://deriv.com/static/deriv-logo-c97b819f.svg" className="w-7 h-7" alt="Deriv" />
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                                Deriv Autosync
                                            </h3>
                                            <p className="text-xs text-slate-400">Sincronização em tempo real via WebSocket oficial</p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        {derivStatus?.isConnected ? (
                                            <>
                                                <span className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold text-xs rounded-full">
                                                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Conectado
                                                </span>
                                                <span className="flex items-center gap-1 text-[11px] text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-1 rounded-full font-medium">
                                                    <Zap size={11} /> Live Stream
                                                </span>
                                            </>
                                        ) : (
                                            <span className="text-xs font-semibold px-3 py-1 bg-slate-800/80 border border-slate-700/50 text-slate-400 rounded-full">
                                                Desconectado
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Status Feedback Messages */}
                                {derivMessage && (
                                    <div className={`mt-6 p-4 rounded-xl flex items-start gap-3 text-sm animate-in fade-in ${
                                        derivMessage.type === 'success' 
                                            ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300' 
                                            : 'bg-rose-500/10 border border-rose-500/20 text-rose-300'
                                    }`}>
                                        {derivMessage.type === 'success' ? (
                                            <CheckCircle2 size={18} className="shrink-0 mt-0.5 text-emerald-400" />
                                        ) : (
                                            <AlertCircle size={18} className="shrink-0 mt-0.5 text-rose-400" />
                                        )}
                                        <div className="flex-1">{derivMessage.text}</div>
                                    </div>
                                )}

                                {/* Connected View */}
                                {derivStatus?.isConnected ? (
                                    <div className="mt-8 space-y-6">
                                        {/* Account Info Stats */}
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                            <div className="bg-[#0C0D12] border border-white/[0.06] rounded-2xl p-4">
                                                <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold block">Conta Deriv</span>
                                                <span className="text-sm font-bold text-white font-mono mt-1 block">
                                                    {derivStatus.accountId || '—'}
                                                </span>
                                            </div>

                                            <div className="bg-[#0C0D12] border border-white/[0.06] rounded-2xl p-4">
                                                <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold block">Saldo Atual</span>
                                                <span className="text-sm font-bold text-emerald-400 font-mono mt-1 block">
                                                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: derivStatus.currency || 'USD' }).format(derivStatus.balance || 0)}
                                                </span>
                                            </div>

                                            <div className="bg-[#0C0D12] border border-white/[0.06] rounded-2xl p-4">
                                                <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold block">Moeda</span>
                                                <span className="text-sm font-bold text-white mt-1 block">
                                                    {derivStatus.currency || 'USD'}
                                                </span>
                                            </div>

                                            <div className="bg-[#0C0D12] border border-white/[0.06] rounded-2xl p-4">
                                                <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold block">Última Sincronização</span>
                                                <span className="text-[11px] font-medium text-slate-300 mt-1 block truncate" title={derivStatus.lastSyncAt ? new Date(derivStatus.lastSyncAt).toLocaleString() : 'Recente'}>
                                                    {derivStatus.lastSyncAt ? new Date(derivStatus.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recente'}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Actions */}
                                        <div className="space-y-3 pt-2">
                                            <button
                                                onClick={handleDerivSync}
                                                disabled={isDerivSyncing}
                                                className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl transition-all shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 text-sm"
                                            >
                                                <RefreshCw size={16} className={isDerivSyncing ? 'animate-spin' : ''} />
                                                {isDerivSyncing ? 'Sincronizando Operações...' : 'Sincronizar Histórico Agora'}
                                            </button>

                                            <p className="text-[11px] text-center text-slate-500">
                                                Novas ordens abertas ou fechadas no MT5/Deriv Web são importadas automaticamente pelo Live Stream.
                                            </p>

                                            <div className="pt-4 border-t border-white/[0.06] text-center">
                                                <button
                                                    onClick={handleDerivDisconnect}
                                                    disabled={isDerivLoading}
                                                    className="text-xs text-rose-400/70 hover:text-rose-400 font-semibold transition-colors"
                                                >
                                                    Desconectar Conta da Deriv
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    /* Disconnected Setup View */
                                    <div className="mt-6 space-y-6">
                                        {/* Step-by-step instructions */}
                                        <div className="bg-[#0C0D12] border border-white/[0.06] rounded-2xl p-5 space-y-3">
                                            <h4 className="text-xs font-bold uppercase tracking-wider text-rose-400 flex items-center gap-2">
                                                <ShieldCheck size={16} /> Instruções para Obter o Token de API:
                                            </h4>
                                            <ol className="text-xs text-slate-300 space-y-2.5 list-decimal list-inside leading-relaxed">
                                                <li>
                                                    Acesse sua conta Deriv no menu de tokens:{' '}
                                                    <a 
                                                        href="https://app.deriv.com/account/api-token" 
                                                        target="_blank" 
                                                        rel="noopener noreferrer"
                                                        className="text-rose-400 hover:text-rose-300 underline font-semibold inline-flex items-center gap-1"
                                                    >
                                                        Gerar Token Deriv <ExternalLink size={11} />
                                                    </a>
                                                </li>
                                                <li>
                                                    Selecione os escopos: <span className="bg-rose-500/15 text-rose-300 px-1.5 py-0.5 rounded border border-rose-500/30 font-semibold font-mono">Read</span> (Leitura) e <span className="bg-rose-500/15 text-rose-300 px-1.5 py-0.5 rounded border border-rose-500/30 font-semibold font-mono">Trade</span> (Negociação).
                                                </li>
                                                <li>
                                                    Defina o nome do token como <span className="text-white font-mono bg-white/[0.05] px-1.5 py-0.5 rounded">TorexJournal</span>, crie e copie o token gerado.
                                                </li>
                                            </ol>
                                        </div>

                                        <form onSubmit={handleDerivConnect} className="space-y-4">
                                            <div>
                                                <label className="text-xs font-semibold text-slate-300 mb-2 block">
                                                    Personal Access Token (PAT)
                                                </label>
                                                <div className="relative">
                                                    <input
                                                        type={showDerivToken ? 'text' : 'password'}
                                                        placeholder="Cole seu token de acesso da Deriv aqui..."
                                                        value={derivTokenInput}
                                                        onChange={(e) => setDerivTokenInput(e.target.value)}
                                                        disabled={isDerivConnecting}
                                                        className="w-full bg-[#0C0D12] border border-white/[0.08] rounded-xl px-4 py-3.5 pr-12 text-sm text-white focus:outline-none focus:border-rose-500/50 transition-all font-mono placeholder:text-slate-600"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowDerivToken(!showDerivToken)}
                                                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors p-1"
                                                        tabIndex={-1}
                                                    >
                                                        {showDerivToken ? <EyeOff size={16} /> : <Eye size={16} />}
                                                    </button>
                                                </div>
                                                <p className="text-[11px] text-slate-500 mt-1.5">
                                                    Seu token é criptografado com AES-256-GCM antes de ser armazenado no servidor.
                                                </p>
                                            </div>

                                            <button
                                                type="submit"
                                                disabled={isDerivConnecting || !derivTokenInput.trim()}
                                                className="w-full py-4 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold rounded-xl transition-all shadow-lg shadow-rose-600/20 flex items-center justify-center gap-2 text-sm"
                                            >
                                                {isDerivConnecting ? (
                                                    <>
                                                        <RefreshCw size={18} className="animate-spin" /> Conectando e Sincronizando...
                                                    </>
                                                ) : (
                                                    <>
                                                        <ShieldCheck size={18} /> Conectar e Sincronizar Agora
                                                    </>
                                                )}
                                            </button>
                                        </form>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {step === 'CONNECT_MANUAL' && (
                        <ManualImportForm onBack={handleBack} />
                    )}

                    {step === 'CONNECT_MANUAL_MT' && (
                        <ManualImportForm onBack={() => setStep('CONNECT_MT_OPTIONS')} />
                    )}
                </div>

                {/* Import History Centered at Bottom */}
                <div className="pt-8 border-t border-slate-800/50">
                    <ImportHistory />
                </div>
            </div>

            {showUpgradeModal && (
                <PlanModal 
                    type="UPGRADE_REQUIRED" 
                    featureName={upgradeFeature} 
                    onClose={() => setShowUpgradeModal(false)} 
                />
            )}

            {showDevModal && (
                <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
                    <div className="bg-slate-900/95 border border-slate-800 p-8 rounded-2xl max-w-md w-full shadow-2xl relative overflow-hidden flex flex-col items-center text-center animate-in fade-in zoom-in-95 duration-200">
                        {/* Glow decorativo */}
                        <div className="absolute -top-12 -left-12 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
                        <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />

                        <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-6 shadow-lg shadow-emerald-500/5">
                            <Lock size={28} className="animate-pulse" />
                        </div>

                        <h3 className="text-xl font-bold text-white mb-2">
                            Funcionalidade em Desenvolvimento
                        </h3>
                        
                        <p className="text-sm text-slate-400 leading-relaxed mb-8">
                            A sincronização automática para {upgradeFeature} está sendo preparada com muito carinho e estará disponível em breve. Aguarde, em breve!
                        </p>

                        <button
                            onClick={() => setShowDevModal(false)}
                            className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold py-3 px-6 rounded-xl transition-all shadow-lg shadow-emerald-500/15 active:scale-98"
                        >
                            Entendido, até breve!
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
