import { Controller, Post, Body, Logger, Req, Headers, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { timingSafeEqualStr } from '../common/security/security.config';

@Controller('webhook')
export class WebhookController {
    private readonly logger = new Logger(WebhookController.name);

    constructor(
        private readonly subscriptionService: SubscriptionService,
        private readonly configService: ConfigService
    ) { }

    private verifySignature(req: any, signature: string) {
        const secret = this.configService.get<string>('DEBITO_WEBHOOK_SECRET') || this.configService.get<string>('WEBHOOK_SECRET', '');
        const isProd = this.configService.get<string>('NODE_ENV') === 'production';

        if (!secret) {
            if (isProd) {
                this.logger.error('CRITICAL: DEBITO_WEBHOOK_SECRET / WEBHOOK_SECRET is not configured in production.');
                throw new UnauthorizedException('Webhook signature verification not configured');
            }
            this.logger.warn('Webhook secret is not configured in non-production. Skipping signature verification.');
            return;
        }

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
            this.logger.error('Invalid signature on webhook');
            throw new UnauthorizedException('Invalid signature');
        }
        this.logger.log('Signature verified successfully.');
    }

    @Post()
    @Post('debito')
    @Post('c2b/emola')
    @Post('c2b/bank')
    async handleWebhook(@Req() req: any, @Body() body: any, @Headers('x-webhook-signature') signature: string) {
        this.logger.log(`Received unified webhook.`);

        // Verify HMAC-SHA256 signature BEFORE trusting or processing payload
        this.verifySignature(req, signature);

        // Extract reference/payment_id to poll and audit-confirm the status
        let reference = body?.reference_description || body?.reference;
        if (body?.event && body?.data) {
            reference = body.data.reference || body.data.payment_id;
        }

        if (reference) {
            this.logger.log(`[Audit Log] Confirming status via polling check for reference: ${reference}`);
            // Always verify payment status directly via gateway API; do NOT fall back to trusting unverified body on polling error
            await this.subscriptionService.handleDebitoStatusUpdate(reference);
            this.logger.log(`[Audit Log] Polling verification check completed successfully for reference: ${reference}`);
        } else {
            this.logger.warn('[Audit Log] No transaction reference found in verified webhook payload. Processing payload.');
            await this.subscriptionService.processDebitoWebhook(body);
        }

        return { success: true };
    }
}
