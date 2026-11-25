import { BadRequestException, Controller, Get, Post, Put, Patch, Delete, Body, Req, Res, UseGuards, UseInterceptors, UploadedFile, Param, Query, Optional } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { FastifyFileInterceptor } from '../common/interceptors/fastify-file.interceptor';
import { DashboardService } from './dashboard.service';
import { JournalService } from './journal.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlanGuard, RequirePlan } from '../payment/plan.guard';
import { PlanTier } from '../payment/plan-permission.service';
import { SessionService } from './session.service';
import { WeeklyReportService } from './weekly-report.service';
import { sanitizeJournalPayload } from '../common/security/input-sanitizer.util';
import { CloudflareR2StorageService } from '../common/security/cloudflare-r2-storage.service';
import { DigitalSignatureService } from '../common/security/digital-signature.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, PlanGuard)
@RequirePlan(PlanTier.BASIC)
export class DashboardController {
    constructor(
        private readonly dashboardService: DashboardService,
        private readonly journalService: JournalService,
        private readonly sessionService: SessionService,
        @Optional() private readonly weeklyReportService?: WeeklyReportService,
        @Optional() private readonly r2Storage?: CloudflareR2StorageService,
        @Optional() private readonly digitalSignature?: DigitalSignatureService,
    ) { }

    private resolveAccountId(req: any, queryAccountId?: string): string | undefined {
        const id = queryAccountId || (req.headers['x-account-id'] as string) || undefined;
        if (!id || id === 'all' || id === 'undefined' || id === 'null') {
            return undefined;
        }
        return id;
    }

