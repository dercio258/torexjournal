import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { updateUserPreferencesOfflineAware } from '../services/offlineMutations';
import {
    captureAttributionFromWindow,
    getAttributionPayload,
    getLightweightClientMetadata,
    isAcquisitionFunnelPath,
    mergeSessionUtmsIntoSearch,
} from '../lib/attribution';
import { initTracking, trackPageView } from '../lib/tracking';

export type AppLocale = 'pt' | 'en';
export type UrlLocalePrefix = '' | '/en' | '/pt';

interface LocaleState {
    locale: AppLocale;
    prefix: UrlLocalePrefix;
}

interface LocaleContextValue {
    locale: AppLocale;
    prefix: UrlLocalePrefix;
    setLocale: (next: AppLocale) => void;
    localizeBrowserPath: (internalPath: string, targetLocale?: AppLocale) => string;
}

export const LOCALE_STORAGE_KEY = 'torex_locale';
export const LOCALE_MANUAL_KEY = 'torex_locale_manual';

function isBrowserDefaultEnglish(): boolean {
    if (typeof navigator === 'undefined') return false;
    const primary = navigator.language || navigator.languages?.[0] || '';
    return /^en\b/i.test(primary.trim());
}

export function stripLocalePrefix(pathname: string): string {
    if (pathname === '/en' || pathname === '/pt') return '/';
    if (pathname.startsWith('/en/')) return pathname.slice(3) || '/';
    if (pathname.startsWith('/pt/')) return pathname.slice(3) || '/';
    return pathname || '/';
}

/**
 * Synchronously determines the active locale outside React hook trees
 * (useful inside utility modules, formatters, and chart mappers).
 */
export function getCurrentLocale(): AppLocale {
    if (typeof window === 'undefined') return 'pt';
    const pathname = window.location.pathname || '';
    if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'pt';
    if (pathname === '/en' || pathname.startsWith('/en/')) return 'en';
    if (pathname === '/pt' || pathname.startsWith('/pt/')) return 'pt';
    try {
        const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
        if (stored === 'en' || stored === 'pt') return stored;
    } catch { }
    return isBrowserDefaultEnglish() ? 'en' : 'pt';
}

/**
 * Synchronously resolves URL prefix & active locale in 0ms (zero network delay).
 * Rules:
 * 1. `/admin` and `/admin/*` are always unprefixed (`''`, `'pt'`).
 * 2. Accidental suffixes like `/dashboard/en` or `/login/pt` normalize immediately to `/en/dashboard` or `/pt/login`.
 * 3. Explicit `/en` or `/en/*` activates `'en'`.
 * 4. Explicit `/pt` or `/pt/*` activates `'pt'` and locks manual `'pt'`.
 * 5. Unprefixed `/` or `/*`: defaults to `'pt'`, UNLESS the user previously selected `'en'` OR starts navigation with browser in `'en'` without a manual `'pt'` lock.
 */
