import {
    Controller,
    Post,
    Body,
    Logger,
    Req,
    Headers,
    BadRequestException,
    UnauthorizedException,
    Optional,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SubscriptionService } from './subscription.service';
import { NowPaymentsService } from './paymentgateways/nowpayment';
import { HubblyService } from './paymentgateways/hubbly';
import { DebitoPayService } from './paymentgateways/debitopay.service';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { timingSafeEqualStr } from '../common/security/security.config';
import { RedisSecurityService } from '../common/security/redis-security.service';

const WEBHOOK_REPLAY_WINDOW_MS = 5 * 60 * 1000; // +/- 5 minutes
const WEBHOOK_DEDUP_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

@Controller(['webhook', 'webhooks'])
export class WebhookController {
    private readonly logger = new Logger(WebhookController.name);

    constructor(
        private readonly subscriptionService: SubscriptionService,
        private readonly configService: ConfigService,
        @Optional() private readonly redisSecurity?: RedisSecurityService,
        @Optional() private readonly nowPaymentsService?: NowPaymentsService,
        @Optional() private readonly hubblyService?: HubblyService,
        @Optional() private readonly debitoPayService?: DebitoPayService,
    ) {}

    private verifySignature(req: any, signature: string) {
        const secret = this.configService.get<string>('WEBHOOK_SECRET', '');
        const isProd = this.configService.get<string>('NODE_ENV') === 'production';

        if (!secret) {
            if (isProd) {
                this.logger.error('CRITICAL: WEBHOOK_SECRET is not configured in production.');
                throw new UnauthorizedException('Webhook signature verification not configured');
            }
            this.logger.warn(
                'Webhook secret is not configured in non-production. Skipping signature verification.',
            );
            return;
        }

        if (!signature) {
            this.logger.error('Missing signature for webhook verification');
            throw new BadRequestException('Missing x-webhook-signature header');
        }

        const rawBody = req.rawBody;
        if (!rawBody) {
            this.logger.error(
                'rawBody not available in request. Make sure rawBody support is enabled in NestJS app setup.',
            );
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

    private verifyReplayTimestamp(rawTimestamp?: string) {
        if (!rawTimestamp) return;
        const trimmed = String(rawTimestamp).trim();
        let tsMs: number;
        if (/^\d{10}$/.test(trimmed)) {
            tsMs = Number(trimmed) * 1000;
        } else if (/^\d{13}$/.test(trimmed)) {
            tsMs = Number(trimmed);
        } else {
            tsMs = Date.parse(trimmed);
        }

        if (!Number.isFinite(tsMs)) {
            throw new BadRequestException('Invalid webhook timestamp');
        }
        const skew = Math.abs(Date.now() - tsMs);
        if (skew > WEBHOOK_REPLAY_WINDOW_MS) {
            this.logger.warn(`Rejected stale/replayed webhook (skew=${Math.round(skew / 1000)}s)`);
            throw new UnauthorizedException('Expired webhook timestamp');
        }
    }

    private computeEventDedupKey(req: any, body: Record<string, any>): string {
        const explicitId =
            body?.event_id ||
            body?.eventId ||
            body?.webhook_id ||
            body?.transaction_id ||
            body?.transactionId ||
            (body?.reference && body?.status
                ? `${String(body.reference).trim()}:${String(body.status).trim().toUpperCase()}`
                : null);

        const material = explicitId
            ? `id:${String(explicitId).slice(0, 160)}`
            : `raw:${Buffer.isBuffer(req?.rawBody) ? req.rawBody.toString('utf8') : JSON.stringify(body || {})}`;

        const hash = crypto.createHash('sha256').update(material).digest('hex');
        return `webhook_dedup:${hash}`;
    }

    @Post()
    @Throttle({ default: { limit: 120, ttl: 60000 } })
    async handleWebhook(
        @Req() req: any,
        @Body() body: Record<string, any>,
        @Headers('x-webhook-signature') signature: string,
        @Headers('x-webhook-timestamp') webhookTs?: string,
        @Headers('x-timestamp') altTs?: string,
    ) {
        this.logger.log('Received payment webhook.');

        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw new BadRequestException('Invalid webhook payload');
        }

        // 1. Verify HMAC-SHA256 signature BEFORE trusting payload
        this.verifySignature(req, signature);

        // 2. Enforce anti-replay timestamp window (+/- 5 min) if gateway provides timestamp header
        this.verifyReplayTimestamp(webhookTs || altTs);

        // 3. Atomic Event-ID idempotency lock via Redis (prevents double-credit on replay/retry)
        if (this.redisSecurity) {
            const dedupKey = this.computeEventDedupKey(req, body);
            const firstSeen = await this.redisSecurity.setIfAbsent(
                dedupKey,
                '1',
                WEBHOOK_DEDUP_TTL_MS,
            );
            if (!firstSeen) {
                this.logger.log(`Duplicate payment webhook ignored safely (${dedupKey.slice(0, 28)}...)`);
                return { success: true, duplicate: true };
            }
        }

        await this.subscriptionService.processPaymentWebhook(body);

        return { success: true };
    }

    @Post('nowpayments')
    @Throttle({ default: { limit: 120, ttl: 60000 } })
    async handleNowPaymentsWebhook(
        @Body() body: Record<string, any>,
        @Headers('x-nowpayments-sig') signature?: string,
    ) {
        this.logger.log('Received NOWPayments IPN webhook.');

        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw new BadRequestException('Invalid NOWPayments IPN payload');
        }

        const isProd = this.configService.get<string>('NODE_ENV') === 'production';
        if (!this.nowPaymentsService) {
            throw new UnauthorizedException('NOWPayments gateway service unavailable');
        }
        const verification = this.nowPaymentsService.verifyIpnSignature(body, signature);

        if (!verification.valid) {
            if (verification.reason === 'missing_secret') {
                if (isProd) {
                    this.logger.error(
                        'CRITICAL: NOWPAYMENTS_IPN_SECRET is not configured in production. Rejecting IPN.',
                    );
                    throw new UnauthorizedException('NOWPayments IPN signature verification not configured');
                }
                this.logger.warn(
                    'NOWPAYMENTS_IPN_SECRET not set in non-production. Proceeding ONLY via server-to-server NOWPayments API verification.',
                );
            } else {
                this.logger.error(
                    `Rejected NOWPayments IPN webhook (${verification.reason || 'invalid_signature'}).`,
                );
                throw new UnauthorizedException('Invalid NOWPayments IPN signature');
            }
        } else {
            this.logger.log('NOWPayments IPN HMAC-SHA512 signature verified.');
        }

        const paymentId = String(body.payment_id || '').trim();
        const paymentStatus = String(body.payment_status || '').trim().toLowerCase();
        if (this.redisSecurity && paymentId && paymentStatus) {
            const dedupMaterial = `np:${paymentId}:${paymentStatus}:${String(body.actually_paid ?? '')}`;
            const dedupHash = crypto.createHash('sha256').update(dedupMaterial).digest('hex');
            const firstSeen = await this.redisSecurity.setIfAbsent(
                `nowpayments_ipn_dedup:${dedupHash}`,
                '1',
                WEBHOOK_DEDUP_TTL_MS,
            );
            if (!firstSeen) {
                this.logger.log(
                    `Duplicate NOWPayments IPN ignored safely (payment_id=${paymentId}, status=${paymentStatus})`,
                );
                return { success: true, duplicate: true };
            }
        }

        await this.subscriptionService.processNowPaymentsWebhook(body);
        return { success: true };
    }

