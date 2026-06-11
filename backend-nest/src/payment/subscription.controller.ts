import { Controller, Post, Get, Body, Param, Headers, Query, Res, Req, BadRequestException, Logger, UseGuards, Request } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { SubscriptionCycle } from './subscription.entity';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';

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
    async subscribeCard(
        @Request() req, 
        @Body() body: { 
            tier: string; 
            cycle: string; 
            returnUrl: string; 
            cancelUrl: string; 
            phoneNumber?: string;
            paymentMethod?: 'card' | 'payfast';
        }
    ) {
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

    @UseGuards(AuthGuard('jwt'))
    @Post('renew')
    async renewAuto(@Request() req) {
        return this.subscriptionService.renewActiveSubscription(req.user.id);
    }

    @UseGuards(AuthGuard('jwt'))
    @Post('warned')
    async markWarningAsShown(@Request() req) {
        return this.subscriptionService.markWarningAsShown(req.user.id);
    }

    // --- Debito Status Sync (Manual or via simple status check) ---
    @Post('check-status/:reference')
    async checkStatus(@Param('reference') reference: string) {
        await this.subscriptionService.handleDebitoStatusUpdate(reference);
        return { status: 'checked' };
    }

    // Redirect status callback route
    @Get('payment/status/card')
    @Get('paymet/staus/card')
    async handleCardStatusRedirect(@Query('reference') reference: string, @Res() res: Response) {
        this.logger.log(`User returned from gateway for reference: ${reference}`);
        
        if (reference) {
            try {
                await this.subscriptionService.handleDebitoStatusUpdate(reference);
            } catch (err) {
                this.logger.error(`Error checking status on redirect: ${err.message}`);
            }
        }
        
        const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3001';
        return res.redirect(`${frontendUrl}/subscription/success?subscription_id=${reference}`);
    }

    @Post('debito-webhook')
    async debitoWebhook(@Req() req: any, @Body() body: any, @Headers('x-webhook-signature') signature: string) {
        this.logger.log(`Received debito-webhook. Signature header: ${signature}`);
        
        // Audit log
        this.logger.log(`[Audit Log] Received debito-webhook payload: ${JSON.stringify(body)}`);

        const secret = this.configService.get<string>('DEBITO_WEBHOOK_SECRET') || this.configService.get<string>('WEBHOOK_SECRET', '');
        if (secret) {
            if (!signature) {
                this.logger.error('Missing signature for webhook verification');
                throw new BadRequestException('Missing x-webhook-signature header');
            }

            const rawBody = req.rawBody;
            if (!rawBody) {
                this.logger.error('rawBody not available in request. Make sure rawBody support is enabled in NestJS app setup.');
                throw new BadRequestException('Raw body not available');
            }

            const crypto = require('crypto');
            const hash = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
            if (hash !== signature) {
                this.logger.error('Invalid signature on debito-webhook');
                throw new BadRequestException('Invalid signature');
            }
            this.logger.log('Signature verified successfully.');
        } else {
            this.logger.warn('Webhook secret is not configured. Skipping signature verification.');
        }

        // Extract reference/payment_id to poll and audit-confirm the status
        let reference = body.reference_description || body.reference;
        if (body.event && body.data) {
            reference = body.data.reference || body.data.payment_id;
        }

        if (reference) {
            this.logger.log(`[Audit Log] Confirming status via polling check for reference: ${reference}`);
            try {
                // Poll check-status API directly to audit and verify status updates
                await this.subscriptionService.handleDebitoStatusUpdate(reference);
                this.logger.log(`[Audit Log] Polling verification check completed successfully for reference: ${reference}`);
            } catch (err) {
                this.logger.error(`[Audit Log] Polling verification check failed for reference ${reference}: ${err.message}. Falling back to payload processing.`);
                // Fallback to direct webhook payload processing if polling fails
                await this.subscriptionService.processDebitoWebhook(body);
            }
        } else {
            this.logger.warn('[Audit Log] No transaction reference found in webhook payload. Processing payload directly.');
            await this.subscriptionService.processDebitoWebhook(body);
        }

        return { success: true };
    }
}