function resolveAndNormalizeUrlSync(): LocaleState {
    if (typeof window === 'undefined') {
        return { locale: 'pt', prefix: '' };
    }

    captureAttributionFromWindow();

    let { pathname, search, hash } = window.location;

    // 1. Protect /admin/* isolation (strip accidental /en/admin or /pt/admin)
    if (pathname === '/en/admin' || pathname.startsWith('/en/admin/')) {
        const cleanAdmin = pathname.slice(3);
        window.history.replaceState(null, '', `${cleanAdmin}${search}${hash}`);
        return { locale: 'pt', prefix: '' };
    }
    if (pathname === '/pt/admin' || pathname.startsWith('/pt/admin/')) {
        const cleanAdmin = pathname.slice(3);
        window.history.replaceState(null, '', `${cleanAdmin}${search}${hash}`);
        return { locale: 'pt', prefix: '' };
    }
    if (pathname === '/admin' || pathname.startsWith('/admin/')) {
        return { locale: 'pt', prefix: '' };
    }

    // 2. Normalize accidental suffixes like /dashboard/en -> /en/dashboard
    const suffixMatch = pathname.match(/^\/(.+?)\/(en|pt)\/?$/i);
    if (suffixMatch) {
        const restPath = suffixMatch[1];
        const suffixLang = suffixMatch[2].toLowerCase() as AppLocale;
        if (!restPath.startsWith('en/') && !restPath.startsWith('pt/')) {
            const normalizedPath = `/${suffixLang}/${restPath}`;
            window.history.replaceState(null, '', `${normalizedPath}${search}${hash}`);
            pathname = normalizedPath;
        }
    }

    // 3. Explicit /en or /en/*
    if (pathname === '/en' || pathname.startsWith('/en/')) {
        try {
            localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
        } catch { }
        const stripped = stripLocalePrefix(pathname);
        if (isAcquisitionFunnelPath(stripped)) {
            const mergedSearch = mergeSessionUtmsIntoSearch(search);
            if (mergedSearch !== search) {
                window.history.replaceState(null, '', `${pathname}${mergedSearch}${hash}`);
            }
        }
        return { locale: 'en', prefix: '/en' };
    }

    // 4. Explicit /pt or /pt/*
    if (pathname === '/pt' || pathname.startsWith('/pt/')) {
        try {
            localStorage.setItem(LOCALE_STORAGE_KEY, 'pt');
            localStorage.setItem(LOCALE_MANUAL_KEY, 'true');
        } catch { }
        const stripped = stripLocalePrefix(pathname);
        if (isAcquisitionFunnelPath(stripped)) {
            const mergedSearch = mergeSessionUtmsIntoSearch(search);
            if (mergedSearch !== search) {
                window.history.replaceState(null, '', `${pathname}${mergedSearch}${hash}`);
            }
        }
        return { locale: 'pt', prefix: '/pt' };
    }

    // 5. Unprefixed URL (/ or /*)
    let savedLocale: AppLocale | null = null;
    let isManual = false;
    try {
        const rawLocale = localStorage.getItem(LOCALE_STORAGE_KEY);
        if (rawLocale === 'en' || rawLocale === 'pt') savedLocale = rawLocale;
        isManual = localStorage.getItem(LOCALE_MANUAL_KEY) === 'true';
    } catch { }

    const shouldUseEnglish =
        savedLocale === 'en' || (!isManual && savedLocale !== 'pt' && isBrowserDefaultEnglish());

    if (shouldUseEnglish) {
        const enPathname = pathname === '/' ? '/en' : `/en${pathname}`;
        const finalSearch = isAcquisitionFunnelPath(pathname)
            ? mergeSessionUtmsIntoSearch(search)
            : search;
        window.history.replaceState(null, '', `${enPathname}${finalSearch}${hash}`);
        try {
            localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
        } catch { }
        return { locale: 'en', prefix: '/en' };
    }

    if (isAcquisitionFunnelPath(pathname)) {
        const mergedSearch = mergeSessionUtmsIntoSearch(search);
        if (mergedSearch !== search) {
            window.history.replaceState(null, '', `${pathname}${mergedSearch}${hash}`);
        }
    }

    return { locale: 'pt', prefix: '' };
}

const LocaleContext = createContext<LocaleContextValue>({
    locale: 'pt',
    prefix: '',
    setLocale: () => undefined,
    localizeBrowserPath: (p) => p,
});

/**
 * Watches internal route transitions inside `<BrowserRouter>`:
 * 1. Captures incoming UTMify params on every navigation.
 * 2. Carries active session UTMify params across public/acquisition funnel routes (`/`, `/login`, `/register`, `/pricing`, `/checkout`).
 * 3. Handles accidental internal links to `/en` or `/pt` when basename is `''`.
 */
