import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import { SubscriptionPlanConfig } from './subscription-plan.entity';
import { Subscription, SubscriptionStatus, SubscriptionCycle } from './subscription.entity';
import { AlertsService } from '../alerts/alerts.service';
import { AlertType, AlertSeverity } from '../alerts/alert.entity';
import { DebitoService } from './debito.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../email/email.service';
import { UserEntity } from '../users/user.entity';
import { SmsService } from '../notifications/sms.service';
import { SmsTemplates } from '../notifications/sms-templates';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

@Injectable()
export class SubscriptionService implements OnModuleInit {
    private readonly logger = new Logger(SubscriptionService.name);

    constructor(
        private configService: ConfigService,
        private alertsService: AlertsService,
        private debitoService: DebitoService,
        private notificationsService: NotificationsService,
        private emailService: EmailService,
        @InjectRepository(SubscriptionPlanConfig)
        private planConfigRepo: Repository<SubscriptionPlanConfig>,
        @InjectRepository(Subscription)
        private subscriptionRepo: Repository<Subscription>,
        @InjectRepository(UserEntity)
        private userRepo: Repository<UserEntity>,
        private smsService: SmsService,
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
        @InjectQueue('subscription-queue') private subscriptionQueue: Queue,
    ) { }

    async onModuleInit() {
        await this.seedDefaultPlans();
    }

    async seedDefaultPlans() {
        const tiers = ['BASIC', 'PRO'];
        for (const tier of tiers) {
            const exists = await this.planConfigRepo.findOne({ where: { tier } });
            if (!exists) {
                this.logger.log(`Seeding missing plan tier: ${tier}`);
                if (tier === 'BASIC') {
                    await this.planConfigRepo.save({
                        tier: 'BASIC',
                        description: 'Para quem está começando',
                        features: ['Acesso ao Painel', 'Diário Limitado', 'Suporte Básico'],
                        monthlyPrice: Number(this.configService.get<number>('PLANO_BASICO_PRICE', 1)),
                        annualDiscountPercent: 20,
                        trialEnabled: false,
                        trialDays: 0,
                        trialPrice: 0,
                        isActive: true
                    });
                } else if (tier === 'PRO') {
                    await this.planConfigRepo.save({
                        tier: 'PRO',
                        description: 'Para traders profissionais',
                        features: ['Tudo do Básico', 'Análises Avançadas', 'Sem Limites', 'Suporte VIP'],
                        monthlyPrice: Number(this.configService.get<number>('PLANO_PREMIUN_PRICE', 1)),
                        annualDiscountPercent: 20,
                        trialEnabled: false,
                        trialDays: 0,
                        trialPrice: 0,
                        isActive: true
                    });
                }
            } else {
                let updated = false;
                if (!exists.isActive) {
                    this.logger.log(`Re-activating existing plan tier: ${tier}`);
                    exists.isActive = true;
                    updated = true;
                }
                const envPriceKey = tier === 'BASIC' ? 'PLANO_BASICO_PRICE' : 'PLANO_PREMIUN_PRICE';
                const currentEnvPrice = Number(this.configService.get<number>(envPriceKey, 1));
                if (Number(exists.monthlyPrice) !== currentEnvPrice) {
                    this.logger.log(`Updating plan tier price for ${tier}: DB price is ${exists.monthlyPrice}, Env price is ${currentEnvPrice}`);
                    exists.monthlyPrice = currentEnvPrice;
                    updated = true;
                }
                if (updated) {
                    await this.planConfigRepo.save(exists);
                }
            }
        }
    }

    private generateReference(): string {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hour = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const rand = Math.floor(1000 + Math.random() * 9000);
        return `TOREX${year}${month}${day}${hour}${min}${rand}`;
    }

    async getActivePlans() {
        return this.planConfigRepo.find({ where: { isActive: true } });
    }

    async createPlanConfig(data: Partial<SubscriptionPlanConfig>) {
        const newPlan = this.planConfigRepo.create({
            ...data,
            isActive: true, // Default active
        });
        return this.planConfigRepo.save(newPlan);
    }

    // --- Subscription Creation ---

