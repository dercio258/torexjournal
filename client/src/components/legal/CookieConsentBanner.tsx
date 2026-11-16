import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Check, Cookie, Lock, ShieldCheck, SlidersHorizontal, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import {
    COOKIE_CONSENT_EVENT,
    COOKIE_OPEN_PREFERENCES_EVENT,
    acceptAllCookies,
    getCookieConsent,
    hasDecidedCookieConsent,
    rejectNonEssentialCookies,
    saveCookieConsent,
} from '../../lib/cookieConsent';
import { captureAttributionFromWindow } from '../../lib/attribution';

type ConsentLocale = 'pt' | 'en';

interface CopyShape {
    badge: string;
    title: string;
    summary: string;
    policyLinkLabel: string;
    privacyLinkLabel: string;
    acceptAll: string;
    essentialOnly: string;
    customize: string;
    modalTitle: string;
    modalSubtitle: string;
    savePreferences: string;
    alwaysActive: string;
    categories: {
        essential: { title: string; description: string; keys: string };
        preferences: { title: string; description: string; keys: string };
        attribution: { title: string; description: string; keys: string };
    };
}

const COPY: Record<ConsentLocale, CopyShape> = {
    pt: {
        badge: 'Privacidade & Cookies',
        title: 'Controle os seus dados no Torex Journal',
        summary:
            'Utilizamos cookies e armazenamento local estritamente necessários para manter a sua sessão segura, além de opções opcionais para memorizar preferências do terminal e medir campanhas de acesso.',
        policyLinkLabel: 'Política de Cookies',
        privacyLinkLabel: 'Política de Privacidade',
        acceptAll: 'Aceitar todos',
        essentialOnly: 'Apenas essenciais',
        customize: 'Personalizar',
        modalTitle: 'Preferências de Cookies e Armazenamento',
        modalSubtitle:
            'Escolha exatamente quais categorias não essenciais o Torex Journal pode utilizar neste navegador. Pode alterar a sua decisão a qualquer momento.',
        savePreferences: 'Guardar preferências',
        alwaysActive: 'Sempre ativo',
        categories: {
            essential: {
                title: 'Estritamente Necessários',
                description:
                    'Garantem autenticação JWT, proteção contra expiração de sessão, recuperação segura de ativos e o registo da sua escolha de consentimento.',
                keys: 'torex_consent, torex_cookie_consent_v1, token, torex_auth_expired',
            },
            preferences: {
                title: 'Preferências de Workspace',
                description:
                    'Guardam o seu idioma preferido (/pt ou /en), estado da barra lateral e a última conta de trading selecionada no painel.',
                keys: 'torex_locale, torex_locale_manual, torex_sidebar_collapsed, torex_selected_account_id',
            },
            attribution: {
                title: 'Atribuição & Telemetria de Origem',
                description:
                    'Registam parâmetros de campanha (UTM, fbclid, gclid), fuso horário e idioma do navegador para melhorar a experiência de onboarding.',
                keys: 'torex_attribution_v1, torex_session_utms_v1',
            },
        },
    },
    en: {
        badge: 'Privacy & Cookies',
        title: 'Control your data on Torex Journal',
        summary:
            'We use strictly necessary cookies and local storage to keep your trading session secure, plus optional categories to remember workspace preferences and measure campaign attribution.',
        policyLinkLabel: 'Cookie Policy',
        privacyLinkLabel: 'Privacy Policy',
        acceptAll: 'Accept all',
        essentialOnly: 'Essential only',
        customize: 'Customize',
        modalTitle: 'Cookie & Storage Preferences',
        modalSubtitle:
            'Choose exactly which optional categories Torex Journal may use in this browser. You can update or withdraw consent at any time.',
        savePreferences: 'Save preferences',
        alwaysActive: 'Always active',
        categories: {
            essential: {
                title: 'Strictly Necessary',
                description:
                    'Powers JWT session security, asset recovery safeguards, and persistence of your consent decision.',
                keys: 'torex_consent, torex_cookie_consent_v1, token, torex_auth_expired',
            },
            preferences: {
                title: 'Workspace Preferences',
                description:
                    'Remembers your language (/pt or /en), sidebar layout state, and last selected trading account.',
                keys: 'torex_locale, torex_locale_manual, torex_sidebar_collapsed, torex_selected_account_id',
            },
            attribution: {
                title: 'Campaign Attribution & Telemetry',
                description:
                    'Captures referral parameters (UTM, fbclid, gclid), timezone, and browser language to improve onboarding.',
                keys: 'torex_attribution_v1, torex_session_utms_v1',
            },
        },
    },
};

