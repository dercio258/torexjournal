import { Controller, Get, UseGuards } from '@nestjs/common';
import { FinnhubService } from './finnhub.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlanGuard, RequirePlan } from '../payment/plan.guard';
import { PlanTier } from '../payment/plan-permission.service';

@Controller('finnhub')
@UseGuards(JwtAuthGuard, PlanGuard)
@RequirePlan(PlanTier.PREMIUM)
export class FinnhubController {
    constructor(private readonly finnhubService: FinnhubService) { }

    @Get('calendar')
    async getCalendar() {
        return this.finnhubService.getEconomicCalendar();
    }
}
