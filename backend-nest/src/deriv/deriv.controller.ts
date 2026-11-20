import { Controller, Post, Body, UseGuards, Req, Delete, Get, Query } from '@nestjs/common';
import { DerivService } from './deriv.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlanGuard, RequirePlan } from '../payment/plan.guard';
import { PlanTier } from '../payment/plan-permission.service';

@Controller('integrations/deriv')
@UseGuards(JwtAuthGuard, PlanGuard)
@RequirePlan(PlanTier.BASIC)
export class DerivController {
    constructor(private readonly derivService: DerivService) { }

    private resolveAccountId(req: any, queryAccountId?: string): string | undefined {
        const raw = queryAccountId || req.body?.accountId || (req.headers?.['x-account-id'] as string) || undefined;
        if (!raw || raw === 'all' || raw === 'undefined' || raw === 'null') {
            return undefined;
        }
        return String(raw).trim();
    }

    @Get('status')
    async getStatus(@Req() req, @Query('accountId') accountId?: string) {
        return this.derivService.getStatus(req.user.id, this.resolveAccountId(req, accountId));
    }

    @Post('connect')
    async connect(@Req() req, @Body() body: { token: string }) {
        return this.derivService.connect(req.user.id, body.token);
    }

    @Post('sync')
    async sync(@Req() req, @Query('accountId') accountId?: string) {
        return this.derivService.triggerSync(req.user.id, this.resolveAccountId(req, accountId));
    }

    @Delete('disconnect')
    async disconnect(@Req() req, @Query('accountId') accountId?: string) {
        return this.derivService.disconnect(req.user.id, this.resolveAccountId(req, accountId));
    }
}
