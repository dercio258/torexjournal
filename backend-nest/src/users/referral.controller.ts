import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReferralService } from './referral.service';

@Controller('referrals')
@UseGuards(JwtAuthGuard)
export class ReferralController {
    constructor(private readonly referralService: ReferralService) {}

    @Get('me')
    @Throttle({ default: { limit: 30, ttl: 60000 } })
    async getMyReferralSummary(@Request() req, @Query('context') context?: string) {
        return this.referralService.getMySummary(req.user.id, context);
    }
}
