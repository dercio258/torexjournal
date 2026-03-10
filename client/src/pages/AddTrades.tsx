import { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { BrokerSelector } from '../components/dashboard/BrokerSelector';
import { AutoSyncForm } from '../components/dashboard/AutoSyncForm';
import { ManualImportForm } from '../components/dashboard/ManualImportForm';
import { ImportHistory } from '../components/dashboard/ImportHistory';
import { Copy, Terminal, Cloud, FileText } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api';

export const AddTrades = () => {
    const { user } = useAuth();
    const [step, setStep] = useState<'SELECT' | 'CONNECT_MT_CLOUD' | 'CONNECT_MT_OPTIONS' | 'CONNECT_MT_EA' | 'CONNECT_DERIV' | 'CONNECT_MANUAL' | 'CONNECT_MANUAL_MT'>('SELECT');
    const [mtVersion, setMtVersion] = useState<'4' | '5'>('5');
    // selectedBroker state removed as it is no longer used for rendering info
    const [appToken, setAppToken] = useState<string | null>(null);

    useEffect(() => {
        const fetchToken = async () => {
            try {
                const res = await api.get('/auth/app-token');
                if (res.data?.token) setAppToken(res.data.token);
            } catch (e) {
                setAppToken(user?.id ? `ea-${user.id.substring(0, 8)}` : 'Loading...');
            }
        };
        fetchToken();
    }, [user]);

    const isBasic = user?.tier === 'BASIC';

    const handleSelectBroker = (broker: any) => {
        if (isBasic && broker.id !== 'manual') {
            alert('Esta opção de conexão está disponível apenas para o plano PREMIUM. O plano BÁSICO suporta apenas Upload Manual de CSV.');
            return;
        }
        // No longer storing selectedBroker since we only care about step routing
        if (broker.id === 'deriv') {
            setStep('CONNECT_DERIV');
        } else if (broker.id === 'mt5') {
            setMtVersion('5');
            setStep('CONNECT_MT_OPTIONS');
        } else if (broker.id === 'mt4') {
            setMtVersion('4');
            setStep('CONNECT_MT_OPTIONS');
        } else {
            setStep('CONNECT_MANUAL');
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
                                <Card className="p-8 cursor-pointer hover:border-emerald-500/50 transition-all group" onClick={() => setStep('CONNECT_MT_CLOUD')}>
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
                                <p className="text-slate-400 mb-8">Use este token para conectar seu Expert Advisor (EA) no MetaTrader {mtVersion}.</p>

                                <div className="bg-slate-950/80 rounded-2xl p-6 border border-indigo-500/20 mb-6 backdrop-blur-md">
                                    <span className="text-sm text-slate-500 font-bold uppercase tracking-wider block mb-2">Seu App Token</span>
                                    <div className="flex items-center justify-between gap-4">
                                        <code className="text-indigo-300 font-mono text-2xl tracking-widest">{appToken || 'Gerando...'}</code>
                                        <button onClick={copyToken} className="p-3 bg-indigo-500/10 hover:bg-indigo-500/20 rounded-xl text-indigo-400 transition-colors" title="Copiar Token">
                                            <Copy size={24} />
                                        </button>
                                    </div>
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
                        <div className="animate-in fade-in slide-in-from-right-4 max-w-xl mx-auto">
                            <button onClick={handleBack} className="flex items-center gap-2 text-slate-400 hover:text-slate-100 transition-colors mb-6 text-sm">
                                Voltar aos brokers
                            </button>
                            <Card className="p-8 border-rose-500/20 bg-rose-500/5">
                                <div className="flex items-center justify-between mb-8">
                                    <h3 className="text-xl font-bold text-slate-200 flex items-center gap-3">
                                        <img src="https://deriv.com/static/deriv-logo-c97b819f.svg" className="w-8 h-8" alt="Deriv" /> Deriv Autosync
                                    </h3>
                                    {user?.is_connected ? (
                                        <span className="flex items-center gap-2 text-sm text-emerald-400 font-bold uppercase tracking-wider px-3 py-1 bg-emerald-500/10 rounded-full">
                                            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" /> Conectado
                                        </span>
                                    ) : (
                                        <span className="text-sm text-slate-500 font-bold uppercase tracking-wider px-3 py-1 bg-slate-800 rounded-full">Desconectado</span>
                                    )}
                                </div>

                                <div className="space-y-6">
                                    <p className="text-slate-400 leading-relaxed">
                                        Cole seu <strong>Personal Access Token (PAT)</strong> com escopos <code className="text-rose-300 bg-rose-500/10 px-2 py-0.5 rounded">read</code> e <code className="text-rose-300 bg-rose-500/10 px-2 py-0.5 rounded">trade</code> para sincronizar conta.
                                    </p>

                                    <div className="space-y-4">
                                        <input
                                            type="password"
                                            placeholder="Cole seu Access Token aqui..."
                                            className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-4 text-slate-200 focus:outline-none focus:border-rose-500/50 transition-colors"
                                            id="deriv-token-add"
                                        />
                                        <button
                                            onClick={async () => {
                                                const token = (document.getElementById('deriv-token-add') as HTMLInputElement).value;
                                                if (!token) return alert('Insira um token válido');

                                                try {
                                                    await api.post('/integrations/deriv/connect', { token });
                                                    alert('Deriv conectada com sucesso!');
                                                    window.location.reload();
                                                } catch (err) {
                                                    alert('Erro ao conectar: ' + (err as any).response?.data?.message || (err as any).message);
                                                }
                                            }}
                                            className="w-full py-4 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl transition-colors shadow-lg shadow-rose-500/20"
                                        >
                                            Conectar e Sincronizar Agora
                                        </button>
                                    </div>

                                    {user?.is_connected && (
                                        <button
                                            onClick={async () => {
                                                if (confirm('Deseja desconectar sua conta Deriv?')) {
                                                    try {
                                                        await api.delete('/integrations/deriv/disconnect');
                                                        window.location.reload();
                                                    } catch (err) {
                                                        console.error(err);
                                                    }
                                                }
                                            }}
                                            className="w-full mt-4 text-center text-sm text-red-400/60 hover:text-red-400 transition-colors font-bold"
                                        >
                                            Desconectar Conta
                                        </button>
                                    )}
                                </div>
                            </Card>
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
        </div>
    );
};
