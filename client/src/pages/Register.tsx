import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Lock, Mail, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import api from '../api';
import { AuthLayout } from '../layouts/AuthLayout';
import { AuthCard } from '../components/auth/AuthCard';
import { AuthAside } from '../components/auth/AuthAside';
import { OAuthButtons } from '../components/auth/OAuthButtons';
import { Input } from '../components/ui/Input';
import { PasswordInput } from '../components/ui/PasswordInput';
import { PhoneInput } from '../components/ui/PhoneInput';
import { Checkbox } from '../components/ui/Checkbox';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';
import { useCountdown } from '../hooks/useCountdown';
import { EMAIL_RE, MIN_PASSWORD_LENGTH, getApiMessage, getRegisterErrorMessage } from '../lib/authErrors';
import {
    getAttributionPayload,
    getLightweightClientMetadata,
    getOrCreateVisitorId,
    mergeSessionUtmsIntoSearch,
    sanitizeReturnTo,
} from '../lib/attribution';
import { identifyUserOnTracker, trackConversion } from '../lib/tracking';

const OTP_RESEND_COOLDOWN_S = 60;

type Field = 'name' | 'email' | 'otp' | 'contact' | 'password' | 'terms';
type FieldErrors = Partial<Record<Field, string>>;

const backendMessage = (err: unknown) => getApiMessage(err, '');

