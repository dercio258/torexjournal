import * as crypto from 'crypto';
import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import { ReferralEntity } from './referral.entity';
import { UserEntity } from './user.entity';
import { resolveFrontendUrl } from '../email/templates';

export const INVITE_AI_DAILY_BONUS = 50;
export const INVITE_AI_BONUS_DAYS = 30;
export const PLAN_CREDIT_MILESTONE_TARGET = 3;
export const PLAN_CREDIT_MILESTONE_USD = 10;
const TIER_BOOST_PAID_TARGET = 2;
const DAILY_REWARD_CAP = 10;

@Injectable()
export class ReferralService implements OnModuleInit {
    private readonly logger = new Logger(ReferralService.name);

    constructor(
        @InjectRepository(ReferralEntity)
        private readonly referralRepo: Repository<ReferralEntity>,
        @InjectRepository(UserEntity)
        private readonly userRepo: Repository<UserEntity>,
        @Optional()
        private readonly configService?: ConfigService,
    ) {}

    async onModuleInit() {
        try {
            await this.userRepo.manager?.query?.(`
                ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referral_pending_credits_usd" numeric(10,2) DEFAULT 0;
                ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referral_ai_bonus_until" timestamp NULL;
            `);
        } catch (err: any) {
            this.logger.warn(`Referral columns check warning: ${err?.message || err}`);
        }
    }

    getVerifyCreditUsd(): number {
        const raw = Number(
            this.configService?.get('REFERRAL_VERIFY_CREDIT_USD') ??
                process.env.REFERRAL_VERIFY_CREDIT_USD ??
                PLAN_CREDIT_MILESTONE_USD,
        );
        return Number.isFinite(raw) && raw >= 0 ? raw : PLAN_CREDIT_MILESTONE_USD;
    }

    getPaidCreditUsd(): number {
        const raw = Number(
            this.configService?.get('REFERRAL_PAID_CREDIT_USD') ??
                process.env.REFERRAL_PAID_CREDIT_USD ??
                PLAN_CREDIT_MILESTONE_USD,
        );
        return Number.isFinite(raw) && raw >= 0 ? raw : PLAN_CREDIT_MILESTONE_USD;
    }

