import {
    WebSocketGateway,
    WebSocketServer,
    OnGatewayConnection,
    OnGatewayDisconnect,
    MessageBody,
    ConnectedSocket,
} from '@nestjs/websockets';
import * as Ws from '@nestjs/websockets';
const SubscribeMessage: any = (Ws as any).SubscribeMessage;
import { Server, Socket } from 'socket.io';
import { Injectable, Inject, forwardRef, Logger, Optional } from '@nestjs/common';
import { NetworkService } from './network.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { UserEntity } from '../users/user.entity';
import { SessionEntity } from '../auth/session.entity';
import { PlanPermissionService, PlanTier } from '../payment/plan-permission.service';
import { RedisSecurityService } from '../common/security/redis-security.service';
import { buildSessionCacheKey, getJwtSecret, isCorsOriginAllowed } from '../common/security/security.config';
import { extractSocketTokenFromHandshake } from '../common/security/cookie-security.util';

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
    namespace: 'network',
})
@Injectable()
export class NetworkGateway implements OnGatewayConnection, OnGatewayDisconnect {
    private readonly logger = new Logger(NetworkGateway.name);
    private readonly onlineUserSockets = new Map<string, Set<string>>();

    @WebSocketServer()
    server: Server;

    constructor(
        @Inject(forwardRef(() => NetworkService))
        private readonly networkService: NetworkService,
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
        @Optional()
        @InjectRepository(UserEntity)
        private readonly userRepo?: Repository<UserEntity>,
        @Optional()
        @InjectRepository(SessionEntity)
        private readonly sessionRepo?: Repository<SessionEntity>,
        @Optional()
        @Inject(CACHE_MANAGER)
        private readonly cacheManager?: Cache,
        @Optional()
        private readonly planPermissionService?: PlanPermissionService,
        @Optional()
        private readonly redisSecurity?: RedisSecurityService,
    ) {}

