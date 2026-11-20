import api from '../api';
import {
    getAttributionPayload,
    getOrCreateSessionId,
    getOrCreateVisitorId,
    getSessionTrackingParams,
    setLastIntent,
} from './attribution';
import { COOKIE_CONSENT_EVENT, hasAttributionOptOut } from './cookieConsent';

export interface PublicPixelConfig {
    metaPixelId: string | null;
    ga4MeasurementId: string | null;
    gtmContainerId: string | null;
    tiktokPixelId: string | null;
    utmifyPixelId: string | null;
    enableFirstPartyTracking: boolean;
    enableEmailTracking: boolean;
    enableCtaAutoTracking: boolean;
    customHeadScript: string | null;
}

interface OutgoingEventPayload {
    eventName: string;
    eventType: 'pageview' | 'button_click' | 'conversion' | 'pixel_event' | 'custom';
    visitorId: string;
    sessionId?: string;
    pagePath?: string;
    pageTitle?: string;
    elementId?: string;
    elementLabel?: string;
    ctaTag?: string;
    intent?: string;
    targetUrl?: string;
    referrer?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmContent?: string;
    utmTerm?: string;
    utmId?: string;
    clickId?: string;
    locale?: string;
    deviceType?: string;
    revenue?: number;
    currency?: string;
    metadata?: Record<string, any>;
}

declare global {
    interface Window {
        fbq?: (...args: any[]) => void;
        _fbq?: any;
        gtag?: (...args: any[]) => void;
        dataLayer?: any[];
        ttq?: any;
    }
}

const _env = (import.meta as any).env ?? {};
const ENV_PIXEL_DEFAULTS = {
    metaPixelId: (_env.VITE_META_PIXEL_ID as string) || null,
    ga4MeasurementId: (_env.VITE_GA4_MEASUREMENT_ID as string) || null,
    gtmContainerId: (_env.VITE_GTM_CONTAINER_ID as string) || null,
    tiktokPixelId: (_env.VITE_TIKTOK_PIXEL_ID as string) || null,
    utmifyPixelId: (_env.VITE_UTMIFY_PIXEL_ID as string) || null,
};

let pixelConfig: PublicPixelConfig = {
    metaPixelId: ENV_PIXEL_DEFAULTS.metaPixelId,
    ga4MeasurementId: ENV_PIXEL_DEFAULTS.ga4MeasurementId,
    gtmContainerId: ENV_PIXEL_DEFAULTS.gtmContainerId,
    tiktokPixelId: ENV_PIXEL_DEFAULTS.tiktokPixelId,
    utmifyPixelId: ENV_PIXEL_DEFAULTS.utmifyPixelId,
    enableFirstPartyTracking: true,
    enableEmailTracking: true,
    enableCtaAutoTracking: true,
    customHeadScript: null,
};

let initialized = false;
let pixelsBootstrapped = false;
let autoClickListenerInstalled = false;
const MAX_EVENT_QUEUE = 200;
let eventQueue: OutgoingEventPayload[] = [];
let flushTimer: number | null = null;
let lastPageKey = '';
let lastPageAt = 0;

const BEHAVIOR_STORAGE_KEY = 'torex_website_behavior_v1';

export interface WebsiteBehaviorSnapshot {
    pageviews: number;
    engagedActions: number;
    firstSeenAt: number;
    lastActiveAt: number;
    visitedRoutes: string[];
}

function loadBehaviorSnapshot(): WebsiteBehaviorSnapshot {
    const now = Date.now();
    const fallback: WebsiteBehaviorSnapshot = {
        pageviews: 0,
        engagedActions: 0,
        firstSeenAt: now,
        lastActiveAt: now,
        visitedRoutes: [],
    };
    if (typeof window === 'undefined') return fallback;
    try {
        const raw = window.localStorage.getItem(BEHAVIOR_STORAGE_KEY);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return {
            pageviews: Math.max(0, Number(parsed?.pageviews) || 0),
            engagedActions: Math.max(0, Number(parsed?.engagedActions) || 0),
            firstSeenAt: Number(parsed?.firstSeenAt) || now,
            lastActiveAt: Number(parsed?.lastActiveAt) || now,
            visitedRoutes: Array.isArray(parsed?.visitedRoutes)
                ? parsed.visitedRoutes.filter((r: unknown): r is string => typeof r === 'string').slice(-15)
                : [],
        };
    } catch {
        return fallback;
    }
}