const RouterAttributionAndPrefixSync: React.FC<{
    onSyncState: (next: LocaleState) => void;
    currentPrefix: UrlLocalePrefix;
}> = ({ onSyncState, currentPrefix }) => {
    const location = useLocation();

    useEffect(() => {
        void initTracking();
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const browserPath = window.location.pathname;

        // Catch internal <Link to="/en"> or <Link to="/pt"> when basename is ''
        if (currentPrefix === '' && (browserPath === '/en' || browserPath.startsWith('/en/'))) {
            try {
                localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
            } catch { }
            onSyncState({ locale: 'en', prefix: '/en' });
            return;
        }
        if (currentPrefix === '' && (browserPath === '/pt' || browserPath.startsWith('/pt/'))) {
            try {
                localStorage.setItem(LOCALE_STORAGE_KEY, 'pt');
                localStorage.setItem(LOCALE_MANUAL_KEY, 'true');
            } catch { }
            onSyncState({ locale: 'pt', prefix: '/pt' });
            return;
        }

        captureAttributionFromWindow();

        const stripped = stripLocalePrefix(browserPath);
        if (isAcquisitionFunnelPath(stripped)) {
            const currentSearch = window.location.search;
            const merged = mergeSessionUtmsIntoSearch(currentSearch);
            if (merged !== currentSearch) {
                window.history.replaceState(
                    window.history.state,
                    '',
                    `${browserPath}${merged}${window.location.hash}`
                );
            }
        }

        trackPageView(`${browserPath}${window.location.search}`);
    }, [location.pathname, location.search, currentPrefix, onSyncState]);

    return null;
};

export const LocaleRouter: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [state, setState] = useState<LocaleState>(() => resolveAndNormalizeUrlSync());

    useEffect(() => {
        document.documentElement.lang = state.locale;
    }, [state.locale]);

    useEffect(() => {
        const handlePopState = () => {
            const resolved = resolveAndNormalizeUrlSync();
            setState((prev) =>
                prev.locale === resolved.locale && prev.prefix === resolved.prefix ? prev : resolved
            );
        };
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    const setLocale = useCallback((nextLocale: AppLocale) => {
        try {
            localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
            localStorage.setItem(LOCALE_MANUAL_KEY, 'true');
        } catch { }

        if (typeof window !== 'undefined') {
            const stripped = stripLocalePrefix(window.location.pathname);
            const nextPrefix: UrlLocalePrefix = nextLocale === 'en' ? '/en' : '';
            const nextPath =
                nextLocale === 'en'
                    ? stripped === '/'
                        ? '/en'
                        : `/en${stripped}`
                    : stripped;

            const baseSearch = window.location.search;
            const nextSearch = isAcquisitionFunnelPath(stripped)
                ? mergeSessionUtmsIntoSearch(baseSearch)
                : baseSearch;

            window.history.pushState(null, '', `${nextPath}${nextSearch}${window.location.hash}`);
            setState({ locale: nextLocale, prefix: nextPrefix });

            // Non-blocking background sync to authenticated user profile
            const hasToken = Boolean(localStorage.getItem('token'));
            if (hasToken) {
                const meta = getLightweightClientMetadata();
                const attribution = getAttributionPayload();
                void updateUserPreferencesOfflineAware({
                    preferredLocale: nextLocale,
                    timezone: meta.timezone,
                    attributionData: attribution,
                }).catch(() => undefined);
            }
        }
    }, []);

    const localizeBrowserPath = useCallback(
        (internalPath: string, targetLocale?: AppLocale) => {
            const clean = stripLocalePrefix(internalPath.startsWith('/') ? internalPath : `/${internalPath}`);
            const effective = targetLocale || state.locale;
            if (clean === '/admin' || clean.startsWith('/admin/')) return clean;
            if (effective === 'en') {
                return clean === '/' ? '/en' : `/en${clean}`;
            }
            return clean;
        },
        [state.locale]
    );

    const contextValue = useMemo<LocaleContextValue>(
        () => ({
            locale: state.locale,
            prefix: state.prefix,
            setLocale,
            localizeBrowserPath,
        }),
        [state.locale, state.prefix, setLocale, localizeBrowserPath]
    );

    return (
        <LocaleContext.Provider value={contextValue}>
            <BrowserRouter key={state.prefix || 'root'} basename={state.prefix || undefined}>
                <RouterAttributionAndPrefixSync
                    currentPrefix={state.prefix}
                    onSyncState={setState}
                />
                {children}
            </BrowserRouter>
        </LocaleContext.Provider>
    );
};

export const useLocale = () => useContext(LocaleContext);
