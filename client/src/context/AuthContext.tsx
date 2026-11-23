import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import api from '../api';
import { identifyUserOnTracker } from '../lib/tracking';
import {
    getCurrentUserScope,
    getUserProfileFromIDB,
    rememberUserScope,
    saveUserProfileInIDB,
    wipeAllOfflineData,
} from '../services/offlineDb';
import { useOfflineSyncStore } from '../store/useOfflineSyncStore';
import { queryClient } from '../lib/queryClient';
import { clearBacktestTransientClientState } from '../services/backtestWorkspaceStore';
import { maskEmailClient } from '../lib/payloadCrypto';

function decodeJwtSubject(jwtToken: string): string | null {
    try {
        const parts = jwtToken.split('.');
        if (parts.length !== 3 || !parts[1]) return null;
        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
        const payload = JSON.parse(atob(padded));
        const sub = payload?.sub || payload?.id || payload?.userId;
        return sub ? String(sub) : null;
    } catch {
        return null;
    }
}

export interface AuthUser {
    id: string;
    email: string;
    username: string;
    name?: string;
    avatarUrl?: string | null;
    is_connected?: boolean;
    tier?: 'FREE' | 'BASIC' | 'PRO' | 'PREMIUM';
    onboardingCompleted?: boolean;
    trialJustGranted?: boolean;
    trialDays?: number;
    trialEligible?: boolean;
    whatsapp?: string | null;
    preferredMpesa?: string | null;
    preferredEmola?: string | null;
    preferredLocale?: 'pt' | 'en';
    timezone?: string | null;
    twoFactorEnabled?: boolean;
    subscription?: {
        expiresAt: string;
        status?: string;
        cycle?: string;
        tier?: string;
    } | null;
}

interface AuthContextType {
    token: string | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    login: (token: string, email?: string) => void;
    logout: () => void;
    refreshProfile: () => Promise<AuthUser | null>;
    userEmail: string | null;
    user: AuthUser | null;
    updateUser: (data: Partial<AuthUser>) => void;
}

const USER_CACHE_KEY = 'torex_user_cache';

function readCachedUser(): AuthUser | null {
    try {
        const raw = localStorage.getItem(USER_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.id) {
            return parsed as AuthUser;
        }
    } catch {
        // ignore storage/parse errors
    }
    return null;
}

