import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { EconomicCalendarService } from './economic-calendar.service';
import { QueryEventsDto } from './dto/query-events.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlanGuard, RequirePlan } from '../payment/plan.guard';
import { PlanTier } from '../payment/plan-permission.service';

@Controller('economic-calendar')
@UseGuards(JwtAuthGuard, PlanGuard)
@RequirePlan(PlanTier.PRO)
export class EconomicCalendarController {
    constructor(private readonly calendarService: EconomicCalendarService) {}

    @Get('events')
    async getEvents(
        @Query() query: QueryEventsDto,
        @Req() req: any
    ) {
        const userId = req.user?.id || req.user?.userId;
        const accountId = query.accountId || req.headers?.['x-account-id'];
        return this.calendarService.getEvents(query, userId, accountId);
    }

    @Get('today')
    async getTodayEvents(
        @Query('accountId') queryAccountId: string,
        @Req() req: any
    ) {
        const userId = req.user?.id || req.user?.userId;
        const accountId = queryAccountId || req.headers?.['x-account-id'];
        return this.calendarService.getTodayEvents(userId, accountId);
    }

    @Get('upcoming')
    async getUpcomingEvents(
        @Query('limit') limitStr?: string
    ) {
        const limit = limitStr ? parseInt(limitStr, 10) : 10;
        return this.calendarService.getUpcomingEvents(limit);
    }

    @Get('events/:id')
    async getEventById(@Param('id') id: string) {
        return this.calendarService.getEventById(id);
    }
}
