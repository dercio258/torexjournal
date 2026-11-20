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
import { Inject, Logger, Optional, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Server, Socket } from 'socket.io';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { browser } from '../proto/browser_packet';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { AccountEntity } from '../account/account.entity';
import { UserEntity } from '../users/user.entity';
import { SessionEntity } from '../auth/session.entity';
import { TelemetryService } from '../common/observability/telemetry.service';
import { getJwtSecret, isCorsOriginAllowed } from '../common/security/security.config';

@WebSocketGateway({
    cors: {
        origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
            if (isCorsOriginAllowed(origin)) {
                callback(null, true);
            } else {
                callback(new Error('CORS origin denied'));
            }
        },
        credentials: true,
    },
})
export class Mt5Gateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
    @WebSocketServer() server: Server;
    private logger: Logger = new Logger('Mt5Gateway');
    private readonly instanceId = randomUUID();
    private pubRedis: Redis | null = null;
    private subRedis: Redis | null = null;
    private pubReady = false;
    private pubsubChannel = 'torex:ws:mt5_events';
    private clients = new Map<
        any,
        { authenticated: boolean; userId?: string; timeout?: NodeJS.Timeout }
    >();

    constructor(
        private readonly jwtService: JwtService,
        @Optional() private readonly configService?: ConfigService,
        @Optional()
        @InjectRepository(AccountEntity)
        private readonly accountRepo?: Repository<AccountEntity>,
        @Optional()
        @InjectRepository(UserEntity)
        private readonly userRepo?: Repository<UserEntity>,
        @Optional()
        @InjectRepository(SessionEntity)
        private readonly sessionRepo?: Repository<SessionEntity>,
        @Optional()
        @Inject(CACHE_MANAGER)
        private readonly cacheManager?: Cache,
        @Optional() private readonly telemetry?: TelemetryService,
    ) {}

    afterInit() {
        this.logger.log('WebSocket Gateway Initialized (Socket.IO + Protobuf/JSON Hybrid)');
    }

    async onModuleInit() {
        const host = (this.configService?.get<string>('REDIS_HOST') || process.env.REDIS_HOST || '').trim();
        if (!host) return;
        const port = Number(this.configService?.get<number>('REDIS_PORT') || process.env.REDIS_PORT || 6379);
        const password = this.configService?.get<string>('REDIS_PASSWORD') || process.env.REDIS_PASSWORD || undefined;
        const prefix = (this.configService?.get<string>('REDIS_PREFIX') || process.env.REDIS_PREFIX || '{cossa_trading}').trim();
        this.pubsubChannel = `${prefix}:ws:mt5_events`;

        try {
            this.pubRedis = new Redis({ host, port, password, maxRetriesPerRequest: 1, lazyConnect: true });
            this.subRedis = new Redis({ host, port, password, maxRetriesPerRequest: 1, lazyConnect: true });
            this.pubRedis.on('ready', () => { this.pubReady = true; });
            this.pubRedis.on('error', () => { this.pubReady = false; });
            this.subRedis.on('error', () => {});
            this.subRedis.on('message', (channel, raw) => {
                if (channel !== this.pubsubChannel) return;
                try {
                    const msg = JSON.parse(raw);
                    if (!msg || msg.originId === this.instanceId || !msg.userId) return;
                    if (msg.kind === 'packet' && msg.packet) {
                        this.emitLocalPacket(msg.packet, msg.eventName, msg.jsonPayload, msg.userId);
                    } else if (msg.kind === 'behavior_alert' && msg.jsonPayload) {
                        this.emitLocalBehaviorAlert(msg.jsonPayload, msg.userId);
                    }
                } catch {}
            });

            await this.pubRedis.connect().catch(() => {});
            await this.subRedis.connect().catch(() => {});
            if (this.subRedis.status === 'ready') {
                await this.subRedis.subscribe(this.pubsubChannel).catch(() => {});
            }
        } catch (err: any) {
            this.logger.warn(`Mt5Gateway Redis Pub/Sub bridge disabled: ${err?.message || err}`);
        }
    }

    async onModuleDestroy() {
        this.pubReady = false;
        await Promise.allSettled([
            this.pubRedis ? this.pubRedis.quit().catch(() => this.pubRedis?.disconnect()) : Promise.resolve(),
            this.subRedis ? this.subRedis.quit().catch(() => this.subRedis?.disconnect()) : Promise.resolve(),
        ]);
    }

    private async resolveActualMt5ConnectionState(userId: string): Promise<boolean> {
        if (!this.accountRepo || !userId) return false;
        try {
            const count = await this.accountRepo.count({
                where: {
                    userId,
                    isConnected: true,
                    isArchived: false,
                    broker: Not('Deriv'),
                },
            });
            return count > 0;
        } catch {
            return false;
        }
    }

    private async verifySocketToken(rawToken?: string): Promise<string | null> {
        if (!rawToken) return null;
        const cleanToken = String(rawToken).replace(/^Bearer\s+/i, '').trim();
        if (!cleanToken) return null;

        const payload: any = await this.jwtService.verifyAsync(cleanToken, {
            secret: getJwtSecret(this.configService),
        });
        const userId = payload?.id || payload?.sub;
        if (!userId || payload?.isTwoFactorPending) {
            throw new Error('Token pendente ou sem utilizador válido');
        }

        // Verify session is active (respects logout/session revocation)
        let sessionActive = false;
        if (this.cacheManager) {
            const cached = await this.cacheManager.get(`user_session:${cleanToken}`).catch(() => null);
            if (cached === 'active') sessionActive = true;
        }
        if (!sessionActive && this.sessionRepo) {
            const session = await this.sessionRepo.findOne({
                where: { token: cleanToken, isActive: true },
                select: ['id', 'expiresAt'],
            });
            if (session && new Date() <= session.expiresAt) {
                sessionActive = true;
            }
        } else if (!this.sessionRepo && !this.cacheManager) {
            sessionActive = true;
        }
        if (!sessionActive) {
            throw new Error('Sessão expirada ou revogada');
        }

        // Verify blocked status & 2FA completion
        if (this.userRepo) {
            const user = await this.userRepo.findOne({
                where: { id: userId },
                select: ['id', 'isBlocked', 'twoFactorEnabled', 'isTwoFactorConfirmed'],
            });
            if (!user || user.isBlocked) {
                throw new Error('Conta bloqueada ou não encontrada');
            }
            if (user.twoFactorEnabled && user.isTwoFactorConfirmed && !payload.isTwoFactorVerified) {
                throw new Error('Verificação 2FA pendente');
            }
        }

        return userId;
    }

    async handleConnection(client: Socket) {
        const handshakeToken =
            client.handshake?.auth?.token ||
            (client.handshake?.headers?.authorization || '').replace(/^Bearer\s+/i, '') ||
            (client.handshake?.query?.token as string);

        if (handshakeToken) {
            try {
                const userId = await this.verifySocketToken(handshakeToken);
                if (userId) {
                    this.clients.set(client, { authenticated: true, userId });
                    this.telemetry?.setWsActiveClients(this.clients.size);
                    if (typeof client.join === 'function') {
                        client.join(`mt5_user:${userId}`);
                    }
                    if (typeof client.emit === 'function') {
                        const isConnected = await this.resolveActualMt5ConnectionState(userId);
                        client.emit('mt5_connection_status', { isConnected });
                    }
                    return;
                }
            } catch (e: any) {
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
        this.telemetry?.setWsActiveClients(this.clients.size);

        if (typeof client.on === 'function') {
            client.on('message', (data: any) => this.handleRawMessage(client, data));
            client.on('mt5_packet', (data: any) => this.handleRawMessage(client, data));
        }
    }

    handleDisconnect(client: Socket) {
        const clientData = this.clients.get(client);
        if (clientData?.timeout) clearTimeout(clientData.timeout);
        this.clients.delete(client);
        this.telemetry?.setWsActiveClients(this.clients.size);
    }

    @SubscribeMessage('mt5_auth')
    async handleSocketAuth(
        @MessageBody() data: { token?: string },
        @ConnectedSocket() client: Socket,
    ) {
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
        } catch (e: any) {
            this.logger.debug(`Packet decode skipped: ${e.message}`);
        }
    }

    private async handleAuth(client: any, auth: browser.IAuth) {
        if (!auth || !auth.token) return;

        try {
            const userId = await this.verifySocketToken(auth.token);
            if (!userId) {
                throw new Error('Token inválido');
            }
            const clientData = this.clients.get(client);
            if (clientData) {
                if (clientData.timeout) clearTimeout(clientData.timeout);
                clientData.authenticated = true;
                clientData.userId = userId;
                if (typeof client.join === 'function') {
                    client.join(`mt5_user:${userId}`);
                }
                if (typeof client.emit === 'function') {
                    const isConnected = await this.resolveActualMt5ConnectionState(userId);
                    client.emit('mt5_connection_status', { isConnected });
                }
            }
        } catch (e: any) {
            this.logger.warn(`WS Auth failed: ${e.message}`);
            if (typeof client.disconnect === 'function') {
                client.disconnect(true);
            } else if (typeof client.close === 'function') {
                client.close();
            }
        }
    }

    private emitLocalPacket(
        packet: browser.IBrowserPacket,
        eventName: string | undefined,
        jsonPayload: any,
        userId: string,
    ) {
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
            } catch (e: any) {
                this.logger.warn(`Failed to send to client: ${e.message}`);
            }
        });
    }

    private emitLocalBehaviorAlert(payload: Record<string, any>, userId: string) {
        const roomName = `mt5_user:${userId}`;
        if (this.server && typeof this.server.to === 'function') {
            this.server.to(roomName).emit('mt5_behavior_alert', payload);
            return;
        }

        this.clients.forEach((clientData, client) => {
            if (!clientData?.authenticated || clientData.userId !== userId) return;
            try {
                if (typeof client.emit === 'function') {
                    client.emit('mt5_behavior_alert', payload);
                }
            } catch (e: any) {
                this.logger.warn(`Failed to emit mt5_behavior_alert to client: ${e?.message || e}`);
            }
        });
    }

    private broadcast(
        packet: browser.IBrowserPacket,
        eventName?: string,
        jsonPayload?: any,
        userId?: string,
    ) {
        if (!userId) {
            this.logger.warn(
                `Blocked unscoped WS broadcast (${eventName || packet.type}): userId is required.`,
            );
            return;
        }

        this.emitLocalPacket(packet, eventName, jsonPayload, userId);

        if (this.pubRedis && this.pubReady) {
            void this.pubRedis
                .publish(
                    this.pubsubChannel,
                    JSON.stringify({
                        originId: this.instanceId,
                        kind: 'packet',
                        packet,
                        eventName,
                        jsonPayload,
                        userId,
                    }),
                )
                .catch(() => {});
        }
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

    broadcastConnectionStatus(
        data: { isConnected: boolean; accountId?: string; mt5Id?: string },
        userId?: string,
    ) {
        this.broadcast(
            {
                type: browser.PacketType.CONNECTION_STATUS,
                connectionStatus: { isConnected: data.isConnected },
            },
            'mt5_connection_status',
            data,
            userId,
        );
    }

    broadcastBehaviorAlert(payload: Record<string, any>, userId?: string) {
        if (!userId) {
            this.logger.warn('Blocked unscoped WS behavior alert broadcast: userId is required.');
            return;
        }

        this.emitLocalBehaviorAlert(payload, userId);

        if (this.pubRedis && this.pubReady) {
            void this.pubRedis
                .publish(
                    this.pubsubChannel,
                    JSON.stringify({
                        originId: this.instanceId,
                        kind: 'behavior_alert',
                        jsonPayload: payload,
                        userId,
                    }),
                )
                .catch(() => {});
        }
    }
}
