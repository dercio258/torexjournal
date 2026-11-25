import {
    Controller,
    Post,
    Get,
    Body,
    UnauthorizedException,
    Logger,
    UseGuards,
    Patch,
    Param,
    Inject,
    Delete,
    Header,
    BadRequestException,
    Query,
    Optional,
    Req,
    Res,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { randomInt, randomUUID } from 'crypto';
import { AdminAuditService } from './admin-audit.service';
import {
    clearAdminSessionCookie,
    extractAdminToken,
    setAdminSessionCookie,
} from '../common/security/cookie-security.util';
import { extractTrustedClientIp, getAdminJwtSecret, timingSafeEqualStr } from '../common/security/security.config';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { SubscriptionService } from '../payment/subscription.service';
import { AdminIntelligenceService } from './admin-intelligence.service';
import { NetworkAcademyService } from '../network/video-lesson.service';
import { Mt5WorkerService } from '../mt5/worker/mt5-worker.service';
import { Mt5ClusterBalancerService } from '../mt5/worker/mt5-cluster-balancer.service';
import { EconomicCalendarService } from '../economic-calendar/economic-calendar.service';
import {
    AiTrainingReportService,
    TrainingExportFormat,
} from '../ai/ai-training-report.service';
import { AiSemanticMemoryService } from '../ai/ai-semantic-memory.service';
import { AiFeedbackSignalsService } from '../ai/ai-feedback-signals.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { JwtService } from '@nestjs/jwt';
import { AdminAuthGuard } from './admin-auth.guard';
import { EmailProducerService } from '../email/email-producer.service';
import { TelemetryService } from '../common/observability/telemetry.service';
import { Throttle } from '@nestjs/throttler';
import { RedisSecurityService } from '../common/security/redis-security.service';
import { TurnstileService } from '../common/security/turnstile.service';
import {
    AdminLoginDto,
    AdminVerifyOtpDto,
    ToggleTrialCampaignDto,
    AdjustUserSubscriptionDto,
} from './dto/admin.dto';

@Controller('admin')
export class AdminController {
    private readonly logger = new Logger(AdminController.name);

    constructor(
        private configService: ConfigService,
        private usersService: UsersService,
        private subscriptionService: SubscriptionService,
        private adminIntelligenceService: AdminIntelligenceService,
        private academyService: NetworkAcademyService,
        private jwtService: JwtService,
        private emailProducer: EmailProducerService,
        private telemetryService: TelemetryService,
        private redisSecurity: RedisSecurityService,
        @Inject(CACHE_MANAGER) private cacheManager: any,
        @InjectQueue('email-queue') private emailQueue: Queue,
        @InjectQueue('subscription-queue') private subscriptionQueue: Queue,
        @InjectQueue('behavioral-analysis') private behavioralQueue: Queue,
        @InjectQueue('trade-import') private tradeImportQueue: Queue,
        @Optional() private mt5WorkerService?: Mt5WorkerService,
        @Optional() private mt5ClusterBalancer?: Mt5ClusterBalancerService,
        @Optional() private economicCalendarService?: EconomicCalendarService,
        @Optional() private aiTrainingReportService?: AiTrainingReportService,
        @Optional() private aiSemanticMemoryService?: AiSemanticMemoryService,
        @Optional() private aiFeedbackSignalsService?: AiFeedbackSignalsService,
        @Optional() private adminAuditService?: AdminAuditService,
        @Optional() private turnstileService?: TurnstileService,
    ) {}

    // --- Auth ---
    @Throttle({ default: { limit: 5, ttl: 60000 } })
    @Post('auth/login')
    async login(@Body() body: AdminLoginDto, @Req() req: any) {
        if (this.turnstileService) {
            await this.turnstileService.verifyOrThrow(
                body.turnstileToken,
                extractTrustedClientIp(req),
                'admin_login',
            );
        }
        const adminEmail = (this.configService.get<string>('ADMIN_EMAIL') || '').trim().toLowerCase();
        const adminPass = this.configService.get<string>('ADMIN_PASS') || '';

        if (!adminEmail || !adminPass) {
            this.logger.error('ADMIN_EMAIL or ADMIN_PASS is not configured.');
            throw new UnauthorizedException('Autenticação administrativa indisponível');
        }

        const attemptKey = `admin_login_fail:${body.email}`;
        const existingFails = Number((await this.redisSecurity.getValue(attemptKey)) || '0');
        if (existingFails >= 5) {
            throw new UnauthorizedException('Muitas tentativas falhadas. Tente novamente dentro de 10 minutos.');
        }

        const emailMatch = timingSafeEqualStr(body.email, adminEmail);
        const passMatch = timingSafeEqualStr(body.pass, adminPass);

        if (!emailMatch || !passMatch) {
            await this.redisSecurity.incrementWithWindow(attemptKey, 10 * 60 * 1000);
            throw new UnauthorizedException('Credenciais de administrador inválidas');
        }

        await this.redisSecurity.deleteKey(attemptKey);

        const otp = randomInt(100000, 1000000).toString();
        await this.redisSecurity.setValue(`admin_otp:${adminEmail}`, otp, 300000); // 5 mins
        await this.redisSecurity.deleteKey(`admin_otp_fail:${adminEmail}`);

        await this.emailProducer.enqueue(adminEmail, 'OTP_CODE', {
            otp,
            expiresInMinutes: 5,
            purpose: 'ADMIN_LOGIN',
        });

        return {
            success: true,
            otpRequired: true,
            message: 'Código de verificação enviado ao e-mail cadastrado.',
        };
    }

    @Throttle({ default: { limit: 5, ttl: 60000 } })
    @Post('auth/verify')
    async verifyOtp(
        @Body() body: AdminVerifyOtpDto,
        @Req() req: any,
        @Res({ passthrough: true }) res: FastifyReply,
    ) {
        const adminEmail = (this.configService.get<string>('ADMIN_EMAIL') || '').trim().toLowerCase();

        if (!adminEmail || !timingSafeEqualStr(body.email, adminEmail)) {
            throw new UnauthorizedException('E-mail inválido');
        }

        const otpFailKey = `admin_otp_fail:${adminEmail}`;
        const currentFails = Number((await this.redisSecurity.getValue(otpFailKey)) || '0');
        if (currentFails >= 5) {
            await this.redisSecurity.deleteKey(`admin_otp:${adminEmail}`);
            throw new UnauthorizedException('Código invalidado por excesso de tentativas. Faça login novamente.');
        }

        const storedOtp = await this.redisSecurity.getValue(`admin_otp:${adminEmail}`);
        if (!storedOtp || !timingSafeEqualStr(storedOtp, body.otp)) {
            const { count } = await this.redisSecurity.incrementWithWindow(otpFailKey, 300000);
            if (count >= 5) {
                await this.redisSecurity.deleteKey(`admin_otp:${adminEmail}`);
            }
            throw new UnauthorizedException('Código de verificação inválido ou expirado');
        }

        // Consume OTP atomically (single-use)
        const consumed = await this.redisSecurity.consumeOnce(`admin_otp:${adminEmail}`);
        if (!consumed) {
            throw new UnauthorizedException('Código já utilizado ou expirado');
        }
        await this.redisSecurity.deleteKey(otpFailKey);

        const secret = getAdminJwtSecret(this.configService);
        const jti = randomUUID();
        const token = this.jwtService.sign(
            { email: adminEmail, role: 'admin', isAdmin: true, jti },
            { secret, expiresIn: '12h' },
        );

        setAdminSessionCookie(res, req, token);
        void this.adminAuditService?.record({
            adminEmail,
            action: 'ADMIN_LOGIN_SUCCESS',
            targetType: 'session',
            targetId: jti,
            ip: extractTrustedClientIp(req),
        });

        return {
            success: true,
            token,
            user: { email: adminEmail, role: 'admin' },
        };
    }

    @UseGuards(AdminAuthGuard)
    @Post('auth/logout')
    async adminLogout(@Req() req: any, @Res({ passthrough: true }) res: FastifyReply) {
        const token = extractAdminToken(req);
        const jti = req?.admin?.jti;
        if (jti) {
            await this.redisSecurity.setValue(`jwt_revoked:${jti}`, '1', 12 * 60 * 60 * 1000);
        } else if (token) {
            try {
                const decoded: any = this.jwtService.decode(token);
                if (decoded?.jti) {
                    await this.redisSecurity.setValue(`jwt_revoked:${decoded.jti}`, '1', 12 * 60 * 60 * 1000);
                }
            } catch {
                // ignore
            }
        }
        clearAdminSessionCookie(res, req);
        void this.adminAuditService?.record({
            adminEmail: req?.admin?.email,
            action: 'ADMIN_LOGOUT',
            targetType: 'session',
            targetId: jti || null,
            ip: extractTrustedClientIp(req),
        });
        return { success: true };
    }

    @UseGuards(AdminAuthGuard)
    @Get('audit-logs')
    async getAdminAuditLogs(
        @Query('search') search?: string,
        @Query('action') action?: string,
        @Query('limit') limit?: string,
    ) {
        if (!this.adminAuditService) {
            return { items: [], chainIntegrity: { valid: true, checked: 0 } };
        }
        return this.adminAuditService.listLogs({
            search,
            action,
            limit: limit ? Number(limit) : undefined,
        });
    }

    // --- Observability, Telemetry, Technical Errors & Redis Queue Inspection ---
    @UseGuards(AdminAuthGuard)
    @Get('telemetry')
    async getTelemetry() {
        return this.telemetryService.getSnapshot();
    }

    @UseGuards(AdminAuthGuard)
    @Get('errors')
    async listTechnicalErrors(
        @Query('search') search?: string,
        @Query('domain') domain?: string,
        @Query('severity') severity?: string,
        @Query('status') status?: string,
        @Query('limit') limit?: string,
    ) {
        return this.telemetryService.listTechnicalErrors({
            search,
            domain,
            severity,
            status,
            limit: limit ? Number(limit) : undefined,
        });
    }

    @UseGuards(AdminAuthGuard)
    @Patch('errors/:idOrRef/resolve')
    async resolveTechnicalError(
        @Param('idOrRef') idOrRef: string,
        @Body() body: { resolved?: boolean },
        @Req() req: any,
    ) {
        const clean = String(idOrRef || '').trim();
        if (!clean || clean.length > 80) {
            throw new BadRequestException('Referência de erro inválida.');
        }
        const res = await this.telemetryService.setTechnicalErrorStatus(
            clean,
            body?.resolved !== false,
        );
        void this.adminAuditService?.record({
            adminEmail: req?.admin?.email,
            action: body?.resolved !== false ? 'ERROR_RESOLVED' : 'ERROR_REOPENED',
            targetType: 'system_error',
            targetId: clean,
            ip: extractTrustedClientIp(req),
        });
        return res;
    }

    @UseGuards(AdminAuthGuard)
    @Get('metrics')
    @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
    async getPrometheusMetrics() {
        return this.telemetryService.toPrometheusText();
    }

    @UseGuards(AdminAuthGuard)
    @Get('queues')
    async getQueueStats() {
        const inspectQueue = async (queue: Queue) => {
            try {
                const counts = await queue.getJobCounts();
                const failedJobs = await queue.getFailed(0, 19);
                return {
                    name: queue.name,
                    counts,
                    recentFailed: failedJobs.map((j) => ({
                        id: j.id,
                        name: j.name,
                        attemptsMade: j.attemptsMade,
                        failedReason: j.failedReason,
                        timestamp: j.timestamp,
                        finishedOn: j.finishedOn,
                        template: j.data?.template,
                        recipient: j.data?.to || j.data?.email,
                    })),
                };
            } catch (err: any) {
                return {
                    name: queue.name,
                    error: err?.message || 'Queue unavailable',
                    counts: { active: 0, waiting: 0, completed: 0, failed: 0, delayed: 0 },
                    recentFailed: [],
                };
            }
        };

        const [email, subscription, behavioral, tradeImport] = await Promise.all([
            inspectQueue(this.emailQueue),
            inspectQueue(this.subscriptionQueue),
            inspectQueue(this.behavioralQueue),
            inspectQueue(this.tradeImportQueue),
        ]);

        return {
            timestamp: new Date().toISOString(),
            queues: {
                'email-queue': email,
                'subscription-queue': subscription,
                'behavioral-analysis': behavioral,
                'trade-import': tradeImport,
            },
        };
    }

    @UseGuards(AdminAuthGuard)
    @Post('queues/:name/retry-failed')
    async retryFailedQueueJobs(@Param('name') name: string) {
        const queueMap: Record<string, Queue> = {
            'email-queue': this.emailQueue,
            'subscription-queue': this.subscriptionQueue,
            'behavioral-analysis': this.behavioralQueue,
            'trade-import': this.tradeImportQueue,
        };
        const targetQueue = queueMap[name];
        if (!targetQueue) {
            throw new BadRequestException(`Fila desconhecida: ${name}`);
        }

        const failedJobs = await targetQueue.getFailed(0, 99);
        let retried = 0;
        for (const job of failedJobs) {
            try {
                await job.retry();
                retried += 1;
            } catch {
                // Job may have already been removed/retried concurrently
            }
        }
        return { success: true, queue: name, retried };
    }

    // --- System Structural Overview & MT5 Calendar Automation ---
    @UseGuards(AdminAuthGuard)
    @Get('system-overview')
    async getSystemOverview() {
        const [
            finance,
            plans,
            trialCampaign,
            lessons,
            queuesRes,
            demoFeed,
            calendarSync,
            intelligence,
        ] = await Promise.all([
            this.subscriptionService.getFinancialStats().catch(() => null),
            this.subscriptionService.getAllPlans().catch(() => []),
            this.subscriptionService.getTrialCampaignStatus().catch(() => null),
            this.academyService.adminListLessons().catch(() => []),
            this.getQueueStats().catch(() => ({ queues: {} })),
            this.mt5WorkerService ? this.mt5WorkerService.getSharedDemoFeedAccount().catch(() => null) : Promise.resolve(null),
            this.economicCalendarService ? this.economicCalendarService.getSyncStatus().catch(() => null) : Promise.resolve(null),
            this.adminIntelligenceService.getDashboardIntelligence().catch(() => null),
        ]);

        const workersRaw = this.mt5WorkerService ? this.mt5WorkerService.getWorkerStatus() : [];
        const workers = Array.isArray(workersRaw) ? workersRaw : [];
        const plansArr = Array.isArray(plans) ? plans : [];
        const lessonsArr = Array.isArray(lessons) ? lessons : [];

        return {
            timestamp: new Date().toISOString(),
            finance,
            plans: {
                total: plansArr.length,
                active: plansArr.filter((p: any) => p.isActive !== false).length,
                trialCampaign,
            },
            academy: {
                totalLessons: lessonsArr.length,
                publishedLessons: lessonsArr.filter((l: any) => Boolean(l.isPublished)).length,
            },
            mt5: {
                workers,
                onlineWorkers: workers.filter((w: any) => Boolean(w.isOnline)).length,
                demoFeed,
                calendarSync,
            },
            telemetry: this.telemetryService.getSnapshot(),
            queues: queuesRes?.queues || {},
            intelligence,
        };
    }

    @UseGuards(AdminAuthGuard)
    @Post('mt5-calendar/sync')
    async triggerMt5CalendarSync() {
        const triggerResult = this.mt5WorkerService
            ? await this.mt5WorkerService.triggerMt5CalendarSync()
            : {
                  success: false,
                  skipped: true,
                  message: 'Mt5WorkerService indisponível nesta instância do servidor.',
              };
        const calendarSync = this.economicCalendarService
            ? await this.economicCalendarService.getSyncStatus().catch(() => null)
            : null;
        return {
            ...triggerResult,
            calendarSync,
        };
    }

    // --- Users ---
    @UseGuards(AdminAuthGuard)
    @Get('users')
    async getUsers(
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('search') search?: string,
        @Query('source') source?: string,
        @Query('planStatus') planStatus?: string,
        @Query('activityFilter') activityFilter?: string,
        @Query('sortBy') sortBy?: string,
        @Query('sortDir') sortDir?: string,
    ) {
        return this.adminIntelligenceService.getAdminUsersOverview({
            page: page ? Number(page) : undefined,
            limit: limit ? Number(limit) : undefined,
            search,
            source,
            planStatus,
            activityFilter,
            sortBy,
            sortDir,
        });
    }

    @UseGuards(AdminAuthGuard)
    @Get('users/:id/intelligence')
    async getUserIntelligence(@Param('id') id: string) {
        return this.adminIntelligenceService.getUser360Intelligence(id);
    }

    // --- Finance / Stats ---
    @UseGuards(AdminAuthGuard)
    @Get('stats')
    async getStats() {
        return this.subscriptionService.getFinancialStats();
    }

    // --- Subscription Plan Management ---
    @UseGuards(AdminAuthGuard)
    @Get('plans')
    async getPlans() {
        return this.subscriptionService.getAllPlans();
    }

    @UseGuards(AdminAuthGuard)
    @Patch('plans/:id')
    async updatePlan(@Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
        const res = await this.subscriptionService.updatePlanConfig(id, body);
        void this.adminAuditService?.record({
            adminEmail: req?.admin?.email,
            action: 'UPDATE_PLAN_CONFIG',
            targetType: 'plan',
            targetId: id,
            ip: extractTrustedClientIp(req),
        });
        return res;
    }

    @UseGuards(AdminAuthGuard)
    @Post('plans')
    async createPlan(@Body() body: Record<string, any>, @Req() req: any) {
        const res = await this.subscriptionService.createPlanConfig(body);
        void this.adminAuditService?.record({
            adminEmail: req?.admin?.email,
            action: 'CREATE_PLAN_CONFIG',
            targetType: 'plan',
            targetId: String((res as any)?.id || ''),
            ip: extractTrustedClientIp(req),
        });
        return res;
    }

    // --- Trial Campaign Management ---
    @UseGuards(AdminAuthGuard)
    @Get('trial-campaign')
    async getTrialCampaign() {
        return this.subscriptionService.getTrialCampaignStatus();
    }

    @UseGuards(AdminAuthGuard)
    @Get('subscription-conversion-insights')
    async getSubscriptionConversionInsights(@Query('days') days?: string) {
        return this.subscriptionService.getSubscriptionConversionInsights(Number(days) || 30);
    }

    @UseGuards(AdminAuthGuard)
    @Post('trial-campaign/toggle')
    async toggleTrialCampaign(@Body() body: ToggleTrialCampaignDto) {
        return this.subscriptionService.toggleTrialCampaign(body.enabled, body.days);
    }

    // --- User Subscription History ---
    @UseGuards(AdminAuthGuard)
    @Get('users/:id/subscriptions')
    async getUserSubscriptions(@Param('id') id: string) {
        return this.subscriptionService.getUserSubscriptionHistory(id);
    }

    // --- Admin User Plan Assignment & Extension ---
    @UseGuards(AdminAuthGuard)
    @Post('users/:id/subscription')
    async adjustUserSubscription(
        @Param('id') id: string,
        @Body() body: AdjustUserSubscriptionDto,
        @Req() req: any,
    ) {
        const res = await this.subscriptionService.adminAdjustUserSubscription(id, body);
        void this.adminAuditService?.record({
            adminEmail: req?.admin?.email,
            action: 'ADJUST_USER_SUBSCRIPTION',
            targetType: 'user',
            targetId: id,
            ip: extractTrustedClientIp(req),
            details: { planTier: (body as any)?.planTier, days: (body as any)?.days, status: (body as any)?.status },
        });
        return res;
    }

    // --- Video Lessons (Comunidade & Videoaulas em /network) ---
    @UseGuards(AdminAuthGuard)
    @Get('lessons')
    async getAdminLessons() {
        return this.academyService.adminListLessons();
    }

    @UseGuards(AdminAuthGuard)
    @Post('lessons')
    async createAdminLesson(@Body() body: any) {
        return this.academyService.adminCreateLesson(body);
    }

    @UseGuards(AdminAuthGuard)
    @Patch('lessons/:id')
    async updateAdminLesson(@Param('id') id: string, @Body() body: any) {
        return this.academyService.adminUpdateLesson(id, body);
    }

    @UseGuards(AdminAuthGuard)
    @Delete('lessons/:id')
    async deleteAdminLesson(@Param('id') id: string) {
        return this.academyService.adminDeleteLesson(id);
    }

    // --- Torex AI Training Report, Exportable Datasets & Semantic Memory Curation ---
    @UseGuards(AdminAuthGuard)
    @Get('ai/training-report')
    async getAiTrainingReport(
        @Query('days') days?: string,
        @Query('from') from?: string,
        @Query('to') to?: string,
    ) {
        if (!this.aiTrainingReportService) {
            throw new BadRequestException('AI training report service unavailable');
        }
        return this.aiTrainingReportService.generateTrainingReport({
            days: days ? Number(days) : undefined,
            from,
            to,
        });
    }

    @UseGuards(AdminAuthGuard)
    @Get('ai/training-report/export')
    async exportAiTrainingArtifact(
        @Query('format') format?: string,
        @Query('days') days?: string,
    ) {
        if (!this.aiTrainingReportService) {
            throw new BadRequestException('AI training report service unavailable');
        }
        const allowed: TrainingExportFormat[] = [
            'markdown',
            'json',
            'sft_jsonl',
            'rag_qa_jsonl',
            'dpo_jsonl',
            'eval_jsonl',
        ];
        const cleanFormat = (format || 'markdown').trim() as TrainingExportFormat;
        if (!allowed.includes(cleanFormat)) {
            throw new BadRequestException(
                `Unsupported format "${format}". Allowed: ${allowed.join(', ')}`,
            );
        }
        return this.aiTrainingReportService.exportArtifact(cleanFormat, {
            days: days ? Number(days) : undefined,
        });
    }

    @UseGuards(AdminAuthGuard)
    @Get('ai/semantic-memory')
    async listAiSemanticMemory(
        @Query('status') status?: string,
        @Query('scope') scope?: string,
        @Query('limit') limit?: string,
    ) {
        if (!this.aiSemanticMemoryService) {
            throw new BadRequestException('AI semantic memory service unavailable');
        }
        return {
            items: await this.aiSemanticMemoryService.listGlobalMemoriesForAdmin({
                status,
                scope,
                limit: limit ? Number(limit) : undefined,
            }),
        };
    }

    @UseGuards(AdminAuthGuard)
    @Post('ai/semantic-memory/:id/review')
    async reviewAiSemanticMemory(
        @Param('id') id: string,
        @Body() body: { action?: string },
    ) {
        if (!this.aiSemanticMemoryService) {
            throw new BadRequestException('AI semantic memory service unavailable');
        }
        const uuidRx =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRx.test(String(id || '').trim())) {
            throw new BadRequestException('Invalid memory ID');
        }
        const action = String(body?.action || '')
            .trim()
            .toUpperCase();
        if (
            action !== 'APPROVE' &&
            action !== 'QUARANTINE' &&
            action !== 'RETIRE'
        ) {
            throw new BadRequestException(
                'Action must be APPROVE, QUARANTINE, or RETIRE',
            );
        }
        const updated = await this.aiSemanticMemoryService.reviewMemoryByAdmin(
            id,
            action,
        );
        if (!updated) {
            throw new BadRequestException('Semantic memory entry not found');
        }
        return { ok: true, item: updated };
    }

    /** Replies users rejected (👎), newest first, with their implicit score and the signal summary. */
    @UseGuards(AdminAuthGuard)
    @Get('ai/rejected-replies')
    async listAiRejectedReplies(
        @Query('limit') limit?: string,
        @Query('includeReviewed') includeReviewed?: string,
    ) {
        if (!this.aiFeedbackSignalsService) {
            throw new BadRequestException('AI feedback signals service unavailable');
        }
        const [items, implicitSignals] = await Promise.all([
            this.aiFeedbackSignalsService.listRejectedReplies({
                limit: limit ? Number(limit) : undefined,
                includeReviewed: includeReviewed === 'true',
            }),
            this.aiFeedbackSignalsService.summarizeSignals(30),
        ]);
        return { items, implicitSignals };
    }

    @UseGuards(AdminAuthGuard)
    @Post('ai/rejected-replies/:id/review')
    async reviewAiRejectedReply(
        @Param('id') id: string,
        @Body() body: { action?: string },
    ) {
        if (!this.aiFeedbackSignalsService) {
            throw new BadRequestException('AI feedback signals service unavailable');
        }
        const uuidRx =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRx.test(String(id || '').trim())) {
            throw new BadRequestException('Invalid feedback ID');
        }
        const action = String(body?.action || '').trim().toUpperCase();
        if (action !== 'QUARANTINE_MEMORY' && action !== 'DISMISS') {
            throw new BadRequestException('Action must be QUARANTINE_MEMORY or DISMISS');
        }
        const ok = await this.aiFeedbackSignalsService.reviewRejectedReply(id, action);
        if (!ok) {
            throw new BadRequestException('Rejected reply not found');
        }
        return { ok: true };
    }

    // --- MT5 Load Balancer & Continuous Fleet Monitoring ---
    @UseGuards(AdminAuthGuard)
    @Get('mt5-cluster/overview')
    async getMt5ClusterOverview() {
        if (!this.mt5ClusterBalancer) {
            throw new BadRequestException('MT5 Cluster Balancer unavailable');
        }
        return this.mt5ClusterBalancer.getClusterOverview();
    }

    @UseGuards(AdminAuthGuard)
    @Post('mt5-cluster/workers/:workerId/drain')
    async drainMt5Worker(
        @Param('workerId') workerId: string,
        @Body() body: { drain?: boolean },
    ) {
        if (!this.mt5ClusterBalancer) {
            throw new BadRequestException('MT5 Cluster Balancer unavailable');
        }
        return this.mt5ClusterBalancer.setWorkerDrain(
            String(workerId || '').trim(),
            body?.drain !== false,
        );
    }

    @UseGuards(AdminAuthGuard)
    @Post('mt5-cluster/rebalance')
    async rebalanceMt5Cluster() {
        if (!this.mt5ClusterBalancer) {
            throw new BadRequestException('MT5 Cluster Balancer unavailable');
        }
        return this.mt5ClusterBalancer.rebalanceCluster();
    }
}
