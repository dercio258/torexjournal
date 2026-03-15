import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BroadcastNotificationEntity, BroadcastStatus, BroadcastCategory, RecurrenceInterval } from './broadcast-notification.entity';
import { UserEntity } from '../users/user.entity';
import { Subscription, SubscriptionStatus } from '../payment/subscription.entity';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
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
        @InjectQueue('email-queue') private emailQueue: Queue,
        private smsService: SmsService,
    ) { }

    async createBroadcast(data: any) {
        const broadcast = this.broadcastRepo.create({
            ...data,
            status: data.scheduledAt ? BroadcastStatus.SCHEDULED : BroadcastStatus.DRAFT,
            nextRunAt: data.scheduledAt ? new Date(data.scheduledAt) : null
        });

        return this.broadcastRepo.save(broadcast);
    }

    async findAll() {
        return this.broadcastRepo.find({ order: { createdAt: 'DESC' } });
    }

    async deleteBroadcast(id: string) {
        return this.broadcastRepo.delete(id);
    }

    async executeBroadcast(broadcastId: string) {
        const broadcast = await this.broadcastRepo.findOne({ where: { id: broadcastId } });
        if (!broadcast || broadcast.status === BroadcastStatus.SENT) return;

        this.logger.log(`Executing Broadcast: ${broadcast.title} (${broadcast.category})`);

        // 1. Get Target Users
        const users = await this.getTargetUsers(broadcast.category);
        this.logger.log(`Found ${users.length} target users for category ${broadcast.category}`);

        // 2. Queue Notifications
        for (const user of users) {
            if (broadcast.channels.includes('email') && user.email) {
                await this.emailQueue.add('general-notification', {
                    email: user.email,
                    userName: user.name,
                    title: broadcast.title,
                    message: broadcast.message,
                    subtitle: 'INFORMATIVO TOREX'
                }, { removeOnComplete: true });
            }
            
            if (broadcast.channels.includes('sms') && (user.whatsapp || user.preferredMpesa || user.preferredEmola)) {
                // Try sending SMS using available phone numbers
                const phone = user.whatsapp || user.preferredMpesa || user.preferredEmola;
                if (phone) {
                    await this.smsService.sendSms(user.id, phone, broadcast.message);
                }
            }

            // In-app notification logic could go here (creating records in NotificationEntity)
            // Telegram logic could also be queued here
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
            const usersWithActiveSubIds = subs.map(s => s.userId);
            // This is simplified; in a production app use a more efficient query
            const allUsers = await this.userRepo.find();
            return allUsers.filter(u => !usersWithActiveSubIds.includes(u.id));
        }

        // BASIC or PREMIUM
        return subs
            .filter(s => s.planConfig?.tier?.toLowerCase() === category.toLowerCase())
            .map(s => s.user)
            .filter(Boolean);
    }

    private calculateNextRun(current: Date, interval: RecurrenceInterval): Date {
        const next = new Date(current);
        if (interval === RecurrenceInterval.DAILY) next.setDate(next.getDate() + 1);
        if (interval === RecurrenceInterval.WEEKLY) next.setDate(next.getDate() + 7);
        if (interval === RecurrenceInterval.MONTHLY) next.setMonth(next.getMonth() + 1);
        return next;
    }
}
