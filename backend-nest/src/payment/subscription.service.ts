import { Injectable, Logger, OnModuleInit, Inject, ForbiddenException, BadRequestException, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Not } from 'typeorm';
import { SubscriptionPlanConfig } from './subscription-plan.entity';
import { Subscription, SubscriptionStatus, SubscriptionCycle } from './subscription.entity';
import { AlertsService } from '../alerts/alerts.service';
import { AlertType, AlertSeverity } from '../alerts/alert.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailProducerService } from '../email/email-producer.service';
import { UserEntity } from '../users/user.entity';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { AnalyticsService } from '../analytics/analytics.service';
import { ReferralService } from '../users/referral.service';

@Injectable()
export class SubscriptionService implements OnModuleInit {
    private readonly logger = new Logger(SubscriptionService.name);

    constructor(
        private configService: ConfigService,
        private alertsService: AlertsService,
        private notificationsService: NotificationsService,
        private emailProducer: EmailProducerService,
        @InjectRepository(SubscriptionPlanConfig)
        private planConfigRepo: Repository<SubscriptionPlanConfig>,
        @InjectRepository(Subscription)
        private subscriptionRepo: Repository<Subscription>,
        @InjectRepository(UserEntity)
        private userRepo: Repository<UserEntity>,
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
        @InjectQueue('subscription-queue') private subscriptionQueue: Queue,
        @Optional() private analyticsService?: AnalyticsService,
        @Optional() private referralService?: ReferralService,
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

    getUsdToMznRate(): number {
        const raw =
            this.configService.get<string | number>('USD_TO_MZN_RATE') ??
            this.configService.get<string | number>('EXCHANGE_RATE_USD_MZN') ??
            65;
        const parsed = Number(raw);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 65;
    }

    getAmountUsd(config: SubscriptionPlanConfig, cycle: SubscriptionCycle): number {
        const monthlyPrice = Number(config.monthlyPrice);
        const discount = Number(config.annualDiscountPercent || 0);
        const total =
            cycle === SubscriptionCycle.MONTHLY
                ? monthlyPrice
                : monthlyPrice * 12 * (1 - discount / 100);
        return Number(total.toFixed(2));
    }

    getAmountMzn(config: SubscriptionPlanConfig, cycle: SubscriptionCycle): number {
        const usd = this.getAmountUsd(config, cycle);
        return Number((usd * this.getUsdToMznRate()).toFixed(2));
    }

    private getAmount(config: SubscriptionPlanConfig, cycle: SubscriptionCycle): number {
        return this.getAmountMzn(config, cycle);
    }

    private async invalidateUserPlanCaches(userId: string): Promise<void> {
        await this.cacheManager.del(`user_plan_tier:${userId}`).catch(() => {});
        await this.cacheManager.del(`user_subscription_status:${userId}`).catch(() => {});
        await this.cacheManager.del('admin:financial_stats').catch(() => {});
    }

    async cancelScheduledSubscriptionJobs(subscriptionId: string): Promise<void> {
        const jobIds = [
            `exp-warn-sched:${subscriptionId}`,
            `renewal-sched:${subscriptionId}`,
            `remarketing-trigger:${subscriptionId}`,
        ];
        for (const jobId of jobIds) {
            try {
                const job = await this.subscriptionQueue.getJob(jobId);
                if (job) {
                    await job.remove();
                }
            } catch (err: any) {
                this.logger.warn(
                    `Failed removing Bull job ${jobId} for subscription ${subscriptionId}: ${err?.message || err}`,
                );
            }
        }
    }

    async scheduleSubscriptionLifecycleJobs(subscriptionId: string, expiry: Date): Promise<void> {
        await this.cancelScheduledSubscriptionJobs(subscriptionId);
        const nowMs = Date.now();
        const warningTime = expiry.getTime() - 5 * 24 * 60 * 60 * 1000;
        const warningDelay = warningTime - nowMs;
        if (warningDelay > 0) {
            await this.subscriptionQueue.add(
                'expiration-warning',
                { subscriptionId },
                { delay: warningDelay, jobId: `exp-warn-sched:${subscriptionId}` },
            );
            this.logger.log(
                `Scheduled expiration warning job for subscription ${subscriptionId} in ${warningDelay}ms`,
            );
        }

        // Schedule auto-renewal slightly ahead of expiry so the 5-min expiration sweep does not race ahead of it
        if (expiry.getTime() > nowMs) {
            const renewalDelay = Math.max(1000, expiry.getTime() - 2 * 60 * 1000 - nowMs);
            await this.subscriptionQueue.add(
                'renewal-charge',
                { subscriptionId },
                { delay: renewalDelay, jobId: `renewal-sched:${subscriptionId}` },
            );
            this.logger.log(
                `Scheduled renewal charge job for subscription ${subscriptionId} in ${renewalDelay}ms`,
            );
        }
    }

    async createMobileSubscription(
        userId: string,
        tier: string,
        cycle: SubscriptionCycle,
        paymentMethod: 'mpesa' | 'emola',
        phoneNumber: string,
        savePreference?: boolean,
        useReferralCredits?: boolean,
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

        const baseUsd = this.getAmountUsd(config, cycle);
        let appliedCreditUsd = 0;
        if (useReferralCredits && this.referralService) {
            const userRow = await this.userRepo.findOne({ where: { id: userId }, select: ['id', 'referralCreditsUsd'] });
            const available = Math.max(0, Number(userRow?.referralCreditsUsd || 0));
            const candidate = Number(Math.min(available, Math.max(0, baseUsd - 0.5)).toFixed(2));
            if (candidate > 0) {
                const consumed = await this.referralService.consumeReferralCredits(userId, candidate);
                if (consumed) appliedCreditUsd = candidate;
            }
        }
        const netUsd = Math.max(0, Number((baseUsd - appliedCreditUsd).toFixed(2)));
        const amount = Number((netUsd * this.getUsdToMznRate()).toFixed(2));
        const reference = this.generateReference();

        try {
            // Save preferences if requested
            if (savePreference) {
                await this.userRepo.update(userId, {
                    preferredMpesa: paymentMethod === 'mpesa' ? phoneNumber : undefined,
                    preferredEmola: paymentMethod === 'emola' ? phoneNumber : undefined,
                    lastPaymentMethod: paymentMethod
                });
            }

            // Save subscription as PENDING ready for payment confirmation/webhook
            this.logger.log(`Creating ${paymentMethod} subscription for reference ${reference}.`);

            const sub = this.subscriptionRepo.create({
                userId,
                planConfigId: config.id,
                paymentReference: reference,
                externalTransactionId: null,
                status: SubscriptionStatus.APPROVAL_PENDING,
                cycle,
                paymentMethod,
            });
            sub.planConfig = config; // Attach config to avoid 500 error in activateSubscription
            await this.subscriptionRepo.save(sub);

            // Set active polling state in Redis with 3 minutes TTL (in ms)
            await this.cacheManager.set(`payment_polling:${reference}`, 'active', 3 * 60 * 1000);

            // Start mobile timeout watcher for 3 minutes via Bull Queue
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
                    message: `Solicitação de pagamento de ${amount} MZN via ${paymentMethod.toUpperCase()} registrada (Ref. ${reference}).`,
                },
                { skipEmail: true },
            );

            return {
                success: true,
                status: 'PENDING',
                reference,
                amount,
                currency: 'MZN',
                paymentMethod,
            };
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
        _returnUrl?: string,
        _cancelUrl?: string,
        _phoneNumber?: string,
        useReferralCredits?: boolean,
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

        const baseUsd = this.getAmountUsd(config, cycle);
        let appliedCreditUsd = 0;
        if (useReferralCredits && this.referralService) {
            const available = Math.max(0, Number(user.referralCreditsUsd || 0));
            const candidate = Number(Math.min(available, Math.max(0, baseUsd - 0.5)).toFixed(2));
            if (candidate > 0) {
                const consumed = await this.referralService.consumeReferralCredits(userId, candidate);
                if (consumed) appliedCreditUsd = candidate;
            }
        }
        const amountUsd = Math.max(0, Number((baseUsd - appliedCreditUsd).toFixed(2)));
        const amountMzn = Number((amountUsd * this.getUsdToMznRate()).toFixed(2));
        const reference = this.generateReference();

        try {
            this.logger.log(`Creating card subscription for reference ${reference}.`);

            const sub = this.subscriptionRepo.create({
                userId,
                planConfigId: config.id,
                paymentReference: reference,
                externalTransactionId: null,
                status: SubscriptionStatus.APPROVAL_PENDING,
                cycle,
                paymentMethod: 'card',
            });
            sub.planConfig = config; // Attach config to avoid 500 error in activateSubscription
            await this.subscriptionRepo.save(sub);

            // Set active polling state in Redis with 30 minutes TTL (in ms)
            await this.cacheManager.set(`payment_polling:${reference}`, 'active', 30 * 60 * 1000);

            // Start background timeout watcher for up to 30 minutes via Bull Queue
            await this.subscriptionQueue.add('check-pending', {
                subscriptionId: sub.id,
                reference: reference,
                pollType: 'card',
                startTime: Date.now(),
                timeoutMs: 30 * 60 * 1000
            }, { delay: 60000 });

            if (user.email) {
                await this.emailProducer.enqueue(
                    user.email,
                    'PAYMENT_INITIATED',
                    {
                        userName: user.name || undefined,
                        plan: config.tier,
                        amount: amountUsd,
                        currency: 'USD',
                        method: 'card',
                        reference,
                    },
                    { jobId: `payment-initiated:${sub.id}` },
                );
            }

            await this.notificationsService.create(
                userId,
                {
                    title: 'Pagamento Iniciado',
                    message: `Solicitação de pagamento de ${amountUsd} USD via Cartão registrada (Ref. ${reference}).`,
                },
                { skipEmail: true },
            );

            this.logger.log(`Card subscription created for reference ${reference}. Waiting for confirmation.`);

            return {
                success: true,
                status: 'PENDING',
                reference,
                checkoutUrl: null,
                amountUsd,
                amountMzn,
                paymentMethod: 'card',
            };
        } catch (error) {
            this.logger.error(`Card subscription failed: ${error.message}`);
            throw error;
        }
    }