    private getAmount(config: SubscriptionPlanConfig, cycle: SubscriptionCycle): number {
        // Prioritize DB monthlyPrice over environment variables
        const monthlyPrice = Number(config.monthlyPrice);
        const total = cycle === SubscriptionCycle.MONTHLY ? monthlyPrice : (monthlyPrice * 12 * (1 - config.annualDiscountPercent / 100));
        return Number(total.toFixed(2));
    }

    async createMobileSubscription(userId: string, tier: string, cycle: SubscriptionCycle, paymentMethod: 'mpesa' | 'emola', phoneNumber: string, savePreference?: boolean) {
        const config = await this.planConfigRepo.findOne({
            where: { tier: tier.toUpperCase(), isActive: true }
        });

        if (!config) {
            const availablePlans = await this.planConfigRepo.find();
            const tiers = availablePlans.map(p => `${p.tier}(${p.isActive ? 'active' : 'inactive'})`).join(', ');
            this.logger.error(`Plan configuration not found for tier: ${tier}. Available tiers: ${tiers}`);
            throw new Error(`Configuração do plano ${tier} não encontrada. Planos disponíveis: ${tiers}`);
        }

        const amount = this.getAmount(config, cycle);
        const reference = this.generateReference();

        // Call Debito
        const paymentData = {
            msisdn: phoneNumber,
            amount: amount,
            reference_description: reference
        };

        let debitoRes = null;
        try {
            if (paymentMethod === 'mpesa') {
                debitoRes = await this.debitoService.initiateMpesaPayment(paymentData);
            } else {
                debitoRes = await this.debitoService.initiateEmolaPayment(paymentData);
            }

            // Save preferences if requested
            if (savePreference) {
                await this.userRepo.update(userId, {
                    preferredMpesa: paymentMethod === 'mpesa' ? phoneNumber : undefined,
                    preferredEmola: paymentMethod === 'emola' ? phoneNumber : undefined,
                    lastPaymentMethod: paymentMethod
                });
            }

            // Save subscription as PENDING
            const debitoId = debitoRes?.payment_id || debitoRes?.debito_reference || debitoRes?.transaction_id || debitoRes?.id;
            this.logger.log(`Creating subscription for reference ${reference}. Linked Debito ID: ${debitoId}`);

            const sub = this.subscriptionRepo.create({
                userId,
                planConfigId: config.id,
                paymentReference: reference,
                debitoTransactionId: debitoId ? String(debitoId) : null,
                status: SubscriptionStatus.APPROVAL_PENDING,
                cycle,
                paymentMethod,
            });
            sub.planConfig = config; // Attach config to avoid 500 error in activateSubscription
            await this.subscriptionRepo.save(sub);

            // Set active polling state in Redis with 3 minutes TTL (in ms)
            await this.cacheManager.set(`payment_polling:${reference}`, 'active', 3 * 60 * 1000);
            if (debitoId) {
                await this.cacheManager.set(`payment_polling:${debitoId}`, 'active', 3 * 60 * 1000);
            }

            // Start mobile polling loop for 3 minutes via Bull Queue
            await this.subscriptionQueue.add('check-pending', {
                subscriptionId: sub.id,
                reference: reference,
                pollType: 'mobile',
                startTime: Date.now(),
                timeoutMs: 3 * 60 * 1000
            }, { delay: 10000 });

            // Notification: Initiation
            const user = await this.userRepo.findOne({ where: { id: userId } });
            if (user?.email) {
                await this.emailService.sendTemplatedEmail(user.email, 'PAYMENT_INITIATED', {
                    userName: user.name,
                    amount: amount.toString(),
                    method: paymentMethod,
                    reference: reference
                });
            }

            await this.notificationsService.create(userId, {
                title: 'Pagamento Iniciado ⏳',
                message: `Lançamos um pedido de pagamento de MT ${amount} via ${paymentMethod.toUpperCase()}. Confirme no seu telemóvel.`,
            });

            return { success: true, reference };
        } catch (error) {
            this.logger.error(`Mobile subscription failed: ${error.message}`);
            // Notification: Failure
            await this.notificationsService.create(userId, {
                title: 'Falha no Pagamento ❌',
                message: `Não conseguimos iniciar o seu pagamento via ${paymentMethod.toUpperCase()}: ${error.message}`,
            });
            throw error;
        }
    }


