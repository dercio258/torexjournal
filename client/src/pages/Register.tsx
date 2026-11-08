import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Lock, Mail, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
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

const OTP_RESEND_COOLDOWN_S = 60;

type Field = 'name' | 'email' | 'otp' | 'contact' | 'password' | 'terms';
type FieldErrors = Partial<Record<Field, string>>;

const backendMessage = (err: unknown) => getApiMessage(err, '');

export const Register = () => {
    const { login } = useAuth();
    const navigate = useNavigate();

    const [form, setForm] = useState({ name: '', email: '', otp: '', contact: '', password: '' });
    const [dialCode, setDialCode] = useState('+55');
    const [terms, setTerms] = useState(false);
    const [otpSent, setOtpSent] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSendingOtp, setIsSendingOtp] = useState(false);
    const otpCooldown = useCountdown();

    const update = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = field === 'otp' ? e.target.value.replace(/\D/g, '') : e.target.value;
        setForm((f) => ({ ...f, [field]: value }));
        if (fieldErrors[field]) setFieldErrors((fe) => ({ ...fe, [field]: undefined }));
    };

    const handleSendOtp = async () => {
        setError(null);
        setNotice(null);
        if (!EMAIL_RE.test(form.email.trim())) {
            setFieldErrors((fe) => ({ ...fe, email: 'Informe um e-mail válido para receber o código.' }));
            return;
        }
        setIsSendingOtp(true);
        try {
            const res = await api.post('/auth/send-otp', { email: form.email.trim() });
            if (res.data.success) {
                setOtpSent(true);
                otpCooldown.start(OTP_RESEND_COOLDOWN_S);
                setNotice(`Enviamos um código de verificação para ${form.email.trim()}.`);
            } else {
                setError(getRegisterErrorMessage(res.data.error || 'Erro ao enviar OTP'));
            }
        } catch (err) {
            setError(getRegisterErrorMessage(backendMessage(err)));
        } finally {
            setIsSendingOtp(false);
        }
    };

    const validate = (): FieldErrors => {
        const errors: FieldErrors = {};
        if (!form.name.trim()) errors.name = 'Informe seu nome.';
        if (!EMAIL_RE.test(form.email.trim())) errors.email = 'Informe um e-mail válido.';
        if (!otpSent) errors.otp = 'Solicite o código de verificação no botão ao lado.';
        else if (!form.otp) errors.otp = 'Digite o código enviado ao seu e-mail.';
        if (form.password.length < MIN_PASSWORD_LENGTH) errors.password = `A senha deve ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres.`;
        if (!terms) errors.terms = 'Você deve aceitar os Termos de Uso para continuar.';
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
            const res = await api.post('/auth/register', {
                ...form,
                name: form.name.trim(),
                email: form.email.trim(),
                contact: `${dialCode} ${form.contact.trim()}`,
            });
            if (res.data.success) {
                if (res.data.token) login(res.data.token);
                navigate('/dashboard');
                // Full reload so every context (account, socket) boots with the new session.
                window.location.reload();
            } else {
                setError(getRegisterErrorMessage(res.data.error || res.data.message));
            }
        } catch (err) {
            setError(getRegisterErrorMessage(backendMessage(err)));
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
                        <>
                            Comece sua jornada rumo à <span className="text-accent-fg">profissionalização.</span>
                        </>
                    }
                    description="Crie sua conta em menos de um minuto e conecte sua corretora."
                    highlights={[
                        'Sincronização automática com MT4/MT5',
                        'Análise detalhada de performance quantitativa',
                        'Diário emocional e psicológico integrado',
                        'Gestão de risco automatizada',
                    ]}
                />
            }
        >
            <AuthCard
                title="Crie sua conta"
                showLegalNote={false}
                description="Teste gratuitamente por 14 dias. Sem compromisso."
                footer={
                    <>
                        Já tem uma conta?{' '}
                        <Link to="/login" className="font-bold text-accent-fg transition-colors hover:text-accent-hover">
                            Fazer login
                        </Link>
                    </>
                }
            >
                <form onSubmit={handleSubmit} noValidate className="space-y-4">
                    <Input
                        variant="field"
                        name="name"
                        label="Nome completo"
                        autoComplete="name"
                        placeholder="João Silva"
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
                        label="E-mail"
                        autoComplete="email"
                        placeholder="exemplo@torex.com"
                        icon={<Mail size={18} />}
                        value={form.email}
                        onChange={update('email')}
                        error={fieldErrors.email}
                    />

                    <div className="flex items-start gap-2">
                        <Input
                            variant="field"
                            name="otp"
                            label="Código de verificação"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            placeholder={otpSent ? '123456' : 'Clique em enviar'}
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
                            {otpCooldown.active ? `${otpCooldown.remaining}s` : otpSent ? 'Reenviar' : 'Enviar código'}
                        </Button>
                    </div>

                    {notice && <Alert tone="success">{notice}</Alert>}

                    <PhoneInput
                        name="contact"
                        label="WhatsApp / Celular"
                        value={form.contact}
                        onChange={(contact) => setForm((f) => ({ ...f, contact }))}
                        onCountryChange={(c) => setDialCode(c.dialCode)}
                        defaultCountry="BR"
                        error={fieldErrors.contact}
                    />

                    <PasswordInput
                        name="password"
                        label="Senha"
                        autoComplete="new-password"
                        placeholder="••••••••"
                        icon={<Lock size={18} />}
                        value={form.password}
                        onChange={update('password')}
                        error={fieldErrors.password}
                        hint={`Mínimo de ${MIN_PASSWORD_LENGTH} caracteres`}
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
                        Criar conta gratuita
                    </Button>
                </form>

                <OAuthButtons className="mt-7" />
            </AuthCard>
        </AuthLayout>
    );
};
