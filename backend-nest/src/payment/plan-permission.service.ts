import { Injectable, ForbiddenException, Inject, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription, SubscriptionStatus } from './subscription.entity';
import { UserEntity } from '../users/user.entity';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

export enum PlanTier {
    FREE = 'FREE',
    BASIC = 'BASIC',
    PRO = 'PRO',
    PREMIUM = 'PREMIUM',
}

export const AI_DAILY_CREDITS_BY_TIER: Record<PlanTier, number> = {
    [PlanTier.FREE]: 0,
    [PlanTier.BASIC]: 100,
    [PlanTier.PRO]: 1500,
    [PlanTier.PREMIUM]: 4000,
};

export const AI_MONTHLY_CREDITS_BY_TIER = AI_DAILY_CREDITS_BY_TIER;

const TIER_RANK: Record<PlanTier, number> = {
    [PlanTier.FREE]: 0,
    [PlanTier.BASIC]: 1,
    [PlanTier.PRO]: 2,
    [PlanTier.PREMIUM]: 3,
};

export function resolvePlanTierFromString(rawTier?: string | null): PlanTier {
    const t = String(rawTier || '').trim().toUpperCase();
    if (t === 'PREMIUM' || t === 'ELITE' || t === 'VIP' || t === 'ENTERPRISE') {
        return PlanTier.PREMIUM;
    }
    if (t === 'PRO') {
        return PlanTier.PRO;
    }
    if (t === 'BASIC' || t === 'BASICO') {
        return PlanTier.BASIC;
    }
    return PlanTier.FREE;
}

export function resolveDefaultDailyCredits(rawTier?: string | null, configuredCredits?: number | null): number {
    if (typeof configuredCredits === 'number' && configuredCredits >= 0) {
        return configuredCredits;
    }
    const tier = resolvePlanTierFromString(rawTier);
    return AI_DAILY_CREDITS_BY_TIER[tier] ?? 0;
}

@Injectable()
export class PlanPermissionService {
    constructor(
        @InjectRepository(Subscription)
        private subscriptionRepo: Repository<Subscription>,
        @Inject(CACHE_MANAGER)
        private cacheManager: Cache,
        @Optional()
        @InjectRepository(UserEntity)
        private userRepo?: Repository<UserEntity>,
    ) { }

    async getFullUserSubscription(userId: string): Promise<Subscription | null> {
        const subs = await this.subscriptionRepo.find({
            where: {
                userId,
                status: SubscriptionStatus.ACTIVE,
            },
            relations: ['planConfig'],
        });

        if (!subs || subs.length === 0) return null;

        const nowMs = Date.now();
        const validSubs = subs.filter(
            (sub) => !sub.currentPeriodEnd || new Date(sub.currentPeriodEnd).getTime() > nowMs,
        );

        if (validSubs.length === 0) return null;

        validSubs.sort((a, b) => {
            const rankA = TIER_RANK[resolvePlanTierFromString(a.planConfig?.tier)] ?? 0;
            const rankB = TIER_RANK[resolvePlanTierFromString(b.planConfig?.tier)] ?? 0;
            if (rankB !== rankA) return rankB - rankA;
            const expA = a.currentPeriodEnd ? new Date(a.currentPeriodEnd).getTime() : 0;
            const expB = b.currentPeriodEnd ? new Date(b.currentPeriodEnd).getTime() : 0;
            return expB - expA;
        });

        return validSubs[0];
    }

    async getCachedUserSubscription(userId: string): Promise<any | null> {
        const cacheKey = `user_subscription_status:${userId}`;
        try {
            const cached = await this.cacheManager.get<string>(cacheKey);
            if (cached) {
                if (cached === 'null') return null;
                try {
                    const parsed = JSON.parse(cached);
                    const periodEndMs = parsed?.currentPeriodEnd
                        ? new Date(parsed.currentPeriodEnd).getTime()
                        : null;
                    if (!periodEndMs || periodEndMs > Date.now()) {
                        return parsed;
                    }
                    await this.cacheManager.del(cacheKey);
                } catch {
                    // Ignore parse error
                }
            }
        } catch (err) {
            console.warn(`[PlanPermissionService] Cache get failed: ${err.message}`);
        }

        const sub = await this.getFullUserSubscription(userId);
        if (!sub) {
            try {
                await this.cacheManager.set(cacheKey, 'null', 300000); // cache null for 5 mins
            } catch (err) {
                console.warn(`[PlanPermissionService] Cache set failed: ${err.message}`);
            }
            return null;
        }

        // Map sub to avoid circular references/large payload in redis
        const mappedSub = {
            id: sub.id,
            status: sub.status,
            currentPeriodEnd: sub.currentPeriodEnd,
            planConfig: sub.planConfig ? {
                id: sub.planConfig.id,
                tier: sub.planConfig.tier,
                aiDailyCredits: sub.planConfig.aiDailyCredits ?? null,
            } : null
        };

        try {
            const remainingMs = sub.currentPeriodEnd
                ? new Date(sub.currentPeriodEnd).getTime() - Date.now()
                : 300000;
            const ttlMs = Math.max(5000, Math.min(300000, remainingMs));
            await this.cacheManager.set(cacheKey, JSON.stringify(mappedSub), ttlMs);
        } catch (err) {
            console.warn(`[PlanPermissionService] Cache set failed: ${err.message}`);
        }
        return mappedSub;
    }

