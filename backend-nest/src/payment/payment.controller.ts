import { Controller, Get, Post, Body, Res, HttpStatus } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { Response } from 'express';

@Controller('payment')
export class PaymentController {
    constructor(private readonly paymentService: PaymentService) { }

    @Get('pricing-config')
    async getPricingConfig(@Res() res: Response) {
        const config = await this.paymentService.getPricingConfig();
        return res.status(HttpStatus.OK).json(config);
    }
}
