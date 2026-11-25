import React, { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, BrainCircuit, History, Lock, Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import api from '../api';
import { AuthLayout } from '../layouts/AuthLayout';
import { AuthCard } from '../components/auth/AuthCard';
import { AuthAside } from '../components/auth/AuthAside';
import { OAuthButtons } from '../components/auth/OAuthButtons';
import { CloudflareTurnstile } from '../components/auth/CloudflareTurnstile';
import { LanguageSwitcher } from '../components/ui/LanguageSwitcher';
import { Input } from '../components/ui/Input';
import { PasswordInput } from '../components/ui/PasswordInput';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';
import { useCountdown } from '../hooks/useCountdown';
import { EMAIL_RE, getApiMessage, isRateLimited, parseRetryAfter } from '../lib/authErrors';
import { mergeSessionUtmsIntoSearch, sanitizeReturnTo } from '../lib/attribution';
import { savePendingVerification } from '../lib/pendingVerification';
import { identifyUserOnTracker, trackConversion } from '../lib/tracking';

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
        const nextParams = new URLSearchParams();
        nextParams.set('twoFactorToken', userId);
        const safeReturnTo = sanitizeReturnTo(params.get('returnTo'));
        if (safeReturnTo) nextParams.set('returnTo', safeReturnTo);
        return `/2fa?${nextParams.toString()}`;
    }
    return null;
};

