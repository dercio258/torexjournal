
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export const GuestRoute = ({ children }: { children: React.ReactNode }) => {
    const { isAuthenticated } = useAuth();

    if (isAuthenticated) {
        // Redirect to dashboard (or where they came from) if already logged in
        return <Navigate to="/dashboard" replace />;
    }

    return <>{children}</>;
};
