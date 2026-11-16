import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import api from '../api';
import { identifyUserOnTracker } from '../lib/tracking';
import {
    getCurrentUserScope,
    getUserProfileFromIDB,
    rememberUserScope,
    saveUserProfileInIDB,
} from '../services/offlineDb';
import { useOfflineSyncStore } from '../store/useOfflineSyncStore';

export interface AuthUser {
    id: string;
    email: string;
    username: string;
    name?: string;
    avatarUrl?: string | null;
    is_connected?: boolean;
    tier?: 'FREE' | 'BASIC' | 'PRO' | 'PREMIUM';
    onboardingCompleted?: boolean;
    hasUsedTrial?: boolean;
    trialUsedAt?: string;
    trialJustGranted?: boolean;
    trialDays?: number;
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
        // Never persist ephemeral celebration flags across reloads
        const { trialJustGranted: _ephemeral, ...persistable } = user;
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

    const logout = useCallback(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('userEmail');
        writeCachedUser(null);
        inFlightProfileRef.current = null;
        identifiedSessionRef.current = null;
        setTokenObj(null);
        setUserEmail(null);
        setUser(null);
        setIsLoading(false);
    }, []);

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
        return () => {
            window.removeEventListener('auth:unauthorized', handleUnauthorized);
        };
    }, []);

    const login = useCallback((newToken: string, email?: string) => {
        const previousToken = localStorage.getItem('token');
        localStorage.setItem('token', newToken);
        if (email) {
            localStorage.setItem('userEmail', email);
            setUserEmail(email);
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
