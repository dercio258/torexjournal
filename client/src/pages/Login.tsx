
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    Mail,
    Lock,
    Check,
    ArrowRight,
    TrendingUp,
    AlertCircle,
    Loader2,
    Eye,
    EyeOff,
    Github
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api';

// --- Custom UI Components (Local for Login Layout) ---

const LoginInput = ({ label, icon, type = "text", error, ...props }: any) => {
    const [isFocused, setIsFocused] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    const inputType = type === 'password' ? (showPassword ? 'text' : 'password') : type;

    return (
        <div className="space-y-1.5 group">
            <label className={`text-sm font-medium transition-colors ${isFocused ? 'text-emerald-400' : 'text-slate-400'}`}>
                {label}
            </label>
            <div className={`relative flex items-center bg-slate-900/50 border rounded-xl transition-all duration-300 ${error
                ? 'border-red-500/50 shadow-[0_0_0_1px_rgba(239,68,68,0.2)]'
                : isFocused
                    ? 'border-emerald-500/50 shadow-[0_0_0_1px_rgba(16,185,129,0.2)]'
                    : 'border-slate-800 hover:border-slate-700'
                }`}>
                <div className={`pl-4 pr-3 ${isFocused ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {icon}
                </div>
                <input
                    type={inputType}
                    className="w-full bg-transparent border-none text-slate-100 placeholder:text-slate-600 focus:ring-0 py-3.5 pl-0 pr-4 text-sm font-medium focus:outline-none"
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    {...props}
                />
                {type === 'password' && (
                    <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-4 text-slate-500 hover:text-slate-300 transition-colors"
                    >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                )}
            </div>
            {error && (
                <div className="flex items-center gap-1.5 text-red-400 text-xs animate-in slide-in-from-left-1">
                    <AlertCircle size={12} />
                    <span>{error}</span>
                </div>
            )}
        </div>
    );
};

const Checkbox = ({ checked, onChange, label }: any) => (
    <label className="flex items-center gap-3 cursor-pointer group select-none">
        <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all duration-200 ${checked
            ? 'bg-emerald-500 border-emerald-500 text-slate-900'
            : 'bg-slate-900/50 border-slate-700 group-hover:border-slate-600'
            }`}>
            {checked && <Check size={14} strokeWidth={4} />}
        </div>
        <span className={`text-sm transition-colors ${checked ? 'text-slate-300' : 'text-slate-500 group-hover:text-slate-400'}`}>
            {label}
        </span>
        <input type="checkbox" className="hidden" checked={checked} onChange={e => onChange(e.target.checked)} />
    </label>
);

const LoginButton = ({ children, isLoading, variant = 'primary', className = '', ...props }: any) => {
    const baseStyles = "relative w-full h-12 rounded-xl font-bold transition-all duration-300 flex items-center justify-center disabled:opacity-70 disabled:cursor-not-allowed active:scale-[0.98]";

    const variants: any = {
        primary: "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-900/20 border border-transparent",
        outline: "bg-transparent border border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-white"
    };

    return (
        <button className={`${baseStyles} ${variants[variant]} ${className}`} disabled={isLoading} {...props}>
            {isLoading ? (
                <Loader2 className="animate-spin text-white/80" size={20} />
            ) : (
                children
            )}
        </button>
    );
};

// Simple SVG Component for Google
const GoogleIcon = ({ className }: { className?: string }) => (
    <svg className={`w-4 h-4 ${className}`} viewBox="0 0 24 24" fill="currentColor">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
);

export const Login = () => {
    const { login } = useAuth();
    const navigate = useNavigate();

    // View State: 'login' | 'forgot-password' | '2fa'
    const [view, setView] = useState<'login' | 'forgot-password' | '2fa'>('login');

    // Login Form State
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [remember, setRemember] = useState(false);

    // 2FA State
    const [twoFactorUserId, setTwoFactorUserId] = useState<string | null>(null);
    const [twoFactorEmail, setTwoFactorEmail] = useState<string | null>(null);
    const [twoFactorOtp, setTwoFactorOtp] = useState('');

    // Forgot Password Form State
    const [fpEmail, setFpEmail] = useState('');
    const [fpOtp, setFpOtp] = useState('');
    const [fpNewPassword, setFpNewPassword] = useState('');
    const [otpSent, setOtpSent] = useState(false);
    const [otpTimer, setOtpTimer] = useState(0);

    // Common State
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);

    // Timer Logic
    React.useEffect(() => {
        let interval: any;
        if (otpTimer > 0) {
            interval = setInterval(() => setOtpTimer(prev => prev - 1), 1000);
        }
        return () => clearInterval(interval);
    }, [otpTimer]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        try {
            const res = await api.post('/auth/login', { email, password });

            if (res.data.success) {
                if (res.data.twoFactorRequired) {
                    setTwoFactorUserId(res.data.userId);
                    setTwoFactorEmail(res.data.email);
                    setView('2fa');
                } else {
                    login(res.data.token);
                    navigate('/dashboard');
                }
            } else {
                setError(res.data.message || 'Credenciais inválidas');
            }
        } catch (err: any) {
            console.error(err);
            setError(err.response?.data?.message || 'Erro ao conectar com o servidor');
        } finally {
            setIsLoading(false);
        }
    };

    const handleVerify2FA = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!twoFactorOtp) {
            setError('Por favor, insira o código de verificação.');
            return;
        }

        setError(null);
        setIsLoading(true);

        try {
            const res = await api.post('/auth/verify-2fa', {
                userId: twoFactorUserId,
                otp: twoFactorOtp
            });

            if (res.data.success) {
                login(res.data.token);
                navigate('/dashboard');
            } else {
                setError(res.data.message || 'Código inválido');
            }
        } catch (err: any) {
            console.error(err);
            setError(err.response?.data?.message || 'Erro ao verificar código');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSendOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!fpEmail) {
            setError('Por favor, informe seu e-mail.');
            return;
        }
        setError(null);
        setSuccessMsg(null);
        setIsLoading(true);

        try {
            const res = await api.post('/auth/forgot-password', { email: fpEmail });
            if (res.data.success) {
                setOtpSent(true);
                setOtpTimer(60);
                setSuccessMsg('Código enviado para o seu e-mail.');
            } else {
                setError(res.data.message || 'Erro ao enviar código.');
            }
        } catch (err: any) {
            console.error(err);
            setError(err.response?.data?.message || 'Erro ao conectar com o servidor');
        } finally {
            setIsLoading(false);
        }
    };

    const handleResetPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!fpOtp || !fpNewPassword) {
            setError('Preencha todos os campos.');
            return;
        }
        if (fpNewPassword.length < 6) {
            setError('A senha deve ter no mínimo 6 caracteres.');
            return;
        }

        setError(null);
        setSuccessMsg(null);
        setIsLoading(true);

        try {
            const res = await api.post('/auth/reset-password', {
                email: fpEmail,
                otp: fpOtp,
                newPassword: fpNewPassword
            });

            if (res.data.success) {
                setSuccessMsg('Senha redefinida com sucesso! Redirecionando...');
                setTimeout(() => {
                    setView('login');
                    setOtpSent(false);
                    setFpEmail('');
                    setFpOtp('');
                    setFpNewPassword('');
                    setSuccessMsg(null);
                }, 2000);
            } else {
                setError(res.data.message || 'Erro ao redefinir senha.');
            }
        } catch (err: any) {
            console.error(err);
            setError(err.response?.data?.message || 'Erro ao realizar a solicitação.');
        } finally {
            setIsLoading(false);
        }
    };

    // Helper to switch view and reset states
    const switchView = (newView: 'login' | 'forgot-password' | '2fa') => {
        setView(newView);
        setError(null);
        setSuccessMsg(null);
        setOtpSent(false);
        setFpEmail('');
        setFpOtp('');
        setFpNewPassword('');
        setTwoFactorOtp('');
    };

    return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 md:p-6 font-sans relative overflow-hidden">

            {/* Logo Absolute */}
            <div className="absolute top-6 left-6 md:top-8 md:left-8 z-20 flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
                    <TrendingUp className="text-white w-6 h-6" />
                </div>
                <span className="font-bold text-xl tracking-tight text-white">
                    TOREX <span className="text-emerald-400">JOURNAL</span>
                </span>
            </div>

            {/* Background Ambience */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
                <div className="absolute -top-[20%] -left-[10%] w-[70%] h-[70%] bg-emerald-500/5 rounded-full blur-[120px]" />
                <div className="absolute top-[40%] right-[0%] w-[50%] h-[50%] bg-teal-500/5 rounded-full blur-[100px]" />
                {/* Grid Pattern */}
                <div
                    className="absolute inset-0 opacity-[0.03]"
                    style={{
                        backgroundImage: 'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
                        backgroundSize: '40px 40px'
                    }}
                />
            </div>

            <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center relative z-10">

                {/* Left Column (Marketing/Brand) - Desktop Only */}
                <div className="hidden lg:block space-y-8 pr-8">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900/50 border border-emerald-500/20 text-emerald-400 text-xs font-medium backdrop-blur-md">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        Sincronização em tempo real ativa
                    </div>

                    <h1 className="text-5xl font-extrabold text-white leading-tight">
                        Transforme dados em <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-400">consistência.</span>
                    </h1>

                    <p className="text-slate-400 text-lg leading-relaxed max-w-md">
                        Acesse seu diário automatizado e descubra os padrões ocultos que estão drenando ou alavancando seu capital.
                    </p>

                    <div className="grid grid-cols-2 gap-4 pt-4">
                        <div className="p-4 rounded-2xl bg-slate-900/30 border border-slate-800">
                            <div className="text-2xl font-bold text-white mb-1">94%</div>
                            <div className="text-xs text-slate-500 uppercase font-bold">Assertividade Média</div>
                        </div>
                        <div className="p-4 rounded-2xl bg-slate-900/30 border border-slate-800">
                            <div className="text-2xl font-bold text-white mb-1">1.2M+</div>
                            <div className="text-xs text-slate-500 uppercase font-bold">Trades Analisados</div>
                        </div>
                    </div>
                </div>

                {/* Right Column (Form) */}
                <div className="w-full max-w-md mx-auto">
                    <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800/60 p-8 md:p-10 rounded-3xl shadow-2xl relative group">
                        {/* Glow Effect on Hover */}
                        <div className="absolute -inset-0.5 bg-gradient-to-br from-emerald-500/20 to-slate-800/0 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 -z-10 blur-sm" />

                        {view === 'login' && (
                            <>
                                <div className="flex flex-col items-center mb-8">
                                    <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20 mb-4">
                                        <TrendingUp className="text-white w-7 h-7" />
                                    </div>
                                    <h2 className="text-2xl font-bold text-white">Bem-vindo de volta</h2>
                                    <p className="text-slate-400 text-sm mt-2">Insira suas credenciais para acessar o painel.</p>
                                </div>

                                <form onSubmit={handleLogin} className="space-y-6">
                                    <LoginInput
                                        label="E-mail"
                                        placeholder="exemplo@torex.com"
                                        type="email"
                                        icon={<Mail size={18} />}
                                        value={email}
                                        onChange={(e: any) => setEmail(e.target.value)}
                                        error={error && !password ? " " : undefined}
                                    />

                                    <div className="space-y-1">
                                        <LoginInput
                                            label="Senha"
                                            placeholder="••••••••"
                                            type="password"
                                            icon={<Lock size={18} />}
                                            value={password}
                                            onChange={(e: any) => setPassword(e.target.value)}
                                        />
                                        <div className="flex justify-end pt-1">
                                            <button
                                                type="button"
                                                onClick={() => switchView('forgot-password')}
                                                className="text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors"
                                            >
                                                Esqueceu a senha?
                                            </button>
                                        </div>
                                    </div>

                                    {error && (
                                        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-3 text-red-400 text-sm animate-pulse">
                                            <AlertCircle size={18} />
                                            {error}
                                        </div>
                                    )}

                                    {successMsg && (
                                        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3 text-emerald-400 text-sm animate-in slide-in-from-top-2">
                                            <Check size={18} />
                                            {successMsg}
                                        </div>
                                    )}

                                    <Checkbox
                                        label="Manter conectado por 30 dias"
                                        checked={remember}
                                        onChange={setRemember}
                                    />

                                    <LoginButton type="submit" isLoading={isLoading}>
                                        Entrar na Plataforma <ArrowRight size={18} className="ml-2 opacity-80" />
                                    </LoginButton>
                                </form>

                                <div className="relative my-8">
                                    <div className="absolute inset-0 flex items-center">
                                        <div className="w-full border-t border-slate-800"></div>
                                    </div>
                                    <div className="relative flex justify-center text-xs uppercase">
                                        <span className="bg-slate-900 px-4 text-slate-500 font-medium">Ou continue com</span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <LoginButton 
                                        variant="outline" 
                                        className="h-10 text-sm font-medium"
                                        onClick={() => {
                                            window.location.href = '/api/auth/google';
                                        }}
                                    >
                                        <GoogleIcon className="mr-2" /> Google
                                    </LoginButton>
                                    <LoginButton 
                                        variant="outline" 
                                        className="h-10 text-sm font-medium"
                                        onClick={() => {
                                            window.location.href = '/api/auth/github';
                                        }}
                                    >
                                        <Github size={16} className="mr-2" /> GitHub
                                    </LoginButton>
                                </div>

                                <div className="mt-8 text-center">
                                    <p className="text-slate-400 text-sm">
                                        Não tem uma conta?
                                        <Link to="/register" className="text-emerald-400 hover:text-emerald-300 font-bold ml-1 transition-colors">
                                            Começar teste grátis
                                        </Link>
                                    </p>
                                </div>
                            </>
                        )}

                        {view === '2fa' && (
                            <>
                                <div className="flex flex-col items-center mb-8">
                                    <button
                                        onClick={() => switchView('login')}
                                        className="self-start mb-4 text-slate-400 hover:text-white flex items-center gap-2 text-sm transition-colors"
                                    >
                                        ← Voltar para login
                                    </button>
                                    <div className="w-12 h-12 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center justify-center mb-4">
                                        <Lock className="text-emerald-400 w-6 h-6" />
                                    </div>
                                    <h2 className="text-2xl font-bold text-white">Verificação 2FA</h2>
                                    <p className="text-slate-400 text-sm mt-2 text-center">
                                        Sua conta possui autenticação de dois fatores ativa. <br />
                                        Insira o código enviado para <b>{twoFactorEmail}</b>.
                                    </p>
                                </div>

                                <form onSubmit={handleVerify2FA} className="space-y-6">
                                    <LoginInput
                                        label="Código de Verificação"
                                        placeholder="123456"
                                        type="text"
                                        icon={<Lock size={18} />}
                                        value={twoFactorOtp}
                                        onChange={(e: any) => setTwoFactorOtp(e.target.value)}
                                        maxLength={6}
                                        autoComplete="one-time-code"
                                    />

                                    {error && (
                                        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-3 text-red-400 text-sm animate-pulse">
                                            <AlertCircle size={18} />
                                            {error}
                                        </div>
                                    )}

                                    <LoginButton type="submit" isLoading={isLoading}>
                                        Verificar e Acessar <ArrowRight size={18} className="ml-2 opacity-80" />
                                    </LoginButton>
                                </form>
                            </>
                        )}

                        {view === 'forgot-password' && (
                            // FORGOT PASSWORD WIZARD
                            <>
                                <div className="flex flex-col items-center mb-8">
                                    <button
                                        onClick={() => switchView('login')}
                                        className="self-start mb-4 text-slate-400 hover:text-white flex items-center gap-2 text-sm transition-colors"
                                    >
                                        ← Voltar para login
                                    </button>
                                    <div className="w-12 h-12 bg-slate-800 rounded-xl flex items-center justify-center mb-4">
                                        <Lock className="text-emerald-400 w-6 h-6" />
                                    </div>
                                    <h2 className="text-2xl font-bold text-white">Recuperar Senha</h2>
                                    <p className="text-slate-400 text-sm mt-2 text-center">
                                        {otpSent
                                            ? 'Insira o código enviado ao seu e-mail e defina uma nova senha.'
                                            : 'Informe seu e-mail cadastrado para receber um código de recuperação.'}
                                    </p>
                                </div>

                                {!otpSent ? (
                                    // STEP 1: SEND EMAIL
                                    <form onSubmit={handleSendOtp} className="space-y-6">
                                        <LoginInput
                                            label="E-mail cadastrado"
                                            placeholder="exemplo@torex.com"
                                            type="email"
                                            icon={<Mail size={18} />}
                                            value={fpEmail}
                                            onChange={(e: any) => setFpEmail(e.target.value)}
                                        />

                                        {error && (
                                            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-3 text-red-400 text-sm animate-pulse">
                                                <AlertCircle size={18} />
                                                {error}
                                            </div>
                                        )}

                                        <LoginButton type="submit" isLoading={isLoading}>
                                            Enviar Código de Recuperação
                                        </LoginButton>
                                    </form>
                                ) : (
                                    // STEP 2: RESET PASSWORD
                                    <form onSubmit={handleResetPassword} className="space-y-6">
                                        <LoginInput
                                            label="Código de Verificação (OTP)"
                                            placeholder="123456"
                                            type="text"
                                            icon={<Lock size={18} />}
                                            value={fpOtp}
                                            onChange={(e: any) => setFpOtp(e.target.value)}
                                        />

                                        <div className="space-y-1">
                                            <LoginInput
                                                label="Nova Senha"
                                                placeholder="••••••••"
                                                type="password"
                                                icon={<Lock size={18} />}
                                                value={fpNewPassword}
                                                onChange={(e: any) => setFpNewPassword(e.target.value)}
                                            />
                                            <p className="text-[10px] text-slate-500 text-right px-1">Mínimo de 6 caracteres</p>
                                        </div>

                                        {error && (
                                            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-3 text-red-400 text-sm animate-pulse">
                                                <AlertCircle size={18} />
                                                {error}
                                            </div>
                                        )}

                                        {successMsg && (
                                            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3 text-emerald-400 text-sm animate-in slide-in-from-top-2">
                                                <Check size={18} />
                                                {successMsg}
                                            </div>
                                        )}

                                        <LoginButton type="submit" isLoading={isLoading}>
                                            Redefinir Senha
                                        </LoginButton>

                                        <div className="text-center">
                                            <button
                                                type="button"
                                                onClick={handleSendOtp}
                                                disabled={otpTimer > 0 || isLoading}
                                                className={`text-xs font-medium transition-colors ${otpTimer > 0 ? 'text-slate-500 cursor-not-allowed' : 'text-emerald-400 hover:text-emerald-300'}`}
                                            >
                                                {otpTimer > 0 ? `Aguarde ${otpTimer}s para reenviar` : 'Não recebeu o código? Reenviar'}
                                            </button>
                                        </div>
                                    </form>
                                )}
                            </>
                        )}
                    </div>

                    <p className="text-center text-xs text-slate-600 mt-8">
                        Protegido por reCAPTCHA e sujeito à Política de Privacidade e Termos de Uso do TOREX JOURNAL.
                    </p>
                </div>
            </div>
        </div>
    );
}