const ToggleSwitch: React.FC<{
    checked: boolean;
    onChange: (next: boolean) => void;
    label: string;
}> = ({ checked, onChange, label }) => (
    <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
            checked
                ? 'border-accent/60 bg-accent'
                : 'border-white/15 bg-surface-3'
        )}
    >
        <span
            className={cn(
                'inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform',
                checked ? 'translate-x-6' : 'translate-x-1'
            )}
        />
    </button>
);

export const CookieConsentBanner: React.FC<{ locale?: ConsentLocale }> = ({ locale = 'pt' }) => {
    const copy = COPY[locale];
    const [showBanner, setShowBanner] = useState<boolean>(() => !hasDecidedCookieConsent());
    const [showModal, setShowModal] = useState(false);

    const existing = getCookieConsent();
    const [preferencesEnabled, setPreferencesEnabled] = useState<boolean>(existing?.preferences ?? true);
    const [attributionEnabled, setAttributionEnabled] = useState<boolean>(existing?.attribution ?? true);

    useEffect(() => {
        const handleOpen = () => {
            const current = getCookieConsent();
            setPreferencesEnabled(current?.preferences ?? true);
            setAttributionEnabled(current?.attribution ?? true);
            setShowModal(true);
        };
        const handleUpdated = () => {
            setShowBanner(false);
        };

        window.addEventListener(COOKIE_OPEN_PREFERENCES_EVENT, handleOpen);
        window.addEventListener(COOKIE_CONSENT_EVENT, handleUpdated);
        return () => {
            window.removeEventListener(COOKIE_OPEN_PREFERENCES_EVENT, handleOpen);
            window.removeEventListener(COOKIE_CONSENT_EVENT, handleUpdated);
        };
    }, []);

    useEffect(() => {
        if (!showModal) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setShowModal(false);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [showModal]);

    const handleAcceptAll = () => {
        acceptAllCookies();
        captureAttributionFromWindow();
        setShowBanner(false);
        setShowModal(false);
    };

    const handleEssentialOnly = () => {
        rejectNonEssentialCookies();
        setShowBanner(false);
        setShowModal(false);
    };

    const handleSaveCustom = () => {
        saveCookieConsent({
            preferences: preferencesEnabled,
            attribution: attributionEnabled,
        });
        if (attributionEnabled) {
            captureAttributionFromWindow();
        }
        setShowBanner(false);
        setShowModal(false);
    };

    return (
        <>
            {showBanner && !showModal && (
                <aside
                    role="region"
                    aria-label={copy.badge}
                    className="fixed inset-x-0 bottom-4 z-50 mx-auto max-w-5xl px-4 sm:bottom-6 sm:px-6"
                >
                    <div className="relative overflow-hidden rounded-2xl border border-white/[0.12] bg-[#0B0F19]/95 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.75)] backdrop-blur-xl sm:p-6">
                        <div
                            aria-hidden="true"
                            className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-emerald-500/15 blur-3xl"
                        />

                        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                            <div className="max-w-2xl space-y-2">
                                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-300">
                                    <Cookie size={13} aria-hidden="true" />
                                    <span>{copy.badge}</span>
                                </div>

                                <h2 className="text-base font-bold tracking-tight text-white sm:text-lg">
                                    {copy.title}
                                </h2>

                                <p className="text-xs leading-relaxed text-slate-300 sm:text-[13px]">
                                    {copy.summary}{' '}
                                    <Link
                                        to="/cookies"
                                        className="font-semibold text-emerald-400 underline decoration-emerald-500/40 underline-offset-4 transition-colors hover:text-emerald-300"
                                    >
                                        {copy.policyLinkLabel}
                                    </Link>{' '}
                                    ·{' '}
                                    <Link
                                        to="/privacy"
                                        className="font-semibold text-emerald-400 underline decoration-emerald-500/40 underline-offset-4 transition-colors hover:text-emerald-300"
                                    >
                                        {copy.privacyLinkLabel}
                                    </Link>
                                </p>
                            </div>

                            <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center lg:shrink-0">
                                <button
                                    type="button"
                                    onClick={() => setShowModal(true)}
                                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2.5 text-xs font-semibold text-slate-200 transition-colors hover:border-white/25 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                                >
                                    <SlidersHorizontal size={14} aria-hidden="true" />
                                    <span>{copy.customize}</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={handleEssentialOnly}
                                    className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2.5 text-xs font-semibold text-slate-200 transition-colors hover:border-white/25 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                                >
                                    {copy.essentialOnly}
                                </button>

                                <button
                                    type="button"
                                    onClick={handleAcceptAll}
                                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-bold text-[#04110C] shadow-[0_0_24px_rgba(16,185,129,0.35)] transition-all hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                                >
                                    <Check size={14} strokeWidth={2.5} aria-hidden="true" />
                                    <span>{copy.acceptAll}</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </aside>
            )}

            {showModal && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="torex-cookie-modal-title"
                    className="fixed inset-0 z-[60] flex items-center justify-center p-4"
                >
                    <div
                        className="absolute inset-0 bg-black/75 backdrop-blur-md"
                        onClick={() => setShowModal(false)}
                    />

                    <div className="relative flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[#0B0F19] text-white shadow-2xl">
                        <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] px-6 py-5">
                            <div className="space-y-1">
                                <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-400">
                                    <ShieldCheck size={14} aria-hidden="true" />
                                    <span>{copy.badge}</span>
                                </div>
                                <h2 id="torex-cookie-modal-title" className="text-lg font-bold tracking-tight text-white">
                                    {copy.modalTitle}
                                </h2>
                                <p className="text-xs leading-relaxed text-slate-400">
                                    {copy.modalSubtitle}
                                </p>
                            </div>
                            <button
                                type="button"
                                aria-label="Close"
                                onClick={() => setShowModal(false)}
                                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="space-y-3 overflow-y-auto px-6 py-5">
                            {/* Essential */}
                            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2.5">
                                        <Lock size={16} className="text-emerald-400" aria-hidden="true" />
                                        <span className="text-sm font-bold text-white">
                                            {copy.categories.essential.title}
                                        </span>
                                    </div>
                                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                                        {copy.alwaysActive}
                                    </span>
                                </div>
                                <p className="mt-2 text-xs leading-relaxed text-slate-300">
                                    {copy.categories.essential.description}
                                </p>
                                <p className="mt-2 font-mono text-[10.5px] text-slate-400">
                                    {copy.categories.essential.keys}
                                </p>
                            </div>

                            {/* Preferences */}
                            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2.5">
                                        <SlidersHorizontal size={16} className="text-sky-400" aria-hidden="true" />
                                        <span className="text-sm font-bold text-white">
                                            {copy.categories.preferences.title}
                                        </span>
                                    </div>
                                    <ToggleSwitch
                                        checked={preferencesEnabled}
                                        onChange={setPreferencesEnabled}
                                        label={copy.categories.preferences.title}
                                    />
                                </div>
                                <p className="mt-2 text-xs leading-relaxed text-slate-300">
                                    {copy.categories.preferences.description}
                                </p>
                                <p className="mt-2 font-mono text-[10.5px] text-slate-400">
                                    {copy.categories.preferences.keys}
                                </p>
                            </div>

                            {/* Attribution */}
                            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2.5">
                                        <BarChart3 size={16} className="text-violet-400" aria-hidden="true" />
                                        <span className="text-sm font-bold text-white">
                                            {copy.categories.attribution.title}
                                        </span>
                                    </div>
                                    <ToggleSwitch
                                        checked={attributionEnabled}
                                        onChange={setAttributionEnabled}
                                        label={copy.categories.attribution.title}
                                    />
                                </div>
                                <p className="mt-2 text-xs leading-relaxed text-slate-300">
                                    {copy.categories.attribution.description}
                                </p>
                                <p className="mt-2 font-mono text-[10.5px] text-slate-400">
                                    {copy.categories.attribution.keys}
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-col-reverse gap-2.5 border-t border-white/[0.08] bg-white/[0.02] px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                            <Link
                                to="/cookies"
                                onClick={() => setShowModal(false)}
                                className="text-center text-xs font-semibold text-emerald-400 hover:underline sm:text-left"
                            >
                                {copy.policyLinkLabel} →
                            </Link>

                            <div className="flex flex-col gap-2 sm:flex-row">
                                <button
                                    type="button"
                                    onClick={handleEssentialOnly}
                                    className="rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-white/[0.08]"
                                >
                                    {copy.essentialOnly}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleSaveCustom}
                                    className="rounded-xl bg-emerald-500 px-5 py-2 text-xs font-bold text-[#04110C] transition-colors hover:bg-emerald-400"
                                >
                                    {copy.savePreferences}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
