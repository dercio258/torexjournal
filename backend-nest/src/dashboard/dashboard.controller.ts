import { Controller, Get, Post, Put, Patch, Delete, Body, Req, UseGuards, UseInterceptors, UploadedFile, Param, Query } from '@nestjs/common';
import { FastifyFileInterceptor } from '../common/interceptors/fastify-file.interceptor';
import { DashboardService } from './dashboard.service';
import { JournalService } from './journal.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlanGuard, RequirePlan } from '../payment/plan.guard';
import { PlanTier } from '../payment/plan-permission.service';
import { SessionService } from './session.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, PlanGuard)
@RequirePlan(PlanTier.BASIC)
export class DashboardController {
    constructor(
        private readonly dashboardService: DashboardService,
        private readonly journalService: JournalService,
        private readonly sessionService: SessionService
    ) { }

    private resolveAccountId(req: any, queryAccountId?: string): string | undefined {
        const id = queryAccountId || (req.headers['x-account-id'] as string) || undefined;
        if (!id || id === 'all' || id === 'undefined' || id === 'null') {
            return undefined;
        }
        return id;
    }

    @Post('sessions/check')
    async checkSession(@Body() body: { country: string, datetime_utc?: string, user_region?: string }) {
        return this.sessionService.calculateSession(body.country, body.datetime_utc, body.user_region);
    }

    @Get('performance')
    async getPerformance(
        @Req() req,
        @Query('accountId') queryAccountId?: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('symbols') symbols?: string,
        @Query('side') side?: string,
        @Query('sessions') sessions?: string,
        @Query('outcome') outcome?: string,
        @Query('tz') tz?: string
    ) {
        const accountId = this.resolveAccountId(req, queryAccountId);
        return this.dashboardService.getPerformance(req.user.id, accountId, startDate, endDate, {
            symbols,
            side,
            sessions,
            outcome,
            tz,
        });
    }

    @Get('trades')
    async getTrades(
        @Req() req,
        @Query('accountId') queryAccountId?: string,
        @Query('endDate') endDate?: string,
        @Query('startDate') startDate?: string,
        @Query('limit') limitStr?: string,
        @Query('page') pageStr?: string,
        @Query('paginated') paginated?: string,
        @Query('symbol') symbol?: string,
        @Query('type') type?: string,
        @Query('status') status?: string,
        @Query('ticket') ticket?: string,
        @Query('sort') sort?: string,
        @Query('tz') tz?: string,
        @Query('mlFilter') mlFilter?: string
    ) {
        const accountId = this.resolveAccountId(req, queryAccountId);
        if (paginated === 'true' || paginated === '1') {
            const page = pageStr ? Math.max(1, parseInt(pageStr, 10) || 1) : 1;
            const limit = limitStr ? Math.min(5000, Math.max(1, parseInt(limitStr, 10) || 15)) : 15;
            return this.dashboardService.getTradesPaginated(req.user.id, {
                accountId,
                page,
                limit,
                symbol,
                type,
                status,
                ticket,
                startDate,
                endDate,
                sort,
                tz,
                mlFilter,
            });
        }
        const limit = limitStr ? parseInt(limitStr, 10) : 100;
        return this.dashboardService.getTrades(req.user.id, accountId, endDate, limit);
    }

    @Get('trades/recent')
    async getRecentTrades(
        @Req() req,
        @Query('accountId') queryAccountId?: string,
        @Query('limit') limitStr?: string,
        @Query('endDate') endDate?: string
    ) {
        const accountId = this.resolveAccountId(req, queryAccountId);
        const limit = limitStr ? parseInt(limitStr, 10) : 5;
        return this.dashboardService.getTrades(req.user.id, accountId, endDate, limit);
    }

    @Get('trades/:id')
    async getTradeDetails(@Req() req, @Param('id') id: string) {
        return this.dashboardService.getTradeDetails(req.user.id, id);
    }

    @Post('mental-log')
    async saveMentalLog(
        @Req() req,
        @Body() body: any,
        @Query('accountId') queryAccountId?: string
    ) {
        const accountId = this.resolveAccountId(req, queryAccountId || body?.accountId);
        return this.dashboardService.saveMentalLog(req.user.id, body, accountId);
    }

