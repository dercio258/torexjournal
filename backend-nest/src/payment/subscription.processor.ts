import { Process, Processor, InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job, Queue } from 'bull';
import { Subscription, SubscriptionStatus } from './subscription.entity';
import { SubscriptionService } from './subscription.service';
import { AlertsService } from '../alerts/alerts.service';
import { AlertType, AlertSeverity } from '../alerts/alert.entity';
import { EmailProducerService } from '../email/email-producer.service';
import { SmsService } from '../notifications/sms.service';
import { SmsTemplates } from '../notifications/sms-templates';

@Injectable()
@Processor('subscription-queue')
export class SubscriptionProcessor {
    private readonly logger = new Logger(SubscriptionProcessor.name);

    constructor(
        @InjectRepository(Subscription)
        private readonly subscriptionRepo: Repository<Subscription>,
        private readonly subscriptionService: SubscriptionService,
        private readonly alertsService: AlertsService,
        private readonly emailProducer: EmailProducerService,
        private readonly smsService: SmsService,
        @InjectQueue('subscription-queue')
        private readonly subscriptionQueue: Queue,
    ) {}

    @Process('check-pending')
    async handleCheckPending(job: Job) {
        const { subscriptionId, reference, pollType, startTime, timeoutMs } = job.data;

        const sub = await this.subscriptionRepo.findOne({
            where: { id: subscriptionId },
            relations: ['user', 'planConfig'],
        });

        if (!sub) {
            this.logger.warn(`Subscription ${subscriptionId} not found in check-pending job`);
            return;
        }

        if (sub.status !== SubscriptionStatus.APPROVAL_PENDING) {
            this.logger.log(
                `Subscription ${subscriptionId} (Ref: ${reference}) resolved to ${sub.status}. Stopping polling.`,
            );
            return;
        }

        const elapsed = Date.now() - startTime;
        if (elapsed >= timeoutMs) {
            this.logger.log(
                `Pending payment timeout reached for subscription ${subscriptionId} (Ref: ${reference}). Cancelling.`,
            );
            sub.status = SubscriptionStatus.CANCELLED;
            await this.subscriptionRepo.save(sub);

            if (sub.user?.email) {
                await this.emailProducer.enqueue(
                    sub.user.email,
                    'PAYMENT_FAILED',
                    {
                        userName: sub.user.name || undefined,
                        plan: sub.planConfig?.tier,
                        reference,
                        reason: 'O tempo limite de confirmação da transação expirou.',
                    },
                    { jobId: `payment-failed:${sub.id}` },
                );
            }

            await this.subscriptionQueue.add(
                'remarketing-followup',
                { subscriptionId: sub.id },
                {
                    delay: 2 * 24 * 60 * 60 * 1000,
                    jobId: `remarketing-trigger:${sub.id}`,
                },
            );

            return;
        }

        try {
            await this.subscriptionService.handleDebitoStatusUpdate(reference);
        } catch (err: any) {
            this.logger.error(
                `Error in check-pending status update for reference ${reference}: ${err?.message || err}`,
            );
        }

        const updatedSub = await this.subscriptionRepo.findOne({ where: { id: subscriptionId } });
        if (updatedSub && updatedSub.status === SubscriptionStatus.APPROVAL_PENDING) {
            let nextDelay = 10000;
            if (pollType === 'card') {
                nextDelay = elapsed < 5 * 60 * 1000 ? 60000 : 10 * 60 * 1000;
            }
            await this.subscriptionQueue.add('check-pending', job.data, { delay: nextDelay });
        }
    }

