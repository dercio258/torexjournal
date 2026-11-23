import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, WifiOff } from 'lucide-react';
import api from '../../api';
import { useLocale } from '../../context/LocaleContext';
import { useTheme } from '../../context/ThemeContext';

declare global {
    interface Window {
        turnstile?: {
            render: (
                container: HTMLElement,
                options: {
                    sitekey: string;
                    action?: string;
                    theme?: 'light' | 'dark' | 'auto';
                    language?: string;
                    callback?: (token: string) => void;
                    'expired-callback'?: () => void;
                    'error-callback'?: (code?: string) => void;
                    'timeout-callback'?: () => void;
                },
            ) => string;
            reset: (widgetId?: string) => void;
            remove: (widgetId?: string) => void;
        };
    }
}

interface PublicSecurityConfig {
    turnstileEnabled: boolean;
    turnstileSiteKey: string | null;
}

const TURNSTILE_SCRIPT_SRC =
    'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let cachedConfig: { data: PublicSecurityConfig; fetchedAt: number } | null = null;
let configInFlight: Promise<PublicSecurityConfig> | null = null;
let scriptLoadPromise: Promise<boolean> | null = null;

async function fetchPublicSecurityConfig(): Promise<PublicSecurityConfig> {
    const envSiteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim();
    const fallback: PublicSecurityConfig = {
        turnstileEnabled: Boolean(envSiteKey),
        turnstileSiteKey: envSiteKey || null,
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return cachedConfig?.data || fallback;
    }

    const now = Date.now();
    if (cachedConfig && now - cachedConfig.fetchedAt < 5 * 60 * 1000) {
        return cachedConfig.data;
    }
    if (configInFlight) return configInFlight;

    configInFlight = api
        .get<PublicSecurityConfig>('/security/public-config', {
            timeout: 4000,
            _skipOfflineCache: true,
        } as any)
        .then((res) => {
            const siteKey =
                (typeof res.data?.turnstileSiteKey === 'string' && res.data.turnstileSiteKey.trim()) ||
                envSiteKey ||
                null;
            const enabled = Boolean(res.data?.turnstileEnabled && siteKey);
            const data: PublicSecurityConfig = {
                turnstileEnabled: enabled,
                turnstileSiteKey: enabled ? siteKey : null,
            };
            cachedConfig = { data, fetchedAt: Date.now() };
            return data;
        })
        .catch(() => fallback)
        .finally(() => {
            configInFlight = null;
        });

    return configInFlight;
}

