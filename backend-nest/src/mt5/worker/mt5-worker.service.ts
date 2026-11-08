import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { randomUUID } from 'crypto';
import { AccountEntity, AccountType } from '../../account/account.entity';
import { PositionEntity } from '../position.entity';
import { TradeEntity } from '../trade.entity';
import { Mt5Service } from '../mt5.service';
import { Mt5Gateway } from '../mt5.gateway';
import { ImportLog, ImportMethod, ImportStatus } from '../import-log.entity';

export enum WorkerTaskType {
    START_ACCOUNT = 'START_ACCOUNT',
    STOP_ACCOUNT = 'STOP_ACCOUNT',
    SYNC_ACCOUNT = 'SYNC_ACCOUNT',
    FORCE_FULL_SYNC = 'FORCE_FULL_SYNC',
    RESTART_TERMINAL = 'RESTART_TERMINAL'
}

export enum WorkerTaskStatus {
    RECEIVED = 'RECEIVED',
    IN_PROGRESS = 'IN_PROGRESS',
    SUCCESS = 'SUCCESS',
    FAILED = 'FAILED'
}

export interface WorkerTask {
    id: string;
    type: WorkerTaskType;
    priority: number;
    accountId: number;
    login: string;
    server: string;
    credentialToken?: string;
    from?: string | null;
    options?: Record<string, any>;
    status: WorkerTaskStatus;
    message?: string;
    details?: Record<string, any>;
    createdAt: Date;
    dispatchedAt?: Date;
    completedAt?: Date;
    errorMessage?: string;
}

export interface TemporaryCredential {
    login: string;
    server: string;
    password: string;
    expiresAt: number;
}

export interface WorkerNodeState {
    workerId: string;
    capacity: number;
    systemInfo: Record<string, any>;
    lastHeartbeat?: Date;
    cpuPercent?: number;
    memoryPercent?: number;
    memoryUsedMb?: number;
    memoryTotalMb?: number;
    memoryAvailableMb?: number;
    activeTerminals?: number;
    monitoredAccounts?: number[];
    isOnline: boolean;
}

export interface AccountLiveTelemetry {
    login: string;
    server: string;
    company?: string;
    accountHolderName?: string;
    tradeMode?: string;
    tradeAllowed?: boolean;
    tradeExpert?: boolean;
    credit?: number;
    pingMs?: number;
    terminalBuild?: number;
    connected: boolean;
    connectionState: 'CONNECTING' | 'CONNECTED' | 'SYNCING' | 'DISCONNECTED' | 'AUTH_FAILED';
    statusMessage?: string;
    lastError?: string | null;
    lastSyncAt?: string;
    openPositionsCount?: number;
    pendingOrdersCount?: number;
    lastDealTicket?: number;
    lastSyncedTradesCount?: number;
    orders?: any[];
}

export interface WorkerEventRecord {
    id: string;
    workerId: string;
    accountId?: number;
    login?: string;
    server?: string;
    eventType: string;
    severity: string;
    message: string;
    metadata?: Record<string, any>;
    timestamp: string;
}

@Injectable()
export class Mt5WorkerService implements OnModuleInit {
    private readonly logger = new Logger(Mt5WorkerService.name);
    private readonly auditLogger = new Logger('MT5AuditTrail');

    // In-memory queues & telemetry state (hydrated from PostgreSQL on startup)
    private pendingTasks: Map<string, WorkerTask> = new Map();
    private credentialsStore: Map<string, TemporaryCredential> = new Map();
    private workers: Map<string, WorkerNodeState> = new Map();
    private accountTelemetry: Map<string, AccountLiveTelemetry> = new Map();
    private loginToUserMap: Map<string, { userId: string; accountUuid?: string; server?: string }> = new Map();
    private recentEvents: WorkerEventRecord[] = [];

    constructor(
        @InjectRepository(AccountEntity)
        private readonly accountRepo: Repository<AccountEntity>,
        @InjectRepository(PositionEntity)
        private readonly positionRepo: Repository<PositionEntity>,
        @InjectRepository(TradeEntity)
        private readonly tradeRepo: Repository<TradeEntity>,
        @InjectRepository(ImportLog)
        private readonly importLogRepo: Repository<ImportLog>,
        private readonly mt5Service: Mt5Service,
        private readonly mt5Gateway: Mt5Gateway,
    ) { }

    async onModuleInit() {
        try {
            const mt5Accounts = await this.accountRepo.find({
                where: { isArchived: false }
            });
            let hydratedCount = 0;
            for (const acc of mt5Accounts) {
                const cleanLogin = (acc.mt5Id || '').toString().trim();
                if (!cleanLogin || !acc.userId) continue;
                this.loginToUserMap.set(cleanLogin, {
                    userId: acc.userId,
                    accountUuid: acc.id,
                    server: acc.broker || '',
                });
                if (!this.accountTelemetry.has(cleanLogin)) {
                    this.accountTelemetry.set(cleanLogin, {
                        login: cleanLogin,
                        server: acc.broker || '',
                        connected: Boolean(acc.isConnected),
                        connectionState: acc.isConnected ? 'CONNECTED' : 'DISCONNECTED',
                        lastSyncAt: acc.lastSeen ? new Date(acc.lastSeen).toISOString() : undefined,
                    });
                }
                hydratedCount++;
            }
            this.logger.log(`Hydrated ${hydratedCount} MT5 account mappings from PostgreSQL on startup.`);
        } catch (err) {
            this.logger.warn(`Failed to hydrate MT5 account mappings on startup: ${err.message}`);
        }
    }

    public deriveNumericAccountId(login: string, fallback?: number): number {
        if (fallback && fallback > 0) return fallback;
        const digitsOnly = (login || '').replace(/\D/g, '');
        const parsed = parseInt(digitsOnly, 10);
        if (!isNaN(parsed) && parsed > 0) return parsed;
        let hash = 5381;
        for (let i = 0; i < (login || '').length; i++) {
            hash = ((hash << 5) + hash) + login.charCodeAt(i);
            hash = hash & 0x7fffffff;
        }
        return hash > 0 ? hash : 1;
    }

