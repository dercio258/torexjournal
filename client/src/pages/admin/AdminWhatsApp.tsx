import { useState, useEffect } from 'react';
import { Card } from '../../components/ui/Card';
import api from '../../api';
import { RefreshCw, LogOut, CheckCircle2, MessageSquare, AlertCircle } from 'lucide-react';
import { Button } from '../../components/ui/Button';

export const AdminWhatsApp = () => {
    const [status, setStatus] = useState<string>('close');
    const [qrCode, setQrCode] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 5000); // Poll every 5s
        return () => clearInterval(interval);
    }, []);

    const fetchStatus = async () => {
        try {
            const { data } = await api.get('/whatsapp/status');
            setStatus(data.status);
            setQrCode(data.qrCode);
        } catch (error) {
            console.error('Failed to fetch WhatsApp status', error);
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    };

    const handleLogout = async () => {
        if (!confirm('Tem certeza que deseja desconectar o WhatsApp? Isso interromperá o envio de notificações.')) return;
        try {
            await api.post('/whatsapp/logout');
            fetchStatus();
        } catch (error) {
            console.error('Failed to logout WhatsApp', error);
        }
    };

    const handleRefresh = () => {
        setIsRefreshing(true);
        fetchStatus();
    };

    if (isLoading) return <div className="text-white">Carregando gerenciador...</div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-white">WhatsApp Manager</h1>
                    <p className="text-slate-400 mt-1">Gerencie a conexão do bot de notificações.</p>
                </div>
                <Button 
                    variant="ghost" 
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                    className="flex items-center gap-2"
                >
                    <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
                    Atualizar
                </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <Card className="p-8 border-slate-800 bg-slate-900/50 flex flex-col items-center justify-center min-h-[400px]">
                    {status === 'open' ? (
                        <div className="text-center space-y-6 animate-in fade-in zoom-in duration-500">
                            <div className="w-24 h-24 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto border-2 border-emerald-500/20">
                                <CheckCircle2 size={48} className="text-emerald-500" />
                            </div>
                            <div className="space-y-2">
                                <h2 className="text-2xl font-bold text-white">Conectado!</h2>
                                <p className="text-slate-400">O robô está pronto para enviar notificações.</p>
                            </div>
                            <Button 
                                variant="secondary" 
                                onClick={handleLogout}
                                className="flex items-center gap-2 text-red-400 hover:text-red-300 border-red-500/20 hover:border-red-500/40"
                            >
                                <LogOut size={16} /> Desconectar
                            </Button>
                        </div>
                    ) : qrCode ? (
                        <div className="text-center space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="bg-white p-4 rounded-2xl shadow-2xl shadow-indigo-500/10 mx-auto w-fit">
                                <img src={qrCode} alt="WhatsApp QR Code" className="w-64 h-64" />
                            </div>
                            <div className="space-y-2">
                                <h2 className="text-xl font-bold text-white uppercase tracking-wider">Aguardando Escaneamento</h2>
                                <p className="text-slate-400 text-sm max-w-xs mx-auto">
                                    Abra o WhatsApp em seu celular, vá em Configurações &gt; Aparelhos Conectados e escaneie o código.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center space-y-4">
                            <RefreshCw size={48} className="text-indigo-500 animate-spin mx-auto" />
                            <p className="text-slate-400">Gerando novo código...</p>
                        </div>
                    )}
                </Card>

                <div className="space-y-6">
                    <Card className="p-6 border-slate-800 bg-slate-900/50">
                        <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                            <MessageSquare size={18} className="text-indigo-400" />
                            Status do Bot
                        </h3>
                        <div className="space-y-4">
                            <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-xl">
                                <span className="text-slate-400 text-sm">Estado da Conexão</span>
                                <span className={`text-xs font-bold uppercase px-3 py-1 rounded-full ${
                                    status === 'open' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'
                                }`}>
                                    {status === 'open' ? 'Ativo' : 'Desconectado'}
                                </span>
                            </div>
                            <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-xl">
                                <span className="text-slate-400 text-sm">Atualização Automática</span>
                                <span className="text-slate-500 text-[10px] font-mono">A cada 5s</span>
                            </div>
                        </div>
                    </Card>

                    <Card className="p-6 border-slate-800 bg-slate-900/50">
                        <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                            <AlertCircle size={18} className="text-amber-400" />
                            Dicas de Segurança
                        </h3>
                        <ul className="text-xs text-slate-400 space-y-3 list-disc pl-4">
                            <li>Não envie muitas mensagens em um curto espaço de tempo.</li>
                            <li>Peça aos usuários para salvarem seu contato.</li>
                            <li><strong>Regra de 5 dias:</strong> O sistema bloqueia notificações se o usuário não interagir por 5 dias.</li>
                            <li>Mantenha o bot conectado a uma rede Wi-Fi estável.</li>
                        </ul>
                    </Card>
                </div>
            </div>
        </div>
    );
};