    @Post('hubbly')
    @Throttle({ default: { limit: 120, ttl: 60000 } })
    async handleHubblyWebhook(
        @Req() req: any,
        @Body() body: Record<string, any>,
        @Headers() headers: Record<string, any>,
    ) {
        this.logger.log('Received Hubbly PIX webhook.');

        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw new BadRequestException('Invalid Hubbly webhook payload');
        }

        if (!this.hubblyService) {
            throw new UnauthorizedException('Hubbly PIX gateway service unavailable');
        }

        const isProd = this.configService.get<string>('NODE_ENV') === 'production';
        const rawBody = req?.rawBody || JSON.stringify(body);
        const verification = this.hubblyService.verifyWebhookSignature(rawBody, headers);

        if (!verification.valid) {
            if (verification.reason === 'missing_secret') {
                if (isProd) {
                    this.logger.error(
                        'CRITICAL: HUBBLY_WEBHOOK_SECRET is not configured in production. Rejecting webhook.',
                    );
                    throw new UnauthorizedException('Hubbly webhook signature verification not configured');
                }
                this.logger.warn(
                    'HUBBLY_WEBHOOK_SECRET not set in non-production. Proceeding ONLY via server-to-server Hubbly API verification.',
                );
            } else {
                this.logger.error(
                    `Rejected Hubbly PIX webhook (${verification.reason || 'invalid_signature'}).`,
                );
                throw new UnauthorizedException('Invalid Hubbly webhook signature');
            }
        } else {
            this.logger.log('Hubbly PIX HMAC-SHA256 webhook signature verified.');
        }

