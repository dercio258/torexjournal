import { Controller, Post, Get, Body, Param, Query, Res, Logger, UseGuards, Request } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';
import { FastifyReply } from 'fastify';
import { SubscribeMobileDto, SubscribeCardDto, RedeemReferralCreditsDto } from './dto/subscription.dto';

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
        );
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
        return this.subscriptionService.activateTrial(req.user.id, 'BASIC', { verifyShareGate: true });
    }

    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { limit: 5, ttl: 60000 } })
    @Post('activate-trial')
    async activateTrial(@Request() req, @Body() body: { tier?: string }) {
        return this.subscriptionService.activateTrial(req.user.id, body?.tier || 'BASIC', {
            verifyShareGate: true,
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
    @Throttle({ default: { limit: 10, ttl: 60000 } })
    @Post('check-status/:reference')
    async checkStatus(@Request() req, @Param('reference') reference: string) {
        const outcome = await this.subscriptionService.checkPaymentStatus(reference, req.user.id);
        return { status: outcome.status || 'checked', found: outcome.found };
    }

    // Redirect status callback route
    @Get('payment/status/card')
    @Get('paymet/staus/card')
    async handleCardStatusRedirect(@Query('reference') reference: string, @Res() res: FastifyReply) {
        this.logger.log(`User returned from card payment flow for reference: ${reference}`);

        let paymentStatus: 'active' | 'failed' | 'pending' = reference ? 'pending' : 'failed';
        if (reference) {
            try {
                const outcome = await this.subscriptionService.checkPaymentStatus(reference);
                if (outcome?.status === 'ACTIVE' || outcome?.status === 'APPROVED') {
                    paymentStatus = 'active';
                } else if (outcome?.status === 'CANCELLED' || outcome?.status === 'EXPIRED') {
                    paymentStatus = 'failed';
                }
            } catch (err: any) {
                this.logger.error(`Error checking status on redirect: ${err?.message || err}`);
            }
        }

        const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3001';
        return res.redirect(
            `${frontendUrl}/subscription/success?subscription_id=${encodeURIComponent(reference || '')}&payment_status=${paymentStatus}`,
        );
    }
}
