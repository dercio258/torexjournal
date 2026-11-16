import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationEntity, NotificationType } from './notification.entity';
import { AccountEntity } from '../account/account.entity';
import { UserEntity } from '../users/user.entity';
import { TelegramService } from './telegram.service';
import { EmailProducerService } from '../email/email-producer.service';
import { WhatsAppLink } from '../users/whatsapp-link.entity';
import { WhatsAppVerificationCode } from '../users/whatsapp-verification-code.entity';
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
        private emailProducer: EmailProducerService,
        private baileysService: BaileysService,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    async findAll(
        userId: string,
        options?: { page?: number; limit?: number; paginated?: boolean },
    ) {
        const account = await this.getAccount(userId);
        const page = Math.max(1, Number(options?.page) || 1);
        const limit = Math.min(200, Math.max(1, Number(options?.limit) || 50));

        if (options?.paginated) {
            const [items, total] = await this.notificationRepo.findAndCount({
                where: { accountId: account.id },
                order: { createdAt: 'DESC' },
                skip: (page - 1) * limit,
                take: limit,
            });
            return {
                items,
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            };
        }

        return this.notificationRepo.find({
            where: { accountId: account.id },
            order: { createdAt: 'DESC' },
            skip: (page - 1) * limit,
            take: limit,
        });
    }

    async markAllAsRead(userId: string) {
        const account = await this.getAccount(userId);
        const res = await this.notificationRepo
            .createQueryBuilder()
            .update(NotificationEntity)
            .set({ isRead: true })
            .where('account_id = :accountId AND "isRead" = false', { accountId: account.id })
            .execute();
        return { success: true, updated: res.affected || 0 };
    }

    async create(
        userId: string,
        data: {
            title: string;
            message: string;
            type?: NotificationType;
            actionUrl?: string;
            actionLabel?: string;
        },
        options: { skipEmail?: boolean; skipExternal?: boolean } = {},
    ) {
        const account = await this.getAccount(userId);

        const notification = this.notificationRepo.create({
            accountId: account.id,
            title: data.title,
            message: data.message,
            type: data.type || NotificationType.SYSTEM,
        });

        const saved = await this.notificationRepo.save(notification);

        if (!options.skipExternal) {
            const user = await this.userRepo.findOne({ where: { id: userId } });

            if (user) {
                const prefs = user.notificationPreferences || {};
                const isAlertEnabled =
                    prefs[saved.type] !== false && account.notificationsEnabled !== false;

                if (isAlertEnabled) {
                    // Telegram Dispatch
                    if (user.telegramChatId) {
                        await this.telegramService
                            .sendNotification(
                                userId,
                                `[${saved.type}] ${saved.title}\n${saved.message}`,
                            )
                            .catch((err) =>
                                this.logger.warn(
                                    `Telegram dispatch failed for ${userId}: ${err?.message || err}`,
                                ),
                            );
                    }

                    // Redis Queue Email Dispatch (100% non-blocking)
                    if (user.email && !options.skipEmail) {
                        await this.emailProducer.enqueue(
                            user.email,
                            'SYSTEM_ALERT',
                            {
                                userName: user.name || undefined,
                                title: saved.title,
                                message: saved.message,
                                type: saved.type,
                                actionUrl: data.actionUrl,
                                actionLabel: data.actionLabel,
                            },
                            { jobId: `notif-alert:${saved.id}` },
                        );
                    }

                    // WhatsApp Dispatch
                    const waLink = await this.linkRepo.findOne({
                        where: { user: { id: userId }, isActive: true },
                    });

                    if (waLink) {
                        const waMessage = WhatsAppTemplates.SYSTEM_ALERT({
                            title: saved.title,
                            message: saved.message,
                            type: saved.type,
                        });
                        await this.baileysService
                            .sendMessage(waLink.whatsappNumber, waMessage)
                            .catch((err) =>
                                this.logger.warn(
                                    `WhatsApp dispatch failed for ${waLink.whatsappNumber}: ${err?.message || err}`,
                                ),
                            );
                    }
                }
            }
        }

        // Emit local event to propagate to WebSockets (PWA notifications)
        this.eventEmitter.emit('notification.created', { userId, notification: saved });

        return saved;
    }

    async markAsRead(id: string, userId: string) {
        const account = await this.getAccount(userId);
        const notification = await this.notificationRepo.findOne({
            where: { id, accountId: account.id },
        });

        if (!notification) throw new NotFoundException('Notification not found');

        notification.isRead = true;
        return this.notificationRepo.save(notification);
    }

    async remove(id: string, userId: string) {
        const account = await this.getAccount(userId);
        const notification = await this.notificationRepo.findOne({
            where: { id, accountId: account.id },
        });

        if (!notification) throw new NotFoundException('Notification not found');

        return this.notificationRepo.remove(notification);
    }

    async updateSettings(
        userId: string,
        settings: {
            telegramChatId?: string;
            notificationsEnabled?: boolean;
            telegramEnabled?: boolean;
            notificationPreferences?: any;
        },
    ) {
        const account = await this.getAccount(userId);
        const user = await this.userRepo.findOne({ where: { id: userId } });

        if (settings.notificationsEnabled !== undefined) {
            account.notificationsEnabled = settings.notificationsEnabled;
        }

        await this.accountRepo.save(account);

        if (user) {
            if (settings.notificationPreferences) {
                user.notificationPreferences = {
                    ...user.notificationPreferences,
                    ...settings.notificationPreferences,
                };
            }
            await this.userRepo.save(user);
        }

        return {
            success: true,
            notificationsEnabled: account.notificationsEnabled,
            notificationPreferences: user?.notificationPreferences || {},
        };
    }

    async getWhatsAppStatus(userId: string) {
        const link = await this.linkRepo.findOne({
            where: { user: { id: userId } },
        });

        return {
            connected: !!link?.isActive,
            whatsappNumber: link?.whatsappNumber || null,
            lastInteraction: link?.lastInteractionAt || null,
        };
    }

    async generateWhatsAppCode(userId: string) {
        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        await this.codeRepo.update({ user: { id: userId }, used: false }, { used: true });

        const code = randomInt(100000, 999999).toString();
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 10);

        const verification = this.codeRepo.create({
            user,
            code,
            expiresAt,
            used: false,
        });

        await this.codeRepo.save(verification);

        return { code, expiresAt };
    }

    async send2FA(userId: string, code: string) {
        const waLink = await this.linkRepo.findOne({
            where: { user: { id: userId }, isActive: true },
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
