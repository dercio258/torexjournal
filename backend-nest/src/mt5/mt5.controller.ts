import { Controller, Post, Get, Delete, Body, HttpCode, Param, Query, UseGuards, Req, Headers, Logger, ForbiddenException, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { randomUUID } from 'crypto';
import { AppTokenGuard } from '../auth/app-token.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Mt5Service } from './mt5.service';
import { Mt5DataDto } from './dto/mt5-data.dto';
import { Mt5InstanceService } from './mt5-instance.service';
import { ConfigService } from '@nestjs/config';
import { CryptoUtil } from '../common/utils/crypto.util';
import { getMt5CredentialSecret } from '../common/security/security.config';
import { PlanGuard, RequirePlan } from '../payment/plan.guard';
import { PlanTier } from '../payment/plan-permission.service';

import { Mt5TcpServer } from '../mt5-tcp.server';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountEntity, AccountType } from '../account/account.entity';
import { Mt5WorkerService, WorkerTask, WorkerTaskType } from './worker/mt5-worker.service';
import {
    Mt5ClusterBalancerService,
    humanizeClientSyncMessage,
} from './worker/mt5-cluster-balancer.service';

@Controller('mt5')
export class Mt5Controller {
    private readonly logger = new Logger(Mt5Controller.name);

    constructor(
        private readonly mt5Service: Mt5Service,
        @InjectQueue('mt5-data') private mt5Queue: Queue,
        private readonly mt5TcpServer: Mt5TcpServer,
        private readonly mt5InstanceService: Mt5InstanceService,
        private readonly mt5WorkerService: Mt5WorkerService,
        private readonly mt5ClusterBalancer: Mt5ClusterBalancerService,
        private readonly configService: ConfigService,
        @InjectRepository(AccountEntity)
        private readonly accountRepo: Repository<AccountEntity>,
    ) { }

