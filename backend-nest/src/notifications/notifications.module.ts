
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationEntity } from './notification.entity';
import { AccountEntity } from '../account/account.entity';
import { TelegrafModule } from 'nestjs-telegraf';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegramService } from './telegram.service';
import { UserEntity } from '../users/user.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([NotificationEntity, AccountEntity, UserEntity]), // Added UserEntity
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
    providers: [NotificationsService, TelegramService],
    exports: [NotificationsService, TelegramService]
})
export class NotificationsModule { }
