import { Body, Controller, Get, Optional, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FastifyReply } from 'fastify';
import { PaymentService } from './payment.service';
import { SubscriptionService } from './subscription.service';
import { NowPaymentsService } from './paymentgateways/nowpayment';
import { CheckoutGeoIpService } from './checkout-geoip.service';
import { PayRenewalInvoiceDto } from './dto/subscription.dto';
import { extractTrustedClientIp } from '../common/security/security.config';

@Controller('payment')
export class PaymentController {
    constructor(
        private readonly paymentService: PaymentService,
        @Optional() private readonly subscriptionService?: SubscriptionService,
        @Optional() private readonly nowPaymentsService?: NowPaymentsService,
        @Optional() private readonly checkoutGeoIpService?: CheckoutGeoIpService,
    ) { }

    @Get('pricing-config')
    async getPricingConfig() {
        const cfg = await this.paymentService.getPricingConfig();
        // Public endpoint exposes only USD catalog anchors — never internal FX / MZN conversion rates
        return {
            basicoPrice: cfg.basicoPrice,
            proPrice: cfg.proPrice,
            premiumPrice: cfg.premiumPrice,
        };
    }

    @Get('plans')
    async getPublicPlans() {
        if (!this.subscriptionService) return [];
        return this.subscriptionService.getActivePlans();
    }

    @Get('checkout-context')
    @Throttle({ default: { limit: 60, ttl: 60000 } })
    async getCheckoutContext(@Req() req: any, @Query('country') requestedCountry?: string) {
        if (!this.checkoutGeoIpService) {
            return {
                countryCode: 'INTL',
                countryName: 'Internacional',
                source: 'fallback',
                availableMethods: ['card', 'crypto'],
                defaultMethod: 'card',
            };
        }

        const override = String(requestedCountry || '')
            .trim()
            .toUpperCase();
        if (/^[A-Z]{2}$/.test(override) || override === 'INTL') {
            const { availableMethods, defaultMethod } =
                this.checkoutGeoIpService.buildMethodsForCountry(override);
            return {
                countryCode: override,
                countryName: override,
                source: 'manual',
                availableMethods,
                defaultMethod,
            };
        }

        return this.checkoutGeoIpService.resolveFromRequest(req);
    }

    @Get('crypto-currencies')
    async getCryptoCurrencies() {
        const currencies = this.nowPaymentsService
            ? await this.nowPaymentsService.getSupportedCurrenciesCatalog()
            : [];
        return {
            enabled: Boolean(this.nowPaymentsService?.isConfigured()),
            currencies,
        };
    }

    @Get('crypto-slip/:reference')
    @Throttle({ default: { limit: 30, ttl: 60000 } })
    async getCryptoSlip(
        @Param('reference') reference: string,
        @Query('sig') sig: string,
    ) {
        if (!this.subscriptionService) return null;
        return this.subscriptionService.getPublicCryptoPaymentSlip(reference, sig);
    }

    @Get('renewal/:token')
    @Throttle({ default: { limit: 30, ttl: 60000 } })
    async getRenewalInvoice(@Req() req: any, @Param('token') token: string) {
        if (!this.subscriptionService) return null;
        const geo = this.checkoutGeoIpService
            ? await this.checkoutGeoIpService.resolveFromRequest(req)
            : {
                  countryCode: 'INTL',
                  countryName: 'Internacional',
                  source: 'fallback' as const,
                  availableMethods: ['card', 'crypto'] as ('card' | 'crypto')[],
                  defaultMethod: 'card' as const,
              };
        return this.subscriptionService.getPublicRenewalInvoice(token, geo);
    }

    @Get('renewal/:token/status')
    @Throttle({ default: { limit: 45, ttl: 60000 } })
    async getRenewalStatus(
        @Param('token') token: string,
        @Query('reference') reference?: string,
        @Query('force') force?: string,
    ) {
        if (!this.subscriptionService) return null;
        return this.subscriptionService.getPublicRenewalPaymentStatus(
            token,
            reference,
            force === '1' || force === 'true',
        );
    }

    @Post('renewal/:token/pay')
    @Throttle({ default: { limit: 10, ttl: 60000 } })
    async payRenewalInvoice(
        @Req() req: any,
        @Param('token') token: string,
        @Body() body: PayRenewalInvoiceDto,
    ) {
        if (!this.subscriptionService) return null;
        return this.subscriptionService.payRenewalInvoice(token, body, {
            ip: extractTrustedClientIp(req),
            userAgent: req?.headers?.['user-agent'],
            origin: req?.headers?.origin,
        });
    }

    @Get('callback/success')
    @Throttle({ default: { limit: 30, ttl: 60000 } })
    async handleCallbackSuccess(
        @Query() query: Record<string, any>,
        @Res() res: FastifyReply,
    ) {
        if (!this.subscriptionService) {
            return res.redirect('/checkout');
        }
        const redirectUrl = await this.subscriptionService.resolvePaymentCallbackRedirect(
            'success',
            {
                reference:
                    query?.reference ||
                    query?.subscription_id ||
                    query?.external_id ||
                    query?.source_id ||
                    query?.order_id,
                method: query?.method,
                status: query?.payment_status || query?.status,
                reason: query?.payment_reason || query?.reason || query?.error || query?.message,
                locale: query?.locale,
                renewalToken: query?.renewal_token || query?.token,
            },
        );
        return res.redirect(redirectUrl);
    }

    @Get('callback/failed')
    @Throttle({ default: { limit: 30, ttl: 60000 } })
    async handleCallbackFailed(
        @Query() query: Record<string, any>,
        @Res() res: FastifyReply,
    ) {
        if (!this.subscriptionService) {
            return res.redirect('/checkout?payment_status=failed');
        }
        const redirectUrl = await this.subscriptionService.resolvePaymentCallbackRedirect(
            'failed',
            {
                reference:
                    query?.reference ||
                    query?.subscription_id ||
                    query?.external_id ||
                    query?.source_id ||
                    query?.order_id,
                method: query?.method,
                status: query?.payment_status || query?.status || 'failed',
                reason: query?.payment_reason || query?.reason || query?.error || query?.message,
                locale: query?.locale,
                renewalToken: query?.renewal_token || query?.token,
            },
        );
        return res.redirect(redirectUrl);
    }
}
