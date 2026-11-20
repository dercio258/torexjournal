import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../admin/admin-auth.guard';
import { AnalyticsService } from './analytics.service';
import { UpdatePixelConfigDto } from './dto/analytics.dto';

@Controller('admin/analytics')
@UseGuards(AdminAuthGuard)
export class AdminAnalyticsController {
    constructor(private readonly analyticsService: AnalyticsService) {}

    @Get('overview')
    async getOverview(
        @Query('days') days?: string,
        @Query('utmSource') utmSource?: string,
        @Query('deviceType') deviceType?: string,
    ) {
        return this.analyticsService.getOverviewAnalytics({
            days: days ? Number(days) : 30,
            utmSource,
            deviceType,
        });
    }

    @Get('users-sources')
    async getUserSources(
        @Query('days') days?: string,
        @Query('source') source?: string,
        @Query('search') search?: string,
    ) {
        return this.analyticsService.getUserSourcesAnalytics({
            days: days ? Number(days) : 30,
            source,
            search,
        });
    }

    @Get('pixels')
    async getPixels() {
        return this.analyticsService.getAdminPixelConfig();
    }

    @Put('pixels')
    async updatePixels(@Body() dto: UpdatePixelConfigDto) {
        return this.analyticsService.updateAdminPixelConfig(dto);
    }

    @Get('push-insights')
    async getPushInsights(@Query('days') days?: string) {
        return this.analyticsService.getPushAnalytics(days ? Number(days) : 30);
    }

    @Get('referrals')
    async getReferralInsights(@Query('days') days?: string) {
        return this.analyticsService.getReferralAnalytics(days ? Number(days) : 30);
    }
}
