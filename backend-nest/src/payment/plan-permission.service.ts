import { Injectable, ForbiddenException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription, SubscriptionStatus } from './subscription.entity';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

export enum PlanTier {
    FREE = 'FREE',
    BASIC = 'BASIC',
    PREMIUM = 'PREMIUM',
}

@Injectable()
export class PlanPermissionService {
    constructor(
        @InjectRepository(Subscription)
        private subscriptionRepo: Repository<Subscription>,
        @Inject(CACHE_MANAGER)
        private cacheManager: Cache,
    ) { }

    async getFullUserSubscription(userId: string): Promise<Subscription | null> {
        const sub = await this.subscriptionRepo.findOne({
            where: {
                userId,
                status: SubscriptionStatus.ACTIVE,
            },
            relations: ['planConfig'],
        });

        if (!sub) return null;

        const now = new Date();
        if (sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() < now.getTime()) {
            return null;
        }

        return sub;
    }

    async getCachedUserSubscription(userId: string): Promise<any | null> {
        const cacheKey = `user_subscription_status:${userId}`;
        const cached = await this.cacheManager.get<string>(cacheKey);
        if (cached) {
            if (cached === 'null') return null;
            try {
                return JSON.parse(cached);
            } catch {
                // Ignore parse error
            }
        }

        const sub = await this.getFullUserSubscription(userId);
        if (!sub) {
            await this.cacheManager.set(cacheKey, 'null', 300000); // cache null for 5 mins
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
            } : null
        };

        await this.cacheManager.set(cacheKey, JSON.stringify(mappedSub), 3600000); // 1 hour
        return mappedSub;
    }

    async getUserPlan(userId: string): Promise<PlanTier> {
        const cacheKey = `user_plan_tier:${userId}`;
        const cachedPlan = await this.cacheManager.get<PlanTier>(cacheKey);
        if (cachedPlan) {
            return cachedPlan;
        }

        const activeSub = await this.getFullUserSubscription(userId);
        let tier = PlanTier.FREE;

        if (activeSub) {
            const t = activeSub.planConfig?.tier?.toUpperCase();
            if (t === 'PREMIUM' || t === 'PRO') tier = PlanTier.PREMIUM;
            else if (t === 'BASIC') tier = PlanTier.BASIC;
        }

        await this.cacheManager.set(cacheKey, tier, 3600000); // 1 hour
        return tier;
    }

    async checkPermission(userId: string, requiredTier: PlanTier): Promise<boolean> {
        const userPlan = await this.getUserPlan(userId);

        if (requiredTier === PlanTier.PREMIUM) {
            return userPlan === PlanTier.PREMIUM;
        }

        if (requiredTier === PlanTier.BASIC) {
            return userPlan === PlanTier.BASIC || userPlan === PlanTier.PREMIUM;
        }

        return true;
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