        const externalId = String(
            body?.data?.externalId || body?.externalId || body?.data?.reference || body?.reference || '',
        ).trim();
        const status = String(body?.data?.status || body?.status || body?.event || '').trim().toLowerCase();

        if (this.redisSecurity && externalId && status) {
            const dedupHash = crypto
                .createHash('sha256')
                .update(`hubbly:${externalId}:${status}`)
                .digest('hex');
            const firstSeen = await this.redisSecurity.setIfAbsent(
                `hubbly_webhook_dedup:${dedupHash}`,
                '1',
                WEBHOOK_DEDUP_TTL_MS,
            );
            if (!firstSeen) {
                this.logger.log(`Duplicate Hubbly PIX webhook ignored safely (${externalId}:${status})`);
                return { success: true, duplicate: true };
            }
        }

        await this.subscriptionService.processHubblyWebhook(body);
        return { success: true };
    }

    @Post('debito-pay')
    @Throttle({ default: { limit: 120, ttl: 60000 } })
    async handleDebitoPayWebhook(
        @Req() req: any,
        @Body() body: Record<string, any>,
        @Headers('x-webhook-signature') signature?: string,
        @Headers('x-webhook-timestamp') webhookTs?: string,
        @Headers('x-timestamp') altTs?: string,
    ) {
        this.logger.log('Received Debito Pay webhook.');

        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw new BadRequestException('Invalid Debito Pay webhook payload');
        }

        const isProd = this.configService.get<string>('NODE_ENV') === 'production';
        const rawBody = req?.rawBody || JSON.stringify(body);
        if (this.debitoPayService) {
            const verification = this.debitoPayService.verifyWebhookSignature(rawBody, signature);
            if (!verification.valid) {
                if (verification.reason === 'missing_secret') {
                    if (isProd) {
                        this.logger.error(
                            'CRITICAL: DEBITO_PAY_WEBHOOK_SECRET is not configured in production.',
                        );
                        throw new UnauthorizedException('Debito Pay webhook verification not configured');
                    }
                    this.logger.warn(
                        'DEBITO_PAY_WEBHOOK_SECRET not configured in non-production. Proceeding via check-status verification.',
                    );
                } else {
                    this.logger.error(
                        `Rejected Debito Pay webhook (${verification.reason || 'invalid_signature'}).`,
                    );
                    throw new UnauthorizedException('Invalid Debito Pay webhook signature');
                }
            }
        } else {
            this.verifySignature(req, signature || '');
        }

        this.verifyReplayTimestamp(webhookTs || altTs || body?.timestamp);

        if (this.redisSecurity) {
            const paymentId = String(body?.data?.payment_id || body?.payment_id || '').trim();
            const eventName = String(
                body?.data?.status || body?.event || body?.status || '',
            )
                .trim()
                .toLowerCase();
            const dedupMaterial =
                paymentId && eventName
                    ? `debito:${paymentId}:${eventName}`
                    : this.computeEventDedupKey(req, body);
            const dedupHash = crypto.createHash('sha256').update(dedupMaterial).digest('hex');
            const firstSeen = await this.redisSecurity.setIfAbsent(
                `debito_webhook_dedup:${dedupHash}`,
                '1',
                WEBHOOK_DEDUP_TTL_MS,
            );
            if (!firstSeen) {
                this.logger.log(`Duplicate Debito Pay webhook ignored safely (${paymentId}:${eventName})`);
                return { success: true, duplicate: true };
            }
        }

        await this.subscriptionService.processPaymentWebhook(body);
        return { success: true };
    }
}