    @Get('mental-log/today')
    async getTodayMentalLog(
        @Req() req,
        @Query('session') session: string,
        @Query('accountId') queryAccountId?: string
    ) {
        const accountId = this.resolveAccountId(req, queryAccountId);
        return this.dashboardService.getTodayMentalLog(req.user.id, session, accountId);
    }

    @Post('mental-log/image')
    @UseInterceptors(
        new FastifyFileInterceptor('file', {
            dest: './uploads',
            allowedImageOnly: true,
            maxFileSizeBytes: 5 * 1024 * 1024,
        }),
    )
    async uploadMentalLogImage(
        @Req() req,
        @UploadedFile() file,
        @Body('session') session: string,
        @Query('accountId') queryAccountId?: string
    ) {
        const accountId = this.resolveAccountId(req, queryAccountId || req.body?.accountId);
        const imageUrl = `/uploads/${file.filename}`;
        await this.dashboardService.saveMentalLogImage(req.user.id, imageUrl, session, accountId);
        return { imageUrl };
    }

    @Get('mental-log/history')
    async getMentalLogHistory(
        @Req() req,
        @Query('accountId') queryAccountId?: string
    ) {
        const accountId = this.resolveAccountId(req, queryAccountId);
        return this.dashboardService.getMentalLogHistory(req.user.id, accountId);
    }

    @Get('technical-journal/:date')
    async getTechnicalJournal(
        @Req() req,
        @Param('date') date: string,
        @Query('accountId') queryAccountId?: string
    ) {
        const accountId = this.resolveAccountId(req, queryAccountId);
        return this.dashboardService.getTechnicalJournal(req.user.id, date, accountId);
    }

    @Post('technical-journal')
    async createTechnicalJournal(@Req() req, @Body() body: any, @Query('accountId') queryAccountId?: string) {
        const userId = req.user.id || req.user.userId;
        const date = body.date;
        const accountId = this.resolveAccountId(req, queryAccountId || body.accountId);
        return this.dashboardService.saveTechnicalJournal(userId, date, body, accountId);
    }

    // ------------------------------------------------------------------------
    // Journal v2 — Daily Blocks, Daily Notes, Trade Notes & General Notes
    // ------------------------------------------------------------------------

    @Get('journal/overview')
    async getJournalOverview(
        @Req() req,
        @Query('accountId') queryAccountId?: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string
    ) {
        const userId = req.user.id || req.user.userId;
        const accountId = this.resolveAccountId(req, queryAccountId);
        return this.journalService.getOverview(userId, accountId, startDate, endDate);
    }

    @Put('journal/daily/:date')
    async upsertDailyNote(
        @Req() req,
        @Param('date') date: string,
        @Body() body: any,
        @Query('accountId') queryAccountId?: string
    ) {
        const userId = req.user.id || req.user.userId;
        const accountId = this.resolveAccountId(req, queryAccountId || body?.accountId);
        const rawUpdatedAt = req.headers?.['x-client-updated-at'];
        const clientUpdatedAt =
            (Array.isArray(rawUpdatedAt) ? rawUpdatedAt[0] : rawUpdatedAt) ||
            body?.clientUpdatedAt;
        return this.journalService.upsertDailyNote(userId, date, body, accountId, clientUpdatedAt);
    }

    @Delete('journal/daily/:date')
    async deleteDailyNote(
        @Req() req,
        @Param('date') date: string,
        @Query('accountId') queryAccountId?: string
    ) {
        const userId = req.user.id || req.user.userId;
        const accountId = this.resolveAccountId(req, queryAccountId);
        return this.journalService.deleteDailyNote(userId, date, accountId);
    }

    @Put('journal/trade/:tradeId')
    async upsertTradeNote(
        @Req() req,
        @Param('tradeId') tradeId: string,
        @Body() body: any
    ) {
        const userId = req.user.id || req.user.userId;
        const rawUpdatedAt = req.headers?.['x-client-updated-at'];
        const clientUpdatedAt =
            (Array.isArray(rawUpdatedAt) ? rawUpdatedAt[0] : rawUpdatedAt) ||
            body?.clientUpdatedAt;
        return this.journalService.upsertTradeNote(userId, tradeId, body, clientUpdatedAt);
    }

    @Delete('journal/trade/:tradeId')
    async deleteTradeNote(
        @Req() req,
        @Param('tradeId') tradeId: string
    ) {
        const userId = req.user.id || req.user.userId;
        return this.journalService.deleteTradeNote(userId, tradeId);
    }

