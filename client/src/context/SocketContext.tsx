import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { browser } from '../proto/browser_packet';
import { useAuth } from './AuthContext';
import api from '../api';

interface SocketContextType {
    socket: Socket | null;
    isConnected: boolean;
    mt5Status: 'connected' | 'disconnected';
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export const SocketProvider = ({ children }: { children: ReactNode }) => {
    const { token } = useAuth();
    const [socket, setSocket] = useState<Socket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [mt5Status, setMt5Status] = useState<'connected' | 'disconnected'>('disconnected');

    useEffect(() => {
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
            // Silencia erros transitórios de reconexão (ex: 502 durante restart do PM2)
            setIsConnected(false);
        });

        ioSocket.on('mt5_account_update', (data: any) => {
            if (data) {
                setMt5Status('connected');
                window.dispatchEvent(new CustomEvent('mt5_account_update', { detail: data }));
            }
        });

        ioSocket.on('mt5_history_update', (data: any) => {
            if (data) {
                window.dispatchEvent(new CustomEvent('mt5_history_update', { detail: data }));
            }
        });

        ioSocket.on('mt5_connection_status', (data: any) => {
            if (data && typeof data.isConnected === 'boolean') {
                setMt5Status(data.isConnected ? 'connected' : 'disconnected');
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
                            window.dispatchEvent(
                                new CustomEvent('mt5_account_update', { detail: packet.accountUpdate })
                            );
                        }
                        break;
                    case browser.PacketType.HISTORY_UPDATE:
                        if (packet.historyUpdate) {
                            window.dispatchEvent(
                                new CustomEvent('mt5_history_update', { detail: packet.historyUpdate })
                            );
                        }
                        break;
                    case browser.PacketType.CONNECTION_STATUS:
                        if (packet.connectionStatus) {
                            setMt5Status(packet.connectionStatus.isConnected ? 'connected' : 'disconnected');
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
        checkInitialStatus();

        return () => {
            if (pingInterval) clearInterval(pingInterval);
            ioSocket.disconnect();
        };
    }, [token]);

    const checkInitialStatus = async () => {
        try {
            const currentToken = localStorage.getItem('token');
            if (!currentToken) return;

            const res = await api.get('/account');
            if (res.data && (res.data.isConnected || res.data.is_connected)) {
                setMt5Status('connected');
            } else {
                setMt5Status('disconnected');
            }
        } catch {
            // Ignore initial status error
        }
    };

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