    async getUserPlan(userId: string): Promise<PlanTier> {
        const cacheKey = `user_plan_tier:${userId}`;
        try {
            const cachedRaw = await this.cacheManager.get<string>(cacheKey);
            if (cachedRaw) {
                try {
                    const parsed = JSON.parse(cachedRaw);
                    if (
                        parsed &&
                        Object.values(PlanTier).includes(parsed.tier) &&
                        (!parsed.expiresAt || Number(parsed.expiresAt) > Date.now())
                    ) {
                        return parsed.tier as PlanTier;
                    }
                } catch {
                    // Legacy bare string cache entry — invalidate so expiry cannot be bypassed
                }
                await this.cacheManager.del(cacheKey);
            }
        } catch (err) {
            console.warn(`[PlanPermissionService] Cache get failed: ${err.message}`);
        }

        const activeSub = await this.getFullUserSubscription(userId);
        const tier = activeSub
            ? resolvePlanTierFromString(activeSub.planConfig?.tier)
            : PlanTier.FREE;

        const expiresAt = activeSub?.currentPeriodEnd
            ? new Date(activeSub.currentPeriodEnd).getTime()
            : null;
        const ttlMs = expiresAt
            ? Math.max(5000, Math.min(300000, expiresAt - Date.now()))
            : 300000;

        try {
            await this.cacheManager.set(cacheKey, JSON.stringify({ tier, expiresAt }), ttlMs);
        } catch (err) {
            console.warn(`[PlanPermissionService] Cache set failed: ${err.message}`);
        }
        return tier;
    }

    async getUserAiDailyAllowance(userId: string): Promise<{
        tier: PlanTier;
        rawTier: string;
        dailyLimit: number;
    }> {
        const [activeSub, user] = await Promise.all([
            this.getFullUserSubscription(userId),
            this.userRepo
                ? this.userRepo
                      .findOne({
                          where: { id: userId },
                          select: ['id', 'referralAiBonusUntil'],
                      })
                      .catch(() => null)
                : Promise.resolve(null),
        ]);

        const bonusExpiresAt = user?.referralAiBonusUntil
            ? new Date(user.referralAiBonusUntil).getTime()
            : 0;
        const referralDailyBonus = bonusExpiresAt > Date.now() ? 50 : 0;

        if (!activeSub) {
            return {
                tier: PlanTier.FREE,
                rawTier: 'FREE',
                dailyLimit: referralDailyBonus,
            };
        }
        const rawTier = String(activeSub.planConfig?.tier || 'BASIC').toUpperCase();
        const tier = resolvePlanTierFromString(rawTier);
        const baseLimit = resolveDefaultDailyCredits(
            rawTier,
            activeSub.planConfig?.aiDailyCredits
        );
        return { tier, rawTier, dailyLimit: baseLimit + referralDailyBonus };
    }

    async checkPermission(userId: string, requiredTier: PlanTier): Promise<boolean> {
        const userPlan = await this.getUserPlan(userId);
        return (TIER_RANK[userPlan] ?? 0) >= (TIER_RANK[requiredTier] ?? 0);
    }

    async enforcePermission(userId: string, requiredTier: PlanTier) {
        const hasPermission = await this.checkPermission(userId, requiredTier);
        if (!hasPermission) {
            throw new ForbiddenException(`Funcionalidade restrita ao plano ${requiredTier}`);
        }
    }

    async invalidateUserPlanCache(userId: string): Promise<void> {
        await this.cacheManager.del(`user_plan_tier:${userId}`).catch(() => {});
        await this.cacheManager.del(`user_subscription_status:${userId}`).catch(() => {});
    }
}
