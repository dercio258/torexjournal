import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { ShieldCheck, Calendar, Key, ArrowLeft, Sun, Moon } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import api from '../../api';
import { isValidAdminToken } from '../../lib/adminAuth';
import { CloudflareTurnstile } from '../../components/auth/CloudflareTurnstile';

export const AdminLogin = () => {
    const navigate = useNavigate();
    const { theme, toggleTheme } = useTheme();
    const [step, setStep] = useState<'login' | 'otp'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [date, setDate] = useState('');
    const [otp, setOtp] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
    const [turnstileRequired, setTurnstileRequired] = useState(false);
    const [turnstileReset, setTurnstileReset] = useState(0);

    useEffect(() => {
        if (isValidAdminToken()) {
            navigate('/admin/dashboard', { replace: true });
        }
    }, [navigate]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccessMessage('');
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            setError('Sem ligação à internet. Reconecte-se para aceder ao painel administrativo.');
            return;
        }
        if (turnstileRequired && !turnstileToken) {
            setError('Conclua a verificação de segurança Cloudflare para continuar.');
            return;
        }
        setIsLoading(true);

        try {
            const res = await api.post('/admin/auth/login', {
                email,
                pass: password,
                date,
                ...(turnstileToken ? { turnstileToken } : {}),
            });

            if (res.data.success) {
                if (res.data.otpRequired) {
                    setStep('otp');
                    setSuccessMessage(res.data.message || 'Código de verificação enviado ao e-mail cadastrado.');
                } else {
                    localStorage.setItem('adminToken', res.data.token);
                    navigate('/admin/dashboard', { replace: true });
                }
            }
        } catch (err: any) {
            console.error(err);
            setTurnstileReset((n) => n + 1);
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
                otp,
            });

            if (res.data.success && res.data.token) {
                localStorage.setItem('adminToken', res.data.token);
                navigate('/admin/dashboard', { replace: true });
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
        <div className="min-h-screen bg-canvas text-fg flex flex-col justify-between p-4 sm:p-6">
            <div className="flex items-center justify-between max-w-md w-full mx-auto">
                <Link
                    to="/"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted hover:text-fg transition-colors"
                >
                    <ArrowLeft className="h-3.5 w-3.5" /> Voltar ao início
                </Link>
                <button
                    type="button"
                    onClick={toggleTheme}
                    className="rounded-lg border border-line bg-surface p-2 text-fg-muted hover:text-fg transition-colors"
                    aria-label="Alternar tema"
                >
                    {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </button>
            </div>

            <div className="flex-1 flex items-center justify-center py-6">
                <Card className="w-full max-w-md p-7 sm:p-8 border-line bg-surface shadow-panel">
                    {step === 'login' ? (
                        <>
                            <div className="text-center mb-7">
                                <div className="inline-flex h-12 w-12 items-center justify-center bg-accent/15 border border-accent/25 text-accent-fg rounded-2xl mb-4">
                                    <ShieldCheck className="w-6 h-6" />
                                </div>
                                <h1 className="text-2xl font-bold tracking-tight text-fg">Torex Command Center</h1>
                                <p className="text-fg-muted text-sm mt-1">Acesso administrativo autenticado em duas etapas</p>
                            </div>

                            {error && (
                                <div className="bg-rose-500/10 border border-rose-500/25 text-danger-fg p-3 rounded-xl mb-5 text-xs sm:text-sm text-center">
                                    {error}
                                </div>
                            )}

                            <form onSubmit={handleLogin} className="space-y-4">
                                <div>
                                    <label className="block text-xs font-semibold uppercase tracking-wider text-fg-muted mb-1.5">
                                        Email
                                    </label>
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="w-full bg-canvas border border-line rounded-xl px-4 py-2.5 text-sm text-fg placeholder-fg-subtle focus:outline-none focus:border-accent transition-colors"
                                        placeholder="admin@torexjournal.com"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-semibold uppercase tracking-wider text-fg-muted mb-1.5">
                                        Senha
                                    </label>
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full bg-canvas border border-line rounded-xl px-4 py-2.5 text-sm text-fg placeholder-fg-subtle focus:outline-none focus:border-accent transition-colors"
                                        placeholder="••••••••"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-semibold uppercase tracking-wider text-fg-muted mb-1.5">
                                        Data de Hoje (DD/MM/AAAA)
                                    </label>
                                    <div className="relative">
                                        <input
                                            type="text"
                                            value={date}
                                            onChange={(e) => setDate(e.target.value)}
                                            className="w-full bg-canvas border border-line rounded-xl px-4 py-2.5 text-sm text-fg placeholder-fg-subtle focus:outline-none focus:border-accent transition-colors pl-10"
                                            placeholder="Ex: 14/11/2026"
                                            required
                                        />
                                        <Calendar className="w-4 h-4 text-fg-subtle absolute left-3.5 top-3" />
                                    </div>
                                    <p className="text-[11px] text-fg-subtle mt-1">Verificação temporal de segurança.</p>
                                </div>

                                <CloudflareTurnstile
                                    action="admin_login"
                                    resetTrigger={turnstileReset}
                                    onTokenChange={setTurnstileToken}
                                    onRequirementChange={setTurnstileRequired}
                                />

                                <Button
                                    variant="brand"
                                    size="lg"
                                    fullWidth
                                    className="mt-2"
                                    isLoading={isLoading}
                                    type="submit"
                                >
                                    Continuar para OTP
                                </Button>
                            </form>
                        </>
                    ) : (
                        <>
                            <div className="text-center mb-7">
                                <div className="inline-flex h-12 w-12 items-center justify-center bg-accent/15 border border-accent/25 text-accent-fg rounded-2xl mb-4">
                                    <Key className="w-6 h-6" />
                                </div>
                                <h1 className="text-2xl font-bold tracking-tight text-fg">Verificação OTP</h1>
                                <p className="text-fg-muted text-sm mt-1">Digite o código de 6 dígitos enviado ao seu e-mail.</p>
                            </div>

                            {successMessage && (
                                <div className="bg-emerald-500/10 border border-emerald-500/25 text-accent-fg p-3 rounded-xl mb-5 text-xs sm:text-sm text-center">
                                    {successMessage}
                                </div>
                            )}

                            {error && (
                                <div className="bg-rose-500/10 border border-rose-500/25 text-danger-fg p-3 rounded-xl mb-5 text-xs sm:text-sm text-center">
                                    {error}
                                </div>
                            )}

                            <form onSubmit={handleVerifyOtp} className="space-y-4">
                                <div>
                                    <label className="block text-xs font-semibold uppercase tracking-wider text-fg-muted mb-1.5">
                                        Código de Verificação
                                    </label>
                                    <input
                                        type="text"
                                        maxLength={6}
                                        value={otp}
                                        onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                                        className="w-full bg-canvas border border-line rounded-xl px-4 py-3 text-center text-2xl tracking-widest font-bold text-fg focus:outline-none focus:border-accent transition-colors"
                                        placeholder="000000"
                                        required
                                    />
                                </div>

                                <Button
                                    variant="brand"
                                    size="lg"
                                    fullWidth
                                    isLoading={isLoading}
                                    type="submit"
                                >
                                    Validar & Acessar Painel
                                </Button>

                                <button
                                    type="button"
                                    onClick={() => {
                                        setStep('login');
                                        setError('');
                                        setSuccessMessage('');
                                        setOtp('');
                                    }}
                                    className="w-full flex items-center justify-center gap-2 text-fg-muted hover:text-fg transition-colors text-xs sm:text-sm pt-2"
                                >
                                    <ArrowLeft className="w-4 h-4" /> Voltar para credenciais
                                </button>
                            </form>
                        </>
                    )}
                </Card>
            </div>

            <div className="text-center text-[11px] text-fg-subtle">
                Torex Journal · Área Administrativa Restrita
            </div>
        </div>
    );
};
