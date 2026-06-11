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

        const basicoPrice = basicPlan ? Number(basicPlan.monthlyPrice) : this.configService.get<number>('PLANO_BASICO_PRICE', 1);
        const premiumPrice = proPlan ? Number(proPlan.monthlyPrice) : this.configService.get<number>('PLANO_PREMIUN_PRICE', 1);

        return {
            basicoPrice,
            premiumPrice,
            exchangeRate: this.configService.get<number>('EXCENCHE', 65),
        };
    }
}
