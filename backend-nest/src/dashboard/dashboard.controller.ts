import { Controller, Get, Post, Patch, Body, Req, UseGuards, UseInterceptors, UploadedFile, Param, Query } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CacheInterceptor, CacheKey, CacheTTL } from '@nestjs/cache-manager';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard'; // Assuming this exists from AuthModule
import { PlanGuard, RequirePlan } from '../payment/plan.guard';
import { PlanTier } from '../payment/plan-permission.service';

import { SessionService } from './session.service';

@Controller('dashboard') // Prefix handled by global setGlobalPrefix('api')
@UseGuards(JwtAuthGuard, PlanGuard)
@RequirePlan(PlanTier.BASIC)
export class DashboardController {
    constructor(
        private readonly dashboardService: DashboardService,
        private readonly sessionService: SessionService
    ) { }

    @Post('sessions/check')
    async checkSession(@Body() body: { country: string, datetime_utc?: string, user_region?: string }) {
        return this.sessionService.calculateSession(body.country, body.datetime_utc, body.user_region);
    }

    @Get('performance')
    async getPerformance(@Req() req, @Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
        return this.dashboardService.getPerformance(req.user.id, startDate, endDate);
    }

    @Get('trades')
    async getTrades(@Req() req, @Query('endDate') endDate?: string) {
        // Default limit 100
        return this.dashboardService.getTrades(req.user.id, endDate);
    }

    @Get('trades/recent')
    async getRecentTrades(@Req() req, @Query('limit') limitStr?: string, @Query('endDate') endDate?: string) {
        const limit = limitStr ? parseInt(limitStr, 10) : 5;
        const trades = await this.dashboardService.getTrades(req.user.id, endDate);
        return trades.slice(0, limit);
    }

    @Get('trades/:id')
    async getTradeDetails(@Req() req, @Param('id') id: string) {
        return this.dashboardService.getTradeDetails(req.user.id, id);
    }

    @Post('mental-log')
    async saveMentalLog(@Req() req, @Body() body: any) {
        return this.dashboardService.saveMentalLog(req.user.id, body);
    }

    @Get('mental-log/today')
    async getTodayMentalLog(@Req() req, @Query('session') session: string) {
        return this.dashboardService.getTodayMentalLog(req.user.id, session);
    }

    @Post('mental-log/image')
    @UseInterceptors(FileInterceptor('file', {
        storage: diskStorage({
            destination: './uploads',
            filename: (req, file, cb) => {
                const randomName = Array(32).fill(null).map(() => (Math.round(Math.random() * 16)).toString(16)).join('');
                return cb(null, `${randomName}${extname(file.originalname)}`);
            }
        })
    }))
    async uploadMentalLogImage(@Req() req, @UploadedFile() file, @Body('session') session: string) {
        const imageUrl = `/uploads/${file.filename}`;
        await this.dashboardService.saveMentalLogImage(req.user.id, imageUrl, session);
        return { imageUrl };
    }

    @Get('mental-log/history')
    async getMentalLogHistory(@Req() req) {
        return this.dashboardService.getMentalLogHistory(req.user.id);
    }

    @Get('technical-journal/:date')
    async getTechnicalJournal(@Req() req, @Param('date') date: string) {
        return this.dashboardService.getTechnicalJournal(req.user.id, date);
    }

    @Post('technical-journal')
    async createTechnicalJournal(@Req() req, @Body() body: any) {
        const userId = req.user.id || req.user.userId;
        const date = body.date;
        return this.dashboardService.saveTechnicalJournal(userId, date, body);
    }

    @Patch('trades/:id')
    async updateTrade(@Req() req, @Param('id') id: string, @Body() body: any) {
        return this.dashboardService.updateTradeMetadata(req.user.id, id, body);
    }

    @Get('heatmap')
    async getHeatmap(@Req() req, @Query('endDate') endDate?: string) {
        return this.dashboardService.getHeatmapData(req.user.id, endDate);
    }
}