export const Login = () => {
    const { login } = useAuth();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const legacyRedirect = useLegacyRedirect();

    const safeReturnTo = sanitizeReturnTo(searchParams.get('returnTo'));
    const sessionExpired = searchParams.get('reason') === 'session_expired';
    const infoMessage = (location.state as { infoMessage?: string } | null)?.infoMessage || null;

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
    const [turnstileRequired, setTurnstileRequired] = useState(false);
    const [turnstileReset, setTurnstileReset] = useState(0);
    const cooldown = useCountdown();

    if (legacyRedirect) return <Navigate to={legacyRedirect} replace />;

    const registerBaseSearch = safeReturnTo ? `?returnTo=${encodeURIComponent(safeReturnTo)}` : '';
    const registerSearch = mergeSessionUtmsIntoSearch(registerBaseSearch);

    const validate = (): FieldErrors => {
        const errors: FieldErrors = {};
        if (!email.trim()) errors.email = isEn ? 'Enter your email address.' : 'Informe seu e-mail.';
        else if (!EMAIL_RE.test(email.trim())) errors.email = isEn ? 'Enter a valid email address.' : 'E-mail inválido.';
        if (!password) errors.password = isEn ? 'Enter your password.' : 'Informe sua senha.';
        return errors;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        const errors = validate();
        setFieldErrors(errors);
        if (Object.keys(errors).length) return;
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            setError(
                isEn
                    ? 'You are offline. Reconnect to sign in.'
                    : 'Sem ligação à internet. Reconecte-se para fazer login.',
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

        setIsLoading(true);
        try {
            const res = await api.post('/auth/login', {
                email: email.trim(),
                password,
                ...(turnstileToken ? { turnstileToken } : {}),
            });
            if (!res.data.success) {
                setError(res.data.message || (isEn ? 'Invalid credentials.' : 'Credenciais inválidas'));
                setTurnstileReset((n) => n + 1);
                return;
            }
            if (res.data.requiresEmailVerification && res.data.verificationToken) {
                const pending = {
                    verificationToken: res.data.verificationToken,
                    emailMasked: res.data.emailMasked || email.trim(),
                    returnTo: safeReturnTo,
                    fromLogin: true,
                    codeSent: res.data.codeSent !== false,
                };
                savePendingVerification(pending);
                navigate('/verify-account', {
                    replace: true,
                    state: { pendingVerification: pending },
                });
                return;
            }
            if (res.data.twoFactorRequired) {
                const nextParams = new URLSearchParams();
                nextParams.set('twoFactorToken', res.data.twoFactorToken);
                if (safeReturnTo) nextParams.set('returnTo', safeReturnTo);
                navigate(`/2fa?${nextParams.toString()}`);
            } else {
                login(res.data.token);
                void identifyUserOnTracker();
                trackConversion('login', { metadata: { method: 'email_password' } });
                navigate(safeReturnTo || '/dashboard', { replace: true });
            }
        } catch (err) {
            const message = getApiMessage(
                err,
                isEn ? 'Unable to reach authentication server.' : 'Erro ao conectar com o servidor'
            );
            setError(message);
            setTurnstileReset((n) => n + 1);
            if (isRateLimited(err)) cooldown.start(parseRetryAfter(message, 60));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <AuthLayout
            showHeader={false}
            alignTop
            aside={
                <AuthAside
                    title={
                        isEn ? (
                            <>
                                Backtest your setups. <span className="text-accent-fg">Let AI sharpen the edge.</span>
                            </>
                        ) : (
                            <>
                                Transforme dados em <span className="text-accent-fg">consistência.</span>
                            </>
                        )
                    }
                    description={
                        isEn
                            ? 'Replay historical market sessions candle-by-candle, stress-test risk rules before risking live equity, and let our AI engine isolate the exact behaviors driving your expectancy.'
                            : 'Acesse seu diário automatizado, valide cenários em backtest histórico e descubra com IA os padrões que estão drenando ou alavancando seu capital.'
                    }
                    highlights={
                        isEn
                            ? [
                                  'Multi-timeframe Market Replay & Strategy Backtester',
                                  'AI Trade Copilot diagnosing execution leaks & expectancy',
                                  'MT5 & Deriv sync with Net P&L, Profit Factor & R-multiple stats',
                              ]
                            : [
                                  'Importação automática das suas operações MT5 e Deriv',
                                  'Backtest histórico e diagnóstico inteligente por IA',
                                  'Relatórios de performance e calendário de P&L',
                              ]
                    }
                    footer={
                        <div className="grid grid-cols-2 gap-3.5 pt-2">
                            <div className="rounded-xl border border-line bg-raised/70 p-4 backdrop-blur-md">
                                <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-accent-fg">
                                    <BrainCircuit size={15} aria-hidden />
                                    <span>{isEn ? 'AI Diagnostics' : 'IA Analítica'}</span>
                                </div>
                                <p className="text-xs leading-relaxed text-fg-muted">
                                    {isEn
                                        ? 'Detects tilt cycles, session edge decay, and optimal R:R windows automatically.'
                                        : 'Identifica padrões emocionais, horários lucrativos e gargalos de execução.'}
                                </p>
                            </div>
                            <div className="rounded-xl border border-line bg-raised/70 p-4 backdrop-blur-md">
                                <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-accent-fg">
                                    <History size={15} aria-hidden />
                                    <span>{isEn ? 'Backtest Lab' : 'Laboratório Backtest'}</span>
                                </div>
                                <p className="text-xs leading-relaxed text-fg-muted">
                                    {isEn
                                        ? 'Simulate setups tick-by-tick across historical feeds before deploying real capital.'
                                        : 'Simule entradas vela a vela em dados históricos antes de operar em conta real.'}
                                </p>
                            </div>
                        </div>
                    }
                />
            }
        >
            <AuthCard
                afterLogo={<LanguageSwitcher variant="pill" />}
                title={isEn ? 'Welcome back' : 'Bem-vindo de volta'}
                description={
                    isEn
                        ? 'Sign in to launch AI trade diagnostics and historical strategy backtests.'
                        : 'Insira suas credenciais para acessar o painel.'
                }
                footer={
                    isEn ? (
                        <>
                            New to Torex Journal?{' '}
                            <Link to={`/register${registerSearch}`} className="font-bold text-accent-fg transition-colors hover:text-accent-hover">
                                Start free workspace
                            </Link>
                        </>
                    ) : (
                        <>
                            Não tem uma conta?{' '}
                            <Link to={`/register${registerSearch}`} className="font-bold text-accent-fg transition-colors hover:text-accent-hover">
                                Começar teste grátis
                            </Link>
                        </>
                    )
                }
            >
                <form onSubmit={handleSubmit} noValidate className="space-y-5">
                    {infoMessage && !error && <Alert tone="info">{infoMessage}</Alert>}
                    {sessionExpired && !error && !infoMessage && (
                        <Alert tone="info">
                            {isEn
                                ? 'Your session expired for security. Sign in again to resume where you left off.'
                                : 'Sua sessão expirou por segurança. Faça login novamente para continuar de onde parou.'}
                        </Alert>
                    )}

                    <Input
                        variant="field"
                        label={isEn ? 'Email' : 'E-mail'}
                        name="email"
                        type="email"
                        autoComplete="email"
                        placeholder={isEn ? 'trader@torexjournal.com' : 'exemplo@torex.com'}
                        icon={<Mail size={18} />}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        error={fieldErrors.email}
                        autoFocus
                    />

                    <div className="space-y-2">
                        <PasswordInput
                            label={isEn ? 'Password' : 'Senha'}
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
                                {isEn ? 'Forgot password?' : 'Esqueceu a senha?'}
                            </Link>
                        </div>
                    </div>

                    <CloudflareTurnstile
                        action="login"
                        resetTrigger={turnstileReset}
                        onTokenChange={setTurnstileToken}
                        onRequirementChange={setTurnstileRequired}
                    />

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
                        {cooldown.active
                            ? isEn
                                ? `Wait ${cooldown.remaining}s`
                                : `Aguarde ${cooldown.remaining}s`
                            : isEn
                              ? 'Launch Workspace'
                              : 'Entrar na Plataforma'}
                    </Button>
                </form>

                <OAuthButtons className="mt-7" />
            </AuthCard>
        </AuthLayout>
    );
};
