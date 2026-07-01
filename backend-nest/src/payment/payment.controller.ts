import { Controller, Get } from '@nestjs/common';
import { PaymentService } from './payment.service';

@Controller('payment')
export class PaymentController {
    constructor(private readonly paymentService: PaymentService) { }

    @Get('pricing-config')
    async getPricingConfig() {
        return this.paymentService.getPricingConfig();
    }
}
