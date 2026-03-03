import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NetworkController } from './network.controller';
import { NetworkService } from './network.service';
import { NetworkGateway } from './network.gateway';
import { Post } from './post.entity';
import { Comment } from './comment.entity';
import { Like } from './like.entity';
import { ChatMessage } from './chat-message.entity';
import { Follow } from './follow.entity';
import { ChatRoom, ChatMember } from './chat-entities';
import { UserEntity } from '../users/user.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([Post, Comment, Like, ChatMessage, Follow, ChatRoom, ChatMember, UserEntity]),
        JwtModule.registerAsync({
            imports: [ConfigModule],
            useFactory: async (configService: ConfigService) => ({
                secret: configService.get<string>('JWT_SECRET'),
                signOptions: { expiresIn: '1d' },
            }),
            inject: [ConfigService],
        }),
    ],
    controllers: [NetworkController],
    providers: [NetworkService, NetworkGateway],
    exports: [NetworkService]
})
export class NetworkModule { }
