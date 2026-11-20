import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Gift, Globe2, Lock, Mail, User } from 'lucide-react';
import { useLocale } from '../context/LocaleContext';
import api from '../api';
import { AuthLayout } from '../layouts/AuthLayout';
import { AuthCard } from '../components/auth/AuthCard';
import { AuthAside } from '../components/auth/AuthAside';
import { OAuthButtons } from '../components/auth/OAuthButtons';
import { CookieConsentBanner } from '../components/legal/CookieConsentBanner';
import { Input } from '../components/ui/Input';
import { PasswordInput } from '../components/ui/PasswordInput';
import { PhoneInput } from '../components/ui/PhoneInput';
import { Checkbox } from '../components/ui/Checkbox';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';
import { EMAIL_RE, MIN_PASSWORD_LENGTH, getApiMessage, getRegisterErrorMessage } from '../lib/authErrors';
import {
    getAttributionPayload,
    getLightweightClientMetadata,
    getOrCreateVisitorId,
    mergeSessionUtmsIntoSearch,
    sanitizeReturnTo,
} from '../lib/attribution';
import { COOKIE_CONSENT_EVENT, hasConsentFor } from '../lib/cookieConsent';
import {
    CountryDial,
    findCountry,
    inferCountryFromTimezone,
    validatePhoneForCountry,
} from '../constants/countries';

type Field = 'name' | 'email' | 'contact' | 'password' | 'terms';
type FieldErrors = Partial<Record<Field, string>>;

const backendMessage = (err: unknown) => getApiMessage(err, '');

