import { Controller, Post, Get, Body, Param, Headers, BadRequestException, Logger } from '@nestjs/common';
import { PaypalSubscriptionsService } from './paypal-subscription.service';
import { SubscriptionCycle } from './subscription.entity';
// import { TradingTier } from './subscription-plan.entity';
import { ConfigService } from '@nestjs/config';

@Controller('subscription')
export class SubscriptionController { // Ensure naming is unique if needed
    private readonly logger = new Logger(SubscriptionController.name);

    constructor(
        private readonly subscriptionService: PaypalSubscriptionsService,
        private readonly configService: ConfigService
    ) { }

    // --- Admin Endpoints ---
    @Post('plans')
    async syncPlans() {
        return this.subscriptionService.syncPlans();
    }

    @Get('plans')
    async getActivePlans() {
        return this.subscriptionService.getActivePlans();
    }

    // --- Client Endpoints ---
    @Post('subscribe')
    async createSubscription(@Body() body: { userId: string, tier: string, cycle: string, returnUrl: string, cancelUrl: string }) {
        // Validation (basic)
        // In real app, get userId from AuthGuard
        return this.subscriptionService.createSubscription(
            body.userId,
            body.tier as any,
            body.cycle as any,
            body.returnUrl,
            body.cancelUrl
        );
    }

    // --- Webhook ---
    @Post('webhook')
    async handleWebhook(@Headers() headers, @Body() body) {
        const webhookId = this.configService.get<string>('PAYPAL_WEBHOOK_ID');
        if (webhookId) {
            const isValid = await this.subscriptionService.verifyWebhookSignature(headers, body, webhookId);
            if (!isValid) {
                this.logger.warn('Invalid Webhook Signature');
                throw new BadRequestException('Invalid Signature');
            }
        } else {
            this.logger.warn('PAYPAL_WEBHOOK_ID not set, skipping signature verification');
        }

        // Process event asynchronously to avoid timeouts?
        // For now, await it
        await this.subscriptionService.handleWebhookEvent(body);
        return { status: 'received' };
    }
}
