import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, LogIn, MailCheck, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import api from '../api';
import { AuthLayout } from '../layouts/AuthLayout';
import { AuthCard } from '../components/auth/AuthCard';
import { AuthAside } from '../components/auth/AuthAside';
import { Input } from '../components/ui/Input';
import { Button, buttonVariants } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';
import { useCountdown } from '../hooks/useCountdown';
import {
    getApiMessage,
    getRegisterErrorMessage,
    isRateLimited,
    parseRetryAfter,
} from '../lib/authErrors';
import { mergeSessionUtmsIntoSearch, sanitizeReturnTo } from '../lib/attribution';
import {
    clearPendingVerification,
    PENDING_VERIFICATION_STORAGE_KEY,
    PendingVerificationState,
    readPendingVerification,
    savePendingVerification,
} from '../lib/pendingVerification';
import { identifyUserOnTracker, trackConversion } from '../lib/tracking';

export { PENDING_VERIFICATION_STORAGE_KEY };

const RESEND_COOLDOWN_S = 60;

function resolveInitialNotice(
    pending: PendingVerificationState | null,
    isEn: boolean,
): string | null {
    if (!pending) return null;
    if (pending.codeSent === false) {
        return isEn
            ? 'An active 6-digit verification code was already sent recently to your email. Enter it below or wait a moment to resend.'
            : 'Já enviámos um código de verificação ativo há instantes para o seu e-mail. Introduza-o abaixo ou aguarde alguns segundos para reenviar.';
    }
    if (pending.fromLogin) {
        return isEn
            ? 'Your email has not been verified yet. Enter the 6-digit verification code we sent to your inbox.'
            : 'O seu e-mail ainda não foi verificado. Introduza o código de 6 dígitos que enviámos para o seu e-mail.';
    }
    return isEn
        ? 'We sent a 6-digit verification code to your email.'
        : 'Enviámos um código de verificação de 6 dígitos para o seu e-mail.';
}

