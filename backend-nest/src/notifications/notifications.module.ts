import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationEntity } from './notification.entity';
import { AccountEntity } from '../account/account.entity';
import { TelegrafModule } from 'nestjs-telegraf';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationsCronService } from './notifications.cron';
import { TradeEntity } from '../mt5/trade.entity';
import { TechnicalJournal } from '../dashboard/technical-journal.entity';
import { UserEntity } from '../users/user.entity';
import { TelegramService } from './telegram.service';
import { AlertsModule } from '../alerts/alerts.module';
import { Subscription } from '../payment/subscription.entity';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { BaileysService } from './baileys.service';
import { WhatsAppBotService } from './whatsapp-bot.service';
import { WhatsAppBotController } from './whatsapp-bot.controller';
import { WhatsAppWorkerService } from './whatsapp-worker.service';
import { WhatsAppProducerService } from './whatsapp-producer.service';
import { WhatsAppLink } from '../users/whatsapp-link.entity';
import { WhatsAppVerificationCode } from '../users/whatsapp-verification-code.entity';
import { BroadcastNotificationEntity } from './broadcast-notification.entity';
import { BroadcastingService } from './broadcast.service';
import { SmsService } from './sms.service';
import { EmailModule } from '../email/email.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            NotificationEntity,
            BroadcastNotificationEntity,
            AccountEntity,
            UserEntity,
            TradeEntity,
            TechnicalJournal,
            Subscription,
            WhatsAppLink,
            WhatsAppVerificationCode,
        ]),
        AlertsModule,
        EmailModule,
        TelegrafModule.forRootAsync({
            imports: [ConfigModule],
            useFactory: (configService: ConfigService) => {
                const token = configService.get<string>('TELEGRAM_BOT_TOKEN');
                if (!token && process.env.NODE_ENV === 'production') {
                    throw new Error('TELEGRAM_BOT_TOKEN is missing in production!');
                }
                return {
                    token: token || 'DEV_TOKEN',
                    launchOptions: false,
                };
            },
            inject: [ConfigService],
        }),
        ClientsModule.registerAsync([
            {
                name: 'WHATSAPP_SERVICE',
                imports: [ConfigModule],
                useFactory: (configService: ConfigService) => {
                    const rmqUrl = configService.get<string>('RABBITMQ_URL') || 'amqp://rabbitmq:5672';
                    return {
                        transport: Transport.RMQ,
                        options: {
                            urls: [rmqUrl],
                            queue: 'whatsapp_notifications',
                            queueOptions: {
                                durable: false,
                            },
                        },
                    };
                },
                inject: [ConfigService],
            },
        ]),
    ],
    controllers: [NotificationsController, WhatsAppBotController],
    providers: [
        NotificationsService,
        BroadcastingService,
        TelegramService,
        NotificationsCronService,
        BaileysService,
        WhatsAppBotService,
        WhatsAppWorkerService,
        WhatsAppProducerService,
        SmsService,
    ],
    exports: [
        NotificationsService,
        BroadcastingService,
        TelegramService,
        BaileysService,
        WhatsAppProducerService,
        SmsService,
    ],
})
export class NotificationsModule { }