    public normalizeBrokerServer(server: string): string {
        const s = (server || '').trim();
        const lower = s.toLowerCase();
        const typoMap: Record<string, string> = {
            'deric-demo': 'Deriv-Demo',
            'deriv-demo': 'Deriv-Demo',
            'deric-server': 'Deriv-Server',
            'deriv-server': 'Deriv-Server',
            'deric-server-02': 'Deriv-Server-02',
            'deriv-server-02': 'Deriv-Server-02',
            'deriv-server-03': 'Deriv-Server-03',
            'goatfunded-server': 'GoatFunded-Server',
            'goatfunded-server2': 'GoatFunded-Server2',
            'goatfunded-server 2': 'GoatFunded-Server2',
            'goatfunded-server-2': 'GoatFunded-Server2',
            'goatfunded-server3': 'GoatFunded-Server3',
            'goatfunded-demo': 'GoatFunded-Demo',
            'goatfundedtrader-server': 'GoatFundedTrader-Server',
            'goatfundedtrader-server2': 'GoatFundedTrader-Server2',
            'ftmo-demo': 'FTMO-Demo',
            'ftmo-demo2': 'FTMO-Demo2',
            'ftmo-server': 'FTMO-Server',
            'ftmo-server2': 'FTMO-Server2',
            'ftmo-server3': 'FTMO-Server3',
            'ftmo-server4': 'FTMO-Server4',
            'fundednext-trial': 'FundedNext-Trial',
            'fundednext-server': 'FundedNext-Server',
            'fundingpips-demo': 'FundingPips-Demo',
            'fundingpips-server': 'FundingPips-Server',
            'fundingpips-server2': 'FundingPips-Server2',
            'fundingpips-server3': 'FundingPips-Server3',
            'fivepercentonline-real': 'FivePercentOnline-Real',
            'fivepercentonline-demo': 'FivePercentOnline-Demo',
            'alphacapitalgroup-server': 'AlphaCapitalGroup-Server',
            'alphacapitalgroup-server2': 'AlphaCapitalGroup-Server2',
            'alphacapitalgroup-demo': 'AlphaCapitalGroup-Demo',
            'maven-server': 'Maven-Server',
            'maven-server2': 'Maven-Server2',
            'maven-demo': 'Maven-Demo',
            'e8markets-server': 'E8Markets-Server',
            'e8markets-demo': 'E8Markets-Demo',
            'blueguardian-server': 'BlueGuardian-Server',
            'blueguardian-server2': 'BlueGuardian-Server2',
            'blueguardian-demo': 'BlueGuardian-Demo',
            'fxify-server': 'FXIFY-Server',
            'fxify-demo': 'FXIFY-Demo',
        };
        return typoMap[lower] || s;
    }

    // ==========================================
    // 1. WORKER REGISTRATION & TELEMETRY
    // ==========================================
    registerWorker(workerId: string, capacity: number, systemInfo: Record<string, any>) {
        this.logger.log(`Worker conectado e registrado: [${workerId}] (Capacidade: ${capacity} contas)`);
        this.workers.set(workerId, {
            workerId,
            capacity,
            systemInfo: systemInfo || {},
            lastHeartbeat: new Date(),
            isOnline: true
        });
        return { success: true, workerId, registeredAt: new Date().toISOString() };
    }

    recordHeartbeat(heartbeat: {
        workerId: string;
        cpuPercent: number;
        memoryPercent: number;
        memoryUsedMb?: number;
        memoryTotalMb?: number;
        memoryAvailableMb?: number;
        activeTerminals: number;
        monitoredAccounts: number[];
        timestamp?: string;
    }) {
        const existing = this.workers.get(heartbeat.workerId);
        this.workers.set(heartbeat.workerId, {
            workerId: heartbeat.workerId,
            capacity: existing?.capacity || 10,
            systemInfo: existing?.systemInfo || {},
            lastHeartbeat: new Date(),
            cpuPercent: heartbeat.cpuPercent,
            memoryPercent: heartbeat.memoryPercent,
            memoryUsedMb: heartbeat.memoryUsedMb,
            memoryTotalMb: heartbeat.memoryTotalMb,
            memoryAvailableMb: heartbeat.memoryAvailableMb,
            activeTerminals: heartbeat.activeTerminals,
            monitoredAccounts: heartbeat.monitoredAccounts || [],
            isOnline: true
        });
        return { success: true };
    }

    getWorkerStatus(workerId?: string) {
        const now = Date.now();
        const checkWorker = (w: WorkerNodeState) => {
            const lastHb = w.lastHeartbeat ? new Date(w.lastHeartbeat).getTime() : 0;
            const isOnline = lastHb > 0 && (now - lastHb < 45000);
            return {
                ...w,
                isOnline
            };
        };

        if (workerId) {
            const w = this.workers.get(workerId);
            return w ? checkWorker(w) : null;
        }
        return Array.from(this.workers.values()).map(checkWorker);
    }

    // ==========================================
    // 2. TASK QUEUE & CREDENTIALS
    // ==========================================
    private getDefaultPriority(type: WorkerTaskType): number {
        switch (type) {
            case WorkerTaskType.START_ACCOUNT:
            case WorkerTaskType.STOP_ACCOUNT:
                return 1;
            case WorkerTaskType.RESTART_TERMINAL:
                return 2;
            case WorkerTaskType.FORCE_FULL_SYNC:
                return 3;
            case WorkerTaskType.SYNC_ACCOUNT:
            default:
                return 5;
        }
    }

