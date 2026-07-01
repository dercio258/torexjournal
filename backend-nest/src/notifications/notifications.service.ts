
import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationEntity, NotificationType } from './notification.entity';
import { AccountEntity } from '../account/account.entity';
import { UserEntity } from '../users/user.entity';
import { TelegramService } from './telegram.service';
import { EmailService } from '../email/email.service';
import { WhatsAppLink } from '../users/whatsapp-link.entity';
import { WhatsAppVerificationCode } from '../users/whatsapp-verification-code.entity';
import { MoreThan } from 'typeorm';
import { randomInt } from 'crypto';
import { BaileysService } from './baileys.service';
import { WhatsAppTemplates } from './whatsapp-templates';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class NotificationsService {
    private readonly logger = new Logger(NotificationsService.name);

    constructor(
        @InjectRepository(NotificationEntity)
        private notificationRepo: Repository<NotificationEntity>,
        @InjectRepository(AccountEntity)
        private accountRepo: Repository<AccountEntity>,
        @InjectRepository(UserEntity)
        private userRepo: Repository<UserEntity>,
        @InjectRepository(WhatsAppLink)
        private readonly linkRepo: Repository<WhatsAppLink>,
        @InjectRepository(WhatsAppVerificationCode)
        private readonly codeRepo: Repository<WhatsAppVerificationCode>,
        private telegramService: TelegramService,
        private emailService: EmailService,
        private baileysService: BaileysService,
        private readonly eventEmitter: EventEmitter2,
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
            type: data.type || NotificationType.SYSTEM
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
                    await this.emailService.sendTemplatedEmail(user.email, 'SYSTEM_ALERT', {
                        title: saved.title,
                        message: saved.message,
                        type: saved.type,
                    });
                }
            }

            // WhatsApp Dispatch
            this.logger.log(`Checking WhatsApp link for user ${userId}`);
            const waLink = await this.linkRepo.findOne({
                where: { user: { id: userId }, isActive: true }
            });

            if (waLink) {
                this.logger.log(`Found active WA link for ${userId}: ${waLink.whatsappNumber}. Dispatching...`);
                const waMessage = WhatsAppTemplates.SYSTEM_ALERT({
                    title: saved.title,
                    message: saved.message,
                    type: saved.type
                });
                const success = await this.baileysService.sendMessage(waLink.whatsappNumber, waMessage);
                if (success) {
                    this.logger.log(`WhatsApp notification sent to ${waLink.whatsappNumber}`);
                } else {
                    this.logger.warn(`Failed to send WhatsApp notification to ${waLink.whatsappNumber}`);
                }
            }
        }

        // Emit local event to propagate to WebSockets (PWA notifications)
        this.eventEmitter.emit('notification.created', { userId, notification: saved });

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

    async getWhatsAppStatus(userId: string) {
        const link = await this.linkRepo.findOne({
            where: { user: { id: userId } }
        });

        return {
            connected: !!link?.isActive,
            whatsappNumber: link?.whatsappNumber || null,
            lastInteraction: link?.lastInteractionAt || null
        };
    }

    async generateWhatsAppCode(userId: string) {
        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        // Deactivate old codes
        await this.codeRepo.update({ user: { id: userId }, used: false }, { used: true });

        const code = randomInt(100000, 999999).toString();
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 10); // 10 minutes expiry

        const verification = this.codeRepo.create({
            user,
            code,
            expiresAt,
            used: false
        });

        await this.codeRepo.save(verification);

        return { code, expiresAt };
    }

    async send2FA(userId: string, code: string) {
        const waLink = await this.linkRepo.findOne({
            where: { user: { id: userId }, isActive: true }
        });

        if (waLink) {
            const message = WhatsAppTemplates.AUTH_2FA({ code });
            return this.baileysService.sendMessage(waLink.whatsappNumber, message);
        }
        return false;
    }

    private async getAccount(userId: string) {
        const account = await this.accountRepo.findOne({ where: { userId } });
        if (!account) throw new NotFoundException('Account not found');
        return account;
    }
}
