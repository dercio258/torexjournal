import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BarChart3, CheckCircle2, Cookie, Lock, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';
import {
    COOKIE_CONSENT_EVENT,
    acceptAllCookies,
    getCookieConsent,
    rejectNonEssentialCookies,
    saveCookieConsent,
} from '../../lib/cookieConsent';
import { captureAttributionFromWindow } from '../../lib/attribution';

interface CookieInventoryItem {
    name: string;
    storage: string;
    category: 'essential' | 'preferences' | 'attribution';
    purposePt: string;
    purposeEn: string;
    retentionPt: string;
    retentionEn: string;
}

const INVENTORY: CookieInventoryItem[] = [
    {
        name: 'torex_consent',
        storage: 'Cookie (First-Party)',
        category: 'essential',
        purposePt: 'Guarda o estado codificado do seu consentimento de cookies (SameSite=Lax).',
        purposeEn: 'Stores your encoded cookie consent choice (SameSite=Lax).',
        retentionPt: '180 dias',
        retentionEn: '180 days',
    },
    {
        name: 'torex_cookie_consent_v1',
        storage: 'localStorage',
        category: 'essential',
        purposePt: 'Regista as preferências detalhadas por categoria e a data da última atualização.',
        purposeEn: 'Records detailed category preferences and last updated timestamp.',
        retentionPt: '180 dias / até revogação',
        retentionEn: '180 days / until revoked',
    },
    {
        name: 'token / adminToken / torex_auth_expired',
        storage: 'localStorage / sessionStorage',
        category: 'essential',
        purposePt: 'Mantêm a autenticação JWT ativa e sinalizam expiração segura de sessão.',
        purposeEn: 'Maintains active JWT authentication and flags secure session expiry.',
        retentionPt: 'Sessão / até logout',
        retentionEn: 'Session / until logout',
    },
    {
        name: 'torex_asset_recover',
        storage: 'sessionStorage',
        category: 'essential',
        purposePt: 'Evita loops de recarregamento caso novos bundles sejam publicados durante uma sessão.',
        purposeEn: 'Prevents reload loops if new application bundles are deployed mid-session.',
        retentionPt: 'Sessão do separador',
        retentionEn: 'Browser tab session',
    },
    {
        name: 'torex_locale / torex_locale_manual',
        storage: 'localStorage',
        category: 'preferences',
        purposePt: 'Memorizam o idioma escolhido (/pt ou /en) e evitam redirecionamentos automáticos.',
        purposeEn: 'Remembers your chosen language (/pt or /en) and prevents unwanted redirects.',
        retentionPt: 'Persistente até alteração',
        retentionEn: 'Persistent until changed',
    },
    {
        name: 'torex_sidebar_collapsed / torex_selected_account_id',
        storage: 'localStorage',
        category: 'preferences',
        purposePt: 'Preservam o estado recolhido da barra lateral e a conta MT5/Deriv selecionada.',
        purposeEn: 'Preserves sidebar collapse state and your selected MT5/Deriv trading account.',
        retentionPt: 'Persistente até alteração',
        retentionEn: 'Persistent until changed',
    },
    {
        name: 'torex_attribution_v1 / torex_session_utms_v1',
        storage: 'localStorage / sessionStorage',
        category: 'attribution',
        purposePt: 'Registam parâmetros de origem (UTM, gclid, fbclid, referrer) e fuso horário no funil de aquisição.',
        purposeEn: 'Captures acquisition parameters (UTM, gclid, fbclid, referrer) and timezone during onboarding.',
        retentionPt: 'Até revogação ou limpeza',
        retentionEn: 'Until revoked or cleared',
    },
];