export function getWebsiteBehaviorSnapshot(): WebsiteBehaviorSnapshot {
    return loadBehaviorSnapshot();
}

export function recordWebsiteBehaviorSignal(kind: 'pageview' | 'action', routeOrTag?: string): WebsiteBehaviorSnapshot {
    const snap = loadBehaviorSnapshot();
    const now = Date.now();
    if (kind === 'pageview') {
        snap.pageviews = Math.min(9999, snap.pageviews + 1);
        const route = (routeOrTag || '').split('?')[0].slice(0, 64);
        if (route && !snap.visitedRoutes.includes(route)) {
            snap.visitedRoutes = [...snap.visitedRoutes, route].slice(-15);
        }
    } else {
        snap.engagedActions = Math.min(9999, snap.engagedActions + 1);
    }
    snap.lastActiveAt = now;
    if (typeof window !== 'undefined') {
        try {
            window.localStorage.setItem(BEHAVIOR_STORAGE_KEY, JSON.stringify(snap));
            window.dispatchEvent(new CustomEvent('torex:behavior-updated', { detail: snap }));
        } catch {
            // ignore storage quota errors
        }
    }
    return snap;
}

function isAdminRoute(pathname?: string): boolean {
    const p = (pathname || (typeof window !== 'undefined' ? window.location.pathname : '')).toLowerCase();
    return p === '/admin' || p.startsWith('/admin/');
}

function detectDeviceType(): string {
    if (typeof window === 'undefined') return 'unknown';
    const w = window.innerWidth;
    if (w > 0 && w < 768) return 'mobile';
    if (w >= 768 && w < 1024) return 'tablet';
    return 'desktop';
}

function extractCurrentContext(overrides?: Partial<OutgoingEventPayload>) {
    const sessionParams = getSessionTrackingParams();
    const attr = getAttributionPayload();
    const firstParams = attr?.firstTouch?.params || {};
    const lastParams = attr?.lastTouch?.params || {};
    const merged = { ...firstParams, ...lastParams, ...sessionParams };

    const clickId = merged.fbclid || merged.gclid || merged.ttclid || merged.msclkid || undefined;
    const rawReferrer =
        typeof document !== 'undefined' && document.referrer
            ? document.referrer.slice(0, 1000)
            : attr?.firstTouch?.referrer || undefined;

    return {
        visitorId: getOrCreateVisitorId(),
        sessionId: getOrCreateSessionId(),
        pagePath: typeof window !== 'undefined' ? window.location.pathname : '/',
        pageTitle: typeof document !== 'undefined' ? document.title.slice(0, 240) : undefined,
        referrer: rawReferrer,
        utmSource: overrides?.utmSource || merged.utm_source || attr?.firstTouch?.channel || undefined,
        utmMedium: overrides?.utmMedium || merged.utm_medium || undefined,
        utmCampaign: overrides?.utmCampaign || merged.utm_campaign || undefined,
        utmContent: overrides?.utmContent || merged.utm_content || attr?.ctaTag || undefined,
        utmTerm: overrides?.utmTerm || merged.utm_term || attr?.intent || undefined,
        utmId: overrides?.utmId || merged.utm_id || undefined,
        clickId,
        locale: typeof document !== 'undefined' ? document.documentElement.lang || 'pt' : 'pt',
        deviceType: detectDeviceType(),
    };
}

function enqueueEvent(payload: OutgoingEventPayload) {
    if (typeof window === 'undefined') return;
    if (payload.eventType === 'pageview') {
        recordWebsiteBehaviorSignal('pageview', payload.pagePath);
    } else if (payload.eventType === 'button_click' || payload.eventType === 'conversion') {
        recordWebsiteBehaviorSignal('action', payload.ctaTag || payload.eventName);
    }
    if (!pixelConfig.enableFirstPartyTracking) return;
    if (isAdminRoute(payload.pagePath) && (payload.eventType === 'pageview' || payload.eventType === 'button_click')) {
        return;
    }

    if (eventQueue.length >= MAX_EVENT_QUEUE) {
        eventQueue.shift();
    }
    eventQueue.push(payload);
    if (eventQueue.length >= 10) {
        void flushEvents(false);
        return;
    }
    if (flushTimer === null) {
        flushTimer = window.setTimeout(() => {
            flushTimer = null;
            void flushEvents(false);
        }, 1200);
    }
}

