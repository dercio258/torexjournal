import {
    WebSocketGateway,
    WebSocketServer,
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    SubscribeMessage,
    MessageBody,
    ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { browser } from '../proto/browser_packet';
import { JwtService } from '@nestjs/jwt';

@WebSocketGateway({
    cors: {
        origin: '*',
    },
})
export class Mt5Gateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer() server: Server;
    private logger: Logger = new Logger('Mt5Gateway');
    private clients = new Map<any, { authenticated: boolean; userId?: string; timeout?: NodeJS.Timeout }>();

    constructor(private readonly jwtService: JwtService) {}

    afterInit() {
        this.logger.log('WebSocket Gateway Initialized (Socket.IO + Protobuf/JSON Hybrid)');
    }

    async handleConnection(client: Socket) {
        const handshakeToken =
            client.handshake?.auth?.token ||
            (client.handshake?.headers?.authorization || '').replace(/^Bearer\s+/i, '') ||
            (client.handshake?.query?.token as string);

        if (handshakeToken) {
            try {
                const payload = this.jwtService.verify(handshakeToken);
                const userId = payload.id || payload.sub;
                this.clients.set(client, { authenticated: true, userId });
                if (userId && typeof client.join === 'function') {
                    client.join(`mt5_user:${userId}`);
                }
                if (typeof client.emit === 'function') {
                    client.emit('mt5_connection_status', { isConnected: true });
                }
                return;
            } catch (e) {
                this.logger.debug(`Handshake token verification failed: ${e.message}`);
            }
        }

        const timeout = setTimeout(() => {
            if (this.clients.has(client) && !this.clients.get(client)?.authenticated) {
                if (typeof client.disconnect === 'function') {
                    client.disconnect(true);
                } else if (typeof (client as any).close === 'function') {
                    (client as any).close();
                }
            }
        }, 10000);

        this.clients.set(client, { authenticated: false, timeout });

        if (typeof client.on === 'function') {
            client.on('message', (data: any) => this.handleRawMessage(client, data));
            client.on('mt5_packet', (data: any) => this.handleRawMessage(client, data));
        }
    }

    handleDisconnect(client: Socket) {
        const clientData = this.clients.get(client);
        if (clientData?.timeout) clearTimeout(clientData.timeout);
        this.clients.delete(client);
    }

    @SubscribeMessage('mt5_auth')
    async handleSocketAuth(@MessageBody() data: { token?: string }, @ConnectedSocket() client: Socket) {
        if (!data?.token) return;
        await this.handleAuth(client, { token: data.token });
    }

    @SubscribeMessage('mt5_ping')
    handleSocketPing(@ConnectedSocket() client: Socket) {
        if (typeof client.emit === 'function') {
            client.emit('mt5_pong', { ts: Date.now() });
        }
    }

    private async handleRawMessage(client: any, rawData: any) {
        try {
            const buf = Buffer.isBuffer(rawData)
                ? rawData
                : rawData instanceof ArrayBuffer
                  ? Buffer.from(rawData)
                  : ArrayBuffer.isView(rawData)
                    ? Buffer.from(rawData.buffer, rawData.byteOffset, rawData.byteLength)
                    : null;

            if (!buf) return;
            const packet = browser.BrowserPacket.decode(buf);

            if (packet.type === browser.PacketType.AUTH && packet.auth) {
                await this.handleAuth(client, packet.auth);
            } else if (packet.type === browser.PacketType.PING) {
                const pong = browser.BrowserPacket.create({ type: browser.PacketType.PONG });
                const encoded = browser.BrowserPacket.encode(pong).finish();
                if (typeof client.emit === 'function') {
                    client.emit('mt5_packet', encoded);
                } else if (typeof client.send === 'function') {
                    client.send(encoded);
                }
            }
        } catch (e) {
            this.logger.debug(`Packet decode skipped: ${e.message}`);
        }
    }

    private async handleAuth(client: any, auth: browser.IAuth) {
        if (!auth || !auth.token) return;

        try {
            const payload = this.jwtService.verify(auth.token);
            const userId = payload.id || payload.sub;
            const clientData = this.clients.get(client);
            if (clientData) {
                if (clientData.timeout) clearTimeout(clientData.timeout);
                clientData.authenticated = true;
                clientData.userId = userId;
                if (userId && typeof client.join === 'function') {
                    client.join(`mt5_user:${userId}`);
                }
            }
        } catch (e) {
            this.logger.warn(`WS Auth failed: ${e.message}`);
            if (typeof client.disconnect === 'function') {
                client.disconnect(true);
            } else if (typeof client.close === 'function') {
                client.close();
            }
        }
    }

    private broadcast(packet: browser.IBrowserPacket, eventName?: string, jsonPayload?: any, userId?: string) {
        if (!userId) {
            this.logger.warn(`Blocked unscoped WS broadcast (${eventName || packet.type}): userId is required to prevent cross-user data leakage.`);
            return;
        }

        const message = browser.BrowserPacket.create(packet);
        const buffer = browser.BrowserPacket.encode(message).finish();
        const roomName = `mt5_user:${userId}`;

        if (this.server && typeof this.server.to === 'function') {
            const room = this.server.to(roomName);
            room.emit('mt5_packet', buffer);
            if (eventName && jsonPayload !== undefined) {
                room.emit(eventName, jsonPayload);
            }
            return;
        }

        this.clients.forEach((clientData, client) => {
            if (!clientData?.authenticated || clientData.userId !== userId) return;
            try {
                if (typeof client.emit === 'function') {
                    client.emit('mt5_packet', buffer);
                    if (eventName && jsonPayload !== undefined) {
                        client.emit(eventName, jsonPayload);
                    }
                } else if (client.readyState === 1 && typeof client.send === 'function') {
                    client.send(buffer);
                }
            } catch (e) {
                this.logger.warn(`Failed to send to client: ${e.message}`);
            }
        });
    }

    broadcastAccountUpdate(data: browser.IAccountUpdate, userId?: string) {
        this.broadcast(
            {
                type: browser.PacketType.ACCOUNT_UPDATE,
                accountUpdate: data,
            },
            'mt5_account_update',
            data,
            userId,
        );
    }

    broadcastHistoryUpdate(data: browser.IHistoryUpdate, userId?: string) {
        this.broadcast(
            {
                type: browser.PacketType.HISTORY_UPDATE,
                historyUpdate: data,
            },
            'mt5_history_update',
            data,
            userId,
        );
    }

    broadcastConnectionStatus(data: { isConnected: boolean }, userId?: string) {
        this.broadcast(
            {
                type: browser.PacketType.CONNECTION_STATUS,
                connectionStatus: data,
            },
            'mt5_connection_status',
            data,
            userId,
        );
    }
}
