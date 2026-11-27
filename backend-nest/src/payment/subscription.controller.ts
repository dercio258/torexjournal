import { Controller, Post, Get, Body, Param, Query, Res, Logger, UseGuards, Request } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';
import { FastifyReply } from 'fastify';
import {
    SubscribeMobileDto,
    SubscribeCardDto,
    SubscribeCryptoDto,
    SubscribePixDto,
    SubscribePayFastDto,
    RedeemReferralCreditsDto,
} from './dto/subscription.dto';
import { extractTrustedClientIp } from '../common/security/security.config';

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
            body.savePreference,
            body.useReferralCredits,
            {
                ip: extractTrustedClientIp(req),
                userAgent: req?.headers?.['user-agent'],
                origin: req?.headers?.origin,
            },
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
            body.useReferralCredits,
            {
                ip: extractTrustedClientIp(req),
                userAgent: req?.headers?.['user-agent'],
                origin: req?.headers?.origin,
            },
        );
    }

    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { limit: 10, ttl: 60000 } })
    @Post('subscribe/payfast')
    async subscribePayFast(@Request() req, @Body() body: SubscribePayFastDto) {
        return this.subscriptionService.createPayFastSubscription(
            req.user.id,
            body.tier as any,
            body.cycle as any,
            body.returnUrl,
            body.phoneNumber,
            body.useReferralCredits,
            {
                ip: extractTrustedClientIp(req),
                userAgent: req?.headers?.['user-agent'],
                origin: req?.headers?.origin,
            },
        );
    }

    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { limit: 10, ttl: 60000 } })
    @Post('subscribe/crypto')
    async subscribeCrypto(@Request() req, @Body() body: SubscribeCryptoDto) {
        return this.subscriptionService.createCryptoSubscription(
            req.user.id,
            body.tier,
            body.cycle as any,
            body.cryptocurrency,
            body.useReferralCredits,
            body.forceNew,
        );
    }

    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { limit: 45, ttl: 60000 } })
    @Get('crypto/active')
    async getActiveCryptoPayment(
        @Request() req,
        @Query('reference') reference?: string,
    ) {
        return this.subscriptionService.getActiveCryptoPayment(req.user.id, reference);
    }

    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { limit: 15, ttl: 60000 } })
    @Post('crypto/:reference/cancel')
    async cancelCryptoPayment(
        @Request() req,
        @Param('reference') reference: string,
    ) {
        return this.subscriptionService.cancelPendingCryptoPayment(req.user.id, reference);
    }

    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { limit: 60, ttl: 60000 } })
    @Get('pix/quote')
    async getPixQuote(
        @Request() req,
        @Query('tier') tier: string,
        @Query('cycle') cycle: string,
        @Query('useReferralCredits') useReferralCredits?: string,
    ) {
        return this.subscriptionService.getPixQuote(
            req.user.id,
            tier,
            (cycle || 'MONTHLY').toUpperCase() as any,
            useReferralCredits === 'true' || useReferralCredits === '1',
        );
    }

    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { limit: 10, ttl: 60000 } })
    @Post('subscribe/pix')
    async subscribePix(@Request() req, @Body() body: SubscribePixDto) {
        return this.subscriptionService.createPixSubscription(
            req.user.id,
            body.tier,
            body.cycle as any,
            body.payerDocument,
            body.payerName,
            body.useReferralCredits,
            body.forceNew,
        );
    }

    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { limit: 45, ttl: 60000 } })
    @Get('pix/active')
    async getActivePixPayment(
        @Request() req,
        @Query('reference') reference?: string,
    ) {
        return this.subscriptionService.getActivePixPayment(req.user.id, reference);
    }

    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { limit: 15, ttl: 60000 } })
    @Post('pix/:reference/cancel')
    async cancelPixPayment(
        @Request() req,
        @Param('reference') reference: string,
    ) {
        return this.subscriptionService.cancelPendingPixPayment(req.user.id, reference);
    }

    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { limit: 10, ttl: 60000 } })
    @Post('redeem-credits')
    async redeemCredits(@Request() req, @Body() body: RedeemReferralCreditsDto) {
        return this.subscriptionService.redeemSubscriptionWithReferralCredits(
            req.user.id,
            body.tier as any,
            body.cycle as any,
        );
    }

    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { limit: 15, ttl: 60000 } })
    @Post('prepare-trial-share')
    async prepareTrialShare(
        @Request() req,
        @Body() body: { tier?: string; channel?: string },
    ) {
        return this.subscriptionService.recordTrialShareIntent(
            req.user.id,
            body?.tier,
            body?.channel,
        );
    }

    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { limit: 5, ttl: 60000 } })
    @Post('activate-basic-trial')
    async activateBasicTrial(@Request() req) {
        return this.subscriptionService.activateTrial(req.user.id, 'BASIC', { verifyShareGate: false });
    }

    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { limit: 5, ttl: 60000 } })
    @Post('activate-trial')
    async activateTrial(@Request() req, @Body() body: { tier?: string }) {
        return this.subscriptionService.activateTrial(req.user.id, body?.tier || 'BASIC', {
            verifyShareGate: false,
        });
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

    // --- Payment Status Sync (Authenticated & ownership-verified) ---
    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { limit: 45, ttl: 60000 } })
    @Post('check-status/:reference')
    async checkStatus(
        @Request() req,
        @Param('reference') reference: string,
        @Body() body?: { force?: boolean },
        @Query('force') forceQuery?: string,
    ) {
        const forceRemote =
            body?.force === true || forceQuery === '1' || forceQuery === 'true';
        const outcome = await this.subscriptionService.checkPaymentStatus(
            reference,
            req.user.id,
            { forceRemote },
        );
        return {
            status: outcome.status || 'checked',
            found: outcome.found,
            reference: outcome.reference,
            paymentMethod: outcome.paymentMethod,
            tier: outcome.tier,
            cycle: outcome.cycle,
            nextPollAfterMs: outcome.nextPollAfterMs,
            failureReason: outcome.failureReason,
            serverCheckedAt: outcome.serverCheckedAt,
        };
    }

    // Redirect status callback routes (authoritative verification before routing to success or checkout failure modal)
    @Get('payment/status/card')
    @Throttle({ default: { limit: 30, ttl: 60000 } })
    async handleCardStatusRedirect(@Query() query: Record<string, any>, @Res() res: FastifyReply) {
        const redirectUrl = await this.subscriptionService.resolvePaymentCallbackRedirect(
            'success',
            {
                reference:
                    query?.reference ||
                    query?.subscription_id ||
                    query?.external_id ||
                    query?.source_id,
                method: query?.method || 'card',
                status: query?.payment_status || query?.status,
                reason: query?.payment_reason || query?.reason || query?.error || query?.message,
                locale: query?.locale,
                renewalToken: query?.renewal_token || query?.token,
            },
        );
        return res.redirect(redirectUrl);
    }

    @Get('payment/callback/success')
    @Throttle({ default: { limit: 30, ttl: 60000 } })
    async handlePaymentCallbackSuccess(@Query() query: Record<string, any>, @Res() res: FastifyReply) {
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

    @Get('payment/callback/failed')
    @Throttle({ default: { limit: 30, ttl: 60000 } })
    async handlePaymentCallbackFailed(@Query() query: Record<string, any>, @Res() res: FastifyReply) {
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
