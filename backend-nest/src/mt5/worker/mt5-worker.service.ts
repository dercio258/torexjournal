import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
export class Mt5WorkerService {
    private readonly logger = new Logger(Mt5WorkerService.name);
    private readonly auditLogger = new Logger('MT5AuditTrail');

    // In-memory queues & telemetry state
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
        const numericAccId = accountIdNum || parseInt(cleanLogin.replace(/\D/g, ''), 10) || Math.floor(Math.random() * 1000000);

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
                    this.mt5Gateway.broadcastConnectionStatus({ isConnected: false });
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
            account.initialBalance = balanceNum;
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

        // Broadcast to connected frontend clients via WebSocket
        try {
            this.mt5Gateway.broadcastAccountUpdate({
                balance: account.balance,
                equity: account.equity,
                margin: account.margin,
                marginFree: account.marginFree,
                marginLevel: account.marginLevel
            });
            this.mt5Gateway.broadcastConnectionStatus({ isConnected: account.isConnected });
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

    async syncPositions(accountIdNum: number, login: string, positions: any[]) {
        const cleanLogin = (login || accountIdNum || '').toString().trim();
        const account = await this.findAccountByLoginOrId(cleanLogin, accountIdNum);
        if (!account) {
            return { success: false, message: 'Account not found' };
        }

        await this.positionRepo.delete({ accountId: account.id });

        if (positions && positions.length > 0) {
            const newPositions = positions.map((p) => {
                return this.positionRepo.create({
                    accountId: account.id,
                    ticket: (p.ticket || '').toString(),
                    symbol: p.symbol || 'Unknown',
                    type: p.type || 'BUY',
                    volume: Number(p.volume) || 0,
                    openPrice: Number(p.priceOpen) || 0,
                    currentPrice: Number(p.priceCurrent) || 0,
                    profit: Number(p.profit) || 0,
                    sl: Number(p.sl) || 0,
                    tp: Number(p.tp) || 0,
                    openTime: p.time ? new Date(p.time) : new Date()
                });
            });
            await this.positionRepo.save(newPositions);
        }

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

    async syncTrades(accountIdNum: number, login: string, deals: any[], lastDealTicket?: number) {
        const cleanLogin = (login || accountIdNum || '').toString().trim();
        const account = await this.findAccountByLoginOrId(cleanLogin, accountIdNum);
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
            return { success: true, count: 0 };
        }

        const normalizedTrades = tradingDeals.map((deal) => {
            const ticket = (deal.ticket || '').toString();
            const positionId = (deal.positionId || deal.orderTicket || deal.ticket || '').toString();
            const dealTime = deal.time ? new Date(deal.time) : new Date();
            const parsedOpenTime = deal.openTime ? new Date(deal.openTime) : null;

            const isOut = (deal.entry || '').toUpperCase().includes('OUT');
            const profit = Number(deal.profit) || 0;
            const commission = Number(deal.commission) || 0;
            const swap = Number(deal.swap) || 0;
            const closePrice = Number(deal.price) || 0;
            const openPrice = deal.openPrice !== undefined && deal.openPrice !== null
                ? Number(deal.openPrice) || closePrice
                : closePrice;

            return {
                ticket: ticket,
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
                openTime: parsedOpenTime && !isNaN(parsedOpenTime.getTime())
                    ? parsedOpenTime
                    : (isOut ? new Date(dealTime.getTime() - 60000) : dealTime),
                closeTime: isOut || profit !== 0 ? dealTime : null,
                status: isOut || profit !== 0 ? 'CLOSED' : 'OPEN',
                comment: deal.comment || '',
                magic: Number(deal.magic) || 0
            };
        });

        this.logger.log(`Salvando ${normalizedTrades.length} trades para conta ${account.mt5Id || account.name} via AUTO_SYNC`);
        const result = await this.mt5Service.saveHistory(
            normalizedTrades,
            ImportMethod.AUTO_SYNC,
            account.userId,
            account.id
        );

        return { success: true, saved: result.count, lastTicket: lastDealTicket };
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
                        this.mt5Gateway.broadcastConnectionStatus({ isConnected: false });
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

        let account: AccountEntity | null = null;

        // 1. Se login explícito foi informado, busca ou vincula a conta correspondente ao login
        if (login && login.trim()) {
            const cleanLogin = login.trim();
            account = await this.accountRepo.findOne({ where: { mt5Id: cleanLogin, userId } });
            if (!account) {
                const byMt5Only = await this.accountRepo.findOne({ where: { mt5Id: cleanLogin } });
                if (byMt5Only && (!byMt5Only.userId || byMt5Only.userId === userId)) {
                    byMt5Only.userId = userId;
                    byMt5Only.isArchived = false;
                    if (!byMt5Only.name || byMt5Only.name === 'Conta Principal') {
                        byMt5Only.name = `MT5 ${cleanLogin}`;
                    }
                    account = await this.accountRepo.save(byMt5Only);
                }
            }
        }

        // 2. Se accountId válido foi informado, busca essa conta (mas se for "Conta Principal" sem mt5Id, prefere uma conta MT5 conectada do usuário)
        if (!account && this.isValidUuid(accountId)) {
            const byId = await this.accountRepo.findOne({ where: { id: accountId!.trim(), userId } });
            if (byId && byId.mt5Id) {
                account = byId;
            } else if (byId) {
                // Verifica se o usuário possui alguma conta MT5 já sincronizada antes de cair na "Conta Principal" vazia
                const mt5Candidate = await this.accountRepo.findOne({
                    where: { userId, isArchived: false, isConnected: true },
                    order: { updatedAt: 'DESC' }
                });
                if (mt5Candidate && mt5Candidate.mt5Id) {
                    account = mt5Candidate;
                } else {
                    const anyMt5 = await this.accountRepo
                        .createQueryBuilder('acc')
                        .where('acc.userId = :userId', { userId })
                        .andWhere('acc.isArchived = false')
                        .andWhere('acc.mt5Id IS NOT NULL')
                        .andWhere("acc.mt5Id != ''")
                        .orderBy('acc.updatedAt', 'DESC')
                        .getOne();
                    account = anyMt5 || byId;
                }
            }
        }

        // 3. Fallback: procura qualquer conta MT5 do usuário
        const userAccounts = await this.accountRepo.find({
            where: { userId, isArchived: false },
            order: { updatedAt: 'DESC' }
        });
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

        const mt5Login = account?.mt5Id || login || '';
        const telemetry = mt5Login ? this.accountTelemetry.get(mt5Login) || null : null;
        const activeTask = mt5Login ? this.getLatestTaskForLogin(mt5Login) : null;
        const positions = account ? await this.positionRepo.find({ where: { accountId: account.id } }) : [];
        const totalTradesCount = account
            ? await this.tradeRepo.count({ where: { accountId: account.id } })
            : 0;
        const recentTrades = account
            ? await this.tradeRepo.find({
                where: { accountId: account.id },
                order: { closeTime: 'DESC', openTime: 'DESC' },
                take: 15,
            })
            : [];
        const auditLogs = account
            ? await this.importLogRepo.find({
                where: { accountId: account.id },
                order: { createdAt: 'DESC' },
                take: 10,
            })
            : [];
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

        // 0. Se houver accountUuid mapeado diretamente da tarefa do usuário
        if (mappedOwner?.accountUuid && this.isValidUuid(mappedOwner.accountUuid)) {
            const byUuid = await this.accountRepo.findOne({ where: { id: mappedOwner.accountUuid } });
            if (byUuid && (byUuid.mt5Id === loginStr || (!byUuid.mt5Id && byUuid.name !== 'Conta Principal'))) {
                let changed = false;
                if (byUuid.mt5Id !== loginStr) { byUuid.mt5Id = loginStr; changed = true; }
                if (!byUuid.name || byUuid.name === 'Conta Principal') { byUuid.name = `MT5 ${loginStr}`; changed = true; }
                if (byUuid.isArchived) { byUuid.isArchived = false; byUuid.archivedAt = null; changed = true; }
                if (mappedOwner.userId && byUuid.userId !== mappedOwner.userId) { byUuid.userId = mappedOwner.userId; changed = true; }
                if (changed) await this.accountRepo.save(byUuid);
                return byUuid;
            }
        }

        // 1. Busca exata por mt5Id (priorizando o usuário mapeado se existir)
        let account: AccountEntity | null = null;
        if (mappedOwner?.userId) {
            account = await this.accountRepo.findOne({
                where: { mt5Id: loginStr, userId: mappedOwner.userId }
            });
        }
        if (!account) {
            account = await this.accountRepo.findOne({
                where: { mt5Id: loginStr }
            });
        }

        if (!account && accountIdNum) {
            account = await this.accountRepo.findOne({
                where: { mt5Id: accountIdNum.toString().trim() }
            });
        }

        // 2. Se loginStr for UUID, busca por id da entidade
        if (!account && this.isValidUuid(loginStr)) {
            account = await this.accountRepo.findOne({
                where: { id: loginStr }
            });
        }

        // 3. Busca por nome da conta contendo o login (ex: "MT5 32410208")
        if (!account) {
            const whereName: any = { name: Like(`%${loginStr}%`) };
            if (mappedOwner?.userId) whereName.userId = mappedOwner.userId;
            account = await this.accountRepo.findOne({ where: whereName });
            if (account && !account.mt5Id) {
                account.mt5Id = loginStr;
                await this.accountRepo.save(account);
            }
        }

        // 4. Se não encontrar, SEMPRE cria uma nova Conta de Trading dedicada para este login MT5 (sem sobrescrever "Conta Principal" e sem limite de 3 contas!)
        if (!account) {
            let ownerUserId = mappedOwner?.userId;
            if (!ownerUserId) {
                const recentAcc = await this.accountRepo.findOne({
                    where: { isArchived: false },
                    order: { updatedAt: 'DESC' }
                });
                ownerUserId = recentAcc?.userId;
            }

            if (ownerUserId) {
                const srv = fallbackServer || mappedOwner?.server || 'MetaTrader 5';
                const isDemo = srv.toLowerCase().includes('demo') || srv.toLowerCase().includes('trial');
                const newAcc = this.accountRepo.create({
                    userId: ownerUserId,
                    mt5Id: loginStr,
                    name: `MT5 ${loginStr}`,
                    broker: srv,
                    type: isDemo ? AccountType.DEMO : AccountType.LIVE,
                    currency: 'USD',
                    isPrimary: false,
                    isArchived: false,
                    isConnected: true,
                    initialBalance: 0,
                    balance: 0,
                    equity: 0,
                    appToken: randomUUID().replace(/-/g, '').toUpperCase()
                });
                account = await this.accountRepo.save(newAcc);
                this.logger.log(`Criada automaticamente nova Conta de Trading dedicada para MT5 ${loginStr} (ID: ${account.id}, User: ${ownerUserId})`);
            }
        } else {
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
            if (mappedOwner?.userId && account.userId !== mappedOwner.userId) {
                account.userId = mappedOwner.userId;
                changed = true;
            }
            if (changed) {
                account = await this.accountRepo.save(account);
            }
        }

        return account;
    }
}