    private isValidUuid(id?: string): boolean {
        return !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim());
    }

    private sanitizeTaskForClient(task: WorkerTask | null) {
        if (!task) return null;
        const { credentialToken, targetWorkerId: _w, leaseEpoch: _e, ...safeTask } = task;
        return {
            ...safeTask,
            message: safeTask.message ? humanizeClientSyncMessage(safeTask.message) : safeTask.message,
            errorMessage: safeTask.errorMessage
                ? humanizeClientSyncMessage(safeTask.errorMessage)
                : safeTask.errorMessage,
        };
    }

    @Get('import-history')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async getImportHistory(
        @Req() req,
        @Query('accountId') accountId?: string,
        @Query('page') pageStr?: string,
        @Query('limit') limitStr?: string,
        @Query('paginated') paginated?: string
    ) {
        return this.mt5Service.getImportHistory(req.user.id, accountId, {
            page: pageStr ? parseInt(pageStr, 10) : undefined,
            limit: limitStr ? parseInt(limitStr, 10) : undefined,
            paginated: paginated === 'true' || paginated === '1',
        });
    }

    @Delete('import-history/:id/revert')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async revertImport(@Param('id') id: string, @Req() req) {
        return this.mt5Service.revertImport(Number(id), req.user.id);
    }

    @Post('data')
    @UseGuards(AppTokenGuard)
    @HttpCode(200)
    async syncData(@Body() data: Mt5DataDto) {
        await this.mt5Queue.add('sync-data', data, {
            removeOnComplete: true,
            removeOnFail: 100,
            attempts: 3,
            backoff: 1000
        });
        return { success: true, queued: true };
    }

    @Post('save-history')
    @UseGuards(AppTokenGuard)
    @HttpCode(200)
    async saveHistory(@Body() trades: any[], @Req() req) {
        const account = req.account;
        await this.mt5Queue.add('save-history', {
            trades,
            userId: account?.userId,
            accountId: account?.id
        }, {
            removeOnComplete: true,
            removeOnFail: 50,
            attempts: 3
        });
        return { success: true, queued: true };
    }

    @Post(':id/command')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.PRO)
    async sendCommand(@Param('id') id: string, @Body() body: { type: number, payload?: string }, @Req() req) {
        const cleanId = (id || '').trim();
        const whereConds: any[] = [{ mt5Id: cleanId, userId: req.user.id }];
        if (this.isValidUuid(cleanId)) {
            whereConds.push({ id: cleanId, userId: req.user.id });
        }
        const ownedAccount = await this.accountRepo.findOne({ where: whereConds });
        if (!ownedAccount) {
            throw new ForbiddenException('Acesso negado: conta MT5 não pertence a este usuário.');
        }

        const success =
            this.mt5TcpServer.sendCommand(ownedAccount.id, body.type, body.payload) ||
            (ownedAccount.mt5Id
                ? this.mt5TcpServer.sendCommand(String(ownedAccount.mt5Id).trim(), body.type, body.payload)
                : false) ||
            this.mt5TcpServer.sendCommand(cleanId, body.type, body.payload);
        if (!success) {
            return { success: false, message: 'MT5 not connected or send failed' };
        }
        return { success: true, message: `Command ${body.type} sent to ${cleanId}` };
    }

    @Post('journal/:ticket')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.PRO)
    async updateJournal(@Body() data: any, @Param('ticket') ticket: string, @Req() req) {
        return this.mt5Service.updateJournal(ticket, data, req.user.id);
    }

    @Post('trades/:id/behavior-feedback')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async submitBehaviorFeedback(
        @Param('id') id: string,
        @Body() body: { verdict: 'CONFIRM' | 'FALSE_POSITIVE'; correctedFlags?: string[]; note?: string },
        @Req() req,
    ) {
        return this.mt5Service.submitBehaviorFeedback(id, body, req.user.id);
    }

    @Get('behavior-analytics')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async getBehaviorAnalytics(@Req() req, @Query('accountId') accountId?: string) {
        return this.mt5Service.getBehaviorAnalytics(req.user.id, accountId);
    }

    @Get('behavior-review-queue')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async getBehaviorReviewQueue(
        @Req() req,
        @Query('accountId') accountId?: string,
        @Query('limit') limit?: string,
    ) {
        return this.mt5Service.getBehaviorReviewQueue(req.user.id, accountId, Number(limit) || 50);
    }

    @Post('manual')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async createManualTrade(@Body() data: any, @Req() req) {
        return this.mt5Service.createManualTrade(data, req.user.id);
    }

    @Post('ping')
    @UseGuards(AppTokenGuard)
    @HttpCode(200)
    async ping(@Headers('x-app-token') token: string) {
        if (token) {
            await this.mt5Service.updateHeartbeat(token);
        }
        return 'pong';
    }

    @Get('worker/status')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async getWorkerStatus() {
        return {
            workers: this.mt5WorkerService.getWorkerStatus(undefined, false),
            pendingTasks: this.mt5WorkerService.getPendingTasks(false).length
        };
    }

    @Get('cloud/status')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async getCloudStatus(
        @Req() req,
        @Query('accountId') accountId?: string,
        @Query('login') login?: string
    ) {
        return this.mt5WorkerService.getCloudConnectionStatus(req.user.id, accountId, login);
    }

    @Get('cloud/task/:taskId')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async getCloudTaskStatus(@Param('taskId') taskId: string, @Req() req) {
        const task = this.mt5WorkerService.getTaskById(taskId);
        if (task && task.options?.userId && task.options.userId !== req.user.id) {
            throw new NotFoundException('Tarefa não encontrada.');
        }
        const cloudStatus = await this.mt5WorkerService.getCloudConnectionStatus(
            req.user.id,
            task?.options?.accountUuid,
            task?.login
        );
        return {
            task: this.sanitizeTaskForClient(task),
            account: cloudStatus.account,
            worker: cloudStatus.worker,
            recentTrades: cloudStatus.recentTrades,
            totalTradesCount: cloudStatus.totalTradesCount,
            auditLogs: cloudStatus.auditLogs,
            recentEvents: cloudStatus.recentEvents,
        };
    }

    @Post('cloud/connect')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.PRO)
    async connectCloud(@Body() body: { login: string; pass: string; server: string; accountId?: string }, @Req() req) {
        const cleanLogin = (body.login || '').toString().replace(/[\r\n\0]/g, '').trim();
        const cleanServer = this.mt5WorkerService.normalizeBrokerServer((body.server || '').toString().replace(/[\r\n\0]/g, '').trim());
        const cleanPass = String(body.pass || '').replace(/[\r\n\0]/g, '').trim();

        if (!/^\d{4,16}$/.test(cleanLogin) || !cleanServer || !cleanPass) {
            throw new BadRequestException('Informe um login MT5 numérico válido (4-16 dígitos), senha e servidor.');
        }

        // Impede sequestro de conta MT5 já conectada e ativa em outro utilizador
        const foreignActive = await this.accountRepo.findOne({
            where: {
                mt5Id: cleanLogin,
                broker: cleanServer,
                isConnected: true,
                isArchived: false,
            },
        });
        if (foreignActive && foreignActive.userId !== req.user.id) {
            throw new ConflictException('Esta conta MT5 já está vinculada e ativa em outro utilizador.');
        }

        // 1. Isolamento estrito multi-tenant por (userId, mt5Id):
        // NUNCA busca mt5Id sem userId e NUNCA transfere userId de outra conta!
        const account = await this.accountRepo.findOne({
            where: { mt5Id: cleanLogin, userId: req.user.id }
        });

        const lowerSrv = cleanServer.toLowerCase();
        const isDemoServer = lowerSrv.includes('demo') || lowerSrv.includes('trial');
        const isPropServer =
            lowerSrv.includes('ftmo') ||
            lowerSrv.includes('goatfunded') ||
            lowerSrv.includes('fundingpips') ||
            lowerSrv.includes('fundednext') ||
            lowerSrv.includes('fivepercent') ||
            lowerSrv.includes('alphacapital') ||
            lowerSrv.includes('maven') ||
            lowerSrv.includes('e8markets') ||
            lowerSrv.includes('blueguardian') ||
            lowerSrv.includes('fxify') ||
            lowerSrv.includes('thefundedtrader') ||
            lowerSrv.includes('topstep');

        const inferredType = isPropServer
            ? AccountType.PROP_FIRM
            : (isDemoServer ? AccountType.DEMO : AccountType.LIVE);

        const activeUserAccountsCount = await this.accountRepo.count({ where: { userId: req.user.id, isArchived: false } });

        let targetAccount: AccountEntity;
        const encryptedPass = CryptoUtil.encrypt(
            cleanPass,
            getMt5CredentialSecret(this.configService),
        );
        if (!account) {
            const created = this.accountRepo.create({
                userId: req.user.id,
                mt5Id: cleanLogin,
                broker: cleanServer || 'MetaTrader 5',
                name: `MT5 ${cleanLogin}`,
                type: inferredType,
                currency: 'USD',
                isPrimary: activeUserAccountsCount === 0,
                isArchived: false,
                archivedAt: null,
                isConnected: false,
                initialBalance: 0,
                balance: 0,
                equity: 0,
                mt5EncryptedPass: encryptedPass,
                appToken: randomUUID().replace(/-/g, '').toUpperCase()
            });
            targetAccount = await this.accountRepo.save(created);
            this.logger.log(`Nova Conta de Trading criada automaticamente para conexão MT5: ${targetAccount.name} (ID: ${targetAccount.id}, User: ${req.user.id})`);
        } else {
            account.isArchived = false;
            account.archivedAt = null;
            if (cleanServer) account.broker = cleanServer;
            if (!account.name || account.name === 'Conta Principal') {
                account.name = `MT5 ${cleanLogin}`;
            }
            if (!account.appToken) {
                account.appToken = randomUUID().replace(/-/g, '').toUpperCase();
            }
            account.mt5EncryptedPass = encryptedPass;
            account.inactivityWarnedAt = null;
            account.inactivityDisconnectAt = null;
            targetAccount = await this.accountRepo.save(account);
        }

        // 2. Balanceador Pair-Stride (K=2) atribui worker saudável com sticky affinity & failover
        const assignment = await this.mt5ClusterBalancer.assignWorkerForAccount(targetAccount.id);

        // 3. Dispatch task direcionado ao Worker atribuído
        const numId = parseInt(cleanLogin.replace(/\D/g, ''), 10) || 1;
        const task = this.mt5WorkerService.createAccountTask(
            WorkerTaskType.START_ACCOUNT,
            cleanLogin,
            cleanServer,
            cleanPass,
            numId,
            {
                userId: req.user.id,
                accountUuid: targetAccount.id,
                targetWorkerId: assignment.workerId || undefined,
                leaseEpoch: assignment.leaseEpoch,
            },
        );

        this.logger.log(
            `[AUDIT] Usuário ${req.user.id} solicitou conexão MT5 Cloud para ${cleanLogin}@${task.server} (AccountID: ${targetAccount.id}, Worker: ${assignment.workerId || 'AUTO'}, TaskID: ${task.id})`
        );

        // 3. Optional local instance startup if running directly on Windows host
        let localInstance = null;
        if (process.platform === 'win32') {
            try {
                localInstance = await this.mt5InstanceService.startInstance(req.user.id, cleanLogin, cleanPass, task.server);
            } catch (e) {
                this.logger.log(`Mt5InstanceService local não ativo (${e.message}). Tarefa enviada para fila distribuída.`);
            }
        }

        const { mt5EncryptedPass: _omitPass, ...safeAccount } = targetAccount as any;

        return {
            success: true,
            message: 'Ligação iniciada! Estamos a conectar a sua conta em segurança.',
            taskId: task.id,
            task: this.sanitizeTaskForClient(task),
            accountId: targetAccount.id,
            account: safeAccount,
            server: task.server,
            instance: localInstance
        };
    }

    @Post('cloud/sync')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.PRO)
    async syncCloud(@Body() body: { login?: string; accountId?: string; forceFull?: boolean }, @Req() req) {
        let account: AccountEntity | null = null;
        const validAccountId = this.isValidUuid(body.accountId) ? body.accountId!.trim() : undefined;

        if (body.login && body.login.trim()) {
            const targetLogin = body.login.trim();
            account = await this.accountRepo.findOne({ where: { mt5Id: targetLogin, userId: req.user.id } });
        } else if (validAccountId) {
            const byId = await this.accountRepo.findOne({ where: { id: validAccountId, userId: req.user.id } });
            if (byId && byId.mt5Id) {
                account = byId;
            }
        }
        if (!account) {
            account = await this.accountRepo
                .createQueryBuilder('acc')
                .where('acc.userId = :userId', { userId: req.user.id })
                .andWhere('acc.isArchived = false')
                .andWhere('acc.mt5Id IS NOT NULL')
                .andWhere("acc.mt5Id != ''")
                .orderBy('acc.updatedAt', 'DESC')
                .getOne();
        }
        const cleanLogin = (account?.mt5Id || '').toString().trim();
        if (!account || !cleanLogin) {
            return { success: false, message: 'Nenhuma conta vinculada para sincronizar.' };
        }
        const numId = parseInt(cleanLogin.replace(/\D/g, ''), 10) || 1;
        const taskType = body.forceFull === false ? WorkerTaskType.SYNC_ACCOUNT : WorkerTaskType.FORCE_FULL_SYNC;
        const task = this.mt5WorkerService.createAccountTask(
            taskType,
            cleanLogin,
            account.broker || '',
            undefined,
            numId,
            {
                userId: req.user.id,
                accountUuid: account.id,
                targetWorkerId: account.assignedWorkerId || undefined,
                leaseEpoch: account.mt5LeaseEpoch || 1,
            },
        );
        return {
            success: true,
            message: 'Sincronização iniciada! Os dados da sua conta estão a ser atualizados.',
            taskId: task.id,
            task: this.sanitizeTaskForClient(task),
            accountId: account.id
        };
    }

    @Post('cloud/keep-alive')
    @UseGuards(JwtAuthGuard)
    async keepCloudAccountAlive(@Body() body: { accountId: string }, @Req() req) {
        if (!this.isValidUuid(body?.accountId)) {
            throw new BadRequestException('Informe um accountId válido.');
        }
        return this.mt5ClusterBalancer.keepAccountAlive(req.user.id, body.accountId.trim());
    }

    @Post('cloud/disconnect')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.PRO)
    async disconnectCloud(@Body() body: { login: string; accountId?: string }, @Req() req) {
        const cleanLogin = (body.login || '').toString().trim();
        const validAccountId = this.isValidUuid(body.accountId) ? body.accountId!.trim() : undefined;

        let acc: AccountEntity | null = null;
        if (cleanLogin) {
            acc = await this.accountRepo.findOne({ where: { mt5Id: cleanLogin, userId: req.user.id } });
        } else if (validAccountId) {
            acc = await this.accountRepo.findOne({ where: { id: validAccountId, userId: req.user.id } });
        }

        if (!acc) {
            throw new ForbiddenException('Acesso negado: conta MT5 não encontrada para este usuário.');
        }

        const targetLogin = (acc.mt5Id || cleanLogin).trim();
        const numId = parseInt(targetLogin.replace(/\D/g, ''), 10) || 1;
        const task = this.mt5WorkerService.createAccountTask(
            WorkerTaskType.STOP_ACCOUNT,
            targetLogin,
            acc.broker || '',
            undefined,
            numId,
            {
                userId: req.user.id,
                accountUuid: acc.id,
                targetWorkerId: acc.assignedWorkerId || undefined,
                leaseEpoch: acc.mt5LeaseEpoch || 1,
            },
        );

        acc.isConnected = false;
        acc.assignedWorkerId = null;
        acc.mt5SyncTier = 'COLD';
        acc.inactivityWarnedAt = null;
        acc.inactivityDisconnectAt = null;
        await this.accountRepo.save(acc);

        try {
            await this.mt5InstanceService.stopInstance(req.user.id, targetLogin);
        } catch (e) {
            // ignore local error
        }

        return { success: true, message: 'Terminal desconectado', taskId: task.id };
    }

    /**
     * Returns the Shared MT5 Demo Account used across all Backtest & Replay sessions for market data.
     */
    @Get('market-feed-demo')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async getMarketFeedDemo(@Req() req) {
        return this.mt5WorkerService.getSharedDemoFeedAccount(req.user.id);
    }

    /**
     * Saves and connects the Shared MT5 Demo Account to be reused across all Backtest & Replay sessions.
     */
    @Post('market-feed-demo')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.PRO)
    async saveMarketFeedDemo(
        @Body() body: { login: string; pass?: string; server: string },
        @Req() req,
    ) {
        return this.mt5WorkerService.saveSharedDemoFeedAccount(req.user.id, body);
    }

    /**
     * Uses the saved Shared MT5 Demo Account to log into MT5 and pull 500-candle historical
     * batches for a newly created or opened Backtest Session.
     */
    @Post('market-feed-demo/prefetch-session')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async prefetchSessionWithDemo(
        @Body()
        body: {
            sessionId?: string;
            symbols: string[];
            timeframe: string;
            fromDate?: string;
            toDate?: string;
            demoLogin?: string;
            demoPass?: string;
            demoServer?: string;
        },
        @Req() req,
    ) {
        return this.mt5WorkerService.prefetchSessionWithDemoAccount(req.user.id, body);
    }

    /**
     * Triggers an automated MT5 Economic Calendar synchronization via the connected MT5 Demo/Worker instance.
     */
    @Post('calendar/sync')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.PRO)
    async triggerCalendarSync(@Req() req) {
        return this.mt5WorkerService.triggerMt5CalendarSync(req.user.id);
    }
}
