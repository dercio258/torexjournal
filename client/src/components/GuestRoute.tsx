import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { sanitizeReturnTo } from '../lib/attribution';

export const GuestRoute = ({ children }: { children: React.ReactNode }) => {
    const { isAuthenticated } = useAuth();
    const location = useLocation();

    if (isAuthenticated) {
        const params = new URLSearchParams(location.search);
        const queryReturnTo = sanitizeReturnTo(params.get('returnTo'));
        const stateFrom = location.state?.from;
        const stateReturnTo = stateFrom
            ? sanitizeReturnTo(`${stateFrom.pathname || ''}${stateFrom.search || ''}${stateFrom.hash || ''}`)
            : null;

        return <Navigate to={queryReturnTo || stateReturnTo || '/dashboard'} replace />;
    }

    return <>{children}</>;
};
