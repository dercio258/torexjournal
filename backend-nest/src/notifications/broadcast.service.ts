import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BroadcastNotificationEntity, BroadcastStatus, BroadcastCategory, RecurrenceInterval } from './broadcast-notification.entity';
import { UserEntity } from '../users/user.entity';
import { Subscription, SubscriptionStatus } from '../payment/subscription.entity';
import { EmailProducerService } from '../email/email-producer.service';
import { RedisSecurityService } from '../common/security/redis-security.service';
import { PushSubscriptionEntity } from './push/push-subscription.entity';
import { PushProducerService } from './push/push-producer.service';
import { NotificationsService } from './notifications.service';
import { NotificationType } from './notification.entity';

@Injectable()
export class BroadcastingService {
    private readonly logger = new Logger(BroadcastingService.name);

    constructor(
        @InjectRepository(BroadcastNotificationEntity)
        private broadcastRepo: Repository<BroadcastNotificationEntity>,
        @InjectRepository(UserEntity)
        private userRepo: Repository<UserEntity>,
        @InjectRepository(Subscription)
        private subscriptionRepo: Repository<Subscription>,
        private emailProducer: EmailProducerService,
        private redisSecurity: RedisSecurityService,
        @Optional()
        @InjectRepository(PushSubscriptionEntity)
        private pushSubRepo?: Repository<PushSubscriptionEntity>,
        @Optional()
        private pushProducer?: PushProducerService,
        @Optional()
        private notificationsService?: NotificationsService,
    ) { }

    async createBroadcast(data: any) {
        const { saveAsDraft, ...payload } = data || {};
        const hasSchedule = Boolean(payload.scheduledAt);
        const channels = Array.isArray(payload.channels) && payload.channels.length > 0 ? payload.channels : ['email'];

        const broadcast = this.broadcastRepo.create({
            ...payload,
            channels,
            status: hasSchedule ? BroadcastStatus.SCHEDULED : BroadcastStatus.DRAFT,
            nextRunAt: hasSchedule ? new Date(payload.scheduledAt) : null,
        });

        const saved = await this.broadcastRepo.save(broadcast) as unknown as BroadcastNotificationEntity;

        if (!hasSchedule && !saveAsDraft) {
            const execResult = await this.executeBroadcast(saved.id);
            const refreshed = await this.broadcastRepo.findOne({ where: { id: saved.id } });
            return {
                ...(refreshed || saved),
                execution: execResult,
            };
        }

        return saved;
    }

    async findAll() {
        return this.broadcastRepo.find({ order: { createdAt: 'DESC' } });
    }

    async deleteBroadcast(id: string) {
        const res = await this.broadcastRepo.delete(id);
        if (!res.affected) {
            throw new NotFoundException(`Comunicado com ID ${id} não encontrado`);
        }
        return { success: true, id };
    }

    async getAudienceBreakdown() {
        const [allUsers, activeSubs, activePushUserIds] = await Promise.all([
            this.userRepo.find({ select: ['id', 'email'] }),
            this.subscriptionRepo.find({
                where: { status: SubscriptionStatus.ACTIVE },
                relations: ['planConfig'],
            }),
            this.pushSubRepo
                ? this.pushSubRepo
                      .createQueryBuilder('ps')
                      .select('DISTINCT ps.userId', 'userId')
                      .where('ps.isActive = true')
                      .getRawMany()
                      .then((rows) => rows.map((r) => r.userId).filter(Boolean))
                : Promise.resolve([]),
        ]);

        const activeUserIds = new Set<string>();
        const basicUserIds = new Set<string>();
        const premiumUserIds = new Set<string>();

        for (const sub of activeSubs) {
            if (!sub.userId) continue;
            activeUserIds.add(sub.userId);
            const tier = (sub.planConfig?.tier || '').toLowerCase();
            if (tier === 'basic') basicUserIds.add(sub.userId);
            else if (tier === 'premium' || tier === 'pro' || tier === 'vip') premiumUserIds.add(sub.userId);
        }

        const withEmail = allUsers.filter((u) => Boolean(u.email)).length;
        const withPush = activePushUserIds.length;
        const freeCount = allUsers.filter((u) => !activeUserIds.has(u.id)).length;

        return {
            totalUsers: allUsers.length,
            byCategory: {
                [BroadcastCategory.ALL]: allUsers.length,
                [BroadcastCategory.FREE]: freeCount,
                [BroadcastCategory.BASIC]: basicUserIds.size,
                [BroadcastCategory.PREMIUM]: premiumUserIds.size,
            },
            byChannel: {
                email: withEmail,
                push: withPush,
                in_app: allUsers.length,
            },
        };
    }

