import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api';
import { SocketProvider } from '../context/SocketContext';
import { AccountProvider } from '../context/AccountContext';
import { useAuth } from '../context/AuthContext';
import { MainLayout } from './MainLayout';
import { RouteSkeletonResolver } from '../components/ui/Skeleton';
import { MockDashboardBackdrop } from '../components/subscription/MockDashboardBackdrop';
import { WorkspacePricingModal } from '../components/subscription/WorkspacePricingModal';

interface LiveSubCheck {
    checked: boolean;
    hasActive: boolean;
    isExpired: boolean;
    trialEligible: boolean;
}

/**
 * Isolated shell for authenticated trader workspace routes.
 * Enforces an explicit subscription barrier BEFORE mounting SocketProvider,
 * AccountProvider, or any workspace route so expired/FREE accounts receive
 * zero real user data or websocket events.
 */
export const AuthenticatedAppShell: React.FC = () => {
    const { user, isLoading, refreshProfile } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();

    const [subCheck, setSubCheck] = useState<LiveSubCheck>({
        checked: false,
        hasActive: Boolean(user?.tier && user.tier !== 'FREE'),
        isExpired: false,
        trialEligible: Boolean(user?.trialEligible),
    });

    const verifyLiveSubscription = async () => {
        try {
            const res = await api.get('/subscription/status');
            const d = res.data || {};
            setSubCheck({
                checked: true,
                hasActive: Boolean(d.hasActive),
                isExpired: Boolean(d.isExpired),
                trialEligible: Boolean(d.trialEligible),
            });
        } catch {
            setSubCheck((prev) => ({
                ...prev,
                checked: true,
                hasActive: Boolean(user?.tier && user.tier !== 'FREE'),
            }));
        }
    };

    useEffect(() => {
        if (!user?.id) return;
        let cancelled = false;
        api.get('/subscription/status')
            .then((res) => {
                if (cancelled) return;
                const d = res.data || {};
                setSubCheck({
                    checked: true,
                    hasActive: Boolean(d.hasActive),
                    isExpired: Boolean(d.isExpired),
                    trialEligible: Boolean(d.trialEligible),
                });
            })
            .catch(() => {
                if (cancelled) return;
                setSubCheck((prev) => ({
                    ...prev,
                    checked: true,
                    hasActive: Boolean(user?.tier && user.tier !== 'FREE'),
                }));
            });
        return () => {
            cancelled = true;
        };
    }, [user?.id, user?.tier]);

    const userHasPlan = Boolean(user?.tier && user.tier !== 'FREE');
    const isUnlocked = subCheck.checked ? (subCheck.hasActive && userHasPlan) : userHasPlan;

    // When locked, sanitize URL back to clean /dashboard without query params
    useEffect(() => {
        if (!isLoading && user && subCheck.checked && !isUnlocked) {
            if (location.pathname !== '/dashboard' || location.search) {
                navigate('/dashboard', { replace: true });
            }
        }
    }, [isLoading, user, subCheck.checked, isUnlocked, location.pathname, location.search, navigate]);

    if (isLoading || !user || !subCheck.checked) {
        return (
            <div className="h-screen w-screen bg-canvas p-6">
                <RouteSkeletonResolver />
            </div>
        );
    }

    if (!isUnlocked) {
        return (
            <div className="relative h-screen w-screen overflow-hidden bg-canvas">
                <MockDashboardBackdrop />
                <WorkspacePricingModal
                    isOpen={true}
                    dismissible={false}
                    isExpired={subCheck.isExpired}
                    trialEligible={subCheck.trialEligible}
                    onActivated={() => {
                        void refreshProfile();
                        void verifyLiveSubscription();
                    }}
                />
            </div>
        );
    }

    return (
        <SocketProvider>
            <AccountProvider>
                <MainLayout />
            </AccountProvider>
        </SocketProvider>
    );
};

export default AuthenticatedAppShell;
