import {
    Injectable,
    Logger,
    OnModuleInit,
    Inject,
    ForbiddenException,
    BadRequestException,
    NotFoundException,
    Optional,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Not } from 'typeorm';
import { SubscriptionPlanConfig } from './subscription-plan.entity';
import { Subscription, SubscriptionStatus, SubscriptionCycle } from './subscription.entity';
import { CryptoPaymentSession } from './crypto-payment-session.entity';
import { PixPaymentSession } from './pix-payment-session.entity';
import {
    SubscriptionRenewalInvoice,
    RenewalInvoiceStatus,
} from './subscription-renewal-invoice.entity';
import { NowPaymentsService } from './paymentgateways/nowpayment';
import { HubblyService, validateCpfOrCnpj } from './paymentgateways/hubbly';
import {
    DebitoPayCustomerContext,
    DebitoPayService,
    DebitoPayStatusResult,
} from './paymentgateways/debitopay.service';
import { CheckoutGeoResolution } from './checkout-geoip.service';
import { PayRenewalInvoiceDto } from './dto/subscription.dto';
import { AlertsService } from '../alerts/alerts.service';
import { AlertType, AlertSeverity } from '../alerts/alert.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailProducerService } from '../email/email-producer.service';
import { buildAppUrl, resolveFrontendUrl } from '../email/templates/utils';
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
export const DEFAULT_USD_TO_BRL_RATE = 5.80;
export const DEFAULT_USD_TO_ZAR_RATE = 18.20;

export type TrialPlanTier = keyof typeof TRIAL_DAYS_BY_TIER;

export interface CanonicalWorkspacePlanDefault {
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
}

export const CANONICAL_WORKSPACE_PLAN_DEFAULTS: Record<TrialPlanTier, CanonicalWorkspacePlanDefault> = {
    BASIC: {
        description: 'Para quem está começando no trading',
        features: [
            '3 Contas de Trading ativas',
            '100 Créditos AI / mês',
            'Torex AI',
            'Diário Automatizado',
            'Comunidade',
            'Relatórios operacionais completos',
        ],
        monthlyPrice: 2.99,
        compareAtPrice: 2.99,
        promoDiscountPercent: 25,
        monthlyDiscountPercent: 0,
        quarterlyDiscountPercent: 10,
        annualDiscountPercent: 25,
        biennialDiscountPercent: 30,
        usdToMznRate: DEFAULT_USD_TO_MZN_RATE,
        maxTradingAccounts: 3,
        monthlyBacktestsLimit: 0,
        aiDailyCredits: 100,
    },
    PRO: {
        description: 'Para traders ativos e consistentes',
        features: [
            'Contas de Trading ilimitadas',
            '1.500 Créditos AI / mês',
            'AI Coach',
            '10 Sessões de Backteste / mês',
            'Teste de Estratégias ilimitado',
            'Replay de Mercado',
            'Modo Mentor',
            'Relatórios mensais',
            'Modo Offline',
        ],
        monthlyPrice: 19.99,
        compareAtPrice: 19.99,
        promoDiscountPercent: 35,
        monthlyDiscountPercent: 0,
        quarterlyDiscountPercent: 15,
        annualDiscountPercent: 35,
        biennialDiscountPercent: 45,
        usdToMznRate: DEFAULT_USD_TO_MZN_RATE,
        maxTradingAccounts: -1,
        monthlyBacktestsLimit: 10,
        aiDailyCredits: 1500,
    },
    PREMIUM: {
        description: 'Performance máxima com IA e backteste avançado',
        features: [
            'Tudo do Plano Pro',
            '4.000 Créditos AI / mês',
            'AI Coach',
            '100 Sessões de Backteste / mês',
            'Modo Mentor: convites ilimitados',
            'Relatórios semanais',
            'Suporte Prioritário',
            'Modo Offline completo',
        ],
        monthlyPrice: 39.99,
        compareAtPrice: 39.99,
        promoDiscountPercent: 49,
        monthlyDiscountPercent: 0,
        quarterlyDiscountPercent: 20,
        annualDiscountPercent: 49,
        biennialDiscountPercent: 55,
        usdToMznRate: DEFAULT_USD_TO_MZN_RATE,
        maxTradingAccounts: -1,
        monthlyBacktestsLimit: 100,
        aiDailyCredits: 4000,
    },
};

const CANONICAL_TIER_ORDER: TrialPlanTier[] = ['BASIC', 'PRO', 'PREMIUM'];

export function normalizeWorkspacePlanTier(rawTier?: string | null): TrialPlanTier | null {
    const clean = String(rawTier || '').trim().toUpperCase();
    if (clean === 'BASIC' || clean === 'BASICO') return 'BASIC';
    if (clean === 'PRO') return 'PRO';
    if (clean === 'PREMIUM') return 'PREMIUM';
    return null;
}

interface UsdToBrlQuote {
    rate: number;
    source: 'configured' | 'live_market' | 'fallback';
    updatedAt: string;
}

export interface PaymentCheckOutcome {
    found: boolean;
    status: SubscriptionStatus | null;
    reference?: string;
    paymentMethod?: string | null;
    tier?: string | null;
    cycle?: SubscriptionCycle | string | null;
    nextPollAfterMs: number;
    failureReason?: string | null;
    serverCheckedAt: string;
}

export interface PaymentCallbackQueryContext {
    reference?: string;
    method?: string;
    status?: string;
    reason?: string;
    locale?: string;
    renewalToken?: string;
}

type ResolvedStatusCacheEntry = {
    userId: string | null;
    outcome: PaymentCheckOutcome;
};

type CoalescedStatusCheckResult = {
    userId: string | null;
    outcome: PaymentCheckOutcome;
};

const RESOLVED_STATUS_CACHE_TTL_MS = 15_000;
const MANUAL_FORCE_COOLDOWN_MS = 2_000;

@Injectable()
export class SubscriptionService implements OnModuleInit {
    private readonly logger = new Logger(SubscriptionService.name);
    private readonly trialShareIntentMemory = new Map<string, number>();
    private readonly inFlightStatusChecks = new Map<string, Promise<CoalescedStatusCheckResult>>();
    private readonly inFlightDebitoRemoteChecks = new Map<string, Promise<DebitoPayStatusResult | null>>();
    private readonly inFlightCryptoSyncs = new Map<
        string,
        Promise<{ session: CryptoPaymentSession; subscriptionStatus: SubscriptionStatus | null }>
    >();
    private readonly inFlightPixSyncs = new Map<
        string,
        Promise<{ session: PixPaymentSession; subscriptionStatus: SubscriptionStatus | null }>
    >();
    private usdToBrlMemoryCache: { quote: UsdToBrlQuote; expiresAt: number } | null = null;
    private usdToZarMemoryCache: { quote: UsdToBrlQuote; expiresAt: number } | null = null;

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
        @Optional()
        @InjectRepository(CryptoPaymentSession)
        private cryptoSessionRepo?: Repository<CryptoPaymentSession>,
        @Optional() private nowPaymentsService?: NowPaymentsService,
        @Optional()
        @InjectRepository(PixPaymentSession)
        private pixSessionRepo?: Repository<PixPaymentSession>,
        @Optional() private hubblyService?: HubblyService,
        @Optional() private debitoPayService?: DebitoPayService,
        @Optional()
        @InjectRepository(SubscriptionRenewalInvoice)
        private renewalInvoiceRepo?: Repository<SubscriptionRenewalInvoice>,
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
                    ADD COLUMN IF NOT EXISTS "monthlyDiscountPercent" integer DEFAULT 0,
                    ADD COLUMN IF NOT EXISTS "quarterlyDiscountPercent" integer DEFAULT 10,
                    ADD COLUMN IF NOT EXISTS "biennialDiscountPercent" integer DEFAULT 30,
                    ADD COLUMN IF NOT EXISTS "maxTradingAccounts" integer DEFAULT 1,
                    ADD COLUMN IF NOT EXISTS "monthlyBacktestsLimit" integer DEFAULT 0
            `);
            await this.planConfigRepo.manager.query(`
                CREATE TABLE IF NOT EXISTS "crypto_payment_sessions" (
                    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                    "user_id" uuid NOT NULL,
                    "subscription_id" uuid NOT NULL,
                    "payment_reference" character varying(80) NOT NULL,
                    "provider_payment_id" character varying(100) NOT NULL,
                    "tier" character varying(50) NOT NULL,
                    "cycle" character varying(30) NOT NULL,
                    "fiat_amount_usd" numeric(10,2) NOT NULL,
                    "fiat_currency" character varying(10) NOT NULL DEFAULT 'USD',
                    "crypto_currency" character varying(32) NOT NULL,
                    "pay_currency_code" character varying(32) NOT NULL,
                    "display_name" character varying(100) NOT NULL,
                    "network" character varying(100) NOT NULL,
                    "icon_url" character varying(320),
                    "wallet_address" character varying(255) NOT NULL,
                    "payin_extra_id" character varying(120),
                    "crypto_amount" character varying(64) NOT NULL,
                    "actually_paid" character varying(64),
                    "qr_code_data_url" text NOT NULL,
                    "provider_status" character varying(40) NOT NULL DEFAULT 'waiting',
                    "expires_at" TIMESTAMPTZ,
                    "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                    "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                    CONSTRAINT "PK_crypto_payment_sessions" PRIMARY KEY ("id"),
                    CONSTRAINT "UQ_crypto_payment_sessions_reference" UNIQUE ("payment_reference"),
                    CONSTRAINT "UQ_crypto_payment_sessions_provider_id" UNIQUE ("provider_payment_id")
                )
            `);
            await this.planConfigRepo.manager.query(
                `ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "metadata" jsonb`,
            );
            await this.planConfigRepo.manager.query(`
                CREATE TABLE IF NOT EXISTS "pix_payment_sessions" (
                    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                    "user_id" uuid NOT NULL,
                    "subscription_id" uuid NOT NULL,
                    "payment_reference" character varying(80) NOT NULL,
                    "provider_transaction_id" character varying(120) NOT NULL,
                    "tier" character varying(50) NOT NULL,
                    "cycle" character varying(30) NOT NULL,
                    "amount_usd" numeric(10,2) NOT NULL,
                    "usd_to_brl_rate" numeric(10,4) NOT NULL,
                    "amount_brl" numeric(10,2) NOT NULL,
                    "rate_source" character varying(32) NOT NULL DEFAULT 'live_market',
                    "payer_name" character varying(140) NOT NULL,
                    "payer_document_type" character varying(10) NOT NULL,
                    "payer_document_masked" character varying(32) NOT NULL,
                    "emv_code" text NOT NULL,
                    "qr_code_data_url" text NOT NULL,
                    "provider_status" character varying(40) NOT NULL DEFAULT 'pending',
                    "expires_at" TIMESTAMPTZ,
                    "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                    "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                    CONSTRAINT "PK_pix_payment_sessions" PRIMARY KEY ("id"),
                    CONSTRAINT "UQ_pix_payment_sessions_reference" UNIQUE ("payment_reference")
                )
            `);
            await this.planConfigRepo.manager.query(`
                CREATE TABLE IF NOT EXISTS "subscription_renewal_invoices" (
                    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                    "token" character varying(96) NOT NULL,
                    "subscription_id" uuid NOT NULL,
                    "user_id" uuid NOT NULL,
                    "plan_config_id" uuid NOT NULL,
                    "tier" character varying(50) NOT NULL,
                    "cycle" character varying(30) NOT NULL,
                    "amount_usd" numeric(10,2) NOT NULL,
                    "status" character varying(24) NOT NULL DEFAULT 'PENDING',
                    "due_date" TIMESTAMPTZ NOT NULL,
                    "expires_at" TIMESTAMPTZ NOT NULL,
                    "paid_at" TIMESTAMPTZ,
                    "paid_subscription_id" uuid,
                    "payment_method" character varying(40),
                    "payment_reference" character varying(80),
                    "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                    "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                    CONSTRAINT "PK_subscription_renewal_invoices" PRIMARY KEY ("id"),
                    CONSTRAINT "UQ_subscription_renewal_invoices_token" UNIQUE ("token")
                )
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

    private pickCanonicalPlanRow(
        rows: SubscriptionPlanConfig[],
        tier: TrialPlanTier,
        canonicalMonthlyUsd: number,
    ): SubscriptionPlanConfig | null {
        if (rows.length === 0) return null;
        const ranked = [...rows].sort((a, b) => {
            const aExactTier = String(a.tier || '').trim().toUpperCase() === tier ? 0 : 1;
            const bExactTier = String(b.tier || '').trim().toUpperCase() === tier ? 0 : 1;
            if (aExactTier !== bExactTier) return aExactTier - bExactTier;

            const aExactPrice = Math.abs(Number(a.monthlyPrice) - canonicalMonthlyUsd) < 0.05 ? 0 : 1;
            const bExactPrice = Math.abs(Number(b.monthlyPrice) - canonicalMonthlyUsd) < 0.05 ? 0 : 1;
            if (aExactPrice !== bExactPrice) return aExactPrice - bExactPrice;

            const aActive = a.isActive ? 0 : 1;
            const bActive = b.isActive ? 0 : 1;
            if (aActive !== bActive) return aActive - bActive;

            return Number(a.monthlyPrice || 0) - Number(b.monthlyPrice || 0);
        });
        return ranked[0];
    }