    private async verifyUserIdFromToken(rawToken?: string): Promise<string | null> {
        if (!rawToken) return null;
        const cleanToken = String(rawToken).replace(/^Bearer\s+/i, '').trim();
        if (!cleanToken) return null;

        try {
            const payload = await this.jwtService.verifyAsync(cleanToken, {
                secret: getJwtSecret(this.configService),
            });
            const userId = payload?.id || payload?.sub;
            if (!userId || payload?.isTwoFactorPending) {
                return null;
            }

            // Ensure session is still active (not logged out / revoked)
            let sessionActive = false;
            if (this.cacheManager) {
                const cached = await this.cacheManager.get(buildSessionCacheKey(cleanToken)).catch(() => null);
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
            if (!sessionActive) return null;

            // Enforce blocked status & 2FA verification
            if (this.userRepo) {
                const user = await this.userRepo.findOne({
                    where: { id: userId },
                    select: ['id', 'isBlocked', 'twoFactorEnabled', 'isTwoFactorConfirmed'],
                });
                if (!user || user.isBlocked) return null;
                if (user.twoFactorEnabled && user.isTwoFactorConfirmed && !payload.isTwoFactorVerified) {
                    return null;
                }
            }

            if (this.planPermissionService) {
                const tier = await this.planPermissionService.getUserPlan(userId);
                if (tier === PlanTier.FREE) {
                    return null;
                }
            }

            return userId;
        } catch {
            return null;
        }
    }

    @OnEvent('security.revoke_user')
    handleUserSessionRevoked(event: { userId?: string; reason?: string }) {
        const targetUserId = event?.userId;
        if (!targetUserId || !this.server) return;
        try {
            this.server.to(`user_room:${targetUserId}`).emit('session_revoked', {
                reason: event.reason || 'revoked',
            });
            this.server.in(`user_room:${targetUserId}`).disconnectSockets(true);
        } catch {
            // ignore if sockets already closed
        }
        this.onlineUserSockets.delete(targetUserId);
    }

    async handleConnection(client: Socket) {
        try {
            const rawToken = extractSocketTokenFromHandshake(client.handshake);
            const userId = await this.verifyUserIdFromToken(rawToken || undefined);
            if (!userId) {
                client.disconnect(true);
                return;
            }

            client.data.userId = userId;
            client.join(`user_room:${userId}`);
            this.trackOnlineSocket(userId, client.id);
        } catch {
            client.disconnect(true);
        }
    }

    handleDisconnect(client: Socket) {
        const userId = client?.data?.userId;
        if (userId) {
            this.untrackOnlineSocket(userId, client.id);
        }
    }

    private trackOnlineSocket(userId: string, socketId: string) {
        const MAX_ONLINE_USERS = 5000;
        let sockets = this.onlineUserSockets.get(userId);
        if (!sockets) {
            while (this.onlineUserSockets.size >= MAX_ONLINE_USERS) {
                const oldestKey = this.onlineUserSockets.keys().next().value;
                if (oldestKey === undefined) break;
                this.onlineUserSockets.delete(oldestKey);
            }
            sockets = new Set<string>();
            this.onlineUserSockets.set(userId, sockets);
        }
        sockets.add(socketId);
    }

    private untrackOnlineSocket(userId: string, socketId: string) {
        const sockets = this.onlineUserSockets.get(userId);
        if (!sockets) return;
        sockets.delete(socketId);
        if (sockets.size === 0) {
            this.onlineUserSockets.delete(userId);
        }
    }

    getOnlineUserIds(excludeUserId?: string): string[] {
        const ids: string[] = [];
        for (const [uid, sockets] of this.onlineUserSockets.entries()) {
            if (sockets.size > 0 && uid !== excludeUserId) {
                ids.push(uid);
            }
        }
        return ids;
    }

    @OnEvent('notification.created')
    handleNotificationCreated(payload: { userId: string; notification: any }) {
        if (payload && payload.userId && payload.notification) {
            this.server
                .to(`user_room:${payload.userId}`)
                .emit('notification', payload.notification);
        }
    }

    private async authorizeSocketAction(
        client: Socket,
        tokenOverride?: string,
    ): Promise<string | null> {
        const tokenToCheck = tokenOverride || client.data?.token;
        const userId = await this.verifyUserIdFromToken(tokenToCheck);
        if (!userId) {
            client.disconnect(true);
            return null;
        }
        client.data.userId = userId;

        if (this.planPermissionService) {
            const hasPro = await this.planPermissionService
                .checkPermission(userId, PlanTier.PRO)
                .catch(() => false);
            if (!hasPro) {
                client.emit('error', {
                    code: 'PLAN_REQUIRED',
                    message: 'Funcionalidade restrita ao plano PRO ou superior.',
                });
                return null;
            }
        }

        if (this.redisSecurity) {
            const rl = await this.redisSecurity
                .incrementWithWindow(`net_ws_rl:${userId}`, 60)
                .catch(() => ({ count: 1 }));
            if (rl.count > 20) {
                client.emit('error', {
                    code: 'RATE_LIMITED',
                    message: 'Limite de mensagens por minuto atingido. Aguarde alguns segundos.',
                });
                return null;
            }
        }

        return userId;
    }

    @SubscribeMessage('msgToServer')
    async handleMessage(
        @MessageBody()
        payload: { content: string; token?: string; room?: string },
        @ConnectedSocket() client: Socket,
    ) {
        try {
            const userId = await this.authorizeSocketAction(client, payload?.token);
            if (!userId || !payload?.content?.trim()) return;

            const safeRoom = String(payload.room || 'global')
                .trim()
                .slice(0, 50);

            const message = await this.networkService.saveChatMessage(
                userId,
                payload.content.trim().slice(0, 4000),
                safeRoom,
            );

            this.server.emit('msgToClient', message);
        } catch (e: any) {
            this.logger.warn(`Error handling channel message: ${e?.message || e}`);
        }
    }

    @SubscribeMessage('dmToServer')
    async handleDirectMessage(
        @MessageBody()
        payload: { recipientId: string; content: string; token?: string },
        @ConnectedSocket() client: Socket,
    ) {
        try {
            const senderId = await this.authorizeSocketAction(client, payload?.token);
            if (
                !senderId ||
                !payload?.recipientId ||
                !payload?.content?.trim()
            ) {
                return;
            }

            await this.networkService.sendDirectMessage(
                senderId,
                payload.recipientId,
                payload.content.trim().slice(0, 4000),
            );
        } catch (e: any) {
            this.logger.warn(`Error handling direct message: ${e?.message || e}`);
        }
    }

    broadcastDirectMessage(senderId: string, recipientId: string, message: any) {
        this.server.to(`user_room:${recipientId}`).emit('dmToClient', message);
        if (senderId !== recipientId) {
            this.server.to(`user_room:${senderId}`).emit('dmToClient', message);
        }
    }

    broadcastNewPost(post: any) {
        this.server.emit('newPost', post);
    }

    broadcastInteraction(data: any) {
        this.server.emit('interaction', data);
    }

    broadcastLessonInteraction(data: any) {
        this.server.emit('lessonInteraction', data);
    }

    broadcastLessonCatalogUpdated() {
        this.server.emit('lessonCatalogUpdated', { timestamp: Date.now() });
    }
}