    @Process('expiration-warning')
    async handleExpirationWarning(job: Job) {
        const { subscriptionId } = job.data;

        const sub = await this.subscriptionRepo.findOne({
            where: { id: subscriptionId },
            relations: ['user', 'planConfig'],
        });

        if (!sub || sub.status !== SubscriptionStatus.ACTIVE) {
            return;
        }

        this.logger.log(
            `Processing 5-day expiration warning for subscription ${subscriptionId} (user=${sub.userId})`,
        );

        if (sub.user) {
            const planName = sub.planConfig?.tier || 'Profissional';
            await this.alertsService.create(sub.userId, {
                type: AlertType.SYSTEM,
                severity: AlertSeverity.WARNING,
                title: 'Assinatura próxima do vencimento (5 dias)',
                description: `Sua assinatura do plano ${planName} encerra em 5 dias. Renove antecipadamente para manter o acesso contínuo.`,
                metadata: { expiryDate: sub.currentPeriodEnd, subId: sub.id },
            });

            // Deterministic jobId shared with NotificationsCronService prevents duplicate emails
            if (sub.user.email) {
                await this.emailProducer.enqueue(
                    sub.user.email,
                    'SUBSCRIPTION_EXPIRING',
                    {
                        userName: sub.user.name || undefined,
                        plan: String(planName),
                        daysRemaining: 5,
                        expiryDate: new Date(sub.currentPeriodEnd).toISOString(),
                    },
                    { jobId: `sub-expiring-5d:${sub.id}` },
                );
            }

            if (sub.user.whatsapp) {
                await this.smsService.sendSms(
                    sub.user.id,
                    sub.user.whatsapp,
                    SmsTemplates.EXPIRATION_REMINDER(sub.user.name, 5),
                    true,
                );
            }
        }
    }

    @Process('renewal-charge')
    async handleRenewalCharge(job: Job) {
        const { subscriptionId } = job.data;

        const sub = await this.subscriptionRepo.findOne({
            where: { id: subscriptionId },
            relations: ['user', 'planConfig'],
        });

        if (!sub || sub.status !== SubscriptionStatus.ACTIVE) {
            return;
        }

        try {
            this.logger.log(
                `Attempting automatic renewal charge for user ${sub.userId} subscription ${sub.id}`,
            );
            await this.subscriptionService.renewActiveSubscription(sub.userId);

            sub.status = SubscriptionStatus.EXPIRED;
            await this.subscriptionRepo.save(sub);
        } catch (error: any) {
            this.logger.warn(
                `Automatic renewal failed for sub ${sub.id}: ${error?.message || error}. Expiring subscription.`,
            );

            sub.status = SubscriptionStatus.EXPIRED;
            await this.subscriptionRepo.save(sub);

            if (sub.user) {
                const planName = sub.planConfig?.tier || 'Profissional';
                await this.alertsService.create(sub.userId, {
                    type: AlertType.SYSTEM,
                    severity: AlertSeverity.WARNING,
                    title: 'Assinatura Expirada',
                    description: `A vigência do plano ${planName} encerrou. Renove sua assinatura para recuperar o acesso completo.`,
                    metadata: { subId: sub.id },
                });

                if (sub.user.email) {
                    await this.emailProducer.enqueue(
                        sub.user.email,
                        'SUBSCRIPTION_EXPIRED',
                        {
                            userName: sub.user.name || undefined,
                            plan: String(planName),
                            expiredAt: new Date(sub.currentPeriodEnd || new Date()).toISOString(),
                        },
                        { jobId: `sub-expired:${sub.id}` },
                    );
                }

                await this.subscriptionQueue.add(
                    'remarketing-followup',
                    { subscriptionId: sub.id },
                    {
                        delay: 2 * 24 * 60 * 60 * 1000,
                        jobId: `remarketing-trigger:${sub.id}`,
                    },
                );
            }
        }
    }

    @Process('remarketing-followup')
    async handleRemarketingFollowup(job: Job) {
        const { subscriptionId } = job.data;

        const sub = await this.subscriptionRepo.findOne({
            where: { id: subscriptionId },
        });

        if (!sub) return;

        if (
            sub.status !== SubscriptionStatus.CANCELLED &&
            sub.status !== SubscriptionStatus.EXPIRED
        ) {
            return;
        }

        if (sub.followUpSent) {
            return;
        }

        try {
            await this.subscriptionService.sendFollowUpEmail(sub.id);
        } catch (err: any) {
            this.logger.error(
                `Failed to enqueue follow-up for sub ${sub.id}: ${err?.message || err}`,
            );
        }
    }
}