    async seedDefaultPlans() {
        const allPlans = await this.planConfigRepo.find({
            order: { createdAt: 'ASC' },
        });
        const groupedByTier = new Map<TrialPlanTier, SubscriptionPlanConfig[]>([
            ['BASIC', []],
            ['PRO', []],
            ['PREMIUM', []],
        ]);

        for (const row of allPlans) {
            const normalizedTier = normalizeWorkspacePlanTier(row.tier);
            if (!normalizedTier) {
                if (row.isActive) {
                    row.isActive = false;
                    await this.planConfigRepo.save(row);
                }
                continue;
            }
            groupedByTier.get(normalizedTier)!.push(row);
        }

        for (const tier of CANONICAL_TIER_ORDER) {
            const cfg = CANONICAL_WORKSPACE_PLAN_DEFAULTS[tier];
            const snap = this.computeCyclePricingSnapshot({
                baseMonthlyUsd: cfg.monthlyPrice,
                monthlyDiscountPercent: cfg.monthlyDiscountPercent,
                quarterlyDiscountPercent: cfg.quarterlyDiscountPercent,
                annualDiscountPercent: cfg.annualDiscountPercent,
                biennialDiscountPercent: cfg.biennialDiscountPercent,
                usdToMznRate: cfg.usdToMznRate,
            });
            const matching = groupedByTier.get(tier) || [];
            const exists = this.pickCanonicalPlanRow(matching, tier, cfg.monthlyPrice);

            // Deactivate legacy duplicates (e.g. $9/$10 BASICO or redundant BASIC rows) without breaking FKs
            for (const dup of matching) {
                if (exists && dup.id !== exists.id && dup.isActive) {
                    dup.isActive = false;
                    await this.planConfigRepo.save(dup);
                }
            }

            if (!exists) {
                this.logger.log(
                    `Seeding missing plan tier: ${tier} (${cfg.aiDailyCredits} AI credits/month, 1 USD=${cfg.usdToMznRate} MZN)`,
                );
                await this.planConfigRepo.save({
                    tier,
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
                const featuresText = (exists.features || []).join(' ');
                const hasLegacyFeatureCopy =
                    featuresText.includes('visualizar e baixar') ||
                    featuresText.includes('exceto Trade Replay') ||
                    featuresText.includes('Automated Backtesting');

                const currentMonthlyDisc = Number(exists.monthlyDiscountPercent ?? 0);
                const currentQuarterlyDisc = Number(exists.quarterlyDiscountPercent ?? 0);
                const currentAnnualDisc = Number(exists.annualDiscountPercent ?? 0);
                const currentBiennialDisc = Number(exists.biennialDiscountPercent ?? 0);
                const hasInvertedDiscounts =
                    currentMonthlyDisc > currentQuarterlyDisc ||
                    currentQuarterlyDisc > currentAnnualDisc ||
                    currentAnnualDisc > currentBiennialDisc;

                const isLegacyBrokenBasic =
                    tier === 'BASIC' &&
                    (Number(exists.monthlyPrice || 0) >= 8 ||
                        Number(exists.maxTradingAccounts ?? 0) < 3 ||
                        Number(exists.aiDailyCredits ?? 0) <= 0);

                const missingCycleSnapshots =
                    exists.quarterlyPriceMzn === null ||
                    exists.quarterlyPriceMzn === undefined ||
                    exists.annualPriceMzn === null ||
                    exists.annualPriceMzn === undefined ||
                    exists.biennialPriceMzn === null ||
                    exists.biennialPriceMzn === undefined;

                if (String(exists.tier || '').trim().toUpperCase() !== tier) {
                    exists.tier = tier;
                    updated = true;
                }

                if (isLegacyBrokenBasic || Number(exists.monthlyPrice || 0) <= 0) {
                    exists.monthlyPrice = cfg.monthlyPrice;
                    exists.compareAtPrice = cfg.compareAtPrice;
                    exists.maxTradingAccounts = cfg.maxTradingAccounts;
                    exists.monthlyBacktestsLimit = cfg.monthlyBacktestsLimit;
                    exists.aiDailyCredits = cfg.aiDailyCredits;
                    updated = true;
                }

                if (hasLegacyFeatureCopy || !Array.isArray(exists.features) || exists.features.length === 0) {
                    exists.description = cfg.description;
                    exists.features = cfg.features;
                    updated = true;
                }

                if (hasInvertedDiscounts) {
                    exists.monthlyDiscountPercent = cfg.monthlyDiscountPercent;
                    exists.quarterlyDiscountPercent = cfg.quarterlyDiscountPercent;
                    exists.annualDiscountPercent = cfg.annualDiscountPercent;
                    exists.biennialDiscountPercent = cfg.biennialDiscountPercent;
                    exists.promoDiscountPercent = cfg.promoDiscountPercent;
                    updated = true;
                }

                if (Number(exists.usdToMznRate || 0) <= 0) {
                    exists.usdToMznRate = cfg.usdToMznRate;
                    updated = true;
                }

                if (updated || missingCycleSnapshots) {
                    const effectiveSnap = this.computeCyclePricingSnapshot({
                        baseMonthlyUsd: Number(exists.monthlyPrice || cfg.monthlyPrice),
                        monthlyDiscountPercent: Number(exists.monthlyDiscountPercent ?? cfg.monthlyDiscountPercent),
                        quarterlyDiscountPercent: Number(exists.quarterlyDiscountPercent ?? cfg.quarterlyDiscountPercent),
                        annualDiscountPercent: Number(exists.annualDiscountPercent ?? cfg.annualDiscountPercent),
                        biennialDiscountPercent: Number(exists.biennialDiscountPercent ?? cfg.biennialDiscountPercent),
                        usdToMznRate: Number(exists.usdToMznRate || cfg.usdToMznRate),
                    });
                    exists.annualMonthlyPrice = effectiveSnap.annualMonthlyPrice;
                    exists.monthlyPriceMzn = effectiveSnap.monthlyPriceMzn;
                    exists.quarterlyPriceMzn = effectiveSnap.quarterlyPriceMzn;
                    exists.annualPriceMzn = effectiveSnap.annualPriceMzn;
                    exists.biennialPriceMzn = effectiveSnap.biennialPriceMzn;
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

    private async findCanonicalPlanConfig(rawTier: string): Promise<SubscriptionPlanConfig | null> {
        const normalized = normalizeWorkspacePlanTier(rawTier);
        const cleanTier = normalized || String(rawTier || '').trim().toUpperCase();
        if (!cleanTier) return null;

        const activeRows = await this.planConfigRepo.find({
            where:
                normalized === 'BASIC'
                    ? [
                          { tier: 'BASIC', isActive: true },
                          { tier: 'BASICO', isActive: true },
                      ]
                    : { tier: cleanTier, isActive: true },
        });

        const pool =
            activeRows.length > 0
                ? activeRows
                : await this.planConfigRepo.find({
                      where:
                          normalized === 'BASIC'
                              ? [{ tier: 'BASIC' }, { tier: 'BASICO' }]
                              : { tier: cleanTier },
                  });

        if (normalized) {
            return this.pickCanonicalPlanRow(
                pool,
                normalized,
                CANONICAL_WORKSPACE_PLAN_DEFAULTS[normalized].monthlyPrice,
            );
        }
        return pool[0] || null;
    }

    async getActivePlans() {
        const plans = await this.planConfigRepo.find({ where: { isActive: true } });
        const byTier = new Map<TrialPlanTier, SubscriptionPlanConfig[]>();

        for (const row of plans) {
            const normalizedTier = normalizeWorkspacePlanTier(row.tier);
            if (!normalizedTier) continue;
            const list = byTier.get(normalizedTier) || [];
            list.push(row);
            byTier.set(normalizedTier, list);
        }

        const deduped: SubscriptionPlanConfig[] = [];
        for (const tier of CANONICAL_TIER_ORDER) {
            const group = byTier.get(tier) || [];
            if (group.length === 0) continue;
            const canonical = this.pickCanonicalPlanRow(
                group,
                tier,
                CANONICAL_WORKSPACE_PLAN_DEFAULTS[tier].monthlyPrice,
            );
            if (canonical) {
                canonical.tier = tier;
                deduped.push(canonical);
            }
        }

        return deduped.map((p) => this.mapPlanForClient(p));
    }

    async createPlanConfig(data: Partial<SubscriptionPlanConfig>) {
        const baseMonthly = Number(data.monthlyPrice || 0);
        const rate = Number(data.usdToMznRate || DEFAULT_USD_TO_MZN_RATE);
        const monthlyDisc = Math.max(0, Math.min(90, Number(data.monthlyDiscountPercent ?? 0)));
        const quarterlyDisc = Math.max(0, Math.min(90, Number(data.quarterlyDiscountPercent ?? 10)));
        const annualDisc = Math.max(0, Math.min(90, Number(data.annualDiscountPercent ?? 25)));
        const biennialDisc = Math.max(0, Math.min(90, Number(data.biennialDiscountPercent ?? 30)));
        const snap = this.computeCyclePricingSnapshot({
            baseMonthlyUsd: baseMonthly,
            monthlyDiscountPercent: monthlyDisc,
            quarterlyDiscountPercent: quarterlyDisc,
            annualDiscountPercent: annualDisc,
            biennialDiscountPercent: biennialDisc,
            usdToMznRate: rate,
        });
        const newPlan = this.planConfigRepo.create({
            ...data,
            monthlyDiscountPercent: monthlyDisc,
            quarterlyDiscountPercent: quarterlyDisc,
            annualDiscountPercent: annualDisc,
            biennialDiscountPercent: biennialDisc,
            usdToMznRate: rate,
            annualMonthlyPrice:
                data.annualMonthlyPrice !== undefined &&
                data.annualMonthlyPrice !== null &&
                Number(data.annualMonthlyPrice) > 0
                    ? Number(data.annualMonthlyPrice)
                    : snap.annualMonthlyPrice,
            monthlyPriceMzn:
                data.monthlyPriceMzn !== undefined &&
                data.monthlyPriceMzn !== null &&
                Number(data.monthlyPriceMzn) > 0
                    ? Number(data.monthlyPriceMzn)
                    : snap.monthlyPriceMzn,
            quarterlyPriceMzn: snap.quarterlyPriceMzn,
            annualPriceMzn: snap.annualPriceMzn,
            biennialPriceMzn: snap.biennialPriceMzn,
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

    private isTerminalSubscriptionStatus(status?: SubscriptionStatus | null): boolean {
        return (
            status === SubscriptionStatus.ACTIVE ||
            status === SubscriptionStatus.APPROVED ||
            status === SubscriptionStatus.CANCELLED ||
            status === SubscriptionStatus.EXPIRED
        );
    }

    computeSmartPollDelayMs(
        paymentMethod?: string | null,
        status?: SubscriptionStatus | null,
        createdAt?: Date | string | null,
    ): number {
        if (this.isTerminalSubscriptionStatus(status)) {
            return 0;
        }
        const elapsedMs = createdAt
            ? Math.max(0, Date.now() - new Date(createdAt).getTime())
            : 0;
        const method = String(paymentMethod || '').trim().toLowerCase();

        if (method === 'mpesa' || method === 'emola') {
            if (elapsedMs < 45_000) return 3500;
            if (elapsedMs < 120_000) return 5500;
            return 9000;
        }
        if (method === 'card' || method === 'payfast') {
            if (elapsedMs < 30_000) return 3000;
            if (elapsedMs < 120_000) return 6000;
            return 10000;
        }
        if (method === 'pix') {
            if (elapsedMs < 45_000) return 4000;
            if (elapsedMs < 180_000) return 8000;
            return 12000;
        }
        if (method === 'crypto') {
            if (elapsedMs < 60_000) return 6000;
            if (elapsedMs < 300_000) return 10000;
            return 15000;
        }
        return 5000;
    }

    classifyWebhookStatus(
        raw?: string | null,
    ): 'success' | 'refunded' | 'expired' | 'failed' | 'pending' | 'unknown' {
        const s = String(raw || '').trim().toLowerCase();
        if (!s) return 'unknown';

        if (
            s === 'payment.completed' ||
            s === 'payment.succeeded' ||
            s === 'payment.paid' ||
            s === 'success' ||
            s === 'successful' ||
            s === 'successfull' ||
            s === 'completed' ||
            s === 'approved' ||
            s === 'paid' ||
            s === 'settled' ||
            s === 'succeeded'
        ) {
            return 'success';
        }
        if (
            s === 'payment.refunded' ||
            s === 'payment.chargeback' ||
            s === 'refunded' ||
            s === 'chargeback'
        ) {
            return 'refunded';
        }
        if (
            s === 'expired' ||
            s === 'timeout' ||
            s === 'timed_out' ||
            s === 'payment.expired'
        ) {
            return 'expired';
        }
        if (
            s === 'payment.failed' ||
            s === 'payment.cancelled' ||
            s === 'payment.canceled' ||
            s === 'failed' ||
            s === 'cancelled' ||
            s === 'canceled' ||
            s === 'rejected' ||
            s === 'declined' ||
            s === 'error'
        ) {
            return 'failed';
        }
        if (
            s === 'pending' ||
            s === 'processing' ||
            s === 'waiting' ||
            s === 'confirming' ||
            s === 'created' ||
            s === 'initiated'
        ) {
            return 'pending';
        }
        return 'unknown';
    }

    private async invalidateResolvedStatusCache(
        ...refs: Array<string | null | undefined>
    ): Promise<void> {
        for (const r of refs) {
            const clean = String(r || '').trim();
            if (clean) {
                await this.cacheManager
                    ?.del?.(`payment_status_resolved:${clean}`)
                    .catch(() => {});
            }
        }
    }

    private async shouldSyncRemoteWithThrottle(
        passiveKey: string,
        passiveCooldownMs: number,
        forceRequested: boolean,
        forceCooldownKey: string,
    ): Promise<boolean> {
        if (forceRequested) {
            try {
                const recentlyForced = await this.cacheManager?.get?.<string>(forceCooldownKey);
                if (recentlyForced) {
                    return false;
                }
                await this.cacheManager
                    ?.set?.(forceCooldownKey, '1', MANUAL_FORCE_COOLDOWN_MS)
                    .catch(() => {});
                await this.cacheManager
                    ?.set?.(passiveKey, '1', passiveCooldownMs)
                    .catch(() => {});
                return true;
            } catch {
                return true;
            }
        }

        try {
            const recentlySynced = await this.cacheManager?.get?.<string>(passiveKey);
            if (recentlySynced) {
                return false;
            }
            await this.cacheManager
                ?.set?.(passiveKey, '1', passiveCooldownMs)
                .catch(() => {});
            return true;
        } catch {
            return true;
        }
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
        customerContext?: DebitoPayCustomerContext,
    ) {
        const config = await this.findCanonicalPlanConfig(tier);

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

            // Dispatch C2B push via Debito Pay Orchestrator (popup flow — NO hosted checkout)
            let externalTransactionId: string | null = null;
            let isImmediateSuccess = false;
            if (this.debitoPayService?.isMethodConfigured(paymentMethod)) {
                const debitoRes =
                    paymentMethod === 'mpesa'
                        ? await this.debitoPayService.processMpesa({
                              reference,
                              amountMzn: amount,
                              phoneNumber,
                              customerContext,
                          })
                        : await this.debitoPayService.processEmola({
                              reference,
                              amountMzn: amount,
                              phoneNumber,
                              customerContext,
                          });

                externalTransactionId = debitoRes.paymentId;
                if (debitoRes.status === 'failed' || debitoRes.status === 'expired') {
                    throw new BadRequestException(
                        debitoRes.message ||
                            `A transação ${paymentMethod.toUpperCase()} não foi autorizada pela operadora.`,
                    );
                }
                if (paymentMethod === 'mpesa' && debitoRes.status === 'success') {
                    isImmediateSuccess = true;
                }
            }

            this.logger.log(`Creating ${paymentMethod} subscription for reference ${reference} (extId=${externalTransactionId || 'none'}).`);

            const sub = this.subscriptionRepo.create({
                userId,
                planConfigId: config.id,
                paymentReference: reference,
                externalTransactionId,
                status: SubscriptionStatus.APPROVAL_PENDING,
                cycle,
                paymentMethod,
            });
            sub.planConfig = config; // Attach config to avoid 500 error in activateSubscription
            await this.subscriptionRepo.save(sub);

            if (isImmediateSuccess) {
                await this.activateSubscription(sub, reference);
                return {
                    success: true,
                    status: 'ACTIVE',
                    reference,
                    paymentId: externalTransactionId,
                    amountUsd: netUsd,
                    currency: 'USD',
                    paymentMethod,
                };
            }

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
                        amount: netUsd,
                        currency: 'USD',
                        method: paymentMethod,
                        reference,
                    },
                    { jobId: `payment-initiated:${sub.id}` },
                );
            }

            try {
                await this.notificationsService.create(
                    userId,
                    {
                        title: 'Pagamento Iniciado',
                        message: `Solicitação de pagamento de $${netUsd.toFixed(2)} USD via ${paymentMethod.toUpperCase()} registrada (Ref. ${reference}).`,
                    },
                    { skipEmail: true },
                );
            } catch {
                // Non-fatal if user has no trading account yet
            }

            return {
                success: true,
                status: 'PENDING',
                reference,
                paymentId: externalTransactionId,
                amountUsd: netUsd,
                amount,
                currency: 'MZN',
                paymentMethod,
            };
        } catch (error) {
            this.logger.error(`Mobile subscription failed: ${error.message}`);
            try {
                await this.notificationsService.create(
                    userId,
                    {
                        title: 'Falha ao Iniciar Pagamento',
                        message: `Não foi possível iniciar a transação via ${paymentMethod.toUpperCase()}: ${error.message}`,
                    },
                    { skipEmail: true },
                );
            } catch {
                // Ignore
            }
            throw error;
        }
    }


    async createCardSubscription(
        userId: string,
        tier: string,
        cycle: SubscriptionCycle,
        returnUrl?: string,
        _cancelUrl?: string,
        phoneNumber?: string,
        useReferralCredits?: boolean,
        customerContext?: DebitoPayCustomerContext,
    ) {
        const config = await this.findCanonicalPlanConfig(tier);

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
            let externalTransactionId: string | null = null;
            let checkoutUrl: string | null = null;

            const safeReturnBase =
                returnUrl && /^https?:\/\//i.test(returnUrl)
                    ? returnUrl
                    : buildAppUrl('/subscription/success');
            const sep = safeReturnBase.includes('?') ? '&' : '?';
            const finalReturnUrl = `${safeReturnBase}${sep}subscription_id=${encodeURIComponent(reference)}&method=card&tier=${encodeURIComponent(config.tier)}&cycle=${encodeURIComponent(cycle)}`;

            if (this.debitoPayService?.isMethodConfigured('visa_mastercard')) {
                const debitoRes = await this.debitoPayService.processVisaMastercard({
                    reference,
                    amountMzn,
                    customerEmail: user.email,
                    customerName: user.name || user.username || 'Cliente TorexJournal',
                    customerPhone: phoneNumber || user.whatsapp || undefined,
                    returnUrl: finalReturnUrl,
                    customerContext,
                });
                externalTransactionId = debitoRes.paymentId;
                checkoutUrl = debitoRes.checkoutUrl;
            }

            this.logger.log(`Creating card subscription for reference ${reference} (extId=${externalTransactionId || 'none'}).`);

            const sub = this.subscriptionRepo.create({
                userId,
                planConfigId: config.id,
                paymentReference: reference,
                externalTransactionId,
                status: SubscriptionStatus.APPROVAL_PENDING,
                cycle,
                paymentMethod: 'card',
            });
            sub.planConfig = config;
            await this.subscriptionRepo.save(sub);

            await this.cacheManager.set(`payment_polling:${reference}`, 'active', 30 * 60 * 1000);

            await this.subscriptionQueue.add('check-pending', {
                subscriptionId: sub.id,
                reference: reference,
                pollType: 'card',
                startTime: Date.now(),
                timeoutMs: 30 * 60 * 1000
            }, { delay: 30000 });

            if (user.email) {
                await this.emailProducer.enqueue(
                    user.email,
                    'PAYMENT_INITIATED',
                    {
                        userName: user.name || undefined,
                        plan: config.tier,
                        amount: amountUsd,
                        currency: 'USD',
                        method: 'Visa / Mastercard',
                        reference,
                    },
                    { jobId: `payment-initiated:${sub.id}` },
                );
            }

            try {
                await this.notificationsService.create(
                    userId,
                    {
                        title: 'Pagamento Iniciado',
                        message: `Solicitação de pagamento de $${amountUsd.toFixed(2)} USD via Visa/Mastercard registrada (Ref. ${reference}).`,
                    },
                    { skipEmail: true },
                );
            } catch {
                // Non-fatal if user has no trading account yet
            }

            return {
                success: true,
                status: 'PENDING',
                reference,
                paymentId: externalTransactionId,
                checkoutUrl,
                amountUsd,
                amountMzn,
                paymentMethod: 'card',
            };
        } catch (error) {
            this.logger.error(`Card subscription failed: ${error.message}`);
            throw error;
        }
    }

    async getUsdToZarQuote(): Promise<UsdToBrlQuote> {
        const envRaw =
            this.configService.get<string | number>('USD_TO_ZAR_RATE') ??
            this.configService.get<string | number>('EXCHANGE_RATE_USD_ZAR');
        const envRate = Number(envRaw);
        if (
            envRaw !== undefined &&
            envRaw !== null &&
            String(envRaw).trim() !== '' &&
            Number.isFinite(envRate) &&
            envRate >= 5 &&
            envRate <= 40
        ) {
            return {
                rate: Number(envRate.toFixed(4)),
                source: 'configured',
                updatedAt: new Date().toISOString(),
            };
        }

        const cacheKey = 'fx:usd_zar:v1';
        try {
            const cachedStr = await this.cacheManager?.get?.<string>(cacheKey);
            if (cachedStr) {
                const parsed = typeof cachedStr === 'string' ? JSON.parse(cachedStr) : cachedStr;
                if (parsed?.rate && Number(parsed.rate) >= 5 && Number(parsed.rate) <= 40) {
                    return parsed as UsdToBrlQuote;
                }
            }
        } catch {
            // Fall through
        }

        if (this.usdToZarMemoryCache && this.usdToZarMemoryCache.expiresAt > Date.now()) {
            return this.usdToZarMemoryCache.quote;
        }

        let marketRate: number | null = null;
        try {
            const res = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 3500 });
            const zar = Number(res.data?.rates?.ZAR);
            if (Number.isFinite(zar) && zar >= 5 && zar <= 40) {
                marketRate = zar;
            }
        } catch {
            // Try fallback
        }

        if (marketRate === null) {
            try {
                const res = await axios.get('https://economia.awesomeapi.com.br/json/last/USD-ZAR', {
                    timeout: 3500,
                });
                const ask = Number(res.data?.USDZAR?.ask || res.data?.USDZAR?.bid);
                if (Number.isFinite(ask) && ask >= 5 && ask <= 40) {
                    marketRate = ask;
                }
            } catch {
                // Use fallback
            }
        }

        // Derive from mznratezar if available in .env and live market unreachable
        let fallbackRate = DEFAULT_USD_TO_ZAR_RATE;
        const mznPerZar = Number(this.configService.get<string | number>('mznratezar') || 0);
        if (Number.isFinite(mznPerZar) && mznPerZar > 1 && mznPerZar < 20) {
            const derived = this.getUsdToMznRate() / mznPerZar;
            if (derived >= 5 && derived <= 40) {
                fallbackRate = derived;
            }
        }

        const quote: UsdToBrlQuote = {
            rate: Number((marketRate ?? fallbackRate).toFixed(4)),
            source: marketRate !== null ? 'live_market' : 'fallback',
            updatedAt: new Date().toISOString(),
        };

        const ttlMs = marketRate !== null ? 15 * 60 * 1000 : 3 * 60 * 1000;
        this.usdToZarMemoryCache = { quote, expiresAt: Date.now() + ttlMs };
        await this.cacheManager?.set?.(cacheKey, JSON.stringify(quote), ttlMs).catch?.(() => {});
        return quote;
    }

    async createPayFastSubscription(
        userId: string,
        tier: string,
        cycle: SubscriptionCycle,
        returnUrl?: string,
        phoneNumber?: string,
        useReferralCredits?: boolean,
        customerContext?: DebitoPayCustomerContext,
    ) {
        const config = await this.findCanonicalPlanConfig(tier);
        if (!config) {
            throw new BadRequestException(`Plano "${tier}" não encontrado ou inativo.`);
        }

        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) {
            throw new NotFoundException('Usuário não encontrado.');
        }

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
        const zarFx = await this.getUsdToZarQuote();
        const amountZar = Math.round(amountUsd * zarFx.rate * 100) / 100;
        const reference = this.generateReference();

        const safeReturnBase =
            returnUrl && /^https?:\/\//i.test(returnUrl)
                ? returnUrl
                : buildAppUrl('/subscription/success');
        const sep = safeReturnBase.includes('?') ? '&' : '?';
        const finalReturnUrl = `${safeReturnBase}${sep}subscription_id=${encodeURIComponent(reference)}&method=payfast&tier=${encodeURIComponent(config.tier)}&cycle=${encodeURIComponent(cycle)}`;

        if (!this.debitoPayService) {
            throw new BadRequestException('PayFast payment service unavailable.');
        }

        const debitoRes = await this.debitoPayService.processPayFast({
            reference,
            amountZar,
            customerEmail: user.email,
            customerName: user.name || user.username || 'TorexJournal Customer',
            customerPhone: phoneNumber || user.whatsapp || undefined,
            returnUrl: finalReturnUrl,
            customerContext,
        });

        const sub = this.subscriptionRepo.create({
            userId,
            planConfigId: config.id,
            paymentReference: reference,
            externalTransactionId: debitoRes.paymentId,
            status: SubscriptionStatus.APPROVAL_PENDING,
            cycle,
            paymentMethod: 'payfast',
        });
        sub.planConfig = config;
        await this.subscriptionRepo.save(sub);

        await this.cacheManager.set(`payment_polling:${reference}`, 'active', 30 * 60 * 1000);
        await this.subscriptionQueue.add(
            'check-pending',
            {
                subscriptionId: sub.id,
                reference,
                pollType: 'payfast',
                startTime: Date.now(),
                timeoutMs: 30 * 60 * 1000,
            },
            { delay: 30000 },
        );

        if (user.email) {
            await this.emailProducer.enqueue(
                user.email,
                'PAYMENT_INITIATED',
                {
                    userName: user.name || undefined,
                    plan: config.tier,
                    amount: amountUsd,
                    currency: 'USD',
                    method: 'PayFast',
                    reference,
                },
                { jobId: `payment-initiated:${sub.id}` },
            );
        }

        try {
            await this.notificationsService.create(
                userId,
                {
                    title: 'Payment Initiated',
                    message: `PayFast payment request of $${amountUsd.toFixed(2)} USD registered (Ref. ${reference}).`,
                },
                { skipEmail: true },
            );
        } catch {
            // Non-fatal
        }

        return {
            success: true,
            status: 'PENDING',
            reference,
            paymentId: debitoRes.paymentId,
            checkoutUrl: debitoRes.checkoutUrl,
            amountUsd,
            paymentMethod: 'payfast',
        };
    }

    private formatCycleLabelPt(cycle: SubscriptionCycle | string): string {
        if (cycle === SubscriptionCycle.BIENNIAL) return 'Bianual';
        if (cycle === SubscriptionCycle.YEARLY) return 'Anual';
        if (cycle === SubscriptionCycle.QUARTERLY) return 'Trimestral';
        return 'Mensal';
    }

    private mapPlanForClient(p: SubscriptionPlanConfig) {
        const normalizedTier = normalizeWorkspacePlanTier(p.tier);
        const defaults = normalizedTier ? CANONICAL_WORKSPACE_PLAN_DEFAULTS[normalizedTier] : null;
        return {
            id: p.id,
            tier: normalizedTier || p.tier,
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
            promoDiscountPercent: Number(p.promoDiscountPercent ?? defaults?.promoDiscountPercent ?? 0),
            monthlyDiscountPercent: Number(p.monthlyDiscountPercent ?? defaults?.monthlyDiscountPercent ?? 0),
            quarterlyDiscountPercent: Number(p.quarterlyDiscountPercent ?? defaults?.quarterlyDiscountPercent ?? 10),
            annualDiscountPercent: Number(p.annualDiscountPercent ?? defaults?.annualDiscountPercent ?? 25),
            biennialDiscountPercent: Number(p.biennialDiscountPercent ?? defaults?.biennialDiscountPercent ?? 30),
            maxTradingAccounts: Number(p.maxTradingAccounts ?? defaults?.maxTradingAccounts ?? (p.tier === 'BASIC' ? 3 : -1)),
            monthlyBacktestsLimit: Number(p.monthlyBacktestsLimit ?? defaults?.monthlyBacktestsLimit ?? 0),
            aiDailyCredits: Number(p.aiDailyCredits ?? defaults?.aiDailyCredits ?? (p.tier === 'BASIC' ? 100 : 0)),
            trialEnabled: Boolean(p.trialEnabled),
            trialDays: Number(p.trialDays ?? 0),
        };
    }

    private buildCryptoSlipUrls(reference: string, walletAddress: string) {
        const sig = this.nowPaymentsService.generateSlipSignature(reference, walletAddress);
        const copyWalletPath = `/pay/crypto/${encodeURIComponent(reference)}?sig=${encodeURIComponent(sig)}&copy=1`;
        const checkoutPath = `/checkout?cryptoRef=${encodeURIComponent(reference)}`;
        return {
            sig,
            copyWalletPath,
            checkoutPath,
            copyWalletUrl: buildAppUrl(copyWalletPath),
            checkoutUrl: buildAppUrl(checkoutPath),
        };
    }

    private serializeCryptoSession(session: CryptoPaymentSession) {
        const urls = this.buildCryptoSlipUrls(session.paymentReference, session.walletAddress);
        return {
            id: session.id,
            reference: session.paymentReference,
            paymentId: session.providerPaymentId,
            tier: session.tier,
            cycle: session.cycle,
            fiatAmountUsd: Number(session.fiatAmountUsd),
            fiatCurrency: session.fiatCurrency || 'USD',
            cryptoCurrency: session.cryptoCurrency,
            payCurrencyCode: session.payCurrencyCode,
            displayName: session.displayName,
            network: session.network,
            iconUrl: session.iconUrl,
            walletAddress: session.walletAddress,
            payinExtraId: session.payinExtraId,
            cryptoAmount: session.cryptoAmount,
            actuallyPaid: session.actuallyPaid,
            qrCodeDataUrl: session.qrCodeDataUrl,
            providerStatus: session.providerStatus,
            expiresAt: session.expiresAt ? session.expiresAt.toISOString() : null,
            createdAt: session.createdAt ? session.createdAt.toISOString() : new Date().toISOString(),
            copyWalletUrl: urls.copyWalletUrl,
            checkoutUrl: urls.checkoutPath,
        };
    }

    async createCryptoSubscription(
        userId: string,
        tier: string,
        cycle: SubscriptionCycle,
        cryptocurrency: string,
        useReferralCredits?: boolean,
        forceNew?: boolean,
    ) {
        const config = await this.findCanonicalPlanConfig(tier);
        if (!config) {
            throw new BadRequestException(`Plano "${tier}" não encontrado ou inativo.`);
        }

        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) {
            throw new NotFoundException('Usuário não encontrado.');
        }

        const cryptoInfo = await this.nowPaymentsService.resolveCryptoAsync(cryptocurrency);
        const baseUsd = this.getAmountUsd(config, cycle);
        let candidateCreditUsd = 0;
        if (useReferralCredits && this.referralService) {
            const available = Math.max(0, Number(user.referralCreditsUsd || 0));
            candidateCreditUsd = Number(Math.min(available, Math.max(0, baseUsd - 1)).toFixed(2));
        }
        const expectedNetUsd = Math.max(0, Number((baseUsd - candidateCreditUsd).toFixed(2)));
        if (expectedNetUsd <= 0) {
            throw new BadRequestException(
                'Seu saldo de créditos cobre 100% do plano. Utilize a opção de ativar com créditos.',
            );
        }

        // Reuse existing unexpired pending session for same user + plan + cycle + coin (prevents spam & keeps wallet/QR stable)
        if (!forceNew) {
            const existing = await this.cryptoSessionRepo.findOne({
                where: {
                    userId,
                    tier: config.tier,
                    cycle,
                    cryptoCurrency: cryptoInfo.symbol,
                    providerStatus: In(['waiting', 'confirming', 'partially_paid']),
                },
                order: { createdAt: 'DESC' },
            });

            if (existing && existing.walletAddress && existing.qrCodeDataUrl) {
                const expMs = existing.expiresAt ? existing.expiresAt.getTime() : 0;
                const stillValid = !expMs || expMs > Date.now() + 2 * 60 * 1000;
                const sameAmount = Math.abs(Number(existing.fiatAmountUsd) - expectedNetUsd) < 0.01;
                if (stillValid && sameAmount) {
                    const synced = await this.syncCryptoPaymentSession(existing, { forceRemote: false });
                    if (
                        synced.subscriptionStatus !== SubscriptionStatus.CANCELLED &&
                        synced.subscriptionStatus !== SubscriptionStatus.EXPIRED &&
                        !this.nowPaymentsService.isFailedOrExpiredStatus(synced.session.providerStatus)
                    ) {
                        return {
                            success: true,
                            reused: true,
                            subscriptionStatus: synced.subscriptionStatus,
                            session: this.serializeCryptoSession(synced.session),
                            plan: this.mapPlanForClient(config),
                        };
                    }
                }
            }
        }

        const reference = this.generateReference();

        // Call NOWPayments BEFORE consuming referral credits so gateway errors never debit user credits
        const npResult = await this.nowPaymentsService.createPayment({
            orderId: reference,
            amountUsd: expectedNetUsd,
            cryptocurrency: cryptoInfo.symbol,
            email: user.email || null,
            description: `Torex Journal ${config.tier} (${this.formatCycleLabelPt(cycle)}) - ${reference}`,
        });

        let appliedCreditUsd = 0;
        if (candidateCreditUsd > 0 && this.referralService) {
            const consumed = await this.referralService.consumeReferralCredits(
                userId,
                candidateCreditUsd,
            );
            if (!consumed) {
                throw new BadRequestException(
                    'Saldo de créditos de afiliado alterado. Atualize a página e tente novamente.',
                );
            }
            appliedCreditUsd = candidateCreditUsd;
        }
        const finalUsd = Math.max(0, Number((baseUsd - appliedCreditUsd).toFixed(2)));

        const parsedExp = npResult.expirationDate
            ? new Date(npResult.expirationDate)
            : npResult.validUntil
              ? new Date(npResult.validUntil)
              : null;
        const expiresAt =
            parsedExp && !Number.isNaN(parsedExp.getTime()) && parsedExp.getTime() > Date.now()
                ? parsedExp
                : new Date(Date.now() + 60 * 60 * 1000);

        const saved = await this.subscriptionRepo.manager.transaction(async (manager) => {
            // Supersede any old unpaid 'waiting' crypto sessions for this user so reload always restores the current one
            const oldWaitingSessions = await manager.find(CryptoPaymentSession, {
                where: {
                    userId,
                    providerStatus: 'waiting',
                },
            });
            for (const oldSess of oldWaitingSessions) {
                oldSess.providerStatus = 'superseded';
                await manager.save(CryptoPaymentSession, oldSess);
                const oldSub = await manager.findOne(Subscription, {
                    where: { id: oldSess.subscriptionId, status: SubscriptionStatus.APPROVAL_PENDING },
                });
                if (oldSub) {
                    oldSub.status = SubscriptionStatus.CANCELLED;
                    await manager.save(Subscription, oldSub);
                }
            }

            const sub = manager.create(Subscription, {
                userId,
                planConfigId: config.id,
                paymentReference: reference,
                externalTransactionId: npResult.paymentId,
                status: SubscriptionStatus.APPROVAL_PENDING,
                cycle,
                paymentMethod: 'crypto',
            });
            sub.planConfig = config;
            const savedSub = await manager.save(Subscription, sub);

            const session = manager.create(CryptoPaymentSession, {
                userId,
                subscriptionId: savedSub.id,
                paymentReference: reference,
                providerPaymentId: npResult.paymentId,
                tier: config.tier,
                cycle,
                fiatAmountUsd: finalUsd,
                fiatCurrency: 'USD',
                cryptoCurrency: npResult.cryptoCurrency,
                payCurrencyCode: npResult.payCurrencyCode,
                displayName: npResult.displayName,
                network: npResult.network,
                iconUrl: npResult.iconUrl,
                walletAddress: npResult.walletAddress,
                payinExtraId: npResult.payinExtraId,
                cryptoAmount: npResult.cryptoAmount,
                actuallyPaid: null,
                qrCodeDataUrl: npResult.qrCodeDataUrl,
                providerStatus: npResult.status || 'waiting',
                expiresAt,
            });
            const savedSession = await manager.save(CryptoPaymentSession, session);
            return { savedSub, savedSession };
        });

        await this.cacheManager.set(`payment_polling:${reference}`, 'active', 65 * 60 * 1000);

        await this.subscriptionQueue.add(
            'check-pending',
            {
                subscriptionId: saved.savedSub.id,
                reference,
                pollType: 'crypto',
                startTime: Date.now(),
                timeoutMs: 65 * 60 * 1000,
            },
            { delay: 20000 },
        );

        const urls = this.buildCryptoSlipUrls(reference, saved.savedSession.walletAddress);

        // 1. Send rich transactional email with embedded QR Code CID + Copy Wallet ID button
        if (user.email) {
            await this.emailProducer.enqueue(
                user.email,
                'CRYPTO_PAYMENT_INITIATED',
                {
                    userName: user.name || user.username || undefined,
                    plan: config.tier,
                    cycle: this.formatCycleLabelPt(cycle),
                    amountUsd: finalUsd,
                    cryptoAmount: saved.savedSession.cryptoAmount,
                    cryptoCurrency: saved.savedSession.cryptoCurrency,
                    displayName: saved.savedSession.displayName,
                    network: saved.savedSession.network,
                    walletAddress: saved.savedSession.walletAddress,
                    payinExtraId: saved.savedSession.payinExtraId,
                    reference,
                    copyWalletUrl: urls.copyWalletUrl,
                    checkoutUrl: urls.checkoutUrl,
                    expiresAt: expiresAt.toISOString(),
                },
                { jobId: `crypto-payment-initiated:${saved.savedSession.id}` },
            );
        }

        // 2. Send in-app notification containing wallet ID & QR code metadata (non-fatal if user has no trading account yet)
        try {
            await this.notificationsService.create(
                userId,
                {
                    title: `Pagamento Cripto Iniciado (${saved.savedSession.cryptoCurrency})`,
                    message: `Envie ${saved.savedSession.cryptoAmount} ${saved.savedSession.cryptoCurrency} (${saved.savedSession.network}) para a carteira ${saved.savedSession.walletAddress}. Ref: ${reference}.`,
                    actionUrl: urls.checkoutPath,
                    actionLabel: 'Abrir QR Code no Checkout',
                    metadata: {
                        kind: 'crypto_payment',
                        reference,
                        paymentId: saved.savedSession.providerPaymentId,
                        walletAddress: saved.savedSession.walletAddress,
                        payinExtraId: saved.savedSession.payinExtraId,
                        cryptoAmount: saved.savedSession.cryptoAmount,
                        cryptoCurrency: saved.savedSession.cryptoCurrency,
                        displayName: saved.savedSession.displayName,
                        network: saved.savedSession.network,
                        fiatAmountUsd: finalUsd,
                        qrCodeDataUrl: saved.savedSession.qrCodeDataUrl,
                        checkoutUrl: urls.checkoutPath,
                        copyWalletUrl: urls.copyWalletPath,
                        expiresAt: expiresAt.toISOString(),
                    },
                },
                { skipEmail: true },
            );
        } catch (notifErr: any) {
            this.logger.warn(
                `In-app notification skipped for crypto payment ${reference} (user=${userId}): ${notifErr?.message || notifErr}`,
            );
        }

        return {
            success: true,
            reused: false,
            subscriptionStatus: saved.savedSub.status,
            session: this.serializeCryptoSession(saved.savedSession),
            plan: this.mapPlanForClient(config),
        };
    }