    createAccountTask(
        type: WorkerTaskType,
        login: string,
        server: string,
        password?: string,
        accountIdNum?: number,
        options: Record<string, any> = {}
    ): WorkerTask {
        const cleanLogin = (login || '').toString().trim();
        const cleanServer = this.normalizeBrokerServer(server);

        // Supersede older queued (unclaimed) tasks for the same login & type
        for (const [existingId, existingTask] of this.pendingTasks.entries()) {
            if (
                existingTask.login === cleanLogin &&
                existingTask.status === WorkerTaskStatus.RECEIVED &&
                (existingTask.type === type || type === WorkerTaskType.STOP_ACCOUNT)
            ) {
                this.pendingTasks.delete(existingId);
            }
        }

        const taskId = randomUUID();
        const numericAccId = this.deriveNumericAccountId(cleanLogin, accountIdNum);

        let credentialToken: string | undefined = undefined;
        if (password) {
            credentialToken = `token_${randomUUID().replace(/-/g, '')}`;
            this.credentialsStore.set(credentialToken, {
                login: cleanLogin,
                server: cleanServer,
                password,
                expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes TTL
            });
        }

        const initialMsg = type === WorkerTaskType.START_ACCOUNT
            ? `Solicitação de conexão enviada com sucesso! O worker está iniciando a sincronização.`
            : `Tarefa ${type} enfileirada para ${cleanLogin}...`;

        const task: WorkerTask = {
            id: taskId,
            type,
            priority: options?.priority ?? this.getDefaultPriority(type),
            accountId: numericAccId,
            login: cleanLogin,
            server: cleanServer,
            credentialToken,
            from: options?.from || null,
            options,
            status: WorkerTaskStatus.RECEIVED,
            message: initialMsg,
            details: {},
            createdAt: new Date()
        };

        this.pendingTasks.set(taskId, task);

        if (cleanLogin && options?.userId) {
            this.loginToUserMap.set(cleanLogin, {
                userId: options.userId,
                accountUuid: options.accountUuid,
                server: cleanServer,
            });
        }

        if (type === WorkerTaskType.START_ACCOUNT && cleanLogin) {
            const existingTel = this.accountTelemetry.get(cleanLogin);
            this.accountTelemetry.set(cleanLogin, {
                ...(existingTel || { login: cleanLogin, server: cleanServer, connected: false }),
                server: cleanServer || existingTel?.server || '',
                connectionState: 'CONNECTING',
                statusMessage: initialMsg,
                lastError: null,
            });
        }

        // Record audit event for connection/sync request
        this.recentEvents.unshift({
            id: randomUUID(),
            workerId: 'BACKEND-API',
            accountId: numericAccId,
            login: cleanLogin,
            server: cleanServer,
            eventType: type === WorkerTaskType.START_ACCOUNT ? 'CONNECTION_REQUESTED' : `TASK_${type}_REQUESTED`,
            severity: 'INFO',
            message: initialMsg,
            metadata: { taskId, type, priority: task.priority },
            timestamp: new Date().toISOString(),
        });
        if (this.recentEvents.length > 100) this.recentEvents.length = 100;

        this.auditLogger.log(
            `[AUDIT] Solicitação ${type} criada para conta MT5 ${cleanLogin}@${cleanServer} (TaskID: ${taskId}, Prioridade: P${task.priority})`
        );
        return task;
    }

