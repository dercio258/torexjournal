import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import { Subscription, SubscriptionStatus } from './subscription.entity';
import { SubscriptionService } from './subscription.service';

@Injectable()
export class SubscriptionCronService {
    private readonly logger = new Logger(SubscriptionCronService.name);

    constructor(
        @InjectRepository(Subscription)
        private subscriptionRepo: Repository<Subscription>,
        private subscriptionService: SubscriptionService
    ) { }

    // Check pending subscriptions every 5 minutes
    @Cron(CronExpression.EVERY_5_MINUTES)
    async checkPendingSubscriptions() {
        this.logger.log('Starting background check for pending subscriptions...');

        try {
            const pendingSubscriptions = await this.subscriptionRepo.find({
                where: {
                    status: SubscriptionStatus.APPROVAL_PENDING
                }
            });

            if (pendingSubscriptions.length === 0) {
                this.logger.log('No pending subscriptions to check.');
                return;
            }

            this.logger.log(`Found ${pendingSubscriptions.length} pending subscriptions. Synchronizing status...`);

            for (const sub of pendingSubscriptions) {
                if (sub.paymentReference) {
                    try {
                        this.logger.log(`Checking status for reference: ${sub.paymentReference}`);
                        await this.subscriptionService.handleDebitoStatusUpdate(sub.paymentReference);
                    } catch (error) {
                        this.logger.error(`Failed to sync status for reference ${sub.paymentReference}`, error);
                    }
                }
            }

            this.logger.log('Background verification complete.');
        } catch (error) {
            this.logger.error('Failed to run checkPendingSubscriptions cron', error);
        }
    }

    // Remarketing: Send follow-up email after 2 days of cancellation
    @Cron(CronExpression.EVERY_DAY_AT_3AM) // Run at 3 AM to avoid peak hours
    async runRemarketingCron() {
        this.logger.log('Starting remarketing follow-up scan...');
        const twoDaysAgo = new Date();
        twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

        try {
            const subs = await this.subscriptionRepo.find({
                where: {
                    status: SubscriptionStatus.CANCELLED,
                    followUpSent: false,
                    createdAt: LessThanOrEqual(twoDaysAgo)
                }
            });

            if (subs.length > 0) {
                this.logger.log(`Processing ${subs.length} subscriptions for remarketing follow-up.`);
                for (const sub of subs) {
                    try {
                        await this.subscriptionService.sendFollowUpEmail(sub.id);
                    } catch (err) {
                        this.logger.error(`Failed to send follow-up for sub ${sub.id}: ${err.message}`);
                    }
                }
            } else {
                this.logger.log('No subscriptions found for remarketing today.');
            }
        } catch (error) {
            this.logger.error('Error in remarketing cron', error);
        }
    }
}
