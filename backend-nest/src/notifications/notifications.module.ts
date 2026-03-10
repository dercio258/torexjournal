
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationEntity } from './notification.entity';
import { AccountEntity } from '../account/account.entity';
import { TelegrafModule } from 'nestjs-telegraf';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import { NotificationsCronService } from './notifications.cron';
import { TradeEntity } from '../mt5/trade.entity';
import { TechnicalJournal } from '../dashboard/technical-journal.entity';
import { UserEntity } from '../users/user.entity';
import { TelegramService } from './telegram.service';
import { AlertsModule } from '../alerts/alerts.module';
import { Subscription } from '../payment/subscription.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([NotificationEntity, AccountEntity, UserEntity, TradeEntity, TechnicalJournal, Subscription]),
        AlertsModule,
        TelegrafModule.forRootAsync({
            imports: [ConfigModule],
            useFactory: (configService: ConfigService) => ({
                token: configService.get<string>('TELEGRAM_BOT_TOKEN') || 'NO_TOKEN_PROVIDED',
                launchOptions: false,
            }),
            inject: [ConfigService],
        }),
    ],
    controllers: [NotificationsController],
    providers: [NotificationsService, TelegramService, EmailService, NotificationsCronService],
    exports: [NotificationsService, TelegramService, EmailService]
})
export class NotificationsModule { }
