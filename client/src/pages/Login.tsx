import React, { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Lock, Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api';
import { AuthLayout } from '../layouts/AuthLayout';
import { AuthCard } from '../components/auth/AuthCard';
import { AuthAside } from '../components/auth/AuthAside';
import { OAuthButtons } from '../components/auth/OAuthButtons';
import { Input } from '../components/ui/Input';
import { PasswordInput } from '../components/ui/PasswordInput';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';
import { useCountdown } from '../hooks/useCountdown';
import { EMAIL_RE, getApiMessage, isRateLimited, parseRetryAfter } from '../lib/authErrors';

type FieldErrors = Partial<Record<'email' | 'password', string>>;

/**
 * Backward compatibility: e-mails already sent by the backend link to
 * `/login?recover=true&...`, and older social flows used
 * `/login?twoFactorRequired=true&userId=...`. Forward them to the new routes.
 */
const useLegacyRedirect = (): string | null => {
    const { search } = useLocation();
    const params = new URLSearchParams(search);
    if (params.get('recover') === 'true' && params.get('email') && params.get('token') && params.get('sig')) {
        return `/forgot-password${search}`;
    }
    const userId = params.get('userId');
    if (params.get('twoFactorRequired') === 'true' && userId) {
        // Backend's verify/resend endpoints accept the userId in place of a token.
        return `/2fa?twoFactorToken=${encodeURIComponent(userId)}`;
    }
    return null;
};

export const Login = () => {
    const { login } = useAuth();
    const navigate = useNavigate();
    const legacyRedirect = useLegacyRedirect();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const cooldown = useCountdown();

    if (legacyRedirect) return <Navigate to={legacyRedirect} replace />;

    const validate = (): FieldErrors => {
        const errors: FieldErrors = {};
        if (!email.trim()) errors.email = 'Informe seu e-mail.';
        else if (!EMAIL_RE.test(email.trim())) errors.email = 'E-mail inválido.';
        if (!password) errors.password = 'Informe sua senha.';
        return errors;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        const errors = validate();
        setFieldErrors(errors);
        if (Object.keys(errors).length) return;

        setIsLoading(true);
        try {
            const res = await api.post('/auth/login', { email: email.trim(), password });
            if (!res.data.success) {
                setError(res.data.message || 'Credenciais inválidas');
                return;
            }
            if (res.data.twoFactorRequired) {
                navigate(`/2fa?twoFactorToken=${encodeURIComponent(res.data.twoFactorToken)}`);
            } else {
                login(res.data.token);
                navigate('/dashboard');
            }
        } catch (err) {
            const message = getApiMessage(err, 'Erro ao conectar com o servidor');
            setError(message);
            if (isRateLimited(err)) cooldown.start(parseRetryAfter(message, 60));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <AuthLayout
            aside={
                <AuthAside
                    eyebrow="Sincronização em tempo real com MT5"
                    title={
                        <>
                            Transforme dados em <span className="text-accent-fg">consistência.</span>
                        </>
                    }
                    description="Acesse seu diário automatizado e descubra os padrões que estão drenando ou alavancando seu capital."
                    highlights={[
                        'Importação automática das suas operações',
                        'Relatórios de performance e calendário de P&L',
                        'Diário emocional integrado à sua rotina',
                    ]}
                />
            }
        >
            <AuthCard
                title="Bem-vindo de volta"
                description="Insira suas credenciais para acessar o painel."
                footer={
                    <>
                        Não tem uma conta?{' '}
                        <Link to="/register" className="font-bold text-accent-fg transition-colors hover:text-accent-hover">
                            Começar teste grátis
                        </Link>
                    </>
                }
            >
                <form onSubmit={handleSubmit} noValidate className="space-y-5">
                    <Input
                        variant="field"
                        label="E-mail"
                        name="email"
                        type="email"
                        autoComplete="email"
                        placeholder="exemplo@torex.com"
                        icon={<Mail size={18} />}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        error={fieldErrors.email}
                        autoFocus
                    />

                    <div className="space-y-2">
                        <PasswordInput
                            label="Senha"
                            name="password"
                            autoComplete="current-password"
                            placeholder="••••••••"
                            icon={<Lock size={18} />}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            error={fieldErrors.password}
                        />
                        <div className="flex justify-end">
                            <Link
                                to="/forgot-password"
                                className="text-xs font-semibold text-accent-fg transition-colors hover:text-accent-hover"
                            >
                                Esqueceu a senha?
                            </Link>
                        </div>
                    </div>

                    {error && <Alert tone="error">{error}</Alert>}

                    <Button
                        type="submit"
                        variant="brand"
                        size="lg"
                        fullWidth
                        isLoading={isLoading}
                        disabled={cooldown.active}
                        iconRight={!cooldown.active && <ArrowRight size={18} aria-hidden />}
                    >
                        {cooldown.active ? `Aguarde ${cooldown.remaining}s` : 'Entrar na Plataforma'}
                    </Button>
                </form>

                <OAuthButtons className="mt-7" />
            </AuthCard>
        </AuthLayout>
    );
};