    async syncCryptoPaymentSession(
        session: CryptoPaymentSession,
        options: { forceRemote?: boolean } = {},
    ): Promise<{ session: CryptoPaymentSession; subscriptionStatus: SubscriptionStatus | null }> {
        const flightKey = `${session.paymentReference}:${options.forceRemote ? 'force' : 'passive'}`;
        const existingFlight = this.inFlightCryptoSyncs.get(flightKey);
        if (existingFlight) {
            return existingFlight;
        }

        const promise = this.executeSyncCryptoPaymentSession(session, options).finally(() => {
            this.inFlightCryptoSyncs.delete(flightKey);
        });
        this.inFlightCryptoSyncs.set(flightKey, promise);
        return promise;
    }

    private async executeSyncCryptoPaymentSession(
        session: CryptoPaymentSession,
        options: { forceRemote?: boolean } = {},
    ): Promise<{ session: CryptoPaymentSession; subscriptionStatus: SubscriptionStatus | null }> {
        const sub = await this.subscriptionRepo.findOne({
            where: { id: session.subscriptionId },
            relations: ['planConfig'],
        });

        if (
            sub &&
            (sub.status === SubscriptionStatus.ACTIVE || sub.status === SubscriptionStatus.APPROVED)
        ) {
            if (!this.nowPaymentsService.isConfirmedPaidStatus(session.providerStatus)) {
                session.providerStatus = 'finished';
                await this.cryptoSessionRepo.save(session);
            }
            return { session, subscriptionStatus: sub.status };
        }

        if (
            session.providerStatus === 'cancelled' ||
            session.providerStatus === 'superseded'
        ) {
            return { session, subscriptionStatus: sub?.status || SubscriptionStatus.CANCELLED };
        }

        const shouldQueryRemote = await this.shouldSyncRemoteWithThrottle(
            `np_status_sync:${session.providerPaymentId}`,
            8000,
            Boolean(options.forceRemote),
            `np_force_cd:${session.providerPaymentId}`,
        );

        if (shouldQueryRemote && this.nowPaymentsService.isConfigured()) {
            try {
                const remote = await this.nowPaymentsService.getPaymentStatus(
                    session.providerPaymentId,
                );

                // Authoritative order_id match check to prevent cross-order spoofing
                if (
                    remote?.order_id &&
                    String(remote.order_id).trim() !== session.paymentReference
                ) {
                    this.logger.error(
                        `CRITICAL SECURITY: NOWPayments order_id mismatch for payment ${session.providerPaymentId}: expected=${session.paymentReference}, got=${remote.order_id}`,
                    );
                    return { session, subscriptionStatus: sub?.status || null };
                }

                const nextStatus = String(
                    remote?.payment_status || session.providerStatus || 'waiting',
                )
                    .trim()
                    .toLowerCase();
                let changed = false;

                if (nextStatus && nextStatus !== session.providerStatus) {
                    session.providerStatus = nextStatus;
                    changed = true;
                }
                if (
                    remote?.actually_paid !== undefined &&
                    remote?.actually_paid !== null &&
                    String(remote.actually_paid) !== session.actuallyPaid
                ) {
                    session.actuallyPaid = String(remote.actually_paid);
                    changed = true;
                }
                if (changed) {
                    await this.cryptoSessionRepo.save(session);
                }

                if (this.nowPaymentsService.isConfirmedPaidStatus(nextStatus) && sub) {
                    const expectedCrypto = Number(remote?.pay_amount || session.cryptoAmount || 0);
                    const paidCrypto =
                        remote?.actually_paid !== undefined && remote?.actually_paid !== null
                            ? Number(remote.actually_paid)
                            : expectedCrypto;

                    if (
                        Number.isFinite(expectedCrypto) &&
                        expectedCrypto > 0 &&
                        Number.isFinite(paidCrypto) &&
                        paidCrypto > 0 &&
                        paidCrypto < expectedCrypto * 0.95
                    ) {
                        this.logger.warn(
                            `Crypto payment ${session.paymentReference} reported ${nextStatus} but underpaid (${paidCrypto} < ${expectedCrypto}). Holding activation.`,
                        );
                        session.providerStatus = 'partially_paid';
                        await this.cryptoSessionRepo.save(session);
                    } else {
                        await this.cacheManager.del(`payment_polling:${session.paymentReference}`).catch(() => {});
                        await this.activateSubscription(sub, session.paymentReference);
                        return { session, subscriptionStatus: SubscriptionStatus.ACTIVE };
                    }
                } else if (
                    this.nowPaymentsService.isFailedOrExpiredStatus(nextStatus) &&
                    sub &&
                    sub.status === SubscriptionStatus.APPROVAL_PENDING
                ) {
                    sub.status = SubscriptionStatus.CANCELLED;
                    await this.subscriptionRepo.save(sub);
                    await this.cacheManager.del(`payment_polling:${session.paymentReference}`).catch(() => {});

                    const user = await this.userRepo.findOne({ where: { id: sub.userId } });
                    if (user?.email) {
                        await this.emailProducer.enqueue(
                            user.email,
                            'PAYMENT_FAILED',
                            {
                                userName: user.name || undefined,
                                plan: sub.planConfig?.tier,
                                reference: session.paymentReference,
                                reason:
                                    nextStatus === 'expired'
                                        ? 'O prazo de pagamento da carteira cripto expirou antes da confirmação na blockchain.'
                                        : `Pagamento cripto finalizado com status: ${nextStatus}.`,
                            },
                            { jobId: `payment-failed:${sub.id}` },
                        );
                    }
                    await this.scheduleRemarketingFollowup(sub.id);
                    return { session, subscriptionStatus: SubscriptionStatus.CANCELLED };
                }
            } catch (err: any) {
                this.logger.warn(
                    `Could not sync NOWPayments status for ${session.paymentReference}: ${err?.message || err}`,
                );
            }
        }

        // Local expiration guard when waiting past expiresAt
        if (
            session.providerStatus === 'waiting' &&
            session.expiresAt &&
            session.expiresAt.getTime() < Date.now() - 2 * 60 * 1000
        ) {
            session.providerStatus = 'expired';
            await this.cryptoSessionRepo.save(session);
            if (sub && sub.status === SubscriptionStatus.APPROVAL_PENDING) {
                sub.status = SubscriptionStatus.CANCELLED;
                await this.subscriptionRepo.save(sub);
            }
            return { session, subscriptionStatus: SubscriptionStatus.CANCELLED };
        }

        return { session, subscriptionStatus: sub?.status || null };
    }

