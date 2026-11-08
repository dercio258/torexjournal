import React, { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api';
import { AuthLayout } from '../layouts/AuthLayout';
import { AuthCard, AuthIcon } from '../components/auth/AuthCard';
import { OtpInput, OtpInputHandle } from '../components/ui/OtpInput';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';
import { useCountdown } from '../hooks/useCountdown';
import { getApiMessage, isRateLimited, parseRetryAfter } from '../lib/authErrors';

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
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const twoFactorToken = params.get('twoFactorToken');
    const email = decodeJwtEmail(twoFactorToken);

    const [code, setCode] = useState<string[]>(emptyCode);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(
        twoFactorToken ? null : 'Sessão de autenticação inválida. Por favor, volte ao login.'
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
                setSuccess('Verificado com sucesso! Redirecionando...');
                window.setTimeout(() => {
                    login(res.data.token);
                    navigate('/dashboard');
                }, 1000);
            } else {
                setError(res.data.message || 'Código inválido');
                resetCode();
            }
        } catch (err) {
            const message = getApiMessage(err, 'Erro ao verificar código');
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
            setError(`Por favor, insira o código de ${CODE_LENGTH} dígitos.`);
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
                setSuccess('Um novo código de verificação foi enviado para o seu e-mail.');
                resend.start(RESEND_COOLDOWN_S);
                resetCode();
            } else {
                setError(res.data.message || 'Erro ao reenviar o código.');
            }
        } catch (err) {
            setError(getApiMessage(err, 'Erro ao solicitar novo código.'));
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
                back={{ to: '/login', label: 'Voltar para login' }}
                icon={
                    <AuthIcon>
                        <ShieldCheck size={22} aria-hidden />
                    </AuthIcon>
                }
                title="Verificação em duas etapas"
                description={
                    <>
                        Insira o código de {CODE_LENGTH} dígitos enviado para{' '}
                        <b className="font-semibold text-accent-fg">{email ?? 'seu e-mail cadastrado'}</b>.
                    </>
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
                        {lockout.active ? `Aguarde ${lockout.remaining}s` : 'Verificar código'}
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
                        {resend.active ? `Reenviar código em ${resend.remaining}s` : 'Não recebeu o código? Reenviar por e-mail'}
                    </Button>
                </div>
            </AuthCard>
        </AuthLayout>
    );
};