export const Register = () => {
    const { login } = useAuth();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const safeReturnTo = sanitizeReturnTo(searchParams.get('returnTo'));

    const [form, setForm] = useState({ name: '', email: '', otp: '', contact: '', password: '' });
    const [dialCode, setDialCode] = useState(isEn ? '+1' : '+55');
    const [terms, setTerms] = useState(false);
    const [otpSent, setOtpSent] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSendingOtp, setIsSendingOtp] = useState(false);
    const otpCooldown = useCountdown();

    const loginBaseSearch = safeReturnTo ? `?returnTo=${encodeURIComponent(safeReturnTo)}` : '';
    const loginSearch = mergeSessionUtmsIntoSearch(loginBaseSearch);

    const update = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = field === 'otp' ? e.target.value.replace(/\D/g, '') : e.target.value;
        setForm((f) => ({ ...f, [field]: value }));
        if (fieldErrors[field]) setFieldErrors((fe) => ({ ...fe, [field]: undefined }));
    };

    const handleSendOtp = async () => {
        setError(null);
        setNotice(null);
        if (!EMAIL_RE.test(form.email.trim())) {
            setFieldErrors((fe) => ({
                ...fe,
                email: isEn
                    ? 'Enter a valid email to receive your code.'
                    : 'Informe um e-mail válido para receber o código.',
            }));
            return;
        }
        setIsSendingOtp(true);
        try {
            const res = await api.post('/auth/send-otp', { email: form.email.trim() });
            if (res.data.success) {
                setOtpSent(true);
                otpCooldown.start(OTP_RESEND_COOLDOWN_S);
                setNotice(
                    isEn
                        ? `Verification code sent to ${form.email.trim()}.`
                        : `Enviamos um código de verificação para ${form.email.trim()}.`
                );
            } else {
                setError(
                    getRegisterErrorMessage(
                        res.data.error || (isEn ? 'Failed to send verification code' : 'Erro ao enviar OTP'),
                        locale
                    )
                );
            }
        } catch (err) {
            setError(getRegisterErrorMessage(backendMessage(err), locale));
        } finally {
            setIsSendingOtp(false);
        }
    };

    const validate = (): FieldErrors => {
        const errors: FieldErrors = {};
        if (!form.name.trim()) errors.name = isEn ? 'Enter your full name.' : 'Informe seu nome.';
        if (!EMAIL_RE.test(form.email.trim()))
            errors.email = isEn ? 'Enter a valid email address.' : 'Informe um e-mail válido.';
        if (!otpSent)
            errors.otp = isEn
                ? 'Request your verification code first.'
                : 'Solicite o código de verificação no botão ao lado.';
        else if (!form.otp)
            errors.otp = isEn
                ? 'Enter the code sent to your email.'
                : 'Digite o código enviado ao seu e-mail.';
        if (form.password.length < MIN_PASSWORD_LENGTH)
            errors.password = isEn
                ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
                : `A senha deve ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres.`;
        if (!terms)
            errors.terms = isEn
                ? 'Accept the Terms of Service to continue.'
                : 'Você deve aceitar os Termos de Uso para continuar.';
        return errors;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        const errors = validate();
        setFieldErrors(errors);
        if (Object.keys(errors).length) return;

        setIsSubmitting(true);
        try {
            const clientMeta = getLightweightClientMetadata();
            const attributionData = getAttributionPayload();

            const res = await api.post('/auth/register', {
                ...form,
                name: form.name.trim(),
                email: form.email.trim(),
                contact: `${dialCode} ${form.contact.trim()}`,
                preferredLocale: locale,
                timezone: clientMeta.timezone,
                visitorId: getOrCreateVisitorId(),
                attributionData,
            });
            if (res.data.success) {
                if (res.data.token) {
                    login(res.data.token);
                    void identifyUserOnTracker();
                }
                trackConversion('signup', {
                    metadata: { method: 'email_otp', locale },
                });
                navigate(safeReturnTo || '/dashboard', { replace: true });
                // Full reload so every context (account, socket) boots with the new session.
                window.location.reload();
            } else {
                setError(getRegisterErrorMessage(res.data.error || res.data.message, locale));
            }
        } catch (err) {
            setError(getRegisterErrorMessage(backendMessage(err), locale));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <AuthLayout
            asideSide="right"
            aside={
                <AuthAside
                    title={
                        isEn ? (
                            <>
                                Build institutional discipline <span className="text-accent-fg">from day one.</span>
                            </>
                        ) : (
                            <>
                                Comece sua jornada rumo à <span className="text-accent-fg">profissionalização.</span>
                            </>
                        )
                    }
                    description={
                        isEn
                            ? 'Launch your workspace in under 60 seconds and sync your live broker or prop account.'
                            : 'Crie sua conta em menos de um minuto e conecte sua corretora.'
                    }
                    highlights={
                        isEn
                            ? [
                                  'Automated MT5, Deriv & Prop Firm execution sync',
                                  'Quantitative Edge Score, Profit Factor & MFE/MAE',
                                  'Integrated Trade Debrief & Pre-Market Checklist',
                                  'Autonomous Daily Drawdown & Tilt guardrails',
                              ]
                            : [
                                  'Sincronização automática com MT4/MT5',
                                  'Análise detalhada de performance quantitativa',
                                  'Diário emocional e psicológico integrado',
                                  'Gestão de risco automatizada',
                              ]
                    }
                />
            }
        >
            <AuthCard
                title={isEn ? 'Create your workspace' : 'Crie sua conta'}
                showLegalNote={false}
                description={
                    isEn
                        ? '7-day full workspace access. No credit card required.'
                        : 'Teste gratuitamente por 14 dias. Sem compromisso.'
                }
                footer={
                    isEn ? (
                        <>
                            Already have an account?{' '}
                            <Link to={`/login${loginSearch}`} className="font-bold text-accent-fg transition-colors hover:text-accent-hover">
                                Sign in
                            </Link>
                        </>
                    ) : (
                        <>
                            Já tem uma conta?{' '}
                            <Link to={`/login${loginSearch}`} className="font-bold text-accent-fg transition-colors hover:text-accent-hover">
                                Fazer login
                            </Link>
                        </>
                    )
                }
            >
                <form onSubmit={handleSubmit} noValidate className="space-y-4">
                    <Input
                        variant="field"
                        name="name"
                        label={isEn ? 'Full name' : 'Nome completo'}
                        autoComplete="name"
                        placeholder={isEn ? 'Alex Morgan' : 'João Silva'}
                        icon={<User size={18} />}
                        value={form.name}
                        onChange={update('name')}
                        error={fieldErrors.name}
                        autoFocus
                    />

                    <Input
                        variant="field"
                        name="email"
                        type="email"
                        label={isEn ? 'Email' : 'E-mail'}
                        autoComplete="email"
                        placeholder={isEn ? 'trader@torexjournal.com' : 'exemplo@torex.com'}
                        icon={<Mail size={18} />}
                        value={form.email}
                        onChange={update('email')}
                        error={fieldErrors.email}
                    />

                    <div className="flex items-start gap-2">
                        <Input
                            variant="field"
                            name="otp"
                            label={isEn ? 'Verification code' : 'Código de verificação'}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            placeholder={
                                otpSent
                                    ? '123456'
                                    : isEn
                                      ? 'Click Send'
                                      : 'Clique em enviar'
                            }
                            maxLength={6}
                            icon={<ShieldCheck size={18} />}
                            value={form.otp}
                            onChange={update('otp')}
                            error={fieldErrors.otp}
                            disabled={!otpSent}
                            wrapperClassName="flex-1"
                            className="font-mono tracking-[0.2em]"
                        />
                        <Button
                            type="button"
                            variant="subtle"
                            size="lg"
                            // Aligns with the input box: label line (16px) + label gap (6px).
                            className="mt-[22px] shrink-0 px-4"
                            onClick={handleSendOtp}
                            isLoading={isSendingOtp}
                            disabled={otpCooldown.active || !form.email}
                        >
                            {otpCooldown.active
                                ? `${otpCooldown.remaining}s`
                                : otpSent
                                  ? isEn
                                    ? 'Resend'
                                    : 'Reenviar'
                                  : isEn
                                    ? 'Send code'
                                    : 'Enviar código'}
                        </Button>
                    </div>

                    {notice && <Alert tone="success">{notice}</Alert>}

                    <PhoneInput
                        name="contact"
                        label={isEn ? 'WhatsApp / Mobile' : 'WhatsApp / Celular'}
                        value={form.contact}
                        onChange={(contact) => setForm((f) => ({ ...f, contact }))}
                        onCountryChange={(c) => setDialCode(c.dialCode)}
                        defaultCountry={isEn ? 'US' : 'BR'}
                        error={fieldErrors.contact}
                    />

                    <PasswordInput
                        name="password"
                        label={isEn ? 'Password' : 'Senha'}
                        autoComplete="new-password"
                        placeholder="••••••••"
                        icon={<Lock size={18} />}
                        value={form.password}
                        onChange={update('password')}
                        error={fieldErrors.password}
                        hint={
                            isEn
                                ? `Minimum ${MIN_PASSWORD_LENGTH} characters`
                                : `Mínimo de ${MIN_PASSWORD_LENGTH} caracteres`
                        }
                    />

                    <Checkbox
                        className="pt-1"
                        checked={terms}
                        onChange={(v) => {
                            setTerms(v);
                            if (v) setFieldErrors((fe) => ({ ...fe, terms: undefined }));
                        }}
                        error={fieldErrors.terms}
                        label={
                            isEn ? (
                                <>
                                    I agree to the{' '}
                                    <Link to="/terms" target="_blank" rel="noopener" className="font-semibold text-accent-fg hover:underline">
                                        Terms of Service
                                    </Link>{' '}
                                    and{' '}
                                    <Link to="/privacy" target="_blank" rel="noopener" className="font-semibold text-accent-fg hover:underline">
                                        Privacy Policy
                                    </Link>
                                    .
                                </>
                            ) : (
                                <>
                                    Aceito os{' '}
                                    <Link to="/terms" target="_blank" rel="noopener" className="font-semibold text-accent-fg hover:underline">
                                        Termos de Uso
                                    </Link>{' '}
                                    e a{' '}
                                    <Link to="/privacy" target="_blank" rel="noopener" className="font-semibold text-accent-fg hover:underline">
                                        Política de Privacidade
                                    </Link>
                                    .
                                </>
                            )
                        }
                    />

                    {error && <Alert tone="error">{error}</Alert>}

                    <Button
                        type="submit"
                        variant="brand"
                        size="lg"
                        fullWidth
                        isLoading={isSubmitting}
                        iconRight={<ArrowRight size={18} aria-hidden />}
                    >
                        {isEn ? 'Create Free Workspace' : 'Criar conta gratuita'}
                    </Button>
                </form>

                <OAuthButtons className="mt-7" />
            </AuthCard>
        </AuthLayout>
    );
};
