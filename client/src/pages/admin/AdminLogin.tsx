import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Lock, Calendar, Key, ArrowLeft } from 'lucide-react';
import api from '../../api';

export const AdminLogin = () => {
    const navigate = useNavigate();
    const [step, setStep] = useState<'login' | 'otp'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    // Initialize date with today in DD/MM/YYYY format if desired, or let user type
    const [date, setDate] = useState('');
    const [otp, setOtp] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccessMessage('');
        setIsLoading(true);

        try {
            const res = await api.post('/admin/auth/login', {
                email,
                pass: password, // Backend expects 'pass'
                date
            });

            if (res.data.success) {
                if (res.data.otpRequired) {
                    setStep('otp');
                    setSuccessMessage(res.data.message || 'Código de verificação enviado ao e-mail cadastrado.');
                } else {
                    localStorage.setItem('adminToken', res.data.token);
                    navigate('/admin/dashboard');
                }
            }
        } catch (err: any) {
            console.error(err);
            setError(err.response?.data?.message || 'Login falhou. Verifique credenciais e data.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleVerifyOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            const res = await api.post('/admin/auth/verify', {
                email,
                otp
            });

            if (res.data.success && res.data.token) {
                localStorage.setItem('adminToken', res.data.token);
                navigate('/admin/dashboard');
            } else {
                setError('Verificação falhou. Token não recebido.');
            }
        } catch (err: any) {
            console.error(err);
            setError(err.response?.data?.message || 'Código de verificação inválido ou expirado.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
            <Card className="w-full max-w-md p-8 border-slate-800 bg-slate-900/50">
                {step === 'login' ? (
                    <>
                        <div className="text-center mb-8">
                            <div className="inline-flex p-3 bg-red-500/10 rounded-xl mb-4">
                                <Lock className="w-8 h-8 text-red-500" />
                            </div>
                            <h1 className="text-2xl font-bold text-white">Acesso Administrativo</h1>
                            <p className="text-slate-400 text-sm mt-2">Área restrita</p>
                        </div>

                        {error && (
                            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg mb-6 text-sm text-center">
                                {error}
                            </div>
                        )}

                        <form onSubmit={handleLogin} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">Email</label>
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-red-500 transition-colors"
                                    placeholder="admin@example.com"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">Senha</label>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-red-500 transition-colors"
                                    placeholder="••••••••"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">
                                    Data de Hoje (DD/MM/AAAA)
                                </label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        value={date}
                                        onChange={(e) => setDate(e.target.value)}
                                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-red-500 transition-colors pl-10"
                                        placeholder="Ex: 15/02/2026"
                                        required
                                    />
                                    <Calendar className="w-4 h-4 text-slate-500 absolute left-3 top-3.5" />
                                </div>
                                <p className="text-xs text-slate-500 mt-1">Verificação de segurança adicional.</p>
                            </div>

                            <Button
                                variant="primary"
                                className="w-full bg-red-600 hover:bg-red-700 text-white mt-4"
                                isLoading={isLoading}
                                type="submit"
                            >
                                Entrar
                            </Button>
                        </form>
                    </>
                ) : (
                    <>
                        <div className="text-center mb-8">
                            <div className="inline-flex p-3 bg-red-500/10 rounded-xl mb-4">
                                <Key className="w-8 h-8 text-red-500" />
                            </div>
                            <h1 className="text-2xl font-bold text-white">Verificação de Segurança</h1>
                            <p className="text-slate-400 text-sm mt-2">Digite o código de 6 dígitos enviado ao e-mail.</p>
                        </div>

                        {successMessage && (
                            <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-3 rounded-lg mb-6 text-sm text-center">
                                {successMessage}
                            </div>
                        )}

                        {error && (
                            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg mb-6 text-sm text-center">
                                {error}
                            </div>
                        )}

                        <form onSubmit={handleVerifyOtp} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">Código de Verificação</label>
                                <input
                                    type="text"
                                    maxLength={6}
                                    value={otp}
                                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-center text-2xl tracking-widest font-bold text-white focus:outline-none focus:border-red-500 transition-colors"
                                    placeholder="000000"
                                    required
                                />
                            </div>

                            <Button
                                variant="primary"
                                className="w-full bg-red-600 hover:bg-red-700 text-white mt-4"
                                isLoading={isLoading}
                                type="submit"
                            >
                                Verificar Código
                            </Button>

                            <button
                                type="button"
                                onClick={() => {
                                    setStep('login');
                                    setError('');
                                    setSuccessMessage('');
                                    setOtp('');
                                }}
                                className="w-full flex items-center justify-center gap-2 text-slate-400 hover:text-white transition-colors text-sm mt-4"
                            >
                                <ArrowLeft className="w-4 h-4" /> Voltar para o login
                            </button>
                        </form>
                    </>
                )}
            </Card>
        </div>
    );
};