    sanitizeReferralCode(raw?: string | null): string | null {
        const clean = String(raw || '')
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9_-]/g, '');
        if (clean.length < 4 || clean.length > 32) return null;
        return clean;
    }

    private generateCandidateCode(hint?: string | null): string {
        const prefix = String(hint || 'TRX')
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '')
            .slice(0, 3)
            .padEnd(3, 'X');
        const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
        return `${prefix}${rand}`;
    }

    async hasActivePaidSubscription(userId: string): Promise<boolean> {
        if (!userId || typeof this.userRepo.manager?.query !== 'function') {
            return false;
        }
        try {
            const rows = await this.userRepo.manager.query(
                `
                SELECT s.id
                FROM "subscriptions" s
                INNER JOIN "subscription_plan_configs" p ON p.id = s."planConfigId"
                WHERE s."userId" = $1
                  AND s.status = 'ACTIVE'
                  AND (s."currentPeriodEnd" IS NULL OR s."currentPeriodEnd" > now())
                  AND COALESCE(LOWER(s."paymentMethod"), '') NOT IN ('trial', 'free_trial')
                  AND COALESCE(p."monthlyPrice", 0) > 0
                LIMIT 1
                `,
                [userId],
            );
            return Array.isArray(rows) && rows.length > 0;
        } catch {
            return false;
        }
    }

    async ensureReferralCode(userId: string): Promise<string> {
        const user = await this.userRepo.findOne({
            where: { id: userId },
            select: ['id', 'username', 'name', 'referralCode'],
        });
        if (!user) return '';
        if (user.referralCode) return user.referralCode;

        for (let attempt = 0; attempt < 6; attempt++) {
            const candidate = this.generateCandidateCode(user.username || user.name || 'TRX');
            const collision = await this.userRepo.findOne({
                where: { referralCode: candidate },
                select: ['id'],
            });
            if (collision) continue;

            try {
                await this.userRepo.update({ id: userId }, { referralCode: candidate });
                return candidate;
            } catch {
                // Retry on race condition unique violation
            }
        }
        const fallback = `TRX${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        await this.userRepo.update({ id: userId }, { referralCode: fallback }).catch(() => {});
        return fallback;
    }

    async processVerifiedSignup(
        referredUserId: string,
        rawReferralCode?: string | null,
    ): Promise<{
        attributed: boolean;
        creditedUsd: number;
        pendingCreditsAddedUsd: number;
        aiDailyBonusUnlocked: boolean;
        tierBoostUnlocked: boolean;
    }> {
        const cleanCode = this.sanitizeReferralCode(rawReferralCode);
        if (!referredUserId || !cleanCode) {
            return {
                attributed: false,
                creditedUsd: 0,
                pendingCreditsAddedUsd: 0,
                aiDailyBonusUnlocked: false,
                tierBoostUnlocked: false,
            };
        }

        const referrer = await this.userRepo.findOne({
            where: { referralCode: cleanCode },
        });
        if (!referrer || referrer.id === referredUserId) {
            return {
                attributed: false,
                creditedUsd: 0,
                pendingCreditsAddedUsd: 0,
                aiDailyBonusUnlocked: false,
                tierBoostUnlocked: false,
            };
        }

        const referredUser = await this.userRepo.findOne({
            where: { id: referredUserId },
        });
        if (!referredUser || referredUser.referredByUserId) {
            return {
                attributed: false,
                creditedUsd: 0,
                pendingCreditsAddedUsd: 0,
                aiDailyBonusUnlocked: false,
                tierBoostUnlocked: false,
            };
        }

        if (
            referrer.email &&
            referredUser.email &&
            referrer.email.trim().toLowerCase() === referredUser.email.trim().toLowerCase()
        ) {
            return {
                attributed: false,
                creditedUsd: 0,
                pendingCreditsAddedUsd: 0,
                aiDailyBonusUnlocked: false,
                tierBoostUnlocked: false,
            };
        }

        const existingRef = await this.referralRepo.findOne({
            where: { referredUserId },
        });
        if (existingRef) {
            return {
                attributed: false,
                creditedUsd: 0,
                pendingCreditsAddedUsd: 0,
                aiDailyBonusUnlocked: false,
                tierBoostUnlocked: false,
            };
        }

        // Regra estrita de afiliados (fora do fluxo de trial):
        // O vínculo é apenas registado no cadastro; aprovação, bônus de IA e créditos de plano só ocorrem quando o convidado paga qualquer plano.
        const refRow = this.referralRepo.create({
            referrerUserId: referrer.id,
            referredUserId,
            status: 'REGISTERED',
            rewardCreditsUsd: 0,
            tierBoostAwarded: false,
            verifiedAt: new Date(),
        });
        await this.referralRepo.save(refRow);

        await this.userRepo.update(
            { id: referredUserId },
            { referredByUserId: referrer.id },
        );

        this.logger.log(
            `Referral registered (awaiting paid plan): referrer=${referrer.id} referred=${referredUserId}`,
        );

        return {
            attributed: true,
            creditedUsd: 0,
            pendingCreditsAddedUsd: 0,
            aiDailyBonusUnlocked: false,
            tierBoostUnlocked: false,
        };
    }

    async unlockPendingCreditsOnPaidPlan(userId: string): Promise<{ unlockedUsd: number }> {
        if (!userId) return { unlockedUsd: 0 };
        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) return { unlockedUsd: 0 };

        const pending = Number(user.referralPendingCreditsUsd || 0);
        if (pending <= 0) return { unlockedUsd: 0 };

        const nextAvailable = Number((Number(user.referralCreditsUsd || 0) + pending).toFixed(2));
        await this.userRepo.update(
            { id: userId },
            {
                referralCreditsUsd: nextAvailable,
                referralPendingCreditsUsd: 0,
                referralTierBoost: true,
            },
        );
        this.logger.log(`Unlocked $${pending.toFixed(2)} pending affiliate plan credits for paid user ${userId}`);
        return { unlockedUsd: pending };
    }

    async consumeReferralCredits(userId: string, amountUsd: number): Promise<boolean> {
        const cleanAmount = Number(Number(amountUsd || 0).toFixed(2));
        if (!userId || cleanAmount <= 0) return false;

        if (typeof this.userRepo.manager?.query === 'function') {
            try {
                const updated = await this.userRepo.manager.query(
                    `
                    UPDATE "users"
                    SET "referral_credits_usd" = ROUND((COALESCE("referral_credits_usd", 0) - $2)::numeric, 2)
                    WHERE id = $1 AND COALESCE("referral_credits_usd", 0) >= $2
                    RETURNING id
                    `,
                    [userId, cleanAmount],
                );
                const rows = Array.isArray(updated?.[0]) ? updated[0] : updated;
                return Array.isArray(rows) && rows.length > 0;
            } catch {
                // fallback below for mocks
            }
        }

        const user = await this.userRepo.findOne({ where: { id: userId } });
        const avail = Number(user?.referralCreditsUsd || 0);
        if (!user || avail < cleanAmount) return false;
        await this.userRepo.update(
            { id: userId },
            { referralCreditsUsd: Number((avail - cleanAmount).toFixed(2)) },
        );
        return true;
    }

    async processPaidConversion(
        referredUserId: string,
    ): Promise<{ awarded: boolean; creditedUsd: number; pendingCreditsAddedUsd: number; tierBoostUnlocked: boolean }> {
        if (!referredUserId) {
            return { awarded: false, creditedUsd: 0, pendingCreditsAddedUsd: 0, tierBoostUnlocked: false };
        }

        const refRow = await this.referralRepo.findOne({
            where: { referredUserId },
        });
        if (!refRow || refRow.status === 'PAID') {
            return { awarded: false, creditedUsd: 0, pendingCreditsAddedUsd: 0, tierBoostUnlocked: false };
        }

        const referrer = await this.userRepo.findOne({
            where: { id: refRow.referrerUserId },
        });
        if (!referrer) {
            return { awarded: false, creditedUsd: 0, pendingCreditsAddedUsd: 0, tierBoostUnlocked: false };
        }

        const priorPaidCount = await this.referralRepo.count({
            where: {
                referrerUserId: referrer.id,
                status: 'PAID',
            },
        });
        const dayStart = new Date(Date.now() - 86_400_000);
        const recentPaidCount = await this.referralRepo.count({
            where: {
                referrerUserId: referrer.id,
                status: 'PAID',
                paidAt: MoreThanOrEqual(dayStart),
            },
        });
        const totalPaidAfter = priorPaidCount + 1;

        const hitsMilestone3 = totalPaidAfter % PLAN_CREDIT_MILESTONE_TARGET === 0;
        const milestoneRewardUsd =
            hitsMilestone3 && recentPaidCount < DAILY_REWARD_CAP
                ? this.getPaidCreditUsd()
                : 0;

        // Programa de afiliados 100% gratuito para qualquer utilizador:
        // créditos ganhos por amigos pagantes entram diretamente disponíveis (sem exigir plano pago do afiliado).
        const creditedDirectUsd = milestoneRewardUsd;
        const pendingAddedUsd = 0;
        const unlocksBoostNow =
            !referrer.referralTierBoost &&
            (totalPaidAfter >= TIER_BOOST_PAID_TARGET || totalPaidAfter >= PLAN_CREDIT_MILESTONE_TARGET);

        refRow.status = 'PAID';
        refRow.paidAt = new Date();
        refRow.rewardCreditsUsd = milestoneRewardUsd;
        if (unlocksBoostNow) {
            refRow.tierBoostAwarded = true;
        }
        await this.referralRepo.save(refRow);

        const baseMs = Math.max(
            Date.now(),
            referrer.referralAiBonusUntil ? new Date(referrer.referralAiBonusUntil).getTime() : 0,
        );
        const renewedBonusUntil = new Date(baseMs + INVITE_AI_BONUS_DAYS * 86_400_000);
        const nextCredits = Number((Number(referrer.referralCreditsUsd || 0) + creditedDirectUsd).toFixed(2));
        const nextPending = Number((Number(referrer.referralPendingCreditsUsd || 0) + pendingAddedUsd).toFixed(2));

        await this.userRepo.update(
            { id: referrer.id },
            {
                referralCreditsUsd: nextCredits,
                referralPendingCreditsUsd: nextPending,
                referralAiBonusUntil: renewedBonusUntil,
                ...(unlocksBoostNow ? { referralTierBoost: true } : {}),
            },
        );

        let unlockedPendingUsd = 0;
        if (nextPending > 0) {
            const res = await this.unlockPendingCreditsOnPaidPlan(referrer.id);
            unlockedPendingUsd = res.unlockedUsd;
        }

        const totalCreditedNow = Number((creditedDirectUsd + unlockedPendingUsd).toFixed(2));

        this.logger.log(
            `Referral paid conversion approved: referrer=${referrer.id} referred=${referredUserId} boost=${unlocksBoostNow} credited=$${totalCreditedNow} pending=+$${pendingAddedUsd}`,
        );

        return {
            awarded: true,
            creditedUsd: totalCreditedNow,
            pendingCreditsAddedUsd: pendingAddedUsd,
            tierBoostUnlocked: unlocksBoostNow,
        };
    }

    async getMySummary(userId: string, _context?: string) {
        const [user, hasPaidSubscription] = await Promise.all([
            this.userRepo.findOne({
                where: { id: userId },
                select: [
                    'id',
                    'referralCode',
                    'referralCreditsUsd',
                    'referralPendingCreditsUsd',
                    'referralAiBonusUntil',
                    'referralTierBoost',
                ],
            }),
            this.hasActivePaidSubscription(userId),
        ]);

        // Programa de afiliados aberto e gratuito para todos os utilizadores (sem paywall de upgrade)
        const affiliateApproved = true;
        const referralCode = await this.ensureReferralCode(userId);

        let availableCreditsUsd = Number(user?.referralCreditsUsd || 0);
        let pendingCreditsUsd = Number(user?.referralPendingCreditsUsd || 0);
        if (pendingCreditsUsd > 0) {
            const unlocked = await this.unlockPendingCreditsOnPaidPlan(userId);
            if (unlocked.unlockedUsd > 0) {
                availableCreditsUsd = Number((availableCreditsUsd + unlocked.unlockedUsd).toFixed(2));
                pendingCreditsUsd = 0;
            }
        }

        const rows = await this.referralRepo.find({
            where: { referrerUserId: userId },
            order: { createdAt: 'DESC' },
            take: 100,
        });

        const referredIds = rows.map((r) => r.referredUserId).filter(Boolean);
        const referredUsers =
            referredIds.length > 0
                ? await this.userRepo.find({
                      where: { id: In(referredIds) },
                      select: ['id', 'username'],
                  })
                : [];
        const usernameMap = new Map(referredUsers.map((u) => [u.id, u.username || 'trader']));

        const paidCount = rows.filter((r) => r.status === 'PAID').length;
        const pendingPaymentCount = rows.filter((r) => r.status !== 'PAID').length;

        const aiBonusExpiresAt = user?.referralAiBonusUntil
            ? new Date(user.referralAiBonusUntil)
            : null;
        const aiBonusActive = Boolean(
            aiBonusExpiresAt && aiBonusExpiresAt.getTime() > Date.now(),
        );

        const frontendBase = resolveFrontendUrl();
        const shareUrl = referralCode
            ? `${frontendBase}/register?ref=${encodeURIComponent(referralCode)}`
            : '';

        return {
            affiliateApproved,
            referralCode,
            shareUrl,
            creditsUsd: availableCreditsUsd,
            pendingCreditsUsd,
            hasPaidSubscription,
            aiDailyBonusCredits: aiBonusActive ? INVITE_AI_DAILY_BONUS : 0,
            aiBonusExpiresAt: aiBonusExpiresAt ? aiBonusExpiresAt.toISOString() : null,
            tierBoostUnlocked: Boolean(user?.referralTierBoost),
            rules: {
                invite1AiDailyBonus: INVITE_AI_DAILY_BONUS,
                invite1DurationDays: INVITE_AI_BONUS_DAYS,
                invite3PlanCreditUsd: PLAN_CREDIT_MILESTONE_USD,
                requiresPaidPlanForFull10Usd: false,
                requiresPaidPlanApproval: false,
                perVerifiedUsd: this.getVerifyCreditUsd(),
                perPaidUsd: this.getPaidCreditUsd(),
                tierBoostVerifiedTarget: PLAN_CREDIT_MILESTONE_TARGET,
                tierBoostPaidTarget: TIER_BOOST_PAID_TARGET,
            },
            counts: {
                total: rows.length,
                verified: paidCount,
                paid: paidCount,
                pendingPayment: pendingPaymentCount,
            },
            referrals: rows.map((r) => ({
                id: r.id,
                referredUsername: usernameMap.get(r.referredUserId) || 'trader',
                status: r.status,
                rewardCreditsUsd: Number(r.rewardCreditsUsd || 0),
                tierBoostAwarded: Boolean(r.tierBoostAwarded),
                verifiedAt: r.verifiedAt ? new Date(r.verifiedAt).toISOString() : null,
                paidAt: r.paidAt ? new Date(r.paidAt).toISOString() : null,
                createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
            })),
        };
    }
}