    async redeemSubscriptionWithReferralCredits(
        userId: string,
        tier: string,
        cycle: SubscriptionCycle,
    ) {
        const config = await this.planConfigRepo.findOne({
            where: { tier: tier.toUpperCase(), isActive: true },
        });
        if (!config) {
            throw new BadRequestException(`Plano ${tier} não encontrado ou inativo.`);
        }
        if (!this.referralService) {
            throw new BadRequestException('Serviço de créditos de afiliado indisponível.');
        }

        const amountUsd = this.getAmountUsd(config, cycle);
        const user = await this.userRepo.findOne({
            where: { id: userId },
            select: ['id', 'referralCreditsUsd'],
        });
        const availableUsd = Math.max(0, Number(user?.referralCreditsUsd || 0));
        if (availableUsd < amountUsd) {
            throw new BadRequestException(
                `Crédito de afiliados insuficiente ($${availableUsd.toFixed(2)} disponível vs $${amountUsd.toFixed(2)} necessários).`,
            );
        }

        const debited = await this.referralService.consumeReferralCredits(userId, amountUsd);
        if (!debited) {
            throw new BadRequestException('Não foi possível debitar seus créditos de afiliado.');
        }

        const reference = this.generateReference();
        const sub = this.subscriptionRepo.create({
            userId,
            planConfigId: config.id,
            paymentReference: reference,
            externalTransactionId: `REFCRED-${reference}`,
            status: SubscriptionStatus.APPROVAL_PENDING,
            cycle,
            paymentMethod: 'referral_credits',
        });
        sub.planConfig = config;
        await this.subscriptionRepo.save(sub);

        await this.activateSubscription(sub, reference);
        return {
            success: true,
            status: 'ACTIVE',
            reference,
            debitedUsd: amountUsd,
            tier: config.tier,
        };
    }

