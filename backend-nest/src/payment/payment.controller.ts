import { Controller, Get, Optional } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { SubscriptionService } from './subscription.service';

@Controller('payment')
export class PaymentController {
    constructor(
        private readonly paymentService: PaymentService,
        @Optional() private readonly subscriptionService?: SubscriptionService,
    ) { }

    @Get('pricing-config')
    async getPricingConfig() {
        return this.paymentService.getPricingConfig();
    }

    @Get('plans')
    async getPublicPlans() {
        if (!this.subscriptionService) return [];
        return this.subscriptionService.getActivePlans();
    }
}
