import React, { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import api from '../api';
import { AuthLayout } from '../layouts/AuthLayout';
import { AuthCard, AuthIcon } from '../components/auth/AuthCard';
import { OtpInput, OtpInputHandle } from '../components/ui/OtpInput';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';
import { useCountdown } from '../hooks/useCountdown';
import { getApiMessage, isRateLimited, parseRetryAfter } from '../lib/authErrors';
import { sanitizeReturnTo } from '../lib/attribution';

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_S = 300;
const emptyCode = () => Array<string>(CODE_LENGTH).fill('');

/** Reads the `email` claim from the temporary 2FA JWT (display only — never trusted). */
const decodeJwtEmail = (token: string | null): string | null => {
    if (!token) return null;
    try {
        const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const json = decodeURIComponent(
            atob(base64)
                .split('')
                .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
                .join('')
        );
        return JSON.parse(json).email || null;
    } catch {
        return null;
    }
};

export const TwoFactorVerify = () => {
    const { login } = useAuth();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const twoFactorToken = params.get('twoFactorToken');
    const safeReturnTo = sanitizeReturnTo(params.get('returnTo'));
    const email = decodeJwtEmail(twoFactorToken);

    const [code, setCode] = useState<string[]>(emptyCode);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(
        twoFactorToken
            ? null
            : isEn
              ? 'Invalid verification session. Please sign in again.'
              : 'Sessão de autenticação inválida. Por favor, volte ao login.'
    );
    const [success, setSuccess] = useState<string | null>(null);
    const [verified, setVerified] = useState(false);
    const resend = useCountdown();
    const lockout = useCountdown();
    const otpRef = useRef<OtpInputHandle>(null);

    const resetCode = () => {
        setCode(emptyCode());
        otpRef.current?.focus(0);
    };

    const verify = async (value: string) => {
        if (value.length !== CODE_LENGTH || !twoFactorToken || lockout.active) return;
        setIsLoading(true);
        setError(null);
        setSuccess(null);
        try {
            const res = await api.post('/auth/verify-2fa', { twoFactorToken, otp: value });
            if (res.data.success) {
                setVerified(true);
                setSuccess(isEn ? 'Verified! Redirecting to workspace...' : 'Verificado com sucesso! Redirecionando...');
                window.setTimeout(() => {
                    login(res.data.token);
                    navigate(safeReturnTo || '/dashboard', { replace: true });
                }, 1000);
            } else {
                setError(res.data.message || (isEn ? 'Invalid code' : 'Código inválido'));
                resetCode();
            }
        } catch (err) {
            const message = getApiMessage(err, isEn ? 'Unable to verify code.' : 'Erro ao verificar código');
            setError(message);
            resetCode();
            if (isRateLimited(err)) lockout.start(parseRetryAfter(message, RESEND_COOLDOWN_S));
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const value = code.join('');
        if (value.length !== CODE_LENGTH) {
            setError(
                isEn
                    ? `Please enter the ${CODE_LENGTH}-digit code.`
                    : `Por favor, insira o código de ${CODE_LENGTH} dígitos.`
            );
            return;
        }
        verify(value);
    };

    const handleResend = async () => {
        if (!twoFactorToken) return;
        setIsLoading(true);
        setError(null);
        setSuccess(null);
        try {
            const res = await api.post('/auth/resend-2fa', { twoFactorToken });
            if (res.data.success) {
                setSuccess(
                    isEn
                        ? 'A new verification code was sent to your email.'
                        : 'Um novo código de verificação foi enviado para o seu e-mail.'
                );
                resend.start(RESEND_COOLDOWN_S);
                resetCode();
            } else {
                setError(res.data.message || (isEn ? 'Failed to resend code.' : 'Erro ao reenviar o código.'));
            }
        } catch (err) {
            setError(getApiMessage(err, isEn ? 'Failed to request new code.' : 'Erro ao solicitar novo código.'));
            if (isRateLimited(err)) resend.start(RESEND_COOLDOWN_S);
        } finally {
            setIsLoading(false);
        }
    };

    const isComplete = code.every(Boolean);
    const locked = !twoFactorToken || verified;

    return (
        <AuthLayout>
            <AuthCard
                back={{
                    to: safeReturnTo ? `/login?returnTo=${encodeURIComponent(safeReturnTo)}` : '/login',
                    label: isEn ? 'Back to sign in' : 'Voltar para login',
                }}
                icon={
                    <AuthIcon>
                        <ShieldCheck size={22} aria-hidden />
                    </AuthIcon>
                }
                title={isEn ? 'Two-Factor Verification' : 'Verificação em duas etapas'}
                description={
                    isEn ? (
                        <>
                            Enter the {CODE_LENGTH}-digit security code sent to{' '}
                            <b className="font-semibold text-accent-fg">{email ?? 'your registered email'}</b>.
                        </>
                    ) : (
                        <>
                            Insira o código de {CODE_LENGTH} dígitos enviado para{' '}
                            <b className="font-semibold text-accent-fg">{email ?? 'seu e-mail cadastrado'}</b>.
                        </>
                    )
                }
            >
                <form onSubmit={handleSubmit} noValidate className="space-y-6">
                    <OtpInput
                        ref={otpRef}
                        value={code}
                        onChange={setCode}
                        onComplete={verify}
                        length={CODE_LENGTH}
                        disabled={locked}
                        invalid={!!error && !!twoFactorToken}
                        autoFocus
                    />

                    {error && <Alert tone="error">{error}</Alert>}
                    {success && <Alert tone="success">{success}</Alert>}

                    <Button
                        type="submit"
                        variant="brand"
                        size="lg"
                        fullWidth
                        isLoading={isLoading}
                        disabled={locked || !isComplete || lockout.active}
                        iconRight={!lockout.active && <ArrowRight size={18} aria-hidden />}
                    >
                        {lockout.active
                            ? isEn
                                ? `Wait ${lockout.remaining}s`
                                : `Aguarde ${lockout.remaining}s`
                            : isEn
                              ? 'Verify Code'
                              : 'Verificar código'}
                    </Button>
                </form>

                <div className="mt-8 border-t border-line pt-5 text-center">
                    <Button
                        type="button"
                        variant="link"
                        className="text-xs"
                        onClick={handleResend}
                        disabled={locked || resend.active || isLoading}
                        icon={<RefreshCw size={12} aria-hidden />}
                    >
                        {resend.active
                            ? isEn
                                ? `Resend code in ${resend.remaining}s`
                                : `Reenviar código em ${resend.remaining}s`
                            : isEn
                              ? "Didn't receive a code? Resend via email"
                              : 'Não recebeu o código? Reenviar por e-mail'}
                    </Button>
                </div>
            </AuthCard>
        </AuthLayout>
    );
};