    async processPaymentWebhook(payload: any) {
        this.logger.log(`Receiving Payment Webhook: ${JSON.stringify(payload)}`);
        
        let reference: string | null = null;
        let paymentId: string | null = null;
        let eventStatus: string | null = null;

        if (payload?.event && payload?.data) {
            eventStatus = payload.event;
            reference = payload.data.reference;
            paymentId = payload.data.payment_id;
        } else if (payload) {
            reference = payload.reference_description || payload.reference;
            paymentId = payload.payment_id || payload.transaction_id || null;
            eventStatus = payload.status;
        }

        if (!reference && !paymentId) {
            this.logger.error('Webhook received without reference or payment_id');
            return;
        }

        // Find subscription by paymentReference or externalTransactionId
        const subscription = await this.subscriptionRepo.findOne({
            where: [
                ...(reference ? [{ paymentReference: reference }] : []),
                ...(reference ? [{ externalTransactionId: reference }] : []),
                ...(paymentId ? [{ externalTransactionId: paymentId }] : [])
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
        if (subscription.externalTransactionId) {
            await this.cacheManager.del(`payment_polling:${subscription.externalTransactionId}`);
        }

        // Standardize status logic
        const normalizedEvent = String(eventStatus || '').trim();
        const normalizedUpper = normalizedEvent.toUpperCase();
        const isSuccess =
            normalizedEvent === 'payment.completed' ||
            normalizedUpper === 'SUCCESSFULL' ||
            normalizedUpper === 'SUCCESSFUL' ||
            normalizedUpper === 'COMPLETED' ||
            normalizedUpper === 'APPROVED';
        const isRefundOrChargeback =
            normalizedEvent === 'payment.refunded' ||
            normalizedEvent === 'payment.chargeback' ||
            normalizedUpper === 'REFUNDED' ||
            normalizedUpper === 'CHARGEBACK';
        const isFailure =
            normalizedEvent === 'payment.failed' ||
            normalizedUpper === 'FAILED' ||
            normalizedUpper === 'CANCELLED' ||
            normalizedUpper === 'REJECTED';

        if (isSuccess) {
            if (paymentId && subscription.externalTransactionId !== paymentId) {
                subscription.externalTransactionId = paymentId;
                await this.subscriptionRepo.save(subscription);
            }
            await this.activateSubscription(subscription, resolvedRef);
        } else if (isRefundOrChargeback) {
            this.logger.warn(
                `Refund/Chargeback webhook received for subscription ${subscription.id} (Ref: ${resolvedRef}): ${normalizedEvent}`,
            );
            subscription.status = SubscriptionStatus.CANCELLED;
            subscription.currentPeriodEnd = new Date();
            if (paymentId) {
                subscription.externalTransactionId = paymentId;
            }
            await this.subscriptionRepo.save(subscription);
            await this.cancelScheduledSubscriptionJobs(subscription.id);
            await this.invalidateUserPlanCaches(subscription.userId);
            await this.notificationsService.create(
                subscription.userId,
                {
                    title: 'Assinatura Cancelada por Reembolso/Estorno',
                    message: `A assinatura vinculada à referência ${resolvedRef} foi encerrada (${normalizedEvent}).`,
                },
                { skipEmail: true },
            );
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
                            normalizedUpper === 'CANCELLED' || normalizedEvent === 'payment.failed'
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
                subscription.externalTransactionId = paymentId;
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
        const txActivation = await this.subscriptionRepo.manager.transaction(async (manager) => {
            const lockedSub = await manager.findOne(Subscription, {
                where: { id: subscription.id },
                lock: { mode: 'pessimistic_write' },
            });

            if (!lockedSub || lockedSub.status === SubscriptionStatus.ACTIVE) {
                return null;
            }

            // Close any previously ACTIVE or stale APPROVAL_PENDING/APPROVED subscriptions on upgrade
            const supersededSubs = await manager.find(Subscription, {
                where: {
                    userId: lockedSub.userId,
                    status: In([
                        SubscriptionStatus.ACTIVE,
                        SubscriptionStatus.APPROVAL_PENDING,
                        SubscriptionStatus.APPROVED,
                    ]),
                    id: Not(lockedSub.id),
                },
            });
            for (const prevSub of supersededSubs) {
                prevSub.status = SubscriptionStatus.CANCELLED;
                prevSub.currentPeriodEnd = now;
                await manager.save(Subscription, prevSub);
            }

            lockedSub.currentPeriodEnd = expiry;
            lockedSub.status = SubscriptionStatus.ACTIVE;
            await manager.save(Subscription, lockedSub);
            return { supersededIds: supersededSubs.map((s) => s.id) };
        });

        if (!txActivation) {
            this.logger.warn(`Subscription ${subscription.id} (Ref: ${reference}) is already active. Skipping activation.`);
            return;
        }

        subscription.currentPeriodEnd = expiry;
        subscription.status = SubscriptionStatus.ACTIVE;
        this.logger.log(
            `Activating subscription ${subscription.id} for user ${subscription.userId} (Ref: ${reference}, superseded=${txActivation.supersededIds.length})`,
        );

        for (const prevId of txActivation.supersededIds) {
            await this.cancelScheduledSubscriptionJobs(prevId);
        }

        // Invalidate user plan & admin financial caches in Redis
        await this.invalidateUserPlanCaches(subscription.userId);

        // Schedule warning and renewal jobs in Bull Queue cleanly
        await this.scheduleSubscriptionLifecycleJobs(subscription.id, expiry);

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

        await this.notificationsService.create(
            subscription.userId,
            {
                title: 'Pagamento Confirmado',
                message: `Sua assinatura ${subscription.planConfig?.tier || 'PRO'} está ativa até ${expiry.toLocaleDateString('pt-PT')}.`,
            },
            { skipEmail: true },
        );

        const isNonTrialPaid =
            !['trial', 'free_trial', 'referral_credits'].includes(
                String(subscription.paymentMethod || '').toLowerCase(),
            ) && Number(subscription.planConfig?.monthlyPrice || 0) > 0;
        if (isNonTrialPaid) {
            await this.referralService
                ?.unlockPendingCreditsOnPaidPlan(subscription.userId)
                .catch(() => {});
        }
        await this.referralService?.processPaidConversion(subscription.userId).catch(() => {});

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

    async checkPaymentStatus(
        reference: string,
        expectedUserId?: string,
    ): Promise<{ found: boolean; status: SubscriptionStatus | null }> {
        const subscription = await this.subscriptionRepo.findOne({
            where: [
                { paymentReference: reference },
                { externalTransactionId: reference }
            ],
            relations: ['planConfig']
        });

        if (!subscription) {
            return { found: false, status: null };
        }

        if (expectedUserId && subscription.userId !== expectedUserId) {
            throw new ForbiddenException('Acesso negado a esta referência de assinatura.');
        }

        return { found: true, status: subscription.status };
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

    async renewSubscriptionById(subscriptionId: string): Promise<{
        action: 'noop' | 'rescheduled' | 'superseded' | 'renewal_initiated' | 'cannot_auto_renew' | 'failed';
        sub?: Subscription;
        reason?: string;
        reference?: string;
    }> {
        const sub = await this.subscriptionRepo.findOne({
            where: { id: subscriptionId },
            relations: ['user', 'planConfig'],
        });

        if (!sub || sub.status !== SubscriptionStatus.ACTIVE) {
            return { action: 'noop' };
        }

        const nowMs = Date.now();
        // Protect manually extended subscriptions against stale scheduled Bull jobs
        if (sub.currentPeriodEnd && new Date(sub.currentPeriodEnd).getTime() > nowMs + 5 * 60 * 1000) {
            this.logger.log(
                `Subscription ${sub.id} period end (${sub.currentPeriodEnd.toISOString()}) was extended; rescheduling Bull jobs without expiring.`,
            );
            await this.scheduleSubscriptionLifecycleJobs(sub.id, new Date(sub.currentPeriodEnd));
            return { action: 'rescheduled', sub };
        }

        // Check if another active subscription for this user already exists with a later expiry (e.g. upgrade / manual assign)
        const newerActive = await this.subscriptionRepo.findOne({
            where: {
                userId: sub.userId,
                status: SubscriptionStatus.ACTIVE,
                id: Not(sub.id),
            },
            order: { currentPeriodEnd: 'DESC' },
        });
        if (
            newerActive &&
            newerActive.currentPeriodEnd &&
            new Date(newerActive.currentPeriodEnd).getTime() > nowMs
        ) {
            sub.status = SubscriptionStatus.CANCELLED;
            await this.subscriptionRepo.save(sub);
            await this.cancelScheduledSubscriptionJobs(sub.id);
            await this.invalidateUserPlanCaches(sub.userId);
            return { action: 'superseded', sub };
        }

        const user = sub.user || (await this.userRepo.findOne({ where: { id: sub.userId } }));
        const method = user?.lastPaymentMethod;
        const phone =
            method === 'mpesa'
                ? user?.preferredMpesa
                : method === 'emola'
                  ? user?.preferredEmola
                  : null;

        if (!user || (method !== 'mpesa' && method !== 'emola') || !phone || !sub.planConfig) {
            return {
                action: 'cannot_auto_renew',
                sub,
                reason: 'Nenhum método móvel automático (M-Pesa/e-Mola) disponível para renovação.',
            };
        }

        try {
            const initiated = await this.createMobileSubscription(
                sub.userId,
                sub.planConfig.tier,
                sub.cycle,
                method,
                phone,
            );
            if (!sub.currentPeriodEnd || new Date(sub.currentPeriodEnd).getTime() <= Date.now()) {
                sub.status = SubscriptionStatus.EXPIRED;
                await this.subscriptionRepo.save(sub);
                await this.invalidateUserPlanCaches(sub.userId);
            }
            return { action: 'renewal_initiated', sub, reference: initiated?.reference };
        } catch (err: any) {
            return {
                action: 'failed',
                sub,
                reason: err?.message || 'Gateway error during auto-renewal',
            };
        }
    }

    async renewActiveSubscription(userId: string) {
        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user || !user.lastPaymentMethod) {
            throw new Error('Nenhum método de pagamento preferencial encontrado para renovação dinâmica.');
        }

        // Look up directly by DB rows so expired-on-exact-second subscriptions remain renewable
        const sub = await this.subscriptionRepo.findOne({
            where: {
                userId,
                status: In([SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRED]),
            },
            relations: ['planConfig'],
            order: { currentPeriodEnd: 'DESC' },
        });
        if (!sub || !sub.planConfig) {
            throw new Error('Nenhuma assinatura activa ou elegível para renovar.');
        }

        if (user.lastPaymentMethod === 'card') {
            throw new Error('Renovação automática para cartão não implementada (requer retorno de URL).');
        }

        const phoneNumber =
            user.lastPaymentMethod === 'mpesa' ? user.preferredMpesa : user.preferredEmola;
        if (!phoneNumber) {
            throw new Error('Contacto de pagamento não encontrado.');
        }

        return this.createMobileSubscription(
            userId,
            sub.planConfig.tier,
            sub.cycle,
            user.lastPaymentMethod as 'mpesa' | 'emola',
            phoneNumber,
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

        const usdToMzn = this.getUsdToMznRate();
        let estimatedMonthlyRevenueMZN = 0;

        for (const sub of activeSubs) {
            const priceUsd = sub.planConfig ? Number(sub.planConfig.monthlyPrice) : 0;
            let subMonthlyRevenueUsd = 0;
            if (sub.cycle === SubscriptionCycle.YEARLY) {
                const discount = priceUsd * 12 * (1 - (sub.planConfig?.annualDiscountPercent || 0) / 100);
                subMonthlyRevenueUsd = discount / 12;
            } else {
                subMonthlyRevenueUsd = priceUsd;
            }
            const subMonthlyRevenueMzn = subMonthlyRevenueUsd * usdToMzn;
            estimatedMonthlyRevenueMZN += subMonthlyRevenueMzn;
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
        };
        for (const sub of subscriptions) {
            let method = sub.paymentMethod?.toLowerCase() || 'card';
            if (sub.paymentReference && !['mpesa', 'emola', 'card'].includes(method)) {
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

        const tierRankMap: Record<string, number> = {
            FREE: 0,
            BASIC: 1,
            BASICO: 1,
            PRO: 2,
            PREMIUM: 3,
            VIP: 3,
            ELITE: 3,
            ENTERPRISE: 3,
        };
        const classificationMap: Record<string, 'new' | 'renewal' | 'upgrade'> = {};
        for (const [, userSubs] of Object.entries(userSubMap)) {
            userSubs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
            let lastRank = 0;
            for (let i = 0; i < userSubs.length; i++) {
                const sub = userSubs[i];
                const tier = String(sub.planConfig?.tier || 'BASIC').toUpperCase();
                const currentRank = tierRankMap[tier] ?? 1;
                let classification: 'new' | 'renewal' | 'upgrade' = 'new';
                if (i > 0) {
                    classification = currentRank > lastRank ? 'upgrade' : 'renewal';
                }
                classificationMap[sub.id] = classification;
                lastRank = Math.max(lastRank, currentRank);
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

        // Invalidate cache immediately and schedule trial lifecycle jobs
        await this.invalidateUserPlanCaches(userId);
        await this.scheduleSubscriptionLifecycleJobs(txResult.subId, expiryDate);

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
                await this.cancelScheduledSubscriptionJobs(sub.id);
            }

            await this.invalidateUserPlanCaches(userId);

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
            await this.scheduleSubscriptionLifecycleJobs(activeSub.id, newExpiry);

            await this.invalidateUserPlanCaches(userId);

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
                sub.currentPeriodEnd = now;
                await this.subscriptionRepo.save(sub);
                await this.cancelScheduledSubscriptionJobs(sub.id);
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
            await this.scheduleSubscriptionLifecycleJobs(newSub.id, expiryDate);

            await this.invalidateUserPlanCaches(userId);

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
