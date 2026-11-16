import { hasAttributionOptOut } from './cookieConsent';

export interface TouchAttribution {
    params: Record<string, string>;
    landingPath: string;
    referrer: string;
    capturedAt: string;
    channel?: string;
    ctaTag?: string;
    intent?: string;
}

export interface StoredAttributionState {
    firstTouch: TouchAttribution | null;
    lastTouch: TouchAttribution | null;
    visitorId?: string;
    sessionId?: string;
    ctaTag?: string;
    intent?: string;
    timezone: string;
    utcOffsetMinutes: number;
    browserLanguage: string;
    updatedAt: string;
}

const ATTRIBUTION_STORAGE_KEY = 'torex_attribution_v1';
const SESSION_UTMS_KEY = 'torex_session_utms_v1';
const VISITOR_ID_KEY = 'torex_visitor_id_v1';
const SESSION_ID_KEY = 'torex_session_id_v1';
const LAST_INTENT_KEY = 'torex_last_intent_v1';

/**
 * Tracking & campaign query keys used by UTMify, Meta Ads, Google Ads, TikTok Ads & affiliate links.
 */
export const TRACKING_QUERY_KEYS = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'utm_id',
    'cta_tag',
    'intent',
    'src',
    'sck',
    'xcod',
    'subid',
    'fbclid',
    'gclid',
    'ttclid',
    'kwai_click_id',
    'msclkid',
    'ref',
    'aff',
    'coupon',
    'promo',
] as const;

const FUNNEL_PATHS = new Set([
    '/',
    '/login',
    '/register',
    '/forgot-password',
    '/pricing',
    '/checkout',
    '/subscription/success',
]);

export function getLightweightClientMetadata(): {
    timezone: string;
    utcOffsetMinutes: number;
    browserLanguage: string;
} {
    let timezone = 'UTC';
    try {
        timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        // Fallback to UTC
    }
    const utcOffsetMinutes = -new Date().getTimezoneOffset();
    const browserLanguage =
        (typeof navigator !== 'undefined' && (navigator.language || navigator.languages?.[0])) || 'pt';

    return { timezone, utcOffsetMinutes, browserLanguage };
}

function generateShortId(prefix: string): string {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
        }
    } catch {
        // Fallback
    }
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

let ephemeralVisitorId: string | null = null;
let ephemeralSessionId: string | null = null;

export function getOrCreateVisitorId(): string {
    if (hasAttributionOptOut()) {
        if (!ephemeralVisitorId) ephemeralVisitorId = generateShortId('vis');
        return ephemeralVisitorId;
    }
    try {
        const existing = localStorage.getItem(VISITOR_ID_KEY);
        if (existing && existing.trim()) return existing;
        const next = generateShortId('vis');
        localStorage.setItem(VISITOR_ID_KEY, next);
        return next;
    } catch {
        if (!ephemeralVisitorId) ephemeralVisitorId = generateShortId('vis');
        return ephemeralVisitorId;
    }
}

export function getOrCreateSessionId(): string {
    if (hasAttributionOptOut()) {
        if (!ephemeralSessionId) ephemeralSessionId = generateShortId('ses');
        return ephemeralSessionId;
    }
    try {
        const existing = sessionStorage.getItem(SESSION_ID_KEY);
        if (existing && existing.trim()) return existing;
        const next = generateShortId('ses');
        sessionStorage.setItem(SESSION_ID_KEY, next);
        return next;
    } catch {
        if (!ephemeralSessionId) ephemeralSessionId = generateShortId('ses');
        return ephemeralSessionId;
    }
}

export function setLastIntent(ctaTag: string, intent?: string): void {
    if (hasAttributionOptOut() || typeof window === 'undefined') return;
    try {
        const cleanTag = ctaTag.trim().slice(0, 120);
        const cleanIntent = intent ? intent.trim().slice(0, 120) : undefined;
        sessionStorage.setItem(
            LAST_INTENT_KEY,
            JSON.stringify({ ctaTag: cleanTag, intent: cleanIntent, at: new Date().toISOString() }),
        );
        const stored = readStoredAttribution();
        if (stored) {
            stored.ctaTag = cleanTag;
            if (cleanIntent) stored.intent = cleanIntent;
            stored.updatedAt = new Date().toISOString();
            localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(stored));
        }
    } catch {
        // Ignore storage errors
    }
}

