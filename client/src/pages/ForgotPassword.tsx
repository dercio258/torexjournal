import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound, Lock, Mail } from 'lucide-react';
import api from '../api';
import { AuthLayout } from '../layouts/AuthLayout';
import { AuthCard, AuthIcon } from '../components/auth/AuthCard';
import { Input } from '../components/ui/Input';
import { PasswordInput } from '../components/ui/PasswordInput';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';
import { useCountdown } from '../hooks/useCountdown';
import { EMAIL_RE, MIN_PASSWORD_LENGTH, getApiMessage } from '../lib/authErrors';

const RESEND_COOLDOWN_S = 300;

/**
 * Two-step password recovery:
 *  1. request a code by e-mail (backend returns a signed token + sig);
 *  2. submit code + new password.
 * Step 2 is entered directly from the e-mail link (`?recover=true&email&token&sig`).
 */
export const ForgotPassword = () => {
    const navigate = useNavigate();
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
    const resend = useCountdown();

    const requestCode = async () => {
        setError(null);
        setSuccess(null);
        if (!EMAIL_RE.test(email.trim())) {
            setFieldErrors({ email: 'Informe um e-mail válido.' });
            return;
        }
        setFieldErrors({});
        setIsLoading(true);
        try {
            const res = await api.post('/auth/forgot-password', { email: email.trim() });
            if (!res.data.success) {
                setError(res.data.message || 'Erro ao enviar código.');
                return;
            }
            setToken(res.data.token);
            setSig(res.data.sig);
            setStep('reset');
            resend.start(RESEND_COOLDOWN_S);
            setSuccess('Código enviado para o seu e-mail.');
        } catch (err) {
            setError(getApiMessage(err, 'Erro ao conectar com o servidor'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleRequest = (e: React.FormEvent) => {
        e.preventDefault();
        requestCode();
    };

    const handleReset = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);

        const errors: typeof fieldErrors = {};
        if (!code.trim()) errors.code = 'Informe o código recebido.';
        if (newPassword.length < MIN_PASSWORD_LENGTH) errors.password = `Mínimo de ${MIN_PASSWORD_LENGTH} caracteres.`;
        setFieldErrors(errors);
        if (Object.keys(errors).length) return;

        setIsLoading(true);
        try {
            const res = await api.post('/auth/reset-password', {
                email: email.trim(),
                code: code.trim(),
                token,
                sig,
                newPassword,
            });
            if (res.data.success || res.status === 200 || res.status === 201) {
                setDone(true);
                setSuccess('Senha redefinida com sucesso! Redirecionando para o login...');
                window.setTimeout(() => navigate('/login', { replace: true }), 2000);
            } else {
                setError(res.data.message || 'Erro ao redefinir senha.');
            }
        } catch (err) {
            setError(getApiMessage(err, 'Erro ao realizar a solicitação.'));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <AuthLayout>
            <AuthCard
                back={{ to: '/login', label: 'Voltar para login' }}
                icon={
                    <AuthIcon>
                        <KeyRound size={22} aria-hidden />
                    </AuthIcon>
                }
                title="Recuperar senha"
                description={
                    step === 'request'
                        ? 'Informe seu e-mail cadastrado para receber um código de recuperação.'
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
                            label="E-mail cadastrado"
                            type="email"
                            autoComplete="email"
                            placeholder="exemplo@torex.com"
                            icon={<Mail size={18} />}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            error={fieldErrors.email}
                            autoFocus
                        />
                        {error && <Alert tone="error">{error}</Alert>}
                        <Button type="submit" variant="brand" size="lg" fullWidth isLoading={isLoading}>
                            Enviar código de recuperação
                        </Button>
                    </form>
                ) : (
                    <form onSubmit={handleReset} noValidate className="space-y-5">
                        <Input
                            variant="field"
                            label="Código de verificação"
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
                        <PasswordInput
                            label="Nova senha"
                            autoComplete="new-password"
                            placeholder="••••••••"
                            icon={<Lock size={18} />}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            error={fieldErrors.password}
                            hint={`Mínimo de ${MIN_PASSWORD_LENGTH} caracteres`}
                        />

                        {error && <Alert tone="error">{error}</Alert>}
                        {success && <Alert tone="success">{success}</Alert>}

                        <Button type="submit" variant="brand" size="lg" fullWidth isLoading={isLoading} disabled={done}>
                            Redefinir senha
                        </Button>

                        <div className="text-center">
                            <Button
                                type="button"
                                variant="link"
                                className="text-xs"
                                onClick={requestCode}
                                disabled={resend.active || isLoading || !email}
                            >
                                {resend.active ? `Aguarde ${resend.remaining}s para reenviar` : 'Não recebeu o código? Reenviar'}
                            </Button>
                        </div>
                    </form>
                )}
            </AuthCard>
        </AuthLayout>
    );
};
