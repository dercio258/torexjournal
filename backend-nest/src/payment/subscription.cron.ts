import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
}
