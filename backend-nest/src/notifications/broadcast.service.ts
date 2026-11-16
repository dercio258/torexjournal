import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BroadcastNotificationEntity, BroadcastStatus, BroadcastCategory, RecurrenceInterval } from './broadcast-notification.entity';
import { UserEntity } from '../users/user.entity';
import { Subscription, SubscriptionStatus } from '../payment/subscription.entity';
import { EmailProducerService } from '../email/email-producer.service';
import { SmsService } from './sms.service';

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
        private smsService: SmsService,
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
        const [allUsers, activeSubs] = await Promise.all([
            this.userRepo.find({ select: ['id', 'email', 'whatsapp', 'preferredMpesa', 'preferredEmola'] }),
            this.subscriptionRepo.find({
                where: { status: SubscriptionStatus.ACTIVE },
                relations: ['planConfig'],
            }),
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
        const withPhone = allUsers.filter((u) => Boolean(u.whatsapp || u.preferredMpesa || u.preferredEmola)).length;
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
                sms: withPhone,
            },
        };
    }

    async executeBroadcast(broadcastId: string) {
        const broadcast = await this.broadcastRepo.findOne({ where: { id: broadcastId } });
        if (!broadcast) {
            throw new NotFoundException(`Comunicado ${broadcastId} não encontrado`);
        }
        if (broadcast.status === BroadcastStatus.SENT && !broadcast.isRecurring) {
            return { success: false, alreadySent: true, broadcastId };
        }

        this.logger.log(`Executing Broadcast: ${broadcast.title} (${broadcast.category})`);

        // 1. Get Target Users
        const users = await this.getTargetUsers(broadcast.category);
        this.logger.log(`Found ${users.length} target users for category ${broadcast.category}`);

        // 2. Queue Notifications via Redis bulk pipeline
        const runStamp = new Date().toISOString().slice(0, 10);
        const channels = Array.isArray(broadcast.channels) ? broadcast.channels : [];
        let emailsQueued = 0;
        let smsSent = 0;

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

        if (channels.includes('sms')) {
            for (const user of users) {
                const phone = user.whatsapp || user.preferredMpesa || user.preferredEmola;
                if (phone) {
                    await this.smsService.sendSms(user.id, phone, broadcast.message);
                    smsSent++;
                }
            }
        }

        // 3. Update Status
        broadcast.sentAt = new Date();
        
        if (broadcast.isRecurring && broadcast.recurrenceInterval !== RecurrenceInterval.NONE) {
            broadcast.nextRunAt = this.calculateNextRun(new Date(), broadcast.recurrenceInterval);
            broadcast.status = BroadcastStatus.SCHEDULED; // Stay scheduled for next run
        } else {
            broadcast.status = BroadcastStatus.SENT;
            broadcast.nextRunAt = null;
        }

        await this.broadcastRepo.save(broadcast);

        return {
            success: true,
            broadcastId: broadcast.id,
            recipients: users.length,
            emailsQueued,
            smsSent,
            status: broadcast.status,
        };
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