function loadTurnstileScript(): Promise<boolean> {
    if (typeof window === 'undefined') return Promise.resolve(false);
    if (window.turnstile) return Promise.resolve(true);
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return Promise.resolve(false);
    }
    if (scriptLoadPromise) return scriptLoadPromise;

    scriptLoadPromise = new Promise<boolean>((resolve) => {
        const existing = document.querySelector<HTMLScriptElement>(
            `script[src="${TURNSTILE_SCRIPT_SRC}"]`,
        );

        const timeout = window.setTimeout(() => {
            scriptLoadPromise = null;
            resolve(Boolean(window.turnstile));
        }, 8000);

        const finish = (ok: boolean) => {
            window.clearTimeout(timeout);
            if (!ok) scriptLoadPromise = null;
            resolve(ok);
        };

        if (existing) {
            if (window.turnstile) {
                finish(true);
                return;
            }
            existing.addEventListener('load', () => finish(Boolean(window.turnstile)), { once: true });
            existing.addEventListener('error', () => finish(false), { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = TURNSTILE_SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        script.onload = () => finish(Boolean(window.turnstile));
        script.onerror = () => finish(false);
        document.head.appendChild(script);
    });

    return scriptLoadPromise;
}

export interface CloudflareTurnstileProps {
    action: 'login' | 'register' | 'forgot_password' | 'admin_login' | 'send_otp';
    onTokenChange: (token: string | null) => void;
    onRequirementChange?: (required: boolean) => void;
    resetTrigger?: number;
    className?: string;
}

/**
 * Offline-safe Cloudflare Turnstile widget for public authentication endpoints.
 * - Never blocks authenticated workspace routes or offline PWA sync.
 * - Detects `!navigator.onLine`, skips external script loading offline, and
 *   automatically initializes as soon as connectivity is restored.
 * - Renders nothing when Turnstile is not configured on the backend.
 */
export const CloudflareTurnstile: React.FC<CloudflareTurnstileProps> = ({
    action,
    onTokenChange,
    onRequirementChange,
    resetTrigger = 0,
    className = '',
}) => {
    const { locale } = useLocale();
    const { theme } = useTheme();
    const isEn = locale === 'en';

    const containerRef = useRef<HTMLDivElement | null>(null);
    const widgetIdRef = useRef<string | null>(null);
    const onTokenChangeRef = useRef(onTokenChange);
    const onRequirementChangeRef = useRef(onRequirementChange);

    onTokenChangeRef.current = onTokenChange;
    onRequirementChangeRef.current = onRequirementChange;

    const [isOnline, setIsOnline] = useState<boolean>(() =>
        typeof navigator !== 'undefined' ? navigator.onLine : true,
    );
    const [config, setConfig] = useState<PublicSecurityConfig | null>(null);
    const [widgetError, setWidgetError] = useState<boolean>(false);
    const [retryNonce, setRetryNonce] = useState<number>(0);

    // Track online/offline transitions cleanly so offline PWAs never crash on Turnstile
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const handleOnline = () => {
            setIsOnline(true);
            setWidgetError(false);
            setRetryNonce((n) => n + 1);
        };
        const handleOffline = () => {
            setIsOnline(false);
            onTokenChangeRef.current(null);
        };
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    // Load public security config whenever online or retrying
    useEffect(() => {
        let cancelled = false;
        void fetchPublicSecurityConfig().then((cfg) => {
            if (cancelled) return;
            setConfig(cfg);
            onRequirementChangeRef.current?.(cfg.turnstileEnabled);
        });
        return () => {
            cancelled = true;
        };
    }, [isOnline, retryNonce]);

    // Mount / re-mount Turnstile widget only when online & configured
    useEffect(() => {
        if (!isOnline || !config?.turnstileEnabled || !config.turnstileSiteKey) {
            return;
        }

        let cancelled = false;

        const mountWidget = async () => {
            const loaded = await loadTurnstileScript();
            if (cancelled) return;

            if (!loaded || !window.turnstile || !containerRef.current) {
                setWidgetError(true);
                onTokenChangeRef.current(null);
                return;
            }

            if (widgetIdRef.current) {
                try {
                    window.turnstile.remove(widgetIdRef.current);
                } catch {
                    // ignore stale widget cleanup error
                }
                widgetIdRef.current = null;
            }

            setWidgetError(false);
            try {
                widgetIdRef.current = window.turnstile.render(containerRef.current, {
                    sitekey: config.turnstileSiteKey!,
                    action,
                    theme: theme === 'light' ? 'light' : 'dark',
                    language: isEn ? 'en' : 'pt-br',
                    callback: (token: string) => {
                        setWidgetError(false);
                        onTokenChangeRef.current(token);
                    },
                    'expired-callback': () => {
                        onTokenChangeRef.current(null);
                    },
                    'timeout-callback': () => {
                        onTokenChangeRef.current(null);
                    },
                    'error-callback': () => {
                        setWidgetError(true);
                        onTokenChangeRef.current(null);
                    },
                });
            } catch {
                setWidgetError(true);
                onTokenChangeRef.current(null);
            }
        };

        void mountWidget();

        return () => {
            cancelled = true;
            if (widgetIdRef.current && window.turnstile) {
                try {
                    window.turnstile.remove(widgetIdRef.current);
                } catch {
                    // ignore unmount error
                }
                widgetIdRef.current = null;
            }
        };
    }, [isOnline, config?.turnstileEnabled, config?.turnstileSiteKey, action, theme, isEn, retryNonce]);

    // Reset challenge after failed submit so a fresh single-use token is issued
    useEffect(() => {
        if (!resetTrigger) return;
        onTokenChangeRef.current(null);
        if (widgetIdRef.current && window.turnstile) {
            try {
                window.turnstile.reset(widgetIdRef.current);
            } catch {
                setRetryNonce((n) => n + 1);
            }
        }
    }, [resetTrigger]);

    // If offline on an auth page, render a clean offline status banner (no external fetch attempted)
    if (!isOnline) {
        return (
            <div
                className={`flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-300 ${className}`}
                role="status"
            >
                <WifiOff size={15} className="mt-0.5 shrink-0" aria-hidden />
                <span>
                    {isEn
                        ? 'You are offline. Reconnect to complete Cloudflare security verification and sign in.'
                        : 'Sem ligação à internet. Volte a ficar online para concluir a verificação Cloudflare e continuar.'}
                </span>
            </div>
        );
    }

    // Turnstile not enabled on backend yet -> render nothing
    if (!config?.turnstileEnabled || !config.turnstileSiteKey) {
        return null;
    }

    return (
        <div className={`space-y-2 ${className}`}>
            <div
                ref={containerRef}
                className="flex min-h-[65px] items-center justify-center rounded-xl border border-line/70 bg-canvas/60 px-2 py-2"
            />
            {widgetError && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                    <span>
                        {isEn
                            ? 'Security challenge could not load. Check your connection or ad-blocker.'
                            : 'Não foi possível carregar o desafio de segurança. Verifique sua ligação ou bloqueador.'}
                    </span>
                    <button
                        type="button"
                        onClick={() => setRetryNonce((n) => n + 1)}
                        className="inline-flex shrink-0 items-center gap-1 font-semibold underline hover:opacity-80"
                    >
                        <RefreshCw size={12} />
                        {isEn ? 'Retry' : 'Tentar'}
                    </button>
                </div>
            )}
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-fg-subtle">
                <ShieldCheck size={12} aria-hidden />
                <span>
                    {isEn
                        ? 'Protected by Cloudflare Turnstile'
                        : 'Protegido por Cloudflare Turnstile'}
                </span>
            </div>
        </div>
    );
};