export function getLastIntent(): { ctaTag?: string; intent?: string } {
    if (hasAttributionOptOut() || typeof window === 'undefined') return {};
    try {
        const raw = sessionStorage.getItem(LAST_INTENT_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object'
            ? { ctaTag: parsed.ctaTag, intent: parsed.intent }
            : {};
    } catch {
        return {};
    }
}

function inferChannel(params: Record<string, string>, referrer: string): string {
    let refHost = '';
    if (referrer) {
        try {
            refHost = new URL(referrer).hostname.replace(/^www\./, '').toLowerCase();
        } catch {
            // ignore
        }
    }

    if (params.utm_source) {
        const cleanUtm = params.utm_source.toLowerCase().trim();
        if (cleanUtm === 'ig' || cleanUtm === 'instagram' || cleanUtm === 'l.instagram.com' || cleanUtm === 'instagram.com') {
            return 'instagram';
        }
        if (cleanUtm === 'fb' || cleanUtm === 'facebook' || cleanUtm === 'l.facebook.com' || cleanUtm === 'lm.facebook.com' || cleanUtm === 'm.facebook.com') {
            return 'facebook';
        }
        return cleanUtm;
    }
    if (params.fbclid) {
        if (refHost.includes('instagram.') || refHost === 'ig.me') return 'instagram';
        if (refHost.includes('facebook.') || refHost.includes('fb.')) return 'facebook';
        return 'meta_ads';
    }
    if (params.gclid) return 'google_ads';
    if (params.ttclid) return 'tiktok_ads';
    if (params.msclkid) return 'microsoft_ads';
    if (params.ref || params.aff) return 'referral';
    if (refHost) {
        if (refHost.includes('google.')) return 'google_organic';
        if (refHost.includes('instagram.') || refHost === 'ig.me') return 'instagram';
        if (refHost.includes('facebook.') || refHost.includes('fb.')) return 'facebook';
        if (refHost.includes('youtube.') || refHost.includes('youtu.be')) return 'youtube';
        if (refHost.includes('tiktok.')) return 'tiktok';
        if (refHost !== window.location.hostname.replace(/^www\./, '').toLowerCase()) {
            return refHost;
        }
    }
    return 'direct';
}

function readStoredAttribution(): StoredAttributionState | null {
    if (hasAttributionOptOut()) return null;
    try {
        const raw = localStorage.getItem(ATTRIBUTION_STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as StoredAttributionState;
    } catch {
        return null;
    }
}

export function getSessionTrackingParams(): Record<string, string> {
    if (hasAttributionOptOut()) return {};
    try {
        const raw = sessionStorage.getItem(SESSION_UTMS_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

/**
 * Captures UTMify / campaign parameters, click IDs, referrer, and CTA intent tags
 * immediately on page load (honoring explicit user opt-out via CookieConsentBanner).
 */
export function captureAttributionFromWindow(): StoredAttributionState | null {
    if (hasAttributionOptOut()) {
        return null;
    }

    const meta = getLightweightClientMetadata();
    const nowIso = new Date().toISOString();
    const existing = readStoredAttribution();
    const visitorId = getOrCreateVisitorId();
    const sessionId = getOrCreateSessionId();

    const searchParams = new URLSearchParams(
        typeof window !== 'undefined' ? window.location.search : ''
    );
    const extracted: Record<string, string> = {};
    for (const key of TRACKING_QUERY_KEYS) {
        const val = searchParams.get(key);
        if (val && val.trim()) {
            extracted[key] = val.trim().slice(0, 256);
        }
    }

    const rawReferrer =
        typeof document !== 'undefined' && document.referrer
            ? document.referrer.slice(0, 512)
            : '';
    const isExternalReferrer = (() => {
        if (!rawReferrer || typeof window === 'undefined') return false;
        try {
            return new URL(rawReferrer).hostname !== window.location.hostname;
        } catch {
            return false;
        }
    })();

    const hasIncomingParams = Object.keys(extracted).length > 0;
    let firstTouch = existing?.firstTouch || null;
    let lastTouch = existing?.lastTouch || null;

    if ((hasIncomingParams || !firstTouch || isExternalReferrer) && typeof window !== 'undefined') {
        const touch: TouchAttribution = {
            params: extracted,
            landingPath: window.location.pathname,
            referrer: rawReferrer,
            capturedAt: nowIso,
            channel: inferChannel(extracted, rawReferrer),
            ctaTag: extracted.cta_tag || extracted.utm_content,
            intent: extracted.intent || extracted.utm_term,
        };
        if (!firstTouch) {
            firstTouch = touch;
        }
        if (hasIncomingParams || isExternalReferrer || !lastTouch) {
            lastTouch = touch;
        }

        if (hasIncomingParams) {
            try {
                const mergedSession = { ...getSessionTrackingParams(), ...extracted };
                sessionStorage.setItem(SESSION_UTMS_KEY, JSON.stringify(mergedSession));
            } catch {
                // Ignore storage errors
            }
        }
    }

    const lastIntent = getLastIntent();
    const nextState: StoredAttributionState = {
        firstTouch,
        lastTouch,
        visitorId,
        sessionId,
        ctaTag: extracted.cta_tag || extracted.utm_content || lastIntent.ctaTag || existing?.ctaTag,
        intent: extracted.intent || extracted.utm_term || lastIntent.intent || existing?.intent,
        timezone: meta.timezone,
        utcOffsetMinutes: meta.utcOffsetMinutes,
        browserLanguage: meta.browserLanguage,
        updatedAt: nowIso,
    };

    try {
        localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(nextState));
    } catch {
        // Ignore quota errors
    }

    return nextState;
}

export function getAttributionPayload(): StoredAttributionState | undefined {
    if (hasAttributionOptOut()) {
        return undefined;
    }
    const stored = readStoredAttribution() || captureAttributionFromWindow();
    if (!stored) return undefined;
    const intentState = getLastIntent();
    return {
        ...stored,
        visitorId: stored.visitorId || getOrCreateVisitorId(),
        sessionId: stored.sessionId || getOrCreateSessionId(),
        ctaTag: intentState.ctaTag || stored.ctaTag,
        intent: intentState.intent || stored.intent,
    };
}

/**
 * Builds an internal destination URL preserving active incoming UTMs while tagging
 * the exact CTA button (`utm_content`, `cta_tag`) and user intent (`utm_term`, `intent`).
 */
export function buildTaggedUrl(
    targetPath: string,
    tags: {
        ctaTag: string;
        intent?: string;
        sourceFallback?: string;
        mediumFallback?: string;
        campaignFallback?: string;
        extraParams?: Record<string, string>;
    },
): string {
    const [pathPart, existingQuery = ''] = targetPath.split('?');
    const params = new URLSearchParams(existingQuery);
    const active = getSessionTrackingParams();

    // Carry forward active ad UTMs & click IDs without losing them
    for (const [key, val] of Object.entries(active)) {
        if (val && !params.has(key) && key !== 'utm_content' && key !== 'utm_term' && key !== 'cta_tag' && key !== 'intent') {
            params.set(key, val);
        }
    }

    if (!params.get('utm_source') && tags.sourceFallback) {
        params.set('utm_source', tags.sourceFallback);
    }
    if (!params.get('utm_medium') && tags.mediumFallback) {
        params.set('utm_medium', tags.mediumFallback);
    }
    if (!params.get('utm_campaign') && tags.campaignFallback) {
        params.set('utm_campaign', tags.campaignFallback);
    }

    params.set('utm_content', tags.ctaTag);
    params.set('cta_tag', tags.ctaTag);
    if (tags.intent) {
        params.set('utm_term', tags.intent);
        params.set('intent', tags.intent);
    }
    if (tags.extraParams) {
        for (const [k, v] of Object.entries(tags.extraParams)) {
            if (v) params.set(k, v);
        }
    }

    const qs = params.toString();
    return qs ? `${pathPart}?${qs}` : pathPart;
}

export function isAcquisitionFunnelPath(strippedPathname: string): boolean {
    const clean = strippedPathname === '' ? '/' : strippedPathname;
    return FUNNEL_PATHS.has(clean);
}

/**
 * Merges active session UTMify parameters into a query string without overwriting explicit params.
 */
export function mergeSessionUtmsIntoSearch(currentSearch: string): string {
    const active = getSessionTrackingParams();
    const keys = Object.keys(active);
    if (keys.length === 0) return currentSearch;

    const params = new URLSearchParams(currentSearch);
    let changed = false;
    for (const key of keys) {
        if (!params.has(key) && active[key]) {
            params.set(key, active[key]);
            changed = true;
        }
    }
    if (!changed) return currentSearch;
    const serialized = params.toString();
    return serialized ? `?${serialized}` : '';
}

const BLOCKED_RETURN_TO_PREFIXES = [
    '/login',
    '/register',
    '/2fa',
    '/forgot-password',
    '/auth/callback',
    '/admin',
];

/**
 * Validates and normalizes `returnTo` against Open Redirect and auth loops.
 * Strips `/en` or `/pt` prefix so it resolves cleanly inside `<BrowserRouter basename={...}>`.
 */
export function sanitizeReturnTo(raw?: string | null): string | null {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return null;

    let normalized = trimmed;
    if (normalized === '/en' || normalized === '/pt') {
        normalized = '/dashboard';
    } else if (normalized.startsWith('/en/')) {
        normalized = normalized.slice(3);
    } else if (normalized.startsWith('/pt/')) {
        normalized = normalized.slice(3);
    }

    const pathOnly = normalized.split('?')[0].split('#')[0];
    if (pathOnly === '/' || pathOnly === '') return null;
    for (const blocked of BLOCKED_RETURN_TO_PREFIXES) {
        if (pathOnly === blocked || pathOnly.startsWith(`${blocked}/`)) {
            return null;
        }
    }

    return normalized;
}
