import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { mergeSessionUtmsIntoSearch, sanitizeReturnTo } from '../lib/attribution';

export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
    const { isAuthenticated } = useAuth();
    const location = useLocation();

    if (!isAuthenticated) {
        const candidatePath = `${location.pathname}${location.search}${location.hash}`;
        const safeReturnTo = sanitizeReturnTo(candidatePath);
        const params = new URLSearchParams();
        if (safeReturnTo) {
            params.set('returnTo', safeReturnTo);
        }
        try {
            if (sessionStorage.getItem('torex_auth_expired') === '1') {
                params.set('reason', 'session_expired');
                sessionStorage.removeItem('torex_auth_expired');
            }
        } catch {
            // Ignore storage errors
        }

        const baseSearch = params.toString() ? `?${params.toString()}` : '';
        const finalSearch = mergeSessionUtmsIntoSearch(baseSearch);

        return <Navigate to={`/login${finalSearch}`} state={{ from: location }} replace />;
    }

    return <>{children}</>;
};
