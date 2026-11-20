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
        const secret = this.configService.get<string>('WEBHOOK_SECRET', '');
        const isProd = this.configService.get<string>('NODE_ENV') === 'production';

        if (!secret) {
            if (isProd) {
                this.logger.error('CRITICAL: WEBHOOK_SECRET is not configured in production.');
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
    async handleWebhook(@Req() req: any, @Body() body: any, @Headers('x-webhook-signature') signature: string) {
        this.logger.log('Received payment webhook.');

        // Verify HMAC-SHA256 signature BEFORE trusting or processing payload
        this.verifySignature(req, signature);
        await this.subscriptionService.processPaymentWebhook(body);

        return { success: true };
    }
}
