import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationEntity } from './notification.entity';
import { AccountEntity } from '../account/account.entity';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationsCronService } from './notifications.cron';
import { TradeEntity } from '../mt5/trade.entity';
import { TechnicalJournal } from '../dashboard/technical-journal.entity';
import { UserEntity } from '../users/user.entity';
import { AlertsModule } from '../alerts/alerts.module';
import { Subscription } from '../payment/subscription.entity';
import { BullModule } from '@nestjs/bull';
import { BroadcastNotificationEntity } from './broadcast-notification.entity';
import { BroadcastingService } from './broadcast.service';
import { EmailModule } from '../email/email.module';
import { JwtModule } from '@nestjs/jwt';
import { getJwtSecret } from '../common/security/security.config';
import { PushSubscriptionEntity } from './push/push-subscription.entity';
import { PushDeliveryLogEntity } from './push/push-delivery-log.entity';
import { PushCopyAiService } from './push/push-copy-ai.service';
import { PushProducerService } from './push/push-producer.service';
import { PushProcessor } from './push/push.processor';
import { PushNotificationsController } from './push/push-notifications.controller';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            NotificationEntity,
            BroadcastNotificationEntity,
            PushSubscriptionEntity,
            PushDeliveryLogEntity,
            AccountEntity,
            UserEntity,
            TradeEntity,
            TechnicalJournal,
            Subscription,
        ]),
        JwtModule.registerAsync({
            imports: [ConfigModule],
            useFactory: (configService: ConfigService) => ({
                secret: getJwtSecret(configService),
                signOptions: { expiresIn: '24h' },
            }),
            inject: [ConfigService],
        }),
        AlertsModule,
        EmailModule,
        BullModule.registerQueue({
            name: 'push-queue',
            defaultJobOptions: {
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 },
                removeOnComplete: 200,
                removeOnFail: 200,
            },
        }),
    ],
    controllers: [NotificationsController, PushNotificationsController],
    providers: [
        NotificationsService,
        BroadcastingService,
        PushCopyAiService,
        PushProducerService,
        ...(process.env.MT5_DEDICATED_SERVER === 'true'
            ? []
            : [NotificationsCronService, PushProcessor]),
    ],
    exports: [
        NotificationsService,
        BroadcastingService,
        PushProducerService,
    ],
})
export class NotificationsModule { }
