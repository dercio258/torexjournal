import { Controller, Post, Body, UseGuards, Req, Delete, Get } from '@nestjs/common';
import { DerivService } from './deriv.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlanGuard, RequirePlan } from '../payment/plan.guard';
import { PlanTier } from '../payment/plan-permission.service';

@Controller('integrations/deriv')
@UseGuards(JwtAuthGuard, PlanGuard)
@RequirePlan(PlanTier.PREMIUM)
export class DerivController {
    constructor(private readonly derivService: DerivService) { }

    @Post('connect')
    async connect(@Req() req, @Body() body: { token: string }) {
        return this.derivService.connect(req.user.id, body.token);
    }

    @Delete('disconnect')
    async disconnect(@Req() req) {
        return this.derivService.disconnect(req.user.id);
    }
}
