import { useState, useEffect } from 'react';
import { Shield, User, Smartphone, CheckCircle2, Clock } from 'lucide-react';
import { Card } from '../components/ui/Card';
import api from '../api';

interface UserProfile {
    id: string;
    name: string;
    email: string;
    whatsapp?: string;
    token?: string;
    is_connected: boolean;
    role?: string;
    twoFactorEnabled: boolean;
    dailyLossLimit?: number;
}

export const Configuration = () => {
    const [user, setUser] = useState<UserProfile | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [waStatus, setWaStatus] = useState<any>(null);
    const [waCode, setWaCode] = useState<string | null>(null);
    const [waExpiresAt, setWaExpiresAt] = useState<string | null>(null);

    useEffect(() => {
        fetchUser();
        fetchWhatsAppStatus();
    }, []);

    const fetchWhatsAppStatus = async () => {
        try {
            const { data } = await api.get('/notifications/whatsapp/status');
            setWaStatus(data);
        } catch (err) {
            console.error('Error fetching WA status:', err);
        }
    };

    const fetchUser = async () => {
        try {
            const res = await api.get('/auth/profile');
            setUser(res.data);
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    const [show2FASetup, setShow2FASetup] = useState(false);
    const [qrCode, setQrCode] = useState('');
    const [otpCode, setOtpCode] = useState('');

    const handleToggle2FA = async () => {
        if (!user) return;
        
        // If enabling, show setup first
        if (!user.twoFactorEnabled) {
            try {
                const res = await api.post('/auth/2fa/setup');
                setQrCode(res.data.qrCodeDataUrl);
                setShow2FASetup(true);
            } catch (err) {
                console.error('Error starting 2FA setup:', err);
                alert('Erro ao iniciar configuração de 2FA.');
            }
        } else {
            // If disabling, just toggle
            try {
                const newStatus = false;
                await api.put('/auth/2fa', { enabled: newStatus });
                setUser({ ...user, twoFactorEnabled: newStatus });
            } catch (err) {
                console.error('Error toggling 2FA:', err);
                alert('Erro ao atualizar autenticação de dois fatores.');
            }
        }
    };

    const handleVerifySetup = async () => {
        try {
            await api.post('/auth/2fa/verify-setup', { token: otpCode });
            setUser(prev => prev ? { ...prev, twoFactorEnabled: true } : null);
            setShow2FASetup(false);
            setOtpCode('');
            alert('2FA ativado com sucesso!');
        } catch (err) {
            console.error('Error verifying 2FA setup:', err);
            alert('Código inválido. Tente novamente.');
        }
    };

    const handleGenerateWaCode = async () => {
        try {
            const { data } = await api.post('/notifications/whatsapp/code');
            setWaCode(data.code);
            setWaExpiresAt(data.expiresAt);
        } catch (err) {
            console.error('Error generating WA code:', err);
            alert('Erro ao gerar código de vinculação.');
        }
    };

    if (isLoading) return <div className="p-8 text-center text-slate-500">Carregando configurações...</div>;

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <header className="mb-8">
                <h1 className="text-2xl font-bold text-slate-100">Configuração</h1>
                <p className="text-sm text-slate-400">Gerencie sua conta e conexões</p>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* User Info */}
                <Card className="p-6 lg:col-span-2">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                            <User className="w-4 h-4 text-indigo-400" /> Informações do Usuário
                        </h2>
                        <span className="px-2 py-1 bg-indigo-500/10 text-indigo-400 text-xs rounded border border-indigo-500/20">
                            {user?.role || 'Trader'}
                        </span>
                    </div>

                    <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="text-[10px] uppercase font-bold text-slate-500 mb-1.5 block">Nome Completo</label>
                                <input
                                    disabled
                                    value={user?.name || ''}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold text-slate-500 mb-1.5 block">Email</label>
                                <input
                                    disabled
                                    value={user?.email || ''}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="text-[10px] uppercase font-bold text-slate-500 mb-1.5 block">WhatsApp</label>
                            <div className="flex gap-2">
                                <input
                                    disabled
                                    value={user?.whatsapp || ''}
                                    className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none"
                                    placeholder="Não informado"
                                />
                                <button className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-lg transition-colors">
                                    Editar
                                </button>
                            </div>
                        </div>

                        {/* Risk Management */}
                        <div className="pt-4 border-t border-slate-800">
                            <label className="text-[10px] uppercase font-bold text-slate-500 mb-2 block">Gerenciamento de Risco</label>
                            <div className="flex flex-col md:flex-row gap-4 items-end">
                                <div className="flex-1">
                                    <p className="text-xs text-slate-400 mb-2">Limite de Perda Diária (MT)</p>
                                    <input
                                        type="number"
                                        placeholder="0.00"
                                        value={user?.dailyLossLimit || ''}
                                        onChange={(e) => setUser(prev => prev ? { ...prev, dailyLossLimit: parseFloat(e.target.value) } : null)}
                                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                                    />
                                </div>
                                <button 
                                    onClick={async () => {
                                        try {
                                            await api.put('/auth/profile', { dailyLossLimit: user?.dailyLossLimit });
                                            alert('Configurações de risco atualizadas!');
                                        } catch (e) {
                                            alert('Erro ao salvar.');
                                        }
                                    }}
                                    className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg transition-all shadow-lg shadow-indigo-500/20"
                                >
                                    Gravar Limite
                                </button>
                            </div>
                            <p className="text-[10px] text-slate-500 mt-2 italic">
                                Você receberá um alerta no Telegram/WhatsApp assim que sua perda diária atingir este valor.
                            </p>
                        </div>
                    </div>
                </Card>

                {/* Security Card */}
                <Card className="p-6">
                    <div className="flex items-center gap-2 mb-6">
                        <Shield className="w-4 h-4 text-emerald-400" />
                        <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Segurança</h2>
                    </div>

                    <div className="space-y-6">
                        <div className="flex items-center justify-between p-4 rounded-xl bg-slate-900/50 border border-slate-800">
                            <div>
                                <p className="text-sm font-bold text-slate-200">Autenticação 2FA</p>
                                <p className="text-[10px] text-slate-500 mt-1">Proteja sua conta com um código extra enviado ao seu e-mail.</p>
                            </div>
                            <button 
                                onClick={handleToggle2FA}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${user?.twoFactorEnabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
                            >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${user?.twoFactorEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                        </div>
                        
                        <div className={`p-3 rounded-lg text-xs leading-relaxed ${user?.twoFactorEnabled ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800/50 text-slate-500 border border-slate-700'}`}>
                            {user?.twoFactorEnabled 
                                ? 'Sua conta está protegida com Google Authenticator ou similar.' 
                                : 'Ative a autenticação de dois fatores para aumentar significativamente a segurança da sua conta.'}
                        </div>

                        {show2FASetup && (
                            <div className="mt-6 p-4 bg-slate-900 rounded-xl border border-indigo-500/30 space-y-4 animate-in fade-in slide-in-from-top-4">
                                <p className="text-xs font-bold text-slate-200 uppercase">Configurar 2FA</p>
                                <p className="text-[10px] text-slate-400">Escaneie o QR Code abaixo com seu app de autenticação (Google Authenticator, Authy, etc).</p>
                                
                                <div className="flex justify-center p-2 bg-white rounded-lg">
                                    <img src={qrCode} alt="2FA QR Code" className="w-32 h-32" />
                                </div>

                                <div className="space-y-2">
                                    <label className="text-[10px] uppercase font-bold text-slate-500 block">Código de Verificação</label>
                                    <div className="flex gap-2">
                                        <input 
                                            value={otpCode}
                                            onChange={(e) => setOtpCode(e.target.value)}
                                            placeholder="000000"
                                            className="flex-1 bg-slate-800 border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                        />
                                        <button 
                                            onClick={handleVerifySetup}
                                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg transition-all"
                                        >
                                            Verificar
                                        </button>
                                    </div>
                                    <button 
                                        onClick={() => setShow2FASetup(false)}
                                        className="w-full py-2 text-[10px] text-slate-500 hover:text-slate-300"
                                    >
                                        Cancelar
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </Card>

                {/* WhatsApp Connection Card */}
                <Card className="p-6">
                    <div className="flex items-center gap-2 mb-6">
                        <Smartphone className="w-4 h-4 text-indigo-400" />
                        <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Notificações WhatsApp</h2>
                    </div>

                    <div className="space-y-6">
                        <div className="flex items-center justify-between p-4 rounded-xl bg-slate-900/50 border border-slate-800">
                            <div>
                                <p className="text-sm font-bold text-slate-200">Status do Bot</p>
                                <div className="flex items-center gap-1.5 mt-1">
                                    {waStatus?.connected ? (
                                        <>
                                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                            <span className="text-[10px] text-emerald-400 font-bold uppercase">Vinculado</span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="w-2 h-2 rounded-full bg-slate-600" />
                                            <span className="text-[10px] text-slate-500 font-bold uppercase">Não Vinculado</span>
                                        </>
                                    )}
                                </div>
                            </div>
                            {waStatus?.connected ? (
                                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                            ) : (
                                <button 
                                    onClick={handleGenerateWaCode}
                                    className="px-3 py-1.5 bg-indigo-500/10 text-indigo-400 text-xs font-bold rounded-lg border border-indigo-500/20 hover:bg-indigo-500/20 transition-all"
                                >
                                    Vincular
                                </button>
                            )}
                        </div>

                        {waStatus?.connected && (
                            <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] leading-relaxed">
                                Seu número <strong>{waStatus.whatsappNumber}</strong> está recebendo alertas de ordens e notificações críticas.
                            </div>
                        )}

                        {waCode && !waStatus?.connected && (
                            <div className="p-4 bg-slate-900 rounded-xl border border-indigo-500/30 space-y-4 animate-in fade-in slide-in-from-top-4">
                                <div className="text-center space-y-2">
                                    <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">Código de Vinculação</p>
                                    <div className="text-3xl font-mono font-bold text-white tracking-[0.5em] bg-slate-800 py-3 rounded-lg border border-slate-700">
                                        {waCode}
                                    </div>
                                    <p className="text-[10px] text-slate-500 flex items-center justify-center gap-1">
                                        <Clock className="w-3 h-3" />Expira em {new Date(waExpiresAt!).toLocaleTimeString()}
                                    </p>
                                </div>
                                <div className="p-3 bg-indigo-500/10 rounded-lg border border-indigo-500/10">
                                    <p className="text-[10px] text-indigo-300 leading-relaxed text-center">
                                        Envie o comando <strong>/sync {user?.email}</strong> para o bot e quando solicitado, digite este código.
                                    </p>
                                </div>
                            </div>
                        )}
                        
                        {!waStatus?.connected && !waCode && (
                            <div className="p-3 rounded-lg bg-slate-800/50 text-slate-500 border border-slate-700 text-xs leading-relaxed">
                                Clique em vincular para gerar um código e conectar seu WhatsApp à plataforma.
                            </div>
                        )}
                    </div>
                </Card>
            </div>
        </div>
    );
};
