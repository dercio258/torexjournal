
import {
    WebSocketGateway,
    WebSocketServer,
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server } from 'ws'; // Native WebSocket Server type
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
    // Map<Client, { authenticated: boolean, userId: string }>
    private clients = new Map<any, { authenticated: boolean, userId?: string, timeout?: NodeJS.Timeout }>();

    constructor(private readonly jwtService: JwtService) { }

    afterInit(server: Server) {
        this.logger.log('WebSocket Gateway Initialized (Native WS + Protobuf)');
    }

    handleConnection(client: any, ...args: any[]) {
        this.logger.log(`Client connected`);

        // Set timeout to disconnect if not authenticated in 5s
        const timeout = setTimeout(() => {
            if (this.clients.has(client) && !this.clients.get(client).authenticated) {
                this.logger.warn(`Client failed to authenticate in time. Disconnecting.`);
                client.terminate(); // Force close
            }
        }, 5000);

        this.clients.set(client, { authenticated: false, timeout });

        client.on('message', (data: any) => this.handleMessage(client, data));

        // Send status (but client should know it needs to auth first)
        this.broadcastConnectionStatus({ isConnected: true });
    }

    handleDisconnect(client: any) {
        this.logger.log(`Client disconnected`);
        const clientData = this.clients.get(client);
        if (clientData && clientData.timeout) clearTimeout(clientData.timeout);
        this.clients.delete(client);
    }

    private async handleMessage(client: any, buffer: Buffer) {
        try {
            const packet = browser.BrowserPacket.decode(buffer);

            if (packet.type === browser.PacketType.AUTH) {
                await this.handleAuth(client, packet.auth);
            } else if (packet.type === browser.PacketType.PING) {
                // Respond with PONG
                const pong = browser.BrowserPacket.create({ type: browser.PacketType.PONG });
                client.send(browser.BrowserPacket.encode(pong).finish());
            } else {
                // Ignore other messages from browser for now, or handle PING
                if (!this.clients.get(client)?.authenticated) {
                    // Optionally close if sending data before auth
                }
            }
        } catch (e) {
            this.logger.error(`Invalid packet received: ${e.message}`);
        }
    }

    private async handleAuth(client: any, auth: browser.IAuth) {
        if (!auth || !auth.token) return;

        try {
            const payload = this.jwtService.verify(auth.token);
            const clientData = this.clients.get(client);
            if (clientData) {
                if (clientData.timeout) clearTimeout(clientData.timeout);
                clientData.authenticated = true;
                clientData.userId = payload.id;
                this.logger.log(`Client authenticated: User ${payload.id}`);
            }
        } catch (e) {
            this.logger.error(`Auth failed: ${e.message}`);
            client.close();
        }
    }

    private broadcast(packet: browser.IBrowserPacket) {
        // Create, Encode, and Send
        const message = browser.BrowserPacket.create(packet);
        const buffer = browser.BrowserPacket.encode(message).finish();

        this.clients.forEach((clientData, client) => {
            // Only send to authenticated clients
            if (client.readyState === 1 && clientData?.authenticated) {
                try {
                    client.send(buffer);
                } catch (e) {
                    this.logger.warn(`Failed to send to client: ${e.message}`);
                }
            }
        });
    }

    broadcastAccountUpdate(data: browser.IAccountUpdate) {
        this.broadcast({
            type: browser.PacketType.ACCOUNT_UPDATE,
            accountUpdate: data
        });
    }

    broadcastHistoryUpdate(data: browser.IHistoryUpdate) {
        this.broadcast({
            type: browser.PacketType.HISTORY_UPDATE,
            historyUpdate: data
        });
    }

    broadcastConnectionStatus(data: { isConnected: boolean }) {
        this.broadcast({
            type: browser.PacketType.CONNECTION_STATUS,
            connectionStatus: data
        });
    }
}
