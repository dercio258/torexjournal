import React from 'react';
import { SocketProvider } from '../context/SocketContext';
import { AccountProvider } from '../context/AccountContext';
import { MainLayout } from './MainLayout';

/**
 * Isolated shell for authenticated trader workspace routes.
 * Lazy-loaded so public marketing/auth/legal routes never download or mount
 * Socket.IO, Protobuf packets, or trading account state.
 */
export const AuthenticatedAppShell: React.FC = () => (
    <SocketProvider>
        <AccountProvider>
            <MainLayout />
        </AccountProvider>
    </SocketProvider>
);

export default AuthenticatedAppShell;