    async executeBroadcast(broadcastId: string) {
        const locked = await this.redisSecurity.withLock(
            `broadcast:exec:${broadcastId}`,
            15 * 60 * 1000,
            async () => {
                const broadcast = await this.broadcastRepo.findOne({ where: { id: broadcastId } });
                if (!broadcast) {
                    throw new NotFoundException(`Comunicado ${broadcastId} não encontrado`);
                }
                if (broadcast.status === BroadcastStatus.SENT && !broadcast.isRecurring) {
                    return { success: false, alreadySent: true, broadcastId };
                }

                this.logger.log(`Executing Broadcast: ${broadcast.title} (${broadcast.category})`);

                // Advance/mark state BEFORE potentially slow external dispatches so EVERY_MINUTE cron never re-enters
                const finalStatus =
                    broadcast.isRecurring && broadcast.recurrenceInterval !== RecurrenceInterval.NONE
                        ? BroadcastStatus.SCHEDULED
                        : BroadcastStatus.SENT;
                const nextRunAt =
                    finalStatus === BroadcastStatus.SCHEDULED
                        ? this.calculateNextRun(new Date(), broadcast.recurrenceInterval)
                        : null;
                broadcast.sentAt = new Date();
                broadcast.status = finalStatus;
                broadcast.nextRunAt = nextRunAt;
                await this.broadcastRepo.save(broadcast);

                // 1. Get Target Users
                const users = await this.getTargetUsers(broadcast.category);
                this.logger.log(`Found ${users.length} target users for category ${broadcast.category}`);

                // 2. Queue Notifications via Redis bulk pipeline
                const runStamp = new Date().toISOString().slice(0, 10);
                const channels = Array.isArray(broadcast.channels) ? broadcast.channels : [];
                let emailsQueued = 0;
                let pushQueued = 0;
                let inAppCreated = 0;

                if (channels.includes('email')) {
                    const emailItems = users
                        .filter((u) => !!u.email)
                        .map((user) => ({
                            to: user.email,
                            template: 'GENERAL_NOTIFICATION' as const,
                            data: {
                                userName: user.name || undefined,
                                title: broadcast.title,
                                message: broadcast.message,
                                subtitle: 'Comunicado Institucional',
                            },
                            jobId: `broadcast:${broadcast.id}:${user.id}:${runStamp}`,
                            trackingMeta: {
                                broadcastId: broadcast.id,
                                userId: user.id,
                                utmCampaign: `broadcast_${broadcast.category.toLowerCase()}`,
                                utmMedium: 'broadcast',
                            },
                        }));

                    emailsQueued = await this.emailProducer.enqueueBulk(emailItems, { priority: 3 });
                    this.logger.log(`Queued ${emailsQueued} broadcast emails for broadcast=${broadcast.id}`);
                }

                if (channels.includes('push') && this.pushProducer) {
                    for (const user of users) {
                        const allowed = await this.pushProducer.reservePushQuota(user.id, 'broadcast');
                        if (!allowed) continue;
                        await this.pushProducer.enqueueRawPush({
                            userId: user.id,
                            title: broadcast.title,
                            body: broadcast.message,
                            url: '/notifications',
                            tag: `broadcast-${broadcast.id}`,
                        });
                        pushQueued++;
                    }
                }

                if (channels.includes('in_app') && this.notificationsService) {
                    for (const user of users) {
                        await this.notificationsService
                            .create(
                                user.id,
                                {
                                    title: broadcast.title,
                                    message: broadcast.message,
                                    type: NotificationType.SYSTEM,
                                    actionUrl: '/notifications',
                                },
                                { skipEmail: true },
                            )
                            .catch(() => {});
                        inAppCreated++;
                    }
                }

                return {
                    success: true,
                    broadcastId: broadcast.id,
                    recipients: users.length,
                    emailsQueued,
                    pushQueued,
                    inAppCreated,
                    status: broadcast.status,
                };
            },
        );

        if (!locked.acquired) {
            return { success: false, alreadyRunning: true, broadcastId };
        }
        return locked.result;
    }

    private async getTargetUsers(category: BroadcastCategory): Promise<UserEntity[]> {
        if (category === BroadcastCategory.ALL) {
            return this.userRepo.find();
        }

        // Logic to filter by subscription tier
        const subs = await this.subscriptionRepo.find({
            where: { status: SubscriptionStatus.ACTIVE },
            relations: ['user', 'planConfig']
        });

        if (category === BroadcastCategory.FREE) {
            const usersWithActiveSubIds = new Set(subs.map(s => s.userId));
            const allUsers = await this.userRepo.find();
            return allUsers.filter(u => !usersWithActiveSubIds.has(u.id));
        }

        // BASIC or PREMIUM
        const uniqueUsers = new Map<string, UserEntity>();
        for (const s of subs) {
            const tier = (s.planConfig?.tier || '').toLowerCase();
            const matches =
                tier === category.toLowerCase() ||
                (category === BroadcastCategory.PREMIUM && (tier === 'pro' || tier === 'vip'));
            if (matches && s.user) {
                uniqueUsers.set(s.user.id, s.user);
            }
        }
        return Array.from(uniqueUsers.values());
    }

    private calculateNextRun(current: Date, interval: RecurrenceInterval): Date {
        const next = new Date(current);
        if (interval === RecurrenceInterval.DAILY) next.setDate(next.getDate() + 1);
        if (interval === RecurrenceInterval.WEEKLY) next.setDate(next.getDate() + 7);
        if (interval === RecurrenceInterval.MONTHLY) next.setMonth(next.getMonth() + 1);
        return next;
    }
}
