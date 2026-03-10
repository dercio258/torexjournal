
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationEntity, NotificationType } from './notification.entity';
import { AccountEntity } from '../account/account.entity';
import { UserEntity } from '../users/user.entity';
import { TelegramService } from './telegram.service';
import { EmailService } from './email.service';

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
        private emailService: EmailService,
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

        if (user) {
            // Check preferences (Assuming true if undefined for these major alerts)
            const prefs = user.notificationPreferences || {};
            const isAlertEnabled = prefs[saved.type] !== false;

            if (isAlertEnabled) {
                // Telegram Dispatch
                if (user.telegramChatId) {
                    await this.telegramService.sendNotification(userId, `[${saved.type}] ${saved.title}\n${saved.message}`);
                }

                // Email Dispatch
                if (user.email) {
                    await this.emailService.sendEmail(
                        user.email,
                        `Torex Notice: ${saved.title}`,
                        saved.message,
                        `<div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f4f5; color: #18181b;">
                            <h2 style="color: #10b981;">Torex Journal</h2>
                            <h3>${saved.title}</h3>
                            <p style="font-size: 16px;">${saved.message}</p>
                            <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 20px 0;" />
                            <p style="font-size: 12px; color: #71717a;">Log in to your dashboard to review this alert.</p>
                        </div>`
                    );
                }
            }
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

    async remove(id: string, userId: string) {
        const account = await this.getAccount(userId);
        const notification = await this.notificationRepo.findOne({ where: { id, accountId: account.id } });

        if (!notification) throw new NotFoundException('Notification not found');

        return this.notificationRepo.remove(notification);
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
