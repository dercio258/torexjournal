import { Controller, Post, Body, Logger, Req, Headers, BadRequestException } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { ConfigService } from '@nestjs/config';

@Controller('webhook')
export class WebhookController {
    private readonly logger = new Logger(WebhookController.name);

    constructor(
        private readonly subscriptionService: SubscriptionService,
        private readonly configService: ConfigService
    ) { }

    private verifySignature(req: any, signature: string) {
        const secret = this.configService.get<string>('DEBITO_WEBHOOK_SECRET') || this.configService.get<string>('WEBHOOK_SECRET', '');
        if (!secret) {
            this.logger.warn('Webhook secret is not configured. Skipping signature verification.');
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

        const crypto = require('crypto');
        const hash = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
        if (hash !== signature) {
            this.logger.error('Invalid signature on webhook');
            throw new BadRequestException('Invalid signature');
        }
        this.logger.log('Signature verified successfully.');
    }

    @Post()
    @Post('debito')
    @Post('c2b/emola')
    @Post('c2b/bank')
    async handleWebhook(@Req() req: any, @Body() body: any, @Headers('x-webhook-signature') signature: string) {
        this.logger.log(`Received unified webhook. Signature header: ${signature}`);
        
        // Audit log
        this.logger.log(`[Audit Log] Received webhook payload: ${JSON.stringify(body)}`);

        // Verify HMAC-SHA256 signature
        this.verifySignature(req, signature);

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