export const VerifyAccount = () => {
    const { login, isAuthenticated, user } = useAuth();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const navigate = useNavigate();
    const location = useLocation();
    const verifiedJustNowRef = useRef(false);

    const [pending, setPending] = useState<PendingVerificationState | null>(() =>
        readPendingVerification(location.state),
    );

    useEffect(() => {
        const fromState = (location.state as { pendingVerification?: PendingVerificationState } | null)
            ?.pendingVerification;
        if (fromState?.verificationToken) {
            savePendingVerification(fromState);
            setPending(fromState);
        }
    }, [location.state]);

    useEffect(() => {
        if (isAuthenticated && user && user.emailVerified !== false && !verifiedJustNowRef.current) {
            const dest = sanitizeReturnTo(pending?.returnTo) || '/dashboard';
            navigate(dest, { replace: true });
        }
    }, [isAuthenticated, user, pending?.returnTo, navigate]);

    const [otp, setOtp] = useState('');
    const [fieldError, setFieldError] = useState<string | undefined>(undefined);
    const [error, setError] = useState<string | null>(null);
    const [sessionExpiredError, setSessionExpiredError] = useState(false);
    const [notice, setNotice] = useState<string | null>(() =>
        resolveInitialNotice(readPendingVerification(location.state), isEn),
    );
    const [isVerifying, setIsVerifying] = useState(false);
    const [isResending, setIsResending] = useState(false);
    const resendCooldown = useCountdown();

    const handleOtpChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const clean = e.target.value.replace(/\D/g, '').slice(0, 6);
        setOtp(clean);
        if (fieldError) setFieldError(undefined);
    };

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSessionExpiredError(false);

        if (!pending?.verificationToken) {
            setError(
                isEn
                    ? 'Your verification session is unavailable. Sign in to receive a new code.'
                    : 'Sessão de verificação indisponível. Inicie sessão para receber um novo código.',
            );
            setSessionExpiredError(true);
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

            if (res.data?.alreadyVerified) {
                clearPendingVerification();
                navigate('/login', {
                    replace: true,
                    state: {
                        infoMessage: isEn
                            ? 'Your account is already verified. Sign in to continue.'
                            : 'A sua conta já está verificada. Faça login para continuar.',
                    },
                });
                return;
            }

            if (res.data?.twoFactorRequired && res.data?.twoFactorToken) {
                clearPendingVerification();
                const nextParams = new URLSearchParams();
                nextParams.set('twoFactorToken', res.data.twoFactorToken);
                const safeRet = sanitizeReturnTo(pending.returnTo);
                if (safeRet) nextParams.set('returnTo', safeRet);
                navigate(`/2fa?${nextParams.toString()}`, { replace: true });
                return;
            }

            if (res.data?.token) {
                verifiedJustNowRef.current = true;
                clearPendingVerification();
                login(res.data.token);
                void identifyUserOnTracker();
                trackConversion('signup', {
                    metadata: {
                        method: pending.fromLogin ? 'email_otp_first_login' : 'email_otp_two_step',
                        locale,
                    },
                });
                const needsOnboarding = res.data?.user?.onboardingCompleted === false;
                const dest = needsOnboarding
                    ? '/dashboard'
                    : sanitizeReturnTo(pending.returnTo) || '/dashboard';
                navigate(dest, { replace: true });
                return;
            }

            setError(
                getRegisterErrorMessage(
                    res.data?.error || res.data?.message || (isEn ? 'Verification failed' : 'Falha na verificação'),
                    locale,
                ),
            );
        } catch (err: any) {
            const status = err?.response?.status;
            const rawMsg = getApiMessage(err, '');
            const lower = rawMsg.toLowerCase();

            if (
                status === 401 ||
                lower.includes('sessão de verificação expirada') ||
                lower.includes('token de verificação inválido') ||
                lower.includes('token de verificação de conta inválido') ||
                lower.includes('corrompido')
            ) {
                setSessionExpiredError(true);
                setError(
                    isEn
                        ? 'Your verification session expired. Sign in with your email and password to automatically receive a new code.'
                        : 'A sua sessão de verificação expirou. Inicie sessão com o seu e-mail e senha para receber um novo código automaticamente.',
                );
            } else if (lower.includes('expirado') || lower.includes('invalidado')) {
                setOtp('');
                setError(
                    isEn
                        ? 'This code is no longer valid. Click "Resend code" below to receive a new 6-digit code.'
                        : rawMsg || 'Este código expirou ou foi invalidado. Clique em "Reenviar código" abaixo.',
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
        setSessionExpiredError(false);
        setIsResending(true);
        try {
            const res = await api.post('/auth/register/resend', {
                verificationToken: pending.verificationToken,
            });

            if (res.data?.alreadyVerified) {
                clearPendingVerification();
                navigate('/login', {
                    replace: true,
                    state: {
                        infoMessage: isEn
                            ? 'Your account is already verified. Sign in to continue.'
                            : 'A sua conta já está verificada. Faça login para continuar.',
                    },
                });
                return;
            }

            if (res.data?.success !== false) {
                if (res.data?.verificationToken) {
                    const updated: PendingVerificationState = {
                        ...pending,
                        verificationToken: res.data.verificationToken,
                        emailMasked: res.data.emailMasked || pending.emailMasked,
                        codeSent: true,
                    };
                    setPending(updated);
                    savePendingVerification(updated);
                }
                resendCooldown.start(RESEND_COOLDOWN_S);
                setNotice(
                    isEn
                        ? `A new code was sent to ${pending.emailMasked}.`
                        : `Enviámos um novo código de 6 dígitos para ${pending.emailMasked}.`,
                );
            } else {
                setError(getApiMessage(res.data, isEn ? 'Could not resend code.' : 'Não foi possível reenviar.'));
            }
        } catch (err: any) {
            const status = err?.response?.status;
            const rawMsg = getApiMessage(err, '');
            if (isRateLimited(err)) {
                const retrySeconds = parseRetryAfter(rawMsg, RESEND_COOLDOWN_S);
                resendCooldown.start(retrySeconds);
                setError(
                    isEn
                        ? `Please wait ${retrySeconds}s before requesting another code.`
                        : rawMsg || `Aguarde ${retrySeconds}s antes de reenviar o código.`,
                );
            } else if (status === 401 || rawMsg.toLowerCase().includes('sessão de verificação expirada')) {
                setSessionExpiredError(true);
                setError(
                    isEn
                        ? 'Your verification session expired. Sign in with your email and password to receive a new code.'
                        : 'A sua sessão de verificação expirou. Inicie sessão com o seu e-mail e senha para receber um novo código.',
                );
            } else {
                setError(getRegisterErrorMessage(rawMsg, locale));
            }
        } finally {
            setIsResending(false);
        }
    };

    const registerBackUrl = mergeSessionUtmsIntoSearch('/register');
    const loginUrl = mergeSessionUtmsIntoSearch(
        pending?.returnTo ? `/login?returnTo=${encodeURIComponent(pending.returnTo)}` : '/login',
    );

    const asideContent = (
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
    );

    if (!pending) {
        return (
            <AuthLayout asideSide="right" aside={asideContent}>
                <AuthCard
                    title={isEn ? 'Verify your account' : 'Verificar conta'}
                    description={
                        isEn
                            ? 'No active verification session was found in this browser.'
                            : 'Nenhuma sessão de verificação ativa foi encontrada neste navegador.'
                    }
                >
                    <div className="space-y-4">
                        <Alert tone="info">
                            {isEn
                                ? 'Already registered? Sign in with your email and password and we will automatically send you a new verification code.'
                                : 'Já criou a sua conta? Inicie sessão com o seu e-mail e senha para receber automaticamente um novo código de verificação.'}
                        </Alert>

                        <Link
                            to={loginUrl}
                            className={buttonVariants({ variant: 'brand', size: 'lg', fullWidth: true })}
                        >
                            <LogIn size={17} aria-hidden />
                            {isEn ? 'Sign in to verify account' : 'Entrar para verificar conta'}
                        </Link>

                        <div className="text-center text-xs text-fg-muted">
                            {isEn ? "Don't have an account yet? " : 'Ainda não tem conta? '}
                            <Link
                                to={registerBackUrl}
                                className="font-semibold text-accent-fg transition-colors hover:text-accent-hover"
                            >
                                {isEn ? 'Create account' : 'Criar conta'}
                            </Link>
                        </div>
                    </div>
                </AuthCard>
            </AuthLayout>
        );
    }

    return (
        <AuthLayout asideSide="right" aside={asideContent}>
            <AuthCard
                title={isEn ? 'Verify your account' : 'Verificar conta'}
                description={
                    isEn
                        ? `Enter the 6-digit verification code sent to ${pending.emailMasked || pending.email || 'your email'}.`
                        : `Introduza o código de 6 dígitos enviado para ${pending.emailMasked || pending.email || 'o seu e-mail'}.`
                }
                footer={
                    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
                        <Link
                            to={registerBackUrl}
                            onClick={clearPendingVerification}
                            className="inline-flex items-center gap-1.5 font-semibold text-accent-fg transition-colors hover:text-accent-hover"
                        >
                            <ArrowLeft size={14} />
                            {isEn ? 'Use a different email or phone' : 'Alterar dados ou e-mail'}
                        </Link>
                        <span className="text-fg-subtle">·</span>
                        <Link
                            to={loginUrl}
                            onClick={clearPendingVerification}
                            className="font-semibold text-fg-muted transition-colors hover:text-fg"
                        >
                            {isEn ? 'Sign in' : 'Ir para login'}
                        </Link>
                    </div>
                }
            >
                <div className="mb-5 flex items-center gap-3 rounded-xl border border-accent/25 bg-accent/10 px-3.5 py-3 text-xs text-fg">
                    <MailCheck size={18} className="shrink-0 text-accent-fg" />
                    <div className="min-w-0">
                        <p className="font-semibold text-fg">
                            {isEn ? 'Verification code active (15 min)' : 'Código de verificação ativo (15 min)'}
                        </p>
                        <p className="truncate font-mono text-[11px] text-fg-muted">
                            {pending.emailMasked || pending.email}
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
                    {error && (
                        <Alert tone="error">
                            <div className="space-y-2">
                                <p>{error}</p>
                                {sessionExpiredError && (
                                    <Link
                                        to={loginUrl}
                                        onClick={clearPendingVerification}
                                        className="inline-flex items-center gap-1.5 font-semibold underline hover:opacity-80"
                                    >
                                        <LogIn size={13} />
                                        {isEn ? 'Go to Sign In' : 'Ir para o Login'}
                                    </Link>
                                )}
                            </div>
                        </Alert>
                    )}

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
