import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { browser } from '../proto/browser_packet';
import { useAuth } from './AuthContext';
import api from '../api';

interface SocketContextType {
    socket: WebSocket | null;
    isConnected: boolean;
    mt5Status: 'connected' | 'disconnected';
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export const SocketProvider = ({ children }: { children: ReactNode }) => {
    const { token } = useAuth();
    const [socket, setSocket] = useState<WebSocket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [mt5Status, setMt5Status] = useState<'connected' | 'disconnected'>('disconnected');

    useEffect(() => {
        if (!token) {
            if (socket) {
                socket.close();
                setSocket(null);
            }
            return;
        }

        // Connect to Backend WebSocket
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        const newSocket = new WebSocket(wsUrl);
        newSocket.binaryType = 'arraybuffer';

        let pingInterval: NodeJS.Timeout | null = null;

        newSocket.onopen = () => {
            console.log('✅ Native WebSocket Connected');
            setIsConnected(true);

            // Send Auth Packet immediately
            const authPacket = browser.BrowserPacket.create({
                type: browser.PacketType.AUTH,
                auth: { token }
            });
            const buffer = browser.BrowserPacket.encode(authPacket).finish();
            newSocket.send(buffer);

            // Start Ping Interval
            pingInterval = setInterval(() => {
                if (newSocket.readyState === WebSocket.OPEN) {
                    const ping = browser.BrowserPacket.create({ type: browser.PacketType.PING });
                    newSocket.send(browser.BrowserPacket.encode(ping).finish());
                }
            }, 30000); // 30s Heartbeat
        };

        newSocket.onclose = () => {
            console.warn('❌ Native WebSocket Disconnected');
            setIsConnected(false);
            setMt5Status('disconnected');
            if (pingInterval) {
                clearInterval(pingInterval);
                pingInterval = null;
            }
            // Implement reconnection logic here if needed (e.g. setTimeout)
        };

        newSocket.onerror = (error) => {
            console.error('WebSocket Error:', error);
        };

        newSocket.onmessage = (event) => {
            try {
                const buffer = new Uint8Array(event.data as ArrayBuffer);
                const packet = browser.BrowserPacket.decode(buffer);

                switch (packet.type) {
                    case browser.PacketType.PONG:
                        // Server is alive
                        break;

                    case browser.PacketType.ACCOUNT_UPDATE:
                        if (packet.accountUpdate) {
                            setMt5Status('connected');
                            window.dispatchEvent(new CustomEvent('mt5_account_update', { detail: packet.accountUpdate }));
                        }
                        break;

                    case browser.PacketType.HISTORY_UPDATE:
                        if (packet.historyUpdate) {
                            window.dispatchEvent(new CustomEvent('mt5_history_update', { detail: packet.historyUpdate }));
                        }
                        break;

                    case browser.PacketType.CONNECTION_STATUS:
                        if (packet.connectionStatus) {
                            setMt5Status(packet.connectionStatus.isConnected ? 'connected' : 'disconnected');
                        }
                        break;

                    default:
                        console.log('Unknown packet type:', packet.type);
                }
            } catch (err) {
                console.error('Failed to decode protobuf message:', err);
            }
        };

        setSocket(newSocket);
        checkInitialStatus();

        return () => {
            newSocket.close();
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
        } catch (e) {
            // console.error('Failed to check initial status', e);
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
