import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationEntity, NotificationType } from './notification.entity';
import { AccountEntity } from '../account/account.entity';
import { UserEntity } from '../users/user.entity';
import { EmailProducerService } from '../email/email-producer.service';
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
        private emailProducer: EmailProducerService,
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
            metadata?: Record<string, any> | null;
        },
        options: { skipEmail?: boolean; skipExternal?: boolean } = {},
    ) {
        const account = await this.getAccount(userId);

        const notification = this.notificationRepo.create({
            accountId: account.id,
            title: data.title,
            message: data.message,
            type: data.type || NotificationType.SYSTEM,
            metadata: data.metadata ?? null,
        });

        const saved = await this.notificationRepo.save(notification);

        if (!options.skipExternal) {
            const user = await this.userRepo.findOne({ where: { id: userId } });

            if (user) {
                const prefs = user.notificationPreferences || {};
                const isAlertEnabled =
                    prefs[saved.type] !== false && account.notificationsEnabled !== false;

                if (isAlertEnabled) {
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
            notificationsEnabled?: boolean;
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

    private async getAccount(userId: string) {
        const account = await this.accountRepo.findOne({ where: { userId } });
        if (!account) throw new NotFoundException('Account not found');
        return account;
    }
}