export const Register = () => {
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const safeReturnTo = sanitizeReturnTo(searchParams.get('returnTo'));
    const [referralCode] = useState<string>(() => {
        const fromUrl = (searchParams.get('ref') || searchParams.get('referral') || '').trim().toUpperCase();
        if (fromUrl && /^[A-Z0-9_-]{4,32}$/.test(fromUrl)) {
            try {
                sessionStorage.setItem('torex_ref_code', fromUrl);
            } catch {
                // ignore storage errors
            }
            return fromUrl;
        }
        try {
            return (sessionStorage.getItem('torex_ref_code') || '').trim().toUpperCase();
        } catch {
            return '';
        }
    });

    const [form, setForm] = useState({ name: '', email: '', contact: '', password: '' });
    const [selectedCountry, setSelectedCountry] = useState<CountryDial | null>(null);
    const [geoAutoDetected, setGeoAutoDetected] = useState(false);
    const [cookiesConsented, setCookiesConsented] = useState<boolean>(
        () => hasConsentFor('preferences') || hasConsentFor('attribution'),
    );
    const [terms, setTerms] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const manualSelectionRef = useRef(false);
    const autoResolvedIsoRef = useRef<string | null>(null);

    const loginBaseSearch = safeReturnTo ? `?returnTo=${encodeURIComponent(safeReturnTo)}` : '';
    const loginSearch = mergeSessionUtmsIntoSearch(loginBaseSearch);

    const resolveGeoPrefixIfConsented = useCallback(async () => {
        const consented = hasConsentFor('preferences') || hasConsentFor('attribution');
        setCookiesConsented(consented);

        if (!consented) {
            if (!manualSelectionRef.current) {
                autoResolvedIsoRef.current = null;
                setSelectedCountry(null);
                setGeoAutoDetected(false);
            }
            return;
        }

        if (manualSelectionRef.current) return;

        const tz = getLightweightClientMetadata().timezone;
        let resolved: CountryDial | null = null;

        try {
            const res = await api.get('/auth/geo-hint', { params: { tz } });
            if (res.data?.countryIso2) {
                resolved = findCountry(String(res.data.countryIso2)) || null;
            }
        } catch {
            // Fall through to local timezone inference
        }

        if (!resolved) {
            resolved = inferCountryFromTimezone(tz);
        }

        if (resolved && !manualSelectionRef.current) {
            autoResolvedIsoRef.current = resolved.iso2;
            setSelectedCountry(resolved);
            setGeoAutoDetected(true);
        }
    }, []);

    useEffect(() => {
        void resolveGeoPrefixIfConsented();
        const onConsentUpdated = () => {
            void resolveGeoPrefixIfConsented();
        };
        window.addEventListener(COOKIE_CONSENT_EVENT, onConsentUpdated);
        return () => window.removeEventListener(COOKIE_CONSENT_EVENT, onConsentUpdated);
    }, [resolveGeoPrefixIfConsented]);

    const update = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
        setForm((f) => ({ ...f, [field]: e.target.value }));
        if (fieldErrors[field]) setFieldErrors((fe) => ({ ...fe, [field]: undefined }));
    };

    const handleCountryChange = (c: CountryDial | null) => {
        setSelectedCountry(c);
        if (c && c.iso2 !== autoResolvedIsoRef.current) {
            manualSelectionRef.current = true;
            setGeoAutoDetected(false);
        }
        if (fieldErrors.contact) {
            setFieldErrors((fe) => ({ ...fe, contact: undefined }));
        }
    };

    const validate = (): FieldErrors => {
        const errors: FieldErrors = {};
        if (!form.name.trim() || form.name.trim().length < 2) {
            errors.name = isEn ? 'Enter your full name.' : 'Informe seu nome completo.';
        }
        if (!EMAIL_RE.test(form.email.trim())) {
            errors.email = isEn ? 'Enter a valid email address.' : 'Informe um e-mail válido.';
        }
        const phoneCheck = validatePhoneForCountry(form.contact, selectedCountry);
        if (!phoneCheck.valid) {
            errors.contact = isEn
                ? phoneCheck.errorEn || 'Enter a valid phone number with country prefix.'
                : phoneCheck.errorPt || 'Informe um número válido com o prefixo do país.';
        }
        if (form.password.length < MIN_PASSWORD_LENGTH) {
            errors.password = isEn
                ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
                : `A senha deve ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres.`;
        }
        if (!terms) {
            errors.terms = isEn
                ? 'Accept the Terms of Service to continue.'
                : 'Você deve aceitar os Termos de Uso para continuar.';
        }
        return errors;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        const errors = validate();
        setFieldErrors(errors);
        if (Object.keys(errors).length) return;

        const phoneCheck = validatePhoneForCountry(form.contact, selectedCountry);
        if (!phoneCheck.valid || !selectedCountry) {
            setFieldErrors((fe) => ({
                ...fe,
                contact: isEn ? phoneCheck.errorEn : phoneCheck.errorPt,
            }));
            return;
        }

        setIsSubmitting(true);
        try {
            const clientMeta = getLightweightClientMetadata();
            const attributionData = getAttributionPayload();

            const res = await api.post('/auth/register/initiate', {
                name: form.name.trim(),
                email: form.email.trim(),
                password: form.password,
                contact: phoneCheck.e164,
                countryIso2: selectedCountry.iso2,
                preferredLocale: locale,
                timezone: clientMeta.timezone,
                visitorId: getOrCreateVisitorId(),
                attributionData,
                ...(referralCode ? { referralCode } : {}),
            });

            if (res.data?.verificationToken) {
                sessionStorage.setItem(
                    'torex_pending_verification',
                    JSON.stringify({
                        verificationToken: res.data.verificationToken,
                        emailMasked: res.data.emailMasked || form.email.trim(),
                        email: form.email.trim(),
                        returnTo: safeReturnTo,
                    }),
                );
                navigate('/verify-account');
                return;
            }

            setError(
                getRegisterErrorMessage(
                    res.data?.error || res.data?.message || (isEn ? 'Registration failed' : 'Falha no registo'),
                    locale,
                ),
            );
        } catch (err) {
            setError(getRegisterErrorMessage(backendMessage(err), locale));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <>
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
                                : 'Crie sua conta em menos de um minuto, valide seu e-mail na etapa seguinte e conecte sua corretora.'
                        }
                        highlights={
                            isEn
                                ? [
                                      'Automated MT5, Deriv & 20+ Broker Sync',
                                      'Quantitative Edge Score, Profit Factor & MFE/MAE',
                                      'Offline-ready Journal & Smart Push Reminders',
                                      'Autonomous Daily Drawdown & Tilt guardrails',
                                  ]
                                : [
                                      'Sincronização automática com +20 corretoras e MT5',
                                      'Análise detalhada de performance quantitativa',
                                      'Diário offline integrado e notificações inteligentes',
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
                            ? 'Step 1 of 2 · Fill in your details, then verify your email.'
                            : 'Etapa 1 de 2 · Preencha os seus dados e confirme na página de verificação.'
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

                        <PhoneInput
                            name="contact"
                            label={isEn ? 'Mobile Contact' : 'Contacto Móvel / Celular'}
                            value={form.contact}
                            onChange={(contact) => {
                                setForm((f) => ({ ...f, contact }));
                                if (fieldErrors.contact) setFieldErrors((fe) => ({ ...fe, contact: undefined }));
                            }}
                            onCountryChange={handleCountryChange}
                            selectedIso2={selectedCountry?.iso2 ?? null}
                            requireManualSelection={true}
                            error={fieldErrors.contact}
                            hint={
                                geoAutoDetected && selectedCountry ? (
                                    <span className="inline-flex items-center gap-1 text-[11px] text-accent-fg">
                                        <Globe2 size={12} />
                                        {isEn
                                            ? `Prefix detected automatically: ${selectedCountry.name} (${selectedCountry.dialCode})`
                                            : `Prefixo detetado via localização autorizada: ${selectedCountry.name} (${selectedCountry.dialCode})`}
                                    </span>
                                ) : !cookiesConsented ? (
                                    <span className="text-[11px] text-fg-subtle">
                                        {isEn
                                            ? 'Cookies not accepted: select your country dial prefix manually.'
                                            : 'Cookies de localização não aceites: selecione manualmente o indicativo do seu país.'}
                                    </span>
                                ) : (
                                    <span className="text-[11px] text-fg-subtle">
                                        {isEn
                                            ? 'Confirm your country dial prefix and local number.'
                                            : 'Confirme o indicativo correto do seu país e o número local.'}
                                    </span>
                                )
                            }
                        />

                        {referralCode && (
                            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
                                <Gift size={14} className="shrink-0" />
                                <span>
                                    {isEn ? 'Referral invite applied:' : 'Código de convite aplicado:'}{' '}
                                    <strong className="font-mono">{referralCode}</strong>
                                </span>
                            </div>
                        )}

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
                            {isEn ? 'Continue to Verification' : 'Continuar para Verificação'}
                        </Button>
                    </form>

                    <OAuthButtons className="mt-7" />
                </AuthCard>
            </AuthLayout>

            <CookieConsentBanner locale={isEn ? 'en' : 'pt'} />
        </>
    );
};