    async getActiveCryptoPayment(userId: string, reference?: string) {
        const cleanRef = reference ? String(reference).trim() : '';
        let session: CryptoPaymentSession | null = null;

        if (cleanRef) {
            session = await this.cryptoSessionRepo.findOne({
                where: { userId, paymentReference: cleanRef },
            });
            if (!session) {
                return { active: false, session: null, plan: null, subscriptionStatus: null };
            }
        } else {
            session = await this.cryptoSessionRepo.findOne({
                where: {
                    userId,
                    providerStatus: In(['waiting', 'confirming', 'partially_paid']),
                },
                order: { createdAt: 'DESC' },
            });
            if (!session) {
                return { active: false, session: null, plan: null, subscriptionStatus: null };
            }
        }

        const synced = await this.syncCryptoPaymentSession(session, { forceRemote: false });
        const planConfig = await this.findCanonicalPlanConfig(synced.session.tier);

        const isTerminalAndImplicit =
            !cleanRef &&
            (synced.session.providerStatus === 'expired' ||
                synced.session.providerStatus === 'failed' ||
                synced.session.providerStatus === 'cancelled' ||
                synced.session.providerStatus === 'superseded');

        if (isTerminalAndImplicit) {
            return {
                active: false,
                session: null,
                plan: planConfig ? this.mapPlanForClient(planConfig) : null,
                subscriptionStatus: synced.subscriptionStatus,
            };
        }

        return {
            active: true,
            subscriptionStatus: synced.subscriptionStatus,
            nextPollAfterMs: this.computeSmartPollDelayMs(
                'crypto',
                synced.subscriptionStatus,
                synced.session.createdAt,
            ),
            session: this.serializeCryptoSession(synced.session),
            plan: planConfig ? this.mapPlanForClient(planConfig) : null,
        };
    }

    async cancelPendingCryptoPayment(userId: string, reference: string) {
        const cleanRef = String(reference || '').trim();
        const session = await this.cryptoSessionRepo.findOne({
            where: { userId, paymentReference: cleanRef },
        });
        if (!session) {
            throw new NotFoundException('Sessão de pagamento cripto não encontrada.');
        }

        if (this.nowPaymentsService.isConfirmedPaidStatus(session.providerStatus)) {
            throw new BadRequestException('Este pagamento já foi confirmado e não pode ser cancelado.');
        }

        const sub = await this.subscriptionRepo.findOne({ where: { id: session.subscriptionId } });
        if (sub && sub.status === SubscriptionStatus.ACTIVE) {
            throw new BadRequestException('Esta assinatura já está ativa.');
        }

        session.providerStatus = 'cancelled';
        await this.cryptoSessionRepo.save(session);

        if (sub && sub.status === SubscriptionStatus.APPROVAL_PENDING) {
            sub.status = SubscriptionStatus.CANCELLED;
            await this.subscriptionRepo.save(sub);
        }
        await this.cacheManager.del(`payment_polling:${cleanRef}`).catch(() => {});

        return { success: true, reference: cleanRef, status: 'cancelled' };
    }