    private assertObjectBody(body: unknown): Record<string, any> {
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw new BadRequestException('Formato de dados inválido.');
        }
        return sanitizeJournalPayload(body as Record<string, any>);
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
        @Body() body: Record<string, any>,
        @Query('accountId') queryAccountId?: string
    ) {
        const safeBody = this.assertObjectBody(body);
        const accountId = this.resolveAccountId(req, queryAccountId || safeBody?.accountId);
        return this.dashboardService.saveMentalLog(req.user.id, safeBody, accountId);
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
        let imageUrl = `/uploads/${file.filename}`;
        if (this.r2Storage && file?.buffer) {
            const mime = String(file?.mimetype || '').toLowerCase();
            const ext = mime.includes('webp')
                ? 'webp'
                : mime.includes('gif')
                  ? 'gif'
                  : mime.includes('jp')
                    ? 'jpg'
                    : 'png';
            const stored = await this.r2Storage.uploadPrivateObject({
                userId: req.user.id,
                folder: 'mental-logs',
                buffer: file.buffer,
                ext,
                contentType: file.mimetype,
            });
            imageUrl = stored.url;
        }
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
    async createTechnicalJournal(@Req() req, @Body() body: Record<string, any>, @Query('accountId') queryAccountId?: string) {
        const safeBody = this.assertObjectBody(body);
        const userId = req.user.id || req.user.userId;
        const date = safeBody.date;
        const accountId = this.resolveAccountId(req, queryAccountId || safeBody.accountId);
        return this.dashboardService.saveTechnicalJournal(userId, date, safeBody, accountId);
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
        @Body() body: Record<string, any>,
        @Query('accountId') queryAccountId?: string
    ) {
        const safeBody = this.assertObjectBody(body);
        const userId = req.user.id || req.user.userId;
        const accountId = this.resolveAccountId(req, queryAccountId || safeBody?.accountId);
        const rawUpdatedAt = req.headers?.['x-client-updated-at'];
        const clientUpdatedAt =
            (Array.isArray(rawUpdatedAt) ? rawUpdatedAt[0] : rawUpdatedAt) ||
            safeBody?.clientUpdatedAt;
        return this.journalService.upsertDailyNote(userId, date, safeBody, accountId, clientUpdatedAt);
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
        @Body() body: Record<string, any>
    ) {
        const safeBody = this.assertObjectBody(body);
        const userId = req.user.id || req.user.userId;
        const rawUpdatedAt = req.headers?.['x-client-updated-at'];
        const clientUpdatedAt =
            (Array.isArray(rawUpdatedAt) ? rawUpdatedAt[0] : rawUpdatedAt) ||
            safeBody?.clientUpdatedAt;
        return this.journalService.upsertTradeNote(userId, tradeId, safeBody, clientUpdatedAt);
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
    async createGeneralNote(@Req() req, @Body() body: Record<string, any>) {
        const safeBody = this.assertObjectBody(body);
        const userId = req.user.id || req.user.userId;
        return this.journalService.createGeneralNote(userId, safeBody);
    }

    @Put('journal/general/:id')
    async updateGeneralNote(
        @Req() req,
        @Param('id') id: string,
        @Body() body: Record<string, any>
    ) {
        const safeBody = this.assertObjectBody(body);
        const userId = req.user.id || req.user.userId;
        const rawUpdatedAt = req.headers?.['x-client-updated-at'];
        const clientUpdatedAt =
            (Array.isArray(rawUpdatedAt) ? rawUpdatedAt[0] : rawUpdatedAt) ||
            safeBody?.clientUpdatedAt;
        return this.journalService.updateGeneralNote(userId, id, safeBody, clientUpdatedAt);
    }

    @Delete('journal/general/:id')
    async deleteGeneralNote(@Req() req, @Param('id') id: string) {
        const userId = req.user.id || req.user.userId;
        return this.journalService.deleteGeneralNote(userId, id);
    }

    @Post('journal/screenshot')
    @UseInterceptors(new FastifyFileInterceptor('file', { allowedImageOnly: true, maxFileSizeBytes: 5 * 1024 * 1024 }))
    async uploadJournalScreenshot(
        @Req() req,
        @UploadedFile() file: any,
        @Body() body: Record<string, any>
    ) {
        const userId = req.user.id || req.user.userId;
        return this.journalService.uploadJournalScreenshot(userId, file, body || {});
    }

    @Patch('trades/:id')
    async updateTrade(@Req() req, @Param('id') id: string, @Body() body: Record<string, any>) {
        const safeBody = this.assertObjectBody(body);
        const rawUpdatedAt = req.headers?.['x-client-updated-at'];
        const clientUpdatedAt =
            (Array.isArray(rawUpdatedAt) ? rawUpdatedAt[0] : rawUpdatedAt) ||
            safeBody?.clientUpdatedAt;
        return this.dashboardService.updateTradeMetadata(
            req.user.id,
            id,
            safeBody,
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
        @Res({ passthrough: true }) reply: FastifyReply,
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
        const report = await this.dashboardService.getReportData(
            userId,
            accountId,
            startDate,
            endDate,
            symbol,
            type,
            { symbols, side, sessions, outcome }
        );
        if (this.digitalSignature && report && typeof report === 'object') {
            const envelope = this.digitalSignature.signCanonicalPayload(
                report,
                'performance_report',
            );
            reply.header('X-Torex-Signature', envelope.signature);
            reply.header('X-Torex-Signature-Kid', envelope.kid);
            reply.header('X-Torex-Content-Hash', envelope.contentHashSha256);
            return {
                ...report,
                _signature: envelope,
            };
        }
        return report;
    }

    @Post('report/email')
    async sendReportEmail(
        @Req() req,
        @Body() body: { frequency?: string; accountId?: string },
        @Query('accountId') queryAccountId?: string,
    ) {
        const accountId = this.resolveAccountId(req, queryAccountId || body?.accountId);
        const userId = req.user.id || req.user.userId;
        const frequency = String(body?.frequency || '').toUpperCase() === 'WEEKLY' ? 'WEEKLY' : 'MONTHLY';
        return this.weeklyReportService?.sendReportEmailOnDemand(userId, frequency, accountId);
    }

    @Post('backtest/simulate')
    @RequirePlan(PlanTier.PRO)
    async simulateBacktest(
        @Req() req,
        @Body() body: Record<string, any>,
        @Query('accountId') queryAccountId?: string
    ) {
        const safeBody = this.assertObjectBody(body);
        const accountId = this.resolveAccountId(req, queryAccountId || safeBody.accountId);
        const userId = req.user.id || req.user.userId;
        return this.dashboardService.simulateBacktest(userId, accountId, safeBody);
    }

    @Post('backtest/save')
    @RequirePlan(PlanTier.PRO)
    async saveBacktest(
        @Req() req,
        @Body() body: Record<string, any>,
        @Query('accountId') queryAccountId?: string
    ) {
        const safeBody = this.assertObjectBody(body);
        const accountId = this.resolveAccountId(req, queryAccountId || safeBody.accountId);
        const userId = req.user.id || req.user.userId;
        return this.dashboardService.saveBacktestSession(userId, { ...safeBody, accountId });
    }

    @Post('backtest/screenshot')
    @RequirePlan(PlanTier.PRO)
    @UseInterceptors(new FastifyFileInterceptor('file', { allowedImageOnly: true, maxFileSizeBytes: 5 * 1024 * 1024 }))
    async uploadBacktestScreenshot(
        @Req() req,
        @UploadedFile() file: any,
        @Body() body: Record<string, any>
    ) {
        const userId = req.user.id || req.user.userId;
        return this.dashboardService.saveBacktestScreenshotFile(userId, file, body || {});
    }

    @Post('backtest/screenshot/delete')
    @RequirePlan(PlanTier.PRO)
    async deleteBacktestScreenshot(
        @Req() req,
        @Body() body: { url?: string }
    ) {
        const userId = req.user.id || req.user.userId;
        return this.dashboardService.deleteBacktestScreenshotFile(userId, body?.url);
    }

    @Post('backtest/session-sync')
    @RequirePlan(PlanTier.PRO)
    async syncReplaySession(
        @Req() req,
        @Body() body: Record<string, any>,
        @Query('accountId') queryAccountId?: string
    ) {
        const safeBody = this.assertObjectBody(body);
        const accountId = this.resolveAccountId(req, queryAccountId || safeBody?.accountId);
        const userId = req.user.id || req.user.userId;
        return this.dashboardService.syncReplaySessionState(userId, { ...safeBody, accountId });
    }

    @Get('backtest/session/:sessionId')
    @RequirePlan(PlanTier.PRO)
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
    @RequirePlan(PlanTier.PRO)
    async deleteReplaySession(
        @Req() req,
        @Param('sessionId') sessionId: string
    ) {
        const userId = req.user.id || req.user.userId;
        return this.dashboardService.deleteReplaySessionById(userId, sessionId);
    }

    @Get('backtest/strategies')
    @RequirePlan(PlanTier.PRO)
    async getBacktestStrategies(@Req() req) {
        const userId = req.user.id || req.user.userId;
        return this.dashboardService.getBacktestStrategies(userId);
    }

    @Post('backtest/strategy-sync')
    @RequirePlan(PlanTier.PRO)
    async syncBacktestStrategy(
        @Req() req,
        @Body() body: Record<string, any>
    ) {
        const safeBody = this.assertObjectBody(body);
        const userId = req.user.id || req.user.userId;
        return this.dashboardService.syncBacktestStrategy(userId, safeBody);
    }

    @Delete('backtest/strategy/:strategyId')
    @RequirePlan(PlanTier.PRO)
    async deleteBacktestStrategy(
        @Req() req,
        @Param('strategyId') strategyId: string
    ) {
        const userId = req.user.id || req.user.userId;
        return this.dashboardService.deleteBacktestStrategyById(userId, strategyId);
    }

    @Get('backtest/history')
    @RequirePlan(PlanTier.PRO)
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
    @RequirePlan(PlanTier.PRO)
    async getBacktestHypotheses(
        @Req() req,
        @Query('accountId') queryAccountId?: string
    ) {
        const accountId = this.resolveAccountId(req, queryAccountId);
        const userId = req.user.id || req.user.userId;
        return this.dashboardService.getBacktestHypotheses(userId, accountId);
    }

    @Post('backtest/hypotheses')
    @RequirePlan(PlanTier.PRO)
    async saveBacktestHypothesis(@Req() req, @Body() body: Record<string, any>) {
        const safeBody = this.assertObjectBody(body);
        const userId = req.user.id || req.user.userId;
        const resolvedAccountId = this.resolveAccountId(req, safeBody?.accountId);
        return this.dashboardService.saveBacktestHypothesis(userId, {
            ...safeBody,
            ...(resolvedAccountId ? { accountId: resolvedAccountId } : {}),
        });
    }

    @Delete('backtest/hypotheses/:id')
    @RequirePlan(PlanTier.PRO)
    async deleteBacktestHypothesis(@Req() req, @Param('id') id: string) {
        const userId = req.user.id || req.user.userId;
        return this.dashboardService.deleteBacktestHypothesisById(userId, id);
    }
}