function writeCachedUser(user: AuthUser | null) {
    try {
        if (!user) {
            localStorage.removeItem(USER_CACHE_KEY);
            return;
        }
        const persistable: AuthUser = { ...user };
        delete persistable.trialJustGranted;
        delete persistable.trialDays;
        localStorage.setItem(USER_CACHE_KEY, JSON.stringify(persistable));
        if (persistable.id) {
            rememberUserScope(persistable.id);
            void saveUserProfileInIDB(persistable.id, persistable);
        }
    } catch {
        // ignore storage quota errors
    }
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [token, setTokenObj] = useState<string | null>(() => localStorage.getItem('token'));
    const [userEmail, setUserEmail] = useState<string | null>(() => localStorage.getItem('userEmail'));
    const [user, setUser] = useState<AuthUser | null>(() => (localStorage.getItem('token') ? readCachedUser() : null));
    const [isLoading, setIsLoading] = useState<boolean>(() => {
        const hasToken = Boolean(localStorage.getItem('token'));
        if (!hasToken) return false;
        return readCachedUser() === null;
    });

    const inFlightProfileRef = useRef<Promise<AuthUser | null> | null>(null);
    const identifiedSessionRef = useRef<string | null>(null);

    const fetchProfile = useCallback(async (): Promise<AuthUser | null> => {
        const currentToken = localStorage.getItem('token');
        if (!currentToken) {
            setIsLoading(false);
            return null;
        }

        if (inFlightProfileRef.current) {
            return inFlightProfileRef.current;
        }

        const requestPromise = (async () => {
            try {
                const res = await api.get('/auth/profile');
                if (res.data) {
                    const data: AuthUser = res.data;
                    setUser(data);
                    writeCachedUser(data);
                    if (data.email) {
                        localStorage.setItem('userEmail', data.email);
                        setUserEmail(data.email);
                    }
                    if (
                        (data.preferredLocale === 'en' || data.preferredLocale === 'pt') &&
                        !localStorage.getItem('torex_locale_manual')
                    ) {
                        localStorage.setItem('torex_locale', data.preferredLocale);
                    }
                    const sessionKey = `${data.id}:${currentToken}`;
                    if (data.id && identifiedSessionRef.current !== sessionKey) {
                        identifiedSessionRef.current = sessionKey;
                        void identifyUserOnTracker();
                    }
                    return data;
                }
                return null;
            } catch (e) {
                console.error('Failed to fetch profile', e);
                // api.ts interceptor handles 401 and emits auth:unauthorized
                return null;
            } finally {
                inFlightProfileRef.current = null;
                setIsLoading(false);
            }
        })();

        inFlightProfileRef.current = requestPromise;
        return requestPromise;
    }, []);

    useEffect(() => {
        if (!token) {
            setIsLoading(false);
            return;
        }
        let cancelled = false;
        if (!user) {
            const scope = getCurrentUserScope();
            void getUserProfileFromIDB(scope).then((profile) => {
                if (cancelled || !profile || !profile.id) return;
                setUser((prev) => prev || (profile as AuthUser));
                writeCachedUser(profile as AuthUser);
                if (profile.email) {
                    localStorage.setItem('userEmail', String(profile.email));
                    setUserEmail((prev) => prev || String(profile.email));
                }
                setIsLoading(false);
            });
        }
        void fetchProfile();
        return () => {
            cancelled = true;
        };
    }, [token, fetchProfile]);

    const performLocalLogoutCleanup = useCallback(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('userEmail');
        localStorage.removeItem('torex_selected_account_id');
        localStorage.removeItem('torex_last_user_scope');
        localStorage.removeItem('torex_accounts_cache');
        writeCachedUser(null);
        queryClient.clear();
        clearBacktestTransientClientState();
        void wipeAllOfflineData();
        useOfflineSyncStore.setState({
            isSyncing: false,
            syncStatus:
                typeof navigator !== 'undefined' && !navigator.onLine
                    ? 'offline'
                    : 'idle',
            pendingMutationsCount: 0,
            pendingMediaCount: 0,
            backtestPendingCount: 0,
            failedMutations: [],
            lastSyncedAt: null,
            justSyncedBannerUntil: null,
        });
        inFlightProfileRef.current = null;
        identifiedSessionRef.current = null;
        setTokenObj(null);
        setUserEmail(null);
        setUser(null);
        setIsLoading(false);
    }, []);

    const logout = useCallback(() => {
        if (localStorage.getItem('token')) {
            void api.post('/auth/logout').catch(() => {});
        }
        performLocalLogoutCleanup();
        try {
            if (typeof BroadcastChannel !== 'undefined') {
                const bc = new BroadcastChannel('torex_auth_channel');
                bc.postMessage({ type: 'TOREX_LOGOUT' });
                bc.close();
            }
        } catch {
            // ignore BroadcastChannel errors
        }
    }, [performLocalLogoutCleanup]);

    useEffect(() => {
        const handleUnauthorized = () => {
            // Expiração de sessão 401: remove apenas o JWT e pausa sincronização sem apagar dados locais/IDB
            localStorage.removeItem('token');
            inFlightProfileRef.current = null;
            setTokenObj(null);
            setIsLoading(false);
            useOfflineSyncStore
                .getState()
                .setSyncState({ syncStatus: 'paused_auth' });
        };

        window.addEventListener('auth:unauthorized', handleUnauthorized);

        let bc: BroadcastChannel | null = null;
        try {
            if (typeof BroadcastChannel !== 'undefined') {
                bc = new BroadcastChannel('torex_auth_channel');
                bc.onmessage = (evt) => {
                    if (evt?.data?.type === 'TOREX_LOGOUT') {
                        performLocalLogoutCleanup();
                    }
                };
            }
        } catch {
            // ignore BroadcastChannel unsupported browsers
        }

        return () => {
            window.removeEventListener('auth:unauthorized', handleUnauthorized);
            bc?.close();
        };
    }, [performLocalLogoutCleanup]);

    const login = useCallback((newToken: string, email?: string) => {
        const previousToken = localStorage.getItem('token');
        const previousCachedUser = readCachedUser();
        const nextSubject = decodeJwtSubject(newToken);
        const previousSubject =
            (previousToken ? decodeJwtSubject(previousToken) : null) ||
            (previousCachedUser?.id ? String(previousCachedUser.id) : null) ||
            (getCurrentUserScope() !== 'anon' ? getCurrentUserScope() : null);

        if (nextSubject && previousSubject && nextSubject !== previousSubject) {
            queryClient.clear();
            clearBacktestTransientClientState();
            localStorage.removeItem('torex_selected_account_id');
            localStorage.removeItem('torex_accounts_cache');
            writeCachedUser(null);
        }

        if (nextSubject) {
            rememberUserScope(nextSubject);
        }

        localStorage.setItem('token', newToken);
        if (email) {
            const maskedEmail = maskEmailClient(email);
            localStorage.setItem('userEmail', maskedEmail);
            setUserEmail(maskedEmail);
        }
        if (previousToken !== newToken) {
            setIsLoading(readCachedUser() === null);
            setTokenObj(newToken);
            // useEffect([token]) will trigger fetchProfile() once cleanly
        } else {
            fetchProfile();
        }
        window.dispatchEvent(new Event('auth:login-success'));
    }, [fetchProfile]);

    const updateUser = useCallback((data: Partial<AuthUser>) => {
        setUser(prev => {
            if (!prev) return null;
            const updated = { ...prev, ...data };
            writeCachedUser(updated);
            return updated;
        });
    }, []);

    return (
        <AuthContext.Provider
            value={{
                token,
                isAuthenticated: !!token,
                login,
                logout,
                refreshProfile: fetchProfile,
                userEmail,
                user,
                isLoading,
                updateUser,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
