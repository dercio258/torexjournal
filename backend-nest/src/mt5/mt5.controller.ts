import { Controller, Post, Get, Delete, Body, HttpCode, Param, Query, UseGuards, Req, Headers, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { randomUUID } from 'crypto';
import { AppTokenGuard } from '../auth/app-token.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Mt5Service } from './mt5.service';
import { Mt5DataDto } from './dto/mt5-data.dto';
import { Mt5InstanceService } from './mt5-instance.service';
import { PlanGuard, RequirePlan } from '../payment/plan.guard';
import { PlanTier } from '../payment/plan-permission.service';

import { Mt5TcpServer } from '../mt5-tcp.server';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountEntity, AccountType } from '../account/account.entity';
import { Mt5WorkerService, WorkerTaskType } from './worker/mt5-worker.service';

@Controller('mt5')
export class Mt5Controller {
    private readonly logger = new Logger(Mt5Controller.name);

    constructor(
        private readonly mt5Service: Mt5Service,
        @InjectQueue('mt5-data') private mt5Queue: Queue,
        private readonly mt5TcpServer: Mt5TcpServer,
        private readonly mt5InstanceService: Mt5InstanceService,
        private readonly mt5WorkerService: Mt5WorkerService,
        @InjectRepository(AccountEntity)
        private readonly accountRepo: Repository<AccountEntity>,
    ) { }