    @Post('journal/general')
    async createGeneralNote(@Req() req, @Body() body: any) {
        const userId = req.user.id || req.user.userId;
        return this.journalService.createGeneralNote(userId, body);
    }

    @Put('journal/general/:id')
    async updateGeneralNote(
        @Req() req,
        @Param('id') id: string,
        @Body() body: any
    ) {
        const userId = req.user.id || req.user.userId;
        const rawUpdatedAt = req.headers?.['x-client-updated-at'];
        const clientUpdatedAt =
            (Array.isArray(rawUpdatedAt) ? rawUpdatedAt[0] : rawUpdatedAt) ||
            body?.clientUpdatedAt;
        return this.journalService.updateGeneralNote(userId, id, body, clientUpdatedAt);
    }

    @Delete('journal/general/:id')
    async deleteGeneralNote(@Req() req, @Param('id') id: string) {
        const userId = req.user.id || req.user.userId;
        return this.journalService.deleteGeneralNote(userId, id);
    }

    @Post('journal/screenshot')
    @UseInterceptors(new FastifyFileInterceptor('file'))
    async uploadJournalScreenshot(
        @Req() req,
        @UploadedFile() file: any,
        @Body() body: any
    ) {
        const userId = req.user.id || req.user.userId;
        return this.journalService.uploadJournalScreenshot(userId, file, body);
    }

    @Patch('trades/:id')
    async updateTrade(@Req() req, @Param('id') id: string, @Body() body: any) {
        const rawUpdatedAt = req.headers?.['x-client-updated-at'];
        const clientUpdatedAt =
            (Array.isArray(rawUpdatedAt) ? rawUpdatedAt[0] : rawUpdatedAt) ||
            body?.clientUpdatedAt;
        return this.dashboardService.updateTradeMetadata(
            req.user.id,
            id,
            body,
            clientUpdatedAt,
        );
    }

    @Get('heatmap')
    async getHeatmap(
        @Req() req,
        @Query('accountId') queryAccountId?: string,
        @Query('endDate') endDate?: string
    ) {
        const accountId = this.resolveAccountId(req, queryAccountId);
        return this.dashboardService.getHeatmapData(req.user.id, accountId, endDate);
    }

    @Get('weekly-summary')
    async getWeeklySummary(
        @Req() req,
        @Query('accountId') queryAccountId?: string
    ) {
        const accountId = this.resolveAccountId(req, queryAccountId);
        return this.dashboardService.getWeeklySummary(req.user.id, accountId);
    }

    @Get('report')
    async getReport(
        @Req() req,
        @Query('accountId') queryAccountId?: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('symbol') symbol?: string,
        @Query('type') type?: string,
        @Query('symbols') symbols?: string,
        @Query('side') side?: string,
        @Query('sessions') sessions?: string,
        @Query('outcome') outcome?: string
    ) {
        const accountId = this.resolveAccountId(req, queryAccountId);
        const userId = req.user.id || req.user.userId;
        return this.dashboardService.getReportData(
            userId,
            accountId,
            startDate,
            endDate,
            symbol,
            type,
            { symbols, side, sessions, outcome }
        );
    }

    @Post('backtest/simulate')
    async simulateBacktest(
        @Req() req,
        @Body() body: any,
        @Query('accountId') queryAccountId?: string
    ) {
        const accountId = this.resolveAccountId(req, queryAccountId || body.accountId);
        const userId = req.user.id || req.user.userId;
        return this.dashboardService.simulateBacktest(userId, accountId, body);
    }

    @Post('backtest/save')
    @RequirePlan(PlanTier.FREE)
    async saveBacktest(
        @Req() req,
        @Body() body: any,
        @Query('accountId') queryAccountId?: string
    ) {
        const accountId = this.resolveAccountId(req, queryAccountId || body.accountId);
        const userId = req.user.id || req.user.userId;
        return this.dashboardService.saveBacktestSession(userId, { ...body, accountId });
    }

    @Post('backtest/screenshot')
    @RequirePlan(PlanTier.FREE)
    @UseInterceptors(new FastifyFileInterceptor('file'))
    async uploadBacktestScreenshot(
        @Req() req,
        @UploadedFile() file: any,
        @Body() body: any
    ) {
        const userId = req.user.id || req.user.userId;
        return this.dashboardService.saveBacktestScreenshotFile(userId, file, body);
    }

