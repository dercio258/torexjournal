import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubscriptionPlanConfig } from './subscription-plan.entity';

@Injectable()
export class PaymentService {
    private readonly logger = new Logger(PaymentService.name);

    constructor(
        private configService: ConfigService,
        @InjectRepository(SubscriptionPlanConfig)
        private planConfigRepo: Repository<SubscriptionPlanConfig>,
    ) { }

    async getPricingConfig() {
        const basicPlan = await this.planConfigRepo.findOne({ where: { tier: 'BASIC' } });
        const proPlan = await this.planConfigRepo.findOne({ where: { tier: 'PRO' } });
        const premiumPlan = await this.planConfigRepo.findOne({ where: { tier: 'PREMIUM' } });

        const basicoPrice = basicPlan
            ? Number(basicPlan.monthlyPrice)
            : Number(this.configService.get<number>('PLANO_BASICO_PRICE', 9));
        const proPrice = proPlan
            ? Number(proPlan.monthlyPrice)
            : Number(this.configService.get<number>('PLANO_PRO_PRICE') ?? this.configService.get<number>('PLANO_PREMIUN_PRICE', 19));
        const premiumPrice = premiumPlan
            ? Number(premiumPlan.monthlyPrice)
            : Number(this.configService.get<number>('PLANO_PREMIUM_PRICE', Math.max(proPrice * 2, 39)));

        const rateFromEnv =
            this.configService.get<number>('EXCHANGE_RATE') ??
            this.configService.get<number>('EXCHANGE') ??
            this.configService.get<number>('EXCENCHE');
        const rateFromDb = Number(basicPlan?.usdToMznRate || 0);
        const exchangeRate = Number.isFinite(Number(rateFromEnv)) && Number(rateFromEnv) > 0
            ? Number(rateFromEnv)
            : rateFromDb > 0
              ? rateFromDb
              : 74;

        return {
            basicoPrice,
            proPrice,
            premiumPrice,
            exchangeRate,
        };
    }
}
