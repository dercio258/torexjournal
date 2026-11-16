import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { browser } from '../proto/browser_packet';
import { useAuth } from './AuthContext';

interface SocketContextType {
    socket: Socket | null;
    isConnected: boolean;
    mt5Status: 'connected' | 'disconnected';
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export const SocketProvider = ({ children }: { children: ReactNode }) => {
    const { token, user } = useAuth();
    const queryClient = useQueryClient();
    const lastAccountCacheInvalidateRef = useRef(0);
    const [socket, setSocket] = useState<Socket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [mt5Status, setMt5Status] = useState<'connected' | 'disconnected'>(() =>
        user?.is_connected ? 'connected' : 'disconnected'
    );

    useEffect(() => {
        if (typeof user?.is_connected === 'boolean') {
            setMt5Status(user.is_connected ? 'connected' : 'disconnected');
        }
    }, [user?.is_connected]);

    useEffect(() => {
        const notifyAccountCache = () => {
            const now = Date.now();
            if (now - lastAccountCacheInvalidateRef.current > 3_000) {
                lastAccountCacheInvalidateRef.current = now;
                void queryClient.invalidateQueries({ queryKey: ['accounts'] });
            }
        };
        const notifyHistoryCache = () => {
            void queryClient.invalidateQueries({ queryKey: ['trades'] });
            void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
            void queryClient.invalidateQueries({ queryKey: ['accounts'] });
        };

        if (!token) {
            if (socket) {
                socket.disconnect();
                setSocket(null);
            }
            return;
        }

        const ioSocket = io('/', {
            path: '/socket.io',
            auth: { token },
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 3000,
        });

        let pingInterval: ReturnType<typeof setInterval> | null = null;

        ioSocket.on('connect', () => {
            setIsConnected(true);
            ioSocket.emit('mt5_auth', { token });

            try {
                const authPacket = browser.BrowserPacket.create({
                    type: browser.PacketType.AUTH,
                    auth: { token },
                });
                const buffer = browser.BrowserPacket.encode(authPacket).finish();
                ioSocket.emit('mt5_packet', buffer);
            } catch {
                // Protobuf optional fallback
            }

            pingInterval = setInterval(() => {
                if (ioSocket.connected) {
                    ioSocket.emit('mt5_ping');
                }
            }, 30000);
        });

        ioSocket.on('disconnect', () => {
            setIsConnected(false);
            if (pingInterval) {
                clearInterval(pingInterval);
                pingInterval = null;
            }
        });

        ioSocket.on('connect_error', () => {
            setIsConnected(false);
        });

        ioSocket.on('mt5_account_update', (data: any) => {
            if (data) {
                setMt5Status('connected');
                notifyAccountCache();
                window.dispatchEvent(new CustomEvent('mt5_account_update', { detail: data }));
            }
        });

        ioSocket.on('mt5_history_update', (data: any) => {
            if (data) {
                notifyHistoryCache();
                window.dispatchEvent(new CustomEvent('mt5_history_update', { detail: data }));
            }
        });

        ioSocket.on('mt5_connection_status', (data: any) => {
            if (data && typeof data.isConnected === 'boolean') {
                setMt5Status(data.isConnected ? 'connected' : 'disconnected');
                window.dispatchEvent(new CustomEvent('mt5_connection_status', { detail: data }));
            }
        });

        ioSocket.on('mt5_packet', (rawPayload: ArrayBuffer | Uint8Array) => {
            try {
                const buffer =
                    rawPayload instanceof Uint8Array
                        ? rawPayload
                        : new Uint8Array(rawPayload as ArrayBuffer);
                const packet = browser.BrowserPacket.decode(buffer);

                switch (packet.type) {
                    case browser.PacketType.PONG:
                        break;
                    case browser.PacketType.ACCOUNT_UPDATE:
                        if (packet.accountUpdate) {
                            setMt5Status('connected');
                            notifyAccountCache();
                            window.dispatchEvent(
                                new CustomEvent('mt5_account_update', {
                                    detail: packet.accountUpdate,
                                }),
                            );
                        }
                        break;
                    case browser.PacketType.HISTORY_UPDATE:
                        if (packet.historyUpdate) {
                            notifyHistoryCache();
                            window.dispatchEvent(
                                new CustomEvent('mt5_history_update', {
                                    detail: packet.historyUpdate,
                                }),
                            );
                        }
                        break;
                    case browser.PacketType.CONNECTION_STATUS:
                        if (packet.connectionStatus) {
                            setMt5Status(
                                packet.connectionStatus.isConnected ? 'connected' : 'disconnected',
                            );
                        }
                        break;
                    default:
                        break;
                }
            } catch {
                // Ignore malformed binary frame
            }
        });

        setSocket(ioSocket);

        return () => {
            if (pingInterval) clearInterval(pingInterval);
            ioSocket.disconnect();
        };
    }, [token]);

    return (
        <SocketContext.Provider value={{ socket, isConnected, mt5Status }}>
            {children}
        </SocketContext.Provider>
    );
};

export const useSocket = () => {
    const context = useContext(SocketContext);
    if (!context) {
        throw new Error('useSocket must be used within a SocketProvider');
    }
    return context;
};
