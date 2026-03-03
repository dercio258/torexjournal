import { Controller, Get, Post, Body, Res, HttpStatus } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { Response } from 'express';

@Controller('payment')
export class PaymentController {
    constructor(private readonly paymentService: PaymentService) { }

    @Get('config')
    getConfig(@Res() res: Response) {
        const clientId = this.paymentService.getClientId();
        return res.status(HttpStatus.OK).json({ clientId });
    }

    @Post('create-order')
    async createOrder(@Body() body: { amount: string }, @Res() res: Response) {
        try {
            const order = await this.paymentService.createOrder(body.amount);
            return res.status(HttpStatus.CREATED).json(order);
        } catch (error) {
            return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'Error creating order' });
        }
    }

    @Post('capture-order')
    async captureOrder(@Body() body: { orderId: string }, @Res() res: Response) {
        try {
            const capture = await this.paymentService.captureOrder(body.orderId);
            return res.status(HttpStatus.OK).json(capture);
        } catch (error) {
            return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'Error capturing order' });
        }
    }
}
