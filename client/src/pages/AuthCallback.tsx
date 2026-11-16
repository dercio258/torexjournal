import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { StandalonePageSkeleton } from '../components/ui/Skeleton';
import { sanitizeReturnTo } from '../lib/attribution';
import { identifyUserOnTracker, trackConversion } from '../lib/tracking';
import api from '../api';

export const AuthCallback = () => {
    const { login } = useAuth();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    useEffect(() => {
        const code = searchParams.get('code');
        const legacyToken = searchParams.get('token');
        const requiresContact = searchParams.get('requiresContact') === 'true';
        const returnTo = sanitizeReturnTo(searchParams.get('returnTo'));

        // Immediately strip sensitive query parameters from browser history/URL bar
        if (window.location.search) {
            window.history.replaceState({}, document.title, window.location.pathname);
        }

        const completeSignIn = async (token: string, needsContact: boolean) => {
            login(token);
            await identifyUserOnTracker();
            trackConversion('login', { metadata: { method: 'oauth' } });
            if (needsContact) {
                navigate('/complete-profile', { replace: true });
            } else {
                // OnboardingSurvey runs automatically inside MainLayout when onboardingCompleted === false
                navigate(returnTo || '/dashboard', { replace: true });
            }
        };

        if (code) {
            let cancelled = false;
            api.post('/auth/oauth/exchange', { code })
                .then((res) => {
                    if (cancelled) return;
                    const data = res.data;
                    if (data?.twoFactorRequired && data?.twoFactorToken) {
                        navigate(`/2fa?twoFactorToken=${encodeURIComponent(data.twoFactorToken)}`, { replace: true });
                        return;
                    }
                    if (data?.token) {
                        completeSignIn(data.token, Boolean(data.requiresContact));
                        return;
                    }
                    navigate('/login', { replace: true });
                })
                .catch(() => {
                    if (!cancelled) {
                        navigate('/login', { replace: true });
                    }
                });
            return () => {
                cancelled = true;
            };
        }

        if (legacyToken) {
            completeSignIn(legacyToken, requiresContact);
        } else {
            navigate('/login', { replace: true });
        }
    }, [login, navigate, searchParams]);

    return <StandalonePageSkeleton />;
};
