import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NetworkController } from './network.controller';
import { NetworkService } from './network.service';
import { NetworkAcademyService } from './video-lesson.service';
import { NetworkGateway } from './network.gateway';
import { Post } from './post.entity';
import { Comment } from './comment.entity';
import { Like } from './like.entity';
import { ChatMessage } from './chat-message.entity';
import { Follow } from './follow.entity';
import { ChatRoom, ChatMember } from './chat-entities';
import {
    NetworkDirectMessageEntity,
    NetworkLessonCommentEntity,
    NetworkLessonLikeEntity,
    NetworkLessonProgressEntity,
    NetworkVideoLessonEntity,
} from './video-lesson.entity';
import { UserEntity } from '../users/user.entity';
import { SessionEntity } from '../auth/session.entity';
import { PaymentModule } from '../payment/payment.module';
import { getJwtSecret } from '../common/security/security.config';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            Post,
            Comment,
            Like,
            ChatMessage,
            Follow,
            ChatRoom,
            ChatMember,
            NetworkVideoLessonEntity,
            NetworkLessonProgressEntity,
            NetworkLessonLikeEntity,
            NetworkLessonCommentEntity,
            NetworkDirectMessageEntity,
            UserEntity,
            SessionEntity,
        ]),
        PaymentModule,
        JwtModule.registerAsync({
            imports: [ConfigModule],
            useFactory: async (configService: ConfigService) => ({
                secret: getJwtSecret(configService),
                signOptions: { expiresIn: '1d' },
            }),
            inject: [ConfigService],
        }),
    ],
    controllers: [NetworkController],
    providers: [NetworkService, NetworkAcademyService, NetworkGateway],
    exports: [NetworkService, NetworkAcademyService],
})
export class NetworkModule {}
