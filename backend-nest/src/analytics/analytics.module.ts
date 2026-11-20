import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TrackingEventEntity } from './entities/tracking-event.entity';
import { EmailTrackingLogEntity } from './entities/email-tracking-log.entity';
import { TrackingConfigEntity } from './entities/tracking-config.entity';
import { UserEntity } from '../users/user.entity';
import { ReferralEntity } from '../users/referral.entity';
import { PushSubscriptionEntity } from '../notifications/push/push-subscription.entity';
import { PushDeliveryLogEntity } from '../notifications/push/push-delivery-log.entity';
import { getJwtSecret } from '../common/security/security.config';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { AdminAnalyticsController } from './admin-analytics.controller';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            TrackingEventEntity,
            EmailTrackingLogEntity,
            TrackingConfigEntity,
            UserEntity,
            ReferralEntity,
            PushSubscriptionEntity,
            PushDeliveryLogEntity,
        ]),
        ConfigModule,
        JwtModule.registerAsync({
            imports: [ConfigModule],
            useFactory: async (configService: ConfigService) => ({
                secret: getJwtSecret(configService),
                signOptions: { expiresIn: '24h' },
            }),
            inject: [ConfigService],
        }),
    ],
    controllers: [AnalyticsController, AdminAnalyticsController],
    providers: [AnalyticsService],
    exports: [AnalyticsService],
})
export class AnalyticsModule {}
