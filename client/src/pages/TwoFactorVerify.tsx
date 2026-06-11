import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
    Lock,
    ArrowRight,
    AlertCircle,
    Loader2,
    Check,
    TrendingUp,
    ShieldCheck,
    RefreshCw
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api';

export const TwoFactorVerify = () => {
    const { login } = useAuth();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    // Route Parameters
    const twoFactorToken = searchParams.get('twoFactorToken');
    
    // Self-contained JWT email decoder helper
    const decodeJwtEmail = (token: string | null): string => {
        if (!token) return 'seu e-mail cadastrado';
        try {
            const base64Url = token.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(
                atob(base64)
                    .split('')
                    .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
                    .join('')
            );
            const payload = JSON.parse(jsonPayload);
            return payload.email || 'seu e-mail cadastrado';
        } catch (e) {
            return 'seu e-mail cadastrado';
        }
    };

    const email = decodeJwtEmail(twoFactorToken);

    // State Variables
    const [otp, setOtp] = useState<string[]>(Array(6).fill(''));
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const [cooldownTimer, setCooldownTimer] = useState(0);

    // Refs for input elements
    const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

    // Focus first input on mount
    useEffect(() => {
        if (inputRefs.current[0]) {
            inputRefs.current[0].focus();
        }
    }, []);

    // Cooldown Timer countdown logic
    useEffect(() => {
        let interval: any;
        if (cooldownTimer > 0) {
            interval = setInterval(() => setCooldownTimer(prev => prev - 1), 1000);
        }
        return () => clearInterval(interval);
    }, [cooldownTimer]);

    // Check query param constraints
    useEffect(() => {
        if (!twoFactorToken) {
            setError('Sessão de autenticação inválida. Por favor, volte ao login.');
        }
    }, [twoFactorToken]);

    // Handle single digit input change
    const handleChange = (value: string, index: number) => {
        // Only allow numbers
        const cleanValue = value.replace(/[^0-9]/g, '');
        if (!cleanValue) {
            const newOtp = [...otp];
            newOtp[index] = '';
            setOtp(newOtp);
            return;
        }

        const digit = cleanValue.slice(-1);
        const newOtp = [...otp];
        newOtp[index] = digit;
        setOtp(newOtp);

        // Auto-focus next input
        if (index < 5 && digit) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    // Handle key press (specifically Backspace back-navigation)
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
        if (e.key === 'Backspace') {
            if (!otp[index] && index > 0) {
                const newOtp = [...otp];
                newOtp[index - 1] = '';
                setOtp(newOtp);
                inputRefs.current[index - 1]?.focus();
            } else {
                const newOtp = [...otp];
                newOtp[index] = '';
                setOtp(newOtp);
            }
        } else if (e.key === 'ArrowLeft' && index > 0) {
            inputRefs.current[index - 1]?.focus();
        } else if (e.key === 'ArrowRight' && index < 5) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    // Handle clipboard paste
    const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault();
        const pastedData = e.clipboardData.getData('text').trim();
        
        // Match numbers only and slice to 6 digits
        const numericData = pastedData.replace(/[^0-9]/g, '').slice(0, 6);
        if (numericData.length === 6) {
            const newOtp = numericData.split('');
            setOtp(newOtp);
            
            // Focus last input and blur to submit
            inputRefs.current[5]?.focus();
            
            // Trigger automatic submit helper
            setTimeout(() => {
                triggerSubmit(numericData);
            }, 100);
        }
    };

    // Helper to trigger direct submit (e.g. from paste)
    const triggerSubmit = async (codeString: string) => {
        if (codeString.length !== 6) return;
        setIsLoading(true);
        setError(null);

        try {
            const res = await api.post('/auth/verify-2fa', {
                twoFactorToken,
                otp: codeString
            });

            if (res.data.success) {
                setSuccessMsg('Verificado com sucesso! Redirecionando...');
                setTimeout(() => {
                    login(res.data.token);
                    navigate('/dashboard');
                }, 1000);
            } else {
                setError(res.data.message || 'Código inválido');
                setOtp(Array(6).fill(''));
                inputRefs.current[0]?.focus();
            }
        } catch (err: any) {
            console.error(err);
            const errMsg = err.response?.data?.message || 'Erro ao verificar código';
            setError(errMsg);
            setOtp(Array(6).fill(''));
            inputRefs.current[0]?.focus();

            if (err.response?.status === 429) {
                const match = errMsg.match(/por (\d+) minutos/);
                if (match && match[1]) {
                    setCooldownTimer(parseInt(match[1]) * 60);
                } else {
                    setCooldownTimer(300);
                }
            }
        } finally {
            setIsLoading(false);
        }
    };

    // Form submission handler
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const codeString = otp.join('');
        if (codeString.length !== 6) {
            setError('Por favor, insira o código de 6 dígitos.');
            return;
        }
        triggerSubmit(codeString);
    };

    // Code Resend handler
    const handleResend = async () => {
        if (!twoFactorToken) return;
        setIsLoading(true);
        setError(null);
        setSuccessMsg(null);

        try {
            const res = await api.post('/auth/resend-2fa', { twoFactorToken });
            if (res.data.success) {
                setSuccessMsg('Um novo código de verificação foi enviado para o seu e-mail.');
                setCooldownTimer(300); // 5 mins cooldown
                setOtp(Array(6).fill(''));
                inputRefs.current[0]?.focus();
            } else {
                setError(res.data.message || 'Erro ao reenviar o código.');
            }
        } catch (err: any) {
            console.error(err);
            const errMsg = err.response?.data?.message || 'Erro ao solicitar novo código.';
            setError(errMsg);
            if (err.response?.status === 429) {
                setCooldownTimer(300);
            }
        } finally {
            setIsLoading(false);
        }
    };

    // Navigate back to Login
    const handleBackToLogin = () => {
        navigate('/login');
    };

    const isCodeComplete = otp.every(digit => digit !== '');

    return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 md:p-6 font-sans relative overflow-hidden">
            {/* Logo Absolute */}
            <div className="absolute top-6 left-6 md:top-8 md:left-8 z-20 flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
                    <TrendingUp className="text-white w-6 h-6" />
                </div>
                <span className="font-bold text-xl tracking-tight text-white select-none">
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

            <div className="w-full max-w-md mx-auto relative z-10">
                <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800/60 p-8 md:p-10 rounded-3xl shadow-2xl relative group">
                    {/* Hover Glow Grid */}
                    <div className="absolute -inset-0.5 bg-gradient-to-br from-emerald-500/20 to-slate-800/0 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 -z-10 blur-sm" />

                    <div className="flex flex-col items-center mb-8">
                        <button
                            onClick={handleBackToLogin}
                            className="self-start mb-6 text-slate-400 hover:text-white flex items-center gap-2 text-sm transition-colors"
                        >
                            ← Voltar para login
                        </button>
                        
                        <div className="w-14 h-14 bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border border-emerald-500/20 rounded-2xl flex items-center justify-center mb-4 shadow-inner">
                            <Lock className="text-emerald-400 w-7 h-7 animate-pulse" />
                        </div>
                        
                        <h2 className="text-2xl font-bold text-white text-center">Verificação 2FA</h2>
                        <p className="text-slate-400 text-sm mt-3 text-center leading-relaxed">
                            Sua conta possui autenticação de dois fatores ativa. <br />
                            Insira o código enviado para <span className="text-emerald-400 font-semibold">{email}</span>.
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* 6 Digit Numeric Inputs Container */}
                        <div className="flex justify-between gap-2 md:gap-3 py-2">
                            {otp.map((digit, index) => (
                                <input
                                    key={index}
                                    ref={el => (inputRefs.current[index] = el)}
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    maxLength={1}
                                    value={digit}
                                    onChange={e => handleChange(e.target.value, index)}
                                    onKeyDown={e => handleKeyDown(e, index)}
                                    onPaste={handlePaste}
                                    className={`w-12 h-14 md:w-14 md:h-16 text-center text-xl font-bold bg-slate-950/60 border rounded-xl text-slate-100 placeholder:text-slate-800 focus:outline-none transition-all duration-300 ${
                                        digit
                                            ? 'border-emerald-500/50 shadow-[0_0_8px_rgba(16,185,129,0.15)] bg-slate-900/40'
                                            : 'border-slate-800 focus:border-emerald-500/35 focus:shadow-[0_0_8px_rgba(16,185,129,0.1)]'
                                    }`}
                                    placeholder="-"
                                    autoFocus={index === 0}
                                />
                            ))}
                        </div>

                        {error && (
                            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3 text-red-400 text-xs md:text-sm animate-in fade-in duration-200">
                                <AlertCircle size={18} className="shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        {successMsg && (
                            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3 text-emerald-400 text-xs md:text-sm animate-in fade-in duration-200">
                                <Check size={18} className="shrink-0" />
                                <span>{successMsg}</span>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={isLoading || !isCodeComplete || !!successMsg}
                            className={`w-full h-12 rounded-xl font-bold text-sm md:text-base flex items-center justify-center transition-all duration-300 active:scale-[0.98] ${
                                isCodeComplete && !isLoading && !successMsg
                                    ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-950/40 border border-transparent'
                                    : 'bg-slate-800/50 border border-slate-800 text-slate-500 cursor-not-allowed'
                            }`}
                        >
                            {isLoading ? (
                                <Loader2 className="animate-spin text-slate-300" size={20} />
                            ) : successMsg ? (
                                <Check className="text-emerald-400" size={20} />
                            ) : (
                                <>Verificar Código <ArrowRight size={18} className="ml-2 opacity-80" /></>
                            )}
                        </button>
                    </form>

                    {/* Resend Action Area */}
                    <div className="mt-8 pt-4 border-t border-slate-800/40 text-center flex flex-col items-center gap-2">
                        <button
                            type="button"
                            onClick={handleResend}
                            disabled={cooldownTimer > 0 || isLoading || !!successMsg}
                            className={`inline-flex items-center gap-2 text-xs font-bold transition-all duration-200 ${
                                cooldownTimer > 0 || isLoading || !!successMsg
                                    ? 'text-slate-600 cursor-not-allowed'
                                    : 'text-emerald-400 hover:text-emerald-300 hover:underline'
                            }`}
                        >
                            <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
                            {cooldownTimer > 0 
                                ? `Reenviar código em ${cooldownTimer}s` 
                                : 'Não recebeu o código? Reenviar por E-mail'
                            }
                        </button>
                    </div>

                    {/* Security Footnote Signatures */}
                    <div className="mt-8 flex justify-center items-center gap-2 text-[10px] text-slate-600 tracking-wide select-none">
                        <ShieldCheck size={12} className="text-emerald-500" />
                        <span>TOREX JOURNAL SECURE CHECKPOINT</span>
                        <span>•</span>
                        <span>SSL ENCRYPTED</span>
                    </div>
                </div>

                <p className="text-center text-[10px] text-slate-600 mt-6 select-none leading-relaxed">
                    Sua sessão é protegida por autenticação multifator. Ao prosseguir, você concorda com nossos Termos de Serviço e políticas de privacidade de segurança de dados.
                </p>
            </div>
        </div>
    );
};
