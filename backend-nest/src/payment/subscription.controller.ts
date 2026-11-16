import { Controller, Post, Get, Body, Param, Headers, Query, Res, Req, BadRequestException, UnauthorizedException, Logger, UseGuards, Request } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';
import { FastifyReply } from 'fastify';
import * as crypto from 'crypto';
import { timingSafeEqualStr } from '../common/security/security.config';
import { SubscribeMobileDto, SubscribeCardDto } from './dto/subscription.dto';

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

    @UseGuards(JwtAuthGuard)
    @Get('status')
    async getStatus(@Request() req) {
        return this.subscriptionService.getSubscriptionStatus(req.user.id);
    }

    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { limit: 10, ttl: 60000 } })
    @Post('subscribe/mobile')
    async subscribeMobile(@Request() req, @Body() body: SubscribeMobileDto) {
        return this.subscriptionService.createMobileSubscription(
            req.user.id,
            body.tier as any,
            body.cycle as any,
            body.paymentMethod,
            body.phoneNumber,
            body.savePreference
        );
    }

    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { limit: 10, ttl: 60000 } })
    @Post('subscribe/card')
    async subscribeCard(@Request() req, @Body() body: SubscribeCardDto) {
        return this.subscriptionService.createCardSubscription(
            req.user.id,
            body.tier as any,
            body.cycle as any,
            body.returnUrl,
            body.cancelUrl,
            body.phoneNumber,
            body.paymentMethod || 'card'
        );
    }

    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { limit: 10, ttl: 60000 } })
    @Post('renew')
    async renewAuto(@Request() req) {
        return this.subscriptionService.renewActiveSubscription(req.user.id);
    }

    @UseGuards(JwtAuthGuard)
    @Post('warned')
    async markWarningAsShown(@Request() req) {
        return this.subscriptionService.markWarningAsShown(req.user.id);
    }

    // --- Debito Status Sync (Authenticated & ownership-verified) ---
    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { limit: 10, ttl: 60000 } })
    @Post('check-status/:reference')
    async checkStatus(@Request() req, @Param('reference') reference: string) {
        await this.subscriptionService.handleDebitoStatusUpdate(reference, req.user.id);
        return { status: 'checked' };
    }

    // Redirect status callback route
    @Get('payment/status/card')
    @Get('paymet/staus/card')
    async handleCardStatusRedirect(@Query('reference') reference: string, @Res() res: FastifyReply) {
        this.logger.log(`User returned from gateway for reference: ${reference}`);
        
        if (reference) {
            try {
                await this.subscriptionService.handleDebitoStatusUpdate(reference);
            } catch (err) {
                this.logger.error(`Error checking status on redirect: ${err.message}`);
            }
        }
        
        const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3001';
        return res.redirect(`${frontendUrl}/subscription/success?subscription_id=${encodeURIComponent(reference || '')}`);
    }

    @Post('debito-webhook')
    async debitoWebhook(@Req() req: any, @Body() body: any, @Headers('x-webhook-signature') signature: string) {
        this.logger.log(`Received debito-webhook.`);

        const secret = this.configService.get<string>('DEBITO_WEBHOOK_SECRET') || this.configService.get<string>('WEBHOOK_SECRET', '');
        const isProd = this.configService.get<string>('NODE_ENV') === 'production';

        if (!secret) {
            if (isProd) {
                this.logger.error('CRITICAL: DEBITO_WEBHOOK_SECRET / WEBHOOK_SECRET is not configured in production.');
                throw new UnauthorizedException('Webhook signature verification not configured');
            }
            this.logger.warn('Webhook secret is not configured in non-production. Skipping signature verification.');
        } else {
            if (!signature) {
                this.logger.error('Missing signature for webhook verification');
                throw new BadRequestException('Missing x-webhook-signature header');
            }

            const rawBody = req.rawBody;
            if (!rawBody) {
                this.logger.error('rawBody not available in request. Make sure rawBody support is enabled in NestJS app setup.');
                throw new BadRequestException('Raw body not available');
            }

            const hash = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
            const normalizedSig = signature.replace(/^sha256=/i, '').trim();
            if (!timingSafeEqualStr(hash, normalizedSig)) {
                this.logger.error('Invalid signature on debito-webhook');
                throw new UnauthorizedException('Invalid signature');
            }
            this.logger.log('Signature verified successfully.');
        }

        // Extract reference/payment_id to poll and audit-confirm the status
        let reference = body?.reference_description || body?.reference;
        if (body?.event && body?.data) {
            reference = body.data.reference || body.data.payment_id;
        }

        if (reference) {
            this.logger.log(`[Audit Log] Confirming status via polling check for reference: ${reference}`);
            // Always verify payment status directly via gateway API; do NOT fall back to trusting unverified payload on polling error
            await this.subscriptionService.handleDebitoStatusUpdate(reference);
            this.logger.log(`[Audit Log] Polling verification check completed successfully for reference: ${reference}`);
        } else {
            this.logger.warn('[Audit Log] No transaction reference found in verified webhook payload. Processing payload.');
            await this.subscriptionService.processDebitoWebhook(body);
        }

        return { success: true };
    }
}
