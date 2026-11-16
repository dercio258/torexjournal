import { Injectable, Logger, OnModuleInit, Inject, ForbiddenException, Optional } from '@nestjs/common';
import { randomInt, randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import { SubscriptionPlanConfig } from './subscription-plan.entity';
import { Subscription, SubscriptionStatus, SubscriptionCycle } from './subscription.entity';
import { AlertsService } from '../alerts/alerts.service';
import { AlertType, AlertSeverity } from '../alerts/alert.entity';
import { DebitoService } from './debito.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailProducerService } from '../email/email-producer.service';
import { UserEntity } from '../users/user.entity';
import { SmsService } from '../notifications/sms.service';
import { SmsTemplates } from '../notifications/sms-templates';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { AnalyticsService } from '../analytics/analytics.service';

@Injectable()
export class SubscriptionService implements OnModuleInit {
    private readonly logger = new Logger(SubscriptionService.name);

    constructor(
        private configService: ConfigService,
        private alertsService: AlertsService,
        private debitoService: DebitoService,
        private notificationsService: NotificationsService,
        private emailProducer: EmailProducerService,
        @InjectRepository(SubscriptionPlanConfig)
        private planConfigRepo: Repository<SubscriptionPlanConfig>,
        @InjectRepository(Subscription)
        private subscriptionRepo: Repository<Subscription>,
        @InjectRepository(UserEntity)
        private userRepo: Repository<UserEntity>,
        private smsService: SmsService,
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
        @InjectQueue('subscription-queue') private subscriptionQueue: Queue,
        @Optional() private analyticsService?: AnalyticsService,
    ) { }

    async onModuleInit() {
        try {
            await this.planConfigRepo.manager.query(
                `ALTER TABLE "subscription_plan_configs" ADD COLUMN IF NOT EXISTS "aiDailyCredits" integer`
            );
        } catch (err: any) {
            this.logger.warn(`SubscriptionPlanConfig DDL check warning: ${err?.message || err}`);
        }
        await this.seedDefaultPlans();
    }

    async seedDefaultPlans() {
        const basicEnvPrice = Number(this.configService.get<number>('PLANO_BASICO_PRICE', 9));
        const proEnvPrice = Number(
            this.configService.get<number>('PLANO_PRO_PRICE') ??
            this.configService.get<number>('PLANO_PREMIUN_PRICE', 19)
        );
        const premiumEnvPrice = Number(
            this.configService.get<number>('PLANO_PREMIUM_PRICE', Math.max(proEnvPrice * 2, 39))
        );

        const defaultConfigs: Array<{
            tier: string;
            description: string;
            features: string[];
            defaultPrice: number;
            envKey?: string;
            aiDailyCredits: number;
        }> = [
            {
                tier: 'BASIC',
                description: 'Para quem está começando no trading',
                features: [
                    '100 Créditos de IA / dia (Torex AI)',
                    'Painel de Performance',
                    'Diário & Calendário',
                    'Importação Manual (CSV / HTML)',
                    'Acesso à Network (Leitura)',
                    'Gestão Emocional',
                ],
                defaultPrice: basicEnvPrice,
                envKey: 'PLANO_BASICO_PRICE',
                aiDailyCredits: 100,
            },
            {
                tier: 'PRO',
                description: 'Para traders consistentes em evolução',
                features: [
                    '2.000 Créditos de IA / dia (Torex AI Pro)',
                    'Tudo do Plano Básico',
                    'Auto-Sync (MT4, MT5, Deriv)',
                    'Backtest & Replay Ilimitado',
                    'Relatórios Executivos',
                    'Interação na Network (Postar/Comentar)',
                ],
                defaultPrice: proEnvPrice,
                envKey: 'PLANO_PRO_PRICE',
                aiDailyCredits: 2000,
            },
            {
                tier: 'PREMIUM',
                description: 'Performance institucional máxima com IA intensiva',
                features: [
                    '20.000 Créditos de IA / dia (Torex AI Ultra)',
                    'Tudo do Plano Pro',
                    'Coaching Avançado de IA & Alertas em Tempo Real',
                    'Gestão Multi-Contas & Prop Firm',
                    'Calendário Econômico Completo',
                    'Suporte Prioritário VIP',
                ],
                defaultPrice: premiumEnvPrice,
                envKey: 'PLANO_PREMIUM_PRICE',
                aiDailyCredits: 20000,
            },
        ];

        for (const cfg of defaultConfigs) {
            const exists = await this.planConfigRepo.findOne({ where: { tier: cfg.tier } });
            if (!exists) {
                this.logger.log(`Seeding missing plan tier: ${cfg.tier} (${cfg.aiDailyCredits} AI credits/day)`);
                await this.planConfigRepo.save({
                    tier: cfg.tier,
                    description: cfg.description,
                    features: cfg.features,
                    monthlyPrice: cfg.defaultPrice,
                    annualDiscountPercent: 20,
                    trialEnabled: false,
                    trialDays: 0,
                    trialPrice: 0,
                    aiDailyCredits: cfg.aiDailyCredits,
                    isActive: true,
                });
            } else {
                let updated = false;
                if (!exists.isActive) {
                    this.logger.log(`Re-activating existing plan tier: ${cfg.tier}`);
                    exists.isActive = true;
                    updated = true;
                }
                if (!exists.aiDailyCredits || exists.aiDailyCredits <= 0) {
                    exists.aiDailyCredits = cfg.aiDailyCredits;
                    updated = true;
                }
                const rawEnvVal = cfg.envKey ? this.configService.get(cfg.envKey) : undefined;
                if (rawEnvVal !== undefined && rawEnvVal !== '' && Number(exists.monthlyPrice) !== Number(rawEnvVal)) {
                    exists.monthlyPrice = Number(rawEnvVal);
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
        const rand = randomBytes(4).toString('hex').toUpperCase();
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

            // Notification: Initiation (Redis Queue + In-app without duplicate email)
            const user = await this.userRepo.findOne({ where: { id: userId } });
            if (user?.email) {
                await this.emailProducer.enqueue(
                    user.email,
                    'PAYMENT_INITIATED',
                    {
                        userName: user.name || undefined,
                        plan: config.tier,
                        amount,
                        currency: 'MZN',
                        method: paymentMethod,
                        reference,
                    },
                    { jobId: `payment-initiated:${sub.id}` },
                );
            }

            await this.notificationsService.create(
                userId,
                {
                    title: 'Pagamento Iniciado',
                    message: `Solicitação de pagamento de ${amount} MZN via ${paymentMethod.toUpperCase()} gerada. Confirme no seu telemóvel.`,
                },
                { skipEmail: true },
            );

            return { success: true, reference };
        } catch (error) {
            this.logger.error(`Mobile subscription failed: ${error.message}`);
            await this.notificationsService.create(
                userId,
                {
                    title: 'Falha ao Iniciar Pagamento',
                    message: `Não foi possível iniciar a transação via ${paymentMethod.toUpperCase()}: ${error.message}`,
                },
                { skipEmail: true },
            );
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
                await this.emailProducer.enqueue(
                    user.email,
                    'PAYMENT_FAILED',
                    {
                        userName: user.name || undefined,
                        plan: subscription.planConfig?.tier,
                        reference: resolvedRef,
                        reason:
                            eventStatus === 'CANCELLED' || eventStatus === 'payment.failed'
                                ? 'A transação foi cancelada ou não autorizada pela operadora.'
                                : `Status reportado pela operadora: ${eventStatus}`,
                    },
                    { jobId: `payment-failed:${subscription.id}` },
                );
            }

            await this.notificationsService.create(
                subscription.userId,
                {
                    title: 'Pagamento Não Concluído',
                    message: `A transação de referência ${resolvedRef} não foi confirmada pela operadora.`,
                },
                { skipEmail: true },
            );
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
        const now = new Date();
        const expiry = new Date(now);
        if (subscription.cycle === SubscriptionCycle.YEARLY) {
            expiry.setFullYear(now.getFullYear() + 1);
        } else {
            expiry.setMonth(now.getMonth() + 1);
        }

        // Acquire row-level pessimistic_write lock inside transaction to prevent double-activation race conditions
        const activated = await this.subscriptionRepo.manager.transaction(async (manager) => {
            const lockedSub = await manager.findOne(Subscription, {
                where: { id: subscription.id },
                lock: { mode: 'pessimistic_write' },
            });

            if (!lockedSub || lockedSub.status === SubscriptionStatus.ACTIVE) {
                return false;
            }

            lockedSub.currentPeriodEnd = expiry;
            lockedSub.status = SubscriptionStatus.ACTIVE;
            await manager.save(Subscription, lockedSub);
            return true;
        });

        if (!activated) {
            this.logger.warn(`Subscription ${subscription.id} (Ref: ${reference}) is already active. Skipping activation.`);
            return;
        }

        subscription.currentPeriodEnd = expiry;
        subscription.status = SubscriptionStatus.ACTIVE;
        this.logger.log(`Activating subscription ${subscription.id} for user ${subscription.userId} (Ref: ${reference})`);

        // Invalidate user plan cache in Redis
        await this.cacheManager.del(`user_plan_tier:${subscription.userId}`).catch(() => {});
        await this.cacheManager.del(`user_subscription_status:${subscription.userId}`).catch(() => {});

        // Schedule warning and renewal jobs in Bull Queue
        const warningTime = expiry.getTime() - 5 * 24 * 60 * 60 * 1000;
        const warningDelay = warningTime - Date.now();
        if (warningDelay > 0) {
            await this.subscriptionQueue.add('expiration-warning', {
                subscriptionId: subscription.id
            }, { delay: warningDelay, jobId: `exp-warn-sched:${subscription.id}` });
            this.logger.log(`Scheduled expiration warning job for subscription ${subscription.id} in ${warningDelay}ms`);
        }

        const renewalDelay = expiry.getTime() - Date.now();
        if (renewalDelay > 0) {
            await this.subscriptionQueue.add('renewal-charge', {
                subscriptionId: subscription.id
            }, { delay: renewalDelay, jobId: `renewal-sched:${subscription.id}` });
            this.logger.log(`Scheduled renewal charge job for subscription ${subscription.id} in ${renewalDelay}ms`);
        }

        await this.alertsService.create(subscription.userId, {
            type: AlertType.SYSTEM,
            severity: AlertSeverity.INFO,
            title: 'Assinatura Ativada',
            description: `Sua assinatura foi ativada com sucesso. Vigência até ${expiry.toLocaleDateString('pt-PT')}.`,
            metadata: { reference }
        });

        const user = await this.userRepo.findOne({ where: { id: subscription.userId } });
        if (user?.email) {
            await this.emailProducer.enqueue(
                user.email,
                'PAYMENT_SUCCESS',
                {
                    userName: user.name || undefined,
                    plan: subscription.planConfig?.tier || 'Profissional',
                    cycle: subscription.cycle === SubscriptionCycle.YEARLY ? 'Anual' : 'Mensal',
                    reference,
                    expiryDate: expiry.toISOString(),
                },
                { jobId: `payment-success:${subscription.id}` },
            );
        }

        // Dispatch Payment SMS (Systemic)
        if (user?.whatsapp) {
            await this.smsService.sendSms(
                user.id, 
                user.whatsapp, 
                SmsTemplates.PAYMENT_CONFIRMED(user.name, subscription.planConfig?.tier || 'PRO'),
                true // isSystemic
            );
        }

        await this.notificationsService.create(
            subscription.userId,
            {
                title: 'Pagamento Confirmado',
                message: `Sua assinatura ${subscription.planConfig?.tier || 'PRO'} está ativa até ${expiry.toLocaleDateString('pt-PT')}.`,
            },
            { skipEmail: true },
        );

        const monthly = Number(subscription.planConfig?.monthlyPrice || 0);
        const discount = Number(subscription.planConfig?.annualDiscountPercent || 0);
        const revenue =
            subscription.cycle === SubscriptionCycle.YEARLY
                ? Number((monthly * 12 * (1 - discount / 100)).toFixed(2))
                : monthly;

        void this.analyticsService?.recordAuthOrBillingConversion({
            eventName: 'purchase',
            userId: subscription.userId,
            email: user?.email,
            visitorId: user?.visitorId,
            revenue,
            currency: 'USD',
            attributionData: user?.attributionData,
            metadata: {
                subscriptionId: subscription.id,
                plan: subscription.planConfig?.tier || 'PRO',
                cycle: subscription.cycle,
                paymentMethod: subscription.paymentMethod,
                reference,
            },
        });

        this.logger.log(`Subscription activated via webhook for reference: ${reference}`);
    }

    async handleDebitoStatusUpdate(reference: string, expectedUserId?: string) {
        // Find subscription by either Torex reference or Debito ID
        const subscription = await this.subscriptionRepo.findOne({
            where: [
                { paymentReference: reference },
                { debitoTransactionId: reference }
            ],
            relations: ['planConfig']
        });

        if (!subscription) return;

        if (expectedUserId && subscription.userId !== expectedUserId) {
            throw new ForbiddenException('Acesso negado a esta referência de assinatura.');
        }

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
                const user = await this.userRepo.findOne({ where: { id: subscription.userId } });
                if (user?.email) {
                    await this.emailProducer.enqueue(
                        user.email,
                        'PAYMENT_FAILED',
                        {
                            userName: user.name || undefined,
                            plan: subscription.planConfig?.tier,
                            reference,
                            reason: `Transação não autorizada (${result.status}).`,
                        },
                        { jobId: `payment-failed:${subscription.id}` },
                    );
                }

                await this.notificationsService.create(
                    subscription.userId,
                    {
                        title: 'Pagamento Não Concluído',
                        message: `O pagamento de referência ${reference} não foi concluído (${result.status}).`,
                    },
                    { skipEmail: true },
                );
                
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

        this.logger.log(`Enqueueing remarketing follow-up to ${sub.user.email} for subscription ${sub.id}`);
        
        await this.emailProducer.enqueue(
            sub.user.email,
            'REMARKETING_FOLLOWUP',
            {
                userName: sub.user.name || undefined,
                plan: sub.planConfig?.tier,
            },
            { jobId: `remarketing:${sub.id}` },
        );

        sub.followUpSent = true;
        await this.subscriptionRepo.save(sub);
    }

    async scheduleRemarketingFollowup(subscriptionId: string) {
        await this.subscriptionQueue.add('remarketing-followup', {
            subscriptionId
        }, { delay: 2 * 24 * 60 * 60 * 1000, jobId: `remarketing-trigger:${subscriptionId}` });
        this.logger.log(`Scheduled remarketing follow-up job for subscription ${subscriptionId} in 2 days`);
    }

    async getFinancialStats() {
        const cacheKey = 'admin:financial_stats';
        try {
            const cached = await this.cacheManager.get(cacheKey);
            if (cached) return cached;
        } catch {}

        const [subscriptions, userDailyCounts, totalUsersCount] = await Promise.all([
            this.subscriptionRepo
                .createQueryBuilder('s')
                .leftJoin('s.planConfig', 'pc')
                .select([
                    's.id',
                    's.userId',
                    's.status',
                    's.cycle',
                    's.paymentMethod',
                    's.paymentReference',
                    's.createdAt',
                    'pc.id',
                    'pc.tier',
                    'pc.monthlyPrice',
                    'pc.annualDiscountPercent',
                ])
                .orderBy('s.createdAt', 'ASC')
                .getMany(),
            this.userRepo.query(
                `SELECT TO_CHAR("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, COUNT(*)::int AS cnt FROM users GROUP BY 1 ORDER BY 1 ASC`,
            ),
            this.userRepo.count(),
        ]);

        const totalUsers = totalUsersCount;
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
        for (const [, userSubs] of Object.entries(userSubMap)) {
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
        for (const row of userDailyCounts || []) {
            if (row?.day) {
                userGroups[row.day] = Number(row.cnt || 0);
            }
        }

        const allDates = Array.from(new Set([
            ...Object.keys(userGroups),
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

        const result = {
            totalUsers,
            activeSubscribers,
            estimatedMonthlyRevenue: estimatedMonthlyRevenueMZN,
            estimatedMonthlyRevenueMZN,
            estimatedMonthlyRevenueZAR,
            paymentMethods,
            statuses,
            dailyMetrics
        };

        try {
            await this.cacheManager.set(cacheKey, result, 60_000); // 60s cache
        } catch {}

        return result;
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

    // --- TRIAL CAMPAIGN SYSTEM ---

    async getTrialCampaignStatus() {
        const proPlan = await this.planConfigRepo.findOne({
            where: [{ tier: 'PRO' }, { tier: 'PREMIUM' }]
        });

        const totalTrialsGranted = await this.userRepo.count({
            where: { hasUsedTrial: true }
        });

        return {
            active: Boolean(proPlan?.trialEnabled),
            trialDays: proPlan?.trialDays || 30,
            tier: proPlan?.tier || 'PRO',
            totalTrialsGranted,
            updatedAt: proPlan?.updatedAt
        };
    }

    async toggleTrialCampaign(enabled: boolean, days: number = 30) {
        let proPlan = await this.planConfigRepo.findOne({
            where: [{ tier: 'PRO' }, { tier: 'PREMIUM' }]
        });

        if (!proPlan) {
            proPlan = this.planConfigRepo.create({
                tier: 'PRO',
                description: 'Para traders profissionais',
                features: ['Tudo do Básico', 'Análises Avançadas', 'Sem Limites', 'Suporte VIP'],
                monthlyPrice: 1,
                annualDiscountPercent: 20,
                trialEnabled: enabled,
                trialDays: days,
                trialPrice: 0,
                isActive: true
            });
        } else {
            proPlan.trialEnabled = enabled;
            if (days !== undefined) {
                proPlan.trialDays = Number(days);
            }
        }

        await this.planConfigRepo.save(proPlan);
        this.logger.log(`[SubscriptionService] Trial Campaign updated: active=${enabled}, days=${proPlan.trialDays}`);

        return this.getTrialCampaignStatus();
    }

    async claimOrCheckTrialForUser(userId: string): Promise<{
        trialGranted: boolean;
        trialDays?: number;
        expiryDate?: Date;
        hasUsedTrial: boolean;
        reason?: string;
    }> {
        // Check if trial campaign is currently active before acquiring DB lock
        const campaign = await this.getTrialCampaignStatus();
        if (!campaign.active) {
            const u = await this.userRepo.findOne({ where: { id: userId }, select: ['id', 'hasUsedTrial'] });
            return { trialGranted: false, hasUsedTrial: Boolean(u?.hasUsedTrial), reason: 'campaign_inactive' };
        }

        const proPlan = await this.planConfigRepo.findOne({
            where: [{ tier: 'PRO' }, { tier: 'PREMIUM' }]
        });

        if (!proPlan) {
            this.logger.warn(`[SubscriptionService] PRO plan config not found to grant trial to user ${userId}`);
            return { trialGranted: false, hasUsedTrial: false, reason: 'pro_plan_missing' };
        }

        const trialDays = campaign.trialDays || 30;
        const now = new Date();
        const expiryDate = new Date(now);
        expiryDate.setDate(expiryDate.getDate() + trialDays);

        const txResult = await this.userRepo.manager.transaction(async (manager) => {
            const user = await manager.findOne(UserEntity, {
                where: { id: userId },
                lock: { mode: 'pessimistic_write' },
            });

            if (!user) {
                return { status: 'user_not_found' as const };
            }

            if (user.hasUsedTrial) {
                return { status: 'trial_already_used' as const };
            }

            const activeSub = await manager.findOne(Subscription, {
                where: { userId, status: SubscriptionStatus.ACTIVE },
            });

            if (activeSub && activeSub.currentPeriodEnd && activeSub.currentPeriodEnd > now) {
                return { status: 'has_active_subscription' as const };
            }

            const sub = manager.create(Subscription, {
                userId: user.id,
                planConfigId: proPlan.id,
                planConfig: proPlan,
                status: SubscriptionStatus.ACTIVE,
                cycle: SubscriptionCycle.MONTHLY,
                paymentMethod: 'TRIAL',
                paymentReference: `TRIAL_${trialDays}D_${Date.now()}_${randomBytes(3).toString('hex').toUpperCase()}`,
                currentPeriodEnd: expiryDate,
            });

            await manager.save(Subscription, sub);

            user.hasUsedTrial = true;
            user.trialUsedAt = new Date();
            await manager.save(UserEntity, user);

            return {
                status: 'granted' as const,
                subId: sub.id,
                email: user.email,
                userName: user.name || user.username || undefined,
                visitorId: user.visitorId,
                attributionData: user.attributionData,
            };
        });

        if (txResult.status !== 'granted') {
            return {
                trialGranted: false,
                hasUsedTrial: txResult.status === 'trial_already_used',
                reason: txResult.status,
            };
        }

        // Invalidate cache immediately so PlanPermissionService reflects PREMIUM tier instantly
        await this.cacheManager.del(`user_plan_tier:${userId}`).catch(() => {});
        await this.cacheManager.del(`user_subscription_status:${userId}`).catch(() => {});

        this.logger.log(`[SubscriptionService] Trial granted to user ${txResult.email} for ${trialDays} days (until ${expiryDate.toISOString()})`);

        if (txResult.email) {
            await this.emailProducer.enqueue(
                txResult.email,
                'TRIAL_WELCOME',
                {
                    userName: txResult.userName,
                    plan: proPlan.tier,
                    days: trialDays,
                    expiryDate: expiryDate.toISOString(),
                },
                { jobId: `trial-welcome:${txResult.subId}` },
            );
        }

        void this.analyticsService?.recordAuthOrBillingConversion({
            eventName: 'trial_start',
            userId,
            email: txResult.email,
            visitorId: txResult.visitorId,
            attributionData: txResult.attributionData,
            metadata: {
                subscriptionId: txResult.subId,
                plan: proPlan.tier,
                trialDays,
            },
        });

        return {
            trialGranted: true,
            trialDays,
            expiryDate,
            hasUsedTrial: true
        };
    }

    async adminAdjustUserSubscription(
        userId: string,
        data: {
            action: 'ASSIGN' | 'EXTEND' | 'CANCEL';
            planConfigId?: string;
            tier?: string;
            days?: number;
            customExpiryDate?: string;
            reason?: string;
        }
    ) {
        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) {
            throw new Error('Usuário não encontrado');
        }

        const now = new Date();

        if (data.action === 'CANCEL') {
            const activeSubs = await this.subscriptionRepo.find({
                where: { userId, status: SubscriptionStatus.ACTIVE },
                relations: ['planConfig']
            });

            if (activeSubs.length === 0) {
                return { success: true, message: 'Usuário já não possui plano ativo.' };
            }

            const cancelledPlan = activeSubs[0]?.planConfig?.tier || 'Profissional';
            for (const sub of activeSubs) {
                sub.status = SubscriptionStatus.CANCELLED;
                sub.currentPeriodEnd = now;
                await this.subscriptionRepo.save(sub);
            }

            await this.cacheManager.del(`user_plan_tier:${userId}`).catch(() => {});
            await this.cacheManager.del(`user_subscription_status:${userId}`).catch(() => {});

            await this.notificationsService.create(
                userId,
                {
                    title: 'Assinatura Encerrada',
                    message: `Sua assinatura foi cancelada.${data.reason ? ` Observação: ${data.reason}` : ''}`,
                },
                { skipEmail: true },
            );

            if (user.email) {
                await this.emailProducer.enqueue(user.email, 'SUBSCRIPTION_CANCELLED', {
                    userName: user.name || undefined,
                    plan: cancelledPlan,
                    effectiveDate: now.toISOString(),
                    reason: data.reason,
                });
            }

            return { success: true, message: 'Plano do usuário cancelado com sucesso.' };
        }

        if (data.action === 'EXTEND') {
            const activeSub = await this.subscriptionRepo.findOne({
                where: { userId, status: SubscriptionStatus.ACTIVE },
                relations: ['planConfig'],
                order: { currentPeriodEnd: 'DESC' }
            });

            if (!activeSub) {
                throw new Error('O usuário não possui plano ativo para estender. Utilize a opção de atribuir um plano.');
            }

            let newExpiry: Date;
            if (data.customExpiryDate) {
                newExpiry = new Date(data.customExpiryDate);
            } else {
                const daysToAdd = Number(data.days) || 30;
                const baseDate = activeSub.currentPeriodEnd && activeSub.currentPeriodEnd > now
                    ? new Date(activeSub.currentPeriodEnd)
                    : new Date(now);
                newExpiry = new Date(baseDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
            }

            activeSub.currentPeriodEnd = newExpiry;
            await this.subscriptionRepo.save(activeSub);

            await this.cacheManager.del(`user_plan_tier:${userId}`).catch(() => {});
            await this.cacheManager.del(`user_subscription_status:${userId}`).catch(() => {});

            const formattedDate = newExpiry.toLocaleDateString('pt-PT');

            await this.notificationsService.create(
                userId,
                {
                    title: 'Vigência do Plano Estendida',
                    message: `A validade do seu plano ${activeSub.planConfig?.tier || 'Ativo'} foi estendida até ${formattedDate}.${data.reason ? ` Obs: ${data.reason}` : ''}`,
                },
                { skipEmail: true },
            );

            if (user.email) {
                await this.emailProducer.enqueue(user.email, 'PAYMENT_SUCCESS', {
                    userName: user.name || undefined,
                    plan: activeSub.planConfig?.tier || 'Profissional',
                    cycle: 'Extensão Administrativa',
                    expiryDate: newExpiry.toISOString(),
                });
            }

            return {
                success: true,
                message: `Validade estendida com sucesso até ${formattedDate}!`,
                subscription: activeSub
            };
        }

        if (data.action === 'ASSIGN') {
            let planConfig: SubscriptionPlanConfig | null = null;
            if (data.planConfigId) {
                planConfig = await this.planConfigRepo.findOne({ where: { id: data.planConfigId } });
            }
            if (!planConfig && data.tier) {
                const tierUpper = data.tier.toUpperCase();
                planConfig = await this.planConfigRepo.findOne({
                    where: [{ tier: tierUpper }, { tier: tierUpper === 'PREMIUM' ? 'PRO' : tierUpper }]
                });
            }
            if (!planConfig) {
                planConfig = await this.planConfigRepo.findOne({ where: { isActive: true } });
            }

            if (!planConfig) {
                throw new Error('Nenhuma configuração de plano encontrada no sistema.');
            }

            let expiryDate: Date;
            if (data.customExpiryDate) {
                expiryDate = new Date(data.customExpiryDate);
            } else {
                const days = Number(data.days) || 30;
                expiryDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
            }

            // Cancel any previously active subscriptions
            const activeSubs = await this.subscriptionRepo.find({
                where: { userId, status: SubscriptionStatus.ACTIVE }
            });
            for (const sub of activeSubs) {
                sub.status = SubscriptionStatus.CANCELLED;
                await this.subscriptionRepo.save(sub);
            }

            // Create new active subscription
            const cycle = (data.days && data.days >= 360) ? SubscriptionCycle.YEARLY : SubscriptionCycle.MONTHLY;
            const newSub = this.subscriptionRepo.create({
                userId,
                planConfigId: planConfig.id,
                planConfig,
                status: SubscriptionStatus.ACTIVE,
                cycle,
                paymentMethod: 'ADMIN_MANUAL',
                paymentReference: `ADMIN_${planConfig.tier}_${Date.now()}`,
                currentPeriodEnd: expiryDate,
            });

            await this.subscriptionRepo.save(newSub);

            await this.cacheManager.del(`user_plan_tier:${userId}`).catch(() => {});
            await this.cacheManager.del(`user_subscription_status:${userId}`).catch(() => {});

            const formattedDate = expiryDate.toLocaleDateString('pt-PT');

            await this.notificationsService.create(
                userId,
                {
                    title: `Plano ${planConfig.tier} Atribuído`,
                    message: `O plano ${planConfig.tier} foi ativado na sua conta com validade até ${formattedDate}.${data.reason ? ` Obs: ${data.reason}` : ''}`,
                },
                { skipEmail: true },
            );

            await this.alertsService.create(userId, {
                type: AlertType.SYSTEM,
                severity: AlertSeverity.INFO,
                title: `Plano ${planConfig.tier} Ativado`,
                description: `Sua conta foi atualizada para o plano ${planConfig.tier} com validade até ${formattedDate}.`,
                metadata: { assignedBy: 'ADMIN', reference: newSub.paymentReference }
            }).catch(e => this.logger.warn(`Could not create alert: ${e.message}`));

            if (user.email) {
                await this.emailProducer.enqueue(
                    user.email,
                    'PAYMENT_SUCCESS',
                    {
                        userName: user.name || undefined,
                        plan: planConfig.tier,
                        reference: newSub.paymentReference,
                        expiryDate: expiryDate.toISOString(),
                    },
                    { jobId: `payment-success:${newSub.id}` },
                );
            }

            return {
                success: true,
                message: `Plano ${planConfig.tier} atribuído com sucesso até ${formattedDate}!`,
                subscription: newSub
            };
        }

        throw new Error('Ação inválida especificada');
    }
}