export const Cookies = () => {
    const { locale } = useLocale();
    const isEn = locale === 'en';

    const initial = getCookieConsent();
    const [preferences, setPreferences] = useState<boolean>(initial?.preferences ?? true);
    const [attribution, setAttribution] = useState<boolean>(initial?.attribution ?? true);
    const [savedNotice, setSavedNotice] = useState<string | null>(null);

    useEffect(() => {
        const sync = () => {
            const current = getCookieConsent();
            if (current) {
                setPreferences(current.preferences);
                setAttribution(current.attribution);
            }
        };
        window.addEventListener(COOKIE_CONSENT_EVENT, sync);
        return () => window.removeEventListener(COOKIE_CONSENT_EVENT, sync);
    }, []);

    const handleSave = () => {
        saveCookieConsent({ preferences, attribution });
        if (attribution) {
            captureAttributionFromWindow();
        }
        setSavedNotice(
            isEn
                ? 'Your cookie preferences have been saved.'
                : 'As suas preferências de cookies foram guardadas com sucesso.'
        );
    };

    const handleAcceptAll = () => {
        acceptAllCookies();
        captureAttributionFromWindow();
        setPreferences(true);
        setAttribution(true);
        setSavedNotice(
            isEn
                ? 'All cookie categories accepted.'
                : 'Todas as categorias de cookies foram aceites.'
        );
    };

    const handleEssentialOnly = () => {
        rejectNonEssentialCookies();
        setPreferences(false);
        setAttribution(false);
        setSavedNotice(
            isEn
                ? 'Only strictly necessary cookies remain active.'
                : 'Apenas os cookies estritamente necessários permanecem ativos.'
        );
    };

    return (
        <div className="min-h-screen bg-canvas px-6 py-20 font-sans text-fg/80">
            <div className="mx-auto max-w-4xl rounded-3xl border border-line bg-surface/40 p-8 shadow-2xl md:p-12">
                <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
                    <Link
                        to="/legal"
                        className="inline-flex items-center text-sm font-medium text-emerald-500 transition-colors hover:text-accent-fg"
                    >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        {isEn ? 'Back to Legal Hub' : 'Voltar para Central Legal'}
                    </Link>

                    <Link
                        to="/"
                        className="text-xs font-semibold text-fg-muted transition-colors hover:text-accent-fg"
                    >
                        {isEn ? 'Return to Home' : 'Voltar à Página Inicial'}
                    </Link>
                </div>

                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent-fg">
                    <Cookie className="h-3.5 w-3.5" />
                    <span>{isEn ? 'Transparency & GDPR / LGPD' : 'Transparência & GDPR / LGPD'}</span>
                </div>

                <h1 className="mb-4 text-3xl font-bold text-fg md:text-4xl">
                    {isEn ? 'Cookie & Local Storage Policy' : 'Política de Cookies e Armazenamento Local'}
                </h1>
                <p className="mb-10 text-sm text-fg-subtle">
                    {isEn
                        ? 'Last Updated: November 13, 2026 · Applies to Torex Journal Web & Terminal'
                        : 'Última Atualização: 13 de Novembro de 2026 · Aplicável à Plataforma Web e Terminal Torex Journal'}
                </p>

                <div className="space-y-8 text-base leading-relaxed">
                    <section>
                        <h2 className="mb-3 text-xl font-bold text-fg">
                            {isEn ? '1. What technologies we use' : '1. Que tecnologias utilizamos'}
                        </h2>
                        <p>
                            {isEn
                                ? 'Torex Journal uses first-party cookies alongside browser storage mechanisms (localStorage and sessionStorage) to guarantee secure trading session continuity, remember your preferred language and workspace layout, and—only with your consent—attribute marketing referrals during onboarding.'
                                : 'O Torex Journal utiliza cookies próprios (first-party) em conjunto com mecanismos de armazenamento do navegador (localStorage e sessionStorage) para garantir a segurança da sua sessão de trading, memorizar o idioma e o layout do seu workspace e — apenas mediante o seu consentimento — registar a atribuição de campanhas durante o onboarding.'}
                        </p>
                    </section>

                    {/* Interactive Preferences Center */}
                    <section className="rounded-2xl border border-emerald-500/20 bg-canvas/70 p-6">
                        <div className="mb-4 flex items-center gap-2.5">
                            <ShieldCheck className="h-5 w-5 text-emerald-400" />
                            <h2 className="text-lg font-bold text-fg">
                                {isEn ? 'Manage Your Cookie Preferences' : 'Gerir as Suas Preferências de Cookies'}
                            </h2>
                        </div>
                        <p className="mb-5 text-sm text-fg-muted">
                            {isEn
                                ? 'Adjust your preferences below at any time. Rejecting attribution immediately removes stored campaign tracking keys from your browser.'
                                : 'Ajuste as suas preferências abaixo em qualquer momento. Ao desativar a categoria de atribuição, os registos locais de campanha são removidos imediatamente do seu navegador.'}
                        </p>

                        <div className="space-y-3">
                            <div className="flex items-start justify-between gap-4 rounded-xl border border-line bg-surface/60 p-4">
                                <div>
                                    <div className="flex items-center gap-2 font-semibold text-fg">
                                        <Lock className="h-4 w-4 text-emerald-400" />
                                        <span>{isEn ? 'Strictly Necessary' : 'Estritamente Necessários'}</span>
                                    </div>
                                    <p className="mt-1 text-xs text-fg-muted">
                                        {isEn
                                            ? 'Required for authentication, security recovery, and storing your consent status.'
                                            : 'Indispensáveis para autenticação, recuperação de sessão e gravação da sua escolha de consentimento.'}
                                    </p>
                                </div>
                                <span className="shrink-0 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-accent-fg">
                                    {isEn ? 'Always active' : 'Sempre ativo'}
                                </span>
                            </div>

                            <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-line bg-surface/60 p-4 transition-colors hover:border-line-strong">
                                <div>
                                    <div className="flex items-center gap-2 font-semibold text-fg">
                                        <SlidersHorizontal className="h-4 w-4 text-sky-400" />
                                        <span>{isEn ? 'Workspace Preferences' : 'Preferências de Workspace'}</span>
                                    </div>
                                    <p className="mt-1 text-xs text-fg-muted">
                                        {isEn
                                            ? 'Remembers interface language (/pt or /en), sidebar state, and active trading account.'
                                            : 'Memoriza idioma (/pt ou /en), estado da barra lateral e conta de trading selecionada.'}
                                    </p>
                                </div>
                                <input
                                    type="checkbox"
                                    checked={preferences}
                                    onChange={(e) => setPreferences(e.target.checked)}
                                    className="mt-1 h-4 w-4 accent-emerald-500"
                                />
                            </label>

                            <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-line bg-surface/60 p-4 transition-colors hover:border-line-strong">
                                <div>
                                    <div className="flex items-center gap-2 font-semibold text-fg">
                                        <BarChart3 className="h-4 w-4 text-violet-400" />
                                        <span>{isEn ? 'Campaign Attribution & Telemetry' : 'Atribuição & Telemetria de Origem'}</span>
                                    </div>
                                    <p className="mt-1 text-xs text-fg-muted">
                                        {isEn
                                            ? 'Captures UTM/referral parameters and timezone metadata for onboarding analytics.'
                                            : 'Recolhe parâmetros UTM/origem e metadados de fuso horário para análise de onboarding.'}
                                    </p>
                                </div>
                                <input
                                    type="checkbox"
                                    checked={attribution}
                                    onChange={(e) => setAttribution(e.target.checked)}
                                    className="mt-1 h-4 w-4 accent-emerald-500"
                                />
                            </label>
                        </div>

                        {savedNotice && (
                            <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs font-medium text-accent-fg">
                                <CheckCircle2 className="h-4 w-4 shrink-0" />
                                <span>{savedNotice}</span>
                            </div>
                        )}

                        <div className="mt-5 flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={handleSave}
                                className="rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-bold text-[#04110C] transition-colors hover:bg-emerald-400"
                            >
                                {isEn ? 'Save preferences' : 'Guardar preferências'}
                            </button>
                            <button
                                type="button"
                                onClick={handleAcceptAll}
                                className="rounded-xl border border-line bg-surface px-4 py-2.5 text-xs font-semibold text-fg transition-colors hover:bg-surface-2"
                            >
                                {isEn ? 'Accept all' : 'Aceitar todos'}
                            </button>
                            <button
                                type="button"
                                onClick={handleEssentialOnly}
                                className="rounded-xl border border-line bg-surface px-4 py-2.5 text-xs font-semibold text-fg-muted transition-colors hover:text-fg"
                            >
                                {isEn ? 'Essential only' : 'Apenas essenciais'}
                            </button>
                        </div>
                    </section>

                    {/* Detailed Inventory */}
                    <section>
                        <h2 className="mb-4 text-xl font-bold text-fg">
                            {isEn ? '2. Detailed Cookie & Storage Inventory' : '2. Inventário Detalhado de Cookies e Armazenamento'}
                        </h2>
                        <div className="overflow-x-auto rounded-2xl border border-line">
                            <table className="w-full border-collapse text-left text-xs">
                                <thead className="bg-surface/80 text-fg">
                                    <tr>
                                        <th className="border-b border-line px-4 py-3 font-semibold">
                                            {isEn ? 'Key / Cookie' : 'Chave / Cookie'}
                                        </th>
                                        <th className="border-b border-line px-4 py-3 font-semibold">
                                            {isEn ? 'Mechanism' : 'Mecanismo'}
                                        </th>
                                        <th className="border-b border-line px-4 py-3 font-semibold">
                                            {isEn ? 'Purpose' : 'Finalidade'}
                                        </th>
                                        <th className="border-b border-line px-4 py-3 font-semibold">
                                            {isEn ? 'Retention' : 'Retenção'}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-line">
                                    {INVENTORY.map((item) => (
                                        <tr key={item.name} className="bg-canvas/40">
                                            <td className="px-4 py-3 font-mono text-[11px] font-semibold text-accent-fg">
                                                {item.name}
                                            </td>
                                            <td className="px-4 py-3 text-fg-muted">{item.storage}</td>
                                            <td className="px-4 py-3 text-fg/80">
                                                {isEn ? item.purposeEn : item.purposePt}
                                            </td>
                                            <td className="px-4 py-3 text-fg-subtle">
                                                {isEn ? item.retentionEn : item.retentionPt}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>

                    <section>
                        <h2 className="mb-3 text-xl font-bold text-fg">
                            {isEn ? '3. Browser Controls & Contact' : '3. Controlo no Navegador e Contacto'}
                        </h2>
                        <p>
                            {isEn
                                ? 'In addition to our Preference Center, you can block or delete cookies and site data directly through your browser settings. Note that disabling strictly necessary storage may prevent login and trading workspace synchronization. Questions about privacy or data protection can be sent to info@torexjournal.com.'
                                : 'Além do nosso Centro de Preferências, pode bloquear ou apagar cookies e dados de sites diretamente nas definições do seu navegador. Note que a desativação do armazenamento estritamente necessário pode impedir o início de sessão e a sincronização do painel de trading. Dúvidas sobre privacidade podem ser enviadas para info@torexjournal.com.'}
                        </p>
                    </section>
                </div>
            </div>
        </div>
    );
};
