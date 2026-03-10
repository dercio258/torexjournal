import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription, SubscriptionStatus } from './subscription.entity';

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
    ) { }

    async getFullUserSubscription(userId: string): Promise<Subscription | null> {
        return this.subscriptionRepo.findOne({
            where: {
                userId,
                status: SubscriptionStatus.ACTIVE,
            },
            relations: ['planConfig'],
        });
    }

    async getUserPlan(userId: string): Promise<PlanTier> {
        const activeSub = await this.getFullUserSubscription(userId);

        if (!activeSub) return PlanTier.FREE;

        const tier = activeSub.planConfig?.tier?.toUpperCase();
        if (tier === 'PREMIUM' || tier === 'PRO') return PlanTier.PREMIUM;
        if (tier === 'BASIC') return PlanTier.BASIC;

        return PlanTier.FREE;
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
}
