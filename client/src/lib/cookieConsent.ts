export type CookieCategory = 'essential' | 'preferences' | 'attribution';

export interface CookieConsentState {
    version: number;
    essential: true;
    preferences: boolean;
    attribution: boolean;
    updatedAt: string;
}

export const COOKIE_CONSENT_STORAGE_KEY = 'torex_cookie_consent_v1';
export const COOKIE_CONSENT_COOKIE_NAME = 'torex_consent';
export const COOKIE_CONSENT_EVENT = 'torex:cookie-consent-updated';
export const COOKIE_OPEN_PREFERENCES_EVENT = 'torex:open-cookie-preferences';

const CONSENT_VERSION = 1;
const CONSENT_MAX_AGE_SECONDS = 180 * 24 * 60 * 60; // 180 days

function parseConsent(raw: string | null): CookieConsentState | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (
            parsed &&
            typeof parsed === 'object' &&
            parsed.version === CONSENT_VERSION &&
            typeof parsed.preferences === 'boolean' &&
            typeof parsed.attribution === 'boolean'
        ) {
            return {
                version: CONSENT_VERSION,
                essential: true,
                preferences: parsed.preferences,
                attribution: parsed.attribution,
                updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
            };
        }
    } catch {
        // Ignore malformed consent payloads
    }
    return null;
}

function readConsentCookie(): string | null {
    if (typeof document === 'undefined') return null;
    const prefix = `${COOKIE_CONSENT_COOKIE_NAME}=`;
    const parts = document.cookie.split(';');
    for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.startsWith(prefix)) {
            return decodeURIComponent(trimmed.slice(prefix.length));
        }
    }
    return null;
}

function writeConsentCookie(state: CookieConsentState): void {
    if (typeof document === 'undefined') return;
    const compact = JSON.stringify({
        v: state.version,
        e: 1,
        p: state.preferences ? 1 : 0,
        a: state.attribution ? 1 : 0,
    });
    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const secureAttr = isHttps ? '; Secure' : '';
    document.cookie = `${COOKIE_CONSENT_COOKIE_NAME}=${encodeURIComponent(compact)}; Path=/; Max-Age=${CONSENT_MAX_AGE_SECONDS}; SameSite=Lax${secureAttr}`;
}

export function getCookieConsent(): CookieConsentState | null {
    if (typeof window === 'undefined') return null;
    try {
        const fromStorage = parseConsent(localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY));
        if (fromStorage) return fromStorage;
    } catch {
        // Ignore storage access errors
    }

    const rawCookie = readConsentCookie();
    if (rawCookie) {
        try {
            const parsed = JSON.parse(rawCookie);
            if (parsed && parsed.v === CONSENT_VERSION) {
                return {
                    version: CONSENT_VERSION,
                    essential: true,
                    preferences: Boolean(parsed.p),
                    attribution: Boolean(parsed.a),
                    updatedAt: new Date().toISOString(),
                };
            }
        } catch {
            // Ignore malformed cookie
        }
    }
    return null;
}

export function hasDecidedCookieConsent(): boolean {
    return getCookieConsent() !== null;
}

export function hasConsentFor(category: CookieCategory): boolean {
    if (category === 'essential') return true;
    const consent = getCookieConsent();
    if (!consent) return false;
    return consent[category];
}

export function hasAttributionOptOut(): boolean {
    const consent = getCookieConsent();
    return consent !== null && consent.attribution === false;
}

export function purgeNonEssentialStorage(state: Pick<CookieConsentState, 'preferences' | 'attribution'>): void {
    if (typeof window === 'undefined') return;
    if (!state.attribution) {
        try {
            localStorage.removeItem('torex_attribution_v1');
            localStorage.removeItem('torex_visitor_id_v1');
            sessionStorage.removeItem('torex_session_utms_v1');
            sessionStorage.removeItem('torex_last_intent_v1');
        } catch {
            // Ignore storage errors
        }
    }
    if (!state.preferences) {
        try {
            localStorage.removeItem('torex_sidebar_collapsed');
        } catch {
            // Ignore storage errors
        }
    }
}

export function saveCookieConsent(options: {
    preferences: boolean;
    attribution: boolean;
}): CookieConsentState {
    const next: CookieConsentState = {
        version: CONSENT_VERSION,
        essential: true,
        preferences: Boolean(options.preferences),
        attribution: Boolean(options.attribution),
        updatedAt: new Date().toISOString(),
    };

    try {
        localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(next));
    } catch {
        // Ignore quota/storage errors
    }

    writeConsentCookie(next);
    purgeNonEssentialStorage(next);

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_EVENT, { detail: next }));
    }

    return next;
}

export function acceptAllCookies(): CookieConsentState {
    return saveCookieConsent({ preferences: true, attribution: true });
}

export function rejectNonEssentialCookies(): CookieConsentState {
    return saveCookieConsent({ preferences: false, attribution: false });
}

export function openCookiePreferencesModal(): void {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(COOKIE_OPEN_PREFERENCES_EVENT));
    }
}