    async getPublicCryptoPaymentSlip(reference: string, sig: string) {
        const cleanRef = String(reference || '').trim();
        if (!cleanRef || !sig) {
            throw new ForbiddenException('Link de pagamento cripto inválido ou expirado.');
        }

        const session = await this.cryptoSessionRepo.findOne({
            where: { paymentReference: cleanRef },
        });
        if (!session) {
            throw new NotFoundException('Pagamento cripto não encontrado.');
        }

        if (!this.nowPaymentsService.verifySlipSignature(cleanRef, session.walletAddress, sig)) {
            throw new ForbiddenException('Assinatura de verificação do link inválida.');
        }

        const synced = await this.syncCryptoPaymentSession(session, { forceRemote: false });

        return {
            reference: synced.session.paymentReference,
            tier: synced.session.tier,
            cycle: synced.session.cycle,
            fiatAmountUsd: Number(synced.session.fiatAmountUsd),
            fiatCurrency: synced.session.fiatCurrency || 'USD',
            cryptoAmount: synced.session.cryptoAmount,
            cryptoCurrency: synced.session.cryptoCurrency,
            displayName: synced.session.displayName,
            network: synced.session.network,
            iconUrl: synced.session.iconUrl,
            walletAddress: synced.session.walletAddress,
            payinExtraId: synced.session.payinExtraId,
            qrCodeDataUrl: synced.session.qrCodeDataUrl,
            providerStatus: synced.session.providerStatus,
            subscriptionStatus: synced.subscriptionStatus,
            expiresAt: synced.session.expiresAt ? synced.session.expiresAt.toISOString() : null,
        };
    }

    async processNowPaymentsWebhook(payload: Record<string, any>) {
        const paymentId = payload?.payment_id ? String(payload.payment_id).trim() : '';
        const orderId = payload?.order_id ? String(payload.order_id).trim() : '';

        if (!paymentId && !orderId) {
            this.logger.warn('NOWPayments IPN received without payment_id or order_id.');
            return;
        }

        const session = await this.cryptoSessionRepo.findOne({
            where: [
                ...(paymentId ? [{ providerPaymentId: paymentId }] : []),
                ...(orderId ? [{ paymentReference: orderId }] : []),
            ],
        });

        if (!session) {
            this.logger.warn(
                `CryptoPaymentSession not found for NOWPayments IPN (payment_id=${paymentId}, order_id=${orderId}).`,
            );
            return;
        }

        // Defense-in-depth: always confirm status directly with NOWPayments API before changing subscription state
        await this.syncCryptoPaymentSession(session, { forceRemote: true });
    }

    // =========================================================================
    // PIX (HUBBLY v2) — Authoritative USD -> BRL Conversion & Payment Lifecycle
    // =========================================================================

    async getUsdToBrlQuote(): Promise<UsdToBrlQuote> {
        const rawSpread = Number(this.configService.get<string | number>('PIX_FX_SPREAD_PERCENT') ?? 0);
        const spreadMultiplier =
            Number.isFinite(rawSpread) && rawSpread >= 0 && rawSpread <= 15
                ? 1 + rawSpread / 100
                : 1;

        // 1. Explicit deterministic env override (if admin sets USD_TO_BRL_RATE)
        const envRaw =
            this.configService.get<string | number>('USD_TO_BRL_RATE') ??
            this.configService.get<string | number>('EXCHANGE_RATE_USD_BRL');
        const envRate = Number(envRaw);
        if (envRaw !== undefined && envRaw !== null && String(envRaw).trim() !== '' && Number.isFinite(envRate) && envRate >= 2 && envRate <= 15) {
            return {
                rate: Number((envRate * spreadMultiplier).toFixed(4)),
                source: 'configured',
                updatedAt: new Date().toISOString(),
            };
        }

        // 2. Redis / in-memory shared cache (15 min TTL guarantees zero discrepancy between checkout preview & charge)
        const cacheKey = 'fx:usd_brl:v1';
        try {
            const cachedStr = await this.cacheManager?.get?.<string>(cacheKey);
            if (cachedStr) {
                const parsed = typeof cachedStr === 'string' ? JSON.parse(cachedStr) : cachedStr;
                if (parsed?.rate && Number(parsed.rate) >= 2 && Number(parsed.rate) <= 15) {
                    return parsed as UsdToBrlQuote;
                }
            }
        } catch {
            // Fall through to memory cache / live fetch
        }

        if (this.usdToBrlMemoryCache && this.usdToBrlMemoryCache.expiresAt > Date.now()) {
            return this.usdToBrlMemoryCache.quote;
        }

        // 3. Real-time fair commercial FX lookup (AwesomeAPI -> Open ER-API -> safe fallback)
        let marketRate: number | null = null;
        try {
            const res = await axios.get('https://economia.awesomeapi.com.br/json/last/USD-BRL', {
                timeout: 3500,
            });
            const ask = Number(res.data?.USDBRL?.ask || res.data?.USDBRL?.bid);
            if (Number.isFinite(ask) && ask >= 2 && ask <= 15) {
                marketRate = ask;
            }
        } catch {
            // Try secondary provider
        }

        if (marketRate === null) {
            try {
                const res = await axios.get('https://open.er-api.com/v6/latest/USD', {
                    timeout: 3500,
                });
                const brl = Number(res.data?.rates?.BRL);
                if (Number.isFinite(brl) && brl >= 2 && brl <= 15) {
                    marketRate = brl;
                }
            } catch {
                // Fall back cleanly
            }
        }

        const effectiveRate = Number(
            ((marketRate ?? DEFAULT_USD_TO_BRL_RATE) * spreadMultiplier).toFixed(4),
        );
        const quote: UsdToBrlQuote = {
            rate: effectiveRate,
            source: marketRate !== null ? 'live_market' : 'fallback',
            updatedAt: new Date().toISOString(),
        };

        const ttlMs = marketRate !== null ? 15 * 60 * 1000 : 3 * 60 * 1000;
        this.usdToBrlMemoryCache = { quote, expiresAt: Date.now() + ttlMs };
        await this.cacheManager?.set?.(cacheKey, JSON.stringify(quote), ttlMs).catch?.(() => {});

        return quote;
    }

    private async computeAuthoritativePixPricing(
        userId: string,
        config: SubscriptionPlanConfig,
        cycle: SubscriptionCycle,
        useReferralCredits?: boolean,
    ) {
        const baseUsd = this.getAmountUsd(config, cycle);
        let candidateCreditUsd = 0;
        if (useReferralCredits && this.referralService) {
            const userRow = await this.userRepo.findOne({
                where: { id: userId },
                select: ['id', 'referralCreditsUsd'],
            });
            const available = Math.max(0, Number(userRow?.referralCreditsUsd || 0));
            candidateCreditUsd = Number(Math.min(available, Math.max(0, baseUsd - 0.5)).toFixed(2));
        }
        const netUsd = Number(Math.max(0, baseUsd - candidateCreditUsd).toFixed(2));
        const fx = await this.getUsdToBrlQuote();
        // Exact centavo rounding using integer math to eliminate floating-point drift
        const amountBrl = Math.round(netUsd * fx.rate * 100) / 100;

        return {
            baseUsd,
            candidateCreditUsd,
            netUsd,
            usdToBrlRate: fx.rate,
            amountBrl,
            rateSource: fx.source,
            rateUpdatedAt: fx.updatedAt,
        };
    }

    async getPixQuote(
        userId: string,
        tier: string,
        cycle: SubscriptionCycle,
        useReferralCredits?: boolean,
    ) {
        const config = await this.findCanonicalPlanConfig(tier);
        if (!config) {
            throw new BadRequestException(`Plano "${tier}" não encontrado ou inativo.`);
        }

        const pricing = await this.computeAuthoritativePixPricing(
            userId,
            config,
            cycle,
            useReferralCredits,
        );

        return {
            tier: config.tier,
            cycle,
            baseUsd: pricing.baseUsd,
            appliedCreditUsd: pricing.candidateCreditUsd,
            netUsd: pricing.netUsd,
            usdToBrlRate: pricing.usdToBrlRate,
            amountBrl: pricing.amountBrl,
            rateSource: pricing.rateSource,
            rateUpdatedAt: pricing.rateUpdatedAt,
            pixEnabled: Boolean(this.hubblyService?.isConfigured()),
        };
    }

    private serializePixSession(session: PixPaymentSession) {
        return {
            id: session.id,
            reference: session.paymentReference,
            transactionId: session.providerTransactionId,
            tier: session.tier,
            cycle: session.cycle,
            amountUsd: Number(session.amountUsd),
            payerName: session.payerName,
            payerDocumentType: session.payerDocumentType,
            payerDocumentMasked: session.payerDocumentMasked,
            emvCode: session.emvCode,
            qrCodeDataUrl: session.qrCodeDataUrl,
            providerStatus: session.providerStatus,
            expiresAt: session.expiresAt ? session.expiresAt.toISOString() : null,
            createdAt: session.createdAt ? session.createdAt.toISOString() : new Date().toISOString(),
        };
    }

    async createPixSubscription(
        userId: string,
        tier: string,
        cycle: SubscriptionCycle,
        payerDocument: string,
        payerName?: string,
        useReferralCredits?: boolean,
        forceNew?: boolean,
    ) {
        if (!this.hubblyService || !this.pixSessionRepo) {
            throw new BadRequestException('Serviço de pagamento PIX indisponível no momento.');
        }

        const docCheck = validateCpfOrCnpj(payerDocument);
        if (!docCheck.valid || !docCheck.type) {
            throw new BadRequestException(
                'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido para pagar com PIX.',
            );
        }

        const config = await this.findCanonicalPlanConfig(tier);
        if (!config) {
            throw new BadRequestException(`Plano "${tier}" não encontrado ou inativo.`);
        }

        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) {
            throw new NotFoundException('Usuário não encontrado.');
        }

        const resolvedPayerName = String(
            payerName?.trim() || user.name || user.username || 'Cliente Torex',
        ).slice(0, 140);

        const pricing = await this.computeAuthoritativePixPricing(
            userId,
            config,
            cycle,
            useReferralCredits,
        );
        if (pricing.netUsd <= 0 || pricing.amountBrl < 1) {
            throw new BadRequestException(
                'O valor líquido está abaixo do mínimo para PIX (R$ 1,00). Utilize créditos de afiliado caso cubram 100% do plano.',
            );
        }

        // Reuse existing unexpired active PIX session for same user + plan + cycle + masked document
        if (!forceNew) {
            const existing = await this.pixSessionRepo.findOne({
                where: {
                    userId,
                    tier: config.tier,
                    cycle,
                    payerDocumentMasked: docCheck.masked,
                    providerStatus: In(['pending', 'waiting', 'created']),
                },
                order: { createdAt: 'DESC' },
            });
            if (existing) {
                const expMs = existing.expiresAt ? existing.expiresAt.getTime() : 0;
                const stillValid = !expMs || expMs > Date.now() + 2 * 60 * 1000;
                const sameAmount = Math.abs(Number(existing.amountBrl) - pricing.amountBrl) < 0.02;
                if (stillValid && sameAmount) {
                    const synced = await this.syncPixPaymentSession(existing, { forceRemote: false });
                    if (
                        synced.subscriptionStatus !== SubscriptionStatus.CANCELLED &&
                        synced.subscriptionStatus !== SubscriptionStatus.EXPIRED &&
                        !this.hubblyService.isFailedOrExpiredStatus(synced.session.providerStatus)
                    ) {
                        return {
                            success: true,
                            reused: true,
                            subscriptionStatus: synced.subscriptionStatus,
                            session: this.serializePixSession(synced.session),
                            plan: this.mapPlanForClient(config),
                        };
                    }
                }
            }
        }

        const reference = this.generateReference();

        const hubblyRes = await this.hubblyService.createTransaction({
            amountBrl: pricing.amountBrl,
            description: `Torex Journal ${config.tier} (${this.formatCycleLabelPt(cycle)}) - ${reference}`,
            reference,
            payerName: resolvedPayerName,
            payerDocument: docCheck.digits,
        });

        if (pricing.candidateCreditUsd > 0 && this.referralService) {
            const consumed = await this.referralService.consumeReferralCredits(
                userId,
                pricing.candidateCreditUsd,
            );
            if (!consumed) {
                throw new BadRequestException(
                    'Saldo de créditos de afiliado alterado. Atualize a página e tente novamente.',
                );
            }
        }

        const parsedExp = hubblyRes.expiresAt ? new Date(hubblyRes.expiresAt) : null;
        const expiresAt =
            parsedExp && !Number.isNaN(parsedExp.getTime()) && parsedExp.getTime() > Date.now()
                ? parsedExp
                : new Date(Date.now() + 30 * 60 * 1000);

        const saved = await this.subscriptionRepo.manager.transaction(async (manager) => {
            const oldPending = await manager.find(PixPaymentSession, {
                where: {
                    userId,
                    providerStatus: In(['pending', 'waiting', 'created']),
                },
            });
            for (const oldSess of oldPending) {
                oldSess.providerStatus = 'superseded';
                await manager.save(PixPaymentSession, oldSess);
                const oldSub = await manager.findOne(Subscription, {
                    where: { id: oldSess.subscriptionId, status: SubscriptionStatus.APPROVAL_PENDING },
                });
                if (oldSub) {
                    oldSub.status = SubscriptionStatus.CANCELLED;
                    await manager.save(Subscription, oldSub);
                }
            }

            const sub = manager.create(Subscription, {
                userId,
                planConfigId: config.id,
                paymentReference: reference,
                externalTransactionId: hubblyRes.transactionId,
                status: SubscriptionStatus.APPROVAL_PENDING,
                cycle,
                paymentMethod: 'pix',
            });
            sub.planConfig = config;
            const savedSub = await manager.save(Subscription, sub);

            const session = manager.create(PixPaymentSession, {
                userId,
                subscriptionId: savedSub.id,
                paymentReference: reference,
                providerTransactionId: hubblyRes.transactionId,
                tier: config.tier,
                cycle,
                amountUsd: pricing.netUsd,
                usdToBrlRate: pricing.usdToBrlRate,
                amountBrl: pricing.amountBrl,
                rateSource: pricing.rateSource,
                payerName: resolvedPayerName,
                payerDocumentType: docCheck.type,
                payerDocumentMasked: docCheck.masked,
                emvCode: hubblyRes.emvCode,
                qrCodeDataUrl: hubblyRes.qrCodeDataUrl,
                providerStatus: hubblyRes.status || 'pending',
                expiresAt,
            });
            const savedSession = await manager.save(PixPaymentSession, session);
            return { savedSub, savedSession };
        });

        await this.cacheManager.set(`payment_polling:${reference}`, 'active', 35 * 60 * 1000);

        await this.subscriptionQueue.add(
            'check-pending',
            {
                subscriptionId: saved.savedSub.id,
                reference,
                pollType: 'pix',
                startTime: Date.now(),
                timeoutMs: 35 * 60 * 1000,
            },
            { delay: 15000 },
        );

        if (user.email) {
            await this.emailProducer.enqueue(
                user.email,
                'PAYMENT_INITIATED',
                {
                    userName: user.name || user.username || undefined,
                    plan: config.tier,
                    amount: pricing.amountBrl,
                    currency: 'BRL',
                    method: 'PIX',
                    reference,
                },
                { jobId: `pix-payment-initiated:${saved.savedSession.id}` },
            );
        }

        try {
            await this.notificationsService.create(
                userId,
                {
                    title: 'Pagamento PIX Gerado',
                    message: `QR Code PIX de $${pricing.netUsd.toFixed(2)} USD gerado. Ref: ${reference}.`,
                    actionUrl: `/checkout?pixRef=${encodeURIComponent(reference)}`,
                    actionLabel: 'Abrir QR Code PIX',
                    metadata: {
                        kind: 'pix_payment',
                        reference,
                        amountUsd: pricing.netUsd,
                        emvCode: saved.savedSession.emvCode,
                        qrCodeDataUrl: saved.savedSession.qrCodeDataUrl,
                        checkoutUrl: `/checkout?pixRef=${encodeURIComponent(reference)}`,
                        expiresAt: expiresAt.toISOString(),
                    },
                },
                { skipEmail: true },
            );
        } catch (notifErr: any) {
            this.logger.warn(
                `In-app notification skipped for PIX payment ${reference} (user=${userId}): ${notifErr?.message || notifErr}`,
            );
        }