    getPendingTasks(claim: boolean = true): WorkerTask[] {
        const now = Date.now();
        const tasks: WorkerTask[] = [];
        for (const task of this.pendingTasks.values()) {
            const refTime = task.dispatchedAt
                ? new Date(task.dispatchedAt).getTime()
                : (task.createdAt ? new Date(task.createdAt).getTime() : now);
            const ageMs = now - refTime;

            if (
                task.status === WorkerTaskStatus.RECEIVED ||
                (task.status === WorkerTaskStatus.IN_PROGRESS && ageMs > 90000)
            ) {
                if (claim) {
                    task.status = WorkerTaskStatus.IN_PROGRESS;
                    task.dispatchedAt = new Date();
                    if (!task.message || task.message.startsWith('Aguardando') || task.message.startsWith('Solicitação de conexão enviada')) {
                        task.message = `Worker Windows recebeu a tarefa e está iniciando a sincronização para ${task.login}...`;
                    }
                    this.auditLogger.log(
                        `[AUDIT] Worker Windows reivindicou tarefa [${task.id}] (${task.type}) para conta ${task.login}@${task.server}`
                    );
                }
                tasks.push(task);
            }
        }

        tasks.sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        });

        return tasks;
    }

    getTaskById(taskId: string): WorkerTask | null {
        return this.pendingTasks.get(taskId) || null;
    }

    getLatestTaskForLogin(login: string): WorkerTask | null {
        const cleanLogin = (login || '').toString().trim();
        if (!cleanLogin) return null;
        const matching = Array.from(this.pendingTasks.values()).filter(t => t.login === cleanLogin);
        if (matching.length === 0) return null;
        matching.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return matching[0];
    }

    ackTask(taskId: string, status: WorkerTaskStatus, message?: string, details?: Record<string, any>) {
        const task = this.pendingTasks.get(taskId);
        if (!task) {
            return { success: false, message: 'Task not found' };
        }
        task.status = status;
        if (message) task.message = message;
        if (details && Object.keys(details).length > 0) {
            task.details = { ...(task.details || {}), ...details };
        }
        if (status === WorkerTaskStatus.SUCCESS || status === WorkerTaskStatus.FAILED) {
            task.completedAt = new Date();
        }
        if (status === WorkerTaskStatus.FAILED && message) {
            task.errorMessage = message;
        }
        this.auditLogger.log(
            `[AUDIT] Tarefa [${taskId}] (${task.type} - ${task.login}@${task.server}) -> Status: ${status} | Msg: ${message || 'N/A'} | Details: ${JSON.stringify(task.details || {})}`
        );

        // Update live telemetry state for this account
        if (task.login) {
            const existingTel = this.accountTelemetry.get(task.login) || {
                login: task.login,
                server: task.server,
                connected: false,
                connectionState: 'CONNECTING' as const,
            };

            if (status === WorkerTaskStatus.IN_PROGRESS) {
                existingTel.connectionState = task.type === WorkerTaskType.START_ACCOUNT ? 'CONNECTING' : 'SYNCING';
                existingTel.statusMessage = message || existingTel.statusMessage;
            } else if (status === WorkerTaskStatus.SUCCESS) {
                if (task.type === WorkerTaskType.STOP_ACCOUNT) {
                    existingTel.connected = false;
                    existingTel.connectionState = 'DISCONNECTED';
                    existingTel.statusMessage = message || 'Conta desconectada.';
                } else {
                    existingTel.connected = true;
                    existingTel.connectionState = 'CONNECTED';
                    existingTel.statusMessage = message || 'Conectado e sincronizado.';
                    existingTel.lastError = null;
                    existingTel.lastSyncAt = new Date().toISOString();
                    if (task.details?.syncedTradesCount !== undefined) {
                        existingTel.lastSyncedTradesCount = Number(task.details.syncedTradesCount) || 0;
                    }
                }
            } else if (status === WorkerTaskStatus.FAILED) {
                if (task.type === WorkerTaskType.START_ACCOUNT) {
                    existingTel.connected = false;
                    existingTel.connectionState = 'AUTH_FAILED';
                }
                existingTel.lastError = message || 'Falha na execução da tarefa no MT5.';
                existingTel.statusMessage = message;
            }
            this.accountTelemetry.set(task.login, existingTel);
        }

        // Persist database audit log (ImportLog) and update AccountEntity on completion
        if (status === WorkerTaskStatus.SUCCESS || status === WorkerTaskStatus.FAILED) {
            this.persistTaskAuditLog(task, status, message).catch((err) => {
                this.logger.warn(`Erro ao gravar log de auditoria para tarefa ${taskId}: ${err.message}`);
            });

            // Keep task in memory for 15 minutes so frontend polling can read final result
            setTimeout(() => {
                this.pendingTasks.delete(taskId);
            }, 900000);
        }
        return { success: true };
    }

    private async persistTaskAuditLog(task: WorkerTask, status: WorkerTaskStatus, message?: string) {
        const acc = await this.findAccountByLoginOrId(task.login, task.accountId);
        if (!acc) return;

        if (
            (task.type === WorkerTaskType.STOP_ACCOUNT && status === WorkerTaskStatus.SUCCESS) ||
            (task.type === WorkerTaskType.START_ACCOUNT && status === WorkerTaskStatus.FAILED)
        ) {
            if (acc.isConnected) {
                acc.isConnected = false;
                await this.accountRepo.save(acc);
                try {
                    this.mt5Gateway.broadcastConnectionStatus({ isConnected: false }, acc.userId);
                } catch { }
            }
        }

        // Create persistent ImportLog audit record for connection/sync attempts
        const isSyncTask =
            task.type === WorkerTaskType.START_ACCOUNT ||
            task.type === WorkerTaskType.SYNC_ACCOUNT ||
            task.type === WorkerTaskType.FORCE_FULL_SYNC;

        if (!isSyncTask) return;

        if (status === WorkerTaskStatus.SUCCESS) {
            let accChanged = false;
            if (!acc.isConnected) { acc.isConnected = true; accChanged = true; }
            if (acc.isArchived) { acc.isArchived = false; acc.archivedAt = null; accChanged = true; }
            if (!acc.name || acc.name === 'Conta Principal') { acc.name = `MT5 ${task.login}`; accChanged = true; }
            acc.lastSeen = new Date();
            if (accChanged) {
                await this.accountRepo.save(acc);
            }
        }

        const syncedTradesCount = Number(task.details?.syncedTradesCount || 0);

        if (status === WorkerTaskStatus.FAILED) {
            const failLog = this.importLogRepo.create({
                userId: acc.userId,
                accountId: acc.id,
                method: ImportMethod.AUTO_SYNC,
                status: ImportStatus.FAILED,
                tradesCount: 0,
                details: message || task.errorMessage || `Falha na conexão/autenticação com o servidor MT5 (${task.login}@${task.server || acc.broker})`,
            });
            await this.importLogRepo.save(failLog);
            this.auditLogger.warn(
                `[AUDIT-DB] Log de falha persistido (ImportLog #${failLog.id}) para conta ${task.login}: ${failLog.details}`
            );
        } else if (status === WorkerTaskStatus.SUCCESS && syncedTradesCount === 0) {
            // When syncedTradesCount > 0, Mt5Service.saveHistory already persisted an ImportLog record.
            // When syncedTradesCount === 0, we still record a SUCCESS connection/sync audit entry so the user has full auditability.
            const totalExistingTrades = await this.tradeRepo.count({ where: { accountId: acc.id } });
            const okLog = this.importLogRepo.create({
                userId: acc.userId,
                accountId: acc.id,
                method: ImportMethod.AUTO_SYNC,
                status: ImportStatus.SUCCESS,
                tradesCount: 0,
                details: message || `Conexão MT5 Cloud (${task.login}@${task.details?.server || task.server || acc.broker}) autenticada e sincronizada (${totalExistingTrades} trades no histórico)`,
            });
            await this.importLogRepo.save(okLog);
            this.auditLogger.log(
                `[AUDIT-DB] Log de sincronização sem novos negócios persistido (ImportLog #${okLog.id}) para conta ${task.login}`
            );
        }
    }

    exchangeCredential(taskId: string, accountId: number, credentialToken: string) {
        const now = Date.now();
        for (const [k, v] of this.credentialsStore.entries()) {
            if (now > v.expiresAt) {
                this.credentialsStore.delete(k);
            }
        }

        const cred = this.credentialsStore.get(credentialToken);
        if (!cred) {
            this.logger.warn(`Tentativa de resgate com token expirado ou inválido: ${credentialToken}`);
            throw new NotFoundException('Credential token invalid or expired');
        }

        const result = {
            login: cred.login,
            server: cred.server,
            password: cred.password,
            expiresInSeconds: 60
        };

        setTimeout(() => {
            this.credentialsStore.delete(credentialToken);
        }, 30000);

        return result;
    }

    // ==========================================
    // 3. SYNCHRONIZATION DATA PROCESSING
    // ==========================================
    async syncAccountMetrics(accountInfo: {
        accountId: number;
        login: string;
        server: string;
        currency: string;
        balance: number;
        equity: number;
        margin: number;
        freeMargin: number;
        marginLevel?: number;
        leverage: number;
        profit?: number;
        credit?: number;
        company?: string;
        name?: string;
        tradeMode?: string;
        tradeAllowed?: boolean;
        tradeExpert?: boolean;
        pingMs?: number;
        terminalBuild?: number;
        connected?: boolean;
    }) {
        const cleanLogin = (accountInfo.login || accountInfo.accountId || '').toString().trim();
        const account = await this.findAccountByLoginOrId(cleanLogin, accountInfo.accountId, accountInfo.server);
        if (!account) {
            this.logger.warn(`Conta MT5 ${cleanLogin} não encontrada no banco de dados para sync de métricas.`);
            return { success: false, message: 'Account not found' };
        }

        const balanceNum = Number(accountInfo.balance) || 0;
        const equityNum = Number(accountInfo.equity) || 0;

        account.balance = balanceNum;
        account.equity = equityNum;
        account.margin = Number(accountInfo.margin) || 0;
        account.marginFree = Number(accountInfo.freeMargin) || 0;
        account.marginLevel = Number(accountInfo.marginLevel) || 0;
        account.leverage = Number(accountInfo.leverage) || 1;
        if (accountInfo.currency) account.currency = accountInfo.currency;
        if (Number(account.initialBalance) === 0 && balanceNum > 0) {
            const closedPnlRes = await this.tradeRepo
                .createQueryBuilder('t')
                .select('COALESCE(SUM(COALESCE(t.profit, 0) + COALESCE(t.commission, 0) + COALESCE(t.swap, 0)), 0)', 'closedPnl')
                .where('t.accountId = :accountId', { accountId: account.id })
                .andWhere('t.status = :status', { status: 'CLOSED' })
                .getRawOne();
            const closedPnl = Number(closedPnlRes?.closedPnl) || 0;
            const derivedInitial = Number((balanceNum - closedPnl).toFixed(2));
            account.initialBalance = derivedInitial > 0 ? derivedInitial : balanceNum;
        }
        if (accountInfo.server || accountInfo.company) {
            account.broker = accountInfo.server || accountInfo.company || account.broker;
        }
        if (accountInfo.tradeMode) {
            account.type = accountInfo.tradeMode.toUpperCase() === 'DEMO' ? AccountType.DEMO : AccountType.LIVE;
        }
        if (!account.name || account.name === 'Conta Principal') {
            account.name = `MT5 ${cleanLogin}`;
        }
        account.isArchived = false;
        account.archivedAt = null;
        account.isConnected = accountInfo.connected !== false;
        account.lastSeen = new Date();

        await this.accountRepo.save(account);

        // Store rich live telemetry in memory
        const existingTel = this.accountTelemetry.get(cleanLogin);
        this.accountTelemetry.set(cleanLogin, {
            ...(existingTel || {}),
            login: cleanLogin,
            server: accountInfo.server || existingTel?.server || account.broker,
            company: accountInfo.company || existingTel?.company || '',
            accountHolderName: accountInfo.name || existingTel?.accountHolderName || '',
            tradeMode: accountInfo.tradeMode || existingTel?.tradeMode || 'DEMO',
            tradeAllowed: accountInfo.tradeAllowed ?? true,
            tradeExpert: accountInfo.tradeExpert ?? true,
            credit: Number(accountInfo.credit) || 0,
            pingMs: Number(accountInfo.pingMs) || 0,
            terminalBuild: accountInfo.terminalBuild || existingTel?.terminalBuild,
            connected: account.isConnected,
            connectionState: account.isConnected ? 'CONNECTED' : 'DISCONNECTED',
            statusMessage: `Sincronizado com sucesso (${accountInfo.server || account.broker})`,
            lastError: null,
            lastSyncAt: new Date().toISOString(),
        });

        // Broadcast to connected frontend clients via WebSocket (strictly scoped to account.userId)
        try {
            if (account.userId) {
                this.mt5Gateway.broadcastAccountUpdate({
                    balance: account.balance,
                    equity: account.equity,
                    margin: account.margin,
                    marginFree: account.marginFree,
                    marginLevel: account.marginLevel
                }, account.userId);
                this.mt5Gateway.broadcastConnectionStatus({ isConnected: account.isConnected }, account.userId);
            }
        } catch (err) {
            // Ignore socket broadcast errors
        }

        return {
            success: true,
            accountId: account.id,
            mt5Id: account.mt5Id,
            balance: account.balance,
            equity: account.equity,
            isConnected: account.isConnected
        };
    }

    async syncPositions(accountIdNum: number, login: string, positions: any[], server?: string) {
        const cleanLogin = (login || accountIdNum || '').toString().trim();
        const account = await this.findAccountByLoginOrId(cleanLogin, accountIdNum, server);
        if (!account) {
            return { success: false, message: 'Account not found' };
        }

        await this.positionRepo.manager.transaction(async (manager) => {
            if (!positions || positions.length === 0) {
                await manager.delete(PositionEntity, { accountId: account.id });
                return;
            }

            const existingPositions = await manager.find(PositionEntity, {
                where: { accountId: account.id }
            });
            const existingMap = new Map<string, PositionEntity>();
            existingPositions.forEach(p => existingMap.set((p.ticket || '').toString(), p));

            const incomingTickets: string[] = [];
            const positionsToSave: PositionEntity[] = [];

            for (const p of positions) {
                const ticketStr = (p.ticket || '').toString();
                if (!ticketStr) continue;
                incomingTickets.push(ticketStr);

                let entity = existingMap.get(ticketStr);
                if (entity) {
                    entity.symbol = p.symbol || entity.symbol || 'Unknown';
                    entity.type = p.type || entity.type || 'BUY';
                    entity.volume = Number(p.volume) || 0;
                    entity.openPrice = Number(p.priceOpen ?? p.openPrice) || entity.openPrice || 0;
                    entity.currentPrice = Number(p.priceCurrent ?? p.currentPrice) || 0;
                    entity.profit = Number(p.profit) || 0;
                    entity.sl = Number(p.sl) > 0 ? Number(p.sl) : 0;
                    entity.tp = Number(p.tp) > 0 ? Number(p.tp) : 0;
                    positionsToSave.push(entity);
                } else {
                    positionsToSave.push(
                        this.positionRepo.create({
                            accountId: account.id,
                            ticket: ticketStr,
                            symbol: p.symbol || 'Unknown',
                            type: p.type || 'BUY',
                            volume: Number(p.volume) || 0,
                            openPrice: Number(p.priceOpen ?? p.openPrice) || 0,
                            currentPrice: Number(p.priceCurrent ?? p.currentPrice) || 0,
                            profit: Number(p.profit) || 0,
                            sl: Number(p.sl) > 0 ? Number(p.sl) : 0,
                            tp: Number(p.tp) > 0 ? Number(p.tp) : 0,
                            openTime: p.time ? new Date(p.time) : new Date()
                        })
                    );
                }
            }

            if (positionsToSave.length > 0) {
                await manager.save(PositionEntity, positionsToSave);
            }

            if (incomingTickets.length > 0) {
                await manager
                    .createQueryBuilder()
                    .delete()
                    .from(PositionEntity)
                    .where('account_id = :accountId', { accountId: account.id })
                    .andWhere('ticket NOT IN (:...tickets)', { tickets: incomingTickets })
                    .execute();
            } else {
                await manager.delete(PositionEntity, { accountId: account.id });
            }
        });

        const existingTel = this.accountTelemetry.get(cleanLogin);
        if (existingTel) {
            existingTel.openPositionsCount = positions ? positions.length : 0;
            this.accountTelemetry.set(cleanLogin, existingTel);
        }

        return { success: true, count: positions ? positions.length : 0 };
    }

    async syncOrders(accountIdNum: number, login: string, orders: any[]) {
        const cleanLogin = (login || accountIdNum || '').toString().trim();
        const existingTel = this.accountTelemetry.get(cleanLogin);
        if (existingTel) {
            existingTel.orders = orders || [];
            existingTel.pendingOrdersCount = orders ? orders.length : 0;
            this.accountTelemetry.set(cleanLogin, existingTel);
        }
        return { success: true, count: orders ? orders.length : 0 };
    }

    async syncTrades(accountIdNum: number, login: string, deals: any[], lastDealTicket?: number, server?: string) {
        const cleanLogin = (login || accountIdNum || '').toString().trim();
        const account = await this.findAccountByLoginOrId(cleanLogin, accountIdNum, server);
        if (!account) {
            this.logger.warn(`Conta ${cleanLogin} não encontrada para inserção de trades.`);
            return { success: false, message: 'Account not found' };
        }

        const existingTel = this.accountTelemetry.get(cleanLogin);
        if (existingTel && lastDealTicket) {
            existingTel.lastDealTicket = lastDealTicket;
            this.accountTelemetry.set(cleanLogin, existingTel);
        }

        if (!deals || deals.length === 0) {
            return { success: true, count: 0 };
        }

        const tradingDeals = deals.filter((d) => {
            const dealType = (d.type || '').toUpperCase();
            return !dealType.includes('BALANCE') && !dealType.includes('CREDIT');
        });

        if (tradingDeals.length === 0) {
            return { success: true, count: 0, lastTicket: lastDealTicket };
        }

        const normalizedTrades = tradingDeals.map((deal) => {
            const ticket = (deal.ticket || '').toString();
            const positionId = (deal.positionId || deal.orderTicket || deal.ticket || '').toString();
            const dealTime = deal.time ? new Date(deal.time) : new Date();
            const parsedOpenTime = deal.openTime ? new Date(deal.openTime) : null;
            const hasValidOpenTime = Boolean(parsedOpenTime && !isNaN(parsedOpenTime.getTime()));

            const isOut = (deal.entry || '').toUpperCase().includes('OUT');
            const profit = Number(deal.profit) || 0;
            const commission = Number(deal.commission) || 0;
            const swap = Number(deal.swap) || 0;
            const closePrice = Number(deal.price) || 0;
            const hasExplicitOpenPrice = deal.openPrice !== undefined && deal.openPrice !== null && Number(deal.openPrice) > 0;
            const openPrice = hasExplicitOpenPrice ? Number(deal.openPrice) : closePrice;

            return {
                ticket: ticket,
                positionId: positionId || ticket,
                contractId: positionId || ticket,
                symbol: deal.symbol || 'Unknown',
                type: (deal.type || '').toUpperCase().includes('BUY') ? 'BUY' : 'SELL',
                volume: Number(deal.volume) || 0,
                openPrice: openPrice,
                closePrice: closePrice,
                profit: profit,
                commission: commission,
                swap: swap,
                netPnl: profit + commission + swap,
                sl: Number(deal.sl) > 0 ? Number(deal.sl) : null,
                tp: Number(deal.tp) > 0 ? Number(deal.tp) : null,
                openTime: hasValidOpenTime ? parsedOpenTime : dealTime,
                closeTime: isOut || profit !== 0 ? dealTime : null,
                status: isOut || profit !== 0 ? 'CLOSED' : 'OPEN',
                dataQuality: hasValidOpenTime && (!isOut || hasExplicitOpenPrice) ? 'ok' : 'partial',
                comment: deal.comment || '',
                magic: Number(deal.magic) || 0
            };
        });

        this.logger.log(`Salvando ${normalizedTrades.length} trades para conta ${account.mt5Id || account.name} via AUTO_SYNC`);
        let savedCount = 0;
        try {
            const result = await this.mt5Service.saveHistory(
                normalizedTrades,
                ImportMethod.AUTO_SYNC,
                account.userId,
                account.id
            );
            savedCount = result?.count || 0;
        } catch (saveErr) {
            this.logger.error(`[FALLBACK SQL] saveHistory falhou para conta ${cleanLogin}: ${saveErr.message}`, saveErr.stack);
            for (const tr of normalizedTrades) {
                try {
                    const existing = await this.accountRepo.manager.query(
                        `SELECT id FROM trades WHERE account_id::text = $1 AND (ticket = $2 OR "contractId" = $3) LIMIT 1`,
                        [account.id, tr.ticket, tr.contractId]
                    );
                    if (!existing || existing.length === 0) {
                        const rawMagic = Number(tr.magic) || 0;
                        const safeMagic = rawMagic >= -2147483648 && rawMagic <= 2147483647 ? Math.trunc(rawMagic) : 0;
                        await this.accountRepo.manager.query(
                            `INSERT INTO trades (
                                account_id, ticket, "contractId", symbol, type,
                                volume, open_price, close_price, profit, commission,
                                swap, "netPnl", sl, tp, open_time, close_time,
                                status, magic, comment
                            ) VALUES (
                                $1, $2, $3, $4, $5,
                                $6, $7, $8, $9, $10,
                                $11, $12, $13, $14, $15, $16,
                                $17, $18, $19
                            )`,
                            [
                                account.id,
                                tr.ticket,
                                tr.contractId,
                                tr.symbol || 'Unknown',
                                tr.type || 'BUY',
                                Number(tr.volume || 0),
                                Number(tr.openPrice || 0),
                                Number(tr.closePrice || 0),
                                Number(tr.profit || 0),
                                Number(tr.commission || 0),
                                Number(tr.swap || 0),
                                Number(tr.netPnl || 0),
                                tr.sl ?? null,
                                tr.tp ?? null,
                                tr.openTime,
                                tr.closeTime ?? null,
                                tr.status || 'CLOSED',
                                safeMagic,
                                tr.comment || '',
                            ]
                        );
                        savedCount++;
                    }
                } catch (innerErr) {
                    this.logger.warn(`[FALLBACK SQL] Falha ao inserir trade ${tr.ticket} na conta ${cleanLogin}: ${innerErr.message}`);
                }
            }
        }

        if (existingTel) {
            existingTel.lastSyncedTradesCount = (existingTel.lastSyncedTradesCount || 0) + savedCount;
            this.accountTelemetry.set(cleanLogin, existingTel);
        }

        return { success: true, saved: savedCount, lastTicket: lastDealTicket };
    }

    async recordWorkerEvent(event: {
        workerId: string;
        accountId?: number;
        login?: string;
        server?: string;
        eventType: string;
        severity: string;
        message: string;
        metadata?: Record<string, any>;
        timestamp?: string;
    }) {
        const cleanLogin = (event.login || event.accountId || '').toString().trim();
        const record: WorkerEventRecord = {
            id: randomUUID(),
            workerId: event.workerId,
            accountId: event.accountId,
            login: cleanLogin || undefined,
            server: event.server,
            eventType: event.eventType,
            severity: event.severity || 'INFO',
            message: event.message,
            metadata: event.metadata || {},
            timestamp: event.timestamp || new Date().toISOString(),
        };

        this.recentEvents.unshift(record);
        if (this.recentEvents.length > 100) {
            this.recentEvents.length = 100;
        }

        if (cleanLogin) {
            const existingTel = this.accountTelemetry.get(cleanLogin) || {
                login: cleanLogin,
                server: event.server || '',
                connected: false,
                connectionState: 'DISCONNECTED' as const,
            };

            if (event.eventType === 'ACCOUNT_CONNECTING') {
                existingTel.connectionState = 'CONNECTING';
                existingTel.statusMessage = event.message;
                existingTel.lastError = null;
            } else if (event.eventType === 'ACCOUNT_CONNECTED') {
                existingTel.connected = true;
                existingTel.connectionState = 'CONNECTED';
                existingTel.statusMessage = event.message;
                existingTel.lastError = null;
                existingTel.lastSyncAt = new Date().toISOString();
            } else if (event.eventType === 'ACCOUNT_LOGIN_FAILED') {
                existingTel.connected = false;
                existingTel.connectionState = 'AUTH_FAILED';
                existingTel.lastError = event.message;
                existingTel.statusMessage = event.message;
            } else if (event.eventType === 'ACCOUNT_DISCONNECTED' || event.eventType === 'ACCOUNT_STOPPED') {
                existingTel.connected = false;
                existingTel.connectionState = 'DISCONNECTED';
                existingTel.statusMessage = event.message;
                if (event.eventType === 'ACCOUNT_DISCONNECTED') {
                    existingTel.lastError = event.message;
                }
            }
            this.accountTelemetry.set(cleanLogin, existingTel);

            if (
                event.eventType === 'ACCOUNT_LOGIN_FAILED' ||
                event.eventType === 'ACCOUNT_DISCONNECTED' ||
                event.eventType === 'ACCOUNT_STOPPED'
            ) {
                const acc = await this.findAccountByLoginOrId(cleanLogin, event.accountId);
                if (acc && acc.isConnected) {
                    acc.isConnected = false;
                    await this.accountRepo.save(acc);
                    try {
                        this.mt5Gateway.broadcastConnectionStatus({ isConnected: false }, acc.userId);
                    } catch { }
                }
            }
        }

        this.auditLogger.log(`Evento Worker [${event.workerId}] (${event.eventType} - ${cleanLogin || 'GLOBAL'}): ${event.message}`);
        return { success: true };
    }

    private isValidUuid(id?: string): boolean {
        return !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim());
    }

    async getCloudConnectionStatus(userId: string, accountId?: string, login?: string) {
        const workersList = this.getWorkerStatus() as WorkerNodeState[];
        const primaryWorker = Array.isArray(workersList) && workersList.length > 0 ? workersList[0] : null;

        // 1. Carrega todas as contas não arquivadas do usuário em 1 única query e resolve em memória (M7)
        const userAccounts = await this.accountRepo.find({
            where: { userId, isArchived: false },
            order: { updatedAt: 'DESC' }
        });

        let account: AccountEntity | null = null;
        if (login && login.trim()) {
            const cleanLogin = login.trim();
            account = userAccounts.find(a => a.mt5Id === cleanLogin) || null;
        }
        if (!account && this.isValidUuid(accountId)) {
            const byId = userAccounts.find(a => a.id === accountId!.trim()) || null;
            if (byId && byId.mt5Id) {
                account = byId;
            } else if (byId) {
                account = userAccounts.find(a => !!a.mt5Id && a.isConnected)
                    || userAccounts.find(a => !!a.mt5Id)
                    || byId;
            }
        }
        if (!account) {
            account = userAccounts.find(a => !!a.mt5Id && a.isConnected)
                || userAccounts.find(a => !!a.mt5Id)
                || userAccounts[0]
                || null;
        }

        const mt5Accounts = userAccounts
            .filter(a => !!a.mt5Id)
            .map(a => {
                const tel = a.mt5Id ? this.accountTelemetry.get(a.mt5Id) : null;
                return {
                    id: a.id,
                    name: a.name,
                    mt5Id: a.mt5Id,
                    broker: tel?.server || a.broker,
                    type: a.type,
                    currency: a.currency,
                    balance: Number(a.balance) || 0,
                    equity: Number(a.equity) || 0,
                    isConnected: a.isConnected || tel?.connectionState === 'CONNECTED',
                    connectionState: tel?.connectionState || (a.isConnected ? 'CONNECTED' : 'DISCONNECTED'),
                    lastSeen: a.lastSeen,
                };
            });

        // Usa estritamente o mt5Id da própria conta encontrada para evitar misturar telemetria/eventos de logins diferentes
        const mt5Login = account?.mt5Id || (login && !account ? login.trim() : '');
        const telemetry = mt5Login ? this.accountTelemetry.get(mt5Login) || null : null;
        const rawActiveTask = mt5Login ? this.getLatestTaskForLogin(mt5Login) : null;
        const activeTask = rawActiveTask ? (() => {
            const { credentialToken, ...safeTask } = rawActiveTask;
            return safeTask;
        })() : null;

        const [positions, totalTradesCount, recentTrades, auditLogs] = account
            ? await Promise.all([
                this.positionRepo.find({ where: { accountId: account.id } }),
                this.tradeRepo.count({ where: { accountId: account.id } }),
                this.tradeRepo.find({
                    where: { accountId: account.id },
                    order: { closeTime: 'DESC', openTime: 'DESC' },
                    take: 15,
                }),
                this.importLogRepo.find({
                    where: { accountId: account.id },
                    order: { createdAt: 'DESC' },
                    take: 10,
                }),
            ])
            : [[], 0, [], []];

        const accountEvents = mt5Login
            ? this.recentEvents.filter(e => e.login === mt5Login || (e.accountId && e.accountId.toString() === mt5Login)).slice(0, 12)
            : this.recentEvents.slice(0, 6);

        return {
            worker: {
                isOnline: primaryWorker ? primaryWorker.isOnline : false,
                workerId: primaryWorker?.workerId || null,
                cpuPercent: primaryWorker?.cpuPercent ?? 0,
                memoryPercent: primaryWorker?.memoryPercent ?? 0,
                memoryUsedMb: primaryWorker?.memoryUsedMb ?? null,
                memoryTotalMb: primaryWorker?.memoryTotalMb ?? null,
                activeTerminals: primaryWorker?.activeTerminals ?? 0,
                monitoredAccounts: primaryWorker?.monitoredAccounts || [],
                lastHeartbeat: primaryWorker?.lastHeartbeat || null,
            },
            account: account ? {
                id: account.id,
                name: account.name,
                mt5Id: account.mt5Id,
                broker: account.broker,
                type: account.type,
                currency: account.currency,
                balance: Number(account.balance) || 0,
                equity: Number(account.equity) || 0,
                margin: Number(account.margin) || 0,
                marginFree: Number(account.marginFree) || 0,
                marginLevel: Number(account.marginLevel) || 0,
                leverage: account.leverage || 1,
                isConnected: account.isConnected,
                lastSeen: account.lastSeen,
                // Live telemetry from MT5 Worker
                server: telemetry?.server || account.broker,
                company: telemetry?.company || null,
                accountHolderName: telemetry?.accountHolderName || null,
                tradeMode: telemetry?.tradeMode || (account.type === AccountType.DEMO ? 'DEMO' : 'REAL'),
                tradeAllowed: telemetry?.tradeAllowed ?? true,
                pingMs: telemetry?.pingMs ?? 0,
                terminalBuild: telemetry?.terminalBuild ?? null,
                connectionState: telemetry?.connectionState || (account.isConnected ? 'CONNECTED' : 'DISCONNECTED'),
                statusMessage: telemetry?.statusMessage || null,
                lastError: telemetry?.lastError || null,
                lastSyncAt: telemetry?.lastSyncAt || (account.lastSeen ? account.lastSeen.toISOString() : null),
                openPositionsCount: positions.length,
                pendingOrdersCount: telemetry?.pendingOrdersCount ?? 0,
                lastDealTicket: telemetry?.lastDealTicket ?? 0,
                lastSyncedTradesCount: telemetry?.lastSyncedTradesCount ?? 0,
                totalTradesCount,
            } : null,
            positions,
            orders: telemetry?.orders || [],
            recentTrades,
            totalTradesCount,
            auditLogs,
            activeTask,
            recentEvents: accountEvents,
            mt5Accounts,
        };
    }

    private async findAccountByLoginOrId(login: string, accountIdNum?: number, fallbackServer?: string): Promise<AccountEntity | null> {
        const loginStr = (login || accountIdNum || '').toString().trim();
        if (!loginStr) return null;

        const mappedOwner = this.loginToUserMap.get(loginStr);

        // 1. Se houver accountUuid mapeado da tarefa, valida estritamente id + mt5Id + userId (sem nunca alterar userId!)
        if (mappedOwner?.accountUuid && this.isValidUuid(mappedOwner.accountUuid)) {
            const whereByUuid: any = { id: mappedOwner.accountUuid, mt5Id: loginStr };
            if (mappedOwner.userId) whereByUuid.userId = mappedOwner.userId;
            const byUuid = await this.accountRepo.findOne({ where: whereByUuid });
            if (byUuid) {
                let changed = false;
                if (!byUuid.name || byUuid.name === 'Conta Principal') { byUuid.name = `MT5 ${loginStr}`; changed = true; }
                if (byUuid.isArchived) { byUuid.isArchived = false; byUuid.archivedAt = null; changed = true; }
                if (changed) await this.accountRepo.save(byUuid);
                return byUuid;
            }
        }

        // 2. Busca por (mt5Id, userId) se o usuário estiver mapeado na tarefa ativa
        let account: AccountEntity | null = null;
        if (mappedOwner?.userId) {
            account = await this.accountRepo.findOne({
                where: { mt5Id: loginStr, userId: mappedOwner.userId }
            });
        }

        // 3. Busca por (mt5Id, broker) quando o servidor da corretora foi informado
        if (!account && fallbackServer) {
            const matchesByServer = await this.accountRepo.find({
                where: { mt5Id: loginStr, broker: fallbackServer }
            });
            if (matchesByServer.length === 1) {
                account = matchesByServer[0];
            }
        }

        // 4. Busca por mt5Id apenas se for único no banco (sem ambiguidade entre tenants)
        if (!account) {
            const matchesByLogin = await this.accountRepo.find({
                where: { mt5Id: loginStr }
            });
            if (matchesByLogin.length === 1) {
                account = matchesByLogin[0];
            } else if (matchesByLogin.length > 1) {
                this.logger.warn(
                    `[ISOLAMENTO MULTI-TENANT] Múltiplas contas encontradas para mt5Id=${loginStr} sem escopo de tarefa/servidor. Ignorando sync ambíguo.`
                );
                return null;
            }
        }

        // 5. Se loginStr for um UUID válido da própria conta
        if (!account && this.isValidUuid(loginStr)) {
            account = await this.accountRepo.findOne({
                where: { id: loginStr }
            });
        }

        if (account) {
            let changed = false;
            if (account.isArchived) {
                account.isArchived = false;
                account.archivedAt = null;
                changed = true;
            }
            if (!account.name || account.name === 'Conta Principal') {
                account.name = `MT5 ${loginStr}`;
                changed = true;
            }
            if (changed) {
                account = await this.accountRepo.save(account);
            }
        }

        return account;
    }
}
