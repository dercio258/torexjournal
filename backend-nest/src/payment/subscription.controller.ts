import { Controller, Post, Get, Body, Param, Headers, BadRequestException, Logger, UseGuards, Request } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { SubscriptionCycle } from './subscription.entity';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';

@Controller('subscription')
export class SubscriptionController {
    private readonly logger = new Logger(SubscriptionController.name);

    constructor(
        private readonly subscriptionService: SubscriptionService,
        private readonly configService: ConfigService
    ) { }

    @Get('plans')
    async getActivePlans() {
        return this.subscriptionService.getActivePlans();
    }

    @UseGuards(AuthGuard('jwt'))
    @Get('status')
    async getStatus(@Request() req) {
        return this.subscriptionService.getSubscriptionStatus(req.user.id);
    }

    @UseGuards(AuthGuard('jwt'))
    @Post('subscribe/mobile')
    async subscribeMobile(@Request() req, @Body() body: { tier: string, cycle: string, paymentMethod: 'mpesa' | 'emola', phoneNumber: string, savePreference?: boolean }) {
        return this.subscriptionService.createMobileSubscription(
            req.user.id,
            body.tier as any,
            body.cycle as any,
            body.paymentMethod,
            body.phoneNumber,
            body.savePreference
        );
    }

    @UseGuards(AuthGuard('jwt'))
    @Post('subscribe/card')
    async subscribeCard(@Request() req, @Body() body: { tier: string, cycle: string, returnUrl: string, cancelUrl: string, phoneNumber?: string }) {
        return this.subscriptionService.createCardSubscription(
            req.user.id,
            body.tier as any,
            body.cycle as any,
            body.returnUrl,
            body.cancelUrl,
            body.phoneNumber
        );
    }

    @UseGuards(AuthGuard('jwt'))
    @Post('renew')
    async renewAuto(@Request() req) {
        return this.subscriptionService.renewActiveSubscription(req.user.id);
    }

    // --- Debito Status Sync (Manual or via simple status check) ---
    @Post('check-status/:reference')
    async checkStatus(@Param('reference') reference: string) {
        await this.subscriptionService.handleDebitoStatusUpdate(reference);
        return { status: 'checked' };
    }

    @Post('debito-webhook')
    async debitoWebhook(@Body() body: any) {
        await this.subscriptionService.processDebitoWebhook(body);
        return { success: true };
    }
}
