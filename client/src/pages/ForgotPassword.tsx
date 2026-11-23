import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound, Lock, Mail } from 'lucide-react';
import api from '../api';
import { useLocale } from '../context/LocaleContext';
import { AuthLayout } from '../layouts/AuthLayout';
import { AuthCard, AuthIcon } from '../components/auth/AuthCard';
import { CloudflareTurnstile } from '../components/auth/CloudflareTurnstile';
import { PasswordStrengthChecklist } from '../components/auth/PasswordStrengthChecklist';
import { Input } from '../components/ui/Input';
import { PasswordInput } from '../components/ui/PasswordInput';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';
import { useCountdown } from '../hooks/useCountdown';
import { EMAIL_RE, getApiMessage } from '../lib/authErrors';
import { evaluatePasswordStrength } from '../lib/registrationValidation';

const RESEND_COOLDOWN_S = 300;

/**
 * Two-step password recovery:
 *  1. request a code by e-mail (backend returns a signed token + sig);
 *  2. submit code + new password.
 * Step 2 is entered directly from the e-mail link (`?recover=true&email&token&sig`).
 */
export const ForgotPassword = () => {
    const navigate = useNavigate();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const [params] = useSearchParams();

    const fromLink = params.get('recover') === 'true' && !!params.get('token') && !!params.get('sig');

    const [email, setEmail] = useState(params.get('email') ?? '');
    const [token, setToken] = useState(fromLink ? params.get('token')! : '');
    const [sig, setSig] = useState(fromLink ? params.get('sig')! : '');
    const [step, setStep] = useState<'request' | 'reset'>(fromLink ? 'reset' : 'request');

    const [code, setCode] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<'email' | 'code' | 'password', string>>>({});
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [done, setDone] = useState(false);
    const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
    const [turnstileRequired, setTurnstileRequired] = useState(false);
    const [turnstileReset, setTurnstileReset] = useState(0);
    const resend = useCountdown();

    useEffect(() => {
        if (fromLink && window.location.search) {
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }, [fromLink]);

    const requestCode = async () => {
        setError(null);
        setSuccess(null);
        if (!EMAIL_RE.test(email.trim())) {
            setFieldErrors({ email: isEn ? 'Enter a valid email address.' : 'Informe um e-mail válido.' });
            return;
        }
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            setError(
                isEn
                    ? 'You are offline. Reconnect to request a recovery code.'
                    : 'Sem ligação à internet. Reconecte-se para solicitar o código.',
            );
            return;
        }
        if (turnstileRequired && !turnstileToken) {
            setError(
                isEn
                    ? 'Complete the Cloudflare security verification to continue.'
                    : 'Conclua a verificação de segurança Cloudflare para continuar.',
            );
            return;
        }
        setFieldErrors({});
        setIsLoading(true);
        try {
            const res = await api.post('/auth/forgot-password', {
                email: email.trim(),
                ...(turnstileToken ? { turnstileToken } : {}),
            });
            if (!res.data.success) {
                setTurnstileReset((n) => n + 1);
                setError(res.data.message || (isEn ? 'Failed to send recovery code.' : 'Erro ao enviar código.'));
                return;
            }
            setToken('');
            setSig('');
            setStep('reset');
            resend.start(RESEND_COOLDOWN_S);
            setSuccess(
                res.data.message ||
                    (isEn
                        ? 'If this email is registered, we have sent a recovery code.'
                        : 'Se o e-mail estiver registado, enviaremos um código de recuperação.')
            );
        } catch (err) {
            setTurnstileReset((n) => n + 1);
            setError(
                getApiMessage(err, isEn ? 'Unable to connect to the server.' : 'Erro ao conectar com o servidor')
            );
        } finally {
            setIsLoading(false);
        }
    };

    const handleRequest = (e: React.FormEvent) => {
        e.preventDefault();
        requestCode();
    };

    const passwordEvaluation = useMemo(
        () => evaluatePasswordStrength(newPassword, { email }),
        [newPassword, email],
    );

    const handleReset = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);

        const errors: typeof fieldErrors = {};
        if (!code.trim()) errors.code = isEn ? 'Enter the recovery code.' : 'Informe o código recebido.';
        if (!passwordEvaluation.valid) {
            errors.password = isEn
                ? passwordEvaluation.errorEn || 'Password does not meet security requirements.'
                : passwordEvaluation.errorPt || 'A senha não cumpre os requisitos de segurança.';
        }
        setFieldErrors(errors);
        if (Object.keys(errors).length) return;

        setIsLoading(true);
        try {
            const payload: Record<string, string> = {
                email: email.trim(),
                code: code.trim(),
                newPassword,
            };
            if (token && sig) {
                payload.token = token;
                payload.sig = sig;
            }
            const res = await api.post('/auth/reset-password', payload);
            if (res.data.success || res.status === 200 || res.status === 201) {
                setDone(true);
                setSuccess(
                    isEn
                        ? 'Password updated successfully! Redirecting to sign in...'
                        : 'Senha redefinida com sucesso! Redirecionando para o login...'
                );
                window.setTimeout(() => navigate('/login', { replace: true }), 2000);
            } else {
                setError(res.data.message || (isEn ? 'Failed to reset password.' : 'Erro ao redefinir senha.'));
            }
        } catch (err) {
            setError(
                getApiMessage(err, isEn ? 'Unable to complete request.' : 'Erro ao realizar a solicitação.')
            );
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <AuthLayout>
            <AuthCard
                back={{ to: '/login', label: isEn ? 'Back to sign in' : 'Voltar para login' }}
                icon={
                    <AuthIcon>
                        <KeyRound size={22} aria-hidden />
                    </AuthIcon>
                }
                title={isEn ? 'Reset Password' : 'Recuperar senha'}
                description={
                    step === 'request'
                        ? isEn
                            ? 'Enter your registered email to receive a password recovery code.'
                            : 'Informe seu e-mail cadastrado para receber um código de recuperação.'
                        : isEn
                          ? (
                                <>
                                    Enter the code sent to <b className="text-fg">{email}</b> and set a new password.
                                </>
                            )
                          : (
                                <>
                                    Insira o código enviado para <b className="text-fg">{email}</b> e defina uma nova senha.
                                </>
                            )
                }
            >
                {step === 'request' ? (
                    <form onSubmit={handleRequest} noValidate className="space-y-6">
                        <Input
                            variant="field"
                            label={isEn ? 'Registered email' : 'E-mail cadastrado'}
                            type="email"
                            autoComplete="email"
                            placeholder={isEn ? 'trader@torexjournal.com' : 'exemplo@torex.com'}
                            icon={<Mail size={18} />}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            error={fieldErrors.email}
                            autoFocus
                        />
                        <CloudflareTurnstile
                            action="forgot_password"
                            resetTrigger={turnstileReset}
                            onTokenChange={setTurnstileToken}
                            onRequirementChange={setTurnstileRequired}
                        />
                        {error && <Alert tone="error">{error}</Alert>}
                        <Button type="submit" variant="brand" size="lg" fullWidth isLoading={isLoading}>
                            {isEn ? 'Send Recovery Code' : 'Enviar código de recuperação'}
                        </Button>
                    </form>
                ) : (
                    <form onSubmit={handleReset} noValidate className="space-y-5">
                        <Input
                            variant="field"
                            label={isEn ? 'Verification code' : 'Código de verificação'}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            placeholder="123456"
                            maxLength={6}
                            icon={<Lock size={18} />}
                            value={code}
                            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                            error={fieldErrors.code}
                            className="font-mono tracking-[0.3em]"
                            autoFocus
                        />
                        <div>
                            <PasswordInput
                                label={isEn ? 'New password' : 'Nova senha'}
                                autoComplete="new-password"
                                placeholder="••••••••"
                                icon={<Lock size={18} />}
                                value={newPassword}
                                onChange={(e) => {
                                    setNewPassword(e.target.value);
                                    if (fieldErrors.password) {
                                        setFieldErrors((fe) => ({ ...fe, password: undefined }));
                                    }
                                }}
                                error={fieldErrors.password}
                            />
                            <PasswordStrengthChecklist
                                password={newPassword}
                                evaluation={passwordEvaluation}
                                locale={isEn ? 'en' : 'pt'}
                            />
                        </div>

                        {error && <Alert tone="error">{error}</Alert>}
                        {success && <Alert tone="success">{success}</Alert>}

                        <Button type="submit" variant="brand" size="lg" fullWidth isLoading={isLoading} disabled={done}>
                            {isEn ? 'Reset Password' : 'Redefinir senha'}
                        </Button>

                        <div className="text-center">
                            <Button
                                type="button"
                                variant="link"
                                className="text-xs"
                                onClick={requestCode}
                                disabled={resend.active || isLoading || !email}
                            >
                                {resend.active
                                    ? isEn
                                        ? `Wait ${resend.remaining}s to resend`
                                        : `Aguarde ${resend.remaining}s para reenviar`
                                    : isEn
                                      ? "Didn't receive a code? Resend"
                                      : 'Não recebeu o código? Reenviar'}
                            </Button>
                        </div>
                    </form>
                )}
            </AuthCard>
        </AuthLayout>
    );
};