export async function flushEvents(useBeacon = false): Promise<void> {
    if (eventQueue.length === 0) return;
    const batch = eventQueue.splice(0, 40);
    const body = JSON.stringify({ events: batch });

    if (useBeacon) {
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (typeof fetch === 'function') {
            try {
                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                if (token) headers.Authorization = `Bearer ${token}`;
                await fetch('/api/analytics/track', {
                    method: 'POST',
                    headers,
                    body,
                    keepalive: true,
                });
                return;
            } catch {
                // Fall through to sendBeacon / axios
            }
        }
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
            try {
                const blob = new Blob([body], { type: 'application/json' });
                navigator.sendBeacon('/api/analytics/track', blob);
                return;
            } catch {
                // Fall back to axios
            }
        }
    }

    try {
        await api.post('/analytics/track', { events: batch });
    } catch {
        // Never disrupt UX on analytics failures
    }
}

function injectMetaPixel(pixelId: string) {
    if (typeof window === 'undefined' || !pixelId || document.getElementById('torex-meta-pixel')) return;
    if (!window.fbq) {
        const n: any = function (...args: any[]) {
            if (n.callMethod) n.callMethod.apply(n, args);
            else n.queue.push(args);
        };
        if (!window._fbq) window._fbq = n;
        n.push = n;
        n.loaded = true;
        n.version = '2.0';
        n.queue = [];
        window.fbq = n;
    }
    const script = document.createElement('script');
    script.id = 'torex-meta-pixel';
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(script);
    window.fbq?.('init', pixelId);
}

function injectGa4(measurementId: string) {
    if (typeof window === 'undefined' || !measurementId || document.getElementById('torex-ga4-pixel')) return;
    window.dataLayer = window.dataLayer || [];
    if (!window.gtag) {
        window.gtag = function (...args: any[]) {
            window.dataLayer!.push(args);
        };
    }
    const script = document.createElement('script');
    script.id = 'torex-ga4-pixel';
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.appendChild(script);
    window.gtag('js', new Date());
    window.gtag('config', measurementId, { send_page_view: false });
}

