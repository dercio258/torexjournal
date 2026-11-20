import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, MailCheck, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import api from '../api';
import { AuthLayout } from '../layouts/AuthLayout';
import { AuthCard } from '../components/auth/AuthCard';
import { AuthAside } from '../components/auth/AuthAside';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';
import { useCountdown } from '../hooks/useCountdown';
import { getApiMessage, getRegisterErrorMessage } from '../lib/authErrors';
import { mergeSessionUtmsIntoSearch, sanitizeReturnTo } from '../lib/attribution';
import { identifyUserOnTracker, trackConversion } from '../lib/tracking';

export const PENDING_VERIFICATION_STORAGE_KEY = 'torex_pending_verification';

interface PendingVerificationState {
    verificationToken: string;
    emailMasked: string;
    email: string;
    returnTo?: string | null;
}

const RESEND_COOLDOWN_S = 60;

export const VerifyAccount = () => {
    const { login } = useAuth();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const navigate = useNavigate();

    const [pending] = useState<PendingVerificationState | null>(() => {
        try {
            const raw = sessionStorage.getItem(PENDING_VERIFICATION_STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed?.verificationToken) return null;
            return parsed;
        } catch {
            return null;
        }
    });

    const [otp, setOtp] = useState('');
    const [fieldError, setFieldError] = useState<string | undefined>(undefined);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(() =>
        isEn
            ? 'We sent a 6-digit verification code to your email.'
            : 'Enviámos um código de verificação de 6 dígitos para o seu e-mail.',
    );
    const [isVerifying, setIsVerifying] = useState(false);
    const [isResending, setIsResending] = useState(false);
    const resendCooldown = useCountdown();

    useEffect(() => {
        if (!pending) {
            navigate('/register', { replace: true });
        }
    }, [pending, navigate]);

    const handleOtpChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const clean = e.target.value.replace(/\D/g, '').slice(0, 6);
        setOtp(clean);
        if (fieldError) setFieldError(undefined);
    };

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (!pending?.verificationToken) {
            navigate('/register', { replace: true });
            return;
        }

        const cleanOtp = otp.trim();
        if (!/^\d{6}$/.test(cleanOtp)) {
            setFieldError(
                isEn
                    ? 'Enter the 6-digit code sent to your email.'
                    : 'Digite o código completo de 6 dígitos enviado para o seu e-mail.',
            );
            return;
        }

        setIsVerifying(true);
        try {
            const res = await api.post('/auth/register/verify', {
                verificationToken: pending.verificationToken,
                otp: cleanOtp,
            });

            if (res.data?.token) {
                sessionStorage.removeItem(PENDING_VERIFICATION_STORAGE_KEY);
                login(res.data.token);
                void identifyUserOnTracker();
                trackConversion('signup', {
                    metadata: { method: 'email_otp_two_step', locale },
                });
                const dest = sanitizeReturnTo(pending.returnTo) || '/dashboard';
                navigate(dest, { replace: true });
                window.location.reload();
                return;
            }

            setError(
                getRegisterErrorMessage(
                    res.data?.error || res.data?.message || (isEn ? 'Verification failed' : 'Falha na verificação'),
                    locale,
                ),
            );
        } catch (err) {
            const rawMsg = getApiMessage(err, '');
            if (rawMsg.toLowerCase().includes('expirad') || rawMsg.toLowerCase().includes('corrompido')) {
                setError(
                    isEn
                        ? 'Your verification session has expired. Please register again.'
                        : 'A sua sessão de verificação expirou. Volte ao registo para reiniciar.',
                );
            } else {
                setError(getRegisterErrorMessage(rawMsg, locale));
            }
        } finally {
            setIsVerifying(false);
        }
    };

    const handleResend = async () => {
        if (!pending?.verificationToken || resendCooldown.active) return;
        setError(null);
        setNotice(null);
        setIsResending(true);
        try {
            const res = await api.post('/auth/register/resend', {
                verificationToken: pending.verificationToken,
            });
            if (res.data?.success !== false) {
                resendCooldown.start(RESEND_COOLDOWN_S);
                setNotice(
                    isEn
                        ? `A new code was sent to ${pending.emailMasked}.`
                        : `Enviámos um novo código de 6 dígitos para ${pending.emailMasked}.`,
                );
            } else {
                setError(getApiMessage(res.data, isEn ? 'Could not resend code.' : 'Não foi possível reenviar.'));
            }
        } catch (err) {
            setError(getRegisterErrorMessage(getApiMessage(err, ''), locale));
        } finally {
            setIsResending(false);
        }
    };

    const registerBackUrl = mergeSessionUtmsIntoSearch('/register');

    return (
        <AuthLayout
            asideSide="right"
            aside={
                <AuthAside
                    title={
                        isEn ? (
                            <>
                                One final step to unlock your <span className="text-accent-fg">trading terminal.</span>
                            </>
                        ) : (
                            <>
                                Falta apenas confirmar o seu <span className="text-accent-fg">e-mail para entrar.</span>
                            </>
                        )
                    }
                    description={
                        isEn
                            ? 'We verify every account before provisioning your trading workspace, journal encryption, and broker sync.'
                            : 'Confirmamos a titularidade da sua conta antes de ativar o terminal, criptografia do diário e sincronização.'
                    }
                    highlights={
                        isEn
                            ? [
                                  'Isolated per-account JWT & encryption keys',
                                  'Instant access to 20+ supported brokers and MT5',
                                  'Offline-ready trading journal & smart push alerts',
                              ]
                            : [
                                  'Chaves isoladas e proteção institucional da conta',
                                  'Integração rápida com +20 corretoras, Deriv e MT5',
                                  'Diário offline pronto para registo após cada operação',
                              ]
                    }
                />
            }
        >
            <AuthCard
                title={isEn ? 'Verify your account' : 'Verificar conta'}
                description={
                    isEn
                        ? `Enter the 6-digit verification code sent to ${pending?.emailMasked || pending?.email || 'your email'}.`
                        : `Introduza o código de 6 dígitos enviado para ${pending?.emailMasked || pending?.email || 'o seu e-mail'}.`
                }
                footer={
                    <Link
                        to={registerBackUrl}
                        onClick={() => sessionStorage.removeItem(PENDING_VERIFICATION_STORAGE_KEY)}
                        className="inline-flex items-center gap-1.5 font-semibold text-accent-fg transition-colors hover:text-accent-hover"
                    >
                        <ArrowLeft size={14} />
                        {isEn ? 'Use a different email or phone' : 'Alterar dados ou e-mail de registo'}
                    </Link>
                }
            >
                <div className="mb-5 flex items-center gap-3 rounded-xl border border-accent/25 bg-accent/10 px-3.5 py-3 text-xs text-fg">
                    <MailCheck size={18} className="shrink-0 text-accent-fg" />
                    <div className="min-w-0">
                        <p className="font-semibold text-fg">
                            {isEn ? 'Verification code active (15 min)' : 'Código de verificação ativo (15 min)'}
                        </p>
                        <p className="truncate font-mono text-[11px] text-fg-muted">
                            {pending?.emailMasked || pending?.email}
                        </p>
                    </div>
                </div>

                <form onSubmit={handleVerify} noValidate className="space-y-4">
                    <Input
                        variant="field"
                        name="otp"
                        label={isEn ? 'Verification code (6 digits)' : 'Código de verificação (6 dígitos)'}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="000000"
                        maxLength={6}
                        icon={<ShieldCheck size={18} />}
                        value={otp}
                        onChange={handleOtpChange}
                        error={fieldError}
                        autoFocus
                        className="text-center font-mono text-lg font-bold tracking-[0.35em]"
                    />

                    {notice && <Alert tone="success">{notice}</Alert>}
                    {error && <Alert tone="error">{error}</Alert>}

                    <Button
                        type="submit"
                        variant="brand"
                        size="lg"
                        fullWidth
                        isLoading={isVerifying}
                        iconRight={<ArrowRight size={18} aria-hidden />}
                    >
                        {isEn ? 'Confirm & Enter Workspace' : 'Confirmar e Entrar'}
                    </Button>

                    <div className="flex items-center justify-between pt-1 text-xs">
                        <span className="text-fg-subtle">
                            {isEn ? "Didn't receive the code?" : 'Não recebeu o código?'}
                        </span>
                        <button
                            type="button"
                            onClick={handleResend}
                            disabled={resendCooldown.active || isResending}
                            className="inline-flex items-center gap-1.5 font-semibold text-accent-fg hover:text-accent-hover disabled:opacity-50 cursor-pointer"
                        >
                            <RefreshCw size={12} className={isResending ? 'animate-spin' : ''} />
                            {resendCooldown.active
                                ? isEn
                                    ? `Resend in ${resendCooldown.remaining}s`
                                    : `Reenviar em ${resendCooldown.remaining}s`
                                : isEn
                                  ? 'Resend code'
                                  : 'Reenviar código'}
                        </button>
                    </div>
                </form>
            </AuthCard>
        </AuthLayout>
    );
};

export default VerifyAccount;
