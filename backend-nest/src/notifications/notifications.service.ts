
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationEntity, NotificationType } from './notification.entity';
import { AccountEntity } from '../account/account.entity';
import { UserEntity } from '../users/user.entity';
import { TelegramService } from './telegram.service';

@Injectable()
export class NotificationsService {
    constructor(
        @InjectRepository(NotificationEntity)
        private notificationRepo: Repository<NotificationEntity>,
        @InjectRepository(AccountEntity)
        private accountRepo: Repository<AccountEntity>,
        @InjectRepository(UserEntity)
        private userRepo: Repository<UserEntity>,
        private telegramService: TelegramService,
    ) { }

    async findAll(userId: string) {
        const account = await this.getAccount(userId);
        return this.notificationRepo.find({
            where: { accountId: account.id },
            order: { createdAt: 'DESC' },
            take: 50
        });
    }

    async create(userId: string, data: { title: string; message: string; type?: NotificationType }) {
        const account = await this.getAccount(userId);

        const notification = this.notificationRepo.create({
            accountId: account.id,
            title: data.title,
            message: data.message,
            type: data.type || NotificationType.INFO
        });

        const saved = await this.notificationRepo.save(notification);

        // Send to Telegram if user has it enabled and linked
        const user = await this.userRepo.findOne({ where: { id: userId } });
        // Check if user exists and has telegramChatId, and if a hypothetical global 'telegramEnabled' pref exists
        // For now, checks if telegramChatId is present.
        // We can also check notificationPreferences if implemented.
        if (user && user.telegramChatId) {
            await this.telegramService.sendNotification(userId, `[${saved.type}] ${saved.title}\n${saved.message}`);
        }

        return saved;
    }

    async markAsRead(id: string, userId: string) {
        const account = await this.getAccount(userId);
        const notification = await this.notificationRepo.findOne({ where: { id, accountId: account.id } });

        if (!notification) throw new NotFoundException('Notification not found');

        notification.isRead = true;
        return this.notificationRepo.save(notification);
    }

    async updateSettings(userId: string, settings: { telegramChatId?: string; notificationsEnabled?: boolean; telegramEnabled?: boolean; notificationPreferences?: any }) {
        const account = await this.getAccount(userId);
        const user = await this.userRepo.findOne({ where: { id: userId } });

        if (settings.notificationsEnabled !== undefined) account.notificationsEnabled = settings.notificationsEnabled;
        // if (settings.telegramEnabled !== undefined) account.telegramEnabled = settings.telegramEnabled; // Deprecated on account

        await this.accountRepo.save(account);

        if (user) {
            if (settings.notificationPreferences) {
                user.notificationPreferences = {
                    ...user.notificationPreferences,
                    ...settings.notificationPreferences
                };
            }
            await this.userRepo.save(user);
        }

        return { account, user };
    }

    private async getAccount(userId: string) {
        const account = await this.accountRepo.findOne({ where: { userId } });
        if (!account) throw new NotFoundException('Account not found');
        return account;
    }

    // Private sendToTelegram removed in favor of TelegramService
}
