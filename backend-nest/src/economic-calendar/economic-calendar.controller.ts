import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { EconomicCalendarService } from './economic-calendar.service';
import { QueryEventsDto } from './dto/query-events.dto';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';

@Controller('economic-calendar')
export class EconomicCalendarController {
    constructor(private readonly calendarService: EconomicCalendarService) {}

    @Get('events')
    @UseGuards(OptionalJwtAuthGuard)
    async getEvents(
        @Query() query: QueryEventsDto,
        @Req() req: any
    ) {
        const userId = req.user?.id || req.user?.userId;
        const accountId = query.accountId || req.headers?.['x-account-id'];
        return this.calendarService.getEvents(query, userId, accountId);
    }

    @Get('today')
    @UseGuards(OptionalJwtAuthGuard)
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
