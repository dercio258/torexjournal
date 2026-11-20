import api from '../api';
import { getWebsiteBehaviorSnapshot } from './tracking';

export const PWA_STATE_EVENT = 'torex:pwa-state-changed';
const PWA_INSTALLED_KEY = 'torex_pwa_installed_v1';
const PWA_PROMPT_DISMISSED_AT_KEY = 'torex_pwa_prompt_dismissed_at';
const PWA_WELCOME_SEEN_KEY = 'torex_pwa_welcome_seen_v1';
const PROMPT_COOLDOWN_MS = 3 * 86_400_000;

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let pwaInitialized = false;
let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let appJustInstalled = false;

function emitPwaStateChanged() {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(PWA_STATE_EVENT));
}

export function isStandaloneMode(): boolean {
    if (typeof window === 'undefined') return false;
    const mql = typeof window.matchMedia === 'function' ? window.matchMedia('(display-mode: standalone)') : null;
    const iosStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    return Boolean(mql?.matches || iosStandalone);
}

export function isIosDevice(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    return /iphone|ipad|ipod/i.test(ua) && !('MSStream' in window);
}

export function isAppMarkedInstalled(): boolean {
    if (isStandaloneMode()) return true;
    if (typeof window === 'undefined') return false;
    try {
        return window.localStorage.getItem(PWA_INSTALLED_KEY) === '1';
    } catch {
        return false;
    }
}

export function wasAppJustInstalled(): boolean {
    return appJustInstalled;
}

export function clearAppJustInstalledFlag(): void {
    appJustInstalled = false;
    emitPwaStateChanged();
}

export function canTriggerNativeInstall(): boolean {
    return Boolean(deferredInstallPrompt);
}

export function markPwaPromptDismissed(): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(PWA_PROMPT_DISMISSED_AT_KEY, String(Date.now()));
    } catch {
        // ignore
    }
    emitPwaStateChanged();
}

export function hasSeenStandaloneWelcome(): boolean {
    if (typeof window === 'undefined') return true;
    try {
        return window.localStorage.getItem(PWA_WELCOME_SEEN_KEY) === '1';
    } catch {
        return false;
    }
}

export function markStandaloneWelcomeSeen(): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(PWA_WELCOME_SEEN_KEY, '1');
    } catch {
        // ignore
    }
    emitPwaStateChanged();
}

export function shouldProposeWebsiteInstall(): boolean {
    if (typeof window === 'undefined') return false;
    if (isStandaloneMode() || isAppMarkedInstalled()) return false;
    const path = (window.location.pathname || '').toLowerCase();
    if (path.startsWith('/admin') || path.startsWith('/verify-account')) return false;

    try {
        const dismissedRaw = window.localStorage.getItem(PWA_PROMPT_DISMISSED_AT_KEY);
        if (dismissedRaw && Date.now() - Number(dismissedRaw) < PROMPT_COOLDOWN_MS) {
            return false;
        }
    } catch {
        // ignore
    }

    const behavior = getWebsiteBehaviorSnapshot();
    const timeOnSiteMs = Date.now() - behavior.firstSeenAt;
    return behavior.pageviews >= 2 || behavior.engagedActions >= 1 || timeOnSiteMs >= 20_000;
}

export function initPwaManager(): void {
    if (typeof window === 'undefined' || pwaInitialized) return;
    pwaInitialized = true;

    window.addEventListener('beforeinstallprompt', (e: Event) => {
        e.preventDefault();
        deferredInstallPrompt = e as BeforeInstallPromptEvent;
        emitPwaStateChanged();
    });

    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        appJustInstalled = true;
        try {
            window.localStorage.setItem(PWA_INSTALLED_KEY, '1');
        } catch {
            // ignore
        }
        emitPwaStateChanged();
    });
}

export async function triggerNativeInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    if (!deferredInstallPrompt) return 'unavailable';
    try {
        await deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        if (choice.outcome === 'accepted') {
            appJustInstalled = true;
            try {
                window.localStorage.setItem(PWA_INSTALLED_KEY, '1');
            } catch {
                // ignore
            }
        }
        emitPwaStateChanged();
        return choice.outcome;
    } catch {
        return 'unavailable';
    }
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

export function isWebPushSupported(): boolean {
    if (typeof window === 'undefined') return false;
    return 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
}

export async function getLocalPushStatus(): Promise<{
    supported: boolean;
    permission: NotificationPermission | 'unsupported';
    subscribed: boolean;
}> {
    if (!isWebPushSupported()) {
        return { supported: false, permission: 'unsupported', subscribed: false };
    }
    const permission = Notification.permission;
    try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager?.getSubscription();
        return {
            supported: true,
            permission,
            subscribed: Boolean(sub && permission === 'granted'),
        };
    } catch {
        return { supported: true, permission, subscribed: false };
    }
}

export async function subscribeUserToPush(options?: {
    locale?: 'pt' | 'en';
    sendWelcome?: boolean;
}): Promise<{ ok: boolean; reason?: string }> {
    if (!isWebPushSupported()) {
        return { ok: false, reason: 'unsupported' };
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        emitPwaStateChanged();
        return { ok: false, reason: permission };
    }

    const vapidRes = await api.get('/notifications/push/vapid-public-key');
    const publicKey: string | null = vapidRes.data?.publicKey || null;
    if (!vapidRes.data?.enabled || !publicKey) {
        return { ok: false, reason: 'vapid_unconfigured' };
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
        const keyBytes = urlBase64ToUint8Array(publicKey);
        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: keyBytes as BufferSource,
        });
    }

    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        return { ok: false, reason: 'invalid_subscription' };
    }

    await api.post('/notifications/push/subscribe', {
        endpoint: json.endpoint,
        keys: {
            p256dh: json.keys.p256dh,
            auth: json.keys.auth,
        },
        isStandaloneApp: isStandaloneMode(),
        locale: options?.locale || 'pt',
        sendWelcome: options?.sendWelcome !== false,
    });

    emitPwaStateChanged();
    return { ok: true };
}
