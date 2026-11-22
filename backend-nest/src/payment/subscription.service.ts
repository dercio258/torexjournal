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

export const TRIAL_DAYS_BY_TIER = {
    BASIC: 30,
    PRO: 14,
    PREMIUM: 7,
} as const;

export const DEFAULT_USD_TO_MZN_RATE = 74;

export type TrialPlanTier = keyof typeof TRIAL_DAYS_BY_TIER;

@Injectable()
export class SubscriptionService implements OnModuleInit {
    private readonly logger = new Logger(SubscriptionService.name);
    private readonly trialShareIntentMemory = new Map<string, number>();

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
            await this.planConfigRepo.manager.query(`
                DO $$
                BEGIN
                    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscriptions_cycle_enum') THEN
                        IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'QUARTERLY' AND enumtypid = 'subscriptions_cycle_enum'::regtype) THEN
                            ALTER TYPE "subscriptions_cycle_enum" ADD VALUE 'QUARTERLY';
                        END IF;
                        IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'BIENNIAL' AND enumtypid = 'subscriptions_cycle_enum'::regtype) THEN
                            ALTER TYPE "subscriptions_cycle_enum" ADD VALUE 'BIENNIAL';
                        END IF;
                    END IF;
                END
                $$;
            `);
            await this.planConfigRepo.manager.query(`
                ALTER TABLE "subscription_plan_configs"
                    ADD COLUMN IF NOT EXISTS "aiDailyCredits" integer,
                    ADD COLUMN IF NOT EXISTS "annualMonthlyPrice" decimal(10,2),
                    ADD COLUMN IF NOT EXISTS "compareAtPrice" decimal(10,2),
                    ADD COLUMN IF NOT EXISTS "promoDiscountPercent" integer DEFAULT 35,
                    ADD COLUMN IF NOT EXISTS "monthlyPriceMzn" decimal(10,2),
                    ADD COLUMN IF NOT EXISTS "quarterlyPriceMzn" decimal(10,2),
                    ADD COLUMN IF NOT EXISTS "annualPriceMzn" decimal(10,2),
                    ADD COLUMN IF NOT EXISTS "biennialPriceMzn" decimal(10,2),
                    ADD COLUMN IF NOT EXISTS "usdToMznRate" decimal(10,2) DEFAULT 74,
                    ADD COLUMN IF NOT EXISTS "monthlyDiscountPercent" integer DEFAULT 20,
                    ADD COLUMN IF NOT EXISTS "quarterlyDiscountPercent" integer DEFAULT 5,
                    ADD COLUMN IF NOT EXISTS "biennialDiscountPercent" integer DEFAULT 29,
                    ADD COLUMN IF NOT EXISTS "maxTradingAccounts" integer DEFAULT 1,
                    ADD COLUMN IF NOT EXISTS "monthlyBacktestsLimit" integer DEFAULT 0
            `);
        } catch (err: any) {
            this.logger.warn(`SubscriptionPlanConfig DDL check warning: ${err?.message || err}`);
        }
        await this.seedDefaultPlans();
    }

    private computeCyclePricingSnapshot(params: {
        baseMonthlyUsd: number;
        monthlyDiscountPercent: number;
        quarterlyDiscountPercent: number;
        annualDiscountPercent: number;
        biennialDiscountPercent: number;
        usdToMznRate: number;
    }) {
        const rate = params.usdToMznRate > 0 ? params.usdToMznRate : DEFAULT_USD_TO_MZN_RATE;
        const discountedMonthlyUsd = Number(
            (params.baseMonthlyUsd * (1 - params.monthlyDiscountPercent / 100)).toFixed(2),
        );
        const quarterlyPerMonthUsd = Number(
            (params.baseMonthlyUsd * (1 - params.quarterlyDiscountPercent / 100)).toFixed(2),
        );
        const annualMonthlyPrice = Number(
            (params.baseMonthlyUsd * (1 - params.annualDiscountPercent / 100)).toFixed(2),
        );
        const biennialPerMonthUsd = Number(
            (params.baseMonthlyUsd * (1 - params.biennialDiscountPercent / 100)).toFixed(2),
        );

        return {
            annualMonthlyPrice,
            monthlyPriceMzn: Number((discountedMonthlyUsd * rate).toFixed(2)),
            quarterlyPriceMzn: Number((quarterlyPerMonthUsd * 3 * rate).toFixed(2)),
            annualPriceMzn: Number((annualMonthlyPrice * 12 * rate).toFixed(2)),
            biennialPriceMzn: Number((biennialPerMonthUsd * 24 * rate).toFixed(2)),
        };
    }

    async seedDefaultPlans() {
        const defaultConfigs: Array<{
            tier: string;
            description: string;
            features: string[];
            monthlyPrice: number;
            compareAtPrice: number;
            promoDiscountPercent: number;
            monthlyDiscountPercent: number;
            quarterlyDiscountPercent: number;
            annualDiscountPercent: number;
            biennialDiscountPercent: number;
            usdToMznRate: number;
            maxTradingAccounts: number;
            monthlyBacktestsLimit: number;
            aiDailyCredits: number;
        }> = [
            {
                tier: 'BASIC',
                description: 'Para quem está começando no trading',
                features: [
                    '1 Conta de Trading ativa',
                    '0 Créditos AI / mês',
                    'Torex AI',
                    'Diário Automatizado',
                    'Comunidade',
                    'Relatórios operacionais no site (visualizar e baixar)',
                ],
                monthlyPrice: 2.99,
                compareAtPrice: 2.99,
                promoDiscountPercent: 25,
                monthlyDiscountPercent: 20,
                quarterlyDiscountPercent: 5,
                annualDiscountPercent: 25,
                biennialDiscountPercent: 29,
                usdToMznRate: DEFAULT_USD_TO_MZN_RATE,
                maxTradingAccounts: 1,
                monthlyBacktestsLimit: 0,
                aiDailyCredits: 0,
            },
            {
                tier: 'PRO',
                description: 'Para traders ativos e consistentes',
                features: [
                    'Contas de Trading ilimitadas',
                    '1.500 Créditos AI / mês',
                    '10 Sessões de Backtest / mês',
                    'Teste de Estratégias ilimitado',
                    'Trade Replay',
                    'Mentor Mode',
                    'Relatório operacional mensal por e-mail',
                    'Modo Offline (exceto Trade Replay)',
                ],
                monthlyPrice: 19.99,
                compareAtPrice: 19.99,
                promoDiscountPercent: 35,
                monthlyDiscountPercent: 20,
                quarterlyDiscountPercent: 9,
                annualDiscountPercent: 35,
                biennialDiscountPercent: 44,
                usdToMznRate: DEFAULT_USD_TO_MZN_RATE,
                maxTradingAccounts: -1,
                monthlyBacktestsLimit: 10,
                aiDailyCredits: 1500,
            },
            {
                tier: 'PREMIUM',
                description: 'Performance máxima com IA e backtesting intensivo',
                features: [
                    'Contas de Trading ilimitadas',
                    '4.000 Créditos AI / mês',
                    '100 Automated Backtesting Runs / month',
                    'Mentor Mode: unlimited invites',
                    'Relatório operacional semanal por e-mail',
                    'Priority Support',
                    'Modo Offline completo (incluindo Trade Replay)',
                ],
                monthlyPrice: 39.99,
                compareAtPrice: 39.99,
                promoDiscountPercent: 49,
                monthlyDiscountPercent: 20,
                quarterlyDiscountPercent: 19,
                annualDiscountPercent: 49,
                biennialDiscountPercent: 51,
                usdToMznRate: DEFAULT_USD_TO_MZN_RATE,
                maxTradingAccounts: -1,
                monthlyBacktestsLimit: 100,
                aiDailyCredits: 4000,
            },
        ];

        for (const cfg of defaultConfigs) {
            const snap = this.computeCyclePricingSnapshot({
                baseMonthlyUsd: cfg.monthlyPrice,
                monthlyDiscountPercent: cfg.monthlyDiscountPercent,
                quarterlyDiscountPercent: cfg.quarterlyDiscountPercent,
                annualDiscountPercent: cfg.annualDiscountPercent,
                biennialDiscountPercent: cfg.biennialDiscountPercent,
                usdToMznRate: cfg.usdToMznRate,
            });
            const exists = await this.planConfigRepo.findOne({ where: { tier: cfg.tier } });
            if (!exists) {
                this.logger.log(`Seeding missing plan tier: ${cfg.tier} (${cfg.aiDailyCredits} AI credits/month, 1 USD=${cfg.usdToMznRate} MZN)`);
                await this.planConfigRepo.save({
                    tier: cfg.tier,
                    description: cfg.description,
                    features: cfg.features,
                    monthlyPrice: cfg.monthlyPrice,
                    annualMonthlyPrice: snap.annualMonthlyPrice,
                    compareAtPrice: cfg.compareAtPrice,
                    promoDiscountPercent: cfg.promoDiscountPercent,
                    monthlyPriceMzn: snap.monthlyPriceMzn,
                    quarterlyPriceMzn: snap.quarterlyPriceMzn,
                    annualPriceMzn: snap.annualPriceMzn,
                    biennialPriceMzn: snap.biennialPriceMzn,
                    usdToMznRate: cfg.usdToMznRate,
                    monthlyDiscountPercent: cfg.monthlyDiscountPercent,
                    quarterlyDiscountPercent: cfg.quarterlyDiscountPercent,
                    annualDiscountPercent: cfg.annualDiscountPercent,
                    biennialDiscountPercent: cfg.biennialDiscountPercent,
                    maxTradingAccounts: cfg.maxTradingAccounts,
                    monthlyBacktestsLimit: cfg.monthlyBacktestsLimit,
                    trialEnabled: false,
                    trialDays: 0,
                    trialPrice: 0,
                    aiDailyCredits: cfg.aiDailyCredits,
                    isActive: true,
                });
            } else {
                let updated = false;
                if (!exists.isActive) {
                    exists.isActive = true;
                    updated = true;
                }
                const needsMigration =
                    Number(exists.usdToMznRate || 0) !== cfg.usdToMznRate ||
                    Number(exists.monthlyPrice) !== cfg.monthlyPrice ||
                    Number(exists.quarterlyDiscountPercent ?? -1) !== cfg.quarterlyDiscountPercent ||
                    Number(exists.annualDiscountPercent ?? -1) !== cfg.annualDiscountPercent ||
                    Number(exists.biennialDiscountPercent ?? -1) !== cfg.biennialDiscountPercent ||
                    exists.quarterlyPriceMzn === null ||
                    exists.quarterlyPriceMzn === undefined ||
                    exists.annualPriceMzn === null ||
                    exists.annualPriceMzn === undefined ||
                    exists.biennialPriceMzn === null ||
                    exists.biennialPriceMzn === undefined;

                if (needsMigration) {
                    exists.description = cfg.description;
                    exists.features = cfg.features;
                    exists.monthlyPrice = cfg.monthlyPrice;
                    exists.annualMonthlyPrice = snap.annualMonthlyPrice;
                    exists.compareAtPrice = cfg.compareAtPrice;
                    exists.promoDiscountPercent = cfg.promoDiscountPercent;
                    exists.monthlyPriceMzn = snap.monthlyPriceMzn;
                    exists.quarterlyPriceMzn = snap.quarterlyPriceMzn;
                    exists.annualPriceMzn = snap.annualPriceMzn;
                    exists.biennialPriceMzn = snap.biennialPriceMzn;
                    exists.usdToMznRate = cfg.usdToMznRate;
                    exists.monthlyDiscountPercent = cfg.monthlyDiscountPercent;
                    exists.quarterlyDiscountPercent = cfg.quarterlyDiscountPercent;
                    exists.annualDiscountPercent = cfg.annualDiscountPercent;
                    exists.biennialDiscountPercent = cfg.biennialDiscountPercent;
                    exists.maxTradingAccounts = cfg.maxTradingAccounts;
                    exists.monthlyBacktestsLimit = cfg.monthlyBacktestsLimit;
                    exists.aiDailyCredits = cfg.aiDailyCredits;
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
        const plans = await this.planConfigRepo.find({ where: { isActive: true } });
        return plans.map((p) => ({
            id: p.id,
            tier: p.tier,
            description: p.description,
            features: p.features,
            monthlyPrice: Number(p.monthlyPrice),
            annualMonthlyPrice:
                p.annualMonthlyPrice !== null && p.annualMonthlyPrice !== undefined
                    ? Number(p.annualMonthlyPrice)
                    : null,
            compareAtPrice:
                p.compareAtPrice !== null && p.compareAtPrice !== undefined
                    ? Number(p.compareAtPrice)
                    : null,
            promoDiscountPercent: Number(p.promoDiscountPercent ?? 0),
            monthlyDiscountPercent: Number(p.monthlyDiscountPercent ?? 20),
            quarterlyDiscountPercent: Number(p.quarterlyDiscountPercent ?? 5),
            annualDiscountPercent: Number(p.annualDiscountPercent ?? 25),
            biennialDiscountPercent: Number(p.biennialDiscountPercent ?? 29),
            maxTradingAccounts: Number(p.maxTradingAccounts ?? 1),
            monthlyBacktestsLimit: Number(p.monthlyBacktestsLimit ?? 0),
            aiDailyCredits: Number(p.aiDailyCredits ?? 0),
            trialEnabled: Boolean(p.trialEnabled),
            trialDays: Number(p.trialDays ?? 0),
        }));
    }

    async createPlanConfig(data: Partial<SubscriptionPlanConfig>) {
        const newPlan = this.planConfigRepo.create({
            ...data,
            isActive: true, // Default active
        });
        return this.planConfigRepo.save(newPlan);
    }

    // --- Subscription Creation ---

    getUsdToMznRate(config?: SubscriptionPlanConfig): number {
        const envRaw =
            this.configService.get<string | number>('USD_TO_MZN_RATE') ??
            this.configService.get<string | number>('EXCHANGE_RATE_USD_MZN');
        const envParsed = Number(envRaw);
        if (envRaw !== undefined && envRaw !== null && Number.isFinite(envParsed) && envParsed > 0) {
            return envParsed;
        }
        const dbRate = Number(config?.usdToMznRate || 0);
        return Number.isFinite(dbRate) && dbRate > 0 ? dbRate : DEFAULT_USD_TO_MZN_RATE;
    }

    getAmountUsd(config: SubscriptionPlanConfig, cycle: SubscriptionCycle): number {
        const baseMonthly = Number(config.monthlyPrice);
        if (cycle === SubscriptionCycle.MONTHLY) {
            const disc = Math.max(0, Number(config.monthlyDiscountPercent || 0));
            return Number((baseMonthly * (1 - disc / 100)).toFixed(2));
        }
        if (cycle === SubscriptionCycle.QUARTERLY) {
            const disc = Math.max(0, Number(config.quarterlyDiscountPercent || 0));
            const perMo = Number((baseMonthly * (1 - disc / 100)).toFixed(2));
            return Number((perMo * 3).toFixed(2));
        }
        if (cycle === SubscriptionCycle.BIENNIAL) {
            const disc = Math.max(0, Number(config.biennialDiscountPercent || 0));
            const perMo = Number((baseMonthly * (1 - disc / 100)).toFixed(2));
            return Number((perMo * 24).toFixed(2));
        }
        const annualDisc = Math.max(0, Number(config.annualDiscountPercent || 0));
        if (annualDisc > 0) {
            const perMo = Number((baseMonthly * (1 - annualDisc / 100)).toFixed(2));
            return Number((perMo * 12).toFixed(2));
        }
        const explicitAnnualMonthly = Number(config.annualMonthlyPrice || 0);
        if (explicitAnnualMonthly > 0) {
            return Number((explicitAnnualMonthly * 12).toFixed(2));
        }
        return Number((baseMonthly * 12).toFixed(2));
    }

    getAmountMzn(config: SubscriptionPlanConfig, cycle: SubscriptionCycle): number {
        const envRaw =
            this.configService.get<string | number>('USD_TO_MZN_RATE') ??
            this.configService.get<string | number>('EXCHANGE_RATE_USD_MZN');
        const hasEnvRate =
            envRaw !== undefined && envRaw !== null && Number.isFinite(Number(envRaw)) && Number(envRaw) > 0;

        if (!hasEnvRate) {
            const storedByCycle: Record<SubscriptionCycle, number | null | undefined> = {
                [SubscriptionCycle.MONTHLY]: config.monthlyPriceMzn,
                [SubscriptionCycle.QUARTERLY]: config.quarterlyPriceMzn,
                [SubscriptionCycle.YEARLY]: config.annualPriceMzn,
                [SubscriptionCycle.BIENNIAL]: config.biennialPriceMzn,
            };
            const explicitCycleMzn = Number(storedByCycle[cycle] || 0);
            if (explicitCycleMzn > 0) {
                return Number(explicitCycleMzn.toFixed(2));
            }
        }

        const usd = this.getAmountUsd(config, cycle);
        return Number((usd * this.getUsdToMznRate(config)).toFixed(2));
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
        const amount = Number((netUsd * this.getUsdToMznRate(config)).toFixed(2));
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
        const amountMzn = Number((amountUsd * this.getUsdToMznRate(config)).toFixed(2));
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
        if (subscription.cycle === SubscriptionCycle.BIENNIAL) {
            expiry.setFullYear(now.getFullYear() + 2);
        } else if (subscription.cycle === SubscriptionCycle.YEARLY) {
            expiry.setFullYear(now.getFullYear() + 1);
        } else if (subscription.cycle === SubscriptionCycle.QUARTERLY) {
            expiry.setMonth(now.getMonth() + 3);
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
                    cycle:
                        subscription.cycle === SubscriptionCycle.BIENNIAL
                            ? 'Bianual'
                            : subscription.cycle === SubscriptionCycle.YEARLY
                              ? 'Anual'
                              : subscription.cycle === SubscriptionCycle.QUARTERLY
                                ? 'Trimestral'
                                : 'Mensal',
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
            !['trial', 'free_trial', 'referral_credits', 'admin_manual'].includes(
                String(subscription.paymentMethod || '').toLowerCase(),
            ) && Number(subscription.planConfig?.monthlyPrice || 0) > 0;
        if (isNonTrialPaid) {
            await this.referralService
                ?.unlockPendingCreditsOnPaidPlan(subscription.userId)
                .catch(() => {});
            await this.referralService
                ?.processPaidConversion(subscription.userId)
                .catch(() => {});
        }

        const revenue = subscription.planConfig
            ? this.getAmountUsd(subscription.planConfig, subscription.cycle)
            : 0;

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

    async isEligibleForBasicTrial(userId: string): Promise<boolean> {
        if (!userId) return false;
        const user = await this.userRepo.findOne({
            where: { id: userId },
            select: ['id', 'hasUsedTrial', 'isBlocked'],
        });
        if (!user || user.isBlocked || user.hasUsedTrial) {
            return false;
        }
        const existingSubCount = await this.subscriptionRepo.count({
            where: { userId },
        });
        return existingSubCount === 0;
    }

    async recordTrialShareIntent(
        userId: string,
        tier?: string,
        channel?: string,
    ): Promise<{ recorded: boolean; unlockAfterSeconds: number; startedAt: string }> {
        const now = Date.now();
        this.trialShareIntentMemory.set(userId, now);
        try {
            await this.cacheManager?.set?.(
                `trial_share_intent:${userId}`,
                JSON.stringify({ startedAt: now, tier: tier || 'BASIC', channel: channel || 'social' }),
                3600 * 1000,
            );
        } catch {
            // fallback to in-memory map
        }
        return {
            recorded: true,
            unlockAfterSeconds: 30,
            startedAt: new Date(now).toISOString(),
        };
    }

    async activateBasicTrial(userId: string, options?: { verifyShareGate?: boolean }): Promise<{
        success: boolean;
        tier: string;
        trialDays: number;
        expiresAt: Date;
    }> {
        return this.activateTrial(userId, 'BASIC', options);
    }

    async activateTrial(
        userId: string,
        requestedTier: string = 'BASIC',
        options?: { verifyShareGate?: boolean },
    ): Promise<{
        success: boolean;
        tier: string;
        trialDays: number;
        expiresAt: Date;
    }> {
        const normalizedTier = String(requestedTier || 'BASIC').trim().toUpperCase() as TrialPlanTier;
        if (!(normalizedTier in TRIAL_DAYS_BY_TIER)) {
            throw new BadRequestException('Plano inválido para avaliação gratuita.');
        }

        if (options?.verifyShareGate) {
            let startedAt = this.trialShareIntentMemory.get(userId) ?? null;
            if (!startedAt) {
                try {
                    const cached = await this.cacheManager?.get?.<string>(`trial_share_intent:${userId}`);
                    if (cached) {
                        const parsed = JSON.parse(cached);
                        if (parsed?.startedAt) startedAt = Number(parsed.startedAt);
                    }
                } catch {
                    startedAt = null;
                }
            }

            if (!startedAt || !Number.isFinite(startedAt)) {
                throw new BadRequestException({
                    code: 'TRIAL_SHARE_REQUIRED',
                    message: 'Partilhe o seu link de convite com amigos antes de ativar o período gratuito.',
                });
            }

            const elapsedMs = Date.now() - startedAt;
            if (elapsedMs < 28_000) {
                const remainingSeconds = Math.max(1, Math.ceil((30_000 - elapsedMs) / 1000));
                throw new BadRequestException({
                    code: 'TRIAL_SHARE_COOLDOWN',
                    remainingSeconds,
                    message: `Aguarde ${remainingSeconds}s após a partilha para liberar o botão do teste gratuito.`,
                });
            }
        }

        const trialDays = TRIAL_DAYS_BY_TIER[normalizedTier];
        const now = new Date();
        const expiryDate = new Date(now);
        expiryDate.setDate(expiryDate.getDate() + trialDays);

        const txResult = await this.userRepo.manager.transaction(async (manager) => {
            const user = await manager.findOne(UserEntity, {
                where: { id: userId },
                lock: { mode: 'pessimistic_write' },
            });

            if (!user || user.isBlocked) {
                throw new ForbiddenException({
                    code: 'TRIAL_NOT_ELIGIBLE',
                    message: 'Período de avaliação indisponível para esta conta.',
                });
            }

            if (user.hasUsedTrial) {
                throw new ForbiddenException({
                    code: 'TRIAL_NOT_ELIGIBLE',
                    message: 'Esta conta já utilizou o período de avaliação gratuito.',
                });
            }

            const existingSubs = await manager.count(Subscription, {
                where: { userId },
            });
            if (existingSubs > 0) {
                throw new ForbiddenException({
                    code: 'TRIAL_NOT_ELIGIBLE',
                    message: 'Período de avaliação exclusivo para novas contas sem histórico de assinatura.',
                });
            }

            let targetPlan = await manager.findOne(SubscriptionPlanConfig, {
                where: { tier: normalizedTier },
            });
            if (!targetPlan) {
                const defaultsByTier: Record<TrialPlanTier, {
                    description: string;
                    features: string[];
                    monthlyPrice: number;
                    annualMonthlyPrice: number;
                    compareAtPrice: number;
                    promoDiscountPercent: number;
                    monthlyPriceMzn: number | null;
                    quarterlyPriceMzn: number | null;
                    annualPriceMzn: number | null;
                    biennialPriceMzn: number | null;
                    usdToMznRate: number;
                    monthlyDiscountPercent: number;
                    quarterlyDiscountPercent: number;
                    annualDiscountPercent: number;
                    biennialDiscountPercent: number;
                    maxTradingAccounts: number;
                    monthlyBacktestsLimit: number;
                    aiDailyCredits: number;
                }> = {
                    BASIC: {
                        description: 'Para quem está começando no trading',
                        features: [
                            '1 Conta de Trading ativa',
                            '0 Créditos AI / mês',
                            'Torex AI',
                            'Diário Automatizado',
                            'Comunidade',
                            'Relatórios operacionais no site (visualizar e baixar)',
                        ],
                        monthlyPrice: 2.99,
                        annualMonthlyPrice: 2.24,
                        compareAtPrice: 2.99,
                        promoDiscountPercent: 25,
                        monthlyPriceMzn: 176.86,
                        quarterlyPriceMzn: 630.48,
                        annualPriceMzn: 1989.12,
                        biennialPriceMzn: 3765.12,
                        usdToMznRate: DEFAULT_USD_TO_MZN_RATE,
                        monthlyDiscountPercent: 20,
                        quarterlyDiscountPercent: 5,
                        annualDiscountPercent: 25,
                        biennialDiscountPercent: 29,
                        maxTradingAccounts: 1,
                        monthlyBacktestsLimit: 0,
                        aiDailyCredits: 0,
                    },
                    PRO: {
                        description: 'O favorito dos traders consistentes',
                        features: [
                            'Contas de Trading ilimitadas',
                            '1.500 Créditos AI / mês',
                            '10 sessões de Backteste / mês',
                            'Estratégias ilimitadas',
                            'Trade Replay & Mentor Mode',
                            'Relatório operacional mensal por e-mail',
                            'Modo Offline (exceto Trade Replay)',
                        ],
                        monthlyPrice: 19.99,
                        annualMonthlyPrice: 12.99,
                        compareAtPrice: 19.99,
                        promoDiscountPercent: 35,
                        monthlyPriceMzn: 1183.26,
                        quarterlyPriceMzn: 4038.18,
                        annualPriceMzn: 11535.12,
                        biennialPriceMzn: 19873.44,
                        usdToMznRate: DEFAULT_USD_TO_MZN_RATE,
                        monthlyDiscountPercent: 20,
                        quarterlyDiscountPercent: 9,
                        annualDiscountPercent: 35,
                        biennialDiscountPercent: 44,
                        maxTradingAccounts: 999,
                        monthlyBacktestsLimit: 10,
                        aiDailyCredits: 1500,
                    },
                    PREMIUM: {
                        description: 'Performance institucional sem limites',
                        features: [
                            'Contas de Trading ilimitadas',
                            '4.000 Créditos AI / mês',
                            '100 sessões automáticas de Backteste / mês',
                            'Mentor Mode: convites ilimitados',
                            'Relatório operacional semanal por e-mail',
                            'Suporte prioritário',
                            'Modo Offline completo (incluindo Trade Replay)',
                        ],
                        monthlyPrice: 39.99,
                        annualMonthlyPrice: 20.39,
                        compareAtPrice: 39.99,
                        promoDiscountPercent: 49,
                        monthlyPriceMzn: 2367.26,
                        quarterlyPriceMzn: 7190.58,
                        annualPriceMzn: 18106.32,
                        biennialPriceMzn: 34791.84,
                        usdToMznRate: DEFAULT_USD_TO_MZN_RATE,
                        monthlyDiscountPercent: 20,
                        quarterlyDiscountPercent: 19,
                        annualDiscountPercent: 49,
                        biennialDiscountPercent: 51,
                        maxTradingAccounts: 999,
                        monthlyBacktestsLimit: 100,
                        aiDailyCredits: 4000,
                    },
                };
                const cfg = defaultsByTier[normalizedTier];
                targetPlan = await manager.save(
                    SubscriptionPlanConfig,
                    manager.create(SubscriptionPlanConfig, {
                        tier: normalizedTier,
                        ...cfg,
                        trialEnabled: false,
                        trialDays: 0,
                        trialPrice: 0,
                        isActive: true,
                    }),
                );
            }

            const sub = manager.create(Subscription, {
                userId: user.id,
                planConfigId: targetPlan.id,
                planConfig: targetPlan,
                status: SubscriptionStatus.ACTIVE,
                cycle: SubscriptionCycle.MONTHLY,
                paymentMethod: 'TRIAL',
                paymentReference: `TRIAL_${normalizedTier}_${trialDays}D_${Date.now()}_${randomBytes(3).toString('hex').toUpperCase()}`,
                currentPeriodEnd: expiryDate,
            });
            await manager.save(Subscription, sub);

            user.hasUsedTrial = true;
            user.trialUsedAt = now;
            await manager.save(UserEntity, user);

            return {
                subId: sub.id,
                email: user.email,
                userName: user.name || user.username || undefined,
                visitorId: user.visitorId,
                attributionData: user.attributionData,
            };
        });

        await this.invalidateUserPlanCaches(userId);
        this.trialShareIntentMemory.delete(userId);
        await this.cacheManager?.del?.(`trial_share_intent:${userId}`).catch?.(() => {});
        await this.scheduleSubscriptionLifecycleJobs(txResult.subId, expiryDate);

        if (txResult.email) {
            await this.emailProducer
                .enqueue(
                    txResult.email,
                    'TRIAL_WELCOME',
                    {
                        userName: txResult.userName,
                        plan: normalizedTier,
                        days: trialDays,
                        expiryDate: expiryDate.toISOString(),
                    },
                    { jobId: `trial-welcome:${txResult.subId}` },
                )
                .catch(() => {});
        }

        void this.analyticsService?.recordAuthOrBillingConversion({
            eventName: 'trial_start',
            userId,
            email: txResult.email,
            visitorId: txResult.visitorId,
            attributionData: txResult.attributionData,
            metadata: {
                subscriptionId: txResult.subId,
                plan: normalizedTier,
                trialDays,
            },
        });

        return {
            success: true,
            tier: normalizedTier,
            trialDays,
            expiresAt: expiryDate,
        };
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
                    tier: sub.planConfig?.tier || 'BASIC',
                    isTrial: sub.paymentMethod === 'TRIAL',
                    trialEligible: false,
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
                tier: sub.planConfig?.tier || 'BASIC',
                isTrial: sub.paymentMethod === 'TRIAL',
                cycle: sub.cycle,
                currentPeriodEnd: sub.currentPeriodEnd,
                daysLeft,
                expiryDate: sub.currentPeriodEnd,
                showWarning,
                trialEligible: false,
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
                tier: expiredSub.planConfig?.tier || 'BASIC',
                trialEligible: false,
            };
        }

        const trialEligible = await this.isEligibleForBasicTrial(userId);
        return {
            hasActive: false,
            isExpired: false,
            trialEligible,
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
        const existing = await this.planConfigRepo.findOne({ where: { id } });
        if (existing) {
            const merged = { ...existing, ...data };
            const baseMonthly = Number(merged.monthlyPrice || existing.monthlyPrice || 0);
            const rate = Number(merged.usdToMznRate || existing.usdToMznRate || DEFAULT_USD_TO_MZN_RATE);
            const snap = this.computeCyclePricingSnapshot({
                baseMonthlyUsd: baseMonthly,
                monthlyDiscountPercent: Number(merged.monthlyDiscountPercent ?? 20),
                quarterlyDiscountPercent: Number(merged.quarterlyDiscountPercent ?? 0),
                annualDiscountPercent: Number(merged.annualDiscountPercent ?? 0),
                biennialDiscountPercent: Number(merged.biennialDiscountPercent ?? 0),
                usdToMznRate: rate,
            });
            data = {
                ...data,
                usdToMznRate: rate,
                annualMonthlyPrice: data.annualMonthlyPrice ?? snap.annualMonthlyPrice,
                monthlyPriceMzn: data.monthlyPriceMzn ?? snap.monthlyPriceMzn,
                quarterlyPriceMzn: data.quarterlyPriceMzn ?? snap.quarterlyPriceMzn,
                annualPriceMzn: data.annualPriceMzn ?? snap.annualPriceMzn,
                biennialPriceMzn: data.biennialPriceMzn ?? snap.biennialPriceMzn,
            };
        }
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
                    'pc.monthlyDiscountPercent',
                    'pc.quarterlyDiscountPercent',
                    'pc.annualDiscountPercent',
                    'pc.biennialDiscountPercent',
                    'pc.usdToMznRate',
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

        let estimatedMonthlyRevenueMZN = 0;

        for (const sub of activeSubs) {
            if (!sub.planConfig) continue;
            const cycleUsd = this.getAmountUsd(sub.planConfig, sub.cycle);
            const months =
                sub.cycle === SubscriptionCycle.BIENNIAL
                    ? 24
                    : sub.cycle === SubscriptionCycle.YEARLY
                      ? 12
                      : sub.cycle === SubscriptionCycle.QUARTERLY
                        ? 3
                        : 1;
            const subMonthlyRevenueUsd = cycleUsd / months;
            const subMonthlyRevenueMzn = subMonthlyRevenueUsd * this.getUsdToMznRate(sub.planConfig);
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
        this.trialShareIntentMemory.delete(userId);
        await this.cacheManager?.del?.(`trial_share_intent:${userId}`).catch?.(() => {});
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

    async getSubscriptionConversionInsights(days: number = 30) {
        const windowDays = Math.min(365, Math.max(1, Math.round(Number(days) || 30)));
        const now = new Date();
        const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
        const fiveDaysAhead = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);

        const allSubs = await this.subscriptionRepo.find({
            relations: ['planConfig'],
            order: { createdAt: 'DESC' },
        });

        const totalUsers = await this.userRepo.count();
        const trialUsedUsers = await this.userRepo.count({ where: { hasUsedTrial: true } });

        const trialUserSetByTier: Record<TrialPlanTier, Set<string>> = {
            BASIC: new Set<string>(),
            PRO: new Set<string>(),
            PREMIUM: new Set<string>(),
        };
        const paidUsersSet = new Set<string>();
        const userPaidSubCounts = new Map<string, number>();

        let activePaidSubs = 0;
        let activeTrialSubs = 0;
        let expiringSoonPaid = 0;
        let expiringSoonTrial = 0;
        let estimatedMrrUsd = 0;

        for (const sub of allSubs) {
            const tierRaw = String(sub.planConfig?.tier || 'BASIC').trim().toUpperCase();
            const tierKey: TrialPlanTier =
                tierRaw === 'PREMIUM' ? 'PREMIUM' : tierRaw === 'PRO' ? 'PRO' : 'BASIC';
            const isTrial = sub.paymentMethod === 'TRIAL';
            const isPaid = !isTrial && sub.paymentMethod !== 'ADMIN_MANUAL' && sub.status !== SubscriptionStatus.APPROVAL_PENDING;
            const endAt = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
            const isCurrentlyValid = sub.status === SubscriptionStatus.ACTIVE && (!endAt || endAt > now);

            if (isTrial && sub.createdAt && new Date(sub.createdAt) >= since) {
                trialUserSetByTier[tierKey].add(sub.userId);
            }

            if (isPaid) {
                paidUsersSet.add(sub.userId);
                userPaidSubCounts.set(sub.userId, (userPaidSubCounts.get(sub.userId) || 0) + 1);
            }

            if (isCurrentlyValid) {
                if (isTrial) {
                    activeTrialSubs += 1;
                    if (endAt && endAt <= fiveDaysAhead) expiringSoonTrial += 1;
                } else {
                    activePaidSubs += 1;
                    if (endAt && endAt <= fiveDaysAhead) expiringSoonPaid += 1;
                    if (sub.planConfig) {
                        const months =
                            sub.cycle === SubscriptionCycle.BIENNIAL
                                ? 24
                                : sub.cycle === SubscriptionCycle.YEARLY
                                  ? 12
                                  : sub.cycle === SubscriptionCycle.QUARTERLY
                                    ? 3
                                    : 1;
                        const monthlyVal = this.getAmountUsd(sub.planConfig, sub.cycle) / months;
                        if (Number.isFinite(monthlyVal)) estimatedMrrUsd += monthlyVal;
                    }
                }
            }
        }

        const trialBreakdown = (Object.keys(TRIAL_DAYS_BY_TIER) as TrialPlanTier[]).map((tier) => {
            const activatedUsers = trialUserSetByTier[tier];
            let convertedUsers = 0;
            for (const uid of activatedUsers) {
                if (paidUsersSet.has(uid)) convertedUsers += 1;
            }
            const activated = activatedUsers.size;
            return {
                tier,
                trialDays: TRIAL_DAYS_BY_TIER[tier],
                activated,
                convertedToPaid: convertedUsers,
                conversionRatePct: activated > 0 ? Math.round((convertedUsers / activated) * 1000) / 10 : 0,
            };
        });

        const totalTrialsActivated = trialBreakdown.reduce((acc, row) => acc + row.activated, 0);
        const totalTrialsConverted = trialBreakdown.reduce((acc, row) => acc + row.convertedToPaid, 0);
        let recurringRenewedUsers = 0;
        for (const count of userPaidSubCounts.values()) {
            if (count >= 2) recurringRenewedUsers += 1;
        }
        const paidUsersTotal = paidUsersSet.size;

        let pricingModalOpens = 0;
        let renewalModalImpressions = 0;
        let renewalModalClicks = 0;
        let renewalModalDismisses = 0;
        let renewalBannerClicks = 0;
        let headerExpiryClicks = 0;
        let trialStartEvents = 0;
        let checkoutStartEvents = 0;
        let purchaseEvents = 0;
        let lockedFeatureDemand: Array<{ feature: string; clicks: number; uniqueUsers: number }> = [];

        try {
            const aggRows = await this.subscriptionRepo.manager.query(
                `
                SELECT
                    COUNT(*) FILTER (WHERE cta_tag = 'pricing_modal_open' OR cta_tag = 'plan_upgrade_cta' OR cta_tag LIKE 'upgrade_lock_%')::int AS pricing_modal_opens,
                    COUNT(*) FILTER (WHERE cta_tag = 'renewal_modal_impression')::int AS renewal_impressions,
                    COUNT(*) FILTER (WHERE cta_tag = 'renewal_modal_cta_click')::int AS renewal_clicks,
                    COUNT(*) FILTER (WHERE cta_tag = 'renewal_modal_dismiss')::int AS renewal_dismisses,
                    COUNT(*) FILTER (WHERE cta_tag = 'dashboard_renewal_banner_cta')::int AS banner_clicks,
                    COUNT(*) FILTER (WHERE cta_tag = 'header_expiry_pill')::int AS header_clicks,
                    COUNT(*) FILTER (WHERE event_name = 'trial_start')::int AS trial_starts,
                    COUNT(*) FILTER (WHERE event_name = 'checkout_started')::int AS checkout_starts,
                    COUNT(*) FILTER (WHERE event_name = 'purchase')::int AS purchases
                FROM tracking_events
                WHERE created_at >= $1
                `,
                [since.toISOString()],
            );
            const row = aggRows?.[0] || {};
            pricingModalOpens = Number(row.pricing_modal_opens || 0);
            renewalModalImpressions = Number(row.renewal_impressions || 0);
            renewalModalClicks = Number(row.renewal_clicks || 0);
            renewalModalDismisses = Number(row.renewal_dismisses || 0);
            renewalBannerClicks = Number(row.banner_clicks || 0);
            headerExpiryClicks = Number(row.header_clicks || 0);
            trialStartEvents = Number(row.trial_starts || 0);
            checkoutStartEvents = Number(row.checkout_starts || 0);
            purchaseEvents = Number(row.purchases || 0);

            const lockRows = await this.subscriptionRepo.manager.query(
                `
                SELECT
                    REPLACE(cta_tag, 'upgrade_lock_', '') AS feature,
                    COUNT(*)::int AS clicks,
                    COUNT(DISTINCT COALESCE(user_id::text, visitor_id))::int AS unique_users
                FROM tracking_events
                WHERE created_at >= $1
                  AND cta_tag LIKE 'upgrade_lock_%'
                GROUP BY feature
                ORDER BY clicks DESC
                LIMIT 15
                `,
                [since.toISOString()],
            );
            lockedFeatureDemand = (lockRows || []).map((r: any) => ({
                feature: String(r.feature || 'unknown'),
                clicks: Number(r.clicks || 0),
                uniqueUsers: Number(r.unique_users || 0),
            }));
        } catch (err: any) {
            this.logger.warn(`Conversion insights tracking query fallback: ${err?.message || err}`);
        }

        return {
            windowDays,
            generatedAt: now.toISOString(),
            funnel: {
                totalUsers,
                trialUsedUsers,
                activeTrialSubs,
                activePaidSubs,
                estimatedMrrUsd: Math.round(estimatedMrrUsd * 100) / 100,
                totalTrialsActivated,
                totalTrialsConverted,
                trialToPaidRatePct:
                    totalTrialsActivated > 0
                        ? Math.round((totalTrialsConverted / totalTrialsActivated) * 1000) / 10
                        : 0,
                recurringRenewedUsers,
                paidUsersTotal,
                renewalRatePct:
                    paidUsersTotal > 0 ? Math.round((recurringRenewedUsers / paidUsersTotal) * 1000) / 10 : 0,
                expiringSoonTotal: expiringSoonPaid + expiringSoonTrial,
                expiringSoonPaid,
                expiringSoonTrial,
                trialStartEvents,
                checkoutStartEvents,
                purchaseEvents,
            },
            trialBreakdown,
            modalBehavior: {
                pricingModalOpens,
                renewalModalImpressions,
                renewalModalClicks,
                renewalModalDismisses,
                renewalBannerClicks,
                headerExpiryClicks,
                renewalCtrPct:
                    renewalModalImpressions > 0
                        ? Math.round(((renewalModalClicks + renewalBannerClicks) / renewalModalImpressions) * 1000) / 10
                        : 0,
            },
            lockedFeatureDemand,
        };
    }
}