        return {
            success: true,
            reused: false,
            subscriptionStatus: saved.savedSub.status,
            session: this.serializePixSession(saved.savedSession),
            plan: this.mapPlanForClient(config),
        };
    }

    async syncPixPaymentSession(
        session: PixPaymentSession,
        options: { forceRemote?: boolean } = {},
    ): Promise<{ session: PixPaymentSession; subscriptionStatus: SubscriptionStatus | null }> {
        const flightKey = `${session.paymentReference}:${options.forceRemote ? 'force' : 'passive'}`;
        const existingFlight = this.inFlightPixSyncs.get(flightKey);
        if (existingFlight) {
            return existingFlight;
        }

        const promise = this.executeSyncPixPaymentSession(session, options).finally(() => {
            this.inFlightPixSyncs.delete(flightKey);
        });
        this.inFlightPixSyncs.set(flightKey, promise);
        return promise;
    }

    private async executeSyncPixPaymentSession(
        session: PixPaymentSession,
        options: { forceRemote?: boolean } = {},
    ): Promise<{ session: PixPaymentSession; subscriptionStatus: SubscriptionStatus | null }> {
        const sub = await this.subscriptionRepo.findOne({
            where: { id: session.subscriptionId },
            relations: ['planConfig'],
        });

        if (
            sub &&
            (sub.status === SubscriptionStatus.ACTIVE || sub.status === SubscriptionStatus.APPROVED)
        ) {
            if (!this.hubblyService?.isPaidStatus(session.providerStatus)) {
                session.providerStatus = 'paid';
                await this.pixSessionRepo?.save(session);
            }
            return { session, subscriptionStatus: sub.status };
        }

        if (session.providerStatus === 'cancelled' || session.providerStatus === 'superseded') {
            return { session, subscriptionStatus: sub?.status || SubscriptionStatus.CANCELLED };
        }

        const shouldQueryRemote = await this.shouldSyncRemoteWithThrottle(
            `hubbly_status_sync:${session.paymentReference}`,
            6000,
            Boolean(options.forceRemote),
            `hubbly_force_cd:${session.paymentReference}`,
        );

        if (shouldQueryRemote && this.hubblyService?.isConfigured()) {
            try {
                const remote = await this.hubblyService.getTransactionByExternalId(
                    session.paymentReference,
                );
                if (remote) {
                    const remoteExternalId = String(
                        remote.externalId || remote.external_id || remote.reference || '',
                    ).trim();
                    if (remoteExternalId && remoteExternalId !== session.paymentReference) {
                        this.logger.error(
                            `CRITICAL SECURITY: Hubbly externalId mismatch: expected=${session.paymentReference}, got=${remoteExternalId}`,
                        );
                        return { session, subscriptionStatus: sub?.status || null };
                    }

                    const nextStatus = String(remote.status || session.providerStatus || 'pending')
                        .trim()
                        .toLowerCase();
                    if (nextStatus && nextStatus !== session.providerStatus) {
                        session.providerStatus = nextStatus;
                        await this.pixSessionRepo?.save(session);
                    }

                    if (this.hubblyService.isPaidStatus(nextStatus) && sub) {
                        const remoteAmount = Number(remote.amount ?? remote.paidAmount ?? session.amountBrl);
                        const expectedAmount = Number(session.amountBrl);
                        if (
                            Number.isFinite(remoteAmount) &&
                            remoteAmount > 0 &&
                            remoteAmount < expectedAmount - 0.05
                        ) {
                            this.logger.warn(
                                `PIX payment ${session.paymentReference} reported paid but amount ${remoteAmount} BRL < expected ${expectedAmount} BRL. Holding activation.`,
                            );
                        } else {
                            await this.cacheManager
                                .del(`payment_polling:${session.paymentReference}`)
                                .catch(() => {});
                            await this.activateSubscription(sub, session.paymentReference);
                            return { session, subscriptionStatus: SubscriptionStatus.ACTIVE };
                        }
                    } else if (
                        this.hubblyService.isFailedOrExpiredStatus(nextStatus) &&
                        sub &&
                        sub.status === SubscriptionStatus.APPROVAL_PENDING
                    ) {
                        sub.status = SubscriptionStatus.CANCELLED;
                        await this.subscriptionRepo.save(sub);
                        await this.cacheManager
                            .del(`payment_polling:${session.paymentReference}`)
                            .catch(() => {});
                        await this.scheduleRemarketingFollowup(sub.id);
                        return { session, subscriptionStatus: SubscriptionStatus.CANCELLED };
                    }
                }
            } catch (err: any) {
                this.logger.warn(
                    `Could not sync Hubbly PIX status for ${session.paymentReference}: ${err?.message || err}`,
                );
            }
        }

        if (
            ['pending', 'waiting', 'created'].includes((session.providerStatus || '').toLowerCase()) &&
            session.expiresAt &&
            session.expiresAt.getTime() < Date.now() - 2 * 60 * 1000
        ) {
            session.providerStatus = 'expired';
            await this.pixSessionRepo?.save(session);
            if (sub && sub.status === SubscriptionStatus.APPROVAL_PENDING) {
                sub.status = SubscriptionStatus.CANCELLED;
                await this.subscriptionRepo.save(sub);
            }
            return { session, subscriptionStatus: SubscriptionStatus.CANCELLED };
        }

        return { session, subscriptionStatus: sub?.status || null };
    }

    async getActivePixPayment(userId: string, reference?: string) {
        if (!this.pixSessionRepo) {
            return { active: false, session: null, plan: null, subscriptionStatus: null };
        }

        const cleanRef = reference ? String(reference).trim() : '';
        const session = cleanRef
            ? await this.pixSessionRepo.findOne({
                  where: { userId, paymentReference: cleanRef },
              })
            : await this.pixSessionRepo.findOne({
                  where: {
                      userId,
                      providerStatus: In(['pending', 'waiting', 'created']),
                  },
                  order: { createdAt: 'DESC' },
              });

        if (!session) {
            return { active: false, session: null, plan: null, subscriptionStatus: null };
        }

        const synced = await this.syncPixPaymentSession(session, { forceRemote: false });
        const planConfig = await this.findCanonicalPlanConfig(synced.session.tier);

        const isTerminalAndImplicit =
            !cleanRef &&
            ['expired', 'failed', 'cancelled', 'canceled', 'superseded'].includes(
                (synced.session.providerStatus || '').toLowerCase(),
            );

        if (isTerminalAndImplicit) {
            return {
                active: false,
                session: null,
                plan: planConfig ? this.mapPlanForClient(planConfig) : null,
                subscriptionStatus: synced.subscriptionStatus,
            };
        }

        return {
            active: true,
            subscriptionStatus: synced.subscriptionStatus,
            nextPollAfterMs: this.computeSmartPollDelayMs(
                'pix',
                synced.subscriptionStatus,
                synced.session.createdAt,
            ),
            session: this.serializePixSession(synced.session),
            plan: planConfig ? this.mapPlanForClient(planConfig) : null,
        };
    }

    async cancelPendingPixPayment(userId: string, reference: string) {
        if (!this.pixSessionRepo) {
            throw new BadRequestException('Serviço PIX indisponível.');
        }

        const cleanRef = String(reference || '').trim();
        const session = await this.pixSessionRepo.findOne({
            where: { userId, paymentReference: cleanRef },
        });
        if (!session) {
            throw new NotFoundException('Sessão de pagamento PIX não encontrada.');
        }

        if (this.hubblyService?.isPaidStatus(session.providerStatus)) {
            throw new BadRequestException('Este pagamento PIX já foi confirmado.');
        }

        const sub = await this.subscriptionRepo.findOne({ where: { id: session.subscriptionId } });
        if (sub && sub.status === SubscriptionStatus.ACTIVE) {
            throw new BadRequestException('Esta assinatura já está ativa.');
        }

        session.providerStatus = 'cancelled';
        await this.pixSessionRepo.save(session);

        if (sub && sub.status === SubscriptionStatus.APPROVAL_PENDING) {
            sub.status = SubscriptionStatus.CANCELLED;
            await this.subscriptionRepo.save(sub);
        }
        await this.cacheManager.del(`payment_polling:${cleanRef}`).catch(() => {});

        return { success: true, reference: cleanRef, status: 'cancelled' };
    }

    async processHubblyWebhook(payload: Record<string, any>) {
        if (!this.pixSessionRepo) return;

        const externalId = String(
            payload?.data?.externalId ||
                payload?.externalId ||
                payload?.data?.reference ||
                payload?.reference ||
                '',
        ).trim();
        const txId = String(
            payload?.data?.transactionId || payload?.data?.id || payload?.transactionId || payload?.id || '',
        ).trim();

        if (!externalId && !txId) {
            this.logger.warn('Hubbly webhook received without externalId or transactionId.');
            return;
        }

        const session = await this.pixSessionRepo.findOne({
            where: [
                ...(externalId ? [{ paymentReference: externalId }] : []),
                ...(txId ? [{ providerTransactionId: txId }] : []),
            ],
        });

        if (!session) {
            this.logger.warn(
                `PixPaymentSession not found for Hubbly webhook (externalId=${externalId}, txId=${txId}).`,
            );
            return;
        }

        // Defense-in-depth: always confirm authoritative status directly against Hubbly API
        await this.syncPixPaymentSession(session, { forceRemote: true });
    }


    async redeemSubscriptionWithReferralCredits(
        userId: string,
        tier: string,
        cycle: SubscriptionCycle,
    ) {
        const config = await this.findCanonicalPlanConfig(tier);
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

    private async cacheResolvedStatusOutcome(
        entry: ResolvedStatusCacheEntry,
        ...refs: Array<string | null | undefined>
    ): Promise<void> {
        if (!entry.outcome.found || !this.isTerminalSubscriptionStatus(entry.outcome.status)) {
            return;
        }
        const serialized = JSON.stringify(entry);
        for (const r of refs) {
            const clean = String(r || '').trim();
            if (clean) {
                await this.cacheManager
                    ?.set?.(`payment_status_resolved:${clean}`, serialized, RESOLVED_STATUS_CACHE_TTL_MS)
                    .catch(() => {});
            }
        }
    }

    private buildPaymentCheckOutcome(
        sub: Subscription,
        failureReason?: string | null,
    ): PaymentCheckOutcome {
        return {
            found: true,
            status: sub.status,
            reference: sub.paymentReference,
            paymentMethod: sub.paymentMethod || null,
            tier: sub.planConfig?.tier || null,
            cycle: sub.cycle || null,
            nextPollAfterMs: this.computeSmartPollDelayMs(
                sub.paymentMethod,
                sub.status,
                sub.createdAt,
            ),
            failureReason: failureReason || null,
            serverCheckedAt: new Date().toISOString(),
        };
    }

    private async markSubscriptionFailedOrExpired(
        sub: Subscription,
        targetStatus: SubscriptionStatus.CANCELLED | SubscriptionStatus.EXPIRED,
        reason: string,
        resolvedRef: string,
        notifyInApp = false,
    ): Promise<void> {
        if (
            sub.status === SubscriptionStatus.ACTIVE ||
            sub.status === SubscriptionStatus.APPROVED ||
            sub.status === SubscriptionStatus.CANCELLED ||
            sub.status === SubscriptionStatus.EXPIRED
        ) {
            return;
        }

        sub.status = targetStatus;
        await this.subscriptionRepo.save(sub);
        await this.cacheManager.del(`payment_polling:${resolvedRef}`).catch(() => {});
        await this.invalidateResolvedStatusCache(
            resolvedRef,
            sub.paymentReference,
            sub.externalTransactionId,
        );

        const user = await this.userRepo.findOne({ where: { id: sub.userId } });
        if (user?.email) {
            await this.emailProducer
                .enqueue(
                    user.email,
                    'PAYMENT_FAILED',
                    {
                        userName: user.name || undefined,
                        plan: sub.planConfig?.tier,
                        reference: resolvedRef,
                        reason,
                    },
                    { jobId: `payment-failed:${sub.id}` },
                )
                .catch(() => {});
        }

        if (notifyInApp) {
            await this.notificationsService
                .create(
                    sub.userId,
                    {
                        title: 'Pagamento Não Concluído',
                        message: `A transação de referência ${resolvedRef} não foi confirmada pela operadora.`,
                    },
                    { skipEmail: true },
                )
                .catch(() => {});
        }

        await this.scheduleRemarketingFollowup(sub.id).catch(() => {});
    }

    async processPaymentWebhook(payload: any) {
        this.logger.log(`Receiving Payment Webhook: ${JSON.stringify(payload)}`);

        const dataObj = payload?.data && typeof payload.data === 'object' ? payload.data : null;
        const reference: string | null =
            dataObj?.source_id ||
            dataObj?.reference ||
            payload?.source_id ||
            payload?.reference_description ||
            payload?.reference ||
            null;
        const paymentId: string | null =
            dataObj?.payment_id ||
            dataObj?.transaction_id ||
            payload?.payment_id ||
            payload?.transaction_id ||
            null;

        const statusCandidates = [
            payload?.event,
            dataObj?.event,
            dataObj?.status,
            dataObj?.payment_status,
            payload?.status,
            payload?.payment_status,
        ]
            .map((v) => (v !== undefined && v !== null ? String(v).trim() : ''))
            .filter(Boolean);

        const eventStatus: string | null = statusCandidates[0] || null;
        let classification: ReturnType<SubscriptionService['classifyWebhookStatus']> = 'unknown';
        for (const candidate of statusCandidates) {
            const c = this.classifyWebhookStatus(candidate);
            if (c === 'success' || c === 'refunded' || c === 'expired' || c === 'failed') {
                classification = c;
                break;
            }
            if (classification === 'unknown' && c === 'pending') {
                classification = 'pending';
            }
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
                ...(paymentId ? [{ externalTransactionId: paymentId }] : []),
            ],
            relations: ['planConfig'],
        });

        if (!subscription) {
            this.logger.warn(`Subscription not found for reference: ${reference} or paymentId: ${paymentId}`);
            return;
        }

        const resolvedRef = reference || subscription.paymentReference;

        // Clean active polling state and short-lived resolved cache from Redis when webhook resolves
        await Promise.all([
            this.cacheManager.del(`payment_polling:${resolvedRef}`).catch(() => {}),
            paymentId ? this.cacheManager.del(`payment_polling:${paymentId}`).catch(() => {}) : Promise.resolve(),
            subscription.paymentReference
                ? this.cacheManager.del(`payment_polling:${subscription.paymentReference}`).catch(() => {})
                : Promise.resolve(),
            subscription.externalTransactionId
                ? this.cacheManager.del(`payment_polling:${subscription.externalTransactionId}`).catch(() => {})
                : Promise.resolve(),
            this.invalidateResolvedStatusCache(
                resolvedRef,
                paymentId,
                subscription.paymentReference,
                subscription.externalTransactionId,
            ),
        ]);

        if (classification === 'success') {
            if (paymentId && subscription.externalTransactionId !== paymentId) {
                subscription.externalTransactionId = paymentId;
                await this.subscriptionRepo.save(subscription);
            }
            await this.activateSubscription(subscription, resolvedRef);
        } else if (classification === 'refunded') {
            this.logger.warn(
                `Refund/Chargeback webhook received for subscription ${subscription.id} (Ref: ${resolvedRef}): ${eventStatus}`,
            );
            subscription.status = SubscriptionStatus.CANCELLED;
            subscription.currentPeriodEnd = new Date();
            if (paymentId) {
                subscription.externalTransactionId = paymentId;
            }
            await this.subscriptionRepo.save(subscription);
            await this.cancelScheduledSubscriptionJobs(subscription.id);
            await this.invalidateUserPlanCaches(subscription.userId);
            await this.invalidateResolvedStatusCache(
                resolvedRef,
                paymentId,
                subscription.paymentReference,
                subscription.externalTransactionId,
            );
            await this.notificationsService.create(
                subscription.userId,
                {
                    title: 'Assinatura Cancelada por Reembolso/Estorno',
                    message: `A assinatura vinculada à referência ${resolvedRef} foi encerrada (${eventStatus}).`,
                },
                { skipEmail: true },
            );
        } else if (classification === 'failed' || classification === 'expired') {
            this.logger.log(`Payment ${classification} received for reference ${resolvedRef}: ${eventStatus}`);

            if (
                subscription.status === SubscriptionStatus.CANCELLED ||
                subscription.status === SubscriptionStatus.EXPIRED
            ) {
                this.logger.warn(
                    `Subscription ${subscription.id} already in terminal state ${subscription.status}, skipping webhook failure processing.`,
                );
                return;
            }

            if (paymentId && subscription.externalTransactionId !== paymentId) {
                subscription.externalTransactionId = paymentId;
            }

            const targetStatus =
                classification === 'expired'
                    ? SubscriptionStatus.EXPIRED
                    : SubscriptionStatus.CANCELLED;
            const reason =
                classification === 'expired'
                    ? 'O tempo limite de confirmação da transação expirou.'
                    : 'A transação foi cancelada ou não autorizada pela operadora.';

            await this.markSubscriptionFailedOrExpired(
                subscription,
                targetStatus,
                reason,
                resolvedRef,
                true,
            );
        } else {
            this.logger.log(`Unhandled/pending webhook status/event: ${eventStatus} for ${resolvedRef}`);
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

            // Mark any linked pending renewal invoice as PAID atomically so it can never be paid twice
            if (this.renewalInvoiceRepo && reference) {
                const pendingInvoices = await manager.find(SubscriptionRenewalInvoice, {
                    where: [
                        { paymentReference: reference, status: RenewalInvoiceStatus.PENDING },
                        { userId: lockedSub.userId, status: RenewalInvoiceStatus.PENDING },
                    ],
                });
                for (const inv of pendingInvoices) {
                    inv.status = RenewalInvoiceStatus.PAID;
                    inv.paidAt = now;
                    inv.paidSubscriptionId = lockedSub.id;
                    inv.paymentMethod = lockedSub.paymentMethod || inv.paymentMethod;
                    inv.paymentReference = reference;
                    await manager.save(SubscriptionRenewalInvoice, inv);
                }
            }

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
        await this.invalidateResolvedStatusCache(
            reference,
            subscription.paymentReference,
            subscription.externalTransactionId,
        );

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

    private async checkDebitoStatusCoalesced(
        externalTransactionId: string,
    ): Promise<DebitoPayStatusResult | null> {
        if (!this.debitoPayService) return null;
        const existing = this.inFlightDebitoRemoteChecks.get(externalTransactionId);
        if (existing) {
            return existing;
        }
        const reqPromise = this.debitoPayService
            .checkStatus(externalTransactionId)
            .finally(() => {
                this.inFlightDebitoRemoteChecks.delete(externalTransactionId);
            });
        this.inFlightDebitoRemoteChecks.set(externalTransactionId, reqPromise);
        return reqPromise;
    }

    async checkPaymentStatus(
        reference: string,
        expectedUserId?: string,
        options: { forceRemote?: boolean } = {},
    ): Promise<PaymentCheckOutcome> {
        const cleanRef = String(reference || '').trim();
        const serverCheckedAt = new Date().toISOString();
        if (!cleanRef) {
            return {
                found: false,
                status: null,
                nextPollAfterMs: 0,
                serverCheckedAt,
            };
        }

        const flightKey = `${cleanRef}:${options.forceRemote ? 'force' : 'passive'}`;
        let flight = this.inFlightStatusChecks.get(flightKey);
        if (!flight) {
            flight = this.executeCheckPaymentStatus(cleanRef, options).finally(() => {
                this.inFlightStatusChecks.delete(flightKey);
            });
            this.inFlightStatusChecks.set(flightKey, flight);
        }

        const result = await flight;
        if (expectedUserId && result.userId && result.userId !== expectedUserId) {
            throw new ForbiddenException('Acesso negado a esta referência de assinatura.');
        }

        return result.outcome;
    }

    private async executeCheckPaymentStatus(
        cleanRef: string,
        options: { forceRemote?: boolean } = {},
    ): Promise<CoalescedStatusCheckResult> {
        const serverCheckedAt = new Date().toISOString();

        // Fast-path terminal status cache in Redis (avoids DB + gateway round-trips under polling bursts)
        try {
            const cachedRaw = await this.cacheManager?.get?.<string>(
                `payment_status_resolved:${cleanRef}`,
            );
            if (cachedRaw) {
                const parsed = (
                    typeof cachedRaw === 'string' ? JSON.parse(cachedRaw) : cachedRaw
                ) as ResolvedStatusCacheEntry;
                if (
                    parsed?.outcome?.found &&
                    this.isTerminalSubscriptionStatus(parsed.outcome.status)
                ) {
                    return {
                        userId: parsed.userId || null,
                        outcome: {
                            ...parsed.outcome,
                            nextPollAfterMs: 0,
                            serverCheckedAt,
                        },
                    };
                }
            }
        } catch {
            // Fall through cleanly to authoritative DB check
        }

        const subscription = await this.subscriptionRepo.findOne({
            where: [
                { paymentReference: cleanRef },
                { externalTransactionId: cleanRef },
            ],
            relations: ['planConfig'],
        });

        if (!subscription) {
            return {
                userId: null,
                outcome: {
                    found: false,
                    status: null,
                    reference: cleanRef,
                    nextPollAfterMs: 0,
                    serverCheckedAt,
                },
            };
        }

        if (this.isTerminalSubscriptionStatus(subscription.status)) {
            const outcome = this.buildPaymentCheckOutcome(
                subscription,
                subscription.status === SubscriptionStatus.EXPIRED
                    ? 'expired'
                    : subscription.status === SubscriptionStatus.CANCELLED
                      ? 'failed'
                      : null,
            );
            await this.cacheResolvedStatusOutcome(
                { userId: subscription.userId, outcome },
                cleanRef,
                subscription.paymentReference,
                subscription.externalTransactionId,
            );
            return { userId: subscription.userId, outcome };
        }

        const forceRequested = Boolean(options.forceRemote);

        if (
            subscription.paymentMethod === 'crypto' &&
            subscription.status === SubscriptionStatus.APPROVAL_PENDING &&
            this.cryptoSessionRepo &&
            this.nowPaymentsService
        ) {
            const cryptoSession = await this.cryptoSessionRepo.findOne({
                where: [
                    { subscriptionId: subscription.id },
                    { paymentReference: subscription.paymentReference },
                ],
            });
            if (cryptoSession) {
                const synced = await this.syncCryptoPaymentSession(cryptoSession, {
                    forceRemote: forceRequested,
                });
                const resolvedStatus = synced.subscriptionStatus || subscription.status;
                subscription.status = resolvedStatus;
                const providerSt = String(synced.session.providerStatus || '').toLowerCase();
                const failReason =
                    resolvedStatus === SubscriptionStatus.CANCELLED ||
                    resolvedStatus === SubscriptionStatus.EXPIRED
                        ? providerSt === 'expired'
                            ? 'expired'
                            : 'failed'
                        : null;
                const outcome = this.buildPaymentCheckOutcome(subscription, failReason);
                await this.cacheResolvedStatusOutcome(
                    { userId: subscription.userId, outcome },
                    cleanRef,
                    subscription.paymentReference,
                );
                return { userId: subscription.userId, outcome };
            }
        }

        if (
            subscription.paymentMethod === 'pix' &&
            subscription.status === SubscriptionStatus.APPROVAL_PENDING &&
            this.pixSessionRepo &&
            this.hubblyService
        ) {
            const pixSession = await this.pixSessionRepo.findOne({
                where: [
                    { subscriptionId: subscription.id },
                    { paymentReference: subscription.paymentReference },
                ],
            });
            if (pixSession) {
                const synced = await this.syncPixPaymentSession(pixSession, {
                    forceRemote: forceRequested,
                });
                const resolvedStatus = synced.subscriptionStatus || subscription.status;
                subscription.status = resolvedStatus;
                const providerSt = String(synced.session.providerStatus || '').toLowerCase();
                const failReason =
                    resolvedStatus === SubscriptionStatus.CANCELLED ||
                    resolvedStatus === SubscriptionStatus.EXPIRED
                        ? providerSt === 'expired'
                            ? 'expired'
                            : 'failed'
                        : null;
                const outcome = this.buildPaymentCheckOutcome(subscription, failReason);
                await this.cacheResolvedStatusOutcome(
                    { userId: subscription.userId, outcome },
                    cleanRef,
                    subscription.paymentReference,
                );
                return { userId: subscription.userId, outcome };
            }
        }

        const methodLower = String(subscription.paymentMethod || '').toLowerCase();
        if (
            ['mpesa', 'emola', 'card', 'payfast'].includes(methodLower) &&
            subscription.status === SubscriptionStatus.APPROVAL_PENDING &&
            subscription.externalTransactionId &&
            this.debitoPayService
        ) {
            const passiveCooldownMs =
                methodLower === 'mpesa' || methodLower === 'emola' ? 3500 : 4500;
            const shouldQueryRemote = await this.shouldSyncRemoteWithThrottle(
                `debito_status_sync:${subscription.externalTransactionId}`,
                passiveCooldownMs,
                forceRequested,
                `debito_force_cd:${subscription.externalTransactionId}`,
            );

            if (shouldQueryRemote) {
                const remote = await this.checkDebitoStatusCoalesced(
                    subscription.externalTransactionId,
                );
                if (remote) {
                    if (remote.status === 'success') {
                        await this.activateSubscription(
                            subscription,
                            subscription.paymentReference,
                        );
                        subscription.status = SubscriptionStatus.ACTIVE;
                        const outcome = this.buildPaymentCheckOutcome(subscription, null);
                        await this.cacheResolvedStatusOutcome(
                            { userId: subscription.userId, outcome },
                            cleanRef,
                            subscription.paymentReference,
                            subscription.externalTransactionId,
                        );
                        return { userId: subscription.userId, outcome };
                    }
                    if (remote.status === 'failed' || remote.status === 'expired') {
                        const targetStatus =
                            remote.status === 'expired'
                                ? SubscriptionStatus.EXPIRED
                                : SubscriptionStatus.CANCELLED;
                        const reasonMsg =
                            String(
                                remote.rawResponse?.data?.message ||
                                    remote.rawResponse?.message ||
                                    '',
                            ).trim() ||
                            (remote.status === 'expired'
                                ? 'O tempo limite de confirmação da transação expirou.'
                                : 'A transação foi cancelada ou não autorizada pela operadora.');

                        await this.markSubscriptionFailedOrExpired(
                            subscription,
                            targetStatus,
                            reasonMsg,
                            subscription.paymentReference,
                            false,
                        );
                        const outcome = this.buildPaymentCheckOutcome(
                            subscription,
                            remote.status === 'expired' ? 'expired' : reasonMsg,
                        );
                        await this.cacheResolvedStatusOutcome(
                            { userId: subscription.userId, outcome },
                            cleanRef,
                            subscription.paymentReference,
                            subscription.externalTransactionId,
                        );
                        return { userId: subscription.userId, outcome };
                    }
                }
            }
        }

        const outcome = this.buildPaymentCheckOutcome(subscription, null);
        return { userId: subscription.userId, outcome };
    }

    async resolvePaymentCallbackRedirect(
        mode: 'success' | 'failed',
        ctx: PaymentCallbackQueryContext,
    ): Promise<string> {
        const rawRef = String(ctx.reference || '').trim();
        const safeRef = /^[a-zA-Z0-9_-]{4,80}$/.test(rawRef) ? rawRef : '';
        const cleanLocale = String(ctx.locale || '').trim().toLowerCase();
        const localePrefix =
            cleanLocale === 'en' ? '/en' : cleanLocale === 'pt' ? '/pt' : '';
        const frontendOrigin = resolveFrontendUrl();

        let outcome: PaymentCheckOutcome | null = null;
        if (safeRef) {
            try {
                outcome = await this.checkPaymentStatus(safeRef, undefined, {
                    forceRemote: true,
                });
            } catch (err: any) {
                this.logger.warn(
                    `Callback status reconciliation failed for ${safeRef}: ${err?.message || err}`,
                );
            }
        }

        let renewalInvoice: SubscriptionRenewalInvoice | null = null;
        if (this.renewalInvoiceRepo) {
            const cleanToken = String(ctx.renewalToken || '').trim();
            if (/^[a-f0-9]{32,96}$/i.test(cleanToken)) {
                renewalInvoice = await this.renewalInvoiceRepo.findOne({
                    where: { token: cleanToken },
                });
            }
            if (!renewalInvoice && safeRef) {
                renewalInvoice = await this.renewalInvoiceRepo.findOne({
                    where: { paymentReference: safeRef },
                    order: { createdAt: 'DESC' },
                });
            }
        }

        const resolvedMethod =
            String(
                ctx.method ||
                    outcome?.paymentMethod ||
                    renewalInvoice?.paymentMethod ||
                    'card',
            ).trim() || 'card';
        const resolvedTier = String(outcome?.tier || renewalInvoice?.tier || '').trim();
        const resolvedCycle = String(outcome?.cycle || renewalInvoice?.cycle || '').trim();

        const queryStatusClass = this.classifyWebhookStatus(ctx.status);
        const queryExplicitFail =
            mode === 'failed' ||
            queryStatusClass === 'failed' ||
            queryStatusClass === 'expired' ||
            queryStatusClass === 'refunded';

        const isConfirmedActive =
            outcome?.status === SubscriptionStatus.ACTIVE ||
            outcome?.status === SubscriptionStatus.APPROVED;

        if (isConfirmedActive) {
            if (renewalInvoice?.token) {
                const qs = new URLSearchParams({
                    payment_status: 'active',
                    method: resolvedMethod,
                    ...(safeRef ? { subscription_id: safeRef } : {}),
                });
                return `${frontendOrigin}${localePrefix}/subscription/payment/${encodeURIComponent(renewalInvoice.token)}?${qs.toString()}`;
            }
            const qs = new URLSearchParams({
                payment_status: 'active',
                method: resolvedMethod,
                ...(safeRef ? { subscription_id: safeRef } : {}),
            });
            return `${frontendOrigin}${localePrefix}/subscription/success?${qs.toString()}`;
        }

        const isTerminalFailure =
            outcome?.status === SubscriptionStatus.CANCELLED ||
            outcome?.status === SubscriptionStatus.EXPIRED;

        if (queryExplicitFail || isTerminalFailure) {
            const reasonRaw =
                String(ctx.reason || outcome?.failureReason || '').trim() ||
                (outcome?.status === SubscriptionStatus.EXPIRED || queryStatusClass === 'expired'
                    ? 'expired'
                    : queryStatusClass === 'failed' && String(ctx.status || '').toLowerCase().includes('cancel')
                      ? 'cancelled'
                      : 'failed');

            if (renewalInvoice?.token) {
                const qs = new URLSearchParams({
                    payment_status: 'failed',
                    method: resolvedMethod,
                    payment_reason: reasonRaw.slice(0, 220),
                    ...(safeRef ? { subscription_id: safeRef } : {}),
                });
                return `${frontendOrigin}${localePrefix}/subscription/payment/${encodeURIComponent(renewalInvoice.token)}?${qs.toString()}`;
            }

            const qs = new URLSearchParams({
                payment_status: 'failed',
                method: resolvedMethod,
                payment_reason: reasonRaw.slice(0, 220),
                ...(safeRef ? { subscription_id: safeRef } : {}),
                ...(resolvedTier ? { tier: resolvedTier } : {}),
                ...(resolvedCycle ? { cycle: resolvedCycle } : {}),
            });
            return `${frontendOrigin}${localePrefix}/checkout?${qs.toString()}`;
        }

        if (renewalInvoice?.token) {
            const qs = new URLSearchParams({
                payment_status: 'pending',
                method: resolvedMethod,
                ...(safeRef ? { subscription_id: safeRef } : {}),
            });
            return `${frontendOrigin}${localePrefix}/subscription/payment/${encodeURIComponent(renewalInvoice.token)}?${qs.toString()}`;
        }

        if (safeRef) {
            const qs = new URLSearchParams({
                subscription_id: safeRef,
                payment_status: 'pending',
                method: resolvedMethod,
                ...(resolvedTier ? { tier: resolvedTier } : {}),
                ...(resolvedCycle ? { cycle: resolvedCycle } : {}),
            });
            return `${frontendOrigin}${localePrefix}/subscription/success?${qs.toString()}`;
        }

        const qs = new URLSearchParams({
            payment_status: 'failed',
            method: resolvedMethod,
            payment_reason: 'missing_reference',
        });
        return `${frontendOrigin}${localePrefix}/checkout?${qs.toString()}`;
    }

    // =========================================================================
    // UNIVERSAL RENEWAL CHECKOUT (debitopaydoc.md §7 — /subscription/payment/:token)
    // =========================================================================

    async createOrReuseRenewalInvoice(
        subscription: Subscription,
    ): Promise<SubscriptionRenewalInvoice | null> {
        if (!this.renewalInvoiceRepo || !subscription.planConfig) return null;

        const existing = await this.renewalInvoiceRepo.findOne({
            where: {
                subscriptionId: subscription.id,
                status: RenewalInvoiceStatus.PENDING,
            },
            order: { createdAt: 'DESC' },
        });
        if (existing && existing.expiresAt && existing.expiresAt.getTime() > Date.now() + 60 * 60 * 1000) {
            return existing;
        }

        const amountUsd = this.getAmountUsd(subscription.planConfig, subscription.cycle);
        const token = randomBytes(32).toString('hex');
        const dueDate = subscription.currentPeriodEnd
            ? new Date(subscription.currentPeriodEnd)
            : new Date();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        const invoice = this.renewalInvoiceRepo.create({
            token,
            subscriptionId: subscription.id,
            userId: subscription.userId,
            planConfigId: subscription.planConfigId,
            tier: subscription.planConfig.tier,
            cycle: subscription.cycle,
            amountUsd,
            status: RenewalInvoiceStatus.PENDING,
            dueDate,
            expiresAt,
        });
        return this.renewalInvoiceRepo.save(invoice);
    }

    async getPublicRenewalInvoice(token: string, geo: CheckoutGeoResolution) {
        if (!this.renewalInvoiceRepo) {
            throw new NotFoundException('Cobrança de renovação não encontrada.');
        }
        const cleanToken = String(token || '').trim();
        if (!/^[a-f0-9]{32,96}$/i.test(cleanToken)) {
            throw new BadRequestException('Link de pagamento inválido.');
        }

        const invoice = await this.renewalInvoiceRepo.findOne({ where: { token: cleanToken } });
        if (!invoice) {
            throw new NotFoundException('Link de pagamento não encontrado ou expirado.');
        }

        if (
            invoice.status === RenewalInvoiceStatus.PENDING &&
            invoice.expiresAt &&
            invoice.expiresAt.getTime() < Date.now()
        ) {
            invoice.status = RenewalInvoiceStatus.EXPIRED;
            await this.renewalInvoiceRepo.save(invoice);
        }

        return {
            token: invoice.token,
            tier: invoice.tier,
            cycle: invoice.cycle,
            amountUsd: Number(invoice.amountUsd),
            currency: 'USD',
            status: invoice.status,
            dueDate: invoice.dueDate.toISOString(),
            expiresAt: invoice.expiresAt.toISOString(),
            paidAt: invoice.paidAt ? invoice.paidAt.toISOString() : null,
            geo,
        };
    }

    async payRenewalInvoice(
        token: string,
        dto: PayRenewalInvoiceDto,
        customerContext?: DebitoPayCustomerContext,
    ) {
        if (!this.renewalInvoiceRepo) {
            throw new BadRequestException('Serviço de renovação indisponível.');
        }
        const cleanToken = String(token || '').trim();
        const invoice = await this.renewalInvoiceRepo.findOne({ where: { token: cleanToken } });
        if (!invoice) {
            throw new NotFoundException('Link de cobrança não encontrado.');
        }
        if (invoice.status === RenewalInvoiceStatus.PAID) {
            throw new BadRequestException('Esta renovação já foi paga.');
        }
        if (
            invoice.status !== RenewalInvoiceStatus.PENDING ||
            (invoice.expiresAt && invoice.expiresAt.getTime() < Date.now())
        ) {
            if (invoice.status === RenewalInvoiceStatus.PENDING) {
                invoice.status = RenewalInvoiceStatus.EXPIRED;
                await this.renewalInvoiceRepo.save(invoice);
            }
            throw new BadRequestException('Este link de renovação expirou ou foi cancelado.');
        }

        let result: any;
        const cycle = invoice.cycle as SubscriptionCycle;
        if (dto.paymentMethod === 'mpesa' || dto.paymentMethod === 'emola') {
            if (!dto.phoneNumber) {
                throw new BadRequestException('Informe o número de telefone para continuar.');
            }
            result = await this.createMobileSubscription(
                invoice.userId,
                invoice.tier,
                cycle,
                dto.paymentMethod,
                dto.phoneNumber,
                false,
                false,
                customerContext,
            );
        } else if (dto.paymentMethod === 'card') {
            result = await this.createCardSubscription(
                invoice.userId,
                invoice.tier,
                cycle,
                dto.returnUrl,
                undefined,
                dto.phoneNumber,
                false,
                customerContext,
            );
        } else if (dto.paymentMethod === 'payfast') {
            result = await this.createPayFastSubscription(
                invoice.userId,
                invoice.tier,
                cycle,
                dto.returnUrl,
                dto.phoneNumber,
                false,
                customerContext,
            );
        } else if (dto.paymentMethod === 'pix') {
            if (!dto.payerDocument) {
                throw new BadRequestException('Informe um CPF ou CNPJ válido.');
            }
            result = await this.createPixSubscription(
                invoice.userId,
                invoice.tier,
                cycle,
                dto.payerDocument,
                undefined,
                false,
                false,
            );
        } else if (dto.paymentMethod === 'crypto') {
            result = await this.createCryptoSubscription(
                invoice.userId,
                invoice.tier,
                cycle,
                dto.cryptocurrency || 'USDT.TRC20',
                false,
                false,
            );
        } else {
            throw new BadRequestException('Método de pagamento inválido.');
        }

        const ref = result?.reference || result?.session?.reference || null;
        if (ref) {
            invoice.paymentReference = ref;
            invoice.paymentMethod = dto.paymentMethod;
            await this.renewalInvoiceRepo.save(invoice);
        }

        return result;
    }

    async getPublicRenewalPaymentStatus(
        token: string,
        reference?: string,
        forceRemote = false,
    ) {
        if (!this.renewalInvoiceRepo) {
            throw new NotFoundException('Serviço de renovação indisponível.');
        }
        const cleanToken = String(token || '').trim();
        if (!/^[a-f0-9]{32,96}$/i.test(cleanToken)) {
            throw new BadRequestException('Link de pagamento inválido.');
        }

        let invoice = await this.renewalInvoiceRepo.findOne({ where: { token: cleanToken } });
        if (!invoice) {
            throw new NotFoundException('Link de pagamento não encontrado.');
        }

        if (
            invoice.status === RenewalInvoiceStatus.PENDING &&
            invoice.expiresAt &&
            invoice.expiresAt.getTime() < Date.now()
        ) {
            invoice.status = RenewalInvoiceStatus.EXPIRED;
            await this.renewalInvoiceRepo.save(invoice);
        }

        if (invoice.status === RenewalInvoiceStatus.PAID) {
            return {
                token: invoice.token,
                invoiceStatus: invoice.status,
                status: SubscriptionStatus.ACTIVE,
                reference: invoice.paymentReference,
                paymentMethod: invoice.paymentMethod,
                tier: invoice.tier,
                cycle: invoice.cycle,
                nextPollAfterMs: 0,
                failureReason: null,
                paidAt: invoice.paidAt ? invoice.paidAt.toISOString() : null,
            };
        }

        const requestedRef = String(reference || '').trim();
        const targetRef = /^[a-zA-Z0-9_-]{4,80}$/.test(requestedRef)
            ? requestedRef
            : invoice.paymentReference || '';

        let outcome: PaymentCheckOutcome | null = null;
        if (targetRef) {
            outcome = await this.checkPaymentStatus(targetRef, invoice.userId, {
                forceRemote,
            }).catch(() => null);
            invoice =
                (await this.renewalInvoiceRepo.findOne({ where: { token: cleanToken } })) ||
                invoice;
        }

        if (
            invoice.status === RenewalInvoiceStatus.PAID ||
            outcome?.status === SubscriptionStatus.ACTIVE ||
            outcome?.status === SubscriptionStatus.APPROVED
        ) {
            return {
                token: invoice.token,
                invoiceStatus: RenewalInvoiceStatus.PAID,
                status: SubscriptionStatus.ACTIVE,
                reference: targetRef || invoice.paymentReference,
                paymentMethod: outcome?.paymentMethod || invoice.paymentMethod,
                tier: invoice.tier,
                cycle: invoice.cycle,
                nextPollAfterMs: 0,
                failureReason: null,
                paidAt: invoice.paidAt ? invoice.paidAt.toISOString() : new Date().toISOString(),
            };
        }

        return {
            token: invoice.token,
            invoiceStatus: invoice.status,
            status: outcome?.status || null,
            reference: targetRef || invoice.paymentReference,
            paymentMethod: outcome?.paymentMethod || invoice.paymentMethod,
            tier: invoice.tier,
            cycle: invoice.cycle,
            nextPollAfterMs:
                outcome?.nextPollAfterMs ??
                this.computeSmartPollDelayMs(
                    outcome?.paymentMethod || invoice.paymentMethod,
                    outcome?.status || SubscriptionStatus.APPROVAL_PENDING,
                    invoice.updatedAt,
                ),
            failureReason: outcome?.failureReason || null,
            paidAt: null,
        };
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
                where: { tier: normalizedTier, isActive: true },
                order: { monthlyPrice: 'ASC' },
            });
            if (!targetPlan) {
                const cfg = CANONICAL_WORKSPACE_PLAN_DEFAULTS[normalizedTier];
                const snap = this.computeCyclePricingSnapshot({
                    baseMonthlyUsd: cfg.monthlyPrice,
                    monthlyDiscountPercent: cfg.monthlyDiscountPercent,
                    quarterlyDiscountPercent: cfg.quarterlyDiscountPercent,
                    annualDiscountPercent: cfg.annualDiscountPercent,
                    biennialDiscountPercent: cfg.biennialDiscountPercent,
                    usdToMznRate: cfg.usdToMznRate,
                });
                targetPlan = await manager.save(
                    SubscriptionPlanConfig,
                    manager.create(SubscriptionPlanConfig, {
                        tier: normalizedTier,
                        ...cfg,
                        annualMonthlyPrice: snap.annualMonthlyPrice,
                        monthlyPriceMzn: snap.monthlyPriceMzn,
                        quarterlyPriceMzn: snap.quarterlyPriceMzn,
                        annualPriceMzn: snap.annualPriceMzn,
                        biennialPriceMzn: snap.biennialPriceMzn,
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
            // Generate universal renewal link (/subscription/payment/:token) and email user
            if (user?.email && sub.planConfig) {
                try {
                    const inv = await this.createOrReuseRenewalInvoice(sub);
                    if (inv) {
                        await this.emailProducer.enqueue(
                            user.email,
                            'SUBSCRIPTION_EXPIRING',
                            {
                                userName: user.name || undefined,
                                plan: sub.planConfig.tier,
                                daysRemaining: 0,
                                expiryDate: new Date(sub.currentPeriodEnd || new Date()).toISOString(),
                                renewalUrl: `/subscription/payment/${inv.token}`,
                                subject: 'Renovação da sua subscrição — TorexJournal',
                            },
                            { jobId: `renewal-link:${inv.id}` },
                        );
                    }
                } catch (invErr: any) {
                    this.logger.warn(`Failed creating renewal invoice for sub ${sub.id}: ${invErr?.message || invErr}`);
                }
            }
            return {
                action: 'cannot_auto_renew',
                sub,
                reason: 'Nenhum método móvel automático (M-Pesa/e-Mola) disponível para renovação. Link universal enviado por e-mail.',
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
            const monthlyDisc = Math.max(0, Math.min(90, Number(merged.monthlyDiscountPercent ?? 0)));
            const quarterlyDisc = Math.max(0, Math.min(90, Number(merged.quarterlyDiscountPercent ?? 0)));
            const annualDisc = Math.max(0, Math.min(90, Number(merged.annualDiscountPercent ?? 0)));
            const biennialDisc = Math.max(0, Math.min(90, Number(merged.biennialDiscountPercent ?? 0)));
            const snap = this.computeCyclePricingSnapshot({
                baseMonthlyUsd: baseMonthly,
                monthlyDiscountPercent: monthlyDisc,
                quarterlyDiscountPercent: quarterlyDisc,
                annualDiscountPercent: annualDisc,
                biennialDiscountPercent: biennialDisc,
                usdToMznRate: rate,
            });
            const explicitAnnualMonthly =
                data.annualMonthlyPrice !== undefined &&
                data.annualMonthlyPrice !== null &&
                Number(data.annualMonthlyPrice) > 0 &&
                Number(data.annualMonthlyPrice) !== Number(existing.annualMonthlyPrice || 0)
                    ? Number(data.annualMonthlyPrice)
                    : null;
            const explicitMonthlyMzn =
                data.monthlyPriceMzn !== undefined &&
                data.monthlyPriceMzn !== null &&
                Number(data.monthlyPriceMzn) > 0 &&
                Number(data.monthlyPriceMzn) !== Number(existing.monthlyPriceMzn || 0)
                    ? Number(data.monthlyPriceMzn)
                    : null;

            data = {
                ...data,
                usdToMznRate: rate,
                monthlyDiscountPercent: monthlyDisc,
                quarterlyDiscountPercent: quarterlyDisc,
                annualDiscountPercent: annualDisc,
                biennialDiscountPercent: biennialDisc,
                annualMonthlyPrice: explicitAnnualMonthly ?? snap.annualMonthlyPrice,
                monthlyPriceMzn: explicitMonthlyMzn ?? snap.monthlyPriceMzn,
                quarterlyPriceMzn: snap.quarterlyPriceMzn,
                annualPriceMzn: snap.annualPriceMzn,
                biennialPriceMzn: snap.biennialPriceMzn,
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
            payfast: 0,
            pix: 0,
            crypto: 0,
        };
        for (const sub of subscriptions) {
            let method = sub.paymentMethod?.toLowerCase() || 'card';
            if (
                sub.paymentReference &&
                !['mpesa', 'emola', 'card', 'payfast', 'crypto', 'pix'].includes(method)
            ) {
                const ref = sub.paymentReference.toLowerCase();
                if (ref.includes('mpesa')) method = 'mpesa';
                else if (ref.includes('emola')) method = 'emola';
                else if (ref.includes('payfast')) method = 'payfast';
                else if (ref.includes('crypto')) method = 'crypto';
                else if (ref.includes('pix')) method = 'pix';
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
