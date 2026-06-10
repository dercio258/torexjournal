import { Process, Processor, InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job, Queue } from 'bull';
import { Subscription, SubscriptionStatus } from './subscription.entity';
import { SubscriptionService } from './subscription.service';
import { AlertsService } from '../alerts/alerts.service';
import { AlertType, AlertSeverity } from '../alerts/alert.entity';
import { EmailService } from '../email/email.service';
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
        private readonly emailService: EmailService,
        private readonly smsService: SmsService,
        @InjectQueue('subscription-queue')
        private readonly subscriptionQueue: Queue
    ) { }

    @Process('check-pending')
    async handleCheckPending(job: Job) {
        const { subscriptionId, reference, pollType, startTime, timeoutMs } = job.data;
        
        const sub = await this.subscriptionRepo.findOne({
            where: { id: subscriptionId },
            relations: ['user']
        });

        if (!sub) {
            this.logger.warn(`Subscription ${subscriptionId} not found in check-pending job`);
            return;
        }

        if (sub.status !== SubscriptionStatus.APPROVAL_PENDING) {
            this.logger.log(`Subscription ${subscriptionId} (Ref: ${reference}) is already resolved to ${sub.status}. Stopping polling.`);
            return;
        }

        const elapsed = Date.now() - startTime;
        if (elapsed >= timeoutMs) {
            this.logger.log(`Pending payment timeout reached for subscription ${subscriptionId} (Ref: ${reference}). Cancelling.`);
            sub.status = SubscriptionStatus.CANCELLED;
            await this.subscriptionRepo.save(sub);

            if (sub.user && sub.user.email) {
                await this.emailService.sendTemplatedEmail(sub.user.email, 'PAYMENT_FAILED', {
                    userName: sub.user.name,
                    reference: reference,
                    reason: 'O tempo limite de pagamento expirou.'
                });
            }

            // Schedule remarketing follow-up in 2 days
            await this.subscriptionQueue.add('remarketing-followup', {
                subscriptionId: sub.id
            }, { delay: 2 * 24 * 60 * 60 * 1000 });

            return;
        }

        try {
            this.logger.log(`Checking status (Bull) for subscription ${subscriptionId} (Ref: ${reference})`);
            await this.subscriptionService.handleDebitoStatusUpdate(reference);
        } catch (err: any) {
            this.logger.error(`Error in check-pending status update for reference ${reference}: ${err.message}`);
        }

        // Check if still pending
        const updatedSub = await this.subscriptionRepo.findOne({ where: { id: subscriptionId } });
        if (updatedSub && updatedSub.status === SubscriptionStatus.APPROVAL_PENDING) {
            let nextDelay = 10000; // 10s for mobile
            if (pollType === 'card') {
                nextDelay = elapsed < 5 * 60 * 1000 ? 60000 : 10 * 60 * 1000;
            }
            this.logger.log(`Rescheduling check-pending for subscription ${subscriptionId} in ${nextDelay}ms`);
            await this.subscriptionQueue.add('check-pending', job.data, { delay: nextDelay });
        }
    }

    @Process('expiration-warning')
    async handleExpirationWarning(job: Job) {
        const { subscriptionId } = job.data;
        
        const sub = await this.subscriptionRepo.findOne({
            where: { id: subscriptionId },
            relations: ['user', 'planConfig']
        });

        if (!sub || sub.status !== SubscriptionStatus.ACTIVE) {
            this.logger.log(`Skipping expiration warning: Subscription ${subscriptionId} is not active (${sub?.status || 'NOT_FOUND'}).`);
            return;
        }

        this.logger.log(`Sending expiration warning for subscription ${subscriptionId} to user ${sub.userId}`);

        if (sub.user) {
            await this.alertsService.create(sub.userId, {
                type: AlertType.SYSTEM,
                severity: AlertSeverity.WARNING,
                title: 'Sua assinatura expira em 5 dias! ⏳',
                description: `Sua assinatura do plano ${sub.planConfig?.tier || 'atual'} está chegando ao fim. Renove agora para não perder o acesso às suas métricas e ferramentas.`,
                metadata: { expiryDate: sub.currentPeriodEnd, subId: sub.id }
            });

            // Send Email
            await this.emailService.sendTemplatedEmail(sub.user.email, 'GENERAL_NOTIFICATION', {
                userName: sub.user.name,
                title: 'Acção Necessária: Sua Assinatura Expira em Breve',
                subtitle: 'RENOVAÇÃO DE PLANO',
                message: `Sua assinatura do plano ${sub.planConfig?.tier || 'atual'} termina em apenas 5 dias (${new Date(sub.currentPeriodEnd).toLocaleDateString()}).\n\nGaranta a continuidade do seu diário de trading e não perca o acesso aos seus dados históricos e relatórios avançados.`,
                buttonUrl: `${process.env.BASE_URL || ''}/pricing`,
                buttonLabel: 'Renovar Assinatura Agora'
            });

            // Send SMS
            if (sub.user.whatsapp) {
                await this.smsService.sendSms(
                    sub.user.id,
                    sub.user.whatsapp,
                    SmsTemplates.EXPIRATION_REMINDER(sub.user.name, 5),
                    true // isSystemic
                );
            }
        }
    }

    @Process('renewal-charge')
    async handleRenewalCharge(job: Job) {
        const { subscriptionId } = job.data;
        
        const sub = await this.subscriptionRepo.findOne({
            where: { id: subscriptionId },
            relations: ['user', 'planConfig']
        });

        if (!sub || sub.status !== SubscriptionStatus.ACTIVE) {
            this.logger.log(`Skipping renewal charge: Subscription ${subscriptionId} is not active (${sub?.status || 'NOT_FOUND'}).`);
            return;
        }

        try {
            this.logger.log(`Attempting automatic renewal charge for user ${sub.userId} subscription ${sub.id}`);
            await this.subscriptionService.renewActiveSubscription(sub.userId);
            
            // Mark the old active subscription as EXPIRED as we transition to the new payment flow
            sub.status = SubscriptionStatus.EXPIRED;
            await this.subscriptionRepo.save(sub);
        } catch (error: any) {
            this.logger.warn(`Automatic renewal failed: ${error.message}. Expiring subscription.`);
            
            sub.status = SubscriptionStatus.EXPIRED;
            await this.subscriptionRepo.save(sub);

            if (sub.user) {
                await this.alertsService.create(sub.userId, {
                    type: AlertType.SYSTEM,
                    severity: AlertSeverity.WARNING,
                    title: 'Assinatura Expirada ⏳',
                    description: `Sua assinatura do plano ${sub.planConfig?.tier || 'atual'} expirou. Renove agora para recuperar o acesso.`,
                    metadata: { subId: sub.id }
                });

                // Schedule remarketing follow-up in 2 days
                await this.subscriptionQueue.add('remarketing-followup', {
                    subscriptionId: sub.id
                }, { delay: 2 * 24 * 60 * 60 * 1000 });
            }
        }
    }

    @Process('remarketing-followup')
    async handleRemarketingFollowup(job: Job) {
        const { subscriptionId } = job.data;

        const sub = await this.subscriptionRepo.findOne({
            where: { id: subscriptionId }
        });

        if (!sub) return;

        if (sub.status !== SubscriptionStatus.CANCELLED && sub.status !== SubscriptionStatus.EXPIRED) {
            this.logger.log(`Skipping remarketing for subscription ${subscriptionId}: status is ${sub.status}`);
            return;
        }

        if (sub.followUpSent) {
            this.logger.log(`Remarketing follow-up already sent for subscription ${subscriptionId}`);
            return;
        }

        try {
            await this.subscriptionService.sendFollowUpEmail(sub.id);
        } catch (err: any) {
            this.logger.error(`Failed to send follow-up for sub ${sub.id}: ${err.message}`);
        }
    }
}