    private isValidUuid(id?: string): boolean {
        return !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim());
    }

    @Get('import-history')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async getImportHistory(@Req() req, @Query('accountId') accountId?: string) {
        return this.mt5Service.getImportHistory(req.user.id, accountId);
    }

    @Delete('import-history/:id/revert')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async revertImport(@Param('id') id: string, @Req() req) {
        return this.mt5Service.revertImport(Number(id), req.user.id);
    }

    @Post('data')
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
    @UseGuards(JwtAuthGuard)
    async sendCommand(@Param('id') id: string, @Body() body: { type: number, payload?: string }) {
        const success = this.mt5TcpServer.sendCommand(id, body.type, body.payload);
        if (!success) {
            return { success: false, message: 'MT5 not connected or send failed' };
        }
        return { success: true, message: `Command ${body.type} sent to ${id}` };
    }

    @Post('journal/:ticket')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.PREMIUM)
    async updateJournal(@Body() data: any, @Param('ticket') ticket: string, @Req() req) {
        return this.mt5Service.updateJournal(ticket, data, req.user.id);
    }

    @Post('manual')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async createManualTrade(@Body() data: any, @Req() req) {
        return this.mt5Service.createManualTrade(data, req.user.id);
    }

    @Post('ping')
    @HttpCode(200)
    async ping(@Headers('x-app-token') token: string) {
        if (token) {
            await this.mt5Service.updateHeartbeat(token);
        }
        return 'pong';
    }

    @Get('worker/status')
    @UseGuards(JwtAuthGuard)
    async getWorkerStatus() {
        return {
            workers: this.mt5WorkerService.getWorkerStatus(),
            pendingTasks: this.mt5WorkerService.getPendingTasks(false).length
        };
    }

    @Get('cloud/status')
    @UseGuards(JwtAuthGuard)
    async getCloudStatus(
        @Req() req,
        @Query('accountId') accountId?: string,
        @Query('login') login?: string
    ) {
        return this.mt5WorkerService.getCloudConnectionStatus(req.user.id, accountId, login);
    }

    @Get('cloud/task/:taskId')
    @UseGuards(JwtAuthGuard)
    async getCloudTaskStatus(@Param('taskId') taskId: string, @Req() req) {
        const task = this.mt5WorkerService.getTaskById(taskId);
        const cloudStatus = await this.mt5WorkerService.getCloudConnectionStatus(
            req.user.id,
            undefined,
            task?.login
        );
        return {
            task,
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
    @RequirePlan(PlanTier.PREMIUM)
    async connectCloud(@Body() body: { login: string; pass: string; server: string; accountId?: string }, @Req() req) {
        const cleanLogin = (body.login || '').toString().trim();
        const cleanServer = this.mt5WorkerService.normalizeBrokerServer((body.server || '').toString().trim());
        const validAccountId = this.isValidUuid(body.accountId) ? body.accountId!.trim() : undefined;

        // 1. Ensure user has an active trading account record in database linked to this MT5 login
        let account = await this.accountRepo.findOne({ where: { mt5Id: cleanLogin, userId: req.user.id } });

        // Se o usuário selecionou uma conta específica que ainda não tem mt5Id vinculado, vincula a ela
        if (!account && validAccountId) {
            const selectedAcc = await this.accountRepo.findOne({ where: { id: validAccountId, userId: req.user.id } });
            if (selectedAcc && (!selectedAcc.mt5Id || selectedAcc.mt5Id === cleanLogin)) {
                selectedAcc.mt5Id = cleanLogin;
                selectedAcc.broker = cleanServer || selectedAcc.broker;
                selectedAcc.isArchived = false;
                selectedAcc.archivedAt = null;
                if (!selectedAcc.name || selectedAcc.name === 'Conta Principal') {
                    selectedAcc.name = `MT5 ${cleanLogin}`;
                }
                account = await this.accountRepo.save(selectedAcc);
            }
        }

        // Se ainda não encontrou, verifica se existe uma conta padrão ("Conta Principal") do usuário sem mt5Id vinculado
        if (!account) {
            const unboundAcc = await this.accountRepo.findOne({
                where: { userId: req.user.id, isArchived: false },
                order: { isPrimary: 'DESC', createdAt: 'ASC' }
            });
            if (unboundAcc && !unboundAcc.mt5Id) {
                unboundAcc.mt5Id = cleanLogin;
                unboundAcc.broker = cleanServer || unboundAcc.broker;
                if (!unboundAcc.name || unboundAcc.name === 'Conta Principal') {
                    unboundAcc.name = `MT5 ${cleanLogin}`;
                }
                account = await this.accountRepo.save(unboundAcc);
            }
        }

        // Se não encontrou nas contas do usuário, verifica se esse mt5Id já existe na tabela
        if (!account) {
            account = await this.accountRepo.findOne({ where: { mt5Id: cleanLogin } });
        }

        const isDemoServer = cleanServer.toLowerCase().includes('demo') || cleanServer.toLowerCase().includes('trial');
        const activeUserAccountsCount = await this.accountRepo.count({ where: { userId: req.user.id, isArchived: false } });

        if (!account) {
            account = this.accountRepo.create({
                userId: req.user.id,
                mt5Id: cleanLogin,
                broker: cleanServer || 'MetaTrader 5',
                name: `MT5 ${cleanLogin}`,
                type: isDemoServer ? AccountType.DEMO : AccountType.LIVE,
                currency: 'USD',
                isPrimary: activeUserAccountsCount === 0,
                isArchived: false,
                archivedAt: null,
                isConnected: false,
                initialBalance: 0,
                balance: 0,
                equity: 0,
                appToken: randomUUID().replace(/-/g, '').toUpperCase()
            });
            account = await this.accountRepo.save(account);
            this.logger.log(`Nova Conta de Trading criada automaticamente para conexão MT5: ${account.name} (ID: ${account.id}, User: ${req.user.id})`);
        } else {
            // Garante que a conta pertença ao usuário autenticado e esteja ativa (não arquivada)
            account.userId = req.user.id;
            account.isArchived = false;
            account.archivedAt = null;
            if (cleanServer) account.broker = cleanServer;
            if (!account.appToken) {
                account.appToken = randomUUID().replace(/-/g, '').toUpperCase();
            }
            account = await this.accountRepo.save(account);
        }

        // 2. Dispatch task for the Python Worker on Windows Server
        const numId = parseInt(cleanLogin.replace(/\D/g, ''), 10) || 1;
        const task = this.mt5WorkerService.createAccountTask(
            WorkerTaskType.START_ACCOUNT,
            cleanLogin,
            cleanServer,
            body.pass,
            numId,
            { userId: req.user.id, accountUuid: account.id }
        );

        this.logger.log(
            `[AUDIT] Usuário ${req.user.id} solicitou conexão MT5 Cloud para ${cleanLogin}@${task.server} (AccountID: ${account.id}, TaskID: ${task.id})`
        );

        // 3. Optional local instance startup if configured
        let localInstance = null;
        try {
            localInstance = await this.mt5InstanceService.startInstance(req.user.id, cleanLogin, body.pass, task.server);
        } catch (e) {
            this.logger.log(`Mt5InstanceService local não ativo (${e.message}). Tarefa enviada ao MT5 Worker.`);
        }

        return {
            success: true,
            message: 'Solicitação de conexão enviada com sucesso! O worker está iniciando a sincronização.',
            taskId: task.id,
            task,
            accountId: account.id,
            account,
            server: task.server,
            instance: localInstance
        };
    }

    @Post('cloud/sync')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.PREMIUM)
    async syncCloud(@Body() body: { login?: string; accountId?: string; forceFull?: boolean }, @Req() req) {
        let account: AccountEntity | null = null;
        const validAccountId = this.isValidUuid(body.accountId) ? body.accountId!.trim() : undefined;
        if (validAccountId) {
            account = await this.accountRepo.findOne({ where: { id: validAccountId, userId: req.user.id } });
        }
        if (!account && body.login) {
            account = await this.accountRepo.findOne({ where: { mt5Id: body.login.trim(), userId: req.user.id } });
        }
        if (!account) {
            account = await this.accountRepo.findOne({
                where: { userId: req.user.id, isArchived: false },
                order: { updatedAt: 'DESC' }
            });
        }
        const cleanLogin = (body.login || account?.mt5Id || '').toString().trim();
        if (!cleanLogin) {
            return { success: false, message: 'Nenhuma conta MT5 vinculada para sincronizar.' };
        }
        const numId = parseInt(cleanLogin.replace(/\D/g, ''), 10) || 1;
        const taskType = body.forceFull ? WorkerTaskType.FORCE_FULL_SYNC : WorkerTaskType.SYNC_ACCOUNT;
        const task = this.mt5WorkerService.createAccountTask(
            taskType,
            cleanLogin,
            account?.broker || '',
            undefined,
            numId,
            { userId: req.user.id, accountUuid: account?.id }
        );
        return {
            success: true,
            message: 'Sincronização solicitada ao servidor Windows MT5!',
            taskId: task.id,
            task,
            accountId: account?.id
        };
    }

    @Post('cloud/disconnect')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.PREMIUM)
    async disconnectCloud(@Body() body: { login: string; accountId?: string }, @Req() req) {
        const cleanLogin = (body.login || '').toString().trim();
        const numId = parseInt(cleanLogin.replace(/\D/g, ''), 10) || 1;
        const task = this.mt5WorkerService.createAccountTask(
            WorkerTaskType.STOP_ACCOUNT,
            cleanLogin,
            '',
            undefined,
            numId
        );

        if (cleanLogin) {
            const acc = await this.accountRepo.findOne({ where: { mt5Id: cleanLogin, userId: req.user.id } });
            if (acc) {
                acc.isConnected = false;
                await this.accountRepo.save(acc);
            }
        }

        try {
            await this.mt5InstanceService.stopInstance(req.user.id, cleanLogin);
        } catch (e) {
            // ignore local error
        }

        return { success: true, message: 'Terminal desconectado', taskId: task.id };
    }
}