    @Post('backtest/screenshot/delete')
    @RequirePlan(PlanTier.FREE)
    async deleteBacktestScreenshot(
        @Req() req,
        @Body() body: { url?: string }
    ) {
        const userId = req.user.id || req.user.userId;
        return this.dashboardService.deleteBacktestScreenshotFile(userId, body?.url);
    }

    @Post('backtest/session-sync')
    @RequirePlan(PlanTier.FREE)
    async syncReplaySession(
        @Req() req,
        @Body() body: any,
        @Query('accountId') queryAccountId?: string
    ) {
        const accountId = this.resolveAccountId(req, queryAccountId || body?.accountId);
        const userId = req.user.id || req.user.userId;
        return this.dashboardService.syncReplaySessionState(userId, { ...body, accountId });
    }

    @Get('backtest/session/:sessionId')
    @RequirePlan(PlanTier.FREE)
    async getReplaySession(
        @Req() req,
        @Param('sessionId') sessionId: string,
        @Query('knownRevision') knownRevisionRaw?: string
    ) {
        const userId = req.user.id || req.user.userId;
        const parsedRev = knownRevisionRaw !== undefined ? Number(knownRevisionRaw) : undefined;
        const knownRevision =
            parsedRev !== undefined && Number.isFinite(parsedRev) && parsedRev > 0
                ? Math.floor(parsedRev)
                : undefined;
        return this.dashboardService.getReplaySessionById(userId, sessionId, knownRevision);
    }

    @Delete('backtest/session/:sessionId')
    @RequirePlan(PlanTier.FREE)
    async deleteReplaySession(
        @Req() req,
        @Param('sessionId') sessionId: string
    ) {
        const userId = req.user.id || req.user.userId;
        return this.dashboardService.deleteReplaySessionById(userId, sessionId);
    }

    @Get('backtest/strategies')
    @RequirePlan(PlanTier.FREE)
    async getBacktestStrategies(@Req() req) {
        const userId = req.user.id || req.user.userId;
        return this.dashboardService.getBacktestStrategies(userId);
    }

    @Post('backtest/strategy-sync')
    @RequirePlan(PlanTier.FREE)
    async syncBacktestStrategy(
        @Req() req,
        @Body() body: any
    ) {
        const userId = req.user.id || req.user.userId;
        return this.dashboardService.syncBacktestStrategy(userId, body);
    }

    @Delete('backtest/strategy/:strategyId')
    @RequirePlan(PlanTier.FREE)
    async deleteBacktestStrategy(
        @Req() req,
        @Param('strategyId') strategyId: string
    ) {
        const userId = req.user.id || req.user.userId;
        return this.dashboardService.deleteBacktestStrategyById(userId, strategyId);
    }

    @Get('backtest/history')
    @RequirePlan(PlanTier.FREE)
    async getBacktestHistory(
        @Req() req,
        @Query('accountId') queryAccountId?: string,
        @Query('slim') slim?: string
    ) {
        const accountId = this.resolveAccountId(req, queryAccountId);
        const userId = req.user.id || req.user.userId;
        const isSlim = slim === '1' || slim === 'true';
        return this.dashboardService.getBacktestHistory(userId, accountId, isSlim);
    }

    @Get('backtest/hypotheses')
    @RequirePlan(PlanTier.FREE)
    async getBacktestHypotheses(
        @Req() req,
        @Query('accountId') queryAccountId?: string
    ) {
        const accountId = this.resolveAccountId(req, queryAccountId);
        const userId = req.user.id || req.user.userId;
        return this.dashboardService.getBacktestHypotheses(userId, accountId);
    }

    @Post('backtest/hypotheses')
    @RequirePlan(PlanTier.FREE)
    async saveBacktestHypothesis(@Req() req, @Body() body: any) {
        const userId = req.user.id || req.user.userId;
        const resolvedAccountId = this.resolveAccountId(req, body?.accountId);
        return this.dashboardService.saveBacktestHypothesis(userId, {
            ...(body || {}),
            ...(resolvedAccountId ? { accountId: resolvedAccountId } : {}),
        });
    }

    @Delete('backtest/hypotheses/:id')
    @RequirePlan(PlanTier.FREE)
    async deleteBacktestHypothesis(@Req() req, @Param('id') id: string) {
        const userId = req.user.id || req.user.userId;
        return this.dashboardService.deleteBacktestHypothesisById(userId, id);
    }
}