function injectGtm(containerId: string) {
    if (typeof window === 'undefined' || !containerId || document.getElementById('torex-gtm-script')) return;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
    const script = document.createElement('script');
    script.id = 'torex-gtm-script';
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(containerId)}`;
    document.head.appendChild(script);
}

function injectTikTokPixel(pixelId: string) {
    if (typeof window === 'undefined' || !pixelId || document.getElementById('torex-tiktok-pixel')) return;
    const script = document.createElement('script');
    script.id = 'torex-tiktok-pixel';
    script.async = true;
    script.src = `https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(pixelId)}&lib=ttq`;
    document.head.appendChild(script);
}

function injectUtmify(pixelId: string) {
    if (typeof window === 'undefined' || !pixelId || document.getElementById('torex-utmify-pixel')) return;
    const script = document.createElement('script');
    script.id = 'torex-utmify-pixel';
    script.async = true;
    script.defer = true;
    script.src = 'https://cdn.utmify.com.br/scripts/utms/latest.js';
    script.setAttribute('data-utmify-prevent-subids', '');
    script.setAttribute('data-utmify-pixel-id', pixelId);
    document.head.appendChild(script);
}

function bootstrapExternalPixels() {
    if (pixelsBootstrapped || hasAttributionOptOut() || isAdminRoute()) return;
    pixelsBootstrapped = true;

    if (pixelConfig.metaPixelId) injectMetaPixel(pixelConfig.metaPixelId);
    if (pixelConfig.ga4MeasurementId) injectGa4(pixelConfig.ga4MeasurementId);
    if (pixelConfig.gtmContainerId) injectGtm(pixelConfig.gtmContainerId);
    if (pixelConfig.tiktokPixelId) injectTikTokPixel(pixelConfig.tiktokPixelId);
    if (pixelConfig.utmifyPixelId) injectUtmify(pixelConfig.utmifyPixelId);
}

function dispatchThirdPartyEvent(
    eventName: string,
    params: Record<string, any> = {},
    isPageView = false,
) {
    if (hasAttributionOptOut() || isAdminRoute()) return;
    try {
        if (window.fbq && pixelConfig.metaPixelId) {
            if (isPageView) {
                window.fbq('track', 'PageView');
            } else {
                const standardMap: Record<string, string> = {
                    signup: 'CompleteRegistration',
                    purchase: 'Purchase',
                    trial_start: 'StartTrial',
                    checkout_started: 'InitiateCheckout',
                    lead: 'Lead',
                };
                const mapped = standardMap[eventName];
                if (mapped) {
                    window.fbq('track', mapped, params);
                } else {
                    window.fbq('trackCustom', eventName, params);
                }
            }
        }
        if (window.gtag && pixelConfig.ga4MeasurementId) {
            if (isPageView) {
                window.gtag('event', 'page_view', {
                    page_path: params.page_path,
                    page_title: params.page_title,
                });
            } else {
                window.gtag('event', eventName, params);
            }
        }
        if (window.dataLayer) {
            window.dataLayer.push({ event: eventName, ...params });
        }
        if (window.ttq && pixelConfig.tiktokPixelId) {
            if (isPageView) window.ttq.page?.();
            else window.ttq.track?.(eventName, params);
        }
    } catch {
        // Ignore third-party pixel script errors
    }
}

export async function initTracking(): Promise<void> {
    if (typeof window === 'undefined' || initialized) return;
    initialized = true;

    installGlobalCtaClickListener();

    window.addEventListener('pagehide', () => {
        void flushEvents(true);
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            void flushEvents(true);
        }
    });
    window.addEventListener(COOKIE_CONSENT_EVENT, () => {
        if (!hasAttributionOptOut()) {
            bootstrapExternalPixels();
        }
    });

    try {
        const res = await api.get<PublicPixelConfig>('/analytics/pixel-config');
        const remote = res.data;
        pixelConfig = {
            metaPixelId: remote?.metaPixelId || ENV_PIXEL_DEFAULTS.metaPixelId,
            ga4MeasurementId: remote?.ga4MeasurementId || ENV_PIXEL_DEFAULTS.ga4MeasurementId,
            gtmContainerId: remote?.gtmContainerId || ENV_PIXEL_DEFAULTS.gtmContainerId,
            tiktokPixelId: remote?.tiktokPixelId || ENV_PIXEL_DEFAULTS.tiktokPixelId,
            utmifyPixelId: remote?.utmifyPixelId || ENV_PIXEL_DEFAULTS.utmifyPixelId,
            enableFirstPartyTracking: remote?.enableFirstPartyTracking ?? true,
            enableEmailTracking: remote?.enableEmailTracking ?? true,
            enableCtaAutoTracking: remote?.enableCtaAutoTracking ?? true,
            customHeadScript: remote?.customHeadScript || null,
        };
    } catch {
        // Use env defaults if config endpoint temporarily unavailable
    }

    bootstrapExternalPixels();
}

export function trackPageView(pagePath?: string, pageTitle?: string): void {
    if (typeof window === 'undefined') return;
    const path = pagePath || `${window.location.pathname}${window.location.search}`;
    if (isAdminRoute(path)) return;

    const now = Date.now();
    if (path === lastPageKey && now - lastPageAt < 800) {
        return;
    }
    lastPageKey = path;
    lastPageAt = now;

    const ctx = extractCurrentContext();
    enqueueEvent({
        ...ctx,
        eventName: 'page_view',
        eventType: 'pageview',
        pagePath: window.location.pathname,
        pageTitle: (pageTitle || document.title || '').slice(0, 240),
        metadata: { search: window.location.search.slice(0, 500) },
    });

    dispatchThirdPartyEvent(
        'page_view',
        {
            page_path: window.location.pathname,
            page_title: document.title,
            utm_source: ctx.utmSource,
            utm_campaign: ctx.utmCampaign,
        },
        true,
    );
}

export function trackButtonClick(options: {
    ctaTag: string;
    label?: string;
    intent?: string;
    elementId?: string;
    targetUrl?: string;
    pagePath?: string;
    metadata?: Record<string, any>;
}): void {
    if (typeof window === 'undefined') return;
    const path = options.pagePath || window.location.pathname;
    if (isAdminRoute(path)) return;

    setLastIntent(options.ctaTag, options.intent);
    const ctx = extractCurrentContext({
        utmContent: options.ctaTag,
        utmTerm: options.intent,
    });

    enqueueEvent({
        ...ctx,
        eventName: 'cta_click',
        eventType: 'button_click',
        pagePath: path,
        elementId: options.elementId?.slice(0, 120),
        elementLabel: (options.label || options.ctaTag).slice(0, 250),
        ctaTag: options.ctaTag.slice(0, 120),
        intent: options.intent?.slice(0, 120),
        targetUrl: options.targetUrl?.slice(0, 1000),
        utmContent: options.ctaTag.slice(0, 200),
        utmTerm: options.intent?.slice(0, 200) || ctx.utmTerm,
        metadata: options.metadata,
    });

    dispatchThirdPartyEvent('cta_click', {
        cta_tag: options.ctaTag,
        intent: options.intent,
        label: options.label || options.ctaTag,
        page_path: path,
    });
}

export function trackConversion(
    eventName: 'signup' | 'login' | 'checkout_started' | 'trial_start' | 'purchase' | 'lead',
    options?: {
        revenue?: number;
        currency?: string;
        metadata?: Record<string, any>;
    },
): void {
    if (typeof window === 'undefined') return;
    const ctx = extractCurrentContext();

    enqueueEvent({
        ...ctx,
        eventName,
        eventType: eventName === 'login' ? 'custom' : 'conversion',
        revenue: options?.revenue,
        currency: options?.currency || 'USD',
        metadata: options?.metadata,
    });

    dispatchThirdPartyEvent(eventName, {
        value: options?.revenue,
        currency: options?.currency || 'USD',
        utm_source: ctx.utmSource,
        utm_campaign: ctx.utmCampaign,
        cta_tag: ctx.utmContent,
        ...options?.metadata,
    });

    void flushEvents(false);
}

export async function identifyUserOnTracker(): Promise<void> {
    if (typeof window === 'undefined' || !localStorage.getItem('token')) return;
    try {
        await api.post('/analytics/identify', {
            visitorId: getOrCreateVisitorId(),
            attributionData: getAttributionPayload(),
        });
    } catch {
        // Non-blocking
    }
}

export async function trackUserAction(options: {
    actionType: string;
    label?: string;
    pagePath?: string;
    metadata?: Record<string, any>;
}): Promise<void> {
    if (typeof window === 'undefined' || !localStorage.getItem('token')) return;
    const path = options.pagePath || window.location.pathname;
    if (isAdminRoute(path)) return;
    try {
        await api.post('/analytics/activity', {
            actionType: options.actionType.slice(0, 64),
            label: options.label?.slice(0, 180),
            pagePath: path.slice(0, 255),
            metadata: options.metadata,
        });
    } catch {
        // Non-blocking
    }
}

function slugifyElementLabel(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 60);
}

export function installGlobalCtaClickListener(): void {
    if (typeof document === 'undefined' || autoClickListenerInstalled) return;
    autoClickListenerInstalled = true;

    document.addEventListener(
        'click',
        (evt) => {
            if (!pixelConfig.enableCtaAutoTracking || isAdminRoute()) return;
            const target = evt.target as HTMLElement | null;
            if (!target) return;

            const interactive = target.closest('a, button, [role="button"], [data-cta-tag], [data-track]') as HTMLElement | null;
            if (!interactive) return;

            // Skip elements explicitly opted-out of auto tracking (e.g. elements with custom explicit handler)
            if (interactive.dataset.trackExplicit === 'true') return;

            const explicitTag = interactive.dataset.ctaTag || interactive.dataset.track;
            const label =
                interactive.getAttribute('aria-label') ||
                interactive.dataset.trackLabel ||
                (interactive.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);

            if (!explicitTag && (!label || label.length < 2)) return;

            const ctaTag = explicitTag || `auto_${slugifyElementLabel(label) || interactive.tagName.toLowerCase()}`;
            const intent = interactive.dataset.intent || undefined;
            const href = interactive instanceof HTMLAnchorElement ? interactive.getAttribute('href') || undefined : undefined;

            trackButtonClick({
                ctaTag,
                intent,
                label: label || ctaTag,
                elementId: interactive.id || undefined,
                targetUrl: href,
            });
        },
        { capture: true },
    );
}
