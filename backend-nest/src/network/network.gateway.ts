import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
    MessageBody,
    ConnectedSocket
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, UseGuards, Inject, forwardRef } from '@nestjs/common';
import { NetworkService } from './network.service';
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';

@WebSocketGateway({
    cors: {
        origin: '*',
    },
    namespace: 'network'
})
@Injectable()
export class NetworkGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    constructor(
        @Inject(forwardRef(() => NetworkService))
        private readonly networkService: NetworkService,
        private readonly jwtService: JwtService
    ) { }

    async handleConnection(client: Socket) {
        try {
            const token = client.handshake.auth.token || client.handshake.headers.authorization;
            if (!token) {
                client.disconnect();
                return;
            }
            
            const decoded = this.jwtService.decode(token) as any;
            if (decoded) {
                const userId = decoded.sub || decoded.id;
                if (userId) {
                    client.data.userId = userId;
                    client.join(`user_room:${userId}`);
                    console.log(`Client ${client.id} joined room user_room:${userId}`);
                }
            }
            console.log(`Client connected to Network: ${client.id}`);
        } catch (e) {
            client.disconnect();
        }
    }

    handleDisconnect(client: Socket) {
        console.log(`Client disconnected from Network: ${client.id}`);
    }

    @OnEvent('notification.created')
    handleNotificationCreated(payload: { userId: string; notification: any }) {
        if (payload && payload.userId && payload.notification) {
            // Emite de forma segura para a sala do usuário
            this.server.to(`user_room:${payload.userId}`).emit('notification', payload.notification);
        }
    }

    @SubscribeMessage('msgToServer')
    async handleMessage(
        @MessageBody() payload: { content: string, token: string },
        @ConnectedSocket() client: Socket
    ) {
        try {
            const decoded = this.jwtService.decode(payload.token) as any;
            if (!decoded || !decoded.sub) return;

            const userId = decoded.sub;

            // Save to DB
            const message = await this.networkService.saveChatMessage(userId, payload.content);

            // Broadcast to all
            this.server.emit('msgToClient', message);
        } catch (e) {
            console.error('Error handling message', e);
        }
    }

    broadcastNewPost(post: any) {
        this.server.emit('newPost', post);
    }

    broadcastInteraction(data: any) {
        this.server.emit('interaction', data);
    }
}