    async createCardSubscription(
        userId: string, 
        tier: string, 
        cycle: SubscriptionCycle, 
        returnUrl: string, 
        cancelUrl: string, 
        phoneNumber?: string,
        paymentMethod: 'card' | 'payfast' = 'card'
    ) {
        const config = await this.planConfigRepo.findOne({
            where: { tier: tier.toUpperCase(), isActive: true }
        });

        if (!config) {
            const availablePlans = await this.planConfigRepo.find();
            const tiers = availablePlans.map(p => `${p.tier}(${p.isActive ? 'active' : 'inactive'})`).join(', ');
            this.logger.error(`Plan configuration not found for tier: ${tier}. Available tiers: ${tiers}`);
            throw new Error(`Configuração do plano ${tier} não encontrada. Planos disponíveis: ${tiers}`);
        }

        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) throw new Error('Usuário não encontrado');

        const amount = this.getAmount(config, cycle);
        const reference = this.generateReference();

        const names = (user.name || '').trim().split(' ');
        const firstName = names[0] || 'User';
        const lastName = names.slice(1).join(' ') || 'Torex';

        try {
            // Construct backend return status handler URL
            const backendBaseUrl = this.configService.get<string>('BASE_URL') || 'http://localhost:3000';
            const callbackUrl = `${backendBaseUrl}/api/subscription/payment/status/card?reference=${reference}`;

            let res;
            if (paymentMethod === 'payfast') {
                res = await this.debitoService.initiatePayFastPayment({
                    amount: amount,
                    reference_description: reference,
                    first_name: firstName,
                    last_name: lastName,
                    email: user.email || 'user@torexjournal.com',
                    callback_url: callbackUrl
                });
            } else {
                res = await this.debitoService.initiateCardPayment({
                    amount: Math.round(amount),
                    reference_description: reference,
                    first_name: firstName,
                    last_name: lastName,
                    email: user.email || 'user@torexjournal.com',
                    phone: (phoneNumber || user.whatsapp || '840000000').replace(/\+/g, ''),
                    callback_url: callbackUrl
                });
            }

            // Save subscription
            const debitoId = res?.payment_id || res?.debito_reference || res?.transaction_id || res?.id;
            this.logger.log(`Creating ${paymentMethod} subscription for reference ${reference}. Linked Debito ID: ${debitoId}`);

            const sub = this.subscriptionRepo.create({
                userId,
                planConfigId: config.id,
                paymentReference: reference,
                debitoTransactionId: debitoId ? String(debitoId) : null,
                status: SubscriptionStatus.APPROVAL_PENDING,
                cycle,
                paymentMethod,
            });
            sub.planConfig = config; // Attach config to avoid 500 error in activateSubscription
            await this.subscriptionRepo.save(sub);

            // Set active polling state in Redis with 30 minutes TTL (in ms)
            await this.cacheManager.set(`payment_polling:${reference}`, 'active', 30 * 60 * 1000);
            if (debitoId) {
                await this.cacheManager.set(`payment_polling:${debitoId}`, 'active', 30 * 60 * 1000);
            }

            // Start background polling for up to 30 minutes via Bull Queue
            await this.subscriptionQueue.add('check-pending', {
                subscriptionId: sub.id,
                reference: reference,
                pollType: 'card',
                startTime: Date.now(),
                timeoutMs: 30 * 60 * 1000
            }, { delay: 60000 });

            this.logger.log(`${paymentMethod} subscription created for reference ${reference}. Waiting for webhook / return confirmation.`);

            return res;
        } catch (error) {
            this.logger.error(`${paymentMethod} subscription failed: ${error.message}`);
            throw error;
        }
    }


    async processDebitoWebhook(payload: any) {
        this.logger.log(`Receiving Debito Webhook: ${JSON.stringify(payload)}`);
        
        let reference: string | null = null;
        let paymentId: string | null = null;
        let eventStatus: string | null = null;

        // Check if it's the new webhook format
        if (payload.event && payload.data) {
            eventStatus = payload.event;
            reference = payload.data.reference;
            paymentId = payload.data.payment_id;
        } else {
            // Old webhook format
            reference = payload.reference_description || payload.reference;
            eventStatus = payload.status;
        }

        if (!reference && !paymentId) {
            this.logger.error('Webhook received without reference or payment_id');
            return;
        }

        // Find subscription by paymentReference or debitoTransactionId
        const subscription = await this.subscriptionRepo.findOne({
            where: [
                ...(reference ? [{ paymentReference: reference }] : []),
                ...(reference ? [{ debitoTransactionId: reference }] : []),
                ...(paymentId ? [{ debitoTransactionId: paymentId }] : [])
            ],
            relations: ['planConfig']
        });

        if (!subscription) {
            this.logger.warn(`Subscription not found for reference: ${reference} or paymentId: ${paymentId}`);
            return;
        }

        const resolvedRef = reference || subscription.paymentReference;

        // Clean active polling state from Redis when webhook resolves
        await this.cacheManager.del(`payment_polling:${resolvedRef}`);
        if (paymentId) {
            await this.cacheManager.del(`payment_polling:${paymentId}`);
        }
        if (subscription.paymentReference) {
            await this.cacheManager.del(`payment_polling:${subscription.paymentReference}`);
        }
        if (subscription.debitoTransactionId) {
            await this.cacheManager.del(`payment_polling:${subscription.debitoTransactionId}`);
        }

        // Standardize status logic
        const isSuccess = eventStatus === 'payment.completed' || eventStatus === 'SUCCESSFULL' || eventStatus === 'SUCCESSFUL';
        const isFailure = eventStatus === 'payment.failed' || eventStatus === 'payment.refunded' || eventStatus === 'payment.chargeback' ||
                          eventStatus === 'FAILED' || eventStatus === 'CANCELLED' || eventStatus === 'REJECTED';

        if (isSuccess) {
            // Update transaction id if it was not set or changed
            if (paymentId && subscription.debitoTransactionId !== paymentId) {
                subscription.debitoTransactionId = paymentId;
                await this.subscriptionRepo.save(subscription);
            }
            await this.activateSubscription(subscription, resolvedRef);
        } else if (isFailure) {
            this.logger.log(`Payment failure received for reference ${resolvedRef}: ${eventStatus}`);
            
            // Check if already processed to avoid redundant notifications
            if (subscription.status === SubscriptionStatus.CANCELLED || subscription.status === SubscriptionStatus.EXPIRED) {
                this.logger.warn(`Subscription ${subscription.id} already in terminal state ${subscription.status}, skipping webhook failure processing.`);
                return;
            }
            
            const user = await this.userRepo.findOne({ where: { id: subscription.userId } });
            if (user?.email) {
                await this.emailService.sendTemplatedEmail(user.email, 'PAYMENT_FAILED', {
                    userName: user.name,
                    reference: resolvedRef,
                    reason: (eventStatus === 'CANCELLED' || eventStatus === 'payment.failed') 
                        ? 'O pagamento foi cancelado ou falhou.' 
                        : `O pagamento falhou com status: ${eventStatus}`
                });
            }

            await this.notificationsService.create(subscription.userId, {
                title: 'Pagamento Falhou ❌',
                message: `O seu pagamento de referência ${resolvedRef} falhou ou foi cancelado.`,
            });
            subscription.status = SubscriptionStatus.CANCELLED;
            if (paymentId) {
                subscription.debitoTransactionId = paymentId;
            }
            await this.subscriptionRepo.save(subscription);
            await this.scheduleRemarketingFollowup(subscription.id);
        } else {
            this.logger.log(`Unhandled webhook status/event: ${eventStatus} for ${resolvedRef}`);
        }
    }

    private async activateSubscription(subscription: Subscription, reference: string) {
        if (subscription.status === SubscriptionStatus.ACTIVE) {
            this.logger.warn(`Subscription ${subscription.id} (Ref: ${reference}) is already active. Skipping activation.`);
            return;
        }

        this.logger.log(`Activating subscription ${subscription.id} for user ${subscription.userId} (Ref: ${reference})`);
        const now = new Date();
        const expiry = new Date(now);
        if (subscription.cycle === SubscriptionCycle.YEARLY) {
            expiry.setFullYear(now.getFullYear() + 1);
        } else {
            expiry.setMonth(now.getMonth() + 1);
        }
        subscription.currentPeriodEnd = expiry;
        
        // Ensure status is updated before saving
        subscription.status = SubscriptionStatus.ACTIVE;
        await this.subscriptionRepo.save(subscription);

        // Invalidate user plan cache in Redis
        await this.cacheManager.del(`user_plan_tier:${subscription.userId}`).catch(() => {});
        await this.cacheManager.del(`user_subscription_status:${subscription.userId}`).catch(() => {});

        // Schedule warning and renewal jobs in Bull Queue
        const warningTime = subscription.currentPeriodEnd.getTime() - 5 * 24 * 60 * 60 * 1000;
        const warningDelay = warningTime - Date.now();
        if (warningDelay > 0) {
            await this.subscriptionQueue.add('expiration-warning', {
                subscriptionId: subscription.id
            }, { delay: warningDelay });
            this.logger.log(`Scheduled expiration warning job for subscription ${subscription.id} in ${warningDelay}ms`);
        }

        const renewalDelay = subscription.currentPeriodEnd.getTime() - Date.now();
        if (renewalDelay > 0) {
            await this.subscriptionQueue.add('renewal-charge', {
                subscriptionId: subscription.id
            }, { delay: renewalDelay });
            this.logger.log(`Scheduled renewal charge job for subscription ${subscription.id} in ${renewalDelay}ms`);
        }

        await this.alertsService.create(subscription.userId, {
            type: AlertType.SYSTEM,
            severity: AlertSeverity.INFO,
            title: 'Assinatura Ativada ✅',
            description: `Sua assinatura foi ativada com sucesso via Webhook! Validade até ${expiry.toLocaleDateString()}.`,
            metadata: { reference }
        });

        const user = await this.userRepo.findOne({ where: { id: subscription.userId } });
        if (user?.email) {
            await this.emailService.sendTemplatedEmail(user.email, 'PAYMENT_SUCCESS', {
                userName: user.name,
                plan: subscription.planConfig.tier,
                expiryDate: expiry.toLocaleDateString()
            });
        }

        // Dispatch Payment SMS (Systemic)
        if (user?.whatsapp) {
            await this.smsService.sendSms(
                user.id, 
                user.whatsapp, 
                SmsTemplates.PAYMENT_CONFIRMED(user.name, subscription.planConfig.tier),
                true // isSystemic
            );
        }

        await this.notificationsService.create(subscription.userId, {
            title: 'Pagamento Confirmado! 🎉',
            message: `Sua assinatura ${subscription.planConfig.tier} está ativa até ${expiry.toLocaleDateString()}.`,
        });

        this.logger.log(`Subscription activated via webhook for reference: ${reference}`);
    }

    async handleDebitoStatusUpdate(reference: string) {
        // Find subscription by either Torex reference or Debito ID
        const subscription = await this.subscriptionRepo.findOne({
            where: [
                { paymentReference: reference },
                { debitoTransactionId: reference }
            ],
            relations: ['planConfig']
        });

        if (!subscription) return;

        // Use Debito ID for polling if available, OTHERWISE DO NOT POLL (prevents 404s with internal refs)
        if (!subscription.debitoTransactionId) {
            this.logger.warn(`No Debito ID for subscription ${subscription.id} (Ref: ${reference}), skipping background polling.`);
            return;
        }

        const pollingRef = subscription.debitoTransactionId;
        this.logger.log(`Polling status for reference ${reference} using Debito ID: ${pollingRef}`);
        const result = await this.debitoService.checkTransactionStatus(pollingRef);

        if (result && (result.status === 'SUCCESSFULL' || result.status === 'SUCCESSFUL')) {
            await this.cacheManager.del(`payment_polling:${reference}`);
            if (subscription.paymentReference) {
                await this.cacheManager.del(`payment_polling:${subscription.paymentReference}`);
            }
            if (subscription.debitoTransactionId) {
                await this.cacheManager.del(`payment_polling:${subscription.debitoTransactionId}`);
            }
            await this.activateSubscription(subscription, reference);
        } else if (result && (result.status === 'FAILED' || result.status === 'CANCELLED' || result.status === 'REJECTED')) {
            this.logger.log(`Status check failed for ${reference}: ${result.status}. Marking as CANCELLED.`);
            
            // Send notification ONLY if not already cancelled (redundancy check)
            if (subscription.status !== SubscriptionStatus.CANCELLED) {
                await this.notificationsService.create(subscription.userId, {
                    title: 'Pagamento Falhou ❌',
                    message: `O seu pagamento de referência ${reference} não foi concluído (${result.status}).`,
                });
                
                subscription.status = SubscriptionStatus.CANCELLED;
                await this.subscriptionRepo.save(subscription);
                await this.scheduleRemarketingFollowup(subscription.id);
            }
            await this.cacheManager.del(`payment_polling:${reference}`);
            if (subscription.paymentReference) {
                await this.cacheManager.del(`payment_polling:${subscription.paymentReference}`);
            }
            if (subscription.debitoTransactionId) {
                await this.cacheManager.del(`payment_polling:${subscription.debitoTransactionId}`);
            }
        }
    }

    async getSubscriptionStatus(userId: string) {
        const sub = await this.subscriptionRepo.findOne({
            where: { userId, status: SubscriptionStatus.ACTIVE },
            relations: ['planConfig'],
            order: { currentPeriodEnd: 'DESC' }
        });

        if (sub) {
            const now = new Date();
            const diff = sub.currentPeriodEnd.getTime() - now.getTime();
            const daysLeft = Math.ceil(diff / (1000 * 60 * 60 * 24));

            if (daysLeft <= 0) {
                this.logger.log(`Subscription ${sub.id} for user ${userId} has expired (checked on access, background job will update status).`);
                
                return {
                    hasActive: false,
                    isExpired: true,
                    tier: sub.planConfig.tier,
                    id: sub.id
                };
            }

            let showWarning = false;
            if (daysLeft <= 5) {
                const today = new Date().toDateString();
                const lastShownRedis = await this.cacheManager.get<string>(`last_warning_shown_date:${userId}`);
                if (lastShownRedis !== today) {
                    const user = await this.userRepo.findOne({ where: { id: userId } });
                    const lastShownDb = user?.lastWarningShown ? new Date(user.lastWarningShown).toDateString() : null;
                    if (lastShownDb !== today) {
                        showWarning = true;
                    } else {
                        await this.cacheManager.set(`last_warning_shown_date:${userId}`, today, 24 * 60 * 60 * 1000);
                    }
                }
            }

            return {
                hasActive: true,
                tier: sub.planConfig.tier,
                daysLeft,
                expiryDate: sub.currentPeriodEnd,
                id: sub.id,
                showWarning
            };
        }

        // If no active, check if the latest one is EXPIRED
        const expiredSub = await this.subscriptionRepo.findOne({
            where: { userId, status: SubscriptionStatus.EXPIRED },
            relations: ['planConfig'],
            order: { currentPeriodEnd: 'DESC' }
        });

        if (expiredSub) {
            return {
                hasActive: false,
                isExpired: true,
                tier: expiredSub.planConfig.tier,
                id: expiredSub.id
            };
        }

        return {
            hasActive: false,
            isExpired: false
        };
    }

    async renewActiveSubscription(userId: string) {
        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user || !user.lastPaymentMethod) {
            throw new Error('Nenhum método de pagamento preferencial encontrado para renovação dinâmica.');
        }

        const currentSub = await this.getSubscriptionStatus(userId);
        if (!currentSub.hasActive) throw new Error('Nenhuma assinatura activa para renovar.');

        const phoneNumber = user.lastPaymentMethod === 'mpesa' ? user.preferredMpesa : user.preferredEmola;
        if (!phoneNumber && user.lastPaymentMethod !== 'card') {
            throw new Error('Contacto de pagamento não encontrado.');
        }

        // Always renew with the same tier and cycle as current active
        const sub = await this.subscriptionRepo.findOne({ where: { id: (currentSub as any).id } });

        if (user.lastPaymentMethod === 'card') {
            throw new Error('Renovação automática para cartão não implementada (requer retorno de URL).');
        }

        return this.createMobileSubscription(
            userId,
            currentSub.tier,
            sub.cycle,
            user.lastPaymentMethod as any,
            phoneNumber
        );
    }

    async updatePlanConfig(id: string, data: Partial<SubscriptionPlanConfig>) {
        await this.planConfigRepo.update(id, data);
        return this.planConfigRepo.findOne({ where: { id } });
    }

    async getUserSubscriptionHistory(userId: string) {
        return this.subscriptionRepo.find({
            where: { userId },
            relations: ['planConfig'],
            order: { createdAt: 'DESC' }
        });
    }

    async getAllPlans() {
        return this.planConfigRepo.find();
    }

    async sendFollowUpEmail(subscriptionId: string) {
        const sub = await this.subscriptionRepo.findOne({
            where: { id: subscriptionId },
            relations: ['user', 'planConfig']
        });

        if (!sub || !sub.user || !sub.user.email) return;

        this.logger.log(`Sending remarketing follow-up to ${sub.user.email} for subscription ${sub.id}`);
        
        await this.emailService.sendTemplatedEmail(sub.user.email, 'SYSTEM_ALERT', {
            title: 'Sentimos sua falta! 👋',
            message: `Olá ${sub.user.name}, notamos que sua tentativa de assinatura do plano ${sub.planConfig.tier} não foi concluída. Se precisar de ajuda para finalizar seu pagamento ou tiver alguma dúvida, estamos à disposição!`,
            type: 'MARKETING'
        });

        sub.followUpSent = true;
        await this.subscriptionRepo.save(sub);
    }

    async scheduleRemarketingFollowup(subscriptionId: string) {
        await this.subscriptionQueue.add('remarketing-followup', {
            subscriptionId
        }, { delay: 2 * 24 * 60 * 60 * 1000 });
        this.logger.log(`Scheduled remarketing follow-up job for subscription ${subscriptionId} in 2 days`);
    }

    async getFinancialStats() {
        const subscriptions = await this.subscriptionRepo.find({
            relations: ['planConfig', 'user'],
            order: { createdAt: 'ASC' }
        });
        const users = await this.userRepo.find({
            order: { createdAt: 'ASC' }
        });

        const totalUsers = users.length;
        const activeSubs = subscriptions.filter(s => s.status === SubscriptionStatus.ACTIVE);
        const activeSubscribers = activeSubs.length;

        const mznRateZar = Number(this.configService.get('mznratezar') || '0.25');
        let estimatedMonthlyRevenueMZN = 0;
        let estimatedMonthlyRevenueZAR = 0;

        for (const sub of activeSubs) {
            const price = sub.planConfig ? Number(sub.planConfig.monthlyPrice) : 0;
            let subMonthlyRevenue = 0;
            if (sub.cycle === SubscriptionCycle.YEARLY) {
                const discount = price * 12 * (1 - (sub.planConfig?.annualDiscountPercent || 0) / 100);
                subMonthlyRevenue = discount / 12;
            } else {
                subMonthlyRevenue = price;
            }

            let method = sub.paymentMethod?.toLowerCase() || 'card';
            if (sub.paymentReference && !['mpesa', 'emola', 'card', 'payfast'].includes(method)) {
                const ref = sub.paymentReference.toLowerCase();
                if (ref.includes('mpesa')) method = 'mpesa';
                else if (ref.includes('emola')) method = 'emola';
                else method = 'card';
            }

            if (method === 'payfast') {
                estimatedMonthlyRevenueZAR += subMonthlyRevenue * mznRateZar;
            } else {
                estimatedMonthlyRevenueMZN += subMonthlyRevenue;
            }
        }

        const statuses = {
            active: subscriptions.filter(s => s.status === SubscriptionStatus.ACTIVE || s.status === SubscriptionStatus.APPROVED).length,
            pending: subscriptions.filter(s => s.status === SubscriptionStatus.APPROVAL_PENDING).length,
            cancelled: subscriptions.filter(s => s.status === SubscriptionStatus.CANCELLED || s.status === SubscriptionStatus.EXPIRED).length
        };

        const paymentMethods = {
            mpesa: 0,
            emola: 0,
            card: 0,
            payfast: 0
        };
        for (const sub of subscriptions) {
            let method = sub.paymentMethod?.toLowerCase() || 'card';
            if (sub.paymentReference && !['mpesa', 'emola', 'card', 'payfast'].includes(method)) {
                const ref = sub.paymentReference.toLowerCase();
                if (ref.includes('mpesa')) method = 'mpesa';
                else if (ref.includes('emola')) method = 'emola';
                else method = 'card';
            }
            if (method in paymentMethods) {
                paymentMethods[method as keyof typeof paymentMethods]++;
            } else {
                paymentMethods.card++;
            }
        }

        const dailyMetrics: Record<string, { newSubscriptions: number; renewals: number; upgrades: number; totalUsers: number }> = {};
        const userSubMap: Record<string, Subscription[]> = {};
        for (const sub of subscriptions) {
            if (!userSubMap[sub.userId]) {
                userSubMap[sub.userId] = [];
            }
            userSubMap[sub.userId].push(sub);
        }

        const classificationMap: Record<string, 'new' | 'renewal' | 'upgrade'> = {};
        for (const [userId, userSubs] of Object.entries(userSubMap)) {
            userSubs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
            let lastTier: string | null = null;
            for (let i = 0; i < userSubs.length; i++) {
                const sub = userSubs[i];
                const tier = sub.planConfig?.tier || 'BASIC';
                let classification: 'new' | 'renewal' | 'upgrade' = 'new';
                if (i > 0) {
                    if (tier === 'PRO' && lastTier === 'BASIC') {
                        classification = 'upgrade';
                    } else {
                        classification = 'renewal';
                    }
                }
                classificationMap[sub.id] = classification;
                lastTier = tier;
            }
        }

        const formatDate = (date: Date) => date.toISOString().split('T')[0];

        for (const sub of subscriptions) {
            const dateStr = formatDate(sub.createdAt);
            if (!dailyMetrics[dateStr]) {
                dailyMetrics[dateStr] = { newSubscriptions: 0, renewals: 0, upgrades: 0, totalUsers: 0 };
            }
            const classification = classificationMap[sub.id] || 'new';
            if (classification === 'new') dailyMetrics[dateStr].newSubscriptions++;
            else if (classification === 'renewal') dailyMetrics[dateStr].renewals++;
            else if (classification === 'upgrade') dailyMetrics[dateStr].upgrades++;
        }

        let userCumulative = 0;
        const userGroups: Record<string, number> = {};
        for (const user of users) {
            const dateStr = formatDate(user.createdAt);
            userGroups[dateStr] = (userGroups[dateStr] || 0) + 1;
        }

        const allDates = Array.from(new Set([
            ...users.map(u => formatDate(u.createdAt)),
            ...subscriptions.map(s => formatDate(s.createdAt))
        ])).sort();

        for (const dateStr of allDates) {
            userCumulative += userGroups[dateStr] || 0;
            if (!dailyMetrics[dateStr]) {
                dailyMetrics[dateStr] = { newSubscriptions: 0, renewals: 0, upgrades: 0, totalUsers: userCumulative };
            } else {
                dailyMetrics[dateStr].totalUsers = userCumulative;
            }
        }

        return {
            totalUsers,
            activeSubscribers,
            estimatedMonthlyRevenue: estimatedMonthlyRevenueMZN,
            estimatedMonthlyRevenueMZN,
            estimatedMonthlyRevenueZAR,
            paymentMethods,
            statuses,
            dailyMetrics
        };
    }

    async markWarningAsShown(userId: string) {
        const today = new Date();
        const todayStr = today.toDateString();
        
        // Update Redis cache
        await this.cacheManager.set(`last_warning_shown_date:${userId}`, todayStr, 24 * 60 * 60 * 1000);
        
        // Update database user record
        await this.userRepo.update(userId, { lastWarningShown: today });
        return { success: true };
    }
}
